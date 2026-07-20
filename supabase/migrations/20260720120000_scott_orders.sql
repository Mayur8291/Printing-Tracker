-- Scott International order lifecycle (order-api-requirements.html).
-- External RMP orders managed by the dashboard — separate from the internal
-- printing tracker `orders` table. Consumed by edge function dashboard-stock-api.

create table if not exists public.scott_orders (
  id text primary key,
  order_code text not null,
  facility_code text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'COMPLETE', 'CANCELLED', 'FAILED')),
  due_on timestamptz,
  customer jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  payment jsonb not null default '{}'::jsonb,
  comment text not null default '',
  reservation_id text references public.inventory_stock_reservations(id) on delete set null,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  dispatched_at timestamptz
);

comment on table public.scott_orders is
  'Scott International RMP orders (external order backend). Not the internal printing tracker orders table.';

-- One open order per order_code; re-create allowed after CANCELLED/FAILED.
create unique index if not exists scott_orders_open_order_code_idx
  on public.scott_orders (order_code)
  where status in ('PENDING', 'PROCESSING', 'COMPLETE');

create index if not exists scott_orders_status_idx
  on public.scott_orders (status, created_at desc);

create table if not exists public.scott_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.scott_orders(id) on delete cascade,
  item_code text not null default '',
  sku_code text not null,
  quantity numeric(14, 2) not null check (quantity > 0),
  unit_price numeric(14, 2) not null default 0,
  dispatched_quantity numeric(14, 2) not null default 0
);

create index if not exists scott_order_items_order_idx
  on public.scott_order_items (order_id);

-- Webhook on every status transition, regardless of which code path changed it
-- (edge function today, dashboard UI later). Delivery drains dashboard_webhook_outbox.
create or replace function public.notify_scott_order_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.enqueue_dashboard_webhook(
      'order.status_changed',
      jsonb_build_object(
        'event', 'order.status_changed',
        'event_id', 'evt_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
        'occurred_at', now(),
        'dashboard_order_id', new.id,
        'order_code', new.order_code,
        'previous_status', old.status,
        'status', new.status
      )
      || case
           when new.status = 'COMPLETE' and new.dispatched_at is not null
             then jsonb_build_object('dispatched_at', new.dispatched_at)
           else '{}'::jsonb
         end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists scott_orders_status_changed on public.scott_orders;
create trigger scott_orders_status_changed
after update on public.scott_orders
for each row
execute function public.notify_scott_order_status_changed();

revoke all on public.scott_orders from public;
revoke all on public.scott_order_items from public;

alter table public.scott_orders enable row level security;
alter table public.scott_order_items enable row level security;

-- Mutations via edge function (service role); dashboard users may read.
grant select, insert, update, delete on public.scott_orders to service_role;
grant select, insert, update, delete on public.scott_order_items to service_role;

drop policy if exists "scott orders authenticated read" on public.scott_orders;
create policy "scott orders authenticated read"
on public.scott_orders
for select
to authenticated
using (true);

drop policy if exists "scott order items authenticated read" on public.scott_order_items;
create policy "scott order items authenticated read"
on public.scott_order_items
for select
to authenticated
using (true);

grant select on public.scott_orders to authenticated;
grant select on public.scott_order_items to authenticated;

notify pgrst, 'reload schema';
