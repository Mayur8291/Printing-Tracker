BEGIN;
DO $f$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_integrator') THEN CREATE ROLE sa_integrator NOLOGIN NOINHERIT NOBYPASSRLS;END IF;END $f$;
GRANT sa_integrator TO postgres;
GRANT USAGE ON SCHEMA sa_domain,sa_snapshot_20261019,sa_sync TO sa_integrator;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_integrator;
CREATE TABLE sa_domain.integration_context(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,job_id uuid NOT NULL REFERENCES sa_domain.outbox,
 lease_token uuid NOT NULL,order_id bigint NOT NULL,generation bigint NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE sa_domain.integration_context ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.integration_context FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON sa_domain.integration_context TO sa_worker;
GRANT SELECT ON sa_domain.integration_context TO sa_guard;
CREATE POLICY integration_context_worker ON sa_domain.integration_context TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY integration_context_guard ON sa_domain.integration_context FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.integration_order_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT c.order_id FROM sa_domain.integration_context c JOIN sa_domain.outbox j ON j.id=c.job_id
 JOIN sa_domain.runtime_state r ON r.singleton AND r.generation=c.generation
 WHERE current_setting('role',true)='service_role' AND nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'
 AND c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.lease_token=j.lease_token AND c.generation=j.generation
 AND j.status='leased' AND j.lease_until>statement_timestamp() AND j.aggregate_kind='order' AND j.aggregate_id=c.order_id
 AND j.event_type IN('warehouse.order','warehouse.webhook','warehouse.order_reconcile')
 AND(sa_domain.warehouse_configuration()->>'ready')::boolean
$f$;
ALTER FUNCTION sa_domain.integration_order_id() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.integration_order_id() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.integration_order_id() TO sa_integrator,sa_guard,sa_worker;
GRANT SELECT ON sa_snapshot_20261019.sa_orders,sa_snapshot_20261019.sa_items,sa_snapshot_20261019.sa_quantities,sa_snapshot_20261019.sa_stocks TO sa_integrator;
GRANT SELECT ON sa_domain.order_requests,sa_domain.runtime_state TO sa_integrator;
CREATE POLICY integration_order_read ON sa_snapshot_20261019.sa_orders FOR SELECT TO sa_integrator USING(id=(SELECT sa_domain.integration_order_id()));
CREATE POLICY integration_item_read ON sa_snapshot_20261019.sa_items FOR SELECT TO sa_integrator USING(order_id=(SELECT sa_domain.integration_order_id()));
CREATE POLICY integration_quantity_read ON sa_snapshot_20261019.sa_quantities FOR SELECT TO sa_integrator USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY integration_stock_read ON sa_snapshot_20261019.sa_stocks FOR SELECT TO sa_integrator USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY integration_request_read ON sa_domain.order_requests FOR SELECT TO sa_integrator USING(order_id=(SELECT sa_domain.integration_order_id()));
CREATE POLICY integration_runtime_read ON sa_domain.runtime_state FOR SELECT TO sa_integrator USING(true);
GRANT UPDATE(uc_order_id,uc_status,order_source,updated_at,status,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity,cutting_status,completed_by_tailor_quantity_status,tailor_job_status,dispatched_status,criteria_status,worker_status,delivered_on) ON sa_snapshot_20261019.sa_orders TO sa_integrator;
GRANT UPDATE(uc_order_status,updated_at) ON sa_snapshot_20261019.sa_items TO sa_integrator;
CREATE POLICY integration_order_write ON sa_snapshot_20261019.sa_orders FOR UPDATE TO sa_integrator USING(id=(SELECT sa_domain.integration_order_id())) WITH CHECK(id=(SELECT sa_domain.integration_order_id()));
CREATE POLICY integration_item_write ON sa_snapshot_20261019.sa_items FOR UPDATE TO sa_integrator USING(order_id=(SELECT sa_domain.integration_order_id())) WITH CHECK(order_id=(SELECT sa_domain.integration_order_id()));
GRANT INSERT,UPDATE(updated_at) ON sa_snapshot_20261019.sa_stocks TO sa_integrator;
CREATE POLICY integration_stock_lock ON sa_snapshot_20261019.sa_stocks FOR UPDATE TO sa_integrator USING(order_id=(SELECT sa_domain.integration_order_id())) WITH CHECK(order_id=(SELECT sa_domain.integration_order_id()));
CREATE POLICY integration_stock_insert ON sa_snapshot_20261019.sa_stocks FOR INSERT TO sa_integrator WITH CHECK(order_id=(SELECT sa_domain.integration_order_id()) AND item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items) AND user_id=sa_domain.stock_order_owner(order_id));
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_stocks_id_seq TO sa_integrator;
GRANT SELECT,INSERT,UPDATE ON sa_domain.entity_versions,sa_domain.warehouse_links TO sa_integrator;
CREATE POLICY integration_versions ON sa_domain.entity_versions TO sa_integrator USING((kind='order' AND entity_id=(SELECT sa_domain.integration_order_id())) OR(kind='item' AND entity_id IN(SELECT id FROM sa_snapshot_20261019.sa_items))) WITH CHECK((kind='order' AND entity_id=(SELECT sa_domain.integration_order_id())) OR(kind='item' AND entity_id IN(SELECT id FROM sa_snapshot_20261019.sa_items)));
CREATE POLICY integration_link ON sa_domain.warehouse_links TO sa_integrator USING(order_id=(SELECT sa_domain.integration_order_id())) WITH CHECK(order_id=(SELECT sa_domain.integration_order_id()));
-- One progress formula remains authoritative. Existing callers still acquire a
-- row through their executor RLS; the public guard wrapper retains can_order.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.order_progress_totals(bigint)'::regprocedure);
 d:=replace(d,'sa_domain.order_progress_totals(', 'sa_domain.order_progress_values(');
 d:=replace(d,$s$ IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;$s$,'');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.recompute_order_progress(bigint)'::regprocedure);d:=replace(d,'sa_domain.order_progress_totals(p_id)','sa_domain.order_progress_values(p_id)');EXECUTE d;
