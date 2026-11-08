BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_integrator;
-- Legacy Uniware CreateOrderService records FAILED even on an uncertain create;
-- UpdateUcOrderStatusService later recovers it by reading the existing reference.
-- Dashboard FAILED remains terminal. Recovery is never authorized by a browser,
-- a webhook, an unprepared result, or an unrelated order/provider observation.
CREATE FUNCTION sa_domain.uniware_legacy_failure_recoverable(p_order bigint,p_provider text,p_external_id text,p_external_code text,p_status text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE op sa_domain.warehouse_operations;o sa_snapshot_20261019.sa_orders;proof_ jsonb;expected_ jsonb;observed_ jsonb;prefix_ text;row_ record;sku_ bigint;counts_ jsonb:='{}';qty_ bigint;
BEGIN
 IF p_provider IS DISTINCT FROM 'unicommerce' OR p_order IS DISTINCT FROM sa_domain.integration_order_id()
 OR p_status IS NULL OR p_status NOT IN('PENDING','PROCESSING','COMPLETE','CANCELLED') THEN RETURN false;END IF;
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_order;
 prefix_:=CASE(SELECT environment FROM sa_sync.environment_state) WHEN 'staging' THEN 'S-' WHEN 'production' THEN 'P-' END;
 IF o.id IS NULL OR o.uc_status IS DISTINCT FROM 'FAILED' OR coalesce(o.order_source,'unicommerce')<>'unicommerce'
 OR o.uc_order_id IS DISTINCT FROM p_external_id OR p_external_code IS DISTINCT FROM p_external_id
 OR prefix_ IS NULL OR p_external_id!~('^'||prefix_||o.id||'(-[1-9][0-9]{0,8})?$')
 OR EXISTS(SELECT FROM sa_domain.warehouse_links WHERE order_id=p_order AND status='FAILED') THEN RETURN false;END IF;
 SELECT w.* INTO op FROM sa_domain.integration_context c JOIN sa_domain.outbox j ON j.id=c.job_id
 JOIN sa_domain.warehouse_operations w ON w.job_id=j.id AND w.generation=c.generation
 WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.order_id=p_order
 AND j.event_type='warehouse.order_reconcile' AND j.status='leased' AND j.lease_token=c.lease_token AND j.lease_until>statement_timestamp()
 AND w.prepared_lease_token=c.lease_token AND w.attempted AND w.operation='reconcile' AND w.provider='unicommerce'
 AND w.external_id=p_external_id AND w.external_code=p_external_code AND w.state='ready';
 IF op.id IS NULL OR op.result->>'code' IS DISTINCT FROM 'OBSERVED'
 OR op.result->>'external_id' IS DISTINCT FROM p_external_id OR op.result->>'external_code' IS DISTINCT FROM p_external_code
 OR(CASE op.result->>'status' WHEN 'CREATED' THEN 'PENDING' WHEN 'PENDING_VERIFICATION' THEN 'PENDING' ELSE op.result->>'status' END) IS DISTINCT FROM p_status THEN RETURN false;END IF;
 proof_:=op.proof;
 IF proof_->>'source' IS DISTINCT FROM 'saleorder_get' OR jsonb_typeof(proof_->'items') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF jsonb_array_length(proof_->'items') NOT BETWEEN 1 AND 2000
 OR EXISTS(SELECT FROM jsonb_array_elements(proof_->'items') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
  OR jsonb_typeof(x->'code') IS DISTINCT FROM 'string' OR nullif(btrim(x->>'code'),'') IS NULL
  OR jsonb_typeof(x->'sku_code') IS DISTINCT FROM 'string' OR nullif(btrim(x->>'sku_code'),'') IS NULL
  OR x->>'facility_code' IS DISTINCT FROM op.facility_code OR nullif(btrim(x->>'status'),'') IS NULL)
 OR(SELECT count(DISTINCT x->>'code') FROM jsonb_array_elements(proof_->'items')x)<>jsonb_array_length(proof_->'items') THEN RETURN false;END IF;
 -- Resolve exact original quantity rows through the same source SKU mapping.
 -- An absent/nonpositive quantity or unresolved SKU cannot authorize recovery.
 FOR row_ IN SELECT i.id,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id,q.size_id,sum(q.quantity)::bigint quantity
 FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=i.id
 WHERE i.order_id=p_order AND i.item_type=1 GROUP BY i.id,q.size_id LOOP
  IF row_.quantity IS NULL OR row_.quantity<=0 THEN RETURN false;END IF;
  sku_:=sa_domain.stock_sku(row_.rmp_class_id,row_.rmp_brand_id,row_.rmp_category_id,row_.size_id);
  SELECT name INTO prefix_ FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=sku_;
  IF nullif(btrim(prefix_),'') IS NULL THEN RETURN false;END IF;
  qty_:=coalesce((counts_->>prefix_)::bigint,0)+row_.quantity;
  IF qty_>2000 THEN RETURN false;END IF;counts_:=jsonb_set(counts_,ARRAY[prefix_],to_jsonb(qty_));
 END LOOP;
 IF counts_='{}'::jsonb OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i WHERE i.order_id=p_order AND i.item_type=1 AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=i.id)) THEN RETURN false;END IF;
 SELECT jsonb_object_agg(sku,n) INTO observed_ FROM(SELECT x->>'sku_code' sku,count(*) n FROM jsonb_array_elements(proof_->'items')x GROUP BY 1)s;
 RETURN counts_=observed_;
