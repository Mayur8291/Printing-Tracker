-- Dynamic dealer directory + JSON amounts on daily reports.

create table if not exists public.dealers (
  id bigint generated always as identity primary key,
  name text not null unique,
  dealer_key text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.dealers enable row level security;

drop policy if exists "dealers read authenticated" on public.dealers;
create policy "dealers read authenticated"
on public.dealers for select to authenticated using (true);

drop policy if exists "dealers insert distributor edit" on public.dealers;
create policy "dealers insert distributor edit"
on public.dealers for insert to authenticated
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('distributor')
);

drop policy if exists "dealers update distributor edit" on public.dealers;
create policy "dealers update distributor edit"
on public.dealers for update to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('distributor')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('distributor')
);

drop policy if exists "dealers delete admin" on public.dealers;
create policy "dealers delete admin"
on public.dealers for delete to authenticated using (public.jwt_user_is_admin());

insert into public.dealers (name, dealer_key, sort_order) values
  ('ORGANIC CLOTHING', 'organic_clothing', 1),
  ('DAZZLE EXPORT', 'dazzle_export', 2),
  ('JPM INTERNATIONAL', 'jpm_international', 3),
  ('AS INTERNATIONAL', 'as_international', 4),
  ('T-SHIRT INC', 'tshirt_inc', 5),
  ('SKR WORLD', 'skr_world', 6),
  ('The Corporate House', 'corporate_house', 7),
  ('The Promo Corp', 'promo_corp', 8),
  ('S PRIME COR', 's_prime_cor', 9),
  ('SWAG-SHACK', 'swag_shack', 10)
on conflict (dealer_key) do nothing;

alter table public.dealer_daily_reports
  add column if not exists dealer_amounts jsonb not null default '{}'::jsonb;

update public.dealer_daily_reports
set dealer_amounts = jsonb_strip_nulls(
  jsonb_build_object(
    'organic_clothing', organic_clothing,
    'dazzle_export', dazzle_export,
    'jpm_international', jpm_international,
    'as_international', as_international,
    'tshirt_inc', tshirt_inc,
    'skr_world', skr_world,
    'corporate_house', corporate_house,
    'promo_corp', promo_corp,
    's_prime_cor', s_prime_cor,
    'swag_shack', swag_shack
  )
)
where dealer_amounts = '{}'::jsonb
  and (
    organic_clothing <> 0 or dazzle_export <> 0 or jpm_international <> 0
    or as_international <> 0 or tshirt_inc <> 0 or skr_world <> 0
    or corporate_house <> 0 or promo_corp <> 0 or s_prime_cor <> 0 or swag_shack <> 0
  );

alter table public.dealer_daily_reports drop column if exists organic_clothing;
alter table public.dealer_daily_reports drop column if exists dazzle_export;
alter table public.dealer_daily_reports drop column if exists jpm_international;
alter table public.dealer_daily_reports drop column if exists as_international;
alter table public.dealer_daily_reports drop column if exists tshirt_inc;
alter table public.dealer_daily_reports drop column if exists skr_world;
alter table public.dealer_daily_reports drop column if exists corporate_house;
alter table public.dealer_daily_reports drop column if exists promo_corp;
alter table public.dealer_daily_reports drop column if exists s_prime_cor;
alter table public.dealer_daily_reports drop column if exists swag_shack;
