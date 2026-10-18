-- Uniware full catalog + computed DRR from sale-order lines.
-- Mirror stays read-only. Qty never enter inv_balance / Inventory on-hand.

create table if not exists public.uni_sale_order_line (
  uni_code text not null references public.uni_sale_order (uni_code) on delete cascade,
  line_code text not null,
  sku_code text not null,
  qty numeric(14, 2) not null default 1 check (qty >= 0),
  order_date date,
  channel text,
  status text,
  synced_at timestamptz not null default now(),
  primary key (uni_code, line_code)
);

create index if not exists uni_sale_order_line_sku_date_idx
  on public.uni_sale_order_line (sku_code, order_date desc);

alter table public.uni_sale_order_line enable row level security;

drop policy if exists "uni_sale_order_line read authenticated" on public.uni_sale_order_line;
create policy "uni_sale_order_line read authenticated"
  on public.uni_sale_order_line
  for select to authenticated
  using (true);

grant select on public.uni_sale_order_line to authenticated;

create or replace function public.uni_drr_by_sku(p_from date, p_days integer)
returns table(sku_code text, sold_qty numeric, drr numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    lower(trim(l.sku_code)) as sku_code,
    sum(l.qty) as sold_qty,
    round((sum(l.qty) / greatest(coalesce(p_days, 1), 1))::numeric, 2) as drr
  from public.uni_sale_order_line l
  where l.order_date >= p_from
    and coalesce(upper(l.status), '') not in (
      'CANCELLED', 'CANCELED', 'FAILED', 'UNFULFILLABLE'
    )
  group by 1;
$$;

grant execute on function public.uni_drr_by_sku(date, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
