-- Daily dealer volume entries for Distributor → Dealer Report.

create table if not exists public.dealer_daily_reports (
  id bigint generated always as identity primary key,
  report_date date not null,
  month_key text not null,
  organic_clothing bigint not null default 0 check (organic_clothing >= 0),
  dazzle_export bigint not null default 0 check (dazzle_export >= 0),
  jpm_international bigint not null default 0 check (jpm_international >= 0),
  as_international bigint not null default 0 check (as_international >= 0),
  tshirt_inc bigint not null default 0 check (tshirt_inc >= 0),
  skr_world bigint not null default 0 check (skr_world >= 0),
  corporate_house bigint not null default 0 check (corporate_house >= 0),
  promo_corp bigint not null default 0 check (promo_corp >= 0),
  s_prime_cor bigint not null default 0 check (s_prime_cor >= 0),
  swag_shack bigint not null default 0 check (swag_shack >= 0),
  total bigint not null default 0 check (total >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dealer_daily_reports_report_date_key unique (report_date)
);

create index if not exists dealer_daily_reports_month_key_idx
  on public.dealer_daily_reports (month_key, report_date);

alter table public.dealer_daily_reports enable row level security;

drop policy if exists "dealer daily reports read authenticated" on public.dealer_daily_reports;
create policy "dealer daily reports read authenticated"
on public.dealer_daily_reports
for select
to authenticated
using (true);

drop policy if exists "dealer daily reports insert distributor edit" on public.dealer_daily_reports;
create policy "dealer daily reports insert distributor edit"
on public.dealer_daily_reports
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('distributor')
);

drop policy if exists "dealer daily reports update distributor edit" on public.dealer_daily_reports;
create policy "dealer daily reports update distributor edit"
on public.dealer_daily_reports
for update
to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('distributor')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('distributor')
);

drop policy if exists "dealer daily reports delete admin" on public.dealer_daily_reports;
create policy "dealer daily reports delete admin"
on public.dealer_daily_reports
for delete
to authenticated
using (public.jwt_user_is_admin());

create or replace function public.dealer_daily_reports_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_dealer_daily_reports_updated_at on public.dealer_daily_reports;
create trigger trg_dealer_daily_reports_updated_at
before update on public.dealer_daily_reports
for each row execute function public.dealer_daily_reports_set_updated_at();
