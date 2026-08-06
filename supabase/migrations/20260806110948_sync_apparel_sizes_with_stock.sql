-- Keep apparel extra.sizes in sync with stock_qty when stock changes (bulk upload, facility adjust, API).
-- Fixes UI "Stock by size" showing 0 while On hand shows the real total.

create or replace function public.build_apparel_sizes_for_stock(p_sizes jsonb, p_stock_qty numeric)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_keys text[];
  v_old_sum numeric := 0;
  v_new_sizes jsonb := '{}'::jsonb;
  v_key text;
  v_val numeric;
  v_allocated numeric := 0;
  v_last_key text;
  i int;
begin
  if p_sizes is null or jsonb_typeof(p_sizes) <> 'object' then
    return coalesce(p_sizes, '{}'::jsonb);
  end if;

  select coalesce(array_agg(k order by k), array[]::text[])
  into v_keys
  from jsonb_object_keys(p_sizes) as k;

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return p_sizes;
  end if;

  select coalesce(sum((p_sizes ->> k)::numeric), 0)
  into v_old_sum
  from unnest(v_keys) as u(k);

  if array_length(v_keys, 1) = 1 then
    return jsonb_build_object(v_keys[1], coalesce(p_stock_qty, 0));
  end if;

  if v_old_sum > 0 then
    v_last_key := v_keys[array_length(v_keys, 1)];
    for i in 1 .. array_length(v_keys, 1) - 1 loop
      v_key := v_keys[i];
      v_val := round(((p_sizes ->> v_key)::numeric * coalesce(p_stock_qty, 0) / v_old_sum)::numeric, 2);
      v_new_sizes := v_new_sizes || jsonb_build_object(v_key, v_val);
      v_allocated := v_allocated + v_val;
    end loop;
    v_new_sizes := v_new_sizes || jsonb_build_object(v_last_key, greatest(0, coalesce(p_stock_qty, 0) - v_allocated));
    return v_new_sizes;
  end if;

  -- All size buckets zero (typical flat import SKU): assign total to the first size key.
  return jsonb_build_object(v_keys[1], coalesce(p_stock_qty, 0));
end;
$$;

create or replace function public.sync_apparel_sizes_on_stock_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sizes jsonb;
  v_old_sum numeric := 0;
  v_new_sizes jsonb;
begin
  if new.kind <> 'apparel' then
    return new;
  end if;

  v_sizes := coalesce(new.extra -> 'sizes', '{}'::jsonb);
  if jsonb_typeof(v_sizes) <> 'object' or v_sizes = '{}'::jsonb then
    return new;
  end if;

  select coalesce(sum((value)::numeric), 0)
  into v_old_sum
  from jsonb_each(v_sizes);

  if abs(v_old_sum - coalesce(new.stock_qty, 0)) < 0.01 then
    return new;
  end if;

  v_new_sizes := public.build_apparel_sizes_for_stock(v_sizes, coalesce(new.stock_qty, 0));
  new.extra := jsonb_set(coalesce(new.extra, '{}'::jsonb), '{sizes}', v_new_sizes, true);
  return new;
end;
$$;

drop trigger if exists inventory_skus_sync_apparel_sizes on public.inventory_skus;
create trigger inventory_skus_sync_apparel_sizes
before insert or update of stock_qty on public.inventory_skus
for each row
execute function public.sync_apparel_sizes_on_stock_change();

