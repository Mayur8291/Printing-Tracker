-- Dashboard Stock API (Scott International / UniCommerce-style integration)
-- Facility-level stock, reservations, adjustments. Consumed by edge function dashboard-stock-api.

-- Map warehouses to external facility codes (e.g. SCOTT_1DAY_01).
alter table public.inventory_warehouses
  add column if not exists facility_code text;

create unique index if not exists inventory_warehouses_facility_code_idx
  on public.inventory_warehouses (facility_code)
  where facility_code is not null and facility_code <> '';

comment on column public.inventory_warehouses.facility_code is
  'External facility code for Dashboard Stock API (FACILITY:SKU snapshot keys).';

-- Per-facility on-hand and reserved quantities (available = on_hand_qty - reserved_qty).
create table if not exists public.inventory_facility_stock (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.inventory_skus(id) on delete cascade,
  facility_code text not null,
  on_hand_qty numeric(14, 2) not null default 0 check (on_hand_qty >= 0),
  reserved_qty numeric(14, 2) not null default 0 check (reserved_qty >= 0),
  updated_at timestamptz not null default now(),
  unique (sku_id, facility_code),
  check (reserved_qty <= on_hand_qty)
);

create index if not exists inventory_facility_stock_facility_idx
  on public.inventory_facility_stock (facility_code);
create index if not exists inventory_facility_stock_sku_idx
  on public.inventory_facility_stock (sku_id);

-- Backfill from existing SKU rows (warehouse facility_code or warehouse id).
insert into public.inventory_facility_stock (sku_id, facility_code, on_hand_qty, reserved_qty)
select
  s.id,
  coalesce(nullif(trim(w.facility_code), ''), nullif(trim(w.id), ''), 'DEFAULT'),
  coalesce(s.stock_qty, 0),
  0
from public.inventory_skus s
left join public.inventory_warehouses w on w.id = s.warehouse_id
on conflict (sku_id, facility_code) do nothing;

-- Stock reservations (RMP orders from external backend).
create table if not exists public.inventory_stock_reservations (
  id text primary key,
  order_code text not null,
  facility_code text not null,
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'RELEASED', 'FULFILLED')),
  expires_at timestamptz not null,
  release_reason text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  fulfilled_at timestamptz
);

create index if not exists inventory_stock_reservations_order_idx
  on public.inventory_stock_reservations (order_code);
create index if not exists inventory_stock_reservations_status_idx
  on public.inventory_stock_reservations (status);

create table if not exists public.inventory_stock_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id text not null references public.inventory_stock_reservations(id) on delete cascade,
  sku_id uuid not null references public.inventory_skus(id) on delete restrict,
  sku_code text not null,
  item_code text not null default '',
  quantity numeric(14, 2) not null check (quantity > 0)
);

create index if not exists inventory_stock_reservation_items_res_idx
  on public.inventory_stock_reservation_items (reservation_id);

-- Manual adjustments audit log.
create table if not exists public.inventory_stock_adjustments (
  id text primary key,
  facility_code text not null,
  reason text not null,
  applied_at timestamptz not null default now(),
  created_by text default 'dashboard-api'
);

create table if not exists public.inventory_stock_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  adjustment_id text not null references public.inventory_stock_adjustments(id) on delete cascade,
  sku_id uuid not null references public.inventory_skus(id) on delete restrict,
  sku_code text not null,
  delta numeric(14, 2) not null,
  qty_before numeric(14, 2) not null,
  qty_after numeric(14, 2) not null check (qty_after >= 0)
);

-- Webhook outbox (edge worker delivers with HMAC).
create table if not exists public.dashboard_webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists dashboard_webhook_outbox_pending_idx
  on public.dashboard_webhook_outbox (status, created_at)
  where status = 'pending';

-- Helper: available qty for a SKU at facility.
create or replace function public.facility_stock_available(p_sku_id uuid, p_facility_code text)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select greatest(0, fs.on_hand_qty - fs.reserved_qty)
     from public.inventory_facility_stock fs
     where fs.sku_id = p_sku_id and fs.facility_code = p_facility_code),
    0
  );
$$;

-- Resolve sku uuid from sku_code; raises if missing.
create or replace function public.inventory_sku_id_by_code(p_sku_code text)
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.inventory_skus where sku_code = p_sku_code limit 1;
  if v_id is null then
    raise exception 'SKU_NOT_FOUND:%', p_sku_code using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- Enqueue webhook (called from edge function after stock mutations).
create or replace function public.enqueue_dashboard_webhook(p_event_type text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.dashboard_webhook_outbox (event_type, payload)
  values (p_event_type, p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on public.inventory_facility_stock from public;
revoke all on public.inventory_stock_reservations from public;
revoke all on public.inventory_stock_reservation_items from public;
revoke all on public.inventory_stock_adjustments from public;
revoke all on public.inventory_stock_adjustment_items from public;
revoke all on public.dashboard_webhook_outbox from public;

alter table public.inventory_facility_stock enable row level security;
alter table public.inventory_stock_reservations enable row level security;
alter table public.inventory_stock_reservation_items enable row level security;
alter table public.inventory_stock_adjustments enable row level security;
alter table public.inventory_stock_adjustment_items enable row level security;
alter table public.dashboard_webhook_outbox enable row level security;

-- Service role / edge function only (no anon/authenticated policies).
grant select, insert, update, delete on public.inventory_facility_stock to service_role;
grant select, insert, update, delete on public.inventory_stock_reservations to service_role;
grant select, insert, update, delete on public.inventory_stock_reservation_items to service_role;
grant select, insert, update, delete on public.inventory_stock_adjustments to service_role;
grant select, insert, update, delete on public.inventory_stock_adjustment_items to service_role;
grant select, insert, update, delete on public.dashboard_webhook_outbox to service_role;

grant execute on function public.facility_stock_available(uuid, text) to service_role;
grant execute on function public.inventory_sku_id_by_code(text) to service_role;
grant execute on function public.enqueue_dashboard_webhook(text, jsonb) to service_role;
