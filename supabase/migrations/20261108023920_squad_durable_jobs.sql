BEGIN;
-- Reuse the transactional outbox. Workers have queue privileges, never broad
-- business-table privileges; delegated commands retain the executor's RLS.
DO $f$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_worker') THEN CREATE ROLE sa_worker NOLOGIN NOINHERIT NOBYPASSRLS;END IF;
END $f$;
GRANT sa_worker TO postgres;
GRANT USAGE ON SCHEMA sa_domain,sa_sync,canto_api TO sa_worker;
GRANT USAGE ON SCHEMA sa_domain,canto_api TO service_role,authenticated;
GRANT USAGE ON SCHEMA sa_admin TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_admin.is_admin() TO sa_guard;
GRANT CREATE ON SCHEMA sa_domain TO sa_worker,sa_guard,sa_executor;
ALTER TABLE sa_domain.outbox ADD COLUMN sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 ADD COLUMN revision bigint NOT NULL DEFAULT 0,ADD COLUMN result jsonb;
CREATE INDEX squad_outbox_actor_page ON sa_domain.outbox(actor_id,sequence_id DESC);
ALTER TABLE sa_domain.audit ADD COLUMN generation bigint NOT NULL DEFAULT 0;
ALTER TABLE sa_domain.audit ALTER COLUMN legacy_user_id DROP NOT NULL;
CREATE TABLE sa_domain.worker_context(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,job_id uuid NOT NULL REFERENCES sa_domain.outbox,
 actor_id uuid NOT NULL,generation bigint NOT NULL,lease_token uuid NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id)
);
CREATE TABLE sa_domain.job_retries(
 actor_id uuid NOT NULL,command_key uuid NOT NULL,job_id uuid NOT NULL REFERENCES sa_domain.outbox,
 payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,command_key)
);
CREATE TABLE sa_domain.job_attempts(
 lease_token uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES sa_domain.outbox,attempt integer NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,state text NOT NULL DEFAULT 'leased' CHECK(state IN('leased','done','failed','expired')),error_code text
);
CREATE INDEX squad_job_attempts_page ON sa_domain.job_attempts(job_id,started_at DESC,lease_token);
ALTER TABLE sa_domain.job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.job_attempts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.job_attempts TO sa_worker;
GRANT SELECT ON sa_domain.job_attempts TO sa_executor;
CREATE POLICY squad_attempt_worker ON sa_domain.job_attempts TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY squad_attempt_read ON sa_domain.job_attempts FOR SELECT TO sa_executor USING(job_id IN(SELECT id FROM sa_domain.outbox));
GRANT SELECT,UPDATE(state,spec,updated_at) ON sa_domain.order_requests TO sa_worker;
CREATE POLICY squad_worker_order_requests ON sa_domain.order_requests TO sa_worker USING(true) WITH CHECK(true);
ALTER TABLE sa_domain.worker_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.worker_context FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.job_retries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.job_retries FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON sa_domain.worker_context TO sa_worker;
GRANT SELECT ON sa_domain.worker_context,sa_domain.outbox,sa_domain.runtime_state TO sa_guard;
GRANT SELECT,INSERT ON sa_domain.job_retries TO sa_worker;
GRANT SELECT,UPDATE ON sa_domain.outbox TO sa_worker;
GRANT SELECT ON sa_domain.runtime_state,sa_sync.environment_state TO sa_worker;
GRANT INSERT ON sa_domain.audit TO sa_worker;
GRANT USAGE ON SEQUENCE sa_domain.audit_id_seq,sa_domain.outbox_sequence_id_seq TO sa_worker,sa_executor;
CREATE POLICY squad_worker_context ON sa_domain.worker_context TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY squad_context_guard ON sa_domain.worker_context FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_job_retries ON sa_domain.job_retries TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY squad_worker_queue ON sa_domain.outbox TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY squad_guard_queue ON sa_domain.outbox FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_runtime ON sa_domain.runtime_state FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_worker_runtime ON sa_domain.runtime_state FOR SELECT TO sa_worker USING(true);
CREATE POLICY squad_worker_environment ON sa_sync.environment_state FOR SELECT TO sa_worker USING(singleton);
CREATE POLICY squad_worker_audit ON sa_domain.audit FOR INSERT TO sa_worker WITH CHECK(true);

