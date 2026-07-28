-- Prevent duplicate open stock holds for the same order at one facility.
-- Partners should use POST /api/v1/orders OR POST /stock/reserve, not both; this index
-- blocks a second RESERVED row if the app guard is bypassed.

create unique index if not exists inventory_stock_reservations_one_open_per_order
  on public.inventory_stock_reservations (order_code, facility_code)
  where status = 'RESERVED';

comment on index public.inventory_stock_reservations_one_open_per_order is
  'At most one RESERVED hold per order_code + facility_code; prevents double-reserve on place.';

notify pgrst, 'reload schema';
