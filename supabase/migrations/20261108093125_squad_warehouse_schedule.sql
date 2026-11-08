BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor,sa_worker;
CREATE TABLE sa_domain.warehouse_schedule(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,owner_auth_id uuid,owner_user_id bigint,generation bigint,provider text CHECK(provider IN('dashboard','unicommerce')),next_inventory_at timestamptz,next_orders_at timestamptz,last_scope text CHECK(last_scope IN('inventory','orders')),last_error_code text,updated_at timestamptz NOT NULL DEFAULT now(),CHECK(NOT enabled OR(owner_auth_id IS NOT NULL AND owner_user_id IS NOT NULL AND generation IS NOT NULL AND provider IS NOT NULL AND next_inventory_at IS NOT NULL AND next_orders_at IS NOT NULL)));
INSERT INTO sa_domain.warehouse_schedule(singleton) VALUES(true);
CREATE TABLE sa_domain.warehouse_scheduled_runs(reconciliation_id uuid PRIMARY KEY REFERENCES sa_domain.warehouse_reconciliations,generation bigint NOT NULL,scope text NOT NULL CHECK(scope IN('inventory','orders')),started_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX warehouse_scheduled_runs_recent ON sa_domain.warehouse_scheduled_runs(started_at DESC,reconciliation_id);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_schedule','warehouse_scheduled_runs'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_guard,sa_executor',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE ON sa_domain.%I TO sa_worker',t);
  EXECUTE format('CREATE POLICY warehouse_schedule_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
  EXECUTE format('CREATE POLICY warehouse_schedule_worker ON sa_domain.%I TO sa_worker USING(true) WITH CHECK(true)',t);
  EXECUTE format('CREATE POLICY warehouse_schedule_admin ON sa_domain.%I FOR SELECT TO sa_executor USING((sa_domain.actor()).role_id=0)',t);
 END LOOP;
END $f$;
GRANT UPDATE ON sa_domain.warehouse_schedule TO sa_executor;
CREATE POLICY warehouse_schedule_admin_write ON sa_domain.warehouse_schedule FOR UPDATE TO sa_executor USING((sa_domain.actor()).role_id=0) WITH CHECK((sa_domain.actor()).role_id=0);

CREATE FUNCTION sa_domain.warehouse_schedule_projection() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('enabled',s.enabled,'owner_user_id',s.owner_user_id::text,'generation',s.generation::text,'current_generation',(SELECT generation::text FROM sa_domain.runtime_state),'provider',s.provider,'inventory_interval_seconds',120,'orders_interval_seconds',300,'next_inventory_at',s.next_inventory_at,'next_orders_at',s.next_orders_at,'inventory_overdue_seconds',greatest(0,extract(epoch FROM statement_timestamp()-s.next_inventory_at)::integer),'orders_overdue_seconds',greatest(0,extract(epoch FROM statement_timestamp()-s.next_orders_at)::integer),'error_code',s.last_error_code,'runs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.reconciliation_id,'scope',r.scope,'started_at',r.started_at,'state',w.state,'processed',w.processed::text,'errors',w.errors::text,'completed_at',w.completed_at) ORDER BY r.started_at DESC),'[]') FROM(SELECT * FROM sa_domain.warehouse_scheduled_runs ORDER BY started_at DESC,reconciliation_id LIMIT 10) r JOIN sa_domain.warehouse_reconciliations w ON w.id=r.reconciliation_id)) FROM sa_domain.warehouse_schedule s
$f$;
ALTER FUNCTION sa_domain.warehouse_schedule_projection() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_schedule_projection() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_schedule_projection() TO sa_executor;
CREATE FUNCTION sa_domain.v1_warehouse_schedule_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN PERFORM sa_domain.require_roles(ARRAY[0]);RETURN sa_domain.warehouse_schedule_projection()||jsonb_build_object('version',sa_domain.version('warehouse_schedule',1));END $f$;
ALTER FUNCTION sa_domain.v1_warehouse_schedule_status() OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_warehouse_schedule_configure(p_enabled boolean,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cfg jsonb;cached_ jsonb;s sa_domain.warehouse_schedule;g bigint;v text;BEGIN
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Enabled state required' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_command('warehouse.schedule_configured',p_idempotency_key,jsonb_build_object('enabled',p_enabled,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 cfg:=sa_domain.warehouse_configuration();g:=(cfg->>'generation')::bigint;
 IF p_enabled AND NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Verified warehouse ownership required' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM sa_domain.warehouse_schedule FOR UPDATE;
 v:=sa_domain.bump_version('warehouse_schedule',1,p_expected_version);
 UPDATE sa_domain.warehouse_schedule SET enabled=p_enabled,owner_auth_id=CASE WHEN p_enabled THEN a.auth_id ELSE owner_auth_id END,owner_user_id=CASE WHEN p_enabled THEN a.user_id ELSE owner_user_id END,generation=CASE WHEN p_enabled THEN g ELSE generation END,provider=CASE WHEN p_enabled THEN cfg->>'provider' ELSE provider END,next_inventory_at=CASE WHEN p_enabled AND(NOT s.enabled OR s.generation IS DISTINCT FROM g OR s.provider IS DISTINCT FROM cfg->>'provider') THEN now() ELSE s.next_inventory_at END,next_orders_at=CASE WHEN p_enabled AND(NOT s.enabled OR s.generation IS DISTINCT FROM g OR s.provider IS DISTINCT FROM cfg->>'provider') THEN now() ELSE s.next_orders_at END,last_error_code=NULL,updated_at=now();
 RETURN sa_domain.finish_command('warehouse.schedule_configured',p_idempotency_key,'warehouse_schedule',1,sa_domain.v1_warehouse_schedule_status(),jsonb_build_object('enabled',p_enabled,'owner_user_id',a.user_id));
END $f$;
ALTER FUNCTION sa_domain.v1_warehouse_schedule_configure(boolean,text,uuid) OWNER TO sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_configuration() TO sa_executor;

CREATE FUNCTION sa_domain.squad_warehouse_heartbeat() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE s sa_domain.warehouse_schedule;cfg jsonb;g bigint;scope_ text;error_ text;id_ uuid;seq_ bigint;job_ uuid;active_ uuid;BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state WHERE singleton) THEN RETURN jsonb_build_object('state','paused','error_code','MIRROR_OR_REFRESH');END IF;
 g:=sa_domain.worker_write_fence();SELECT * INTO s FROM sa_domain.warehouse_schedule FOR UPDATE SKIP LOCKED;
 IF s.singleton IS NULL THEN RETURN jsonb_build_object('state','busy');END IF;
 IF NOT s.enabled THEN RETURN jsonb_build_object('state','disabled');END IF;
 cfg:=sa_domain.warehouse_configuration();
 IF s.generation<>g THEN error_:='SOURCE_REFRESH_RECONFIGURE';
 ELSIF NOT coalesce((cfg->>'ready')::boolean,false) OR cfg->>'provider' IS DISTINCT FROM s.provider THEN error_:='WAREHOUSE_OWNERSHIP_UNAVAILABLE';
 ELSIF NOT EXISTS(SELECT FROM sa_domain.notification_candidates(jsonb_build_object('audience',jsonb_build_array(jsonb_build_object('id',s.owner_user_id))),0) c WHERE c.auth_id=s.owner_auth_id AND c.role_id=0) THEN error_:='SCHEDULE_OWNER_UNAVAILABLE';END IF;
 IF error_ IS NOT NULL THEN UPDATE sa_domain.warehouse_schedule SET last_error_code=error_,updated_at=now();RETURN jsonb_build_object('state','paused','error_code',error_);END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('warehouse-reconcile:'||s.provider,784146)) THEN RETURN jsonb_build_object('state','busy');END IF;
 SELECT id INTO active_ FROM sa_domain.warehouse_reconciliations WHERE generation=g AND provider=s.provider AND state IN('queued','running') LIMIT 1;
 IF active_ IS NOT NULL THEN RETURN jsonb_build_object('state','busy','id',active_);END IF;
 IF s.next_inventory_at<=statement_timestamp() AND s.next_orders_at<=statement_timestamp() THEN scope_:=CASE WHEN s.last_scope='inventory' THEN 'orders' ELSE 'inventory' END;
 ELSIF s.next_inventory_at<=statement_timestamp() THEN scope_:='inventory';ELSIF s.next_orders_at<=statement_timestamp() THEN scope_:='orders';
 ELSE RETURN jsonb_build_object('state','waiting');END IF;
 INSERT INTO sa_domain.warehouse_reconciliations(actor_id,generation,provider,scope) VALUES(s.owner_auth_id,g,s.provider,scope_) RETURNING id,sequence_id INTO id_,seq_;
 INSERT INTO sa_domain.warehouse_scheduled_runs(reconciliation_id,generation,scope) VALUES(id_,g,scope_);
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(s.owner_auth_id,'warehouse.reconcile','integration',seq_,id_,g,jsonb_build_object('reconciliation_id',id_)) RETURNING id INTO job_;
 UPDATE sa_domain.warehouse_reconciliations SET job_id=job_ WHERE id=id_;
 UPDATE sa_domain.warehouse_schedule SET next_inventory_at=CASE WHEN scope_='inventory' THEN statement_timestamp()+interval '2 minutes' ELSE next_inventory_at END,next_orders_at=CASE WHEN scope_='orders' THEN statement_timestamp()+interval '5 minutes' ELSE next_orders_at END,last_scope=scope_,last_error_code=NULL,updated_at=now();
 RETURN jsonb_build_object('state','queued','id',id_,'job_id',job_,'scope',scope_,'generation',g::text);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_heartbeat() OWNER TO sa_worker;

-- A scheduled-only read projection avoids repeatedly polling terminal history;
-- manual reconciliation keeps its original historical coverage. The flag is
-- inferred from the current leased job, never accepted from an API caller.
ALTER FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) RENAME TO warehouse_reconcile_page_manual;
REVOKE ALL ON FUNCTION sa_domain.warehouse_reconcile_page_manual(text,bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.warehouse_reconcile_page(p_phase text,p_cursor bigint,p_ceiling bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE provider_ text;BEGIN
 SELECT s.provider INTO provider_ FROM sa_domain.worker_context c JOIN sa_domain.outbox j ON j.id=c.job_id JOIN sa_domain.warehouse_scheduled_runs r ON r.reconciliation_id=(j.payload->>'reconciliation_id')::uuid JOIN sa_domain.warehouse_schedule s ON s.singleton AND s.enabled AND s.generation=r.generation
 WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.actor_id=j.actor_id AND c.generation=j.generation AND c.lease_token=j.lease_token AND j.status='leased' AND j.lease_until>statement_timestamp() AND j.event_type='warehouse.reconcile' AND r.generation=(SELECT generation FROM sa_domain.runtime_state);
 IF p_phase<>'orders' OR provider_ IS NULL THEN RETURN sa_domain.warehouse_reconcile_page_manual(p_phase,p_cursor,p_ceiling);END IF;
 RETURN(SELECT jsonb_build_object('ceiling',coalesce(p_ceiling,(SELECT max(id) FROM sa_snapshot_20261019.sa_orders)),'data',coalesce(jsonb_agg(jsonb_build_object('id',id::text) ORDER BY id),'[]')) FROM(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE id>p_cursor AND(p_ceiling IS NULL OR id<=p_ceiling) AND deleted_at IS NULL AND is_deleted IS NOT TRUE AND nullif(uc_order_id,'') IS NOT NULL AND coalesce(order_source,'unicommerce')=provider_ AND coalesce(uc_status,'') NOT IN('COMPLETE','CANCELLED','FAILED') ORDER BY id LIMIT 50)x);
END $f$;
ALTER FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) TO sa_worker;
CREATE INDEX squad_warehouse_active_poll ON sa_snapshot_20261019.sa_orders((coalesce(order_source,'unicommerce')),id) WHERE deleted_at IS NULL AND is_deleted IS NOT TRUE AND nullif(uc_order_id,'') IS NOT NULL AND coalesce(uc_status,'') NOT IN('COMPLETE','CANCELLED','FAILED');

ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) RENAME TO warehouse_prepare_schedule_base;
REVOKE ALL ON FUNCTION sa_domain.warehouse_prepare_schedule_base(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_prepare_schedule_base(uuid,uuid) TO sa_worker;
CREATE FUNCTION sa_domain.squad_warehouse_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Warehouse lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Warehouse lease expired' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT FROM sa_domain.warehouse_scheduled_runs WHERE reconciliation_id=(j.payload->>'reconciliation_id')::uuid) AND NOT EXISTS(SELECT FROM sa_domain.warehouse_schedule WHERE enabled AND generation=g AND provider=(sa_domain.warehouse_configuration()->>'provider')) THEN RETURN sa_domain.warehouse_job_settle(j,'{}','WAREHOUSE_SCHEDULE_DISABLED');END IF;
 RETURN sa_domain.warehouse_prepare_schedule_base(p_id,p_lease_token);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) TO service_role;
-- Rebind the invoker facade after renaming the implementation.
CREATE OR REPLACE FUNCTION canto_api.squad_warehouse_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_warehouse_prepare(p_id,p_lease_token) $f$;
DO $f$ DECLARE f record;args_ text;roles_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['squad_warehouse_heartbeat','v1_warehouse_schedule_status','v1_warehouse_schedule_configure']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),'SELECT sa_domain.'||f.proname||'('||coalesce(args_,'')||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  roles_:=CASE WHEN f.proname LIKE 'squad_%' THEN 'service_role' ELSE 'sa_app' END;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO %s',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid),roles_);
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
