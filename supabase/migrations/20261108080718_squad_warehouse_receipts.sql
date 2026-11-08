BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_media_writer;
GRANT SELECT(key,value) ON sa_snapshot_20261019.sa_settings TO sa_guard;
CREATE POLICY warehouse_selected_provider ON sa_snapshot_20261019.sa_settings FOR SELECT TO sa_guard USING(key='use_dashboard');
CREATE TABLE sa_domain.warehouse_config(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),provider text NOT NULL CHECK(provider IN('dashboard','unicommerce')),
 environment text NOT NULL CHECK(environment IN('staging','production')),project_ref text NOT NULL,
 one_day_facility text,three_day_facility text,enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),CHECK(one_day_facility IS NULL OR length(one_day_facility) BETWEEN 1 AND 100),
 CHECK(three_day_facility IS NULL OR length(three_day_facility) BETWEEN 1 AND 100)
);
INSERT INTO sa_domain.warehouse_config(singleton,provider,environment,project_ref)
 SELECT true,CASE WHEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_settings WHERE key='use_dashboard' AND value='true') THEN 'dashboard' ELSE 'unicommerce' END,
 environment,CASE environment WHEN 'staging' THEN 'scvojtvgnkmbupvyslmb' ELSE 'levwrmvqdntngeasrtnb' END FROM sa_sync.environment_state;
CREATE TABLE sa_domain.warehouse_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 provider text NOT NULL,event_id text NOT NULL,event_type text NOT NULL,occurred_at timestamptz NOT NULL,
 body_sha256 text NOT NULL,payload jsonb NOT NULL,generation bigint NOT NULL,environment text NOT NULL,
 state text NOT NULL CHECK(state IN('accepted','ignored','quarantined','applied','failed')),reason text,
 order_id bigint,job_id uuid REFERENCES sa_domain.outbox,received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,
 UNIQUE(provider,event_id),CHECK(octet_length(payload::text)<=300000),CHECK(body_sha256~'^[a-f0-9]{64}$')
);
CREATE INDEX squad_warehouse_receipt_order ON sa_domain.warehouse_receipts(order_id,occurred_at DESC) WHERE order_id IS NOT NULL;
CREATE INDEX squad_warehouse_receipt_state ON sa_domain.warehouse_receipts(state,sequence_id DESC);
CREATE TABLE sa_domain.warehouse_links(
 order_id bigint PRIMARY KEY,provider text NOT NULL,external_id text NOT NULL,external_code text NOT NULL,
 generation bigint NOT NULL,status text,last_event_at timestamptz,last_event_id text,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,external_id),UNIQUE(provider,external_code)
);
CREATE TABLE sa_domain.warehouse_inventory(
 generation bigint NOT NULL,provider text NOT NULL,facility_code text NOT NULL,sku_id bigint NOT NULL,
 available numeric NOT NULL,as_of timestamptz NOT NULL,invalidated_at timestamptz,
 PRIMARY KEY(generation,provider,facility_code,sku_id),CHECK(available BETWEEN -1000000000000 AND 1000000000000)
);
CREATE TABLE sa_domain.warehouse_reconciliations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,actor_id uuid NOT NULL,
 generation bigint NOT NULL,provider text NOT NULL,scope text NOT NULL CHECK(scope IN('orders','inventory','all')),cursor_id bigint NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','completed','failed','expired')),job_id uuid REFERENCES sa_domain.outbox,
 processed bigint NOT NULL DEFAULT 0,changed bigint NOT NULL DEFAULT 0,errors bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,result jsonb NOT NULL DEFAULT '{}'
);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_config','warehouse_receipts','warehouse_links','warehouse_inventory','warehouse_reconciliations'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_guard,sa_worker',t);
  EXECUTE format('CREATE POLICY warehouse_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
  EXECUTE format('CREATE POLICY warehouse_worker ON sa_domain.%I TO sa_worker USING(true) WITH CHECK(true)',t);
 END LOOP;
END $f$;
GRANT INSERT,UPDATE ON sa_domain.warehouse_receipts,sa_domain.warehouse_links,sa_domain.warehouse_inventory,sa_domain.warehouse_reconciliations TO sa_worker;
GRANT USAGE ON SEQUENCE sa_domain.warehouse_receipts_sequence_id_seq,sa_domain.warehouse_reconciliations_sequence_id_seq TO sa_worker;
GRANT SELECT,INSERT,UPDATE(job_id) ON sa_domain.warehouse_reconciliations TO sa_media_writer;
GRANT USAGE ON SEQUENCE sa_domain.warehouse_reconciliations_sequence_id_seq TO sa_media_writer;
CREATE POLICY warehouse_reconcile_owner ON sa_domain.warehouse_reconciliations TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
GRANT INSERT ON sa_domain.outbox TO sa_worker;
CREATE POLICY warehouse_reconcile_queue_read ON sa_domain.outbox FOR SELECT TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND event_type='warehouse.reconcile');
CREATE UNIQUE INDEX warehouse_one_active_reconciliation ON sa_domain.warehouse_reconciliations(generation,provider) WHERE state IN('queued','running');

