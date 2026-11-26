-- Record whether printing told inventory about a product issue.

alter table public.orders
  add column if not exists product_received_informed_inventory boolean;

comment on column public.orders.product_received_informed_inventory is
  'True when printing checked Informed to inventory before marking a product issue.';

alter table public.orders drop constraint if exists orders_product_received_check;
alter table public.orders add constraint orders_product_received_check check (
  (
    product_received_at is null
    and product_received_by is null
    and product_received_proof_url is null
    and product_received_issue is null
    and product_received_qty is null
    and product_received_sizes is null
    and product_received_color_ok is null
    and product_received_product_ok is null
    and product_received_no_picklist is null
    and product_received_informed_inventory is null
  )
  or
  (
    product_received_at is not null
    and product_received_by is not null
    and product_received_proof_url is not null
    and btrim(product_received_proof_url) <> ''
    and (product_received_issue is null or btrim(product_received_issue) <> '')
    and (product_received_qty is null or product_received_qty >= 0)
    and (product_received_sizes is null or jsonb_typeof(product_received_sizes) = 'object')
  )
  or
  (
    product_received_no_picklist is true
    and product_received_at is not null
    and product_received_by is not null
    and (product_received_proof_url is null or btrim(product_received_proof_url) <> '')
    and (product_received_issue is null or btrim(product_received_issue) <> '')
    and (product_received_qty is null or product_received_qty >= 0)
    and (product_received_sizes is null or jsonb_typeof(product_received_sizes) = 'object')
  )
);

do $$
declare
  src text;
  patched text;
  needle text;
  insert_sql text;
begin
  select pg_get_functiondef(p.oid)
    into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'enforce_order_update_scope';

  needle := $n$
      or new.product_received_no_picklist is distinct from old.product_received_no_picklist
    ) then
      raise exception 'Viewer cannot record product receipt';$n$;
  insert_sql := $n$
      or new.product_received_no_picklist is distinct from old.product_received_no_picklist
      or new.product_received_informed_inventory is distinct from old.product_received_informed_inventory
    ) then
      raise exception 'Viewer cannot record product receipt';$n$;
  patched := replace(src, needle, insert_sql);
  if patched = src then
    raise exception 'informed inventory guard did not match the live function';
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
  old_issue text := nullif(btrim(coalesce(old.product_received_issue, '')), '');
  proof text := nullif(btrim(coalesce(new.product_received_proof_url, '')), '');
  sizes jsonb := new.product_received_sizes;
  job_sizes jsonb := coalesce(new.size_breakdown, '{}'::jsonb);
  outcome text := 'match';
  lines text[] := '{}';
  summary text;
  any_short boolean := false;
  any_extra boolean := false;
  rec record;
  got integer;
  expected integer;
  line text;
