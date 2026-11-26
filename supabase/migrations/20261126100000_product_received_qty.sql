-- Record how many pieces arrived and compare that count with the job quantity.

alter table public.orders
  add column if not exists product_received_qty integer;

comment on column public.orders.product_received_qty is
  'Pieces counted when the product reached printing. Equal to orders.qty matches, less is short, more is extra.';

alter table public.orders drop constraint if exists orders_product_received_check;
alter table public.orders add constraint orders_product_received_check check (
  (
    product_received_at is null
    and product_received_by is null
    and product_received_proof_url is null
    and product_received_issue is null
    and product_received_qty is null
  )
  or
  (
    product_received_at is not null
    and product_received_by is not null
    and product_received_proof_url is not null
    and btrim(product_received_proof_url) <> ''
    and (product_received_issue is null or btrim(product_received_issue) <> '')
    and (product_received_qty is null or product_received_qty >= 0)
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
      or new.product_received_issue is distinct from old.product_received_issue
    ) then
      raise exception 'Viewer cannot record product receipt';$n$;
  insert_sql := $n$
      or new.product_received_issue is distinct from old.product_received_issue
      or new.product_received_qty is distinct from old.product_received_qty
    ) then
      raise exception 'Viewer cannot record product receipt';$n$;
  patched := replace(src, needle, insert_sql);
  if patched = src then
    raise exception 'product receipt qty guard did not match the live function';
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
  received_qty integer := new.product_received_qty;
  job_qty integer := new.qty;
  outcome text;
  summary text;
  detail text;
begin
  if new.product_received_at is not distinct from old.product_received_at
     and new.product_received_by is not distinct from old.product_received_by
     and new.product_received_issue is not distinct from old.product_received_issue
     and new.product_received_proof_url is not distinct from old.product_received_proof_url
     and new.product_received_qty is not distinct from old.product_received_qty then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  if new.product_received_at is null then
    outcome := 'cleared';
    summary := 'Product receipt cleared.';
  elsif received_qty is null and issue is not null then
    outcome := 'issue';
    summary := 'Product received with an issue: ' || issue || '.';
  elsif received_qty is null then
    outcome := 'match';
    summary := 'Product received and checked against the job.';
  elsif job_qty is null then
    if received_qty > 0 then
      outcome := 'extra';
      summary := 'Product received ' || received_qty::text || '. The job quantity is not set.';
    else
      outcome := 'short';
      summary := 'Product received ' || received_qty::text || '. Not matching the job.';
    end if;
  elsif received_qty = job_qty then
    outcome := 'match';
    summary := 'Product received ' || received_qty::text || ' of ' || job_qty::text || '. Matches the job.';
  elsif received_qty > job_qty then
    outcome := 'extra';
    summary := 'Product received ' || received_qty::text || ' of ' || job_qty::text
      || '. Extra ' || (received_qty - job_qty)::text || '.';
  else
    outcome := 'short';
    summary := 'Product received ' || received_qty::text || ' of ' || job_qty::text
      || '. Short by ' || (job_qty - received_qty)::text || '. Not matching the job.';
  end if;

  detail := summary;
  if proof is not null and new.product_received_at is not null then
    detail := detail || ' Proof: ' || proof;
  end if;

  insert into public.order_activity_log (
    order_id, event_type, message, meta, actor_id, actor_label
  )
  values (
    new.id,
    case outcome
      when 'extra' then 'product_received_extra'
      when 'short' then 'product_received_short'
      when 'issue' then 'product_received_issue'
      else 'product_received'
    end,
    detail,
    jsonb_strip_nulls(jsonb_build_object(
      'outcome', outcome,
      'proof_url', proof,
      'issue', issue,
      'previous_issue', old_issue,
      'received_qty', received_qty,
      'job_qty', job_qty,
      'recorded_at', new.product_received_at
    )),
    actor,
    coalesce(actor_name, 'User')
  );

  if outcome in ('short', 'extra', 'issue')
     and new.created_by is not null
     and new.created_by is distinct from actor
     and (
       new.product_received_qty is distinct from old.product_received_qty
       or issue is distinct from old_issue
       or old.product_received_at is null
     ) then
    insert into public.order_status_notifications (
      recipient_user_id,
      order_id,
      order_display_id,
      previous_status,
      new_status,
      changed_by_user_id,
      note
    ) values (
      new.created_by,
      new.id,
      new.order_id,
      old.status,
      'product_issue',
      actor,
      summary
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_product_receipt on public.orders;
create trigger trg_log_product_receipt
after update of product_received_at, product_received_by, product_received_proof_url, product_received_issue, product_received_qty
on public.orders
for each row
execute function public.log_product_receipt();