CREATE FUNCTION sa_domain.warehouse_configuration() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cfg sa_domain.warehouse_config;epoch_ jsonb;selected_ text;
BEGIN
 SELECT * INTO cfg FROM sa_domain.warehouse_config WHERE singleton;
 SELECT CASE WHEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_settings WHERE key='use_dashboard' AND value='true') THEN 'dashboard' ELSE 'unicommerce' END INTO selected_;
 epoch_:=sa_domain.ownership_epoch();
 RETURN jsonb_build_object('provider',cfg.provider,'selected_provider',selected_,'environment',cfg.environment,'project_ref',cfg.project_ref,
 'one_day_facility',cfg.one_day_facility,'three_day_facility',cfg.three_day_facility,'generation',epoch_->>'generation','activated_at',epoch_->>'activated_at',
 'ready',cfg.enabled AND cfg.provider=selected_ AND cfg.environment=epoch_->>'environment' AND epoch_->>'activated_at' IS NOT NULL AND cfg.one_day_facility IS NOT NULL AND cfg.three_day_facility IS NOT NULL);
END $f$;
ALTER FUNCTION sa_domain.warehouse_configuration() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_configuration() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_configuration() TO sa_worker,sa_media_writer;

CREATE FUNCTION sa_domain.warehouse_order_reference(p_external_id text,p_code text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN count(*)=1 THEN min(id) END FROM sa_snapshot_20261019.sa_orders
 WHERE order_source='dashboard' AND uc_order_id=p_external_id AND is_deleted IS NOT TRUE AND deleted_at IS NULL
 AND p_code=(CASE(SELECT environment FROM sa_sync.environment_state) WHEN 'staging' THEN 'S-' ELSE 'P-' END)||id::text
$f$;
ALTER FUNCTION sa_domain.warehouse_order_reference(text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_order_reference(text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_order_reference(text,text) TO sa_worker;

CREATE FUNCTION sa_domain.squad_webhook_accept(p_provider text,p_event_id text,p_event_type text,p_occurred_at timestamptz,p_payload jsonb,p_body_sha256 text,p_project_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cfg jsonb;old_ sa_domain.warehouse_receipts;r sa_domain.warehouse_receipts;state_ text:='accepted';reason_ text;order_ bigint;job_ uuid;g bigint;facility_ text;rows_ jsonb;item_ jsonb;field_ text;number_ numeric;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_provider IS DISTINCT FROM 'dashboard' OR p_event_id IS NULL OR p_event_id!~'^evt_([a-f0-9]{12}|[a-f0-9]{32})$' OR p_event_type IS NULL OR p_event_type NOT IN('order.status_changed','stock.level_changed','stock.low_threshold')
 OR p_body_sha256 IS NULL OR p_body_sha256!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>300000
 OR p_payload->>'event_id' IS DISTINCT FROM p_event_id OR p_payload->>'event' IS DISTINCT FROM p_event_type OR p_occurred_at IS NULL OR p_occurred_at>statement_timestamp()+interval '5 minutes' OR p_occurred_at<'2000-01-01' THEN RAISE EXCEPTION 'Invalid webhook envelope' USING ERRCODE='22023';END IF;
 IF NOT pg_input_is_valid(p_payload->>'occurred_at','timestamptz') OR(p_payload->>'occurred_at')::timestamptz IS DISTINCT FROM p_occurred_at THEN RAISE EXCEPTION 'Webhook timestamp mismatch' USING ERRCODE='22023';END IF;
 cfg:=sa_domain.warehouse_configuration();
 IF p_project_ref IS DISTINCT FROM cfg->>'project_ref' OR cfg->>'environment' IS DISTINCT FROM(SELECT environment FROM sa_sync.environment_state) THEN RAISE EXCEPTION 'Webhook environment mismatch' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('warehouse-event:'||p_provider||':'||p_event_id,784146));
 SELECT * INTO old_ FROM sa_domain.warehouse_receipts WHERE provider=p_provider AND event_id=p_event_id;
 IF old_.id IS NOT NULL THEN
  IF old_.body_sha256<>p_body_sha256 THEN RAISE EXCEPTION 'Webhook identity reused with different body' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('receipt_id',old_.id,'state','duplicate');
 END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh active' USING ERRCODE='55000';END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 IF EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) OR NOT coalesce((cfg->>'ready')::boolean,false) THEN state_:='quarantined';reason_:='OWNERSHIP_NOT_ACTIVE';
 ELSIF cfg->>'provider'<>p_provider THEN state_:='quarantined';reason_:='PROVIDER_NOT_SELECTED';
 ELSIF p_occurred_at<(cfg->>'activated_at')::timestamptz THEN state_:='ignored';reason_:='BEFORE_OWNERSHIP';END IF;
 IF p_event_type='order.status_changed' THEN
  PERFORM sa_domain.check_fields(p_payload,ARRAY['event','event_id','occurred_at','dashboard_order_id','order_code','previous_status','status','dispatched_at']);
  IF p_payload->>'dashboard_order_id' IS NULL OR p_payload->>'dashboard_order_id'!~'^ord_[a-zA-Z0-9_-]{1,100}$' OR p_payload->>'order_code' IS NULL OR length(p_payload->>'order_code') NOT BETWEEN 1 AND 120 OR p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN('CREATED','PENDING','PROCESSING','COMPLETE','CANCELLED','FAILED') THEN RAISE EXCEPTION 'Invalid warehouse order status' USING ERRCODE='22023';END IF;
  IF p_payload->>'previous_status' IS NOT NULL AND p_payload->>'previous_status' NOT IN('CREATED','PENDING','PROCESSING','COMPLETE','CANCELLED','FAILED') OR(p_payload->>'status'='CREATED' AND p_payload->>'previous_status' IS NOT NULL) THEN RAISE EXCEPTION 'Invalid previous status' USING ERRCODE='22023';END IF;
  IF p_payload?'dispatched_at' AND(p_payload->>'status'<>'COMPLETE' OR pg_input_is_valid(p_payload->>'dispatched_at','timestamptz') IS NOT TRUE) THEN RAISE EXCEPTION 'Invalid dispatch timestamp' USING ERRCODE='22023';END IF;
  order_:=sa_domain.warehouse_order_reference(p_payload->>'dashboard_order_id',p_payload->>'order_code');
  IF p_payload->>'status'='CREATED' THEN state_:='ignored';reason_:='CREATE_ACKNOWLEDGEMENT';
  ELSIF order_ IS NULL THEN state_:='quarantined';reason_:='ORDER_REFERENCE_UNRESOLVED';END IF;
 ELSE
  PERFORM sa_domain.check_fields(p_payload,CASE WHEN p_event_type='stock.level_changed' THEN ARRAY['event','event_id','occurred_at','facility_code','trigger','changed_skus'] ELSE ARRAY['event','event_id','occurred_at','facility_code','low_stock_items'] END);
  facility_:=p_payload->>'facility_code';rows_:=CASE WHEN p_event_type='stock.level_changed' THEN p_payload->'changed_skus' ELSE p_payload->'low_stock_items' END;
  IF facility_ IS NULL OR length(facility_) NOT BETWEEN 1 AND 100 OR jsonb_typeof(rows_) IS DISTINCT FROM 'array' OR jsonb_array_length(rows_) NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'Invalid stock event' USING ERRCODE='22023';END IF;
  IF p_event_type='stock.level_changed' AND(p_payload->>'trigger' IS NULL OR p_payload->>'trigger' NOT IN('RESERVATION','RELEASE','FULFILLMENT','ADJUST')) THEN RAISE EXCEPTION 'Invalid stock trigger' USING ERRCODE='22023';END IF;
  FOR item_ IN SELECT value FROM jsonb_array_elements(rows_) LOOP
   PERFORM sa_domain.check_fields(item_,CASE WHEN p_event_type='stock.level_changed' THEN ARRAY['sku_code','previous_stock','current_stock'] ELSE ARRAY['sku_code','available','threshold'] END);
   IF jsonb_typeof(item_->'sku_code') IS DISTINCT FROM 'string' OR length(btrim(item_->>'sku_code')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid SKU' USING ERRCODE='22023';END IF;
   FOREACH field_ IN ARRAY CASE WHEN p_event_type='stock.level_changed' THEN ARRAY['previous_stock','current_stock'] ELSE ARRAY['available','threshold'] END LOOP
    IF jsonb_typeof(item_->field_) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Stock number required' USING ERRCODE='22023';END IF;
    number_:=sa_domain.input_number(item_->field_,CASE WHEN field_='threshold' THEN 0 ELSE -1000000000000 END,1000000000000);
    IF number_*100<>trunc(number_*100) THEN RAISE EXCEPTION 'Stock precision exceeds two decimal places' USING ERRCODE='22023';END IF;
   END LOOP;
  END LOOP;
  IF(SELECT count(DISTINCT lower(btrim(value->>'sku_code'))) FROM jsonb_array_elements(rows_))<>jsonb_array_length(rows_) THEN RAISE EXCEPTION 'Duplicate SKU' USING ERRCODE='22023';END IF;
  IF facility_ IS DISTINCT FROM cfg->>'one_day_facility' AND facility_ IS DISTINCT FROM cfg->>'three_day_facility' THEN state_:='quarantined';reason_:='FACILITY_NOT_BOUND';END IF;
 END IF;
 INSERT INTO sa_domain.warehouse_receipts(provider,event_id,event_type,occurred_at,body_sha256,payload,generation,environment,state,reason,order_id)
 VALUES(p_provider,p_event_id,p_event_type,p_occurred_at,p_body_sha256,p_payload,g,cfg->>'environment',state_,reason_,order_) RETURNING * INTO r;
 IF state_='accepted' THEN
  INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES('00000000-0000-0000-0000-000000000001','warehouse.webhook',CASE WHEN order_ IS NULL THEN 'integration' ELSE 'order' END,coalesce(order_,r.sequence_id),r.id,g,jsonb_build_object('receipt_id',r.id)) RETURNING id INTO job_;
  UPDATE sa_domain.warehouse_receipts SET job_id=job_ WHERE id=r.id;
 END IF;
 RETURN jsonb_build_object('receipt_id',r.id,'state',state_);
END $f$;
ALTER FUNCTION sa_domain.squad_webhook_accept(text,text,text,timestamptz,jsonb,text,text) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_webhook_accept(text,text,text,timestamptz,jsonb,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_webhook_accept(text,text,text,timestamptz,jsonb,text,text) TO service_role;
CREATE FUNCTION canto_api.squad_webhook_accept(p_provider text,p_event_id text,p_event_type text,p_occurred_at timestamptz,p_payload jsonb,p_body_sha256 text,p_project_ref text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_webhook_accept(p_provider,p_event_id,p_event_type,p_occurred_at,p_payload,p_body_sha256,p_project_ref) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_webhook_accept(text,text,text,timestamptz,jsonb,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_webhook_accept(text,text,text,timestamptz,jsonb,text,text) TO service_role;

CREATE FUNCTION sa_domain.v1_integration_reconcile(p_provider text,p_scope text,p_cursor text DEFAULT NULL,p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();cfg jsonb:=sa_domain.warehouse_configuration();cached_ jsonb;id_ uuid;seq_ bigint;job_ uuid;r jsonb;cursor_ bigint:=0;g bigint;
BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Integration administrator required' USING ERRCODE='42501';END IF;
 IF p_provider IS DISTINCT FROM cfg->>'provider' OR p_scope IS NULL OR p_scope NOT IN('orders','inventory','all') THEN RAISE EXCEPTION 'Invalid reconciliation scope/provider' USING ERRCODE='22023';END IF;
 IF NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Warehouse ownership/configuration is not active' USING ERRCODE='55000';END IF;
 g:=(cfg->>'generation')::bigint;
 IF p_cursor IS NOT NULL THEN cursor_:=sa_domain.cursor_id(p_cursor,jsonb_build_object('resource','warehouse_reconcile','provider',p_provider,'scope',p_scope,'generation',g));END IF;
 cached_:=sa_domain.begin_media_command('integration.reconcile',p_idempotency_key,jsonb_build_object('provider',p_provider,'scope',p_scope,'cursor',p_cursor));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('warehouse-reconcile:'||p_provider,784146));
 IF EXISTS(SELECT FROM sa_domain.warehouse_reconciliations WHERE generation=g AND provider=p_provider AND state IN('queued','running')) THEN RAISE EXCEPTION 'Reconciliation already running' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.warehouse_reconciliations(actor_id,generation,provider,scope,cursor_id) VALUES((ctx->>'auth_id')::uuid,g,p_provider,p_scope,cursor_) RETURNING id,sequence_id INTO id_,seq_;
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 VALUES((ctx->>'auth_id')::uuid,'warehouse.reconcile','integration',seq_,p_idempotency_key,g,jsonb_build_object('reconciliation_id',id_)) RETURNING id INTO job_;
 UPDATE sa_domain.warehouse_reconciliations SET job_id=job_ WHERE id=id_;
 r:=jsonb_build_object('id',id_,'job_id',job_,'provider',p_provider,'scope',p_scope,'state','queued');
 UPDATE sa_domain.commands SET result=r WHERE actor_id=(ctx->>'auth_id')::uuid AND key=p_idempotency_key;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation)
 VALUES((ctx->>'auth_id')::uuid,(ctx->>'legacy_user_id')::bigint,'integration.reconcile','integration',seq_,p_idempotency_key,jsonb_build_object('provider',p_provider,'scope',p_scope),g);
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.v1_integration_reconcile(text,text,text,uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_integration_reconcile(text,text,text,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_integration_reconcile(text,text,text,uuid) TO sa_app,authenticated;
CREATE FUNCTION canto_api.v1_integration_reconcile(p_provider text,p_scope text,p_cursor text DEFAULT NULL,p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_integration_reconcile(p_provider,p_scope,p_cursor,p_idempotency_key) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_integration_reconcile(text,text,text,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_integration_reconcile(text,text,text,uuid) TO sa_app,authenticated;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
