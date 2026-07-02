-- Re-allow sampling after 20260629120000_add_order_kind_sticker.sql (runs later and omitted sampling).
alter table public.orders drop constraint if exists orders_order_kind_check;
alter table public.orders
  add constraint orders_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker', 'sampling'));

alter table public.order_templates drop constraint if exists order_templates_order_kind_check;
alter table public.order_templates
  add constraint order_templates_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker', 'sampling'));

notify pgrst, 'reload schema';
