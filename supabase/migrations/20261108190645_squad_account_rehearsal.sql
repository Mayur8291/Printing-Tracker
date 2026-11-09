BEGIN;
-- Trusted-operator-only, exact synthetic account acceptance. Never a cutover,
-- global mail allowlist, generic worker bypass, or client-created capability.
CREATE TABLE sa_domain.account_rehearsals(
 flow_id uuid PRIMARY KEY,run_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose IN('register','confirm','recovery','invite')),
 email text NOT NULL UNIQUE,actor_id uuid NOT NULL,legacy_user_id bigint,auth_user_id uuid,
 generation bigint NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 CHECK((purpose='register')=(legacy_user_id IS NULL AND auth_user_id IS NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),UNIQUE(run_id,purpose)
);
CREATE TABLE sa_domain.account_rehearsal_revocations(
 flow_id uuid PRIMARY KEY REFERENCES sa_domain.account_rehearsals,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sa_domain.account_rehearsal_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.account_rehearsal_revocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sa_domain.account_rehearsal_revocations FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT SELECT ON sa_domain.account_rehearsal_revocations TO sa_account_writer;
CREATE POLICY account_rehearsal_revocation_read ON sa_domain.account_rehearsal_revocations FOR SELECT TO sa_account_writer USING(true);
CREATE TABLE sa_domain.account_rehearsal_receipts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,flow_id uuid NOT NULL REFERENCES sa_domain.account_rehearsals,
 phase text NOT NULL CHECK(phase IN('registered','request','prepare','provider','auth_change','finish','mail_claim','mail_prepare','mail_finish')),
 transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revision_before bigint NOT NULL,revision_after bigint NOT NULL CHECK(revision_after>=revision_before),
 snapshot jsonb NOT NULL
);
ALTER TABLE sa_domain.account_rehearsals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.account_rehearsals FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.account_rehearsal_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.account_rehearsal_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sa_domain.account_rehearsals,sa_domain.account_rehearsal_receipts FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT SELECT ON sa_domain.account_rehearsals,sa_domain.account_rehearsal_receipts TO sa_account_writer;
CREATE POLICY account_rehearsal_read ON sa_domain.account_rehearsals FOR SELECT TO sa_account_writer USING(true);
CREATE POLICY account_rehearsal_receipt_read ON sa_domain.account_rehearsal_receipts FOR SELECT TO sa_account_writer USING(true);
CREATE INDEX account_rehearsal_latest ON sa_domain.account_rehearsal_receipts(flow_id,id DESC);

