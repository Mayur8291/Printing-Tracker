-- Distinguish printing jobs vs regular stock orders.
alter table public.orders
  add column if not exists order_kind text not null default 'printing'
  check (order_kind in ('printing', 'regular_stock'));

alter table public.order_templates
  add column if not exists order_kind text not null default 'printing'
  check (order_kind in ('printing', 'regular_stock'));