CREATE FUNCTION sa_domain.worker_actor_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT c.actor_id FROM sa_domain.worker_context c JOIN sa_domain.outbox j ON j.id=c.job_id
 JOIN sa_domain.runtime_state s ON s.singleton AND s.generation=c.generation
 WHERE current_setting('role',true)='service_role'
 AND nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'
 AND c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current()
 AND j.actor_id=c.actor_id AND j.generation=c.generation AND j.lease_token=c.lease_token
 AND j.status='leased' AND j.lease_until>statement_timestamp()
$f$;
ALTER FUNCTION sa_domain.worker_actor_id() OWNER TO sa_guard;
CREATE OR REPLACE FUNCTION sa_domain.request_uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN current_setting('role',true)='service_role' THEN sa_domain.worker_actor_id()
 ELSE(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid END
$f$;
-- The existing sole postgres-owned Auth bridge still reads only the verified
-- current subject. Worker identity comes from an in-transaction lease context,
-- never a caller-supplied UUID, session claim, or mutable actor-cache GUC.
CREATE OR REPLACE FUNCTION sa_domain.auth_context() RETURNS TABLE(auth_id uuid,email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.id,u.email::text FROM auth.users u
 WHERE u.id=sa_domain.request_uid() AND u.role='sa_app' AND (u.banned_until IS NULL OR u.banned_until<now())
 AND CASE WHEN current_setting('role',true)='service_role' THEN sa_domain.worker_actor_id()=u.id
 ELSE auth.jwt()->>'role'='sa_app' AND EXISTS(SELECT FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid
 AND s.user_id=u.id AND(s.not_after IS NULL OR s.not_after>now())) END
$f$;
REVOKE ALL ON FUNCTION sa_domain.worker_actor_id() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.worker_actor_id() TO sa_guard,sa_executor,sa_worker;

CREATE FUNCTION sa_domain.ops_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor;
BEGIN
 IF nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='authenticated' THEN
  IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator session required' USING ERRCODE='28000';END IF;
  RETURN jsonb_build_object('auth_id',sa_domain.request_uid(),'legacy_user_id',NULL,'admin',false,'platform',true);
 END IF;
 a:=sa_domain.actor();RETURN jsonb_build_object('auth_id',a.auth_id,'legacy_user_id',a.user_id,'admin',a.role_id=0,'platform',false);
END $f$;
ALTER FUNCTION sa_domain.ops_context() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.job_handler(p_event text,p_payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN p_event='order.edited' AND nullif(p_payload->>'request_id','') IS NOT NULL THEN
 CASE WHEN p_payload->>'provider_confirmation_required'='false' THEN 'local_amendment' ELSE 'provider_order' END
 ELSE 'notification_dispatch' END
$f$;
CREATE INDEX squad_outbox_local_amendments ON sa_domain.outbox(available_at,sequence_id)
 WHERE status IN('pending','leased') AND sa_domain.job_handler(event_type,payload)='local_amendment';
CREATE INDEX squad_outbox_expired_leases ON sa_domain.outbox(lease_until,id) WHERE status='leased';
CREATE FUNCTION sa_domain.job_projection(p_job sa_domain.outbox) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_job.id,'event',p_job.event_type,'kind',p_job.aggregate_kind,'entity_id',p_job.aggregate_id::text,
 'state',p_job.status,'attempts',p_job.attempts,'available_at',p_job.available_at,'created_at',p_job.created_at,'completed_at',p_job.completed_at,
 'error_code',p_job.last_error_code,'generation',p_job.generation::text,'version',p_job.generation::text||':'||p_job.revision::text,
 'handler',sa_domain.job_handler(p_job.event_type,p_job.payload),'handler_available',sa_domain.job_handler(p_job.event_type,p_job.payload)='local_amendment',
 'progress',CASE WHEN p_job.status='done' THEN 100 ELSE 0 END)
$f$;
GRANT SELECT ON sa_domain.outbox,sa_domain.audit TO sa_executor;
CREATE POLICY squad_job_read ON sa_domain.outbox FOR SELECT TO sa_executor USING(
 actor_id=((SELECT sa_domain.ops_context())->>'auth_id')::uuid OR ((SELECT sa_domain.ops_context())->>'admin')::boolean
 OR (((SELECT sa_domain.ops_context())->>'platform')::boolean AND aggregate_kind IN('integration','import','export','document','media','maintenance')));
CREATE POLICY squad_audit_read ON sa_domain.audit FOR SELECT TO sa_executor USING(
 ((SELECT sa_domain.ops_context())->>'admin')::boolean OR (((SELECT sa_domain.ops_context())->>'platform')::boolean AND kind IN('integration','import','export','document','media','maintenance') OR (kind='job' AND entity_id IN(SELECT sequence_id FROM sa_domain.outbox))));
CREATE FUNCTION sa_domain.v1_jobs_list(p_state text DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.ops_context()||jsonb_build_object('resource','jobs','state',p_state,'generation',(SELECT generation FROM sa_domain.runtime_state));
 after_ bigint:=sa_domain.cursor_id(p_cursor,context_);n integer:=sa_domain.page_limit(p_limit);result_ jsonb;
BEGIN
 IF p_state IS NOT NULL AND p_state NOT IN('pending','leased','done','dead') THEN RAISE EXCEPTION 'Invalid job state' USING ERRCODE='22023';END IF;
 WITH scan AS MATERIALIZED(SELECT j FROM sa_domain.outbox j WHERE sequence_id<after_ AND(p_state IS NULL OR status=p_state) ORDER BY sequence_id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT j FROM scan ORDER BY (j).sequence_id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.job_projection(j) ORDER BY(j).sequence_id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min((j).sequence_id),context_) END,'as_of',now(),'data_revision',context_->'generation') INTO result_ FROM page;
 RETURN result_;
END $f$;
CREATE FUNCTION sa_domain.v1_job_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;
BEGIN
 PERFORM sa_domain.ops_context();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found' USING ERRCODE='P0002';END IF;
 RETURN sa_domain.job_projection(j)||jsonb_build_object('recent_attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('attempt',x.attempt,'started_at',x.started_at,'finished_at',x.finished_at,'state',x.state,'error_code',x.error_code) ORDER BY x.started_at DESC),'[]') FROM(SELECT * FROM sa_domain.job_attempts WHERE job_id=j.id ORDER BY started_at DESC,lease_token LIMIT 10)x));
END $f$;
CREATE FUNCTION sa_domain.v1_audit_list(p_kind text DEFAULT NULL,p_entity_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a jsonb:=sa_domain.ops_context();context_ jsonb;after_ bigint;n integer:=sa_domain.page_limit(p_limit);result_ jsonb;
BEGIN
 IF NOT((a->>'admin')::boolean OR(a->>'platform')::boolean) THEN RAISE EXCEPTION 'Audit requires administrator' USING ERRCODE='42501';END IF;
 IF p_kind IS NOT NULL AND(length(p_kind)>50 OR p_kind !~ '^[a-z_]+$') THEN RAISE EXCEPTION 'Invalid audit kind' USING ERRCODE='22023';END IF;
 context_:=a||jsonb_build_object('resource','audit','kind',p_kind,'entity',p_entity_id);after_:=sa_domain.cursor_id(p_cursor,context_);
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.audit WHERE id<after_ AND(p_kind IS NULL OR kind=p_kind) AND(p_entity_id IS NULL OR entity_id=p_entity_id) ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'actor_id',actor_id,'legacy_user_id',legacy_user_id::text,
 'operation',operation,'kind',kind,'entity_id',entity_id::text,'generation',generation::text,'created_at',created_at) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),context_) END,'as_of',now()) INTO result_ FROM page;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.v1_jobs_list(text,text,integer) OWNER TO sa_executor;
