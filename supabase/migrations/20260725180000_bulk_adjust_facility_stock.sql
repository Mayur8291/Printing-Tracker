-- Batch warehouse stock adjustments for bulk Excel upload (single transaction per batch).

create or replace function public.bulk_adjust_sku_facility_stock(
  p_warehouse_id text,
  p_adjustments jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_applied int := 0;
  v_failed int := 0;
begin
  if p_warehouse_id is null or trim(p_warehouse_id) = '' then
    raise exception 'warehouse_id is required';
  end if;
  if p_adjustments is null or jsonb_typeof(p_adjustments) <> 'array' then
    raise exception 'adjustments must be a JSON array';
  end if;

  for v_item in select value from jsonb_array_elements(p_adjustments) as t(value)
  loop
    if v_item->>'sku_id' is null or v_item->>'target_on_hand' is null then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'sku_id', coalesce(v_item->>'sku_id', ''),
          'ok', false,
          'error', 'sku_id and target_on_hand are required'
        )
      );
      continue;
    end if;

    begin
      v_result := public.adjust_sku_facility_stock(
        (v_item->>'sku_id')::uuid,
        p_warehouse_id,
        (v_item->>'target_on_hand')::numeric,
        coalesce(v_item->>'reason', ''),
        coalesce(v_item->>'reference', ''),
        p_user_id
      );
      v_applied := v_applied + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('sku_id', v_item->>'sku_id', 'ok', true, 'result', v_result)
      );
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('sku_id', v_item->>'sku_id', 'ok', false, 'error', SQLERRM)
      );
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'failed', v_failed, 'results', v_results);
end;
$$;

grant execute on function public.bulk_adjust_sku_facility_stock(text, jsonb, uuid) to authenticated;

comment on function public.bulk_adjust_sku_facility_stock is
  'Apply many facility stock target adjustments for one warehouse in one transaction; used by bulk Excel upload.';

notify pgrst, 'reload schema';
