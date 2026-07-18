-- Facility stock read access for the dashboard frontend.
-- 20260710120000 granted service_role only, so authenticated (anon key) reads return [].
-- Read-only: mutations stay with the dashboard-stock-api edge function (service role).

-- 1) SELECT policies + grants for authenticated ------------------------------

drop policy if exists "facility stock authenticated read" on public.inventory_facility_stock;
create policy "facility stock authenticated read"
on public.inventory_facility_stock
for select
to authenticated
using (true);

drop policy if exists "stock reservations authenticated read" on public.inventory_stock_reservations;
create policy "stock reservations authenticated read"
on public.inventory_stock_reservations
for select
to authenticated
using (true);

drop policy if exists "stock reservation items authenticated read" on public.inventory_stock_reservation_items;
create policy "stock reservation items authenticated read"
on public.inventory_stock_reservation_items
for select
to authenticated
using (true);

grant select on public.inventory_facility_stock to authenticated;
grant select on public.inventory_stock_reservations to authenticated;
grant select on public.inventory_stock_reservation_items to authenticated;

-- 2) Per-SKU, per-facility availability view ---------------------------------

create or replace view public.inventory_sku_availability
with (security_invoker = true)
as
select
  fs.sku_id,
  s.sku_code,
  fs.facility_code,
  fs.on_hand_qty,
  fs.reserved_qty,
  greatest(0, fs.on_hand_qty - fs.reserved_qty) as available_qty,
  fs.updated_at
from public.inventory_facility_stock fs
join public.inventory_skus s on s.id = fs.sku_id;

comment on view public.inventory_sku_availability is
  'Per-SKU, per-facility availability (on_hand - reserved). Read-only; source tables mutated by dashboard-stock-api edge function.';

grant select on public.inventory_sku_availability to authenticated;

-- 3) Backfill correction: replace warehouse-id facility codes ----------------
-- Original backfill fell back to the warehouse id (e.g. WH-01) when no
-- facility_code existed yet. Rewrite those rows to the warehouse's real
-- facility_code. Idempotent; guards the unique (sku_id, facility_code) index.

-- 3a) Merge quantities into rows that already use the real facility code.
update public.inventory_facility_stock target
set
  on_hand_qty = target.on_hand_qty + source.on_hand_qty,
  reserved_qty = target.reserved_qty + source.reserved_qty,
  updated_at = now()
from public.inventory_facility_stock source
join public.inventory_warehouses w
  on w.id = source.facility_code
where coalesce(nullif(trim(w.facility_code), ''), '') <> ''
  and w.facility_code <> w.id
  and target.sku_id = source.sku_id
  and target.facility_code = w.facility_code
  and target.id <> source.id;

-- 3b) Drop the merged warehouse-id rows.
delete from public.inventory_facility_stock source
using public.inventory_warehouses w
where w.id = source.facility_code
  and coalesce(nullif(trim(w.facility_code), ''), '') <> ''
  and w.facility_code <> w.id
  and exists (
    select 1
    from public.inventory_facility_stock target
    where target.sku_id = source.sku_id
      and target.facility_code = w.facility_code
      and target.id <> source.id
  );

-- 3c) Rename the remaining warehouse-id rows (no collision possible now).
update public.inventory_facility_stock fs
set facility_code = w.facility_code,
    updated_at = now()
from public.inventory_warehouses w
where w.id = fs.facility_code
  and coalesce(nullif(trim(w.facility_code), ''), '') <> ''
  and w.facility_code <> fs.facility_code;

notify pgrst, 'reload schema';
