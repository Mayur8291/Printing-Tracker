BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_media_writer;

-- Reconciliation repairs a derived counter, never receipts or consumption history.
-- Keep the evidence append-only and separate from the legacy stock ledger.
CREATE TABLE sa_domain.stock_reconciliations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid NOT NULL,legacy_user_id bigint,generation bigint NOT NULL,
 dealer_id bigint NOT NULL,receipt_id bigint NOT NULL,command_key uuid NOT NULL,
 before_counter integer,after_counter integer NOT NULL CHECK(after_counter>=0),
 evidence_version text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,command_key,receipt_id)
);
CREATE INDEX squad_stock_reconciliation_dealer ON sa_domain.stock_reconciliations(dealer_id,id DESC);
ALTER TABLE sa_domain.stock_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.stock_reconciliations FORCE ROW LEVEL SECURITY;

CREATE FUNCTION sa_domain.stock_reconciliation_authorized() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT coalesce((c->>'admin')::boolean OR(c->>'platform')::boolean,false) FROM(SELECT sa_domain.ops_context() c)x
$f$;
ALTER FUNCTION sa_domain.stock_reconciliation_authorized() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.stock_reconciliation_authorized() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.stock_reconciliation_authorized() TO sa_guard,sa_media_writer;
GRANT SELECT,INSERT ON sa_domain.stock_reconciliations TO sa_media_writer;
GRANT USAGE ON SEQUENCE sa_domain.stock_reconciliations_id_seq TO sa_media_writer;
CREATE POLICY squad_stock_reconciliation_read ON sa_domain.stock_reconciliations FOR SELECT TO sa_media_writer
 USING((SELECT sa_domain.stock_reconciliation_authorized()));
CREATE POLICY squad_stock_reconciliation_insert ON sa_domain.stock_reconciliations FOR INSERT TO sa_media_writer
 WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND(SELECT sa_domain.stock_reconciliation_authorized()));
CREATE POLICY squad_stock_reconciliation_audit ON sa_domain.audit FOR SELECT TO sa_executor
 USING(kind='stock' AND coalesce(((SELECT sa_domain.ops_context())->>'platform')::boolean,false));
GRANT SELECT(id,user_id,order_id,item_id,size_id,dispatched_quantity),UPDATE(dispatched_quantity,updated_at)
 ON sa_snapshot_20261019.sa_stocks TO sa_media_writer;
CREATE POLICY squad_stock_reconciliation_read ON sa_snapshot_20261019.sa_stocks FOR SELECT TO sa_media_writer
 USING((SELECT sa_domain.stock_reconciliation_authorized()));
CREATE POLICY squad_stock_reconciliation_update ON sa_snapshot_20261019.sa_stocks FOR UPDATE TO sa_media_writer
 USING((SELECT sa_domain.stock_reconciliation_authorized())) WITH CHECK((SELECT sa_domain.stock_reconciliation_authorized()));
GRANT SELECT(created_at,updated_at) ON sa_snapshot_20261019.sa_stocks TO sa_guard;
GRANT SELECT(id,dispatched_quantity_id,created_at,updated_at) ON sa_snapshot_20261019.sa_stock_useds TO sa_guard;
GRANT SELECT(id,quantity_id,job_sheet_dispatched_date_id,dispatched_quantity,created_at,updated_at)
 ON sa_snapshot_20261019.sa_dispatched_quantities TO sa_guard;
GRANT SELECT(id,item_id,dispatched_at) ON sa_snapshot_20261019.sa_job_sheet_dispatched_dates TO sa_guard;
CREATE POLICY squad_guard_stock_dispatch ON sa_snapshot_20261019.sa_dispatched_quantities FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_stock_dispatch ON sa_snapshot_20261019.sa_job_sheet_dispatched_dates FOR SELECT TO sa_guard USING(true);