-- Hashes never expose passwords, proof codes, profile contents or access tokens.
-- PostgreSQL ownership is necessary only to hash the exact bound Auth/source
-- rows; no arguments can name an arbitrary Auth user or table.
CREATE FUNCTION sa_domain.account_rehearsal_snapshot(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.account_rehearsals;f sa_domain.account_flows;person_ bigint;auth_ uuid;result_ jsonb;
BEGIN
 SELECT * INTO c FROM sa_domain.account_rehearsals WHERE flow_id=p_id;
 IF c.flow_id IS NULL THEN RAISE EXCEPTION 'Account rehearsal unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=p_id;
 person_:=coalesce(f.legacy_user_id,c.legacy_user_id);auth_:=coalesce(f.auth_user_id,c.auth_user_id);
 IF f.id IS NOT NULL AND(f.purpose<>c.purpose OR f.email<>c.email OR f.generation<>c.generation
  OR(c.purpose<>'register' AND ROW(f.legacy_user_id,f.auth_user_id) IS DISTINCT FROM ROW(c.legacy_user_id,c.auth_user_id))) THEN
  RAISE EXCEPTION 'Account rehearsal binding changed' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('legacy_user_id',person_,'auth_user_id',auth_,
  'actor',(SELECT jsonb_build_object('source_xmin',u.xmin::text,'source_hash',encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex'),
   'auth_hash',encode(sha256(convert_to(jsonb_build_object('id',a.id,'role',a.role,'email',a.email,'encrypted_password',a.encrypted_password,'banned_until',a.banned_until,'metadata',a.raw_app_meta_data)::text,'UTF8')),'hex'))
   FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id WHERE a.id=c.actor_id),
  'person',(SELECT jsonb_build_object('id',u.id,'xmin',u.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex')) FROM sa_snapshot_20261019.sa_users u WHERE u.id=person_),
  'mapping',(SELECT jsonb_build_object('xmin',m.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')) FROM sa_identity.sa_auth_identities m WHERE m.auth_user_id=auth_ AND m.legacy_user_id=person_ AND m.canonical_email=c.email),
  'auth',(SELECT jsonb_build_object('xmin',a.xmin::text,'hash',encode(sha256(convert_to(jsonb_build_object('id',a.id,'role',a.role,'email',a.email,'encrypted_password',a.encrypted_password,'banned_until',a.banned_until,'metadata',a.raw_app_meta_data)::text,'UTF8')),'hex')) FROM auth.users a WHERE a.id=auth_ AND a.role='sa_app' AND a.email=c.email),
  'addresses',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'xmin',x.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')) ORDER BY x.id),'[]') FROM sa_snapshot_20261019.sa_addresses x WHERE x.user_id=person_),
  'dealer_links',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'xmin',x.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')) ORDER BY x.id),'[]') FROM sa_snapshot_20261019.sa_user_dealers x WHERE x.user_id=person_),
  'flow',(SELECT jsonb_build_object('xmin',x.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),'state',x.state,'guest_actor_id',x.guest_actor_id,'sequence_id',x.sequence_id) FROM sa_domain.account_flows x WHERE x.id=p_id),
  'credential',(SELECT jsonb_build_object('xmin',s.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'),'revision',s.revision,'last_completed_flow',s.last_completed_flow) FROM sa_domain.credential_states s WHERE s.legacy_user_id=person_),
  'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id,'xmin',j.xmin::text,'hash',encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex'),'event',j.event_type,'status',j.status,'attempts',j.attempts) ORDER BY j.id),'[]') FROM sa_domain.outbox j WHERE j.command_key=p_id)
 ) INTO result_;
 RETURN result_;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_snapshot(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_rehearsal_snapshot(uuid) TO sa_account_writer;

CREATE FUNCTION sa_domain.account_rehearsal_register() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE s sa_sync.environment_state;r sa_domain.runtime_state;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Account rehearsal is immutable' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh active' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('account-rehearsal-register',784144));
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;
 SELECT * INTO r FROM sa_domain.runtime_state WHERE singleton;
 NEW.created_at:=clock_timestamp();
 IF s.environment IS DISTINCT FROM 'staging' OR s.cutover IS DISTINCT FROM false OR s.active_job IS NOT NULL
  OR r.allow_test_writes IS DISTINCT FROM true OR (NEW.actor_id=ANY(r.test_actor_ids)) IS NOT TRUE
  OR NEW.generation IS DISTINCT FROM r.generation OR NEW.expires_at IS NULL OR NEW.expires_at<=NEW.created_at
  OR NEW.expires_at>NEW.created_at+interval '15 minutes' OR r.test_write_expires_at IS NULL OR NEW.expires_at>r.test_write_expires_at
  OR NEW.email IS DISTINCT FROM 'squad-guest-'||replace(NEW.run_id::text,'-','')||'-'||NEW.purpose||'@mailinator.com'
  OR EXISTS(SELECT FROM sa_domain.account_flows WHERE id=NEW.flow_id)
  OR(SELECT count(*) FROM sa_domain.account_rehearsals x WHERE expires_at>NEW.created_at AND NOT EXISTS(SELECT FROM sa_domain.account_rehearsal_revocations v WHERE v.flow_id=x.flow_id))>=4 THEN
  RAISE EXCEPTION 'Account rehearsal scope unavailable' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id
  JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id WHERE a.id=NEW.actor_id AND a.role='sa_app'
  AND u.role=0 AND u.disabled IS NOT TRUE AND u.deleted_at IS NULL AND u.name='SQG '||replace(NEW.run_id::text,'-','')||' admin'
  AND u.created_at>=NEW.created_at-interval '15 minutes' AND a.created_at>=NEW.created_at-interval '15 minutes') THEN
  RAISE EXCEPTION 'Owned rehearsal administrator required' USING ERRCODE='42501';END IF;
 IF NEW.purpose='register' THEN
  IF EXISTS(SELECT FROM auth.users WHERE lower(email)=NEW.email) OR EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE canonical_email=NEW.email)
   OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE lower(email)=NEW.email) THEN RAISE EXCEPTION 'Registration email exists' USING ERRCODE='42501';END IF;
 ELSE
  IF (NEW.auth_user_id=ANY(r.test_actor_ids)) IS NOT TRUE OR NOT EXISTS(
   SELECT FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id
   WHERE a.id=NEW.auth_user_id AND m.legacy_user_id=NEW.legacy_user_id AND a.role='sa_app' AND u.role=3
    AND a.email=NEW.email AND m.canonical_email=NEW.email AND lower(btrim(u.email))=NEW.email
    AND u.name='SQG '||replace(NEW.run_id::text,'-','')||' '||NEW.purpose AND u.disabled IS NOT TRUE AND u.deleted_at IS NULL
    AND u.created_at>=NEW.created_at-interval '15 minutes' AND a.created_at>=NEW.created_at-interval '15 minutes') THEN
   RAISE EXCEPTION 'Owned rehearsal target required' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_register() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER account_rehearsal_registration BEFORE INSERT OR UPDATE ON sa_domain.account_rehearsals FOR EACH ROW EXECUTE FUNCTION sa_domain.account_rehearsal_register();