ALTER FUNCTION sa_domain.v1_job_get(uuid) OWNER TO sa_executor;
ALTER FUNCTION sa_domain.v1_audit_list(text,bigint,text,integer) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.assert_service_worker() RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR
 nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
 RAISE EXCEPTION 'Service worker required' USING ERRCODE='42501';END IF;
END $f$;
CREATE FUNCTION sa_domain.worker_write_fence() RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE s sa_sync.environment_state;g bigint;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;
 IF s.active_job IS NOT NULL OR NOT s.cutover THEN RAISE EXCEPTION 'Background effects require new-system ownership' USING ERRCODE='55000';END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state WHERE singleton;RETURN g;
END $f$;
CREATE FUNCTION sa_domain.squad_job_claim(p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;result_ jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Claim limit must be 1..10' USING ERRCODE='22023';END IF;
 -- Mirror mode is a quiet no-op: imported/test events never dispatch.
 IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state WHERE singleton) THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'paused',true);END IF;
 g:=sa_domain.worker_write_fence();
 -- Bound crash recovery as well as normal claims. Five abandoned leases reach
 -- a visible dead-letter state rather than becoming permanently unclaimable.
 WITH expired AS(SELECT id FROM sa_domain.outbox WHERE generation=g AND status='leased' AND lease_until<now()
 ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100),
 settled AS(UPDATE sa_domain.outbox j SET status=CASE WHEN attempts>=5 THEN 'dead' ELSE 'pending' END,
 last_error_code=CASE WHEN attempts>=5 THEN 'LEASE_EXHAUSTED' ELSE 'LEASE_EXPIRED' END,lease_until=NULL,
 completed_at=CASE WHEN attempts>=5 THEN now() END,revision=revision+1 FROM expired e WHERE j.id=e.id RETURNING j.lease_token)
 UPDATE sa_domain.job_attempts a SET state='expired',finished_at=now(),error_code='LEASE_EXPIRED' FROM settled s WHERE a.lease_token=s.lease_token AND a.state='leased';
 WITH candidates AS(SELECT id FROM sa_domain.outbox WHERE generation=g AND attempts<5 AND available_at<=now()
 AND(status='pending' OR(status='leased' AND lease_until<now()))
 AND sa_domain.job_handler(event_type,payload)='local_amendment'
 ORDER BY available_at,sequence_id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 claimed AS(UPDATE sa_domain.outbox j SET status='leased',attempts=attempts+1,revision=revision+1,lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid()
 FROM candidates c WHERE j.id=c.id RETURNING j.*),
 attempts_log AS(INSERT INTO sa_domain.job_attempts(lease_token,job_id,attempt) SELECT lease_token,id,attempts FROM claimed RETURNING lease_token)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'lease_token',lease_token,'handler',sa_domain.job_handler(event_type,payload),'attempt',attempts,'lease_until',lease_until)),'[]') INTO result_ FROM claimed;
 RETURN jsonb_build_object('jobs',result_,'paused',false);
