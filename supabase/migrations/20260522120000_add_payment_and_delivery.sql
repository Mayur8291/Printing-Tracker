-- Payment and delivery options on orders (Billing, Dispatch, create form).

alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists delivery_method text;

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
check (
  payment_method is null
  or payment_method in (
    'paid_online',
    'paid_non_gst',
    'paid_with_invoice',
    'payment_pending',
    'partial_paid'
  )
);

alter table public.orders drop constraint if exists orders_delivery_method_check;
alter table public.orders add constraint orders_delivery_method_check
check (
  delivery_method is null
  or delivery_method in ('self_pickup', 'porter', 'courier_service')
);
