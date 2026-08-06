-- Remove legacy DEFAULT facility_code rows from Stock API snapshot.
-- DEFAULT was used when SKUs had no warehouse_id (import backfill / old sync trigger).
-- Partners expect SCOTT_1DAY_01:SKU keys only.

-- 1. Drop orphan zero DEFAULT rows when a real facility row already exists.
delete from public.inventory_facility_stock fs
where fs.facility_code = 'DEFAULT'
  and fs.on_hand_qty = 0
  and fs.reserved_qty = 0
  and exists (
    select 1
    from public.inventory_facility_stock f2
    where f2.sku_id = fs.sku_id
      and f2.facility_code <> 'DEFAULT'
  );

-- 2. Move non-zero DEFAULT stock onto the SKU warehouse facility when mapped.
insert into public.inventory_facility_stock (sku_id, facility_code, on_hand_qty, reserved_qty)
select
  fs.sku_id,
  trim(w.facility_code),
  fs.on_hand_qty,
  fs.reserved_qty
from public.inventory_facility_stock fs
inner join public.inventory_skus s on s.id = fs.sku_id
inner join public.inventory_warehouses w on w.id = s.warehouse_id
where fs.facility_code = 'DEFAULT'
  and nullif(trim(w.facility_code), '') is not null
  and (fs.on_hand_qty > 0 or fs.reserved_qty > 0)
on conflict (sku_id, facility_code) do update
  set on_hand_qty = greatest(public.inventory_facility_stock.on_hand_qty, excluded.on_hand_qty),
      reserved_qty = greatest(public.inventory_facility_stock.reserved_qty, excluded.reserved_qty),
      updated_at = now();

-- 3. Remove remaining DEFAULT rows for SKUs linked to a mapped warehouse.
delete from public.inventory_facility_stock fs
using public.inventory_skus s
inner join public.inventory_warehouses w on w.id = s.warehouse_id
where fs.sku_id = s.id
  and fs.facility_code = 'DEFAULT'
  and nullif(trim(w.facility_code), '') is not null;

-- 4. Remove idle zero DEFAULT rows (no stock, no holds).
delete from public.inventory_facility_stock
where facility_code = 'DEFAULT'
  and on_hand_qty = 0
  and reserved_qty = 0;

-- 5. Stop creating DEFAULT rows when warehouse_id is missing on stock_qty sync.
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
  if coalesce(current_setting('app.skip_facility_sync', true), '') in ('1', 'true') then
    return new;
  end if;

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

  if new.warehouse_id is null then
    return new;
  end if;

  select coalesce(nullif(trim(w.facility_code), ''), nullif(trim(w.id), ''))
  into v_facility
  from public.inventory_warehouses w
  where w.id = new.warehouse_id;

  if v_facility is null then
    return new;
  end if;

  insert into public.inventory_facility_stock (sku_id, facility_code, on_hand_qty, reserved_qty)
  values (new.id, v_facility, greatest(v_delta, 0), 0)
  on conflict (sku_id, facility_code) do update
    set on_hand_qty = greatest(
          public.inventory_facility_stock.reserved_qty,
          greatest(0, public.inventory_facility_stock.on_hand_qty + v_delta)
        ),
        updated_at = now();

  return new;
end;
$$;

comment on function public.sync_facility_stock_from_sku() is
  'Mirror dashboard stock_qty changes into inventory_facility_stock at the SKU warehouse facility only (no DEFAULT bucket).';

notify pgrst, 'reload schema';
