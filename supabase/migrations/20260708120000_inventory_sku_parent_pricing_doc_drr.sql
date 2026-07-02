-- Parent style groups, per-SKU pricing fields (retail for all kinds), DOC & DRR metrics.

create table if not exists public.inventory_style_parents (
  id uuid primary key default gen_random_uuid(),
  parent_sku_code text not null unique,
  style_name text not null,
  kind text not null check (kind in ('fabric', 'trim', 'apparel')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_style_parents_kind_idx
  on public.inventory_style_parents (kind);

alter table public.inventory_skus
  add column if not exists parent_style_id uuid
    references public.inventory_style_parents(id) on delete set null;

alter table public.inventory_skus
  add column if not exists doc numeric(14, 2) not null default 0
    check (doc >= 0);

alter table public.inventory_skus
  add column if not exists drr numeric(14, 2) not null default 0
    check (drr >= 0);

create index if not exists inventory_skus_parent_style_idx
  on public.inventory_skus (parent_style_id);

alter table public.inventory_style_parents enable row level security;

drop policy if exists "inventory style parents read" on public.inventory_style_parents;
create policy "inventory style parents read"
on public.inventory_style_parents for select to authenticated using (true);

drop policy if exists "inventory style parents write" on public.inventory_style_parents;
create policy "inventory style parents write"
on public.inventory_style_parents for all to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
);
