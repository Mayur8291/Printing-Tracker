BEGIN;
DO $f$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_account_writer') THEN CREATE ROLE sa_account_writer NOLOGIN NOINHERIT NOBYPASSRLS;END IF;END $f$;
GRANT sa_account_writer TO postgres;
GRANT USAGE ON SCHEMA sa_domain,sa_snapshot_20261019,sa_identity,sa_sync,sa_admin TO sa_account_writer;
GRANT CREATE ON SCHEMA sa_domain TO sa_account_writer,sa_guard;
GRANT SELECT ON sa_domain.runtime_state,sa_sync.environment_state,sa_domain.entity_versions,sa_domain.commands,sa_domain.outbox,sa_domain.job_attempts,sa_domain.account_requests TO sa_account_writer;
GRANT INSERT,UPDATE ON sa_domain.commands,sa_domain.entity_versions,sa_domain.account_requests TO sa_account_writer;
GRANT INSERT,UPDATE ON sa_domain.outbox TO sa_account_writer;
GRANT UPDATE ON sa_domain.job_attempts TO sa_account_writer;
GRANT INSERT ON sa_domain.audit TO sa_account_writer;
GRANT UPDATE(edit_revision,updated_at) ON sa_sync.environment_state TO sa_account_writer;
GRANT USAGE ON SEQUENCE sa_domain.audit_id_seq,sa_domain.outbox_sequence_id_seq TO sa_account_writer;
CREATE POLICY account_runtime ON sa_domain.runtime_state FOR SELECT TO sa_account_writer USING(true);
CREATE POLICY account_environment ON sa_sync.environment_state TO sa_account_writer USING(singleton) WITH CHECK(singleton);
CREATE POLICY account_versions ON sa_domain.entity_versions TO sa_account_writer USING(true) WITH CHECK(true);
CREATE POLICY account_commands ON sa_domain.commands TO sa_account_writer USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
CREATE POLICY account_outbox ON sa_domain.outbox TO sa_account_writer USING(true) WITH CHECK(true);
CREATE POLICY account_attempts ON sa_domain.job_attempts TO sa_account_writer USING(true) WITH CHECK(true);
CREATE POLICY account_audit ON sa_domain.audit FOR INSERT TO sa_account_writer WITH CHECK(true);
CREATE POLICY account_requests_writer ON sa_domain.account_requests TO sa_account_writer USING(true) WITH CHECK(true);
ALTER TABLE sa_domain.account_requests ADD COLUMN job_id uuid REFERENCES sa_domain.outbox,ADD COLUMN desired jsonb,ADD COLUMN result jsonb;
ALTER TABLE sa_domain.account_requests DROP CONSTRAINT account_requests_state_check;
ALTER TABLE sa_domain.account_requests ADD CONSTRAINT account_requests_state_check CHECK(state IN('queued','processing','ready','blocked','failed','discarded'));
GRANT SELECT,INSERT ON sa_sync.legacy_identity_keys,sa_identity.sa_auth_identities TO sa_account_writer;
GRANT UPDATE(enrollment_state) ON sa_identity.sa_auth_identities TO sa_account_writer;
CREATE POLICY account_identity ON sa_identity.sa_auth_identities TO sa_account_writer USING(true) WITH CHECK(true);
CREATE POLICY account_identity_keys ON sa_sync.legacy_identity_keys TO sa_account_writer USING(true) WITH CHECK(true);
GRANT SELECT(id,email,name,role,disabled,deleted_at,approved,confirmed_at,encrypted_password,updated_at),UPDATE(disabled,disabled_at,deleted_at,updated_at)
 ON sa_snapshot_20261019.sa_users TO sa_account_writer;
CREATE POLICY account_people ON sa_snapshot_20261019.sa_users TO sa_account_writer USING(true) WITH CHECK(true);

