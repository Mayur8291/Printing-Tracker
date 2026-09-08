-- Persist Uniware item-type catalog so Sync inventory can resume past PostgREST's
-- 1000-row pages and the edge time budget. Mirror qty still never enter on-hand.

create table if not exists public.uni_item_sku (
  sku_code text primary key,
  name text,
  synced_at timestamptz not null default now()
);

alter table public.uni_item_sku enable row level security;

drop policy if exists "uni_item_sku read authenticated" on public.uni_item_sku;
create policy "uni_item_sku read authenticated"
  on public.uni_item_sku
  for select to authenticated
  using (true);

grant select on public.uni_item_sku to authenticated;

alter table public.uni_settings
  add column if not exists catalog_search_start integer not null default 0,
  add column if not exists catalog_complete boolean not null default false;

notify pgrst, 'reload schema';