begin
  if new.product_received_at is not distinct from old.product_received_at
     and new.product_received_by is not distinct from old.product_received_by
     and new.product_received_issue is not distinct from old.product_received_issue
     and new.product_received_proof_url is not distinct from old.product_received_proof_url
     and new.product_received_qty is not distinct from old.product_received_qty
     and new.product_received_sizes is not distinct from old.product_received_sizes
     and new.product_received_color_ok is not distinct from old.product_received_color_ok
     and new.product_received_product_ok is not distinct from old.product_received_product_ok
     and new.product_received_no_picklist is not distinct from old.product_received_no_picklist
     and new.product_received_informed_inventory is not distinct from old.product_received_informed_inventory then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  if new.product_received_at is null then
    outcome := 'cleared';
    lines := array['Product receipt cleared'];
  else
    if new.product_received_no_picklist is true then
      lines := array_append(lines, 'No picklist — rejected by printing');
    end if;

    if jsonb_typeof(sizes) = 'object' then
      for rec in
        select e.key, (e.value #>> '{}')::integer as n
        from jsonb_each(job_sizes) e
        where (e.value #>> '{}') ~ '^[0-9]+$'
          and (e.value #>> '{}')::integer > 0
        order by e.key
      loop
        if sizes ? rec.key and (sizes ->> rec.key) ~ '^[0-9]+$' then
          got := (sizes ->> rec.key)::integer;
        else
          got := null;
        end if;
        if got is null then
          continue;
        end if;
        expected := rec.n;
        if got = expected then
          line := rec.key || ': ' || got::text || ' out of ' || expected::text;
        elsif got > expected then
          any_extra := true;
          line := rec.key || ': ' || got::text || ' out of ' || expected::text
            || ' — extra ' || (got - expected)::text;
        else
          any_short := true;
          line := rec.key || ': ' || got::text || ' out of ' || expected::text
            || ' — short ' || (expected - got)::text;
        end if;
        lines := array_append(lines, line);
      end loop;

      if not exists (
        select 1 from jsonb_each(job_sizes) e
        where (e.value #>> '{}') ~ '^[0-9]+$' and (e.value #>> '{}')::integer > 0
      ) and sizes ? 'Total' and (sizes ->> 'Total') ~ '^[0-9]+$' then
        got := (sizes ->> 'Total')::integer;
        expected := coalesce(new.qty, 0);
        if got = expected then
          line := 'Total: ' || got::text || ' out of ' || expected::text;
        elsif got > expected then
          any_extra := true;
          line := 'Total: ' || got::text || ' out of ' || expected::text
            || ' — extra ' || (got - expected)::text;
        else
          any_short := true;
          line := 'Total: ' || got::text || ' out of ' || expected::text
            || ' — short ' || (expected - got)::text;
        end if;
        lines := array_append(lines, line);
      end if;
    end if;

    if new.product_received_color_ok is false then
      lines := array_append(lines, 'Color issue');
    elsif new.product_received_color_ok is true then
      lines := array_append(lines, 'Color matches');
    end if;
    if new.product_received_product_ok is false then
      lines := array_append(lines, 'Product mismatch');
    end if;
    if issue is not null then
      lines := array_append(lines, 'Remark: ' || issue);
    end if;
    if new.product_received_informed_inventory is true then
      lines := array_append(lines, 'Informed to inventory');
    end if;

    if new.product_received_no_picklist is true then
      outcome := 'rejected';
    elsif any_short or new.product_received_color_ok is false or new.product_received_product_ok is false then
      outcome := 'short';
    elsif any_extra then
      outcome := 'extra';
    else
      outcome := 'match';
    end if;
  end if;

  summary := array_to_string(lines, E'\n');
  if summary is null or summary = '' then
    summary := 'Product received';
  end if;

  insert into public.order_activity_log (
    order_id, event_type, message, meta, actor_id, actor_label
  )
  values (
    new.id,
    case outcome
      when 'rejected' then 'product_received_rejected'
      when 'extra' then 'product_received_extra'
      when 'short' then 'product_received_short'
      when 'issue' then 'product_received_issue'
      else 'product_received'
    end,
    summary,
    jsonb_strip_nulls(jsonb_build_object(
      'outcome', outcome,
      'proof_url', proof,
      'issue', issue,
      'previous_issue', old_issue,
      'received_sizes', sizes,
      'color_ok', new.product_received_color_ok,
      'product_ok', new.product_received_product_ok,
      'no_picklist', new.product_received_no_picklist,
      'informed_inventory', new.product_received_informed_inventory,
      'recorded_at', new.product_received_at
    )),
    actor,
    coalesce(actor_name, 'User')
  );

  if outcome in ('short', 'extra', 'rejected', 'issue')
     and new.created_by is not null
     and new.created_by is distinct from actor
     and (
       new.product_received_sizes is distinct from old.product_received_sizes
       or new.product_received_color_ok is distinct from old.product_received_color_ok
       or new.product_received_product_ok is distinct from old.product_received_product_ok
       or new.product_received_no_picklist is distinct from old.product_received_no_picklist
       or new.product_received_informed_inventory is distinct from old.product_received_informed_inventory
       or issue is distinct from old_issue
       or old.product_received_at is null
     ) then
    insert into public.order_status_notifications (
      recipient_user_id, order_id, order_display_id, previous_status, new_status, changed_by_user_id, note
    ) values (
      new.created_by, new.id, new.order_id, old.status, 'product_issue', actor, summary
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_product_receipt on public.orders;
create trigger trg_log_product_receipt
after update of product_received_at, product_received_by, product_received_proof_url, product_received_issue, product_received_qty, product_received_sizes, product_received_color_ok, product_received_product_ok, product_received_no_picklist, product_received_informed_inventory
on public.orders
for each row
execute function public.log_product_receipt();