CREATE FUNCTION sa_domain.account_rehearsal_record(p_id uuid,p_phase text,p_before bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE after_ bigint;
BEGIN
 IF NOT EXISTS(SELECT FROM sa_domain.account_rehearsals WHERE flow_id=p_id) THEN RETURN;END IF;
 IF p_phase NOT IN('registered','request','prepare','provider','auth_change','finish','mail_claim','mail_prepare','mail_finish') OR p_before IS NULL THEN RAISE EXCEPTION 'Invalid account receipt' USING ERRCODE='22023';END IF;
 SELECT edit_revision INTO after_ FROM sa_sync.environment_state WHERE singleton;
 IF after_<p_before OR after_-p_before>1 THEN RAISE EXCEPTION 'Unexpected account revision delta' USING ERRCODE='42501';END IF;
 INSERT INTO sa_domain.account_rehearsal_receipts(flow_id,phase,revision_before,revision_after,snapshot)
 VALUES(p_id,p_phase,p_before,after_,sa_domain.account_rehearsal_snapshot(p_id));
END $f$;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_record(uuid,text,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_rehearsal_record(uuid,text,bigint) TO sa_account_writer;
CREATE FUNCTION sa_domain.account_rehearsal_seed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.account_rehearsal_record(NEW.flow_id,'registered',(SELECT edit_revision FROM sa_sync.environment_state WHERE singleton));RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_seed() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER account_rehearsal_initial_receipt AFTER INSERT ON sa_domain.account_rehearsals FOR EACH ROW EXECUTE FUNCTION sa_domain.account_rehearsal_seed();

GRANT CREATE ON SCHEMA sa_domain TO sa_account_writer;
CREATE FUNCTION sa_domain.account_rehearsal_scope(p_id uuid) RETURNS sa_domain.account_rehearsals
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.account_rehearsals;s sa_sync.environment_state;r sa_domain.runtime_state;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh active' USING ERRCODE='55000';END IF;
 SELECT * INTO c FROM sa_domain.account_rehearsals WHERE flow_id=p_id;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton FOR UPDATE;
 SELECT * INTO r FROM sa_domain.runtime_state WHERE singleton;
 IF c.flow_id IS NULL OR EXISTS(SELECT FROM sa_domain.account_rehearsal_revocations WHERE flow_id=c.flow_id) OR s.environment IS DISTINCT FROM 'staging' OR s.cutover IS DISTINCT FROM false OR s.active_job IS NOT NULL
  OR r.allow_test_writes IS DISTINCT FROM true OR(c.actor_id=ANY(r.test_actor_ids)) IS NOT TRUE
  OR c.generation IS DISTINCT FROM r.generation OR c.expires_at<=clock_timestamp() OR r.test_write_expires_at IS NULL
  OR r.test_write_expires_at<=clock_timestamp() OR c.expires_at>r.test_write_expires_at THEN
  RAISE EXCEPTION 'Account rehearsal scope unavailable' USING ERRCODE='55000';END IF;
 RETURN c;
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_scope(uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_scope(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.account_rehearsal_fence(p_id uuid,p_purpose text DEFAULT NULL,p_email text DEFAULT NULL,p_payload jsonb DEFAULT NULL,p_grant uuid DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.account_rehearsals;f sa_domain.account_flows;before_ jsonb;current_ jsonb;
BEGIN
 IF (SELECT cutover FROM sa_sync.environment_state WHERE singleton) THEN RETURN sa_domain.worker_write_fence();END IF;
 c:=sa_domain.account_rehearsal_scope(p_id);
 IF (p_purpose IS NOT NULL AND p_purpose<>c.purpose) OR(p_email IS NOT NULL AND p_email<>c.email)
 OR(p_payload IS NOT NULL AND encode(sha256(convert_to(p_payload::text,'UTF8')),'hex')<>c.payload_hash) THEN
  RAISE EXCEPTION 'Account rehearsal request differs' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=p_id;
 IF c.purpose='invite' AND p_payload IS NOT NULL AND NOT EXISTS(SELECT FROM sa_domain.invitation_grants g
  WHERE g.id=p_grant AND g.actor_id=c.actor_id AND g.legacy_user_id=c.legacy_user_id AND g.generation=c.generation
   AND(g.used_by IS NULL OR g.used_by=c.flow_id)) THEN RAISE EXCEPTION 'Invitation rehearsal differs' USING ERRCODE='42501';END IF;
 SELECT snapshot INTO before_ FROM sa_domain.account_rehearsal_receipts WHERE flow_id=p_id ORDER BY id DESC LIMIT 1;
 current_:=sa_domain.account_rehearsal_snapshot(p_id);
 -- Auth sign-in timestamps/xmin can advance independently; credential content
 -- cannot. Every meaningful provider mutation has its own appended receipt.
 IF (before_-'auth') IS DISTINCT FROM (current_-'auth') OR before_->'auth'->'hash' IS DISTINCT FROM current_->'auth'->'hash' THEN
  RAISE EXCEPTION 'Account changed outside its rehearsal' USING ERRCODE='42501';END IF;
 RETURN c.generation;
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_fence(uuid,text,text,jsonb,uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_fence(uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.account_rehearsal_invitation_fence(p_id bigint) RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.account_rehearsals;
BEGIN
 IF (SELECT cutover FROM sa_sync.environment_state WHERE singleton) THEN RETURN sa_domain.worker_write_fence();END IF;
 SELECT * INTO c FROM sa_domain.account_rehearsals WHERE purpose='invite' AND legacy_user_id=p_id AND actor_id=sa_domain.request_uid();
 RETURN sa_domain.account_rehearsal_fence(c.flow_id);
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_invitation_fence(bigint) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_invitation_fence(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.account_rehearsal_job_flow(p_id uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT f.id FROM sa_domain.outbox j JOIN sa_domain.account_flows f ON f.id=j.command_key
 JOIN sa_domain.account_rehearsals c ON c.flow_id=f.id WHERE j.id=p_id AND j.event_type='account.challenge_mail'
 AND j.aggregate_kind='maintenance' AND j.aggregate_id=f.sequence_id AND j.generation=c.generation
 AND j.actor_id=coalesce(f.actor_id,f.guest_actor_id) AND j.payload=jsonb_build_object('flow_id',f.id)
$f$;
ALTER FUNCTION sa_domain.account_rehearsal_job_flow(uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_job_flow(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.account_rehearsal_mail_fence(p_id uuid) RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF (SELECT cutover FROM sa_sync.environment_state WHERE singleton) THEN RETURN sa_domain.worker_write_fence();END IF;
 RETURN sa_domain.account_rehearsal_fence(sa_domain.account_rehearsal_job_flow(p_id));
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_mail_fence(uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_mail_fence(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;

-- Keep original logic/ACL/owners. Private invoker cores gain only the exact
-- flow fence; outer wrappers append immutable receipts for every return path.
DO $f$ DECLARE signature_ text;args_ text;flow_ text;fence_ text;phase_ text;definition_ text;name_ text;core_ text;wrapper_ text;needle_ text:='g:=sa_domain.worker_write_fence();';BEGIN
 FOR signature_,args_,flow_,fence_,phase_ IN SELECT * FROM(VALUES
 ('squad_account_flow_request(uuid,text,text,jsonb,text,text,text,boolean,uuid)','p_id,p_purpose,p_email,p_payload,p_input_fingerprint,p_code_hash,p_code_cipher,p_provider_available,p_invitation_grant','p_id','sa_domain.account_rehearsal_fence(p_id,p_purpose,p_email,p_payload,p_invitation_grant)','request'),
 ('squad_account_flow_prepare(uuid,text,text,text,text,boolean)','p_id,p_purpose,p_email,p_code_hash,p_password_fingerprint,p_provider_available','p_id','sa_domain.account_rehearsal_fence(p_id,p_purpose,p_email)','prepare'),
 ('squad_account_flow_finish(uuid,uuid,text)','p_id,p_lease_token,p_error','p_id','sa_domain.account_rehearsal_fence(p_id)','finish'),
 ('squad_account_mail_prepare(uuid,uuid)','p_id,p_lease_token','sa_domain.account_rehearsal_job_flow(p_id)','sa_domain.account_rehearsal_mail_fence(p_id)','mail_prepare'),
 ('squad_account_mail_finish(uuid,uuid,boolean,text)','p_id,p_lease_token,p_sent,p_error','sa_domain.account_rehearsal_job_flow(p_id)','sa_domain.account_rehearsal_mail_fence(p_id)','mail_finish')
 )x(signature,args,flow,fence,phase) LOOP
  definition_:=pg_get_functiondef(('sa_domain.'||signature_)::regprocedure);name_:=split_part(signature_,'(',1);core_:=replace(name_,'squad_account_','account_rehearsal_core_');
  IF (length(definition_)-length(replace(definition_,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Account fence contract changed';END IF;
  EXECUTE replace(replace(replace(definition_,'sa_domain.'||name_||'(','sa_domain.'||core_||'('),'SECURITY DEFINER','SECURITY INVOKER'),needle_,'g:='||fence_||';');
  EXECUTE format('ALTER FUNCTION sa_domain.%s OWNER TO sa_account_writer',replace(signature_,name_,core_));
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%s FROM PUBLIC,anon,authenticated,sa_app,service_role',replace(signature_,name_,core_));
  -- Reuse the original header including defaults/SECURITY DEFINER/search_path.
  wrapper_:=substring(definition_ from 1 for position('AS $function$' in definition_)-1);
  IF wrapper_='' THEN RAISE EXCEPTION 'Unexpected account function body format';END IF;
  wrapper_:=wrapper_||format($w$AS $body$ DECLARE result_ jsonb;before_ bigint;flow_ uuid:=%s;BEGIN
   IF EXISTS(SELECT FROM sa_domain.account_rehearsals WHERE flow_id=flow_) THEN PERFORM sa_domain.account_rehearsal_scope(flow_);END IF;
   SELECT edit_revision INTO before_ FROM sa_sync.environment_state WHERE singleton;
   result_:=sa_domain.%s(%s);
   PERFORM sa_domain.account_rehearsal_record(flow_,%L,before_);
   RETURN result_;
  END $body$$w$,flow_,core_,args_,phase_);
  EXECUTE wrapper_;
 END LOOP;
 definition_:=pg_get_functiondef('sa_domain.account_invitation_authorize(bigint)'::regprocedure);
 IF position(needle_ in definition_)=0 THEN RAISE EXCEPTION 'Invitation fence contract changed';END IF;
 EXECUTE replace(definition_,needle_,'g:=sa_domain.account_rehearsal_invitation_fence(p_id);');
END $f$;

-- GoTrue assigns a new registration Auth UUID only after email proof. Permit
-- that one prepared provider transaction, never an unregistered actor/UUID.
CREATE FUNCTION sa_domain.account_rehearsal_auth_allowed(p_auth uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.account_rehearsals;f sa_domain.account_flows;s sa_domain.credential_states;
BEGIN
 SELECT x.* INTO c FROM sa_domain.account_rehearsals x JOIN sa_domain.account_flows y ON y.id=x.flow_id
 WHERE y.auth_user_id=p_auth AND x.purpose='register' AND y.purpose='register' AND y.email=x.email;
 IF c.flow_id IS NULL THEN RETURN false;END IF;
 c:=sa_domain.account_rehearsal_scope(c.flow_id);
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=c.flow_id;
 SELECT * INTO s FROM sa_domain.credential_states WHERE legacy_user_id=f.legacy_user_id;
 RETURN coalesce(f.state='processing' AND f.generation=c.generation AND f.lease_until>clock_timestamp()
  AND s.active_flow=f.id AND s.lease_until>clock_timestamp() AND s.revision=f.credential_revision
  AND EXISTS(SELECT FROM sa_domain.account_rehearsal_receipts p WHERE p.flow_id=f.id AND p.phase='prepare'
   AND p.snapshot->>'auth_user_id'=p_auth::text AND p.snapshot->>'legacy_user_id'=f.legacy_user_id::text)
  AND EXISTS(SELECT FROM sa_identity.sa_auth_identities m WHERE m.auth_user_id=p_auth AND m.legacy_user_id=f.legacy_user_id AND m.canonical_email=c.email),false);
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_auth_allowed(uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_auth_allowed(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_rehearsal_auth_allowed(uuid) TO sa_executor;
DO $f$ DECLARE d text;needle_ text:='sa_domain.rehearsal_actor_allowed(OLD.id)';BEGIN
 d:=pg_get_functiondef('sa_domain.auth_write_fence()'::regprocedure);
 IF(length(d)-length(replace(d,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Unexpected Auth fence';END IF;
 EXECUTE replace(d,needle_,'(sa_domain.rehearsal_actor_allowed(OLD.id) OR sa_domain.account_rehearsal_auth_allowed(OLD.id))');
END $f$;

-- Pending trigger evidence is not cleanup authority. Only the existing
-- deferred credential fence can publish it after validating the real provider
-- marker and password revision in the same transaction.
CREATE TABLE sa_domain.account_rehearsal_auth_pending(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
 flow_id uuid NOT NULL,auth_user_id uuid NOT NULL,revision_before bigint NOT NULL,revision_after bigint NOT NULL,old_hash text,snapshot jsonb NOT NULL
);
ALTER TABLE sa_domain.account_rehearsal_auth_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.account_rehearsal_auth_pending FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sa_domain.account_rehearsal_auth_pending FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT SELECT,INSERT,DELETE ON sa_domain.account_rehearsal_auth_pending TO sa_account_writer;
GRANT USAGE ON SEQUENCE sa_domain.account_rehearsal_auth_pending_id_seq TO sa_account_writer;
CREATE POLICY account_rehearsal_pending_writer ON sa_domain.account_rehearsal_auth_pending TO sa_account_writer USING(true) WITH CHECK(true);
CREATE FUNCTION sa_domain.account_rehearsal_publish_auth(p_flow uuid,p_auth uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE count_ integer;
BEGIN
 IF NOT EXISTS(SELECT FROM sa_domain.account_rehearsals c JOIN sa_domain.account_flows f ON f.id=c.flow_id
  JOIN sa_domain.credential_states st ON st.legacy_user_id=f.legacy_user_id JOIN auth.users a ON a.id=f.auth_user_id
  WHERE f.id=p_flow AND f.auth_user_id=p_auth AND f.state='processing' AND f.lease_until>clock_timestamp()
   AND st.last_completed_flow=f.id AND st.revision=f.credential_revision+1 AND a.raw_app_meta_data->>'squad_account_flow'=f.id::text) THEN
  RAISE EXCEPTION 'Provider transaction is not committed' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO count_ FROM sa_domain.account_rehearsal_auth_pending WHERE transaction_id=pg_current_xact_id() AND auth_user_id=p_auth;
 IF count_>8 OR EXISTS(SELECT FROM sa_domain.account_rehearsal_auth_pending WHERE transaction_id=pg_current_xact_id() AND auth_user_id=p_auth
  AND(flow_id<>p_flow OR revision_after NOT BETWEEN revision_before AND revision_before+1)) THEN RAISE EXCEPTION 'Unexpected provider mutations' USING ERRCODE='42501';END IF;
 IF EXISTS(
  SELECT FROM (SELECT old_hash,row_number() OVER(ORDER BY id) AS n,
   lag(snapshot->'auth'->>'hash') OVER(ORDER BY id) AS previous_hash
   FROM sa_domain.account_rehearsal_auth_pending WHERE transaction_id=pg_current_xact_id() AND auth_user_id=p_auth) x
  WHERE x.old_hash IS DISTINCT FROM CASE WHEN n=1 THEN
   (SELECT snapshot->'auth'->>'hash' FROM sa_domain.account_rehearsal_receipts WHERE flow_id=p_flow ORDER BY id DESC LIMIT 1)
   ELSE previous_hash END
 ) THEN RAISE EXCEPTION 'Auth changed before provider ownership' USING ERRCODE='42501';END IF;
 INSERT INTO sa_domain.account_rehearsal_receipts(flow_id,phase,revision_before,revision_after,snapshot)
 SELECT flow_id,'auth_change',revision_before,revision_after,snapshot FROM sa_domain.account_rehearsal_auth_pending
 WHERE transaction_id=pg_current_xact_id() AND auth_user_id=p_auth ORDER BY id;
 DELETE FROM sa_domain.account_rehearsal_auth_pending WHERE transaction_id=pg_current_xact_id() AND auth_user_id=p_auth;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_publish_auth(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_rehearsal_publish_auth(uuid,uuid) TO sa_account_writer;
-- Exact credential deltas are retained separately from business audit count.
-- Noncredential sign-in timestamps deliberately do not create a revision.
CREATE FUNCTION sa_domain.account_rehearsal_auth_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE flow_ uuid;before_ bigint;c sa_domain.account_rehearsals;old_hash_ text;delta_ integer:=0;
BEGIN
 IF NEW.role IS DISTINCT FROM 'sa_app' OR(current_setting('squad.source_enrollment',true)='on' AND pg_has_role(session_user,'postgres','MEMBER')) THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND OLD.role='sa_app' THEN
  IF ROW(NEW.encrypted_password,NEW.email,NEW.banned_until,NEW.raw_app_meta_data,NEW.role)
   IS NOT DISTINCT FROM ROW(OLD.encrypted_password,OLD.email,OLD.banned_until,OLD.raw_app_meta_data,OLD.role) THEN RETURN NEW;END IF;
  old_hash_:=encode(sha256(convert_to(jsonb_build_object('id',OLD.id,'role',OLD.role,'email',OLD.email,'encrypted_password',OLD.encrypted_password,'banned_until',OLD.banned_until,'metadata',OLD.raw_app_meta_data)::text,'UTF8')),'hex');
  delta_:=CASE WHEN ROW(NEW.encrypted_password,NEW.email,NEW.banned_until) IS DISTINCT FROM ROW(OLD.encrypted_password,OLD.email,OLD.banned_until) THEN 1 ELSE 0 END;
 END IF;
 SELECT f.id INTO flow_ FROM sa_domain.account_flows f JOIN sa_domain.account_rehearsals x ON x.flow_id=f.id
 WHERE f.auth_user_id=NEW.id AND f.email=NEW.email AND f.state='processing' AND f.lease_until>clock_timestamp();
 IF flow_ IS NULL THEN RETURN NEW;END IF;
 c:=sa_domain.account_rehearsal_scope(flow_);
 SELECT edit_revision-delta_ INTO before_ FROM sa_sync.environment_state WHERE singleton;
 INSERT INTO sa_domain.account_rehearsal_auth_pending(flow_id,auth_user_id,revision_before,revision_after,old_hash,snapshot)
 VALUES(flow_,NEW.id,before_,before_+delta_,old_hash_,sa_domain.account_rehearsal_snapshot(flow_));
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_auth_receipt() OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_auth_receipt() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER squad_account_rehearsal_auth_receipt AFTER INSERT OR UPDATE OF encrypted_password,email,banned_until,raw_app_meta_data,role ON auth.users
 FOR EACH ROW EXECUTE FUNCTION sa_domain.account_rehearsal_auth_receipt();
DO $f$ DECLARE d text;needle_ text:='active_flow=NULL,lease_until=NULL,generation=g WHERE legacy_user_id=attempt_.legacy_user_id;';BEGIN
 d:=pg_get_functiondef('sa_domain.account_credential_fence()'::regprocedure);
 IF(length(d)-length(replace(d,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Credential receipt hook changed';END IF;
 EXECUTE replace(d,needle_,needle_||$s$
 IF attempt_.marker_supplied AND EXISTS(SELECT FROM sa_domain.account_rehearsals WHERE flow_id=flow_.id) THEN
  PERFORM sa_domain.account_rehearsal_scope(flow_.id);
  PERFORM sa_domain.account_rehearsal_publish_auth(flow_.id,attempt_.auth_user_id);
  PERFORM sa_domain.account_rehearsal_record(flow_.id,'provider',(SELECT edit_revision FROM sa_sync.environment_state WHERE singleton));
 END IF;$s$);
END $f$;

CREATE FUNCTION sa_domain.account_rehearsal_pending_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 DELETE FROM sa_domain.account_rehearsal_auth_pending WHERE transaction_id=pg_current_xact_id() AND auth_user_id=NEW.id;
 RETURN NULL;
END $f$;
ALTER FUNCTION sa_domain.account_rehearsal_pending_cleanup() OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_rehearsal_pending_cleanup() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE CONSTRAINT TRIGGER zz_squad_account_rehearsal_pending_cleanup AFTER INSERT OR UPDATE OF encrypted_password,email,banned_until,raw_app_meta_data,role ON auth.users
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sa_domain.account_rehearsal_pending_cleanup();

-- One exact challenge job. No queue enumeration, heartbeat, maintenance,
-- reconciliation, push notification or unrelated provider execution.
GRANT INSERT ON sa_domain.job_attempts TO sa_account_writer;
CREATE FUNCTION sa_domain.squad_account_rehearsal_claim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE flow_ uuid;c sa_domain.account_rehearsals;j sa_domain.outbox;token_ uuid:=gen_random_uuid();before_ bigint;
BEGIN
 PERFORM sa_domain.assert_service_worker();flow_:=sa_domain.account_rehearsal_job_flow(p_id);
 PERFORM sa_domain.account_rehearsal_fence(flow_);c:=sa_domain.account_rehearsal_scope(flow_);
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.status IN('done','dead') OR(j.status='leased' AND j.lease_until>clock_timestamp())
  OR(j.status='pending' AND j.available_at>clock_timestamp()) THEN RETURN jsonb_build_object('jobs','[]'::jsonb);END IF;
 -- An uncertain SMTP send must be reviewed, never blindly delivered twice by
 -- this acceptance harness. Native retries retain their existing behavior.
 IF j.status<>'pending' OR j.attempts<>0 THEN RAISE EXCEPTION 'Review uncertain account delivery' USING ERRCODE='55000';END IF;
 SELECT edit_revision INTO before_ FROM sa_sync.environment_state WHERE singleton;
 UPDATE sa_domain.outbox SET status='leased',lease_token=token_,lease_until=least(clock_timestamp()+interval '90 seconds',c.expires_at),attempts=1,revision=revision+1 WHERE id=p_id RETURNING * INTO j;
 INSERT INTO sa_domain.job_attempts(job_id,lease_token,attempt,state) VALUES(j.id,token_,1,'leased');
 PERFORM sa_domain.account_rehearsal_record(flow_,'mail_claim',before_);
 RETURN jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('id',j.id,'lease_token',token_,'handler','account_mail')),
  'recipient',c.email,'flow_id',flow_,'purpose',c.purpose,'expires_at',c.expires_at);
END $f$;
ALTER FUNCTION sa_domain.squad_account_rehearsal_claim(uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.squad_account_rehearsal_claim(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_account_rehearsal_claim(uuid) TO service_role;
CREATE FUNCTION canto_api.squad_account_rehearsal_claim(p_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.squad_account_rehearsal_claim(p_id)
$f$;
REVOKE ALL ON FUNCTION canto_api.squad_account_rehearsal_claim(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_account_rehearsal_claim(uuid) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_account_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
