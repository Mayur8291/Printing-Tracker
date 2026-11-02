-- On hold needs a typed reason. History stores that reason.

alter table public.orders
  add column if not exists on_hold_reason text,
  add column if not exists on_hold_at timestamptz,
  add column if not exists on_hold_by uuid references auth.users(id) on delete set null;

-- Production already has on-hold jobs from before a reason was required.
update public.orders
set on_hold_reason = 'Reason was not recorded.'
where status = 'on_hold'
  and (on_hold_reason is null or length(trim(on_hold_reason)) = 0);

alter table public.orders drop constraint if exists orders_on_hold_reason_check;
alter table public.orders add constraint orders_on_hold_reason_check
check (
  status <> 'on_hold'
  or (on_hold_reason is not null and length(trim(on_hold_reason)) > 0)
);

comment on column public.orders.on_hold_reason is
  'Required when status is on_hold. Typed by the person who put the order on hold.';
comment on column public.orders.on_hold_at is
  'When the order was put on hold.';
comment on column public.orders.on_hold_by is
  'User who put the order on hold.';

do $inject$
declare
  src text;
begin
  src := pg_get_functiondef('public.log_order_activity()'::regprocedure);
  if position('Put on hold. Reason' in src) > 0 then
    return;
  end if;
  src := regexp_replace(
    src,
    'when new\.status = ''cancelled'' and nullif\(trim\(new\.cancellation_reason\), ''''\) is not null then[[:space:]]+format\(''Order cancelled\. Reason: %s'', trim\(new\.cancellation_reason\)\)',
    'when new.status = ''cancelled'' and nullif(trim(new.cancellation_reason), '''') is not null then
          format(''Order cancelled. Reason: %s'', trim(new.cancellation_reason))
        when new.status = ''on_hold'' and nullif(trim(new.on_hold_reason), '''') is not null then
          format(''Put on hold. Reason: %s'', trim(new.on_hold_reason))',
    'n'
  );
  if position('Put on hold. Reason' in src) = 0 then
    raise exception 'Could not store on-hold reason on order history';
  end if;
  execute src;
end;
$inject$;

notify pgrst, 'reload schema';
