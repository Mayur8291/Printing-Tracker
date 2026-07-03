-- Job sheet: regular stock from inventory

alter table public.orders add column if not exists job_sheet_regular_stock boolean not null default false;
alter table public.orders add column if not exists job_sheet_regular_stock_items jsonb not null default '[]'::jsonb;
