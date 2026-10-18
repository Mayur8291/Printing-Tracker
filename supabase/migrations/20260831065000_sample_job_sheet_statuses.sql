-- Sampling Tracker job-sheet pipeline statuses.

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
    'dispatched_successfully'
  )
);

-- Bypass order RLS trigger during migration (no auth user during db push).
alter table public.orders disable trigger trg_enforce_order_update_scope;

update public.orders
set status = 'pattern_making'
where order_kind = 'sample_job_sheet'
  and status not in (
    'pattern_making',
    'sample_cutting',
    'sample_stitching',
    'trim_iron',
    'branding',
    'qc',
    'packaging',
    'ready',
    'dispatched_successfully'
  );

alter table public.orders enable trigger trg_enforce_order_update_scope;

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
    else coalesce(code, '—')
  end;
$$;
