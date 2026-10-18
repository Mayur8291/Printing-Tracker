-- Exact Uniware sale lines for DRR: facility on the line, sold statuses only.
-- Qty never enter inv_balance / Inventory on-hand.

-- Package-summary rows had no status and inflated Sold. Real saleOrderItems have statusCode.
delete from public.uni_sale_order_line
where coalesce(trim(status), '') = '';

alter table public.uni_sale_order_line
  add column if not exists facility_code text;

create index if not exists uni_sale_order_line_facility_date_idx
  on public.uni_sale_order_line (facility_code, order_date desc);

drop function if exists public.uni_drr_by_sku(date, integer);

create or replace function public.uni_drr_by_sku(p_from date, p_days integer, p_facility text default null)
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
  left join public.uni_sale_order o on o.uni_code = l.uni_code
  where l.order_date >= p_from
    and upper(coalesce(l.status, '')) in (
      'DISPATCHED',
      'DELIVERED',
      'COMPLETE',
      'COMPLETED',
      'SHIPPED',
      'FULFILLED',
      'INVOICED',
      'PACKED',
      'READY_TO_SHIP',
      'PICKING_FOR_INVOICING',
      'PICKED',
      'PICKING',
      'MANIFESTED'
    )
    and (
      p_facility is null
      or nullif(trim(p_facility), '') is null
      or coalesce(l.facility_code, o.facility_code) = p_facility
    )
  group by 1;
$$;

grant execute on function public.uni_drr_by_sku(date, integer, text) to authenticated, service_role;

create or replace function public.uni_orders_missing_lines(p_from date, p_limit integer)
returns table(uni_code text, order_date date, channel text)
language sql
stable
security definer
set search_path = public
as $$
  select o.uni_code, o.order_date, o.channel
  from public.uni_sale_order o
  where o.order_date >= p_from
    and o.lines_checked_at is null
  order by o.order_date desc
  limit greatest(1, least(coalesce(p_limit, 500), 800));
$$;

revoke all on function public.uni_orders_missing_lines(date, integer) from public;
grant execute on function public.uni_orders_missing_lines(date, integer) to service_role;

notify pgrst, 'reload schema';
