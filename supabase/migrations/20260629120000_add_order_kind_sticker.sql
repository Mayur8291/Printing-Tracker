-- Sticker orders share printing workflow but are tagged separately.
alter table public.orders drop constraint if exists orders_order_kind_check;
alter table public.orders
  add constraint orders_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker'));

alter table public.order_templates drop constraint if exists order_templates_order_kind_check;
alter table public.order_templates
  add constraint order_templates_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker'));