END $f$;
ALTER FUNCTION sa_domain.order_progress_values(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.order_progress_values(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.order_progress_values(bigint) TO sa_executor,sa_integrator;
CREATE OR REPLACE FUNCTION sa_domain.order_progress_totals(p_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;RETURN sa_domain.order_progress_values(p_id);END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.lock_order(bigint,boolean),sa_domain.recompute_order_progress(bigint),sa_domain.stock_order_owner(bigint),sa_domain.stock_item_key(sa_snapshot_20261019.sa_items),sa_domain.stock_sku(bigint,bigint,bigint,bigint),sa_domain.receive_dealer_stock(bigint),sa_domain.version(text,bigint),sa_domain.bump_version(text,bigint,text) TO sa_integrator;
CREATE FUNCTION sa_domain.warehouse_status_apply(p_order bigint,p_provider text,p_external_id text,p_external_code text,p_status text,p_event_at timestamptz,p_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE o sa_snapshot_20261019.sa_orders;l sa_domain.warehouse_links;progress_ jsonb;item_ bigint;received_ integer:=0;r jsonb;v text;old_ text;
BEGIN
 IF p_order IS DISTINCT FROM sa_domain.integration_order_id() THEN RAISE EXCEPTION 'Integration order capability unavailable' USING ERRCODE='42501';END IF;
 IF p_provider IS NULL OR p_provider NOT IN('dashboard','unicommerce') OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 160 OR p_external_code IS NULL OR length(p_external_code) NOT BETWEEN 1 AND 160 OR p_status IS NULL OR p_status NOT IN('PENDING','PROCESSING','COMPLETE','CANCELLED','FAILED') OR p_event_at IS NULL THEN RAISE EXCEPTION 'Invalid provider acknowledgment' USING ERRCODE='22023';END IF;
 o:=sa_domain.lock_order(p_order,false);SELECT * INTO l FROM sa_domain.warehouse_links WHERE order_id=p_order FOR UPDATE;
 IF l.order_id IS NOT NULL AND(l.provider<>p_provider OR l.external_id<>p_external_id) THEN RAISE EXCEPTION 'Provider identity conflict' USING ERRCODE='40001';END IF;
 IF nullif(o.uc_order_id,'') IS NOT NULL AND o.uc_order_id<>p_external_id THEN RAISE EXCEPTION 'Order external reference conflict' USING ERRCODE='40001';END IF;
 IF l.last_event_at IS NOT NULL AND p_event_at<l.last_event_at THEN RETURN jsonb_build_object('state','ignored','reason','OUT_OF_ORDER');END IF;
 old_:=coalesce(o.uc_status,'');
 IF old_ IN('COMPLETE','CANCELLED','FAILED') AND p_status<>old_ THEN RETURN jsonb_build_object('state','quarantined','reason','TERMINAL_CONFLICT');END IF;
 IF old_='PROCESSING' AND p_status='PENDING' THEN RETURN jsonb_build_object('state','ignored','reason','STATUS_REGRESSION');END IF;
 INSERT INTO sa_domain.warehouse_links(order_id,provider,external_id,external_code,generation,status,last_event_at,last_event_id)
 SELECT p_order,p_provider,p_external_id,p_external_code,generation,p_status,p_event_at,p_event_id FROM sa_domain.runtime_state
 ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,last_event_at=excluded.last_event_at,last_event_id=excluded.last_event_id,updated_at=now();
 IF old_=p_status AND o.uc_order_id=p_external_id THEN RETURN jsonb_build_object('state','unchanged','status',p_status);END IF;
 v:=sa_domain.bump_version('order',p_order,sa_domain.version('order',p_order));
 UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id=p_external_id,uc_status=p_status,order_source=p_provider,updated_at=now() WHERE id=p_order;
 UPDATE sa_snapshot_20261019.sa_items SET uc_order_status=p_status,updated_at=now() WHERE order_id=p_order AND item_type=1;
 progress_:=sa_domain.recompute_order_progress(p_order);
 IF p_status='COMPLETE' THEN
  FOR item_ IN SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=p_order AND item_type=1 ORDER BY id LOOP
   r:=sa_domain.receive_dealer_stock(item_);received_:=received_+coalesce((r->>'received')::integer,0);
  END LOOP;
 END IF;
 RETURN jsonb_build_object('state','applied','status',p_status,'previous_status',old_,'version',v,'progress',progress_,'stock_received',received_);
END $f$;
ALTER FUNCTION sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text) OWNER TO sa_integrator;
REVOKE ALL ON FUNCTION sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text) TO sa_worker;

CREATE FUNCTION sa_domain.squad_warehouse_webhook(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;event_ sa_domain.warehouse_receipts;cfg jsonb;g bigint;r jsonb;error_ text;count_ bigint;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();
 IF NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Warehouse ownership inactive' USING ERRCODE='55000';END IF;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.generation<>g OR j.event_type<>'warehouse.webhook' THEN RAISE EXCEPTION 'Webhook lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Webhook lease expired' USING ERRCODE='40001';END IF;
 SELECT * INTO event_ FROM sa_domain.warehouse_receipts WHERE id=(j.payload->>'receipt_id')::uuid AND job_id=j.id FOR UPDATE;
 IF event_.id IS NULL OR event_.generation<>g OR event_.state<>'accepted' OR event_.provider<>cfg->>'provider' THEN RAISE EXCEPTION 'Receipt unavailable' USING ERRCODE='55000';END IF;
 BEGIN
  IF event_.event_type='order.status_changed' THEN
   INSERT INTO sa_domain.integration_context VALUES(pg_backend_pid(),txid_current(),j.id,j.lease_token,event_.order_id,g);
   r:=sa_domain.warehouse_status_apply(event_.order_id,event_.provider,event_.payload->>'dashboard_order_id',event_.payload->>'order_code',event_.payload->>'status',event_.occurred_at,event_.event_id);
   DELETE FROM sa_domain.integration_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  ELSE
   UPDATE sa_domain.warehouse_inventory i SET invalidated_at=greatest(coalesce(invalidated_at,event_.occurred_at),event_.occurred_at)
   WHERE generation=g AND provider=event_.provider AND facility_code=event_.payload->>'facility_code'
   AND sku_id IN(SELECT s.id FROM sa_snapshot_20261019.sa_rmp_skus s WHERE lower(btrim(s.name)) IN(SELECT lower(btrim(value->>'sku_code')) FROM jsonb_array_elements(coalesce(event_.payload->'changed_skus',event_.payload->'low_stock_items'))));
   GET DIAGNOSTICS count_=ROW_COUNT;r:=jsonb_build_object('state','applied','invalidated',count_);
  END IF;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;
  IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;
  r:=jsonb_build_object('state','quarantined','reason',error_);
 END;
 DELETE FROM sa_domain.integration_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 UPDATE sa_domain.warehouse_receipts SET state=CASE WHEN r->>'state'='quarantined' THEN 'quarantined' WHEN r->>'state'='ignored' THEN 'ignored' ELSE 'applied' END,reason=r->>'reason',processed_at=now() WHERE id=event_.id;
 IF r->>'state'='applied' THEN
  UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
  INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation)
  VALUES(j.actor_id,NULL,'warehouse.event_applied',CASE WHEN event_.order_id IS NULL THEN 'integration' ELSE 'order' END,coalesce(event_.order_id,event_.sequence_id),event_.id,r,g);
 END IF;
 UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status='done',result=r,lease_until=NULL,completed_at=now(),revision=revision+1 WHERE id=j.id;
 RETURN jsonb_build_object('state','done','result',r);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_webhook(uuid,uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_webhook(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_webhook(uuid,uuid) TO service_role;
CREATE FUNCTION canto_api.squad_warehouse_webhook(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_warehouse_webhook(p_id,p_lease_token) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_warehouse_webhook(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_warehouse_webhook(uuid,uuid) TO service_role;
DO $f$ DECLARE d text;s text;BEGIN
 SELECT pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure) INTO d;d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event='warehouse.webhook' THEN 'warehouse_webhook' WHEN$s$);EXECUTE d;
 FOREACH s IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP
  SELECT pg_get_functiondef(s::regprocedure) INTO d;d:=replace(d,'''document_render''','''document_render'',''warehouse_webhook''');EXECUTE d;
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_integrator;
NOTIFY pgrst,'reload schema';
COMMIT;
