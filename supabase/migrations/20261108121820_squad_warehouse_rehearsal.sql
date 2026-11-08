BEGIN;
-- Permanent, private reservations and captured provider DTOs. Registration is
-- trusted direct SQL only; the service API accepts only a run and a fixed step.
CREATE TABLE sa_domain.warehouse_rehearsals(
 id uuid PRIMARY KEY,tenant text NOT NULL,generation bigint NOT NULL,
 customer_id bigint NOT NULL,order_id bigint NOT NULL,controlled_email text NOT NULL,
 source_capture jsonb NOT NULL,manifest_json text NOT NULL,manifest_sha256 text NOT NULL,
 created_at timestamptz NOT NULL,forward_expires_at timestamptz NOT NULL,cleanup_expires_at timestamptz NOT NULL,
 lease_step text,lease_token uuid,lease_until timestamptz,lease_previous_attempted boolean,
 CHECK(customer_id BETWEEN 1900000000 AND 1999999999 AND order_id BETWEEN 1900000000 AND 1999999999 AND customer_id<>order_id),
 CHECK(octet_length(manifest_json)<=65536 AND octet_length(source_capture::text)<=65536),
 CHECK(manifest_sha256~'^[a-f0-9]{64}$'),
 CHECK(forward_expires_at>created_at AND forward_expires_at<=created_at+interval '30 minutes'
  AND cleanup_expires_at>=forward_expires_at AND cleanup_expires_at<=created_at+interval '24 hours')
);
CREATE TABLE sa_domain.warehouse_rehearsal_codes(
 tenant text NOT NULL,code text NOT NULL,run_id uuid NOT NULL REFERENCES sa_domain.warehouse_rehearsals,
 kind text NOT NULL CHECK(kind IN('customer','party','initial','replacement')),PRIMARY KEY(tenant,code)
);
CREATE TABLE sa_domain.warehouse_rehearsal_steps(
 run_id uuid NOT NULL REFERENCES sa_domain.warehouse_rehearsals,step text NOT NULL,
 attempted boolean NOT NULL DEFAULT false,completed boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'ready' CHECK(state IN('ready','retry','blocked','done')),
 available_at timestamptz NOT NULL DEFAULT now(),last_error_code text,result jsonb,
 PRIMARY KEY(run_id,step)
);
CREATE TABLE sa_domain.warehouse_rehearsal_attempts(
 lease_token uuid PRIMARY KEY,run_id uuid NOT NULL,step text NOT NULL,
 attempt integer NOT NULL,previous_attempted boolean NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 finished_at timestamptz,state text NOT NULL DEFAULT 'leased' CHECK(state IN('leased','done','retry','blocked','expired')),
 result jsonb,result_sha256 text,reply jsonb,
 FOREIGN KEY(run_id,step) REFERENCES sa_domain.warehouse_rehearsal_steps,
 CHECK(result IS NULL OR octet_length(result::text)<=131072)
);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_rehearsals','warehouse_rehearsal_codes','warehouse_rehearsal_steps','warehouse_rehearsal_attempts'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON sa_domain.%I FROM PUBLIC,anon,authenticated,sa_app,service_role',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_worker',t);
  EXECUTE format('CREATE POLICY warehouse_rehearsal_worker ON sa_domain.%I TO sa_worker USING(true) WITH CHECK(true)',t);
 END LOOP;
END $f$;
GRANT UPDATE(lease_step,lease_token,lease_until,lease_previous_attempted) ON sa_domain.warehouse_rehearsals TO sa_worker;
GRANT UPDATE ON sa_domain.warehouse_rehearsal_steps TO sa_worker;
GRANT INSERT,UPDATE ON sa_domain.warehouse_rehearsal_attempts TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_rehearsal_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='warehouse_rehearsal_codes' OR
  (to_jsonb(NEW)-ARRAY['lease_step','lease_token','lease_until','lease_previous_attempted']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['lease_step','lease_token','lease_until','lease_previous_attempted']) THEN
  RAISE EXCEPTION 'Provider rehearsal reservation is immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_rehearsal_immutable() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER warehouse_rehearsal_immutable BEFORE UPDATE OR DELETE ON sa_domain.warehouse_rehearsals
 FOR EACH ROW EXECUTE FUNCTION sa_domain.warehouse_rehearsal_immutable();