-- Facility adjust: also assign warehouse when SKU has none (bulk upload UX).
create or replace function public.adjust_sku_facility_stock(
  p_sku_id uuid,
  p_warehouse_id text,
  p_target_on_hand numeric,
  p_reason text default '',
  p_reference text default '',
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facility text;
  v_current_on_hand numeric := 0;
  v_reserved numeric := 0;
  v_new_total numeric;
  v_delta numeric;
  v_row_id uuid;
begin
  if p_sku_id is null or p_warehouse_id is null or p_target_on_hand is null then
    raise exception 'sku_id, warehouse_id, and target_on_hand are required';
  end if;
  if p_target_on_hand < 0 then
    raise exception 'target_on_hand cannot be negative';
  end if;

  select coalesce(nullif(trim(w.facility_code), ''), nullif(trim(w.id), ''), 'DEFAULT')
  into v_facility
  from public.inventory_warehouses w
  where w.id = p_warehouse_id;

  if v_facility is null then
    raise exception 'warehouse not found: %', p_warehouse_id;
  end if;

  select id, on_hand_qty, reserved_qty
  into v_row_id, v_current_on_hand, v_reserved
  from public.inventory_facility_stock
  where sku_id = p_sku_id and facility_code = v_facility;

  if p_target_on_hand < coalesce(v_reserved, 0) then
    raise exception 'target on_hand (%) is below reserved qty (%) at facility %',
      p_target_on_hand, v_reserved, v_facility;
  end if;

  v_delta := p_target_on_hand - coalesce(v_current_on_hand, 0);

  if v_row_id is null then
    insert into public.inventory_facility_stock (sku_id, facility_code, on_hand_qty, reserved_qty)
    values (p_sku_id, v_facility, p_target_on_hand, 0);
  elsif v_delta <> 0 then
    update public.inventory_facility_stock
    set on_hand_qty = p_target_on_hand, updated_at = now()
    where id = v_row_id;
  end if;

  select coalesce(sum(on_hand_qty), 0)
  into v_new_total
  from public.inventory_facility_stock
  where sku_id = p_sku_id;

  perform set_config('app.skip_facility_sync', '1', true);
  update public.inventory_skus
  set stock_qty = v_new_total,
      warehouse_id = coalesce(warehouse_id, p_warehouse_id)
  where id = p_sku_id;

  if v_delta <> 0 then
    insert into public.inventory_stock_movements (
      sku_id,
      movement_type,
      qty,
      reason,
      reference,
      from_warehouse_id,
      to_warehouse_id,
      created_by
    )
    values (
      p_sku_id,
      case when v_delta >= 0 then 'IN' else 'OUT' end,
      v_delta,
      coalesce(nullif(trim(p_reason), ''), 'Facility stock adjust'),
      coalesce(nullif(trim(p_reference), ''), 'FACILITY-ADJ'),
      case when v_delta < 0 then p_warehouse_id else null end,
      case when v_delta >= 0 then p_warehouse_id else null end,
      p_user_id
    );
  end if;

  return jsonb_build_object(
    'facility_code', v_facility,
    'warehouse_id', p_warehouse_id,
    'before', coalesce(v_current_on_hand, 0),
    'after', p_target_on_hand,
    'delta', v_delta,
    'sku_total', v_new_total
  );
end;
$$;

-- Backfill: sizes JSON out of sync with stock_qty.
update public.inventory_skus s
set extra = jsonb_set(
  coalesce(s.extra, '{}'::jsonb),
  '{sizes}',
  public.build_apparel_sizes_for_stock(s.extra -> 'sizes', s.stock_qty),
  true
)
where s.kind = 'apparel'
  and jsonb_typeof(s.extra -> 'sizes') = 'object'
  and s.extra -> 'sizes' <> '{}'::jsonb
  and abs(
    coalesce(
      (select sum((value)::numeric) from jsonb_each_text(s.extra -> 'sizes')),
      0
    ) - coalesce(s.stock_qty, 0)
  ) >= 0.01;

-- Backfill: warehouse_id for SKUs with facility stock but no warehouse link.
update public.inventory_skus s
set warehouse_id = pick.warehouse_id
from (
  select distinct on (fs.sku_id)
    fs.sku_id,
    w.id as warehouse_id
  from public.inventory_facility_stock fs
  inner join public.inventory_warehouses w
    on w.facility_code = fs.facility_code
  where fs.on_hand_qty > 0
  order by fs.sku_id, fs.on_hand_qty desc, w.id
) pick
where s.id = pick.sku_id
  and s.warehouse_id is null;

comment on function public.build_apparel_sizes_for_stock(jsonb, numeric) is
  'Rebuild extra.sizes from stock_qty: single-key SKUs get full total; multi-key scales proportionally.';

comment on function public.sync_apparel_sizes_on_stock_change() is
  'BEFORE trigger: keep apparel extra.sizes sum aligned with stock_qty on insert/update.';

notify pgrst, 'reload schema';
