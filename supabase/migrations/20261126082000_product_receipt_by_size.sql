-- Record product receipt by size, with a color confirmation and a remark when it does not match.

alter table public.orders
  add column if not exists product_received_sizes jsonb,
  add column if not exists product_received_color_ok boolean;

comment on column public.orders.product_received_sizes is
  'Pieces received for each size on the job. Compared with orders.size_breakdown.';
comment on column public.orders.product_received_color_ok is
  'True when the person confirmed the product color matches the job.';

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
      or new.product_received_qty is distinct from old.product_received_qty
    ) then
      raise exception 'Viewer cannot record product receipt';$n$;
  insert_sql := $n$
      or new.product_received_qty is distinct from old.product_received_qty
      or new.product_received_sizes is distinct from old.product_received_sizes
      or new.product_received_color_ok is distinct from old.product_received_color_ok
    ) then
      raise exception 'Viewer cannot record product receipt';$n$;
  patched := replace(src, needle, insert_sql);
  if patched = src then
    raise exception 'product receipt size guard did not match the live function';
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
  sizes jsonb := new.product_received_sizes;
  job_sizes jsonb := coalesce(new.size_breakdown, '{}'::jsonb);
  outcome text;
  summary text;
  detail text;
  size_line text := '';
  any_short boolean := false;
  any_extra boolean := false;
  rec record;
  got integer;
  expected integer;
begin
  if new.product_received_at is not distinct from old.product_received_at
     and new.product_received_by is not distinct from old.product_received_by
     and new.product_received_issue is not distinct from old.product_received_issue
     and new.product_received_proof_url is not distinct from old.product_received_proof_url
     and new.product_received_qty is not distinct from old.product_received_qty
     and new.product_received_sizes is not distinct from old.product_received_sizes
     and new.product_received_color_ok is not distinct from old.product_received_color_ok then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  if new.product_received_at is null then
    outcome := 'cleared';
    summary := 'Product receipt cleared.';
  elsif jsonb_typeof(sizes) = 'object' then
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
        got := 0;
      end if;
      expected := rec.n;
      if got = expected then
        size_line := size_line || case when size_line = '' then '' else ', ' end
          || rec.key || ' ' || got::text || ' of ' || expected::text;
      elsif got > expected then
        any_extra := true;
        size_line := size_line || case when size_line = '' then '' else ', ' end
          || rec.key || ' ' || got::text || ' of ' || expected::text
          || ' (extra ' || (got - expected)::text || ')';
      else
        any_short := true;
        size_line := size_line || case when size_line = '' then '' else ', ' end
          || rec.key || ' ' || got::text || ' of ' || expected::text
          || ' (short ' || (expected - got)::text || ')';
      end if;
    end loop;

    if size_line = '' and sizes ? 'Total' and (sizes ->> 'Total') ~ '^[0-9]+$' then
      got := (sizes ->> 'Total')::integer;
      expected := coalesce(job_qty, 0);
      if got = expected then
        size_line := 'Total ' || got::text || ' of ' || expected::text;
      elsif got > expected then
        any_extra := true;
        size_line := 'Total ' || got::text || ' of ' || expected::text
          || ' (extra ' || (got - expected)::text || ')';
      else
        any_short := true;
        size_line := 'Total ' || got::text || ' of ' || expected::text
          || ' (short ' || (expected - got)::text || ')';
      end if;
    end if;

    if new.product_received_color_ok is false then
      any_short := true;
    end if;

    if any_short then
      outcome := 'short';
    elsif any_extra then
      outcome := 'extra';
    else
      outcome := 'match';
    end if;

    summary := size_line;
    if new.product_received_color_ok is true then
      summary := summary || ' Color matches.';
    elsif new.product_received_color_ok is false then
      summary := summary || ' Color does not match.';
    end if;
    if issue is not null and outcome <> 'match' then
      summary := summary || ' Remark: ' || issue;
    end if;
  elsif received_qty is null and issue is not null then
    outcome := 'issue';
    summary := 'Product received with an issue: ' || issue || '.';
  elsif received_qty is null then
    outcome := 'match';
    summary := 'Product received and checked against the job.';
  elsif job_qty is null then
    outcome := case when received_qty > 0 then 'extra' else 'short' end;
    summary := 'Product received ' || received_qty::text || '.';
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
      'received_sizes', sizes,
      'color_ok', new.product_received_color_ok,
      'recorded_at', new.product_received_at
    )),
    actor,
    coalesce(actor_name, 'User')
  );

  if outcome in ('short', 'extra', 'issue')
     and new.created_by is not null
     and new.created_by is distinct from actor
     and (
       new.product_received_sizes is distinct from old.product_received_sizes
       or new.product_received_qty is distinct from old.product_received_qty
       or new.product_received_color_ok is distinct from old.product_received_color_ok
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
after update of product_received_at, product_received_by, product_received_proof_url, product_received_issue, product_received_qty, product_received_sizes, product_received_color_ok
on public.orders
for each row
execute function public.log_product_receipt();
