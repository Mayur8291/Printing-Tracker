-- Cancelled printing orders, plus system label on automatic history rows.

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
check (
  status in (
    'new',
    'approval_pending',
    'in_production',
    'printing',
    'fusing',
    'ironing',
    'packing',
    'pending',
    'on_hold',
    'ready',
    'sent_to_dispatch',
    'dispatch_fail',
    'dispatched',
    'quotation_approval',
    'sampling',
    'sourcing',
    'sourcing_in_transit',
    'inward',
    'cutting',
    'stitching',
    'trimming',
    'qc',
    'pattern_making',
    'sample_cutting',
    'sample_stitching',
    'trim_iron',
    'branding',
    'packaging',
    'dispatched_successfully',
    'cancelled'
  )
);

alter table public.orders
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

alter table public.orders drop constraint if exists orders_cancellation_reason_check;
alter table public.orders add constraint orders_cancellation_reason_check
check (
  status <> 'cancelled'
  or (cancellation_reason is not null and length(trim(cancellation_reason)) > 0)
);

comment on column public.orders.cancellation_reason is
  'Required when status is cancelled. Typed by the person who cancelled the order.';
comment on column public.orders.cancelled_at is
  'When the order was cancelled.';
comment on column public.orders.cancelled_by is
  'User who cancelled the order. Null when a status change was automatic.';

create or replace function public.status_label(code text)
returns text
language sql
immutable
as $$
  select case code
    when 'new' then 'New Orders'
    when 'approval_pending' then 'Approval Pending'
    when 'in_production' then 'In Production'
    when 'printing' then 'Printing'
    when 'fusing' then 'Fusing'
    when 'ironing' then 'Ironing'
    when 'packing' then 'Packing'
    when 'pending' then 'Pending'
    when 'on_hold' then 'On hold'
    when 'ready' then 'Ready to Dispatch'
    when 'sent_to_dispatch' then 'Sent to Dispatch'
    when 'dispatch_fail' then 'Dispatch Fail'
    when 'dispatched' then 'Dispatched'
    when 'quotation_approval' then 'Quotation approval'
    when 'sampling' then 'Sampling'
    when 'sourcing' then 'Sourcing'
    when 'sourcing_in_transit' then 'Sourcing in transit'
    when 'inward' then 'Inward'
    when 'cutting' then 'Cutting'
    when 'stitching' then 'Stitching'
    when 'trimming' then 'Trimming'
    when 'qc' then 'QC'
    when 'pattern_making' then 'Pattern Making'
    when 'sample_cutting' then 'Sample Cutting'
    when 'sample_stitching' then 'Sample Stitching'
    when 'trim_iron' then 'Trim + Iron'
    when 'branding' then 'Branding'
    when 'packaging' then 'Packaging'
    when 'dispatched_successfully' then 'Dispatched Successfully'
    when 'cancelled' then 'Cancelled'
    else coalesce(code, '—')
  end;
$$;

-- Automatic status writes set this GUC. History must not use the signed-in name.
do $inject$
declare
  src text;
begin
  src := pg_get_functiondef('public.log_order_activity()'::regprocedure);
  if position('app.activity_by_system' in src) = 0 then
    src := regexp_replace(
      src,
      'begin[[:space:]]+if actor is not null then',
      E'begin\n  if current_setting(''app.activity_by_system'', true) = ''on'' then\n    actor := null;\n    actor_name := ''System'';\n  elsif actor is not null then',
      'i'
    );
    if position('app.activity_by_system' in src) = 0 then
      raise exception 'Could not mark automatic order history as System';
    end if;
    src := regexp_replace(
      src,
      'format\([[:space:]]+''Status updated: %s → %s'',[[:space:]]+public\.status_label\(old\.status\),[[:space:]]+public\.status_label\(new\.status\)[[:space:]]+\)',
      'case
          when new.status = ''cancelled'' and nullif(trim(new.cancellation_reason), '''') is not null then
            format(''Order cancelled. Reason: %s'', trim(new.cancellation_reason))
          else format(
            ''Status updated: %s → %s'',
            public.status_label(old.status),
            public.status_label(new.status)
          )
        end',
      'n'
    );
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
  perform set_config('app.activity_by_system', 'on', true);

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
