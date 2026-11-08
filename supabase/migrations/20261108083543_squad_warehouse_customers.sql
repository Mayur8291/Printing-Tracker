BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_integrator;
ALTER TABLE sa_domain.warehouse_operations ADD COLUMN customer_id bigint;
CREATE INDEX warehouse_operation_customer ON sa_domain.warehouse_operations(customer_id,generation,state) WHERE attempted AND customer_id IS NOT NULL;
CREATE TABLE sa_domain.integration_customer_context(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,job_id uuid NOT NULL REFERENCES sa_domain.outbox,
 lease_token uuid NOT NULL,customer_id bigint NOT NULL,generation bigint NOT NULL,PRIMARY KEY(backend_pid,transaction_id));
ALTER TABLE sa_domain.integration_customer_context ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.integration_customer_context FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON sa_domain.integration_customer_context TO sa_worker;
GRANT SELECT ON sa_domain.integration_customer_context TO sa_guard;
CREATE POLICY warehouse_customer_context_worker ON sa_domain.integration_customer_context TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY warehouse_customer_context_guard ON sa_domain.integration_customer_context FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.integration_customer_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT x.customer_id FROM sa_domain.integration_customer_context x JOIN sa_domain.outbox j ON j.id=x.job_id
 JOIN sa_domain.warehouse_operations op ON op.job_id=j.id AND op.customer_id=x.customer_id AND op.operation='customer'
 JOIN sa_domain.runtime_state r ON r.singleton AND r.generation=x.generation
 WHERE current_setting('role',true)='service_role' AND nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'
 AND x.backend_pid=pg_backend_pid() AND x.transaction_id=txid_current() AND x.lease_token=j.lease_token AND x.generation=j.generation
 AND j.status='leased' AND j.lease_until>statement_timestamp() AND j.event_type='warehouse.customer' AND j.aggregate_kind='person' AND j.aggregate_id=x.customer_id
 AND op.attempted AND op.provider='unicommerce' AND(sa_domain.warehouse_configuration()->>'ready')::boolean
