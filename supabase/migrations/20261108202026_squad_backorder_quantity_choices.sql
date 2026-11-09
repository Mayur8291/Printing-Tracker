BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
ALTER TABLE sa_domain.backorder_previews ADD COLUMN purchase_quantities jsonb;
-- Procurement quantities are an explicit purchase choice, never a mutation of
-- customer demand. A zero omits a size; extra stock is allowed, as in CreateOrder.
-- Only product/size keys already in the scoped current demand may be selected.
CREATE FUNCTION sa_domain.backorder_purchase_calculation(p_order_ids bigint[],p_quantities jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE r jsonb:=sa_domain.backorder_calculation(p_order_ids);rows_ jsonb;choice_ jsonb;g record;size_ jsonb;selections_ jsonb;lines_ jsonb:='[]';settings_ jsonb:='{}';line_ jsonb;line_no integer:=0;sku_ bigint;
BEGIN
 IF p_quantities IS NULL THEN RETURN r;END IF;
 IF jsonb_typeof(p_quantities)<>'array' OR jsonb_array_length(p_quantities) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Choose 1..500 purchase quantities' USING ERRCODE='22023';END IF;
 IF r->>'status'='needs_reconciliation' THEN RAISE EXCEPTION 'Stock requires reconciliation before quantity changes' USING ERRCODE='55000';END IF;
 FOR choice_ IN SELECT value FROM jsonb_array_elements(p_quantities) LOOP
  IF jsonb_typeof(choice_)<>'object' OR choice_ - ARRAY['key','size_id','quantity'] <> '{}'::jsonb
   OR jsonb_typeof(choice_->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(choice_->'size_id') IS DISTINCT FROM 'string'
   OR choice_->>'size_id' !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(choice_->'quantity') IS DISTINCT FROM 'number'
   OR choice_->>'quantity' !~ '^[0-9]{1,7}$' OR (choice_->>'quantity')::numeric>1000000 THEN RAISE EXCEPTION 'Purchase quantities must be whole numbers from 0 to 1000000' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'requirements') x WHERE x->>'key'=choice_->>'key' AND x->>'size_id'=choice_->>'size_id') THEN
   RAISE EXCEPTION 'Purchase size is not in the selected customer demand' USING ERRCODE='22023';END IF;
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_quantities) x GROUP BY x->>'key',x->>'size_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate purchase size' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(x||jsonb_build_object('purchase_quantity',coalesce(c->'quantity',x->'shortage')) ORDER BY x->>'key',(x->>'size_id')::bigint) INTO rows_
 FROM jsonb_array_elements(r->'requirements') x LEFT JOIN LATERAL(SELECT value c FROM jsonb_array_elements(p_quantities) WHERE value->>'key'=x->>'key' AND value->>'size_id'=x->>'size_id') choices ON true;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(rows_) x WHERE (x->>'purchase_quantity')::bigint>0) THEN RAISE EXCEPTION 'Choose at least one piece to purchase' USING ERRCODE='22023';END IF;
 FOR g IN SELECT value->>'key' key_,min(value->>'kind') kind,min((value->>'product_id')::bigint) product_id,jsonb_agg(value ORDER BY(value->>'size_id')::bigint) sizes
  FROM jsonb_array_elements(rows_) WHERE (value->>'purchase_quantity')::bigint>0 GROUP BY value->>'key' ORDER BY 1 LOOP
  line_no:=line_no+1;selections_:='[]';
  IF line_no>50 THEN RAISE EXCEPTION 'At most 50 product lines per back order' USING ERRCODE='22023';END IF;
  FOR size_ IN SELECT value FROM jsonb_array_elements(g.sizes) LOOP
   IF g.kind='rmp' THEN
    sku_:=sa_domain.stock_sku((size_->>'class_id')::bigint,(size_->>'brand_id')::bigint,(size_->>'category_id')::bigint,(size_->>'size_id')::bigint);
    IF sku_ IS NULL THEN RAISE EXCEPTION 'A purchase size has no eligible SKU; reconcile the catalogue' USING ERRCODE='55000';END IF;
    selections_:=selections_||jsonb_build_array(jsonb_build_object('sku_id',sku_::text,'quantity',size_->'purchase_quantity'));
   ELSE selections_:=selections_||jsonb_build_array(jsonb_build_object('size_id',size_->>'size_id','quantity',size_->'purchase_quantity'));END IF;
  END LOOP;
  IF g.kind='rmp' THEN line_:=jsonb_build_object('kind','rmp','skus',selections_);
  ELSE line_:=jsonb_build_object('kind','custom','preset_id',g.product_id::text,'quantities',selections_);settings_:=settings_||jsonb_build_object(line_no::text,jsonb_build_object('product_id',g.product_id::text));END IF;
  lines_:=lines_||jsonb_build_array(line_);
 END LOOP;
 RETURN r||jsonb_build_object('requirements',rows_,'lines',lines_,'line_settings',settings_,'status','ready','quantity_basis','dealer_purchase_choice');
END $f$;
ALTER FUNCTION sa_domain.backorder_purchase_calculation(bigint[],jsonb) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.backorder_purchase_calculation(bigint[],jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.v1_backorder_preview(p_order_ids bigint[],p_address_id bigint,p_quantities jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);r jsonb;q jsonb;p sa_domain.backorder_previews;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 PERFORM sa_domain.quote_address(a.user_id,p_address_id);r:=sa_domain.backorder_purchase_calculation(p_order_ids,p_quantities);
 IF r->>'status'='ready' THEN q:=sa_domain.v1_quote(jsonb_build_object('customer_id',a.user_id::text,'address_id',p_address_id::text,'lines',r->'lines'));END IF;
 INSERT INTO sa_domain.backorder_previews(actor_id,generation,selected_ids,address_id,calculation,quote_id,purchase_quantities)
 SELECT a.auth_id,generation,p_order_ids,p_address_id,r,(q->>'quote_id')::uuid,p_quantities FROM sa_domain.runtime_state RETURNING * INTO p;
 RETURN(r-'line_settings'-'order_versions')||jsonb_build_object('preview_id',p.id,'version',p.generation||':0','expires_at',p.expires_at,'quote',q);
END $f$;
ALTER FUNCTION sa_domain.v1_backorder_preview(bigint[],bigint,jsonb) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_backorder_preview(bigint[],bigint,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_backorder_preview(bigint[],bigint,jsonb) TO sa_app;
CREATE FUNCTION canto_api.v1_backorder_preview(p_order_ids bigint[],p_address_id bigint,p_quantities jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$SELECT sa_domain.v1_backorder_preview(p_order_ids,p_address_id,p_quantities)$f$;
REVOKE ALL ON FUNCTION canto_api.v1_backorder_preview(bigint[],bigint,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_backorder_preview(bigint[],bigint,jsonb) TO sa_app;
DO $patch$DECLARE d text;needle_ text:='current_:=sa_domain.backorder_calculation(p.selected_ids);';BEGIN
 d:=pg_get_functiondef('sa_domain.v1_backorder_place(uuid,text,text,uuid)'::regprocedure);
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected locked backorder recheck missing';END IF;
 d:=replace(d,needle_,'current_:=sa_domain.backorder_purchase_calculation(p.selected_ids,p.purchase_quantities);');EXECUTE d;
END $patch$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
