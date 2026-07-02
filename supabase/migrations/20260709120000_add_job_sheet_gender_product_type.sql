-- Production tracker job sheet: gender + product type

alter table public.orders add column if not exists gender text;
alter table public.orders add column if not exists product_type text;
