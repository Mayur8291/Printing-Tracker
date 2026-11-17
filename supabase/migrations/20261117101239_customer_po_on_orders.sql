-- Customer purchase-order number for production job sheets.
-- Job IDs stay on orders.order_id. This column is the customer's own PO.
-- Empty for printing orders and sample cards that have no PO.

alter table public.orders
  add column if not exists customer_po_number text;

comment on column public.orders.customer_po_number is
  'Customer purchase order number. Unique when set. Used by the production tracker search.';

create unique index if not exists orders_customer_po_number_uidx
  on public.orders (lower(btrim(customer_po_number)))
  where customer_po_number is not null
    and btrim(customer_po_number) <> '';

notify pgrst, 'reload schema';
