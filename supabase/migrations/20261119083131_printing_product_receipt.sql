-- Printing orders: record that the product reached printing, with proof,
-- or an issue reason when the product does not match the job.

alter table public.orders
  add column if not exists product_received_at timestamptz,
  add column if not exists product_received_by uuid references auth.users (id) on delete set null,
  add column if not exists product_received_proof_url text,
  add column if not exists product_received_issue text;

comment on column public.orders.product_received_at is
  'When printing confirmed the product reached the floor. Null means it has not arrived.';
comment on column public.orders.product_received_proof_url is
  'Public URL of the photo or file used to verify the received product.';
comment on column public.orders.product_received_issue is
  'Why the received product does not match the job. Null means it matched.';

alter table public.orders drop constraint if exists orders_product_received_check;
alter table public.orders add constraint orders_product_received_check check (
  (
    product_received_at is null
    and product_received_by is null
    and product_received_proof_url is null
    and product_received_issue is null
  )
  or (
    product_received_at is not null
    and product_received_by is not null
    and product_received_proof_url is not null
    and btrim(product_received_proof_url) <> ''
    and (product_received_issue is null or btrim(product_received_issue) <> '')
  )
);

create or replace function public.jwt_can_record_product_receipt()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select pr.role = 'admin'
        or coalesce(pop.can_edit_status, pr.role = 'viewer')
        or coalesce(pop.can_edit_received_at_printing, false)
      from public.profiles pr
      left join public.profile_order_permissions pop on pop.user_id = pr.id
      where pr.id = auth.uid()
    ),
    false
  );
$$;

grant execute on function public.jwt_can_record_product_receipt() to authenticated;
grant execute on function public.jwt_can_record_product_receipt() to service_role;

insert into storage.buckets (id, name, public)
values ('product-receipts', 'product-receipts', true)
on conflict (id) do nothing;

drop policy if exists "product receipts read authenticated" on storage.objects;
create policy "product receipts read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'product-receipts');

drop policy if exists "product receipts upload printing" on storage.objects;
create policy "product receipts upload printing"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-receipts'
  and public.jwt_can_record_product_receipt()
);

-- Viewers may record receipt when they can edit status or the received time.
-- Status editors may also set received_at_printing as part of that same save.
do $$
declare
  src text;
  patched text;
  needle text;
  insert_sql text;
begin
  src := replace(pg_get_functiondef('public.enforce_order_update_scope()'::regprocedure), E'\r\n', E'\n');
  if position('Viewer cannot record product receipt' in src) > 0 then
    return;
  end if;
  needle := $n$
    if not allow_received_at_printing and new.received_at_printing is distinct from old.received_at_printing then
      raise exception 'Viewer cannot edit received date/time to printing';
    end if;$n$;
  insert_sql := $n$
    if not allow_received_at_printing and not allow_status and new.received_at_printing is distinct from old.received_at_printing then
      raise exception 'Viewer cannot edit received date/time to printing';
    end if;
    if not (allow_status or allow_received_at_printing) and (
      new.product_received_at is distinct from old.product_received_at
      or new.product_received_by is distinct from old.product_received_by
      or new.product_received_proof_url is distinct from old.product_received_proof_url
      or new.product_received_issue is distinct from old.product_received_issue
    ) then
      raise exception 'Viewer cannot record product receipt';
    end if;$n$;
  patched := replace(src, needle, insert_sql);
  if patched = src then
    raise exception 'product receipt trigger patch did not match the live function';
  end if;
  execute patched;
end $$;

create or replace function public.log_product_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text := 'User';
  issue text := nullif(btrim(coalesce(new.product_received_issue, '')), '');
begin
  if new.product_received_at is not distinct from old.product_received_at
     and new.product_received_issue is not distinct from old.product_received_issue
     and new.product_received_proof_url is not distinct from old.product_received_proof_url then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  insert into public.order_activity_log (order_id, event_type, message, actor_id, actor_label)
  values (
    new.id,
    case when issue is not null then 'product_received_issue' else 'product_received' end,
    case
      when new.product_received_at is null then 'Product receipt cleared.'
      when issue is not null then 'Product received with an issue: ' || issue
      else 'Product received and checked against the job. Proof saved.'
    end,
    actor,
    coalesce(actor_name, 'User')
  );
  return new;
end;
$$;

drop trigger if exists trg_log_product_receipt on public.orders;
create trigger trg_log_product_receipt
after update of product_received_at, product_received_proof_url, product_received_issue
on public.orders
for each row
execute procedure public.log_product_receipt();

notify pgrst, 'reload schema';
