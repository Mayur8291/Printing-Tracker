-- Warehouse-scoped stock adjustments for dashboard bulk upload and manual adjust.
-- Writes inventory_facility_stock for one facility only, then recomputes inventory_skus.stock_qty
-- as the sum of all facility on_hand rows. Skips the SKU→facility sync trigger on total recompute.

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
  set stock_qty = v_new_total
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

grant execute on function public.adjust_sku_facility_stock(uuid, text, numeric, text, text, uuid) to authenticated;

comment on function public.adjust_sku_facility_stock is
  'Set on-hand qty for one SKU at one warehouse facility; recomputes inventory_skus.stock_qty from all facilities.';

notify pgrst, 'reload schema';