END $f$;
ALTER FUNCTION sa_domain.uniware_legacy_failure_recoverable(bigint,text,text,text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.uniware_legacy_failure_recoverable(bigint,text,text,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.uniware_legacy_failure_recoverable(bigint,text,text,text,text) TO sa_integrator;
DO $f$ DECLARE d text;old_ text;new_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.warehouse_finish_base(uuid,uuid,jsonb)'::regprocedure);
 old_:=$s$    INSERT INTO sa_domain.integration_context VALUES(pg_backend_pid(),txid_current(),j.id,j.lease_token,op.order_id,g);$s$;
 new_:=$s$    -- Persist the current leased observation before the private status core
    -- examines it. This shares the result transaction and its rollback boundary.
    IF op.provider='unicommerce' AND op.operation='reconcile' THEN
     UPDATE sa_domain.warehouse_operations SET proof=coalesce(p_result->'proof','{}'),result=p_result WHERE id=op.id;
    END IF;
    INSERT INTO sa_domain.integration_context VALUES(pg_backend_pid(),txid_current(),j.id,j.lease_token,op.order_id,g);$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Warehouse finish capability contract changed';END IF;EXECUTE replace(d,old_,new_);
 d:=pg_get_functiondef('sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text)'::regprocedure);
 old_:=$s$IF old_ IN('COMPLETE','CANCELLED','FAILED') AND p_status<>old_ THEN$s$;
 new_:=$s$IF old_ IN('COMPLETE','CANCELLED','FAILED') AND p_status<>old_ AND NOT(old_='FAILED' AND sa_domain.uniware_legacy_failure_recoverable(p_order,p_provider,p_external_id,p_external_code,p_status)) THEN$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Warehouse terminal contract changed';END IF;EXECUTE replace(d,old_,new_);
 d:=pg_get_functiondef('sa_domain.warehouse_reconcile_page(text,bigint,bigint)'::regprocedure);
 old_:=$s$coalesce(uc_status,'') NOT IN('COMPLETE','CANCELLED','FAILED')$s$;
 new_:=$s$(coalesce(uc_status,'') NOT IN('COMPLETE','CANCELLED','FAILED') OR(provider_='unicommerce' AND uc_status='FAILED'))$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Scheduled order eligibility changed';END IF;EXECUTE replace(d,old_,new_);
END $f$;
-- The recovery lane is bounded and indexed without widening terminal Dashboard
-- polling. Original active-order index remains available for its existing lane.
CREATE INDEX squad_warehouse_uniware_failed_poll ON sa_snapshot_20261019.sa_orders(id)
 WHERE deleted_at IS NULL AND is_deleted IS NOT TRUE AND nullif(uc_order_id,'') IS NOT NULL
 AND coalesce(order_source,'unicommerce')='unicommerce' AND uc_status='FAILED';
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_integrator;
NOTIFY pgrst,'reload schema';
COMMIT;