-- Fixed, private, bounded source projection. All IDs are server-selected after
-- administrator authorization. Source values and dispatch evidence form the
-- optimistic version, so refreshing or editing any dependency invalidates review.
CREATE FUNCTION sa_domain.stock_reconciliation_rows(p_dealer_id bigint,p_ids bigint[]) RETURNS TABLE(id bigint,data jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF coalesce(cardinality(p_ids),0)>100 THEN RAISE EXCEPTION 'Reconciliation page exceeds 100 receipts' USING ERRCODE='22023';END IF;
 RETURN QUERY WITH receipts AS MATERIALIZED(
 SELECT s.id,s.user_id,s.order_id,s.item_id,s.size_id,s.stock_type,s.quantity,s.dispatched_quantity,
 s.product_id,s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id,s.created_at,s.updated_at
 FROM sa_snapshot_20261019.sa_stocks s WHERE s.user_id=p_dealer_id AND s.id=ANY(p_ids)),
 source AS MATERIALIZED(SELECT s.id,i.order_id source_order_id,o.customer_id,owner_.role source_owner_role,o.uc_status,o.assigned_worker_id,
 i.item_type,i.product_id source_product_id,i.rmp_class_id source_class_id,i.rmp_brand_id source_brand_id,i.rmp_category_id source_category_id,
 i.uc_order_status,i.job_worker_status,
 q.quantity source_quantity,q.invalid_quantity,q.completed,q.size_count
 FROM receipts s LEFT JOIN sa_snapshot_20261019.sa_items i ON i.id=s.item_id
 LEFT JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 LEFT JOIN sa_snapshot_20261019.sa_users owner_ ON owner_.id=o.customer_id
 LEFT JOIN LATERAL(SELECT sum(z.quantity)::bigint quantity,bool_or(z.quantity IS NULL OR z.quantity<0) invalid_quantity,
 bool_and(z.dispatched_quantity>=z.quantity) completed,count(*) size_count FROM sa_snapshot_20261019.sa_quantities z
 WHERE z.item_id=s.item_id AND z.size_id=s.size_id)q ON true),
 peers AS MATERIALIZED(SELECT s.id,count(p.id) count_,jsonb_agg(jsonb_build_array(p.id,p.order_id,p.stock_type,p.quantity,p.product_id,p.rmp_class_id,p.rmp_brand_id,p.rmp_category_id) ORDER BY p.id) evidence
 FROM receipts s LEFT JOIN sa_snapshot_20261019.sa_stocks p ON p.user_id=s.user_id AND p.item_id=s.item_id AND p.size_id=s.size_id GROUP BY s.id),
 usage_rows AS MATERIALIZED(SELECT s.id receipt_id,u.id usage_id,u.qty,u.dispatched_quantity_id,count(*) OVER(PARTITION BY s.id,u.dispatched_quantity_id) allocation_count,h.quantity_id,h.job_sheet_dispatched_date_id,h.dispatched_quantity,
 q.size_id dispatch_size,q.item_id dispatch_item_id,d.item_id history_item_id,d.dispatched_at,i.item_type dispatch_type,i.product_id dispatch_product_id,
 i.rmp_class_id dispatch_class_id,i.rmp_brand_id dispatch_brand_id,i.rmp_category_id dispatch_category_id,o.customer_dealer_id,o.customer_id dispatch_customer_id,
 (SELECT sum(a.qty)::bigint FROM sa_snapshot_20261019.sa_stock_useds a WHERE a.dispatched_quantity_id=u.dispatched_quantity_id) allocated
 FROM receipts s JOIN sa_snapshot_20261019.sa_stock_useds u ON u.stock_id=s.id
 LEFT JOIN sa_snapshot_20261019.sa_dispatched_quantities h ON h.id=u.dispatched_quantity_id
 LEFT JOIN sa_snapshot_20261019.sa_quantities q ON q.id=h.quantity_id
 LEFT JOIN sa_snapshot_20261019.sa_job_sheet_dispatched_dates d ON d.id=h.job_sheet_dispatched_date_id
 LEFT JOIN sa_snapshot_20261019.sa_items i ON i.id=q.item_id LEFT JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id),
 keys AS MATERIALIZED(SELECT * FROM sa_domain.stock_product_keys(ARRAY(SELECT product_id FROM receipts WHERE product_id IS NOT NULL
 UNION SELECT source_product_id FROM source WHERE source_product_id IS NOT NULL UNION SELECT dispatch_product_id FROM usage_rows WHERE dispatch_product_id IS NOT NULL))),
 usage_checked AS MATERIALIZED(SELECT u.*,coalesce(u.allocation_count=1 AND u.qty>0 AND u.dispatched_quantity>0 AND u.allocated=u.dispatched_quantity
 AND u.dispatch_size=s.size_id AND u.dispatch_item_id=u.history_item_id AND u.customer_dealer_id=p_dealer_id
 AND u.dispatch_customer_id<>p_dealer_id AND u.dispatched_at>=s.created_at AND
 CASE s.stock_type WHEN 0 THEN u.dispatch_type=1 AND u.dispatch_class_id=s.rmp_class_id AND u.dispatch_brand_id=s.rmp_brand_id AND u.dispatch_category_id IS NOT DISTINCT FROM s.rmp_category_id
 WHEN 1 THEN u.dispatch_type=0 AND k.fingerprint IS NOT NULL AND k.fingerprint=dk.fingerprint ELSE false END,false) valid_
 FROM usage_rows u JOIN receipts s ON s.id=u.receipt_id LEFT JOIN keys k ON k.product_id=s.product_id LEFT JOIN keys dk ON dk.product_id=u.dispatch_product_id),
 consumption AS MATERIALIZED(SELECT u.receipt_id,sum(u.qty)::bigint consumed,count(*) usage_count,bool_and(u.valid_) valid_,
 jsonb_agg(to_jsonb(u) ORDER BY u.usage_id) evidence FROM usage_checked u GROUP BY u.receipt_id),
 balances AS MATERIALIZED(SELECT * FROM sa_domain.stock_balances(p_dealer_id,ARRAY(SELECT DISTINCT size_id FROM receipts))),
 facts AS MATERIALIZED(SELECT s.*,so.source_quantity,coalesce(c.consumed,0) consumed,coalesce(c.usage_count,0) usage_count,
 b.needs_reconciliation group_needs_reconciliation,b.available group_available,
 to_jsonb(so) source_evidence,p.evidence peer_evidence,coalesce(c.evidence,'[]') consumption_evidence,
 array_remove(ARRAY[
 CASE WHEN so.source_order_id IS DISTINCT FROM s.order_id OR so.customer_id IS DISTINCT FROM p_dealer_id OR so.source_owner_role IS DISTINCT FROM 10 OR s.item_id IS NULL OR s.order_id IS NULL THEN 'invalid_origin' END,
 CASE WHEN coalesce(so.size_count,0)=0 OR s.size_id IS NULL THEN 'missing_source_size' END,
 CASE WHEN p.count_>1 THEN 'duplicate_origin' END,
 CASE WHEN s.quantity IS NULL OR s.quantity<0 THEN 'invalid_receipt_quantity' END,
 CASE WHEN so.source_quantity IS DISTINCT FROM s.quantity::bigint OR so.invalid_quantity THEN 'source_quantity_mismatch' END,
 CASE WHEN NOT coalesce(CASE s.stock_type WHEN 0 THEN so.item_type=1 AND s.rmp_class_id IS NOT NULL AND s.rmp_brand_id IS NOT NULL
 AND so.source_class_id=s.rmp_class_id AND so.source_brand_id=s.rmp_brand_id AND so.source_category_id IS NOT DISTINCT FROM s.rmp_category_id
 WHEN 1 THEN so.item_type=0 AND k.fingerprint IS NOT NULL AND k.fingerprint=sk.fingerprint ELSE false END,false) THEN 'source_variant_mismatch' END,
 CASE WHEN so.uc_status='CANCELLED' OR NOT coalesce(CASE so.item_type WHEN 1 THEN so.uc_order_status='COMPLETE'
 WHEN 0 THEN (so.assigned_worker_id IS NOT NULL AND so.job_worker_status=5) OR so.completed ELSE false END,false) THEN 'source_not_completed' END,
 CASE WHEN NOT coalesce(c.valid_,true) THEN 'invalid_consumption_ledger' END,
 CASE WHEN coalesce(c.consumed,0)>s.quantity THEN 'overconsumed' END,
 CASE WHEN coalesce(s.dispatched_quantity,0)<>coalesce(c.consumed,0) THEN 'counter_mismatch' END
 ],NULL) issues
 FROM receipts s JOIN source so ON so.id=s.id JOIN peers p ON p.id=s.id LEFT JOIN consumption c ON c.receipt_id=s.id
 LEFT JOIN keys k ON k.product_id=s.product_id LEFT JOIN keys sk ON sk.product_id=so.source_product_id
 LEFT JOIN balances b ON b.size_id=s.size_id AND b.stock_key=CASE s.stock_type WHEN 0 THEN 'r:'||concat_ws(':',s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id) ELSE 'c:'||coalesce(k.fingerprint,'invalid-'||s.id) END)
 SELECT f.id,jsonb_build_object('id',f.id::text,'dealer_id',p_dealer_id::text,'order_id',f.order_id::text,'item_id',f.item_id::text,'size_id',f.size_id::text,
 'kind',CASE f.stock_type WHEN 0 THEN 'rmp' WHEN 1 THEN 'custom' ELSE 'invalid' END,'received',f.quantity,'source_quantity',f.source_quantity,
 'consumed',f.consumed,'counter',f.dispatched_quantity,'usage_count',f.usage_count,'issues',to_jsonb(f.issues),
 'status',CASE WHEN cardinality(f.issues)>0 OR coalesce(f.group_needs_reconciliation,true) THEN 'needs_reconciliation' ELSE 'ready' END,
 'available',CASE WHEN NOT coalesce(f.group_needs_reconciliation,true) AND cardinality(f.issues)=0 THEN f.group_available END,
 'group_needs_reconciliation',coalesce(f.group_needs_reconciliation,true),
 'safe_action',CASE WHEN f.issues=ARRAY['counter_mismatch']::text[] AND f.consumed BETWEEN 0 AND 2147483647 THEN 'rebuild_counter' ELSE NULL END,
 'version',(SELECT generation::text FROM sa_domain.runtime_state)||':'||encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex')) FROM facts f;
END $f$;
ALTER FUNCTION sa_domain.stock_reconciliation_rows(bigint,bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.stock_reconciliation_rows(bigint,bigint[]) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.stock_reconciliation_rows(bigint,bigint[]) TO sa_media_writer;

CREATE FUNCTION sa_domain.v1_stock_reconciliation(p_dealer_id bigint,p_action text DEFAULT 'review',p_request jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();context_ jsonb;after_ bigint;n int:=sa_domain.page_limit(p_limit);ids_ bigint[];scan_ bigint[];
 r jsonb;rows_ jsonb;x jsonb;row_ jsonb;key_ uuid;cached_ jsonb;reason_ text;lock_id_ bigint;correction_ bigint;result_ jsonb:='[]';generation_ bigint;
BEGIN
 IF NOT sa_domain.stock_reconciliation_authorized() THEN RAISE EXCEPTION 'Stock reconciliation requires administrator' USING ERRCODE='42501';END IF;
 IF p_dealer_id IS NULL OR p_dealer_id<=0 THEN RAISE EXCEPTION 'Dealer is required' USING ERRCODE='22023';END IF;
 -- This command/query facade is VOLATILE. Keep generation/cursor/evidence reads
 -- in one publication epoch even though the review path executes several SQLs.
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 IF p_action='review' THEN
  PERFORM sa_domain.check_fields(p_request,ARRAY['receipt_id','order_id','item_id','size_id']);
  FOR x IN SELECT value FROM jsonb_each(p_request) LOOP PERFORM sa_domain.input_id(x);END LOOP;
  SELECT generation INTO generation_ FROM sa_domain.runtime_state;
  context_:=ctx||jsonb_build_object('resource','stock_reconciliation','dealer_id',p_dealer_id::text,'filters',p_request,'generation',generation_);
  after_:=sa_domain.cursor_id(p_cursor,context_);
  SELECT array_agg(s.id ORDER BY s.id DESC) INTO scan_ FROM(SELECT id FROM sa_snapshot_20261019.sa_stocks
   WHERE user_id=p_dealer_id AND id<after_ AND(NOT p_request?'receipt_id' OR id=(p_request->>'receipt_id')::bigint)
   AND(NOT p_request?'order_id' OR order_id=(p_request->>'order_id')::bigint)
   AND(NOT p_request?'item_id' OR item_id=(p_request->>'item_id')::bigint)
   AND(NOT p_request?'size_id' OR size_id=(p_request->>'size_id')::bigint) ORDER BY id DESC LIMIT n+1)s;
  ids_:=scan_[1:n];SELECT coalesce(jsonb_agg(data ORDER BY id DESC),'[]') INTO rows_ FROM sa_domain.stock_reconciliation_rows(p_dealer_id,ids_);
  RETURN jsonb_build_object('data',rows_,'next_cursor',CASE WHEN cardinality(scan_)>n THEN sa_domain.next_cursor(ids_[n],context_) END,
   'as_of',now(),'data_revision',generation_::text,'dealer_id',p_dealer_id::text,'summary_scope','current_page',
   'requires_review',(SELECT count(*) FROM jsonb_array_elements(rows_) z WHERE z->>'status'='needs_reconciliation'));
 ELSIF p_action='history' THEN
  PERFORM sa_domain.check_fields(p_request,ARRAY['receipt_id']);IF p_request?'receipt_id' THEN PERFORM sa_domain.input_id(p_request->'receipt_id');END IF;
  context_:=ctx||jsonb_build_object('resource','stock_reconciliation_history','dealer_id',p_dealer_id::text,'filters',p_request,'generation',(SELECT generation FROM sa_domain.runtime_state));
  after_:=sa_domain.cursor_id(p_cursor,context_);
  WITH scan AS MATERIALIZED(SELECT h FROM sa_domain.stock_reconciliations h WHERE h.dealer_id=p_dealer_id AND h.id<after_
   AND(NOT p_request?'receipt_id' OR h.receipt_id=(p_request->>'receipt_id')::bigint) ORDER BY h.id DESC LIMIT n+1),
  page AS MATERIALIZED(SELECT h FROM scan ORDER BY(h).id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',(h).id::text,'receipt_id',(h).receipt_id::text,'before',(h).before_counter,
   'after',(h).after_counter,'reason',(h).reason,'generation',(h).generation::text,'created_at',(h).created_at) ORDER BY(h).id DESC),'[]'),
   'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min((h).id),context_) END,'as_of',now()) INTO r FROM page;RETURN r;
 ELSIF p_action='rebuild' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'Repair does not accept a cursor' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.check_fields(p_request,ARRAY['receipts','reason','idempotency_key']);
  IF jsonb_typeof(p_request->'receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'receipts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select 1 through 100 receipts' USING ERRCODE='22023';END IF;
  IF pg_input_is_valid(p_request->>'idempotency_key','uuid') IS NOT TRUE THEN RAISE EXCEPTION 'Idempotency UUID required' USING ERRCODE='22023';END IF;key_:=(p_request->>'idempotency_key')::uuid;
  reason_:=sa_domain.command_reason(p_request->>'reason');
  FOR x IN SELECT value FROM jsonb_array_elements(p_request->'receipts') LOOP
   PERFORM sa_domain.check_fields(x,ARRAY['id','expected_version']);ids_:=array_append(ids_,sa_domain.input_id(x->'id'));
   IF jsonb_typeof(x->'expected_version') IS DISTINCT FROM 'string' OR x->>'expected_version' !~ '^[0-9]+:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Evidence version required' USING ERRCODE='22023';END IF;
  END LOOP;
  IF cardinality(ids_)<>(SELECT count(DISTINCT v) FROM unnest(ids_)v) THEN RAISE EXCEPTION 'Duplicate receipt selection' USING ERRCODE='22023';END IF;
  cached_:=sa_domain.begin_media_command('stock.counter_rebuilt',key_,jsonb_build_object('dealer_id',p_dealer_id,'request',p_request));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
  -- Match existing order -> item -> dealer lock order. Source edits and receipt
  -- creation cannot race the reviewed receipt while the counter is rebuilt.
  FOR lock_id_ IN SELECT DISTINCT order_id FROM sa_snapshot_20261019.sa_stocks WHERE user_id=p_dealer_id AND id=ANY(ids_) AND order_id IS NOT NULL ORDER BY order_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('order:'||lock_id_,784139));
  END LOOP;
  FOR lock_id_ IN SELECT DISTINCT item_id FROM sa_snapshot_20261019.sa_stocks WHERE user_id=p_dealer_id AND id=ANY(ids_) AND item_id IS NOT NULL ORDER BY item_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('item:'||lock_id_,784139));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('dealer-stock:'||p_dealer_id,784139));
  PERFORM 1 FROM sa_snapshot_20261019.sa_stocks WHERE user_id=p_dealer_id AND id=ANY(ids_) ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(data ORDER BY id),'[]') INTO rows_ FROM sa_domain.stock_reconciliation_rows(p_dealer_id,ids_);
  IF jsonb_array_length(rows_)<>cardinality(ids_) THEN RAISE EXCEPTION 'Receipt outside selected dealer' USING ERRCODE='P0002';END IF;
  FOR row_ IN SELECT value FROM jsonb_array_elements(rows_) LOOP
   SELECT value INTO x FROM jsonb_array_elements(p_request->'receipts') WHERE value->>'id'=row_->>'id';
   IF row_->>'version' IS DISTINCT FROM x->>'expected_version' THEN RAISE EXCEPTION 'Stock evidence changed; review again' USING ERRCODE='40001';END IF;
   IF row_->>'safe_action' IS DISTINCT FROM 'rebuild_counter' THEN RAISE EXCEPTION 'Receipt needs source-ledger review; automatic repair is not safe' USING ERRCODE='55000';END IF;
  END LOOP;
  SELECT generation INTO generation_ FROM sa_domain.runtime_state;
  FOR row_ IN SELECT value FROM jsonb_array_elements(rows_) LOOP
   UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=(row_->>'consumed')::integer,updated_at=now() WHERE id=(row_->>'id')::bigint AND user_id=p_dealer_id;
   INSERT INTO sa_domain.stock_reconciliations(actor_id,legacy_user_id,generation,dealer_id,receipt_id,command_key,before_counter,after_counter,evidence_version,reason)
   VALUES((ctx->>'auth_id')::uuid,(ctx->>'legacy_user_id')::bigint,generation_,p_dealer_id,(row_->>'id')::bigint,key_,(row_->>'counter')::integer,(row_->>'consumed')::integer,row_->>'version',reason_) RETURNING id INTO correction_;
   result_:=result_||jsonb_build_array(jsonb_build_object('receipt_id',row_->>'id','correction_id',correction_::text,'before',row_->'counter','after',row_->'consumed'));
  END LOOP;
  r:=jsonb_build_object('dealer_id',p_dealer_id::text,'state','completed','repairs',result_,'data_revision',generation_::text);
  UPDATE sa_domain.commands SET result=r WHERE actor_id=(ctx->>'auth_id')::uuid AND key=key_ AND operation='stock.counter_rebuilt' AND result IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Command not reserved' USING ERRCODE='55000';END IF;
  INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes)
  VALUES((ctx->>'auth_id')::uuid,(ctx->>'legacy_user_id')::bigint,'stock.counter_rebuilt','stock',p_dealer_id,key_,jsonb_build_object('repairs',result_,'reason',reason_,'generation',generation_));
  UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
  RETURN r;
 ELSE RAISE EXCEPTION 'Unknown reconciliation action' USING ERRCODE='22023';END IF;
END $f$;
ALTER FUNCTION sa_domain.v1_stock_reconciliation(bigint,text,jsonb,text,integer) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_stock_reconciliation(bigint,text,jsonb,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_stock_reconciliation(bigint,text,jsonb,text,integer) TO authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.page_limit(integer),sa_domain.cursor_id(text,jsonb),sa_domain.next_cursor(bigint,jsonb),sa_domain.command_reason(text) TO sa_media_writer;
CREATE FUNCTION canto_api.v1_stock_reconciliation(p_dealer_id bigint,p_action text DEFAULT 'review',p_request jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_stock_reconciliation(p_dealer_id,p_action,p_request,p_cursor,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_stock_reconciliation(bigint,text,jsonb,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_stock_reconciliation(bigint,text,jsonb,text,integer) TO authenticated,sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
