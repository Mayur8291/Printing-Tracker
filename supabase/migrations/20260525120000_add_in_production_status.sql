-- Apparel production stage: In Production (sewing / garment floor — not machine printing).

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
    'sent_to_dispatch'
  )
);

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
    else coalesce(code, '—')
  end;
$$;
