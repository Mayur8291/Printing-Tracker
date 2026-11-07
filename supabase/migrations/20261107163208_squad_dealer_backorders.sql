BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_back_order_links TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_back_order_links_id_seq TO sa_executor;
CREATE POLICY squad_backlinks_read ON sa_snapshot_20261019.sa_back_order_links FOR SELECT TO sa_executor USING(order_id IN(SELECT sa_domain.scope_order_ids()));
CREATE POLICY squad_backlinks_insert ON sa_snapshot_20261019.sa_back_order_links FOR INSERT TO sa_executor WITH CHECK(
 (SELECT (sa_domain.actor()).role_id)=10 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o WHERE o.id=order_id AND o.customer_dealer_id=(SELECT (sa_domain.actor()).user_id))
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o WHERE o.id=back_order_id AND o.customer_id=(SELECT (sa_domain.actor()).user_id)));
CREATE INDEX squad_backlinks_original ON sa_snapshot_20261019.sa_back_order_links(order_id,back_order_id);
CREATE TABLE sa_domain.backorder_previews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,generation bigint NOT NULL,
 selected_ids bigint[] NOT NULL,address_id bigint NOT NULL,calculation jsonb NOT NULL,quote_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',accepted jsonb);
ALTER TABLE sa_domain.backorder_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.backorder_previews FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE(accepted) ON sa_domain.backorder_previews TO sa_executor;
CREATE POLICY squad_backorder_preview_owner ON sa_domain.backorder_previews TO sa_executor USING(actor_id=(SELECT (sa_domain.actor()).auth_id)) WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id));
CREATE INDEX squad_backorder_preview_expiry ON sa_domain.backorder_previews(expires_at);