CREATE TRIGGER warehouse_rehearsal_code_immutable BEFORE UPDATE OR DELETE ON sa_domain.warehouse_rehearsal_codes
 FOR EACH ROW EXECUTE FUNCTION sa_domain.warehouse_rehearsal_immutable();

CREATE FUNCTION sa_domain.warehouse_rehearsal_builders_sha256() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT encode(sha256(convert_to(pg_get_functiondef('sa_domain.warehouse_customer_payload(bigint)'::regprocedure)||
 pg_get_functiondef('sa_domain.warehouse_order_payload(bigint,text,text)'::regprocedure)||
 pg_get_functiondef('sa_domain.warehouse_amendment_payload(uuid,text,text,text)'::regprocedure),'UTF8')),'hex')
$f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_rehearsal_builders_sha256() FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.warehouse_rehearsal_register(p_run_id uuid,p_tenant text,p_controlled_email text,p_capture jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE source_ jsonb:=p_capture->'source';customer_ jsonb:=p_capture->'customer';initial_ jsonb:=p_capture->'initial';replacement_ jsonb:=p_capture->'replacement';
 c_id bigint;o_id bigint;g bigint;created_ timestamptz:=clock_timestamp();m jsonb;order_ jsonb;line_ jsonb;v jsonb;k text;customer_code text;order_code text;
BEGIN
 IF p_run_id IS NULL OR p_tenant IS NULL OR p_tenant !~ '^[a-z0-9][a-z0-9-]{1,62}$'
  OR p_controlled_email IS NULL OR p_controlled_email !~ '^squad-[a-z0-9-]+@mailinator\.com$'
  OR jsonb_typeof(p_capture) IS DISTINCT FROM 'object' OR octet_length(p_capture::text)>65536 THEN
  RAISE EXCEPTION 'Invalid provider rehearsal capture' USING ERRCODE='22023';
 END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR NOT EXISTS(SELECT 1 FROM sa_sync.environment_state
  WHERE singleton AND environment='staging' AND NOT cutover AND active_job IS NULL) THEN
  RAISE EXCEPTION 'Provider rehearsal requires idle staging mirror' USING ERRCODE='55000';
 END IF;
 PERFORM sa_domain.check_fields(p_capture,ARRAY['source','customer','initial','replacement']);
 PERFORM sa_domain.check_fields(source_,ARRAY['customer_id','order_id','generation','actor_id','request_id','captured_at','customer_sha256','order_sha256','request_sha256','builders_sha256']);
 IF jsonb_typeof(source_->'customer_id') IS DISTINCT FROM 'number' OR jsonb_typeof(source_->'order_id') IS DISTINCT FROM 'number'
  OR jsonb_typeof(source_->'generation') IS DISTINCT FROM 'number' OR source_->>'customer_id' !~ '^19[0-9]{8}$'
  OR source_->>'order_id' !~ '^19[0-9]{8}$' OR source_->>'generation' !~ '^[0-9]{1,18}$'
  OR NOT coalesce(pg_input_is_valid(source_->>'actor_id','uuid'),false) OR NOT coalesce(pg_input_is_valid(source_->>'request_id','uuid'),false)
  OR NOT coalesce(pg_input_is_valid(source_->>'captured_at','timestamp with time zone'),false)
  OR source_->>'customer_sha256' IS NULL OR source_->>'customer_sha256' !~ '^[a-f0-9]{64}$'
  OR source_->>'order_sha256' IS NULL OR source_->>'order_sha256' !~ '^[a-f0-9]{64}$'
  OR source_->>'request_sha256' IS NULL OR source_->>'request_sha256' !~ '^[a-f0-9]{64}$'
  OR source_->>'builders_sha256' IS DISTINCT FROM sa_domain.warehouse_rehearsal_builders_sha256() THEN
  RAISE EXCEPTION 'Source capture identity or builder evidence is invalid' USING ERRCODE='22023';
 END IF;
 c_id:=(source_->>'customer_id')::bigint;o_id:=(source_->>'order_id')::bigint;g:=(source_->>'generation')::bigint;
 IF c_id=o_id OR g IS DISTINCT FROM(SELECT generation FROM sa_domain.runtime_state)
  OR (source_->>'captured_at')::timestamptz>created_ OR (source_->>'captured_at')::timestamptz<created_-interval '10 minutes'
  OR EXISTS(SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=c_id)
  OR EXISTS(SELECT 1 FROM sa_snapshot_20261019.sa_orders WHERE id=o_id) THEN
  RAISE EXCEPTION 'Capture must be a fresh rolled-back synthetic staging fixture' USING ERRCODE='55000';
 END IF;
 customer_code:='S-'||c_id;order_code:='S-'||o_id;
 PERFORM sa_domain.check_fields(customer_,ARRAY['action','customer_id','payload']);
 IF customer_->>'action' IS DISTINCT FROM 'create' OR customer_->>'customer_id' IS DISTINCT FROM c_id::text THEN
  RAISE EXCEPTION 'Only a new controlled customer may be registered' USING ERRCODE='22023';
 END IF;
 PERFORM sa_domain.check_fields(customer_->'payload',ARRAY['customer']);
 customer_:=customer_->'payload'->'customer';
 PERFORM sa_domain.check_fields(customer_,ARRAY['code','name','enabled','gstNumber','partyContacts','billingAddress','shippingAddress']);
 IF customer_->>'code' IS DISTINCT FROM customer_code OR customer_->'enabled' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(customer_->'partyContacts') IS DISTINCT FROM 'array' OR jsonb_array_length(customer_->'partyContacts')<>1 THEN
  RAISE EXCEPTION 'Controlled customer binding is invalid' USING ERRCODE='22023';
 END IF;
 FOR v IN SELECT value FROM jsonb_array_elements((customer_->'partyContacts')||jsonb_build_array(customer_->'billingAddress',customer_->'shippingAddress')) LOOP
  IF v->>'email' IS DISTINCT FROM p_controlled_email OR v->>'partyCode' IS DISTINCT FROM 'S-PC-'||c_id THEN
   RAISE EXCEPTION 'Controlled customer contact binding is invalid' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['initial','replacement'] LOOP
  v:=p_capture->k;PERFORM sa_domain.check_fields(v,ARRAY['saleOrder']);order_:=v->'saleOrder';
  PERFORM sa_domain.check_fields(order_,ARRAY['code','displayOrderCode','displayOrderDateTime','customerCode','customerName','channel','notificationEmail','notificationMobile','cashOnDelivery','paymentInstrument','addresses','billingAddress','shippingAddress','totalCashOnDeliveryCharges','fulfillmentTat','customFieldValues','saleOrderItems']);
  IF order_->>'code' IS DISTINCT FROM (order_code||CASE k WHEN 'replacement' THEN '-1' ELSE '' END)
   OR order_->>'displayOrderCode' IS DISTINCT FROM order_->>'code' OR order_->>'customerCode' IS DISTINCT FROM customer_code
   OR order_->>'notificationEmail' IS DISTINCT FROM p_controlled_email OR order_->>'channel' IS DISTINCT FROM 'Custom'
   OR order_->'cashOnDelivery' IS DISTINCT FROM 'true'::jsonb OR order_->>'paymentInstrument' IS DISTINCT FROM 'CASH'
   OR jsonb_typeof(order_->'addresses') IS DISTINCT FROM 'array' OR jsonb_array_length(order_->'addresses')<>1
   OR order_->'addresses'->0->>'email' IS DISTINCT FROM p_controlled_email
   OR jsonb_typeof(order_->'saleOrderItems') IS DISTINCT FROM 'array' OR jsonb_array_length(order_->'saleOrderItems')<>1
   OR jsonb_typeof(order_->'customFieldValues') IS DISTINCT FROM 'array'
   OR NOT(order_->'customFieldValues' @> '[{"name":"Customer_Details"},{"name":"PICKUPDATE"},{"name":"Comment"}]') THEN
   RAISE EXCEPTION 'Controlled single-piece order binding is invalid' USING ERRCODE='22023';
  END IF;
  line_:=order_->'saleOrderItems'->0;
  PERFORM sa_domain.check_fields(line_,ARRAY['code','itemSku','shippingMethodCode','giftWrap','facilityCode','totalPrice','sellingPrice','prepaidAmount','discount','shippingCharges','customFieldValues']);
  IF line_->>'facilityCode' IS DISTINCT FROM 'WH1' OR line_->>'code' IS NULL OR line_->>'code' !~ '^S-[A-Za-z0-9_-]{1,150}$'
   OR line_->>'itemSku' IS NULL OR length(line_->>'itemSku') NOT BETWEEN 1 AND 200 OR line_->>'shippingMethodCode' IS DISTINCT FROM 'STD'
   OR line_->'giftWrap' IS DISTINCT FROM 'false'::jsonb OR line_->'prepaidAmount' IS DISTINCT FROM '0'::jsonb
   OR line_->'discount' IS DISTINCT FROM '0'::jsonb OR line_->'shippingCharges' IS DISTINCT FROM '0'::jsonb
   OR jsonb_typeof(line_->'customFieldValues') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Controlled piece identity is invalid' USING ERRCODE='22023';
  END IF;
  IF sa_domain.input_number(line_->'totalPrice',0,1000)<=0
   OR sa_domain.input_number(line_->'totalPrice',0,1000) IS DISTINCT FROM sa_domain.input_number(line_->'sellingPrice',0,1000)
   OR (k='replacement' AND line_->>'itemSku' IS DISTINCT FROM initial_->'saleOrder'->'saleOrderItems'->0->>'itemSku') THEN
   RAISE EXCEPTION 'Rehearsal requires the same low-value single SKU' USING ERRCODE='22023';
  END IF;
 END LOOP;
 m:=jsonb_build_object('run_id',p_run_id,'project_ref','scvojtvgnkmbupvyslmb','environment','staging','provider','unicommerce',
  'tenant',p_tenant,'generation',g,'created_at',created_,'forward_expires_at',created_+interval '30 minutes','cleanup_expires_at',created_+interval '24 hours',
  'controlled_email',p_controlled_email,'customer_id',c_id,'order_id',o_id,
  'source_capture_sha256',encode(sha256(convert_to(p_capture::text,'UTF8')),'hex'),
  'customer',jsonb_build_object('customer',customer_),'initial',initial_,'replacement',replacement_);
 INSERT INTO sa_domain.warehouse_rehearsals(id,tenant,generation,customer_id,order_id,controlled_email,source_capture,manifest_json,manifest_sha256,created_at,forward_expires_at,cleanup_expires_at)
 VALUES(p_run_id,p_tenant,g,c_id,o_id,p_controlled_email,p_capture,m::text,encode(sha256(convert_to(m::text,'UTF8')),'hex'),created_,created_+interval '30 minutes',created_+interval '24 hours');
 INSERT INTO sa_domain.warehouse_rehearsal_codes VALUES(p_tenant,customer_code,p_run_id,'customer'),(p_tenant,'S-PC-'||c_id,p_run_id,'party'),
  (p_tenant,order_code,p_run_id,'initial'),(p_tenant,order_code||'-1',p_run_id,'replacement');
 INSERT INTO sa_domain.warehouse_rehearsal_steps(run_id,step) SELECT p_run_id,x FROM unnest(ARRAY['preflight','customer','submit','reconcile','cancel_initial','replace','reconcile_replacement','cancel_replacement','cleanup_initial','cleanup_replacement','customer_disable'])x;
 RETURN jsonb_build_object('run_id',p_run_id,'manifest_sha256',encode(sha256(convert_to(m::text,'UTF8')),'hex'),
  'forward_expires_at',created_+interval '30 minutes','cleanup_expires_at',created_+interval '24 hours');
END $f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_rehearsal_register(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

GRANT CREATE ON SCHEMA sa_domain TO sa_worker;
CREATE FUNCTION sa_domain.warehouse_rehearsal_step_scope(p_run sa_domain.warehouse_rehearsals,p_step text,p_finish boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE cleanup_ boolean:=p_step IN('cleanup_initial','cleanup_replacement','customer_disable');
BEGIN
 IF p_run.id IS NULL OR p_step IS NULL OR p_step<>ALL(ARRAY['preflight','customer','submit','reconcile','cancel_initial','replace','reconcile_replacement','cancel_replacement','cleanup_initial','cleanup_replacement','customer_disable']) THEN
  RAISE EXCEPTION 'Unknown provider rehearsal' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM sa_sync.environment_state WHERE singleton AND environment='staging' AND NOT cutover)
  OR p_run.cleanup_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Provider rehearsal expired or unavailable' USING ERRCODE='55000';END IF;
 IF NOT cleanup_ AND NOT p_finish THEN
  IF p_run.forward_expires_at<=clock_timestamp() OR p_run.generation IS DISTINCT FROM(SELECT generation FROM sa_domain.runtime_state)
   OR EXISTS(SELECT 1 FROM sa_sync.environment_state WHERE active_job IS NOT NULL)
   OR EXISTS(SELECT 1 FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=p_run.id
     AND step IN('cleanup_initial','cleanup_replacement','customer_disable') AND attempts>0) THEN
   RAISE EXCEPTION 'Forward provider rehearsal expired or changed generation' USING ERRCODE='55000';
  END IF;
 END IF;
END $f$;
ALTER FUNCTION sa_domain.warehouse_rehearsal_step_scope(sa_domain.warehouse_rehearsals,text,boolean) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_rehearsal_step_scope(sa_domain.warehouse_rehearsals,text,boolean) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.squad_warehouse_rehearsal_prepare(p_id uuid,p_step text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.warehouse_rehearsals;s sa_domain.warehouse_rehearsal_steps;
 completed_ text[];attempted_ text[];requires_ text[];alias_ text;prior_ boolean;token_ uuid:=gen_random_uuid();deadline_ timestamptz;
BEGIN
 PERFORM sa_domain.assert_service_worker();SELECT * INTO r FROM sa_domain.warehouse_rehearsals WHERE id=p_id;
 PERFORM sa_domain.warehouse_rehearsal_step_scope(r,p_step);
 SELECT * INTO r FROM sa_domain.warehouse_rehearsals WHERE id=p_id FOR UPDATE SKIP LOCKED;
 IF r.id IS NULL THEN RETURN jsonb_build_object('state','busy','run_id',p_id,'step',p_step);END IF;
 PERFORM sa_domain.warehouse_rehearsal_step_scope(r,p_step);
 IF r.lease_token IS NOT NULL AND r.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('state','busy','run_id',p_id,'step',p_step);END IF;
 SELECT * INTO s FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=p_id AND step=p_step FOR UPDATE;
 IF s.completed THEN RETURN jsonb_build_object('state','done','run_id',p_id,'step',p_step);END IF;
 IF s.state='blocked' OR s.attempts>=5 THEN RETURN jsonb_build_object('state','blocked','run_id',p_id,'step',p_step,'error_code',coalesce(s.last_error_code,'REHEARSAL_ATTEMPTS_EXHAUSTED'));END IF;
 IF s.available_at>clock_timestamp() THEN RETURN jsonb_strip_nulls(jsonb_build_object('state','retry','run_id',p_id,'step',p_step,'error_code',s.last_error_code));END IF;
 SELECT coalesce(array_agg(step ORDER BY step) FILTER(WHERE completed),'{}'),coalesce(array_agg(step ORDER BY step) FILTER(WHERE attempted),'{}')
 INTO completed_,attempted_ FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=p_id;
 requires_:=CASE p_step WHEN 'customer' THEN ARRAY['preflight'] WHEN 'submit' THEN ARRAY['customer'] WHEN 'reconcile' THEN ARRAY['submit']
  WHEN 'cancel_initial' THEN ARRAY['reconcile'] WHEN 'replace' THEN ARRAY['cancel_initial'] WHEN 'reconcile_replacement' THEN ARRAY['replace']
  WHEN 'cancel_replacement' THEN ARRAY['reconcile_replacement'] WHEN 'cleanup_initial' THEN ARRAY['preflight']
  WHEN 'cleanup_replacement' THEN ARRAY['preflight'] WHEN 'customer_disable' THEN ARRAY['customer'] ELSE '{}'::text[] END;
 IF NOT(requires_<@completed_) OR(p_step='cleanup_initial' AND NOT('submit'=ANY(attempted_)))
  OR(p_step='cleanup_replacement' AND NOT('replace'=ANY(attempted_)))
  OR(p_step='customer_disable' AND (('submit'=ANY(attempted_) AND NOT(ARRAY['cancel_initial','cleanup_initial']&&completed_))
   OR('replace'=ANY(attempted_) AND NOT(ARRAY['cancel_replacement','cleanup_replacement']&&completed_)))) THEN
  RAISE EXCEPTION 'Provider rehearsal prerequisite is incomplete' USING ERRCODE='55000';
 END IF;
 alias_:=CASE p_step WHEN 'cancel_initial' THEN 'cleanup_initial' WHEN 'cleanup_initial' THEN 'cancel_initial'
  WHEN 'cancel_replacement' THEN 'cleanup_replacement' WHEN 'cleanup_replacement' THEN 'cancel_replacement' END;
 prior_:=s.attempted OR coalesce(alias_=ANY(attempted_),false);
 IF prior_ AND p_step IN('customer','customer_disable') THEN
  IF r.lease_token IS NOT NULL THEN
   UPDATE sa_domain.warehouse_rehearsal_attempts SET state='expired',finished_at=clock_timestamp() WHERE lease_token=r.lease_token AND state='leased';
   UPDATE sa_domain.warehouse_rehearsals SET lease_step=NULL,lease_token=NULL,lease_until=NULL,lease_previous_attempted=NULL WHERE id=p_id;
  END IF;
  UPDATE sa_domain.warehouse_rehearsal_steps SET state='blocked',last_error_code='PROVIDER_CUSTOMER_UNCERTAIN' WHERE run_id=p_id AND step=p_step;
  RETURN jsonb_build_object('state','blocked','run_id',p_id,'step',p_step,'error_code','PROVIDER_CUSTOMER_UNCERTAIN');
 END IF;
 IF r.lease_token IS NOT NULL THEN UPDATE sa_domain.warehouse_rehearsal_attempts SET state='expired',finished_at=clock_timestamp() WHERE lease_token=r.lease_token AND state='leased';END IF;
 deadline_:=least(clock_timestamp()+interval '90 seconds',CASE WHEN p_step IN('cleanup_initial','cleanup_replacement','customer_disable') THEN r.cleanup_expires_at ELSE r.forward_expires_at END);
 UPDATE sa_domain.warehouse_rehearsals SET lease_step=p_step,lease_token=token_,lease_until=deadline_,lease_previous_attempted=prior_ WHERE id=p_id;
 UPDATE sa_domain.warehouse_rehearsal_steps SET attempted=true,attempts=attempts+1,state='ready' WHERE run_id=p_id AND step=p_step;
 INSERT INTO sa_domain.warehouse_rehearsal_attempts(lease_token,run_id,step,attempt,previous_attempted,expires_at) VALUES(token_,p_id,p_step,s.attempts+1,prior_,deadline_);
 RETURN jsonb_build_object('state','prepared','lease_token',token_,'manifest_json',r.manifest_json,'manifest_sha256',r.manifest_sha256,
  'current_generation',(SELECT generation FROM sa_domain.runtime_state),'attempted',prior_,
  'completed_steps',to_jsonb(completed_),'attempted_steps',to_jsonb(attempted_));
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_rehearsal_prepare(uuid,text) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_rehearsal_result(p_manifest jsonb,p_step text,p_result jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE code_ text:=p_result->>'code';order_ jsonb;item_ jsonb;observed_ jsonb;proof_ jsonb:=p_result->'proof';cancel_ boolean;
BEGIN
 PERFORM sa_domain.check_fields(p_result,ARRAY['code','error_code','external_id','external_code','status','customer_code','proof','retry_after_seconds']);
 IF octet_length(p_result::text)>131072 OR code_ IS NULL OR code_ NOT IN('CONFIRMED','OBSERVED','RETRY','RECONCILIATION_REQUIRED','REJECTED') THEN
  RAISE EXCEPTION 'Invalid provider rehearsal receipt' USING ERRCODE='22023';
 END IF;
 IF p_result?'retry_after_seconds' THEN
  IF code_<>'RETRY' OR jsonb_typeof(p_result->'retry_after_seconds') IS DISTINCT FROM 'number'
   OR p_result->>'retry_after_seconds' !~ '^[0-9]{1,4}$' OR(p_result->>'retry_after_seconds')::integer NOT BETWEEN 1 AND 3600 THEN
   RAISE EXCEPTION 'Invalid provider retry delay' USING ERRCODE='22023';
  END IF;
 END IF;
 IF code_ IN('RETRY','RECONCILIATION_REQUIRED','REJECTED') THEN
  IF p_result->>'error_code' IS NULL OR p_result->>'error_code' !~ '^[A-Z][A-Z0-9_]{2,79}$' THEN RAISE EXCEPTION 'Sanitized provider error required' USING ERRCODE='22023';END IF;
  IF p_result?'proof' THEN PERFORM sa_domain.check_fields(proof_,ARRAY['mutation_attempted']);
   IF proof_->'mutation_attempted' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Invalid negative mutation proof' USING ERRCODE='22023';END IF;
  END IF;
  RETURN;
 END IF;
 IF p_step='preflight' THEN
  IF code_<>'CONFIRMED' OR proof_->>'source' IS DISTINCT FROM 'exact_codes_absent'
   OR proof_->'codes' IS DISTINCT FROM jsonb_build_array(p_manifest->'initial'->'saleOrder'->>'code',p_manifest->'replacement'->'saleOrder'->>'code') THEN
   RAISE EXCEPTION 'Preflight absence receipt does not match reserved codes' USING ERRCODE='22023';END IF;
 ELSIF p_step IN('customer','customer_disable') THEN
  IF code_<>'CONFIRMED' OR p_result->>'customer_code' IS DISTINCT FROM p_manifest->'customer'->'customer'->>'code'
   OR proof_->>'source' IS DISTINCT FROM 'customer_write_response' OR proof_->'enabled' IS DISTINCT FROM to_jsonb(p_step='customer') THEN
   RAISE EXCEPTION 'Customer enabled-state receipt does not match' USING ERRCODE='22023';END IF;
 ELSE
  order_:=p_manifest->(CASE WHEN p_step IN('replace','reconcile_replacement','cancel_replacement','cleanup_replacement') THEN 'replacement' ELSE 'initial' END)->'saleOrder';
  item_:=order_->'saleOrderItems'->0;observed_:=proof_->'items'->0;cancel_:=p_step IN('cancel_initial','cancel_replacement','cleanup_initial','cleanup_replacement');
  IF code_ IS DISTINCT FROM (CASE WHEN p_step IN('reconcile','reconcile_replacement') THEN 'OBSERVED' ELSE 'CONFIRMED' END)
   OR p_result->>'external_id' IS DISTINCT FROM order_->>'code' OR p_result->>'external_code' IS DISTINCT FROM order_->>'code'
   OR proof_->>'source' IS NULL OR proof_->>'source' NOT IN('saleorder_get','verified_order_lookup')
   OR jsonb_typeof(proof_->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(proof_->'items')<>1
   OR observed_->>'code' IS DISTINCT FROM item_->>'code' OR observed_->>'sku_code' IS DISTINCT FROM item_->>'itemSku'
   OR observed_->>'facility_code' IS DISTINCT FROM 'WH1'
   OR sa_domain.input_number(observed_->'total_price',0,1000000000000) IS DISTINCT FROM sa_domain.input_number(item_->'totalPrice',0,1000000000000)
   OR sa_domain.input_number(observed_->'selling_price',0,1000000000000) IS DISTINCT FROM sa_domain.input_number(item_->'sellingPrice',0,1000000000000)
   OR p_result->>'status' IS NULL OR p_result->>'status' NOT IN('PENDING_VERIFICATION','CREATED','PROCESSING','CANCELLED')
   OR(cancel_ AND (proof_->'cancelled_item_codes' IS DISTINCT FROM jsonb_build_array(item_->>'code')
      OR(p_result->>'status'<>'CANCELLED' AND observed_->>'status' IS DISTINCT FROM 'CANCELLED'))) THEN
   RAISE EXCEPTION 'Exact single-piece provider receipt does not match' USING ERRCODE='22023';
  END IF;
 END IF;
END $f$;
ALTER FUNCTION sa_domain.warehouse_rehearsal_result(jsonb,text,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_rehearsal_result(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.squad_warehouse_rehearsal_finish(p_id uuid,p_step text,p_lease_token uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.warehouse_rehearsals;a sa_domain.warehouse_rehearsal_attempts;hash_ text;state_ text;reply_ jsonb;clear_ boolean;delay_ integer;
BEGIN
 PERFORM sa_domain.assert_service_worker();SELECT * INTO r FROM sa_domain.warehouse_rehearsals WHERE id=p_id FOR UPDATE;
 -- A late response may record immutable external truth after the forward
 -- deadline/generation changes; it never grants a new forward provider call.
 PERFORM sa_domain.warehouse_rehearsal_step_scope(r,p_step,true);
 hash_:=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
 SELECT * INTO a FROM sa_domain.warehouse_rehearsal_attempts WHERE lease_token=p_lease_token AND run_id=p_id AND step=p_step FOR UPDATE;
 IF a.lease_token IS NULL THEN RAISE EXCEPTION 'Provider rehearsal lease unavailable' USING ERRCODE='PT409';END IF;
 IF a.result_sha256 IS NOT NULL THEN
  IF a.result_sha256<>hash_ THEN RAISE EXCEPTION 'Provider receipt replay changed' USING ERRCODE='PT409';END IF;
  RETURN a.reply;
 END IF;
 IF r.lease_token IS DISTINCT FROM p_lease_token OR r.lease_step IS DISTINCT FROM p_step OR a.state<>'leased' THEN
  RAISE EXCEPTION 'Provider rehearsal lease was replaced' USING ERRCODE='PT409';
 END IF;
 PERFORM sa_domain.warehouse_rehearsal_result(r.manifest_json::jsonb,p_step,p_result);
 state_:=CASE WHEN p_result->>'code' IN('CONFIRMED','OBSERVED') THEN 'done'
  WHEN p_result->>'code'='RETRY' OR(p_step IN('cleanup_initial','cleanup_replacement')
    AND p_result->>'code'='RECONCILIATION_REQUIRED' AND p_result->>'error_code'='REHEARSAL_CLEANUP_NOT_FOUND')
   THEN CASE WHEN a.attempt<5 THEN 'retry' ELSE 'blocked' END ELSE 'blocked' END;
 clear_:=(p_result->>'code'='RETRY' AND NOT a.previous_attempted AND p_result->'proof'->'mutation_attempted'='false'::jsonb);
 delay_:=CASE WHEN p_result->>'error_code'='REHEARSAL_CLEANUP_NOT_FOUND' THEN 60
  ELSE greatest(10,coalesce((p_result->>'retry_after_seconds')::integer,30)) END;
 reply_:=jsonb_strip_nulls(jsonb_build_object('state',state_,'run_id',p_id,'step',p_step,'code',p_result->>'code','error_code',p_result->>'error_code'));
 UPDATE sa_domain.warehouse_rehearsal_steps SET state=state_,completed=state_='done',attempted=CASE WHEN clear_ THEN false ELSE attempted END,
  available_at=clock_timestamp()+make_interval(secs=>delay_),last_error_code=p_result->>'error_code',result=p_result WHERE run_id=p_id AND step=p_step;
 UPDATE sa_domain.warehouse_rehearsal_attempts SET state=state_,finished_at=clock_timestamp(),result=p_result,result_sha256=hash_,reply=reply_ WHERE lease_token=p_lease_token;
 UPDATE sa_domain.warehouse_rehearsals SET lease_step=NULL,lease_token=NULL,lease_until=NULL,lease_previous_attempted=NULL WHERE id=p_id;
 RETURN reply_;
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_rehearsal_finish(uuid,text,uuid,jsonb) OWNER TO sa_worker;
DO $f$ DECLARE name_ text;signature_ text;args_ text;BEGIN
 FOREACH name_ IN ARRAY ARRAY['squad_warehouse_rehearsal_prepare','squad_warehouse_rehearsal_finish'] LOOP
  signature_:='sa_domain.'||name_||CASE name_ WHEN 'squad_warehouse_rehearsal_prepare' THEN '(uuid,text)' ELSE '(uuid,text,uuid,jsonb)' END;
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargnames)x WHERE p.oid=signature_::regprocedure;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',signature_);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS %L',name_,pg_get_function_arguments(signature_::regprocedure),'SELECT sa_domain.'||name_||'('||args_||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',name_,pg_get_function_identity_arguments(signature_::regprocedure));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO service_role',name_,pg_get_function_identity_arguments(signature_::regprocedure));
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
