-- Batch update SKU pricing / reorder / DOC for bulk Excel upload (single transaction per batch).

create or replace function public.bulk_update_sku_metrics(
  p_updates jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_applied int := 0;
  v_failed int := 0;
  v_sku_id uuid;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'updates must be a JSON array';
  end if;

  for v_item in select value from jsonb_array_elements(p_updates) as t(value)
  loop
    if v_item->>'sku_id' is null then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('sku_id', coalesce(v_item->>'sku_id', ''), 'ok', false, 'error', 'sku_id is required')
      );
      continue;
    end if;

    begin
      v_sku_id := (v_item->>'sku_id')::uuid;

      update public.inventory_skus
      set
        unit_cost = case
          when v_item ? 'unit_cost' then greatest(0, coalesce((v_item->>'unit_cost')::numeric, 0))
          else unit_cost
        end,
        retail_price = case
          when v_item ? 'retail_price' then nullif(greatest(0, coalesce((v_item->>'retail_price')::numeric, 0)), 0)
          else retail_price
        end,
        reorder_point = case
          when v_item ? 'reorder_point' then greatest(0, coalesce((v_item->>'reorder_point')::numeric, 0))
          else reorder_point
        end,
        doc = case
          when v_item ? 'doc' then greatest(0, coalesce((v_item->>'doc')::numeric, 0))
          else doc
        end,
        updated_at = now()
      where id = v_sku_id;

      if not found then
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_array(
          jsonb_build_object('sku_id', v_item->>'sku_id', 'ok', false, 'error', 'SKU not found')
        );
        continue;
      end if;

      v_applied := v_applied + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('sku_id', v_item->>'sku_id', 'ok', true)
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

grant execute on function public.bulk_update_sku_metrics(jsonb, uuid) to authenticated;

comment on function public.bulk_update_sku_metrics is
  'Apply many SKU metric updates (unit cost, sale price, reorder, DOC) in one transaction; used by bulk pricing Excel upload.';

notify pgrst, 'reload schema';
