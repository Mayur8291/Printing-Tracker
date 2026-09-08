-- Backfill helper: orders in the DRR window that still have no sale-order lines.
-- DRR is 0 until these are filled via saleOrder/get.

alter table public.uni_sale_order
  add column if not exists lines_checked_at timestamptz;

create index if not exists uni_sale_order_missing_lines_idx
  on public.uni_sale_order (order_date desc)
  where lines_checked_at is null;

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
  limit greatest(1, least(coalesce(p_limit, 250), 500));
$$;

revoke all on function public.uni_orders_missing_lines(date, integer) from public;
grant execute on function public.uni_orders_missing_lines(date, integer) to service_role;

notify pgrst, 'reload schema';
