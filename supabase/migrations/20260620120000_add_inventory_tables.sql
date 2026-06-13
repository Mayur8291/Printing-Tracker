-- Inventory: SKUs, suppliers, warehouses, stock movements, alert threshold settings.
-- Alerts are computed in the app when stock_qty < reorder_point (per SKU).
-- Global critical_ratio marks stock below (reorder_point * critical_ratio) as critical.

create table if not exists public.inventory_alert_settings (
  id int primary key default 1 check (id = 1),
  critical_ratio numeric(6, 4) not null default 0.5
    check (critical_ratio > 0 and critical_ratio <= 1),
  low_stock_enabled boolean not null default true,
  out_of_stock_critical boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.inventory_alert_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.inventory_suppliers (
  id text primary key,
  name text not null,
  country text not null default '',
  city text not null default '',
  lead_days integer not null default 0 check (lead_days >= 0),
  rating numeric(3, 1),
  contact text not null default '',
  payment_terms text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_warehouses (
  id text primary key,
  name text not null,
  city text not null default '',
  capacity numeric(14, 2) not null default 0 check (capacity >= 0),
  warehouse_type text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_skus (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null unique,
  kind text not null check (kind in ('fabric', 'trim', 'apparel')),
  name text not null,
  color text not null default '',
  hex_color text not null default '#cccccc',
  stock_qty numeric(14, 2) not null default 0 check (stock_qty >= 0),
  reorder_point numeric(14, 2) not null default 0 check (reorder_point >= 0),
  unit text not null default 'pc',
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  retail_price numeric(14, 4),
  supplier_id text references public.inventory_suppliers(id) on delete set null,
  warehouse_id text references public.inventory_warehouses(id) on delete set null,
  bin_location text not null default '',
  last_received_at date,
  tags text[] not null default '{}',
  extra jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_skus_kind_idx on public.inventory_skus (kind);
create index if not exists inventory_skus_supplier_idx on public.inventory_skus (supplier_id);
create index if not exists inventory_skus_warehouse_idx on public.inventory_skus (warehouse_id);

create table if not exists public.inventory_stock_movements (
  id bigint generated always as identity primary key,
  sku_id uuid not null references public.inventory_skus(id) on delete cascade,
  movement_type text not null check (movement_type in ('IN', 'OUT', 'TRANSFER', 'ADJUST')),
  qty numeric(14, 2) not null,
  reason text not null default '',
  reference text not null default '',
  from_warehouse_id text references public.inventory_warehouses(id) on delete set null,
  to_warehouse_id text references public.inventory_warehouses(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_stock_movements_sku_idx on public.inventory_stock_movements (sku_id, created_at desc);

create or replace function public.inventory_skus_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_skus_updated_at on public.inventory_skus;
create trigger inventory_skus_updated_at
before update on public.inventory_skus
for each row execute function public.inventory_skus_set_updated_at();

alter table public.inventory_alert_settings enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_warehouses enable row level security;
alter table public.inventory_skus enable row level security;
alter table public.inventory_stock_movements enable row level security;

-- Read: any authenticated user (inventory tab visibility handled in app)
drop policy if exists "inventory alert settings read" on public.inventory_alert_settings;
create policy "inventory alert settings read"
on public.inventory_alert_settings for select to authenticated using (true);

drop policy if exists "inventory suppliers read" on public.inventory_suppliers;
create policy "inventory suppliers read"
on public.inventory_suppliers for select to authenticated using (true);

drop policy if exists "inventory warehouses read" on public.inventory_warehouses;
create policy "inventory warehouses read"
on public.inventory_warehouses for select to authenticated using (true);

drop policy if exists "inventory skus read" on public.inventory_skus;
create policy "inventory skus read"
on public.inventory_skus for select to authenticated using (true);

drop policy if exists "inventory movements read" on public.inventory_stock_movements;
create policy "inventory movements read"
on public.inventory_stock_movements for select to authenticated using (true);

-- Write: admin or inventory tab edit permission
drop policy if exists "inventory alert settings write" on public.inventory_alert_settings;
create policy "inventory alert settings write"
on public.inventory_alert_settings for all to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
);

drop policy if exists "inventory suppliers write" on public.inventory_suppliers;
create policy "inventory suppliers write"
on public.inventory_suppliers for all to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
);

drop policy if exists "inventory warehouses write" on public.inventory_warehouses;
create policy "inventory warehouses write"
on public.inventory_warehouses for all to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
);

drop policy if exists "inventory skus write" on public.inventory_skus;
create policy "inventory skus write"
on public.inventory_skus for all to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
);

drop policy if exists "inventory movements write" on public.inventory_stock_movements;
create policy "inventory movements write"
on public.inventory_stock_movements for insert to authenticated
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('inventory')
);

drop policy if exists "inventory movements delete admin" on public.inventory_stock_movements;
create policy "inventory movements delete admin"
on public.inventory_stock_movements for delete to authenticated
using (public.jwt_user_is_admin());
