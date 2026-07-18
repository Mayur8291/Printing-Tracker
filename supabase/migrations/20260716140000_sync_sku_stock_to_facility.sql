-- Keep inventory_facility_stock in sync with dashboard UI stock changes.
-- The UI (PO receive, adjust stock, new SKU) writes inventory_skus.stock_qty only;
-- the Stock API reads inventory_facility_stock, which was backfilled once and then
-- drifted. Service-role writes are skipped because dashboard-stock-api maintains
-- inventory_facility_stock itself (syncing them again would double-count).

create or replace function public.sync_facility_stock_from_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_delta numeric;
  v_facility text;
begin
  v_role := coalesce(v_claims::jsonb ->> 'role', '');
  if v_role = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_delta := coalesce(new.stock_qty, 0);
  else
    v_delta := coalesce(new.stock_qty, 0) - coalesce(old.stock_qty, 0);
  end if;
  if v_delta = 0 then
    return new;
  end if;

  select coalesce(nullif(trim(w.facility_code), ''), nullif(trim(w.id), ''), 'DEFAULT')
  into v_facility
  from public.inventory_warehouses w
  where w.id = new.warehouse_id;

  if v_facility is null then
    v_facility := 'DEFAULT';
  end if;

  insert into public.inventory_facility_stock (sku_id, facility_code, on_hand_qty, reserved_qty)
  values (new.id, v_facility, greatest(v_delta, 0), 0)
  on conflict (sku_id, facility_code) do update
    set on_hand_qty = greatest(
          inventory_facility_stock.reserved_qty,
          greatest(0, inventory_facility_stock.on_hand_qty + v_delta)
        ),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists inventory_skus_sync_facility_stock on public.inventory_skus;
create trigger inventory_skus_sync_facility_stock
after insert or update of stock_qty on public.inventory_skus
for each row
execute function public.sync_facility_stock_from_sku();

-- One-time resync for stock_qty changes made before this trigger existed.
-- Only single-facility SKUs: quantities cannot be attributed across facilities.
-- Clamped to reserved_qty to satisfy check (reserved_qty <= on_hand_qty).
update public.inventory_facility_stock fs
set on_hand_qty = greatest(fs.reserved_qty, coalesce(s.stock_qty, 0)),
    updated_at = now()
from public.inventory_skus s
where s.id = fs.sku_id
  and fs.on_hand_qty <> greatest(fs.reserved_qty, coalesce(s.stock_qty, 0))
  and (
    select count(*)
    from public.inventory_facility_stock f2
    where f2.sku_id = fs.sku_id
  ) = 1;
