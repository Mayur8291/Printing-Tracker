-- Job sheet (production order) fields + sales incharge directory

create table if not exists public.sales_incharges (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.sales_incharges enable row level security;

drop policy if exists "sales_incharges readable by authenticated users" on public.sales_incharges;
create policy "sales_incharges readable by authenticated users"
on public.sales_incharges
for select
to authenticated
using (true);

drop policy if exists "sales_incharges insert admin only" on public.sales_incharges;
create policy "sales_incharges insert admin only"
on public.sales_incharges
for insert
to authenticated
with check (public.jwt_user_is_admin());

drop policy if exists "sales_incharges delete admin only" on public.sales_incharges;
create policy "sales_incharges delete admin only"
on public.sales_incharges
for delete
to authenticated
using (public.jwt_user_is_admin());

alter table public.orders add column if not exists sales_incharge_name text;
alter table public.orders add column if not exists size_type text;
alter table public.orders add column if not exists rate_per_piece numeric(12, 2) check (rate_per_piece is null or rate_per_piece >= 0);
alter table public.orders add column if not exists brand text;
alter table public.orders add column if not exists fabric_type text;
alter table public.orders add column if not exists branding boolean;
alter table public.orders add column if not exists branding_type text;
alter table public.orders add column if not exists gsm text;
alter table public.orders add column if not exists atta boolean;