-- One command envelope works for a verified application actor or platform staff.
-- Every business entry point retains its own role checks; mirror fencing is unchanged.
DO $f$ DECLARE n text;d text;BEGIN
 FOREACH n IN ARRAY ARRAY['sa_domain.begin_command(text,uuid,jsonb)','sa_domain.finish_command(text,uuid,text,bigint,jsonb,jsonb)'] LOOP
  d:=pg_get_functiondef(n::regprocedure);
  d:=replace(d,'a sa_domain.actor:=sa_domain.actor()','ctx jsonb:=sa_domain.ops_context()');
  d:=replace(d,'a.auth_id',$s$(ctx->>'auth_id')::uuid$s$);d:=replace(d,'a.user_id',$s$(ctx->>'legacy_user_id')::bigint$s$);EXECUTE d;
 END LOOP;
 d:=pg_get_functiondef('sa_domain.person_dependencies(bigint)'::regprocedure);
 d:=replace(d,'IF NOT sa_domain.can_manage_person(p_id) THEN',$s$IF NOT(sa_domain.ops_context()->>'platform')::boolean AND NOT sa_domain.can_manage_person(p_id) THEN$s$);EXECUTE d;
END $f$;

-- Hosted Auth tables cannot grant this executor DELETE privileges. This second,
-- narrowly reviewed postgres bridge only removes sessions for the mapped legacy
-- target of a queued, authorized account operation. It never reads password
-- material, changes Auth identity fields, or accepts an arbitrary Auth UUID.
CREATE FUNCTION sa_domain.revoke_account_sessions(p_legacy_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();id_ uuid;count_ integer;
BEGIN
 IF NOT EXISTS(SELECT FROM sa_domain.account_requests r JOIN sa_domain.runtime_state s ON r.generation=s.generation
 WHERE r.legacy_user_id=p_legacy_id AND r.actor_id=(ctx->>'auth_id')::uuid AND r.state='queued') THEN RAISE EXCEPTION 'Account intent required' USING ERRCODE='42501';END IF;
 IF NOT((ctx->>'platform')::boolean OR sa_domain.can_manage_person(p_legacy_id)) OR p_legacy_id=(ctx->>'legacy_user_id')::bigint THEN RAISE EXCEPTION 'Session revocation unavailable' USING ERRCODE='42501';END IF;
 -- Serialize with GoTrue sign-in before removing refresh tokens and sessions.
 SELECT a.id INTO id_ FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id
 WHERE m.legacy_user_id=p_legacy_id AND a.role='sa_app' AND lower(btrim(a.email))=m.canonical_email FOR UPDATE OF a;
 IF id_ IS NULL THEN RETURN 0;END IF;
 DELETE FROM auth.refresh_tokens WHERE user_id=id_::text;
 DELETE FROM auth.sessions WHERE user_id=id_;GET DIAGNOSTICS count_=ROW_COUNT;RETURN count_;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.revoke_account_sessions(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_executor,sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.revoke_account_sessions(bigint) TO sa_account_writer;
COMMENT ON FUNCTION sa_domain.revoke_account_sessions(bigint) IS 'Reviewed hosted-Auth privilege bridge: queued current-actor account intent, scoped mapped legacy ID, Auth row lock and DELETE sessions/refresh tokens only. Never Auth account/password writes.';

CREATE FUNCTION sa_domain.queue_account(p_id bigint,p_job_id uuid,p_revoke boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();request_ uuid;BEGIN
 INSERT INTO sa_domain.account_requests(legacy_user_id,generation,actor_id,job_id)
 SELECT p_id,generation,(ctx->>'auth_id')::uuid,p_job_id FROM sa_domain.runtime_state
 ON CONFLICT(legacy_user_id,generation) DO UPDATE SET actor_id=excluded.actor_id,job_id=excluded.job_id,state='queued',error_code=NULL,desired=NULL,result=NULL,updated_at=now() RETURNING id INTO request_;
 IF p_revoke THEN PERFORM sa_domain.revoke_account_sessions(p_id);END IF;RETURN request_;
END $f$;
ALTER FUNCTION sa_domain.queue_account(bigint,uuid,boolean) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.queue_account(bigint,uuid,boolean) FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.queue_account(bigint,uuid,boolean) TO sa_executor,sa_account_writer;
CREATE OR REPLACE FUNCTION sa_domain.job_handler(p_event text,p_payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN p_event='order.edited' AND nullif(p_payload->>'request_id','') IS NOT NULL THEN
 CASE WHEN p_payload->>'provider_confirmation_required'='false' THEN 'local_amendment' ELSE 'provider_order' END
 WHEN p_event IN('account.status_changed','person.archived','customer.reviewed') OR p_event IN('person.saved','person.team_saved') AND(p_payload->>'created'='true' OR p_payload->>'role_changed'='true') THEN 'account_reconciliation'
 ELSE 'notification_dispatch' END
$f$;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.finish_command(text,uuid,text,bigint,jsonb,jsonb)'::regprocedure);
 d:=replace(d,' UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1',$s$
 IF sa_domain.job_handler(p_operation,p_changes)='account_reconciliation' THEN
  PERFORM sa_domain.queue_account(p_id,(SELECT id FROM sa_domain.outbox WHERE actor_id=(ctx->>'auth_id')::uuid AND command_key=p_key AND event_type=p_operation AND aggregate_kind=p_kind AND aggregate_id=p_id),
   p_operation IN('account.status_changed','person.archived') OR p_changes->>'role_changed'='true' OR p_operation='customer.reviewed' AND p_changes->'after'?'approved');
 END IF;
 UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1$s$);EXECUTE d;
 -- The oldest imported intent remains historical; show only this generation.
 d:=pg_get_functiondef('sa_domain.v1_person_get(bigint)'::regprocedure);
 d:=replace(d,'FROM sa_domain.account_requests WHERE legacy_user_id=p_id)', 'FROM sa_domain.account_requests WHERE legacy_user_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state))');EXECUTE d;
END $f$;

CREATE FUNCTION sa_domain.account_user_status(p_id bigint,p_action text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();u record;cached_ jsonb;version_ text;deps_ jsonb;
BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN('enable','disable','archive') THEN RAISE EXCEPTION 'Unknown account action' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.command_reason(p_reason);
 cached_:=sa_domain.begin_command('account.status_changed',p_idempotency_key,jsonb_build_object('id',p_id,'action',p_action,'reason',p_reason,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 PERFORM sa_domain.person_structure_fence();PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));
 SELECT id,role,disabled,deleted_at INTO u FROM sa_snapshot_20261019.sa_users WHERE id=p_id FOR UPDATE;
 IF u.id IS NULL OR u.role=0 OR p_id=(ctx->>'legacy_user_id')::bigint THEN RAISE EXCEPTION 'Protected or unavailable account' USING ERRCODE='42501';END IF;
 IF u.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Archived accounts cannot be restored through login controls' USING ERRCODE='55000';END IF;
 IF p_action='archive' THEN deps_:=sa_domain.person_dependencies(p_id);IF deps_<>'[]'::jsonb THEN RAISE EXCEPTION 'Resolve account dependencies before archiving' USING ERRCODE='55000';END IF;END IF;
 version_:=sa_domain.bump_version('person',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET disabled=p_action<>'enable',disabled_at=CASE WHEN p_action<>'enable' THEN now() AT TIME ZONE 'UTC' END,
 deleted_at=CASE WHEN p_action='archive' THEN now() AT TIME ZONE 'UTC' ELSE deleted_at END,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 RETURN sa_domain.finish_command('account.status_changed',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',version_,'state',CASE p_action WHEN 'enable' THEN 'enabled' WHEN 'disable' THEN 'disabled' ELSE 'archived' END,'account_reconciliation','queued'),jsonb_build_object('action',p_action,'reason',p_reason,'revoke_sessions',true));
END $f$;
ALTER FUNCTION sa_domain.account_user_status(bigint,text,text,text,uuid) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.account_target(p_id bigint) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('legacy_user_id',id::text,'email',lower(btrim(email)),'legacy_role_id',role,'source_confirmed',confirmed_at IS NOT NULL,
 'allowed',deleted_at IS NULL AND disabled IS NOT TRUE AND NOT(role=3 AND approved IS FALSE) AND role IN(0,1,2,3,4,7,8,9,10,11,12),
 'version',sa_domain.version('person',id),'updated_at',updated_at,'generation',(SELECT generation FROM sa_domain.runtime_state))
 FROM sa_snapshot_20261019.sa_users WHERE id=p_id
$f$;
CREATE FUNCTION sa_domain.squad_account_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;r sa_domain.account_requests;m sa_identity.sa_auth_identities;target_ jsonb;hash_ text;g bigint;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 PERFORM pg_advisory_xact_lock(hashtextextended('account-reconcile:'||(SELECT aggregate_id FROM sa_domain.outbox WHERE id=p_id),784139));
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.status<>'leased' OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.lease_until<=statement_timestamp()
 OR sa_domain.job_handler(j.event_type,j.payload)<>'account_reconciliation' THEN RAISE EXCEPTION 'Account lease unavailable' USING ERRCODE='40001';END IF;
 SELECT * INTO r FROM sa_domain.account_requests WHERE legacy_user_id=j.aggregate_id AND generation=g FOR UPDATE;
 IF r.id IS NULL OR r.job_id<>j.id THEN RETURN jsonb_build_object('superseded',true);END IF;
 target_:=sa_domain.account_target(j.aggregate_id);
 IF target_ IS NULL THEN RAISE EXCEPTION 'Source account unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person-email:'||(target_->>'email'),784139));
 IF target_->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+$' OR (SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=target_->>'email')<>1
 OR EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE canonical_email=target_->>'email' AND legacy_user_id<>j.aggregate_id) THEN RAISE EXCEPTION 'Account identity conflict' USING ERRCODE='23505';END IF;
 INSERT INTO sa_sync.legacy_identity_keys VALUES(j.aggregate_id) ON CONFLICT DO NOTHING;
 INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis)
 VALUES(r.reserved_auth_id,j.aggregate_id,target_->>'email','candidate',CASE WHEN(target_->>'allowed')::boolean THEN 'ready' ELSE 'blocked' END,(target_->>'source_confirmed')::boolean,'not_activated') ON CONFLICT(legacy_user_id) DO NOTHING;
 SELECT * INTO m FROM sa_identity.sa_auth_identities WHERE legacy_user_id=j.aggregate_id;
 IF m.canonical_email<>target_->>'email' OR m.import_disposition='identity_exception' THEN RAISE EXCEPTION 'Account identity conflict' USING ERRCODE='23505';END IF;
 UPDATE sa_identity.sa_auth_identities SET enrollment_state=CASE WHEN(target_->>'allowed')::boolean THEN 'ready' ELSE 'blocked' END WHERE legacy_user_id=j.aggregate_id;
 target_:=target_||jsonb_build_object('auth_user_id',m.auth_user_id);
 UPDATE sa_domain.account_requests SET state='processing',desired=target_,updated_at=now() WHERE id=r.id;
 -- Preparation renews a full lease before bounded provider calls begin.
 UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
 -- Old disabled users may never have had a GoTrue account. Preserve their bcrypt
 -- password on first activation; existing GoTrue passwords are never replaced.
 SELECT encrypted_password INTO hash_ FROM sa_snapshot_20261019.sa_users WHERE id=j.aggregate_id;
 RETURN target_||jsonb_build_object('password_hash',CASE WHEN hash_~'^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$' THEN hash_ END);
END $f$;
ALTER FUNCTION sa_domain.squad_account_prepare(uuid,uuid) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.squad_account_finish(p_id uuid,p_lease_token uuid,p_result jsonb,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;r sa_domain.account_requests;g bigint;target_ jsonb;retry_ boolean;state_ text;error_ text:=p_error;superseded_ boolean;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 PERFORM pg_advisory_xact_lock(hashtextextended('account-reconcile:'||(SELECT aggregate_id FROM sa_domain.outbox WHERE id=p_id),784139));
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR sa_domain.job_handler(j.event_type,j.payload)<>'account_reconciliation' THEN RAISE EXCEPTION 'Account lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Account lease expired' USING ERRCODE='40001';END IF;
 IF p_error IS NOT NULL AND p_error NOT IN('PROVIDER_UNAVAILABLE','IDENTITY_CONFLICT','ACCOUNT_UNAVAILABLE') THEN RAISE EXCEPTION 'Invalid account error' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.check_fields(p_result,ARRAY['auth_user_id','exists','confirmed','superseded']);
 SELECT * INTO r FROM sa_domain.account_requests WHERE legacy_user_id=j.aggregate_id AND generation=g FOR UPDATE;
 superseded_:=r.id IS NULL OR r.job_id<>j.id;
 IF NOT superseded_ AND error_ IS NULL THEN
  target_:=sa_domain.account_target(j.aggregate_id)||jsonb_build_object('auth_user_id',r.desired->'auth_user_id');
  IF r.desired IS NULL OR target_ IS DISTINCT FROM r.desired THEN error_:='ACCOUNT_SOURCE_CHANGED';
  ELSIF p_result->>'auth_user_id' IS DISTINCT FROM r.desired->>'auth_user_id' OR jsonb_typeof(p_result->'exists') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_result->'confirmed') IS DISTINCT FROM 'boolean' OR((r.desired->>'allowed')::boolean AND NOT(p_result->>'exists')::boolean) THEN RAISE EXCEPTION 'Invalid account attestation' USING ERRCODE='22023';END IF;
 END IF;
 retry_:=error_ IN('PROVIDER_UNAVAILABLE','ACCOUNT_SOURCE_CHANGED') AND j.attempts<5;
 state_:=CASE WHEN superseded_ OR error_ IS NULL THEN 'done' WHEN retry_ THEN 'pending' ELSE 'dead' END;
 UPDATE sa_domain.outbox SET status=state_,result=CASE WHEN state_='done' THEN jsonb_build_object('superseded',superseded_,'exists',p_result->'exists','confirmed',p_result->'confirmed') END,
 last_error_code=CASE WHEN superseded_ THEN NULL ELSE error_ END,completed_at=CASE WHEN state_ IN('done','dead') THEN now() END,
 lease_until=NULL,lease_token=CASE WHEN state_='done' THEN lease_token END,available_at=now()+make_interval(secs=>least(300,5*power(2,j.attempts)::integer)),revision=revision+1 WHERE id=j.id;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN state_='done' THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=error_ WHERE lease_token=p_lease_token;
 -- A stale provider call may finish after a newer intent. Invalidate an
 -- in-flight newer attestation, or requeue its completed reconciliation. Never
 -- accept the older response as evidence of the current provider state.
 IF superseded_ AND r.id IS NOT NULL AND r.job_id IS NOT NULL AND r.desired IS NOT NULL THEN
  UPDATE sa_domain.outbox SET status='pending',available_at=now(),completed_at=NULL,
   attempts=0,lease_token=NULL,lease_until=NULL,revision=revision+1,last_error_code='ACCOUNT_SOURCE_CHANGED'
   WHERE id=r.job_id AND status='done';
  UPDATE sa_domain.account_requests SET desired=NULL,state=CASE WHEN state IN('ready','blocked') THEN 'queued' ELSE state END,updated_at=now() WHERE id=r.id;
 END IF;
 IF NOT superseded_ THEN
  UPDATE sa_domain.account_requests SET state=CASE WHEN state_='done' THEN CASE WHEN(desired->>'allowed')::boolean THEN 'ready' ELSE 'blocked' END WHEN state_='pending' THEN 'queued' ELSE 'failed' END,error_code=error_,result=p_result,updated_at=now() WHERE id=r.id;
  IF state_='done' THEN INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
   VALUES(j.actor_id,j.event_type||'.notify',j.aggregate_kind,j.aggregate_id,j.command_key,g,j.payload||jsonb_build_object('source_event',j.event_type)) ON CONFLICT DO NOTHING;END IF;
 END IF;
 RETURN jsonb_build_object('id',j.id,'state',state_,'error_code',error_);
END $f$;
ALTER FUNCTION sa_domain.squad_account_finish(uuid,uuid,jsonb,text) OWNER TO sa_account_writer;

-- Enable only this installed handler, preserving all other pending integrations.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);d:=replace(d,$s$sa_domain.job_handler(event_type,payload)='local_amendment'$s$,$s$sa_domain.job_handler(event_type,payload) IN('local_amendment','account_reconciliation')$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.job_projection(sa_domain.outbox)'::regprocedure);d:=replace(d,$s$sa_domain.job_handler(p_job.event_type,p_job.payload)='local_amendment'$s$,$s$sa_domain.job_handler(p_job.event_type,p_job.payload) IN('local_amendment','account_reconciliation')$s$);EXECUTE d;
END $f$;
-- Existing dashboard administrators can operate account reconciliation without
-- gaining customer-order/job visibility or legacy business-admin authority.
ALTER POLICY squad_job_read ON sa_domain.outbox USING(
 actor_id=((SELECT sa_domain.ops_context())->>'auth_id')::uuid OR ((SELECT sa_domain.ops_context())->>'admin')::boolean
 OR (((SELECT sa_domain.ops_context())->>'platform')::boolean AND(aggregate_kind IN('integration','import','export','document','media','maintenance') OR sa_domain.job_handler(event_type,payload)='account_reconciliation')));
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_job_retry(uuid,text,text,uuid)'::regprocedure);
 d:=replace(d,$s$j.aggregate_kind NOT IN('integration','import','export','document','media','maintenance')$s$,$s$j.aggregate_kind NOT IN('integration','import','export','document','media','maintenance') AND sa_domain.job_handler(j.event_type,j.payload)<>'account_reconciliation'$s$);EXECUTE d;
END $f$;
CREATE INDEX squad_outbox_accounts ON sa_domain.outbox(available_at,sequence_id) WHERE status IN('pending','leased') AND sa_domain.job_handler(event_type,payload)='account_reconciliation';

GRANT EXECUTE ON FUNCTION sa_domain.ops_context(),sa_domain.worker_actor_id(),sa_domain.request_uid(),sa_domain.command_reason(text),sa_domain.begin_command(text,uuid,jsonb),sa_domain.finish_command(text,uuid,text,bigint,jsonb,jsonb),sa_domain.person_structure_fence(),sa_domain.person_dependencies(bigint),sa_domain.bump_version(text,bigint,text),sa_domain.version(text,bigint),sa_domain.check_fields(jsonb,text[]),sa_domain.job_handler(text,jsonb),sa_domain.assert_service_worker(),sa_domain.worker_write_fence() TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_target(bigint),sa_domain.account_user_status(bigint,text,text,text,uuid),sa_domain.squad_account_prepare(uuid,uuid),sa_domain.squad_account_finish(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_target(bigint) TO sa_account_writer;
GRANT EXECUTE ON FUNCTION sa_domain.account_user_status(bigint,text,text,text,uuid) TO authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.squad_account_prepare(uuid,uuid),sa_domain.squad_account_finish(uuid,uuid,jsonb,text) TO service_role;
CREATE FUNCTION canto_api.account_user_status(p_id bigint,p_action text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_user_status(p_id,p_action,p_reason,p_expected_version,p_idempotency_key) $f$;
CREATE FUNCTION canto_api.squad_account_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_prepare(p_id,p_lease_token) $f$;
CREATE FUNCTION canto_api.squad_account_finish(p_id uuid,p_lease_token uuid,p_result jsonb,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_finish(p_id,p_lease_token,p_result,p_error) $f$;
REVOKE ALL ON FUNCTION canto_api.account_user_status(bigint,text,text,text,uuid),canto_api.squad_account_prepare(uuid,uuid),canto_api.squad_account_finish(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.account_user_status(bigint,text,text,text,uuid) TO sa_app,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.squad_account_prepare(uuid,uuid),canto_api.squad_account_finish(uuid,uuid,jsonb,text) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_account_writer,sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
