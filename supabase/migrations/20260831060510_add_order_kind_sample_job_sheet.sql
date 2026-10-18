-- Sample job sheets on Sampling Tracker. IDs are SA-0001, SA-0002, sequential.

alter table public.orders drop constraint if exists orders_order_kind_check;
alter table public.orders
  add constraint orders_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker', 'sampling', 'job_sheet', 'sample_job_sheet'));

alter table public.order_templates drop constraint if exists order_templates_order_kind_check;
alter table public.order_templates
  add constraint order_templates_order_kind_check
  check (order_kind in ('printing', 'regular_stock', 'sticker', 'sampling', 'job_sheet', 'sample_job_sheet'));

create unique index if not exists orders_sample_job_sheet_order_id_uidx
  on public.orders (order_id)
  where order_kind = 'sample_job_sheet';

comment on constraint orders_order_kind_check on public.orders is
  'printing | regular_stock | sticker | sampling | job_sheet | sample_job_sheet';