CREATE FUNCTION sa_domain.backorder_calculation(p_order_ids bigint[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);eligible_ bigint[];excluded_ jsonb;rows_ jsonb;versions_ jsonb;lines_ jsonb:='[]';settings_ jsonb:='{}';g record;row_ jsonb;line_ jsonb;selections_ jsonb;sku_ bigint;line_no int:=0;unreconciled_ boolean:=false;
BEGIN
 IF cardinality(p_order_ids) NOT BETWEEN 1 AND 50 OR p_order_ids IS NULL OR array_position(p_order_ids,NULL) IS NOT NULL
 OR (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)<>cardinality(p_order_ids) OR EXISTS(SELECT FROM unnest(p_order_ids) x WHERE x<=0) THEN RAISE EXCEPTION 'Select 1..50 distinct order IDs' USING ERRCODE='22023';END IF;
 IF (SELECT count(*) FROM sa_snapshot_20261019.sa_orders WHERE id=ANY(p_order_ids) AND customer_dealer_id=a.user_id AND customer_id<>a.user_id AND is_deleted IS NOT TRUE AND deleted_at IS NULL)<>cardinality(p_order_ids) THEN
 RAISE EXCEPTION 'Selected customer orders are unavailable' USING ERRCODE='P0002';END IF;
 WITH classified AS(SELECT o.id,CASE WHEN o.status=1 OR o.uc_status='CANCELLED' THEN 'closed'
 WHEN o.back_order_for_id IS NOT NULL OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_back_order_links b WHERE b.order_id=o.id) THEN 'already_linked'
 WHEN o.assigned_to_id IS NOT NULL OR o.assigned_worker_id IS NOT NULL THEN 'assigned_to_production'
 WHEN EXISTS(SELECT FROM sa_domain.order_requests r WHERE r.order_id=o.id AND r.state IN('queued','running')) THEN 'pending_change' END reason
 FROM sa_snapshot_20261019.sa_orders o WHERE o.id=ANY(p_order_ids))
 SELECT coalesce(array_agg(id ORDER BY id) FILTER(WHERE reason IS NULL),'{}'),coalesce(jsonb_agg(jsonb_build_object('order_id',id::text,'reason',reason) ORDER BY id) FILTER(WHERE reason IS NOT NULL),'[]') INTO eligible_,excluded_ FROM classified;
 IF (SELECT count(*) FROM sa_snapshot_20261019.sa_quantities q JOIN sa_snapshot_20261019.sa_items i ON i.id=q.item_id WHERE i.order_id=ANY(eligible_))>500 THEN RAISE EXCEPTION 'At most 500 source size rows per preview; split the selection' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_object_agg(id::text,sa_domain.version('order',id)),'{}') INTO versions_ FROM unnest(eligible_) id;
 WITH items AS MATERIALIZED(SELECT id,item_type,product_id,rmp_class_id,rmp_brand_id,rmp_category_id FROM sa_snapshot_20261019.sa_items WHERE order_id=ANY(eligible_)),
 keys AS MATERIALIZED(SELECT * FROM sa_domain.stock_product_keys(ARRAY(SELECT DISTINCT product_id FROM items WHERE product_id IS NOT NULL))),
 demand AS(SELECT CASE WHEN i.item_type=1 THEN 'r:'||concat_ws(':',i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id) ELSE 'c:'||k.fingerprint END key_,
 i.item_type,q.size_id,min(i.product_id) product_id,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id,
 sum(greatest(0,q.quantity-coalesce(q.dispatched_quantity,0)))::bigint required,
 bool_or(q.quantity IS NULL OR q.quantity<0 OR q.dispatched_quantity<0 OR q.dispatched_quantity>q.quantity OR q.size_id IS NULL OR i.item_type NOT IN(0,1) OR i.item_type IS NULL OR (i.item_type=0 AND k.fingerprint IS NULL)) invalid
 FROM items i JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=i.id LEFT JOIN keys k ON k.product_id=i.product_id
 GROUP BY 1,i.item_type,q.size_id,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id),
 stock AS MATERIALIZED(SELECT * FROM sa_domain.stock_balances(a.user_id))
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',d.key_,'kind',CASE d.item_type WHEN 1 THEN 'rmp' ELSE 'custom' END,'size_id',d.size_id::text,
 'product_id',d.product_id::text,'class_id',d.rmp_class_id::text,'brand_id',d.rmp_brand_id::text,'category_id',d.rmp_category_id::text,
 'required',d.required,'available',CASE WHEN d.invalid OR coalesce(s.needs_reconciliation,false) THEN NULL ELSE coalesce(s.available,0) END,
 'shortage',CASE WHEN d.invalid OR coalesce(s.needs_reconciliation,false) THEN NULL ELSE greatest(0,d.required-coalesce(s.available,0)) END,
 'received',coalesce(s.received,0),'consumed',coalesce(s.consumed,0),'needs_reconciliation',d.invalid OR coalesce(s.needs_reconciliation,false)) ORDER BY d.key_,d.size_id),'[]') INTO rows_
 FROM demand d LEFT JOIN stock s ON s.stock_key=d.key_ AND s.size_id=d.size_id WHERE d.required>0 OR d.invalid;
 unreconciled_:=EXISTS(SELECT FROM jsonb_array_elements(rows_) x WHERE (x->>'needs_reconciliation')::boolean);
 IF NOT unreconciled_ THEN
  FOR g IN SELECT value->>'key' key_,min(value->>'kind') kind,min((value->>'product_id')::bigint) product_id,jsonb_agg(value ORDER BY (value->>'size_id')::bigint) sizes
   FROM jsonb_array_elements(rows_) WHERE (value->>'shortage')::bigint>0 GROUP BY value->>'key' ORDER BY 1 LOOP
   line_no:=line_no+1;selections_:='[]';
   IF line_no>50 THEN RAISE EXCEPTION 'At most 50 product lines per back order' USING ERRCODE='22023';END IF;
   FOR row_ IN SELECT value FROM jsonb_array_elements(g.sizes) LOOP
    IF g.kind='rmp' THEN
     sku_:=sa_domain.stock_sku((row_->>'class_id')::bigint,(row_->>'brand_id')::bigint,(row_->>'category_id')::bigint,(row_->>'size_id')::bigint);
     IF sku_ IS NULL THEN RAISE EXCEPTION 'A required size has no eligible SKU; reconcile the catalogue' USING ERRCODE='55000';END IF;
     selections_:=selections_||jsonb_build_array(jsonb_build_object('sku_id',sku_::text,'quantity',row_->'shortage'));
    ELSE selections_:=selections_||jsonb_build_array(jsonb_build_object('size_id',row_->>'size_id','quantity',row_->'shortage'));END IF;
   END LOOP;
   IF g.kind='rmp' THEN line_:=jsonb_build_object('kind','rmp','skus',selections_);
   ELSE line_:=jsonb_build_object('kind','custom','preset_id',g.product_id::text,'quantities',selections_);settings_:=settings_||jsonb_build_object(line_no::text,jsonb_build_object('product_id',g.product_id::text));END IF;
   lines_:=lines_||jsonb_build_array(line_);
  END LOOP;
 END IF;
 RETURN jsonb_build_object('eligible_order_ids',to_jsonb(ARRAY(SELECT x::text FROM unnest(eligible_) x)),'excluded',excluded_,'order_versions',versions_,
 'requirements',rows_,'lines',lines_,'line_settings',settings_,'status',CASE WHEN unreconciled_ THEN 'needs_reconciliation' WHEN jsonb_array_length(lines_)=0 THEN 'no_shortage' ELSE 'ready' END,
 'stock_reservation','none');
