-- Snapshot sales channel on Ready Stock (scott_orders) so the list and
-- utilization report work without joining admin-only dashboard_channels.

alter table public.scott_orders
  add column if not exists channel_id uuid references public.dashboard_channels(id) on delete set null,
  add column if not exists channel_code text not null default 'UNKNOWN',
  add column if not exists channel_name text not null default 'Unknown',
  add column if not exists channel_type text not null default 'OTHER';

alter table public.scott_orders
  drop constraint if exists scott_orders_channel_type_check;

alter table public.scott_orders
  add constraint scott_orders_channel_type_check
  check (
    channel_type in (
      'CUSTOM',
      'MOBILE_APP',
      'SHOPIFY',
      'AMAZON',
      'FLIPKART',
      'MYNTRA',
      'JIOMART',
      'OTHER'
    )
  );

create index if not exists scott_orders_channel_code_idx
  on public.scott_orders (channel_code);

insert into public.dashboard_channels (code, name, channel_type, enabled, notes)
values
  (
    'UNKNOWN',
    'Unknown',
    'OTHER',
    true,
    'Fallback when Ready Stock create cannot resolve a channel'
  ),
  (
    'SCOTT_APP',
    'Scott App',
    'MOBILE_APP',
    true,
    'Default Scott International app channel'
  )
on conflict (code) do nothing;

update public.scott_orders o
set
  channel_id = c.id,
  channel_code = c.code,
  channel_name = c.name,
  channel_type = c.channel_type
from public.dashboard_channels c
where c.code = 'UNKNOWN'
  and o.channel_id is null
  and o.channel_code = 'UNKNOWN';

comment on column public.scott_orders.channel_code is
  'Snapshot of dashboard_channels.code at order create. Used for Ready Stock list and utilization reports.';

comment on column public.scott_orders.channel_name is
  'Snapshot of dashboard_channels.name at order create.';

comment on column public.scott_orders.channel_type is
  'Snapshot of dashboard_channels.channel_type at order create.';

create or replace view public.rpt_ready_stock_channel_utilization
with (security_invoker = true) as
select
  coalesce(nullif(trim(o.channel_code), ''), 'UNKNOWN') as channel_code,
  coalesce(nullif(trim(o.channel_name), ''), 'Unknown') as channel_name,
  coalesce(nullif(trim(o.channel_type), ''), 'OTHER') as channel_type,
  i.sku_code,
  sum(i.quantity)::numeric as ordered_qty,
  sum(coalesce(i.dispatched_quantity, 0))::numeric as dispatched_qty,
  count(distinct o.id)::int as order_count
from public.scott_orders o
join public.scott_order_items i on i.order_id = o.id
where o.status in ('PENDING', 'PROCESSING', 'COMPLETE')
group by 1, 2, 3, 4;

comment on view public.rpt_ready_stock_channel_utilization is
  'Ready Stock utilization by channel × SKU. Excludes CANCELLED/FAILED. Law 8 report view.';

grant select on public.rpt_ready_stock_channel_utilization to authenticated;

notify pgrst, 'reload schema';