END $f$;
CREATE FUNCTION sa_domain.run_delegated_amendment(p_request_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.execute_local_amendment(p_request_id)
$f$;
ALTER FUNCTION sa_domain.run_delegated_amendment(uuid) OWNER TO sa_executor;
CREATE FUNCTION sa_domain.squad_job_execute(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;result_ jsonb;error_ text;retry_ boolean;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Job lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Job lease expired' USING ERRCODE='40001';END IF;
 IF sa_domain.job_handler(j.event_type,j.payload)<>'local_amendment' THEN RAISE EXCEPTION 'Handler not installed' USING ERRCODE='55000';END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  result_:=sa_domain.run_delegated_amendment((j.payload->>'request_id')::uuid);
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;
 END;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN error_ IS NULL THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=error_ WHERE lease_token=j.lease_token;
 IF error_ IS NULL THEN
  UPDATE sa_domain.outbox SET status='done',result=result_,completed_at=now(),lease_until=NULL,last_error_code=NULL,revision=revision+1 WHERE id=j.id;
 ELSE
  retry_:=error_ IN('40P01','55P03','55000','57014','53300') AND j.attempts<5;
  IF error_ NOT IN('40P01','55P03','55000','57014','53300') THEN
   UPDATE sa_domain.order_requests SET state='failed',spec=spec||jsonb_build_object('failure_code',error_),updated_at=now()
   WHERE id=(j.payload->>'request_id')::uuid AND actor_id=j.actor_id AND generation=j.generation AND state IN('queued','running');
  END IF;
  UPDATE sa_domain.outbox SET status=CASE WHEN retry_ THEN 'pending' ELSE 'dead' END,last_error_code=error_,lease_until=NULL,lease_token=NULL,
  available_at=now()+make_interval(secs=>least(300,power(2,j.attempts)::integer*5)),completed_at=CASE WHEN NOT retry_ THEN now() END,revision=revision+1 WHERE id=j.id;
 END IF;
 RETURN jsonb_build_object('id',j.id,'state',CASE WHEN error_ IS NULL THEN 'done' WHEN retry_ THEN 'pending' ELSE 'dead' END,'error_code',error_);
END $f$;
ALTER FUNCTION sa_domain.squad_job_claim(integer) OWNER TO sa_worker;
ALTER FUNCTION sa_domain.squad_job_execute(uuid,uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.v1_job_retry(p_id uuid,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a jsonb:=sa_domain.ops_context();j sa_domain.outbox;g bigint;payload_ jsonb;old_ sa_domain.job_retries;result_ jsonb;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 IF NOT((a->>'admin')::boolean OR(a->>'platform')::boolean) THEN RAISE EXCEPTION 'Retry requires administrator' USING ERRCODE='42501';END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required' USING ERRCODE='22023';END IF;
 g:=sa_domain.worker_write_fence();payload_:=jsonb_build_object('id',p_id,'reason',reason_,'version',p_expected_version);
 PERFORM pg_advisory_xact_lock(hashtextextended(a->>'auth_id'||':'||p_idempotency_key::text,784140));
 SELECT * INTO old_ FROM sa_domain.job_retries WHERE actor_id=(a->>'auth_id')::uuid AND command_key=p_idempotency_key;
 IF old_.command_key IS NOT NULL THEN
  IF (old_.result->>'generation')::bigint<>g THEN RAISE EXCEPTION 'Retry predates refresh' USING ERRCODE='40001';END IF;
  IF old_.payload<>payload_ THEN RAISE EXCEPTION 'Idempotency key already used' USING ERRCODE='22023';END IF;RETURN old_.result;
 END IF;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR((a->>'platform')::boolean AND j.aggregate_kind NOT IN('integration','import','export','document','media','maintenance')) THEN RAISE EXCEPTION 'Job not found' USING ERRCODE='P0002';END IF;
 IF j.generation<>g OR p_expected_version IS DISTINCT FROM j.generation::text||':'||j.revision::text THEN RAISE EXCEPTION 'Job version changed' USING ERRCODE='40001';END IF;
 IF j.status<>'dead' OR j.last_error_code NOT IN('40P01','55P03','55000','57014','53300','PROVIDER_UNAVAILABLE','LEASE_EXHAUSTED') THEN RAISE EXCEPTION 'Job needs reconciliation rather than retry' USING ERRCODE='55000';END IF;
 UPDATE sa_domain.outbox SET status='pending',attempts=0,available_at=now(),lease_until=NULL,lease_token=NULL,last_error_code=NULL,completed_at=NULL,revision=revision+1 WHERE id=p_id RETURNING * INTO j;
 result_:=sa_domain.job_projection(j);
 INSERT INTO sa_domain.job_retries VALUES((a->>'auth_id')::uuid,p_idempotency_key,p_id,payload_,result_,now());
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation)
 VALUES((a->>'auth_id')::uuid,(a->>'legacy_user_id')::bigint,'job.retried','job',j.sequence_id,p_idempotency_key,jsonb_build_object('job_id',j.id,'reason',reason_),g);
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.v1_job_retry(uuid,text,text,uuid) OWNER TO sa_worker;
-- Explicit function privileges; clients get only the named public contracts.
DO $f$ DECLARE p record;BEGIN
 FOR p IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='sa_domain'::regnamespace AND proname IN
 ('ops_context','job_handler','job_projection','v1_jobs_list','v1_job_get','v1_audit_list','v1_job_retry','assert_service_worker','worker_write_fence','squad_job_claim','squad_job_execute','run_delegated_amendment') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',p.signature);
  IF p.proname NOT IN('squad_job_claim','squad_job_execute','run_delegated_amendment') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor,sa_worker',p.signature);END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.run_delegated_amendment(uuid) TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.squad_job_claim(integer),sa_domain.squad_job_execute(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION sa_domain.command_reason(text),sa_domain.actor(),sa_domain.cursor_id(text,jsonb),sa_domain.page_limit(integer),sa_domain.next_cursor(bigint,jsonb) TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.v1_jobs_list(text,text,integer),sa_domain.v1_job_get(uuid),sa_domain.v1_audit_list(text,bigint,text,integer),sa_domain.v1_job_retry(uuid,text,text,uuid) TO sa_app,authenticated;
CREATE FUNCTION canto_api.v1_jobs_list(p_state text DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_jobs_list(p_state,p_cursor,p_limit) $f$;
CREATE FUNCTION canto_api.v1_job_get(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_job_get(p_id) $f$;
CREATE FUNCTION canto_api.v1_audit_list(p_kind text DEFAULT NULL,p_entity_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_audit_list(p_kind,p_entity_id,p_cursor,p_limit) $f$;
CREATE FUNCTION canto_api.v1_job_retry(p_id uuid,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_job_retry(p_id,p_reason,p_expected_version,p_idempotency_key) $f$;
CREATE FUNCTION canto_api.squad_job_claim(p_limit integer DEFAULT 5) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_job_claim(p_limit) $f$;
CREATE FUNCTION canto_api.squad_job_execute(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_job_execute(p_id,p_lease_token) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_jobs_list(text,text,integer),canto_api.v1_job_get(uuid),canto_api.v1_audit_list(text,bigint,text,integer),canto_api.v1_job_retry(uuid,text,text,uuid),canto_api.squad_job_claim(integer),canto_api.squad_job_execute(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.v1_jobs_list(text,text,integer),canto_api.v1_job_get(uuid),canto_api.v1_audit_list(text,bigint,text,integer),canto_api.v1_job_retry(uuid,text,text,uuid) TO sa_app,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.squad_job_claim(integer),canto_api.squad_job_execute(uuid,uuid) TO service_role;
-- Record the source generation for future events, retaining earlier audit rows.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.finish_command(text,uuid,text,bigint,jsonb,jsonb)'::regprocedure);
 d:=replace(d,'command_key,changes)','command_key,changes,generation)');
 d:=replace(d,'p_id,p_key,p_changes);','p_id,p_key,p_changes,(SELECT generation FROM sa_domain.runtime_state));');
 EXECUTE d;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker,sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
