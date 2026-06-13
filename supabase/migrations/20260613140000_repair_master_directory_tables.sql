-- Repair: recreate owners / coordinators / sales_incharges if dropped or never migrated.
-- Safe to run multiple times (IF NOT EXISTS + policy drops).

create table if not exists public.owners (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.coordinators (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_incharges (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.owners enable row level security;
alter table public.coordinators enable row level security;
alter table public.sales_incharges enable row level security;

-- owners
drop policy if exists "owners readable by authenticated users" on public.owners;
create policy "owners readable by authenticated users"
on public.owners for select to authenticated using (true);

drop policy if exists "owners insert admin only" on public.owners;
create policy "owners insert admin only"
on public.owners for insert to authenticated with check (public.jwt_user_is_admin());

drop policy if exists "owners update admin only" on public.owners;
create policy "owners update admin only"
on public.owners for update to authenticated
using (public.jwt_user_is_admin()) with check (public.jwt_user_is_admin());

drop policy if exists "owners delete admin only" on public.owners;
create policy "owners delete admin only"
on public.owners for delete to authenticated using (public.jwt_user_is_admin());

-- coordinators
drop policy if exists "coordinators readable by authenticated users" on public.coordinators;
create policy "coordinators readable by authenticated users"
on public.coordinators for select to authenticated using (true);

drop policy if exists "coordinators insert admin only" on public.coordinators;
create policy "coordinators insert admin only"
on public.coordinators for insert to authenticated with check (public.jwt_user_is_admin());

drop policy if exists "coordinators update admin only" on public.coordinators;
create policy "coordinators update admin only"
on public.coordinators for update to authenticated
using (public.jwt_user_is_admin()) with check (public.jwt_user_is_admin());

drop policy if exists "coordinators delete admin only" on public.coordinators;
create policy "coordinators delete admin only"
on public.coordinators for delete to authenticated using (public.jwt_user_is_admin());

-- sales_incharges
drop policy if exists "sales_incharges readable by authenticated users" on public.sales_incharges;
create policy "sales_incharges readable by authenticated users"
on public.sales_incharges for select to authenticated using (true);

drop policy if exists "sales_incharges insert admin only" on public.sales_incharges;
create policy "sales_incharges insert admin only"
on public.sales_incharges for insert to authenticated with check (public.jwt_user_is_admin());

drop policy if exists "sales_incharges delete admin only" on public.sales_incharges;
create policy "sales_incharges delete admin only"
on public.sales_incharges for delete to authenticated using (public.jwt_user_is_admin());

-- job sheet columns (from 20260613120000 — re-apply if that migration was skipped)
alter table public.orders add column if not exists sales_incharge_name text;
alter table public.orders add column if not exists size_type text;
alter table public.orders add column if not exists rate_per_piece numeric(12, 2) check (rate_per_piece is null or rate_per_piece >= 0);
alter table public.orders add column if not exists brand text;
alter table public.orders add column if not exists fabric_type text;
alter table public.orders add column if not exists branding boolean;
alter table public.orders add column if not exists branding_type text;
alter table public.orders add column if not exists gsm text;
alter table public.orders add column if not exists atta boolean;
