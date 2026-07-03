-- Job sheet garment production pipeline statuses (Production tracker).

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
    'qc'
  )
);

-- New job sheets start at quotation approval; migrate legacy job sheet "new" rows.
update public.orders
set status = 'quotation_approval'
where order_kind = 'job_sheet'
  and status = 'new';

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
    else coalesce(code, '—')
  end;
$$;