$f$;
ALTER FUNCTION sa_domain.integration_customer_id() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.integration_customer_id() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.integration_customer_id() TO sa_integrator,sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_users TO sa_integrator;
GRANT SELECT ON sa_sync.environment_state TO sa_integrator;
CREATE POLICY integration_customer_environment ON sa_sync.environment_state FOR SELECT TO sa_integrator USING(singleton);
CREATE POLICY integration_customer_read ON sa_snapshot_20261019.sa_users FOR SELECT TO sa_integrator USING(id=(SELECT sa_domain.integration_customer_id()));
GRANT UPDATE(uc_customer_id,updated_at) ON sa_snapshot_20261019.sa_users TO sa_integrator;
CREATE POLICY integration_customer_write ON sa_snapshot_20261019.sa_users FOR UPDATE TO sa_integrator USING(id=(SELECT sa_domain.integration_customer_id())) WITH CHECK(id=(SELECT sa_domain.integration_customer_id()));
CREATE FUNCTION sa_domain.warehouse_customer_apply(p_id bigint,p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE old_ text;prefix_ text;
BEGIN
 IF p_id IS DISTINCT FROM sa_domain.integration_customer_id() THEN RAISE EXCEPTION 'Customer integration capability unavailable' USING ERRCODE='42501';END IF;
 SELECT CASE environment WHEN 'staging' THEN 'S-' ELSE 'P-' END INTO prefix_ FROM sa_sync.environment_state;
 SELECT uc_customer_id INTO old_ FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role IN(3,10) FOR UPDATE;
 IF NOT FOUND OR p_code IS DISTINCT FROM prefix_||p_id OR nullif(old_,'') IS NOT NULL AND old_<>p_code THEN RAISE EXCEPTION 'Provider customer identity conflict' USING ERRCODE='40001';END IF;
 UPDATE sa_snapshot_20261019.sa_users SET uc_customer_id=p_code,updated_at=now() WHERE id=p_id AND uc_customer_id IS DISTINCT FROM p_code;
END $f$;
ALTER FUNCTION sa_domain.warehouse_customer_apply(bigint,text) OWNER TO sa_integrator;
REVOKE ALL ON FUNCTION sa_domain.warehouse_customer_apply(bigint,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_customer_apply(bigint,text) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_customer_payload(p_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE u sa_snapshot_20261019.sa_users;a sa_snapshot_20261019.sa_addresses;name_ text;code_ text;party_ text;address_ jsonb;state_ text;
BEGIN
 IF NOT sa_domain.can_address(p_id) THEN RAISE EXCEPTION 'Current customer authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role IN(3,10);
 IF u.id IS NULL THEN RAISE EXCEPTION 'Customer or dealer required' USING ERRCODE='P0002';END IF;
 SELECT * INTO a FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_id AND deleted_at IS NULL ORDER BY is_primary DESC NULLS LAST,id LIMIT 1;
 SELECT CASE environment WHEN 'staging' THEN 'S-' ELSE 'P-' END||p_id,CASE environment WHEN 'staging' THEN 'S-PC-' ELSE 'P-PC-' END||p_id INTO code_,party_ FROM sa_sync.environment_state;
 IF nullif(u.uc_customer_id,'') IS NOT NULL AND u.uc_customer_id<>code_ THEN RAISE EXCEPTION 'Customer provider code requires reconciliation' USING ERRCODE='40001';END IF;
 state_:=sa_domain.warehouse_state_code(a.state);name_:=coalesce(nullif(btrim(u.customer_company_name),''),nullif(btrim(u.name),''));
 IF a.id IS NULL OR name_ IS NULL OR state_ IS NULL OR nullif(btrim(a.address),'') IS NULL OR nullif(btrim(a.city),'') IS NULL OR nullif(btrim(a.zip_code),'') IS NULL OR nullif(btrim(u.email),'') IS NULL OR nullif(btrim(u.phone),'') IS NULL THEN RAISE EXCEPTION 'Customer shipping/contact fields incomplete' USING ERRCODE='22023';END IF;
 address_:=jsonb_build_object('addressLine1',a.address,'city',a.city,'stateCode',state_,'countryCode','IN','partyCode',party_,'addressType','PRIMARY','pincode',a.zip_code,'phone',u.phone,'email',u.email);
 RETURN jsonb_build_object('action',CASE WHEN nullif(u.uc_customer_id,'') IS NULL THEN 'create' ELSE 'edit' END,'customer_id',u.id::text,
 'payload',jsonb_build_object('customer',jsonb_strip_nulls(jsonb_build_object('code',code_,'name',name_,'enabled',u.disabled IS NOT TRUE AND u.deleted_at IS NULL AND NOT(u.role=3 AND u.approved IS FALSE),'gstNumber',nullif(u.gst_no,''),
 'partyContacts',jsonb_build_array(jsonb_build_object('contactType','PRIMARY','partyCode',party_,'name',name_,'email',u.email,'phone',u.phone)),'billingAddress',address_,'shippingAddress',address_))));
END $f$;
ALTER FUNCTION sa_domain.warehouse_customer_payload(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_customer_payload(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_customer_payload(bigint) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_customer_fanout() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE id_ bigint;cfg jsonb;
BEGIN
 cfg:=sa_domain.warehouse_configuration();IF NOT coalesce((cfg->>'ready')::boolean,false) OR cfg->>'provider'<>'unicommerce' THEN RETURN NEW;END IF;
 id_:=CASE WHEN NEW.aggregate_kind='address' THEN (NEW.payload->>'user_id')::bigint ELSE NEW.aggregate_id END;
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=id_ AND role IN(3,10)) THEN RETURN NEW;END IF;
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 VALUES(NEW.actor_id,'warehouse.customer','person',id_,NEW.id,NEW.generation,jsonb_build_object('operation','customer','source_job',NEW.id));
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.warehouse_customer_fanout() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_customer_fanout() FROM PUBLIC,anon,authenticated,sa_app,service_role;
-- Current profile/address fields and enable/archive changes all share one sync.
CREATE TRIGGER warehouse_customer_fanout AFTER INSERT ON sa_domain.outbox FOR EACH ROW
 WHEN(NEW.event_type IN('profile.saved','person.saved','address.saved','address.archived','customer.reviewed','account.status_changed','person.archived')) EXECUTE FUNCTION sa_domain.warehouse_customer_fanout();
-- Worker has no broad customer-table read grant: use the guard for trigger eligibility.
CREATE FUNCTION sa_domain.warehouse_is_customer(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role IN(3,10)) $f$;
ALTER FUNCTION sa_domain.warehouse_is_customer(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_is_customer(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_is_customer(bigint) TO sa_worker;
DO $f$ DECLARE d text;BEGIN d:=pg_get_functiondef('sa_domain.warehouse_customer_fanout()'::regprocedure);d:=replace(d,'NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=id_ AND role IN(3,10))','NOT sa_domain.warehouse_is_customer(id_)');EXECUTE d;END $f$;

CREATE FUNCTION sa_domain.warehouse_order_customer(p_order bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_domain.can_order(p_order) THEN RAISE EXCEPTION 'Current order authority required' USING ERRCODE='42501';END IF;
 RETURN(SELECT jsonb_build_object('id',u.id::text,'code',nullif(u.uc_customer_id,'')) FROM sa_snapshot_20261019.sa_orders o JOIN sa_snapshot_20261019.sa_users u ON u.id=o.customer_id WHERE o.id=p_order);
END $f$;
ALTER FUNCTION sa_domain.warehouse_order_customer(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_order_customer(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_order_customer(bigint) TO sa_worker;

ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) RENAME TO warehouse_prepare_base;
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) RENAME TO warehouse_finish_base;
REVOKE ALL ON FUNCTION sa_domain.warehouse_prepare_base(uuid,uuid),sa_domain.warehouse_finish_base(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_prepare_base(uuid,uuid),sa_domain.warehouse_finish_base(uuid,uuid,jsonb) TO sa_worker;
CREATE FUNCTION sa_domain.squad_warehouse_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;op sa_domain.warehouse_operations;cfg jsonb;g bigint;payload_ jsonb;prior_ boolean;error_ text;customer_ jsonb;child_ sa_domain.outbox;
BEGIN
 PERFORM sa_domain.assert_service_worker();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id;
 IF j.event_type IS DISTINCT FROM 'warehouse.customer' THEN
  -- A first Uniware order waits for its actual confirmed customer code. This is
  -- a durable dependent job; no fabricated customer code enters an order HTTP.
  cfg:=sa_domain.warehouse_configuration();
  IF j.event_type='warehouse.order' AND j.payload->>'operation'='submit' AND cfg->>'provider'='unicommerce' AND coalesce((cfg->>'ready')::boolean,false) THEN
   g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
   IF j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RETURN sa_domain.warehouse_prepare_base(p_id,p_lease_token);END IF;
   BEGIN
    INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
    customer_:=sa_domain.warehouse_order_customer(j.aggregate_id);
    DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
    IF customer_->>'id' IS NULL THEN RAISE EXCEPTION 'Order customer unavailable' USING ERRCODE='P0002';END IF;
    IF customer_->>'code' IS NULL THEN
     INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
     VALUES(j.actor_id,'warehouse.customer','person',(customer_->>'id')::bigint,j.id,j.generation,jsonb_build_object('operation','customer','source_job',j.id)) ON CONFLICT DO NOTHING;
     SELECT * INTO child_ FROM sa_domain.outbox WHERE actor_id=j.actor_id AND command_key=j.id AND event_type='warehouse.customer' AND aggregate_kind='person' AND aggregate_id=(customer_->>'id')::bigint;
     IF child_.status IN('dead','done') THEN RETURN sa_domain.warehouse_job_settle(j,'{}','CUSTOMER_SYNC_FAILED',false);END IF;
     UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
     UPDATE sa_domain.outbox SET status='pending',attempts=greatest(attempts-1,0),available_at=now()+interval '10 seconds',lease_until=NULL,lease_token=NULL,revision=revision+1 WHERE id=j.id;
     RETURN jsonb_build_object('state','pending','dependency','customer','dependency_job_id',child_.id);
    END IF;
   EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;
    DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN sa_domain.warehouse_job_settle(j,'{}',error_,false);
   END;
  END IF;
  RETURN sa_domain.warehouse_prepare_base(p_id,p_lease_token);
 END IF;
 g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Customer job lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() OR j.aggregate_kind<>'person' THEN RAISE EXCEPTION 'Customer job lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  IF NOT coalesce((cfg->>'ready')::boolean,false) OR cfg->>'provider'<>'unicommerce' THEN RAISE EXCEPTION 'Customer synchronization provider unavailable' USING ERRCODE='55000';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('warehouse_customer:'||j.aggregate_id,784139));
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  payload_:=sa_domain.warehouse_customer_payload(j.aggregate_id);
  SELECT old_job.* INTO child_ FROM sa_domain.warehouse_operations other_ JOIN sa_domain.outbox old_job ON old_job.id=other_.job_id
   WHERE other_.customer_id=j.aggregate_id AND other_.generation=g AND other_.job_id<>j.id AND other_.attempted AND other_.state IN('ready','reconciliation_required') ORDER BY other_.created_at LIMIT 1;
  IF child_.id IS NOT NULL THEN
   IF child_.status NOT IN('pending','leased') THEN RAISE EXCEPTION 'Previous customer outcome must be reconciled' USING ERRCODE='55000';END IF;
   DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
   UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
   UPDATE sa_domain.outbox SET status='pending',attempts=greatest(attempts-1,0),available_at=now()+interval '10 seconds',lease_until=NULL,lease_token=NULL,revision=revision+1 WHERE id=j.id;
   RETURN jsonb_build_object('state','pending','dependency','previous_customer_operation','dependency_job_id',child_.id);
  END IF;
  SELECT * INTO op FROM sa_domain.warehouse_operations WHERE job_id=j.id FOR UPDATE;
  IF op.id IS NULL THEN INSERT INTO sa_domain.warehouse_operations(job_id,generation,provider,operation,phase,customer_id,request_key,facility_code,payload)
   VALUES(j.id,g,'unicommerce','customer',payload_->>'action',j.aggregate_id,'squad_'||replace(j.id::text,'-',''),cfg->>'one_day_facility',payload_->'payload') RETURNING * INTO op;END IF;
  IF op.provider<>cfg->>'provider' OR op.generation<>g OR op.state NOT IN('ready','reconciliation_required') THEN RAISE EXCEPTION 'Customer operation unavailable' USING ERRCODE='55000';END IF;
  prior_:=op.attempted;UPDATE sa_domain.warehouse_operations SET attempted=true,last_prepare_prior_attempted=prior_,prepared_lease_token=p_lease_token,state='ready',updated_at=now() WHERE id=op.id;
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  RETURN jsonb_build_object('state','prepared','intent_id',op.id,'provider',op.provider,'operation','customer','customer_action',op.phase,'request_key',op.request_key,'project_ref',cfg->>'project_ref','environment',cfg->>'environment','facility_code',op.facility_code,'payload',op.payload,'attempted',prior_);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;END;
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN sa_domain.warehouse_job_settle(j,'{}',error_,false);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) TO service_role;
CREATE FUNCTION sa_domain.squad_warehouse_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;op sa_domain.warehouse_operations;g bigint;cfg jsonb;error_ text;r jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id;
 IF j.event_type IS DISTINCT FROM 'warehouse.customer' THEN RETURN sa_domain.warehouse_finish_base(p_id,p_lease_token,p_result);END IF;
 g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Customer result lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status,'replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Customer result lease expired' USING ERRCODE='40001';END IF;
 SELECT * INTO op FROM sa_domain.warehouse_operations WHERE job_id=j.id AND generation=g FOR UPDATE;
 IF op.id IS NULL OR op.operation<>'customer' OR NOT op.attempted OR op.prepared_lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Customer operation unavailable' USING ERRCODE='55000';END IF;
 IF p_result->>'code' IN('RETRY','RECONCILIATION_REQUIRED','REJECTED') THEN RETURN sa_domain.warehouse_finish_base(p_id,p_lease_token,p_result);END IF;
 BEGIN
  PERFORM sa_domain.check_fields(p_result,ARRAY['code','customer_code','proof']);
  IF p_result->>'code' IS DISTINCT FROM 'CONFIRMED' OR p_result->>'customer_code' IS DISTINCT FROM op.payload->'customer'->>'code' OR p_result->'proof'->>'source' IS DISTINCT FROM 'customer_write_response' OR octet_length(p_result::text)>2097152 THEN RAISE EXCEPTION 'Customer mutation proof does not match' USING ERRCODE='22023';END IF;
  IF op.provider<>cfg->>'provider' OR NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Customer provider configuration changed' USING ERRCODE='55000';END IF;
  INSERT INTO sa_domain.integration_customer_context VALUES(pg_backend_pid(),txid_current(),j.id,j.lease_token,op.customer_id,g);
  PERFORM sa_domain.warehouse_customer_apply(op.customer_id,p_result->>'customer_code');
  DELETE FROM sa_domain.integration_customer_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  r:=jsonb_build_object('state','applied','customer_id',op.customer_id::text,'customer_code',p_result->>'customer_code');
  UPDATE sa_domain.warehouse_operations SET state='confirmed',proof=p_result->'proof',result=r,updated_at=now() WHERE id=op.id;
  UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
  INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation) VALUES(j.actor_id,NULL,'warehouse.customer_confirmed','person',op.customer_id,j.command_key,jsonb_build_object('provider',op.provider,'customer_code',p_result->>'customer_code','action',op.phase),g);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;
  UPDATE sa_domain.warehouse_operations SET state='reconciliation_required',proof=coalesce(p_result->'proof','{}'),result=jsonb_build_object('error_code',error_,'customer_code',p_result->>'customer_code'),updated_at=now() WHERE id=op.id;
 END;
 DELETE FROM sa_domain.integration_customer_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN sa_domain.warehouse_job_settle(j,coalesce(r,'{}'),error_,false);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) TO service_role;
DO $f$ DECLARE d text;BEGIN d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);d:=replace(d,'SELECT CASE WHEN','SELECT CASE WHEN p_event=''warehouse.customer'' THEN ''warehouse'' WHEN');EXECUTE d;END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_integrator;
NOTIFY pgrst,'reload schema';
COMMIT;
