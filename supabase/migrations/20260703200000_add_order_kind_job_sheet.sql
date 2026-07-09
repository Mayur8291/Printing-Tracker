-- Job sheets: separate order_kind from printing orders (production tracker only).

alter table public.orders drop constraint if exists orders_order_kind_check;
alter table public.orders
  add constraint orders_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker', 'sampling', 'job_sheet'));

alter table public.order_templates drop constraint if exists order_templates_order_kind_check;
alter table public.order_templates
  add constraint order_templates_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker', 'sampling', 'job_sheet'));

-- Backfill rows created via Create Job sheet (production tracker).
-- Bypass order RLS trigger during migration (no auth user during db push).
alter table public.orders disable trigger trg_enforce_order_update_scope;

update public.orders
set order_kind = 'job_sheet'
where order_kind = 'printing'
  and is_production_order = true
  and coalesce(trim(sales_incharge_name), '') <> ''
  and coalesce(trim(size_type), '') <> '';

alter table public.orders enable trigger trg_enforce_order_update_scope;
