-- After Sent to Dispatch, move the job to Complete orders 10 minutes later.
-- Viewer trigger blocks is_complete. RPC sets a transaction GUC so that write
-- is allowed. Do not DISABLE TRIGGER here — that takes ACCESS EXCLUSIVE on
-- orders and the client polls this RPC every 30s.

alter table public.orders
  add column if not exists status_sent_to_dispatch_at timestamptz;

comment on column public.orders.status_sent_to_dispatch_at is
  'When status last became sent_to_dispatch. Complete-list auto-promote uses this + 10 minutes.';

create or replace function public.track_status_sent_to_dispatch_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'sent_to_dispatch'
     and (tg_op = 'INSERT' or old.status is distinct from 'sent_to_dispatch') then
    new.status_sent_to_dispatch_at := coalesce(new.status_sent_to_dispatch_at, now());
  elsif new.status is distinct from 'sent_to_dispatch' then
    new.status_sent_to_dispatch_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_track_status_sent_to_dispatch_at on public.orders;
create trigger trg_track_status_sent_to_dispatch_at
before insert or update of status on public.orders
for each row execute function public.track_status_sent_to_dispatch_at();

-- Fresh 10-minute window for rows already on this status (do not mass-complete
-- from created_at, which can be days old). Migration-time only: scope trigger
-- blocks column writes when auth.uid() is null.
alter table public.orders disable trigger trg_enforce_order_update_scope;
update public.orders
set status_sent_to_dispatch_at = coalesce(status_sent_to_dispatch_at, now())
where status = 'sent_to_dispatch'
  and not is_complete
  and status_sent_to_dispatch_at is null;
alter table public.orders enable trigger trg_enforce_order_update_scope;

-- Allow the auto-complete UPDATE even when the caller is a viewer or cron
-- (auth.uid() null). Keep the rest of the live trigger body unchanged.
do $inject$
declare
  src text;
begin
  src := pg_get_functiondef('public.enforce_order_update_scope()'::regprocedure);
  if position('app.auto_complete_sent_to_dispatch' in src) = 0 then
    src := regexp_replace(
      src,
      'begin[[:space:]]+select role, coalesce\(department',
      E'begin\n  if current_setting(''app.auto_complete_sent_to_dispatch'', true) = ''on'' then\n    return new;\n  end if;\n\n  select role, coalesce(department',
      'i'
    );
    if position('app.auto_complete_sent_to_dispatch' in src) = 0 then
      raise exception 'Could not inject sent_to_dispatch auto-complete bypass into enforce_order_update_scope';
    end if;
    execute src;
  end if;
end;
$inject$;

create or replace function public.promote_stale_new_orders_to_pending()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  promoted_count integer := 0;
  completed_count integer := 0;
begin
  update public.orders
  set status = 'pending'
  where status = 'new'
    and not is_complete
    and (
      created_at <= (now() - interval '12 hours')
      or (
        created_at <= (now() - interval '10 minutes')
        and public.order_has_urgent_delivery_window(order_date, due_date)
      )
    );
  get diagnostics promoted_count = row_count;

  perform set_config('app.auto_complete_sent_to_dispatch', 'on', true);

  update public.orders
  set is_complete = true
  where status = 'sent_to_dispatch'
    and not is_complete
    and coalesce(status_sent_to_dispatch_at, created_at) <= (now() - interval '10 minutes');
  get diagnostics completed_count = row_count;

  return promoted_count + completed_count;
end;
$$;

revoke all on function public.promote_stale_new_orders_to_pending() from public;
grant execute on function public.promote_stale_new_orders_to_pending() to authenticated;

notify pgrst, 'reload schema';
