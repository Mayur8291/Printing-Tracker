-- Step 5: Uniware bridge. Uniware owns ecom-facility on-hand; the platform
-- holds a read-only mirror and never sums it into platform stock. Cross-boundary
-- moves are uni_transfer documents. Scott API untouched.

create table if not exists public.uni_settings (
  id integer primary key default 1 check (id = 1),
  default_entity_id uuid references public.core_entity(id) on delete restrict,
  default_customer_id uuid references public.crm_party(id) on delete restrict,
  uniware_location_id uuid references public.core_location(id) on delete restrict,
  transit_location_id uuid references public.core_location(id) on delete restrict,
  facility_code text,
  updated_at timestamptz not null default now()
);

insert into public.uni_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.uni_sync_log (
  id uuid primary key default gen_random_uuid(),
  feed text not null check (feed in (
    'inventory', 'sale_orders', 'shipments', 'invoices', 'returns', 'adjust_out'
  )),
  status text not null check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_upserted integer not null default 0,
  watermark timestamptz,
  error_text text,
  created_by uuid
);

create index if not exists uni_sync_log_feed_idx on public.uni_sync_log (feed, started_at desc);

create table if not exists public.uni_inventory_mirror (
  facility_code text not null,
  sku_code text not null,
  inventory_type text not null default 'GOOD_INVENTORY',
  qty numeric(14, 2) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (facility_code, sku_code, inventory_type)
);

create index if not exists uni_inventory_mirror_sku_idx on public.uni_inventory_mirror (sku_code);