END $f$;

CREATE FUNCTION sa_domain.v1_backorder_preview(p_order_ids bigint[],p_address_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);r jsonb;q jsonb;p sa_domain.backorder_previews%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 PERFORM sa_domain.quote_address(a.user_id,p_address_id);r:=sa_domain.backorder_calculation(p_order_ids);
 IF r->>'status'='ready' THEN q:=sa_domain.v1_quote(jsonb_build_object('customer_id',a.user_id::text,'address_id',p_address_id::text,'lines',r->'lines'));END IF;
 INSERT INTO sa_domain.backorder_previews(actor_id,generation,selected_ids,address_id,calculation,quote_id)
 SELECT a.auth_id,generation,p_order_ids,p_address_id,r,(q->>'quote_id')::uuid FROM sa_domain.runtime_state RETURNING * INTO p;
 RETURN (r-'line_settings'-'order_versions')||jsonb_build_object('preview_id',p.id,'version',p.generation||':0','expires_at',p.expires_at,'quote',q);
END $f$;

CREATE FUNCTION sa_domain.v1_backorder_place(p_preview_id uuid,p_due_at text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);cached jsonb;p sa_domain.backorder_previews%ROWTYPE;current_ jsonb;q sa_domain.quotes%ROWTYPE;r jsonb;o bigint;back_ bigint;linked_ jsonb:='{}';v text;
BEGIN
 cached:=sa_domain.begin_command('backorder.placed',p_idempotency_key,jsonb_build_object('preview',p_preview_id,'due_at',p_due_at,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO p FROM sa_domain.backorder_previews WHERE id=p_preview_id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Back-order preview unavailable' USING ERRCODE='P0002';END IF;
 IF p.generation<>(SELECT generation FROM sa_domain.runtime_state) OR p_expected_version IS DISTINCT FROM p.generation||':0' OR p.accepted IS NOT NULL OR p.expires_at<=now() THEN RAISE EXCEPTION 'Back-order preview expired or already used; refresh it' USING ERRCODE='40001';END IF;
 FOR o IN SELECT unnest(p.selected_ids) ORDER BY 1 LOOP PERFORM sa_domain.lock_order(o,false);END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('dealer-stock:'||a.user_id,784139));
 current_:=sa_domain.backorder_calculation(p.selected_ids);
 IF current_ IS DISTINCT FROM p.calculation THEN RAISE EXCEPTION 'Demand or stock changed; refresh the back-order preview' USING ERRCODE='40001';END IF;
 IF current_->>'status'<>'ready' THEN RAISE EXCEPTION 'Preview has no orderable shortage' USING ERRCODE='55000';END IF;
 SELECT * INTO q FROM sa_domain.quotes WHERE id=p.quote_id;
 r:=sa_domain.v1_order_place(p.quote_id,q.generation||':'||q.revision,jsonb_build_object('due_at',p_due_at,'comment','Back order for linked customer demand','line_settings',p.calculation->'line_settings'),gen_random_uuid());
 IF jsonb_array_length(r->'orders')<>1 THEN RAISE EXCEPTION 'Dealer purchase must have one fulfillment context' USING ERRCODE='55000';END IF;
 back_:=(r->'orders'->0->>'id')::bigint;
 FOR o IN SELECT value::bigint FROM jsonb_array_elements_text(p.calculation->'eligible_order_ids') LOOP
  INSERT INTO sa_snapshot_20261019.sa_back_order_links(order_id,back_order_id,created_at,updated_at) VALUES(o,back_,now(),now());
  v:=sa_domain.bump_version('order',o,sa_domain.version('order',o));linked_:=linked_||jsonb_build_object(o::text,v);
 END LOOP;
 r:=r||jsonb_build_object('preview_id',p.id,'linked_order_versions',linked_,'stock_reservation','none');
 UPDATE sa_domain.backorder_previews SET accepted=r WHERE id=p.id;
 RETURN sa_domain.finish_command('backorder.placed',p_idempotency_key,'order',back_,r,jsonb_build_object('source_ids',p.calculation->'eligible_order_ids','back_order_id',back_::text));
END $f$;

ALTER FUNCTION sa_domain.backorder_calculation(bigint[]) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.backorder_calculation(bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
DO $do$ DECLARE f record;args text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname IN('v1_backorder_preview','v1_backorder_place') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),format('SELECT sa_domain.%I(%s)',f.proname,args));
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
