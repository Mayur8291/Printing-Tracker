-- Add status value approval_pending (UI: "Approval Pending")
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
check (
  status in (
    'new',
    'approval_pending',
    'printing',
    'fusing',
    'ironing',
    'packing',
    'pending',
    'on_hold',
    'ready'
  )
);
