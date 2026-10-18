-- Inventory Transfer: deduct on-hand at the from-facility and add the same qty
-- at the to-facility in one transaction. Total SKU stock stays the same.
-- Staging first. Does not touch Ops Stock Ledger (inv_movement).

create or replace function public.transfer_sku_facility_stock(
  p_sku_id uuid,
  p_from_warehouse_id text,
  p_to_warehouse_id text,
  p_qty numeric,
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
  v_from_facility text;
  v_to_facility text;
  v_from_id uuid;
  v_to_id uuid;
  v_from_on_hand numeric := 0;
  v_from_reserved numeric := 0;
  v_to_on_hand numeric := 0;
  v_to_reserved numeric := 0;
  v_available numeric;
  v_new_from numeric;
  v_new_to numeric;
  v_new_total numeric;
begin
  if p_sku_id is null or p_from_warehouse_id is null or p_to_warehouse_id is null then
    raise exception 'sku_id, from warehouse, and to warehouse are required';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'From and to warehouses must be different';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Transfer qty must be greater than 0';
  end if;

  perform 1 from public.inventory_skus where id = p_sku_id for update;
  if not found then
    raise exception 'SKU not found';
  end if;

  select coalesce(nullif(trim(w.facility_code), ''), nullif(trim(w.id), ''), 'DEFAULT')
  into v_from_facility
  from public.inventory_warehouses w
  where w.id = p_from_warehouse_id;
  if v_from_facility is null then
    raise exception 'From warehouse not found: %', p_from_warehouse_id;
  end if;

  select coalesce(nullif(trim(w.facility_code), ''), nullif(trim(w.id), ''), 'DEFAULT')
  into v_to_facility
  from public.inventory_warehouses w
  where w.id = p_to_warehouse_id;
  if v_to_facility is null then
    raise exception 'To warehouse not found: %', p_to_warehouse_id;
  end if;

  if v_from_facility = v_to_facility then
    raise exception 'Both warehouses map to the same facility (%). Pick two different facilities.', v_from_facility;
  end if;

  insert into public.inventory_facility_stock (sku_id, facility_code, on_hand_qty, reserved_qty)
  values (p_sku_id, v_to_facility, 0, 0)
  on conflict (sku_id, facility_code) do nothing;

  -- Lock both rows in facility_code order so two transfers cannot deadlock.
  if v_from_facility < v_to_facility then
    select id, on_hand_qty, reserved_qty
    into v_from_id, v_from_on_hand, v_from_reserved
    from public.inventory_facility_stock
    where sku_id = p_sku_id and facility_code = v_from_facility
    for update;
    select id, on_hand_qty, reserved_qty
    into v_to_id, v_to_on_hand, v_to_reserved
    from public.inventory_facility_stock
    where sku_id = p_sku_id and facility_code = v_to_facility
    for update;
  else
    select id, on_hand_qty, reserved_qty
    into v_to_id, v_to_on_hand, v_to_reserved
    from public.inventory_facility_stock
    where sku_id = p_sku_id and facility_code = v_to_facility
    for update;
    select id, on_hand_qty, reserved_qty
    into v_from_id, v_from_on_hand, v_from_reserved
    from public.inventory_facility_stock
    where sku_id = p_sku_id and facility_code = v_from_facility
    for update;
  end if;

  if v_from_id is null then
    raise exception 'No stock at the from warehouse (facility %)', v_from_facility;
  end if;

  v_available := greatest(0, coalesce(v_from_on_hand, 0) - coalesce(v_from_reserved, 0));
  if p_qty > v_available then
    raise exception 'Not enough available stock at from warehouse: have %, need %', v_available, p_qty;
  end if;

  v_new_from := coalesce(v_from_on_hand, 0) - p_qty;
  v_new_to := coalesce(v_to_on_hand, 0) + p_qty;

  update public.inventory_facility_stock
  set on_hand_qty = v_new_from, updated_at = now()
  where id = v_from_id;

  update public.inventory_facility_stock
  set on_hand_qty = v_new_to, updated_at = now()
  where id = v_to_id;

  select coalesce(sum(on_hand_qty), 0)
  into v_new_total
  from public.inventory_facility_stock
  where sku_id = p_sku_id;

  perform set_config('app.skip_facility_sync', '1', true);
  update public.inventory_skus
  set stock_qty = v_new_total
  where id = p_sku_id;

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
    'TRANSFER',
    p_qty,
    coalesce(nullif(trim(p_reason), ''), 'Facility transfer'),
    coalesce(nullif(trim(p_reference), ''), 'FACILITY-TRANSFER'),
    p_from_warehouse_id,
    p_to_warehouse_id,
    p_user_id
  );

  return jsonb_build_object(
    'from_facility', v_from_facility,
    'to_facility', v_to_facility,
    'from_warehouse_id', p_from_warehouse_id,
    'to_warehouse_id', p_to_warehouse_id,
    'qty', p_qty,
    'from_before', coalesce(v_from_on_hand, 0),
    'from_after', v_new_from,
    'to_before', coalesce(v_to_on_hand, 0),
    'to_after', v_new_to,
    'sku_total', v_new_total
  );
end;
$$;

revoke execute on function public.transfer_sku_facility_stock(uuid, text, text, numeric, text, text, uuid) from public, anon;
grant execute on function public.transfer_sku_facility_stock(uuid, text, text, numeric, text, text, uuid) to authenticated, service_role;

comment on function public.transfer_sku_facility_stock is
  'Move on-hand qty from one warehouse facility to another in one transaction. Total SKU stock unchanged.';

notify pgrst, 'reload schema';
