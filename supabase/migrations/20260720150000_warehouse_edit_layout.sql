-- Warehouse editing support:
-- 1) layout jsonb on inventory_warehouses (zones: [{ name, rows, cols }]) for the
--    warehouse page bin map editor.
-- 2) Propagate facility_code renames everywhere the old code is referenced, so
--    editing it (Edit warehouse modal / Admin Integrations -> Facilities) cannot
--    strand stock rows, open reservations, open Scott orders or channel defaults.
--    The Stock/Order API contract is unchanged — it simply sees the new code.

alter table public.inventory_warehouses
  add column if not exists layout jsonb;

comment on column public.inventory_warehouses.layout is
  'Bin map layout for the warehouse page: { "zones": [{ "name": "A", "rows": 8, "cols": 10 }] }';

create or replace function public.propagate_warehouse_facility_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text := nullif(trim(coalesce(old.facility_code, '')), '');
  v_new text := nullif(trim(coalesce(new.facility_code, '')), '');
begin
  if v_old is null or v_new is null or v_old = v_new then
    return new;
  end if;

  -- Facility stock: merge into existing rows for the new code, then rename the rest.
  update public.inventory_facility_stock target
  set on_hand_qty = target.on_hand_qty + source.on_hand_qty,
      reserved_qty = target.reserved_qty + source.reserved_qty,
      updated_at = now()
  from public.inventory_facility_stock source
  where source.facility_code = v_old
    and target.facility_code = v_new
    and target.sku_id = source.sku_id;

  delete from public.inventory_facility_stock source
  where source.facility_code = v_old
    and exists (
      select 1 from public.inventory_facility_stock target
      where target.facility_code = v_new
        and target.sku_id = source.sku_id
    );

  update public.inventory_facility_stock
  set facility_code = v_new,
      updated_at = now()
  where facility_code = v_old;

  -- Open reservations must keep pointing at rows fulfill/release can find.
  update public.inventory_stock_reservations
  set facility_code = v_new
  where facility_code = v_old
    and status = 'RESERVED';

  -- Open Scott orders (terminal orders keep the historical code).
  update public.scott_orders
  set facility_code = v_new,
      updated_at = now()
  where facility_code = v_old
    and status in ('PENDING', 'PROCESSING');

  -- Channel defaults.
  update public.dashboard_channels
  set default_facility_code = v_new,
      updated_at = now()
  where default_facility_code = v_old;

  return new;
end;
$$;

drop trigger if exists inventory_warehouses_propagate_facility_code on public.inventory_warehouses;
create trigger inventory_warehouses_propagate_facility_code
after update of facility_code on public.inventory_warehouses
for each row
execute function public.propagate_warehouse_facility_code();

notify pgrst, 'reload schema';