create table if not exists public.uni_sale_order (
  uni_code text primary key,
  channel text,
  status text,
  facility_code text,
  customer_name text,
  display_order_code text,
  order_date date,
  payload jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists uni_sale_order_status_idx on public.uni_sale_order (status, order_date desc);

create table if not exists public.uni_shipment (
  uni_code text primary key,
  sale_order_code text not null,
  status text,
  tracking_no text,
  courier text,
  payload jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.uni_invoice (
  uni_code text primary key,
  sale_order_code text,
  amount numeric(14, 2),
  invoice_date date,
  payload jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.uni_return (
  uni_code text primary key,
  sale_order_code text,
  status text,
  payload jsonb,
  synced_at timestamptz not null default now()
);

-- Cross-boundary transfer. Stock movements are posted by uni_post_transfer;
-- the Uniware adjust API is called by the edge function (best-effort, retried).
create table if not exists public.uni_transfer (
  id uuid primary key default gen_random_uuid(),
  transfer_no text unique,
  direction text not null check (direction in ('platform_to_uniware', 'uniware_to_platform')),
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  from_location_id uuid not null references public.core_location(id) on delete restrict,
  to_location_id uuid not null references public.core_location(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'posted', 'api_ok', 'api_failed')),
  uniware_ref text,
  error_text text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists uni_transfer_status_idx on public.uni_transfer (status, created_at desc);

create or replace view public.uni_feed_health_view
with (security_invoker = true) as
select
  f.feed,
  l.status as last_status,
  l.finished_at as last_finished_at,
  l.rows_upserted as last_rows,
  l.error_text as last_error,
  case
    when l.finished_at is null then true
    when l.status <> 'success' then true
    when l.finished_at < now() - interval '2 hours' then true
    else false
  end as stale
from (
  select unnest(array['inventory', 'sale_orders', 'shipments', 'invoices', 'returns']::text[]) as feed
) f
left join lateral (
  select * from public.uni_sync_log
  where feed = f.feed and status <> 'running'
  order by started_at desc
  limit 1
) l on true;

create or replace function public.uni_begin_sync(p_feed text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.ops_assert_admin();
  insert into public.uni_sync_log (feed, status, created_by)
  values (p_feed, 'running', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.uni_finish_sync(
  p_log_id uuid,
  p_ok boolean,
  p_rows integer default 0,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.uni_sync_log
  set status = case when p_ok then 'success' else 'error' end,
      finished_at = now(),
      rows_upserted = coalesce(p_rows, 0),
      watermark = case when p_ok then now() else watermark end,
      error_text = p_error
  where id = p_log_id;
end;
$$;

-- Post the platform-side movements for a draft transfer. Does NOT call Uniware.
create or replace function public.uni_post_transfer(p_transfer_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.uni_transfer%rowtype;
  v_settings public.uni_settings%rowtype;
  v_no text;
  v_entity uuid;
  v_from_owner text;
  v_to_owner text;
begin
  perform public.ops_assert_admin();
  select * into v_t from public.uni_transfer where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_t.status <> 'draft' then
    raise exception 'Only draft transfers can be posted (current: %)', v_t.status;
  end if;

  select * into v_settings from public.uni_settings where id = 1;
  select default_entity_id into v_entity from public.uni_settings where id = 1;
  if v_entity is null then
    select id into v_entity from public.core_entity where is_active order by created_at limit 1;
  end if;
  if v_entity is null then
    raise exception 'Create a legal entity in Platform Masters before posting a Uniware transfer';
  end if;

  select owner_system into v_from_owner from public.core_location where id = v_t.from_location_id;
  select owner_system into v_to_owner from public.core_location where id = v_t.to_location_id;
  if v_from_owner is null or v_to_owner is null then
    raise exception 'Both transfer locations must exist in Platform Masters';
  end if;
  if v_t.direction = 'platform_to_uniware' then
    if v_from_owner <> 'platform' or v_to_owner <> 'uniware' then
      raise exception 'Platform → Uniware needs from=platform location and to=uniware location';
    end if;
  else
    if v_from_owner <> 'uniware' or v_to_owner <> 'platform' then
      raise exception 'Uniware → Platform needs from=uniware location and to=platform location';
    end if;
  end if;

  v_no := public.ops_next_doc_no(v_entity, 'utr', current_date);

  if v_t.direction = 'platform_to_uniware' then
    -- Source → in_transit, then in_transit → Uniware marker (never counted as platform-owned).
    perform public.inv_post_movement(
      v_t.sku_id, v_t.from_location_id, v_t.to_location_id, v_t.qty,
      'good', 'transfer', 'uni_transfer', p_transfer_id::text, null, 'Platform to Uniware'
    );
  else
    perform public.inv_post_movement(
      v_t.sku_id, v_t.from_location_id, v_t.to_location_id, v_t.qty,
      'good', 'transfer', 'uni_transfer', p_transfer_id::text, null, 'Uniware to platform'
    );
  end if;

  update public.uni_transfer
  set status = 'posted', transfer_no = v_no, updated_at = now()
  where id = p_transfer_id;

  return v_no;
end;
$$;

create or replace function public.uni_mark_transfer_api(
  p_transfer_id uuid,
  p_ok boolean,
  p_ref text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.ops_assert_admin();
  select status into v_status from public.uni_transfer where id = p_transfer_id for update;
  if v_status is null then raise exception 'Transfer not found'; end if;
  if v_status not in ('posted', 'api_failed', 'api_ok') then
    raise exception 'API mark only after the transfer is posted';
  end if;
  update public.uni_transfer
  set status = case when p_ok then 'api_ok' else 'api_failed' end,
      uniware_ref = coalesce(p_ref, uniware_ref),
      error_text = p_error,
      updated_at = now()
  where id = p_transfer_id;
end;
$$;

revoke execute on function public.uni_begin_sync(text) from public, anon;
revoke execute on function public.uni_finish_sync(uuid, boolean, integer, text) from public, anon;
revoke execute on function public.uni_post_transfer(uuid) from public, anon;
revoke execute on function public.uni_mark_transfer_api(uuid, boolean, text, text) from public, anon;

grant execute on function public.uni_begin_sync(text) to authenticated, service_role;
grant execute on function public.uni_finish_sync(uuid, boolean, integer, text) to authenticated, service_role;
grant execute on function public.uni_post_transfer(uuid) to authenticated, service_role;
grant execute on function public.uni_mark_transfer_api(uuid, boolean, text, text) to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'uni_settings', 'uni_sync_log', 'uni_inventory_mirror',
    'uni_sale_order', 'uni_shipment', 'uni_invoice', 'uni_return', 'uni_transfer'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'drop policy if exists "%s read authenticated" on public.%I;
       create policy "%s read authenticated" on public.%I
       for select to authenticated using (true);',
      t, t, t, t
    );
  end loop;

  -- Settings + draft transfers + mirror upserts from the logged-in admin
  -- (edge uses the user JWT + SECURITY DEFINER RPCs / service role).
  foreach t in array array['uni_settings', 'uni_transfer']
  loop
    execute format(
      'drop policy if exists "%s admin write" on public.%I;
       create policy "%s admin write" on public.%I
       for all to authenticated
       using (public.jwt_user_is_admin())
       with check (public.jwt_user_is_admin());',
      t, t, t, t
    );
  end loop;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['uni_transfer', 'uni_sync_log', 'uni_settings']
  loop
    execute format(
      'drop trigger if exists %I_audit on public.%I;
       create trigger %I_audit
       after insert or update or delete on public.%I
       for each row execute function public.audit_row_change();',
      t, t, t, t
    );
  end loop;
end;
$$;

-- Marker location Uniware owns. Platform stock never lives here.
insert into public.core_location (code, name, kind, virtual_kind, owner_system)
values ('UNIWARE-ECOM', 'Uniware ecom facility (marker)', 'virtual', 'uniware_facility', 'uniware')
on conflict (code) do update
  set owner_system = excluded.owner_system,
      virtual_kind = excluded.virtual_kind,
      is_active = true,
      updated_at = now();

update public.uni_settings us
set uniware_location_id = loc.id
from public.core_location loc
where us.id = 1
  and loc.code = 'UNIWARE-ECOM'
  and us.uniware_location_id is null;

grant select on
  public.uni_settings,
  public.uni_sync_log,
  public.uni_inventory_mirror,
  public.uni_sale_order,
  public.uni_shipment,
  public.uni_invoice,
  public.uni_return,
  public.uni_transfer
to authenticated;

grant select on public.uni_feed_health_view to authenticated;

grant insert, update, delete on public.uni_settings, public.uni_transfer to authenticated;
