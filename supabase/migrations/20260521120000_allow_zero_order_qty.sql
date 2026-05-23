-- Allow job cards with zero total quantity (all size inputs zero).
alter table public.orders drop constraint if exists orders_qty_check;
alter table public.orders add constraint orders_qty_check check (qty >= 0);
