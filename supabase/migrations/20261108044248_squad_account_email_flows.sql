BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_account_writer,sa_guard;
CREATE TABLE sa_domain.account_flows(
 id uuid PRIMARY KEY,sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 purpose text NOT NULL CHECK(purpose IN('register','confirm','recovery','invite')),email text NOT NULL,
 actor_id uuid,guest_actor_id uuid NOT NULL DEFAULT gen_random_uuid(),legacy_user_id bigint,auth_user_id uuid,generation bigint NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}',input_fingerprint text NOT NULL CHECK(input_fingerprint~'^[a-f0-9]{64}$'),
 code_hash text NOT NULL CHECK(code_hash~'^[a-f0-9]{64}$'),code_cipher text CHECK(length(code_cipher)<=256),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','done','expired','failed','dummy')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),password_fingerprint text,
 credential_revision bigint NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '15 minutes'),
 updated_at timestamptz NOT NULL DEFAULT now(),mail_state text NOT NULL DEFAULT 'queued' CHECK(mail_state IN('queued','sent','failed','skipped'))
);
ALTER TABLE sa_domain.account_flows ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.account_flows FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.account_flows TO sa_account_writer;
GRANT USAGE ON SEQUENCE sa_domain.account_flows_sequence_id_seq TO sa_account_writer;
CREATE POLICY account_flow_writer ON sa_domain.account_flows TO sa_account_writer USING(true) WITH CHECK(true);
CREATE INDEX squad_account_flow_email_time ON sa_domain.account_flows(email,created_at DESC);
CREATE INDEX squad_account_flow_created ON sa_domain.account_flows(created_at DESC);
CREATE INDEX squad_account_flow_expiry ON sa_domain.account_flows(expires_at,id) WHERE state IN('pending','processing');
CREATE TABLE sa_domain.credential_states(
 legacy_user_id bigint PRIMARY KEY,revision bigint NOT NULL DEFAULT 0,active_flow uuid REFERENCES sa_domain.account_flows,
 last_completed_flow uuid REFERENCES sa_domain.account_flows,lease_until timestamptz,generation bigint NOT NULL
);
ALTER TABLE sa_domain.credential_states ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.credential_states FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.credential_states TO sa_account_writer;
CREATE POLICY credential_state_writer ON sa_domain.credential_states TO sa_account_writer USING(true) WITH CHECK(true);
CREATE TABLE sa_domain.invitation_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,legacy_user_id bigint NOT NULL,
 generation bigint NOT NULL,expires_at timestamptz NOT NULL DEFAULT(now()+interval '60 seconds'),used_by uuid);
ALTER TABLE sa_domain.invitation_grants ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.invitation_grants FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.invitation_grants TO sa_account_writer;
CREATE POLICY invitation_writer ON sa_domain.invitation_grants TO sa_account_writer USING(true) WITH CHECK(true);
CREATE INDEX squad_invitation_expiry ON sa_domain.invitation_grants(expires_at);

-- Guest registration cannot choose capability, role, coordinator, approval or
-- commercial prices. Retain the same bounded person/address field vocabulary.
CREATE FUNCTION sa_domain.validate_registration(p_fields jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE profile_ jsonb:=p_fields-'addresses';ad jsonb;k text;v jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_fields,ARRAY['first_name','last_name','company_name','phone','gst_no','addresses']);
 IF NOT(profile_?&ARRAY['first_name','last_name','company_name','phone']) OR length(p_fields::text)>24576 THEN RAISE EXCEPTION 'Registration profile required' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.validate_person_fields(profile_);
 FOR k,v IN SELECT * FROM jsonb_each(profile_) LOOP
  IF k<>'gst_no' AND coalesce(length(btrim(v#>>'{}')),0)=0 THEN RAISE EXCEPTION 'Registration profile required' USING ERRCODE='22023';END IF;
 END LOOP;
 IF jsonb_typeof(p_fields->'addresses') IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields->'addresses') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Registration addresses required' USING ERRCODE='22023';END IF;
 FOR ad IN SELECT * FROM jsonb_array_elements(p_fields->'addresses') LOOP
  PERFORM sa_domain.check_fields(ad,ARRAY['address','state','city','zip_code']);
  IF NOT(ad?&ARRAY['address','state','city','zip_code']) THEN RAISE EXCEPTION 'Complete address required' USING ERRCODE='22023';END IF;
  FOR k,v IN SELECT * FROM jsonb_each(ad) LOOP
   IF jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid registration address' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.validate_registration(jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.validate_person_fields(jsonb),sa_domain.validate_registration(jsonb),sa_domain.can_manage_person(bigint) TO sa_account_writer;

CREATE FUNCTION sa_domain.account_invitation_authorize(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();m sa_identity.sa_auth_identities;g bigint;grant_ uuid;
BEGIN
 g:=sa_domain.worker_write_fence();
 IF NOT((ctx->>'platform')::boolean OR sa_domain.can_manage_person(p_id)) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role NOT IN(0,5,6) AND deleted_at IS NULL AND disabled IS NOT TRUE) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM sa_identity.sa_auth_identities WHERE legacy_user_id=p_id;
 IF m.auth_user_id IS NULL OR m.import_disposition='identity_exception' THEN RAISE EXCEPTION 'Wait for account reconciliation' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('account-invitation-rate',784139));
 IF(SELECT count(*) FROM sa_domain.invitation_grants WHERE expires_at>statement_timestamp())>=100
 OR(SELECT count(*) FROM sa_domain.invitation_grants WHERE actor_id=(ctx->>'auth_id')::uuid AND expires_at>statement_timestamp())>=20
 THEN RAISE EXCEPTION 'Invitation request limit reached' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.invitation_grants(actor_id,legacy_user_id,generation) VALUES((ctx->>'auth_id')::uuid,p_id,g) RETURNING id INTO grant_;
 RETURN jsonb_build_object('grant',grant_,'email',m.canonical_email,'legacy_user_id',p_id::text);
END $f$;
ALTER FUNCTION sa_domain.account_invitation_authorize(bigint) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_invitation_authorize(bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_invitation_authorize(bigint) TO sa_app,authenticated;
CREATE FUNCTION canto_api.account_invitation_authorize(p_id bigint) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_invitation_authorize(p_id) $f$;
REVOKE ALL ON FUNCTION canto_api.account_invitation_authorize(bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION canto_api.account_invitation_authorize(bigint) TO sa_app,authenticated;

-- GoTrue updates passwords and app metadata in separate SQL statements in one
-- transaction. Capture both, then validate the final intent at commit. An admin
-- write of an unchanged old marker is still a provider attempt: it cannot bypass
-- the fence after a native password change preserved that marker.
CREATE TABLE sa_domain.credential_transactions(
 transaction_id xid8 NOT NULL,legacy_user_id bigint NOT NULL,auth_user_id uuid NOT NULL,
 password_changed boolean NOT NULL DEFAULT false,marker_supplied boolean NOT NULL DEFAULT false,marker text,
 PRIMARY KEY(transaction_id,legacy_user_id)
);
ALTER TABLE sa_domain.credential_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.credential_transactions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON sa_domain.credential_transactions TO sa_account_writer;
CREATE POLICY credential_transaction_writer ON sa_domain.credential_transactions TO sa_account_writer USING(true) WITH CHECK(true);
CREATE FUNCTION sa_domain.account_credential_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE legacy_ bigint;changed_ boolean:=false;marker_ text;
BEGIN
 IF NEW.role IS DISTINCT FROM 'sa_app' THEN RETURN NEW;END IF;
 IF current_setting('squad.source_enrollment',true)='on' AND pg_has_role(session_user,'postgres','MEMBER') THEN RETURN NEW;END IF;
 IF TG_ARGV[0]='password' THEN
  IF TG_OP='INSERT' THEN changed_:=NEW.encrypted_password IS NOT NULL;
  ELSE changed_:=NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password;END IF;
  IF NOT changed_ THEN RETURN NEW;END IF;
 ELSE marker_:=NEW.raw_app_meta_data->>'squad_account_flow';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 SELECT legacy_user_id INTO legacy_ FROM sa_identity.sa_auth_identities WHERE auth_user_id=NEW.id;
 IF legacy_ IS NULL THEN RETURN NEW;END IF; -- The identity guard rejects unreserved users.
 INSERT INTO sa_domain.credential_states(legacy_user_id,generation) SELECT legacy_,generation FROM sa_domain.runtime_state ON CONFLICT DO NOTHING;
 PERFORM 1 FROM sa_domain.credential_states WHERE legacy_user_id=legacy_ FOR UPDATE;
 INSERT INTO sa_domain.credential_transactions(transaction_id,legacy_user_id,auth_user_id,password_changed,marker_supplied,marker)
 VALUES(pg_current_xact_id(),legacy_,NEW.id,changed_,TG_ARGV[0]='metadata' AND marker_ IS NOT NULL,marker_)
 ON CONFLICT(transaction_id,legacy_user_id) DO UPDATE SET
 password_changed=sa_domain.credential_transactions.password_changed OR excluded.password_changed,
 marker_supplied=sa_domain.credential_transactions.marker_supplied OR excluded.marker_supplied,
 marker=CASE WHEN excluded.marker_supplied THEN excluded.marker ELSE sa_domain.credential_transactions.marker END;
 RETURN NEW;
END $f$;
CREATE FUNCTION sa_domain.account_credential_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE attempt_ sa_domain.credential_transactions;flow_ sa_domain.account_flows;state_ sa_domain.credential_states;g bigint;
BEGIN
 SELECT * INTO attempt_ FROM sa_domain.credential_transactions WHERE transaction_id=pg_current_xact_id() AND auth_user_id=NEW.id;
 IF attempt_.auth_user_id IS NULL THEN RETURN NULL;END IF;
 DELETE FROM sa_domain.credential_transactions WHERE transaction_id=attempt_.transaction_id AND legacy_user_id=attempt_.legacy_user_id;
 IF NOT attempt_.password_changed THEN RETURN NULL;END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 SELECT * INTO state_ FROM sa_domain.credential_states WHERE legacy_user_id=attempt_.legacy_user_id FOR UPDATE;
 IF attempt_.marker_supplied THEN
  IF attempt_.marker!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Credential flow unavailable' USING ERRCODE='55000';END IF;
  SELECT * INTO flow_ FROM sa_domain.account_flows WHERE id=attempt_.marker::uuid;
  IF flow_.id IS NULL OR flow_.legacy_user_id IS DISTINCT FROM attempt_.legacy_user_id OR flow_.auth_user_id IS DISTINCT FROM attempt_.auth_user_id
   OR flow_.generation IS DISTINCT FROM g OR flow_.state IS DISTINCT FROM 'processing'
   OR NOT coalesce(flow_.lease_until>clock_timestamp(),false) OR state_.active_flow IS DISTINCT FROM flow_.id
   OR NOT coalesce(state_.lease_until>clock_timestamp(),false) OR state_.revision IS DISTINCT FROM flow_.credential_revision
   THEN RAISE EXCEPTION 'Credential flow is stale' USING ERRCODE='55000';END IF;
 END IF;
 UPDATE sa_domain.credential_states SET revision=revision+1,last_completed_flow=CASE WHEN attempt_.marker_supplied THEN flow_.id END,
 active_flow=NULL,lease_until=NULL,generation=g WHERE legacy_user_id=attempt_.legacy_user_id;
 RETURN NULL;
END $f$;
ALTER FUNCTION sa_domain.account_credential_capture() OWNER TO sa_account_writer;
ALTER FUNCTION sa_domain.account_credential_fence() OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.account_credential_capture(),sa_domain.account_credential_fence() FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_executor,sa_guard;
CREATE TRIGGER squad_account_password_capture BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users FOR EACH ROW EXECUTE FUNCTION sa_domain.account_credential_capture('password');
CREATE TRIGGER squad_account_marker_capture BEFORE INSERT OR UPDATE OF raw_app_meta_data ON auth.users FOR EACH ROW EXECUTE FUNCTION sa_domain.account_credential_capture('metadata');
CREATE CONSTRAINT TRIGGER squad_account_credential_fence AFTER INSERT OR UPDATE OF encrypted_password,raw_app_meta_data ON auth.users
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sa_domain.account_credential_fence();

CREATE FUNCTION sa_domain.squad_account_flow_request(p_id uuid,p_purpose text,p_email text,p_payload jsonb,p_input_fingerprint text,p_code_hash text,p_code_cipher text,p_provider_available boolean DEFAULT false,p_invitation_grant uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;old_ sa_domain.account_flows;m sa_identity.sa_auth_identities;u record;grant_ sa_domain.invitation_grants;
 eligible_ boolean:=false;limited_ boolean;seq_ bigint;actor_ uuid;guest_ uuid;credential_ bigint:=0;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 IF p_id IS NULL OR p_purpose IS NULL OR p_purpose NOT IN('register','confirm','recovery','invite') OR p_email IS NULL OR p_email<>lower(btrim(p_email)) OR length(p_email)>254 OR p_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 OR p_code_hash IS NULL OR p_code_hash!~'^[a-f0-9]{64}$' OR p_input_fingerprint IS NULL OR p_input_fingerprint!~'^[a-f0-9]{64}$' OR p_code_cipher IS NULL OR length(p_code_cipher)>256 THEN RAISE EXCEPTION 'Invalid account request' USING ERRCODE='22023';END IF;
 IF p_purpose='register' THEN PERFORM sa_domain.validate_registration(p_payload);ELSE IF p_payload IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Unexpected account fields' USING ERRCODE='22023';END IF;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('account-flow-request:'||p_id,784139));
 SELECT * INTO old_ FROM sa_domain.account_flows WHERE id=p_id;
 IF old_.id IS NOT NULL THEN
  IF old_.generation<>g OR old_.purpose<>p_purpose OR old_.email<>p_email OR old_.input_fingerprint<>p_input_fingerprint THEN RAISE EXCEPTION 'Request key already used' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('request_id',p_id,'accepted',true,'expires_in',900);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('account-mail-rate',784139));
 IF (SELECT count(*) FROM sa_domain.account_flows WHERE created_at>statement_timestamp()-interval '1 minute')>=60 OR(SELECT count(*) FROM sa_domain.account_flows WHERE created_at>statement_timestamp()-interval '1 day')>=1000 THEN RAISE EXCEPTION 'Account request limit reached' USING ERRCODE='54000';END IF;
 limited_:=(SELECT count(*) FROM sa_domain.account_flows WHERE email=p_email AND created_at>statement_timestamp()-interval '1 minute')>0
 OR(SELECT count(*) FROM sa_domain.account_flows WHERE email=p_email AND created_at>statement_timestamp()-interval '1 hour')>=5;
 SELECT id,role,disabled,deleted_at,approved,confirmed_at INTO u FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=p_email ORDER BY id LIMIT 1;
 SELECT * INTO m FROM sa_identity.sa_auth_identities WHERE legacy_user_id=u.id AND canonical_email=p_email;
 IF p_purpose='register' THEN
  eligible_:=u.id IS NULL AND NOT EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE canonical_email=p_email) AND p_provider_available IS TRUE;
 ELSE
  eligible_:=m.auth_user_id IS NOT NULL AND m.import_disposition<>'identity_exception' AND u.disabled IS NOT TRUE AND u.deleted_at IS NULL AND u.role NOT IN(5,6)
   AND(SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=p_email)=1;
  IF p_purpose='recovery' THEN eligible_:=eligible_ AND NOT(u.role=3 AND u.approved IS FALSE);
  ELSIF p_purpose='confirm' THEN eligible_:=eligible_ AND u.confirmed_at IS NULL AND m.confirmation_basis='not_activated';
  ELSE
   SELECT * INTO grant_ FROM sa_domain.invitation_grants WHERE id=p_invitation_grant FOR UPDATE;
   IF grant_.id IS NULL OR grant_.generation<>g OR grant_.expires_at<=statement_timestamp() OR grant_.legacy_user_id IS DISTINCT FROM u.id OR grant_.used_by IS NOT NULL THEN RAISE EXCEPTION 'Invitation authorization expired' USING ERRCODE='42501';END IF;
   actor_:=grant_.actor_id;UPDATE sa_domain.invitation_grants SET used_by=p_id WHERE id=grant_.id;
  END IF;
  SELECT revision INTO credential_ FROM sa_domain.credential_states WHERE legacy_user_id=u.id;
 END IF;
 eligible_:=eligible_ IS TRUE AND NOT limited_;
 INSERT INTO sa_domain.account_flows(id,purpose,email,actor_id,legacy_user_id,auth_user_id,generation,payload,input_fingerprint,code_hash,code_cipher,state,credential_revision,mail_state)
 VALUES(p_id,p_purpose,p_email,actor_,CASE WHEN eligible_ THEN u.id END,CASE WHEN eligible_ THEN m.auth_user_id END,g,CASE WHEN eligible_ THEN p_payload ELSE '{}'::jsonb END,p_input_fingerprint,p_code_hash,CASE WHEN eligible_ THEN p_code_cipher END,
 CASE WHEN eligible_ THEN 'pending' ELSE 'dummy' END,coalesce(credential_,0),CASE WHEN eligible_ THEN 'queued' ELSE 'skipped' END) RETURNING sequence_id,guest_actor_id INTO seq_,guest_;
 IF eligible_ THEN INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(coalesce(actor_,guest_),'account.challenge_mail','maintenance',seq_,p_id,g,jsonb_build_object('flow_id',p_id));END IF;
 RETURN jsonb_build_object('request_id',p_id,'accepted',true,'expires_in',900);
END $f$;
ALTER FUNCTION sa_domain.squad_account_flow_request(uuid,text,text,jsonb,text,text,text,boolean,uuid) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.squad_account_flow_request(uuid,text,text,jsonb,text,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.squad_account_flow_request(uuid,text,text,jsonb,text,text,text,boolean,uuid) TO service_role;
CREATE FUNCTION canto_api.squad_account_flow_request(p_id uuid,p_purpose text,p_email text,p_payload jsonb,p_input_fingerprint text,p_code_hash text,p_code_cipher text,p_provider_available boolean DEFAULT false,p_invitation_grant uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_flow_request(p_id,p_purpose,p_email,p_payload,p_input_fingerprint,p_code_hash,p_code_cipher,p_provider_available,p_invitation_grant) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_account_flow_request(uuid,text,text,jsonb,text,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.squad_account_flow_request(uuid,text,text,jsonb,text,text,text,boolean,uuid) TO service_role;

-- Share the existing commercial formula; authorization remains on its original
-- wrapper. The unguarded core is private to the guard and verified-account writer.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.address_commercial_rules(bigint)'::regprocedure);
 d:=replace(d,'sa_domain.address_commercial_rules(', 'sa_domain.address_rule_values(');
 d:=replace(d,$s$ IF NOT sa_domain.can_address(p_user_id) THEN RAISE EXCEPTION 'Address owner unavailable' USING ERRCODE='42501';END IF;$s$,'');EXECUTE d;
END $f$;
ALTER FUNCTION sa_domain.address_rule_values(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.address_rule_values(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.address_rule_values(bigint) TO sa_guard,sa_account_writer;
CREATE OR REPLACE FUNCTION sa_domain.address_commercial_rules(p_user_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_domain.can_address(p_user_id) THEN RAISE EXCEPTION 'Address owner unavailable' USING ERRCODE='42501';END IF;
 RETURN sa_domain.address_rule_values(p_user_id);
END $f$;
GRANT SELECT(auto_approve_customers,customer_registered_by,customer_first_name,customer_last_name,customer_company_name,phone,gst_no,zone_id,rmp_price_type_id,dealers_count,onboarded),
 INSERT(id,email,name,phone,role,gst_no,customer_first_name,customer_last_name,customer_company_name,customer_registered_by,approved,onboarded,confirmed_at,created_at,updated_at),
 UPDATE(confirmed_at,approved,approved_at,onboarded,onboarded_at,zone_id,rmp_price_type_id,dealers_count)
 ON sa_snapshot_20261019.sa_users TO sa_account_writer;
GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_addresses,sa_snapshot_20261019.sa_user_dealers TO sa_account_writer;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_users_id_seq,sa_snapshot_20261019.sa_addresses_id_seq,sa_snapshot_20261019.sa_user_dealers_id_seq TO sa_account_writer;
CREATE POLICY account_address_read ON sa_snapshot_20261019.sa_addresses FOR SELECT TO sa_account_writer USING(true);
CREATE POLICY account_address_insert ON sa_snapshot_20261019.sa_addresses FOR INSERT TO sa_account_writer WITH CHECK(true);
CREATE POLICY account_dealer_read ON sa_snapshot_20261019.sa_user_dealers FOR SELECT TO sa_account_writer USING(true);
CREATE POLICY account_dealer_insert ON sa_snapshot_20261019.sa_user_dealers FOR INSERT TO sa_account_writer WITH CHECK(true);

CREATE FUNCTION sa_domain.squad_account_flow_prepare(p_id uuid,p_purpose text,p_email text,p_code_hash text,p_password_fingerprint text,p_provider_available boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;f sa_domain.account_flows;s sa_domain.credential_states;m sa_identity.sa_auth_identities;
 target_ jsonb;ad jsonb;first_ boolean:=true;rules_ jsonb;dealer_ text;approve_ boolean;id_ bigint;auth_ uuid;lease_ uuid;committed_ boolean;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 IF p_password_fingerprint IS NULL OR p_password_fingerprint!~'^[a-f0-9]{64}$' OR p_code_hash IS NULL OR p_code_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid proof request' USING ERRCODE='22023';END IF;
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=p_id FOR UPDATE;
 IF f.id IS NULL OR f.purpose IS DISTINCT FROM p_purpose OR f.email IS DISTINCT FROM p_email OR f.generation<>g OR f.state IN('dummy','expired','failed') OR f.expires_at<=statement_timestamp() OR f.attempts>=5 THEN RETURN jsonb_build_object('error','INVALID_OR_EXPIRED_CODE');END IF;
 IF f.code_hash<>p_code_hash THEN
  UPDATE sa_domain.account_flows SET attempts=attempts+1,state=CASE WHEN attempts+1>=5 THEN 'failed' ELSE state END,updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('error','INVALID_OR_EXPIRED_CODE');
 END IF;
 IF f.password_fingerprint IS NOT NULL AND f.password_fingerprint<>p_password_fingerprint THEN RETURN jsonb_build_object('error','ACCOUNT_REQUEST_CONFLICT');END IF;
 IF f.state='done' THEN RETURN jsonb_build_object('replayed',true,'result',f.result);END IF;
 IF f.state='processing' AND f.lease_until>statement_timestamp() THEN RETURN jsonb_build_object('error','ACCOUNT_REQUEST_BUSY');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person-email:'||f.email,784139));
 IF f.purpose='register' AND f.legacy_user_id IS NULL THEN
  IF p_provider_available IS NOT TRUE OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=f.email) OR EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE canonical_email=f.email) THEN
   UPDATE sa_domain.account_flows SET state='failed',code_cipher=NULL,updated_at=now() WHERE id=p_id;RETURN jsonb_build_object('error','ACCOUNT_UNAVAILABLE');
  END IF;
  -- Email proof now owns this registration; no guest-chosen privileges.
  PERFORM sa_domain.person_structure_fence();PERFORM sa_domain.validate_registration(f.payload);
  INSERT INTO sa_snapshot_20261019.sa_users(email,name,phone,role,gst_no,customer_first_name,customer_last_name,customer_company_name,customer_registered_by,approved,onboarded,confirmed_at,created_at,updated_at)
   VALUES(f.email,btrim((f.payload->>'first_name')||' '||(f.payload->>'last_name')),f.payload->>'phone',3,f.payload->>'gst_no',f.payload->>'first_name',f.payload->>'last_name',f.payload->>'company_name',0,false,false,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC') RETURNING id INTO id_;
  FOR ad IN SELECT * FROM jsonb_array_elements(f.payload->'addresses') LOOP
   INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,state,city,zip_code,is_primary,created_at,updated_at)
    VALUES(id_,btrim(ad->>'address'),btrim(ad->>'state'),btrim(ad->>'city'),btrim(ad->>'zip_code'),first_,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');first_:=false;
  END LOOP;
  rules_:=sa_domain.address_rule_values(id_);
  SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id IN(SELECT value::bigint FROM jsonb_array_elements_text(rules_->'candidate_dealer_ids')) AND auto_approve_customers IS TRUE) INTO approve_;
  IF approve_ THEN
   FOR dealer_ IN SELECT * FROM jsonb_array_elements_text(rules_->'candidate_dealer_ids') LOOP
    INSERT INTO sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id,created_at,updated_at) VALUES(id_,dealer_::bigint,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');
   END LOOP;
  END IF;
  UPDATE sa_snapshot_20261019.sa_users SET zone_id=(rules_->>'zone_id')::bigint,rmp_price_type_id=CASE WHEN approve_ THEN(rules_->>'price_type_id')::bigint END,
   approved=approve_,approved_at=CASE WHEN approve_ THEN now() AT TIME ZONE 'UTC' END,onboarded=approve_,onboarded_at=CASE WHEN approve_ THEN now() AT TIME ZONE 'UTC' END,
   dealers_count=CASE WHEN approve_ THEN jsonb_array_length(rules_->'candidate_dealer_ids') ELSE 0 END WHERE id=id_;
  auth_:=gen_random_uuid();INSERT INTO sa_sync.legacy_identity_keys VALUES(id_);
  INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis)
   VALUES(auth_,id_,f.email,'candidate',CASE WHEN approve_ THEN 'ready' ELSE 'blocked' END,true,'source_confirmed');
  UPDATE sa_domain.account_flows SET legacy_user_id=id_,auth_user_id=auth_ WHERE id=p_id RETURNING * INTO f;
  PERFORM sa_domain.bump_version('person',id_,sa_domain.version('person',id_));
  UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 END IF;
 target_:=sa_domain.account_target(f.legacy_user_id);
 SELECT * INTO m FROM sa_identity.sa_auth_identities WHERE legacy_user_id=f.legacy_user_id;
 IF target_ IS NULL OR target_->>'email' IS DISTINCT FROM f.email OR m.auth_user_id IS DISTINCT FROM f.auth_user_id OR m.import_disposition='identity_exception'
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=f.legacy_user_id AND disabled IS NOT TRUE AND deleted_at IS NULL AND role NOT IN(5,6))
 OR(f.purpose='recovery' AND NOT(target_->>'allowed')::boolean) THEN
  UPDATE sa_domain.account_flows SET state='failed',code_cipher=NULL,updated_at=now() WHERE id=p_id;RETURN jsonb_build_object('error','ACCOUNT_UNAVAILABLE');
 END IF;
 INSERT INTO sa_domain.credential_states(legacy_user_id,generation) VALUES(f.legacy_user_id,g) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM sa_domain.credential_states WHERE legacy_user_id=f.legacy_user_id FOR UPDATE;
 committed_:=s.last_completed_flow=f.id AND s.revision=f.credential_revision+1;
 IF NOT coalesce(committed_,false) AND s.revision<>f.credential_revision THEN
  UPDATE sa_domain.account_flows SET state='expired',code_cipher=NULL,updated_at=now() WHERE id=p_id;RETURN jsonb_build_object('error','INVALID_OR_EXPIRED_CODE');
 END IF;
 IF s.active_flow IS NOT NULL AND s.active_flow<>f.id AND s.lease_until>statement_timestamp() THEN RETURN jsonb_build_object('error','ACCOUNT_REQUEST_BUSY');END IF;
 lease_:=gen_random_uuid();
 UPDATE sa_domain.account_flows SET state='processing',password_fingerprint=p_password_fingerprint,lease_token=lease_,lease_until=statement_timestamp()+interval '90 seconds',updated_at=now() WHERE id=p_id;
 IF NOT coalesce(committed_,false) THEN UPDATE sa_domain.credential_states SET active_flow=f.id,lease_until=statement_timestamp()+interval '90 seconds',generation=g WHERE legacy_user_id=f.legacy_user_id;END IF;
 UPDATE sa_identity.sa_auth_identities SET enrollment_state=CASE WHEN(target_->>'allowed')::boolean THEN 'ready' ELSE 'blocked' END WHERE legacy_user_id=f.legacy_user_id;
 RETURN target_||jsonb_build_object('flow_id',p_id,'purpose',f.purpose,'auth_user_id',f.auth_user_id,'lease_token',lease_,'provider_committed',coalesce(committed_,false));
END $f$;
ALTER FUNCTION sa_domain.squad_account_flow_prepare(uuid,text,text,text,text,boolean) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.squad_account_flow_finish(p_id uuid,p_lease_token uuid,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;f sa_domain.account_flows;s sa_domain.credential_states;result_ jsonb;target_ jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=p_id FOR UPDATE;
 IF f.id IS NULL OR f.generation<>g OR f.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Account lease unavailable' USING ERRCODE='40001';END IF;
 IF f.state='done' THEN RETURN f.result;END IF;
 IF f.state<>'processing' OR f.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Account lease expired' USING ERRCODE='40001';END IF;
 IF p_error IS NOT NULL AND p_error NOT IN('PROVIDER_UNAVAILABLE','IDENTITY_CONFLICT','ACCOUNT_UNAVAILABLE') THEN RAISE EXCEPTION 'Invalid provider status' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM sa_domain.credential_states WHERE legacy_user_id=f.legacy_user_id FOR UPDATE;
 IF s.last_completed_flow IS DISTINCT FROM f.id OR s.revision<>f.credential_revision+1 THEN
  UPDATE sa_domain.credential_states SET active_flow=NULL,lease_until=NULL WHERE legacy_user_id=f.legacy_user_id AND active_flow=f.id;
  UPDATE sa_domain.account_flows SET state=CASE WHEN p_error IN('IDENTITY_CONFLICT','ACCOUNT_UNAVAILABLE') THEN 'failed' ELSE 'pending' END,
   lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('error',coalesce(p_error,'PROVIDER_UNAVAILABLE'));
 END IF;
 target_:=sa_domain.account_target(f.legacy_user_id);
 UPDATE sa_snapshot_20261019.sa_users SET confirmed_at=now() AT TIME ZONE 'UTC',updated_at=now() AT TIME ZONE 'UTC' WHERE id=f.legacy_user_id AND confirmed_at IS NULL;
 IF FOUND THEN
  PERFORM sa_domain.bump_version('person',f.legacy_user_id,sa_domain.version('person',f.legacy_user_id));
  UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 END IF;
 result_:=jsonb_build_object('completed',true,'user_id',f.legacy_user_id::text,'email_confirmed',true,'login_allowed',(target_->>'allowed')::boolean,
  'next',CASE WHEN(target_->>'allowed')::boolean THEN 'sign_in' ELSE 'await_approval' END);
 UPDATE sa_domain.account_flows SET state='done',result=result_,code_cipher=NULL,payload='{}',lease_until=NULL,updated_at=now() WHERE id=p_id;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation)
  VALUES(coalesce(f.actor_id,f.auth_user_id),f.legacy_user_id,'account.'||f.purpose||'_completed','person',f.legacy_user_id,f.id,jsonb_build_object('purpose',f.purpose),g);
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(coalesce(f.actor_id,f.auth_user_id),'account.'||f.purpose||'_completed','person',f.legacy_user_id,f.id,g,jsonb_build_object('purpose',f.purpose)) ON CONFLICT DO NOTHING;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.squad_account_flow_finish(uuid,uuid,text) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.squad_account_flow_prepare(uuid,text,text,text,text,boolean),sa_domain.squad_account_flow_finish(uuid,uuid,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.squad_account_flow_prepare(uuid,text,text,text,text,boolean),sa_domain.squad_account_flow_finish(uuid,uuid,text) TO service_role;
CREATE FUNCTION canto_api.squad_account_flow_prepare(p_id uuid,p_purpose text,p_email text,p_code_hash text,p_password_fingerprint text,p_provider_available boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_flow_prepare(p_id,p_purpose,p_email,p_code_hash,p_password_fingerprint,p_provider_available) $f$;
CREATE FUNCTION canto_api.squad_account_flow_finish(p_id uuid,p_lease_token uuid,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_flow_finish(p_id,p_lease_token,p_error) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_account_flow_prepare(uuid,text,text,text,text,boolean),canto_api.squad_account_flow_finish(uuid,uuid,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.squad_account_flow_prepare(uuid,text,text,text,text,boolean),canto_api.squad_account_flow_finish(uuid,uuid,text) TO service_role;

CREATE FUNCTION sa_domain.squad_account_mail_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;j sa_domain.outbox;f sa_domain.account_flows;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.event_type<>'account.challenge_mail' OR j.status<>'leased' OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Mail lease unavailable' USING ERRCODE='40001';END IF;
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=(j.payload->>'flow_id')::uuid AND sequence_id=j.aggregate_id;
 IF f.id IS NULL OR f.generation<>g OR f.state<>'pending' OR f.mail_state<>'queued' OR f.expires_at<=statement_timestamp() OR f.attempts>=5 OR f.code_cipher IS NULL THEN RETURN jsonb_build_object('skip',true);END IF;
 IF f.purpose<>'register' AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=f.legacy_user_id AND lower(btrim(email))=f.email AND disabled IS NOT TRUE AND deleted_at IS NULL AND role NOT IN(5,6) AND(f.purpose<>'recovery' OR NOT(role=3 AND approved IS FALSE))) THEN RETURN jsonb_build_object('skip',true);END IF;
 UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
 RETURN jsonb_build_object('flow_id',f.id,'email',f.email,'purpose',f.purpose,'ciphertext',f.code_cipher,'expires_at',f.expires_at);
END $f$;
ALTER FUNCTION sa_domain.squad_account_mail_prepare(uuid,uuid) OWNER TO sa_account_writer;
CREATE FUNCTION sa_domain.squad_account_mail_finish(p_id uuid,p_lease_token uuid,p_sent boolean,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;j sa_domain.outbox;f sa_domain.account_flows;state_ text;retry_ boolean;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.event_type<>'account.challenge_mail' OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Mail lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Mail lease expired' USING ERRCODE='40001';END IF;
 IF p_sent IS NULL OR(p_sent AND p_error IS NOT NULL) OR(p_error IS NOT NULL AND p_error NOT IN('PROVIDER_UNAVAILABLE','MAIL_REJECTED','MAIL_NOT_ENABLED')) THEN RAISE EXCEPTION 'Invalid mail outcome' USING ERRCODE='22023';END IF;
 SELECT * INTO f FROM sa_domain.account_flows WHERE id=(j.payload->>'flow_id')::uuid FOR UPDATE;
 retry_:=p_error='PROVIDER_UNAVAILABLE' AND j.attempts<5 AND f.expires_at>statement_timestamp()+interval '30 seconds' AND f.state='pending';
 state_:=CASE WHEN p_error IS NULL THEN 'done' WHEN retry_ THEN 'pending' ELSE 'dead' END;
 UPDATE sa_domain.outbox SET status=state_,result=CASE WHEN state_='done' THEN jsonb_build_object('sent',p_sent) END,last_error_code=p_error,
  lease_until=NULL,lease_token=CASE WHEN state_='done' THEN lease_token END,completed_at=CASE WHEN state_ IN('done','dead') THEN now() END,
  available_at=now()+make_interval(secs=>least(60,5*power(2,j.attempts)::integer)),revision=revision+1 WHERE id=j.id;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN state_='done' THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=p_error WHERE lease_token=p_lease_token;
 UPDATE sa_domain.account_flows SET mail_state=CASE WHEN p_sent THEN 'sent' WHEN state_='pending' THEN 'queued' WHEN p_error IS NULL THEN 'skipped' ELSE 'failed' END,
 code_cipher=CASE WHEN state_='pending' THEN code_cipher END,updated_at=now() WHERE id=f.id;
 RETURN jsonb_build_object('id',j.id,'state',state_,'error_code',p_error);
END $f$;
ALTER FUNCTION sa_domain.squad_account_mail_finish(uuid,uuid,boolean,text) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.squad_account_mail_prepare(uuid,uuid),sa_domain.squad_account_mail_finish(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.squad_account_mail_prepare(uuid,uuid),sa_domain.squad_account_mail_finish(uuid,uuid,boolean,text) TO service_role;
CREATE FUNCTION canto_api.squad_account_mail_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_mail_prepare(p_id,p_lease_token) $f$;
CREATE FUNCTION canto_api.squad_account_mail_finish(p_id uuid,p_lease_token uuid,p_sent boolean,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_mail_finish(p_id,p_lease_token,p_sent,p_error) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_account_mail_prepare(uuid,uuid),canto_api.squad_account_mail_finish(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.squad_account_mail_prepare(uuid,uuid),canto_api.squad_account_mail_finish(uuid,uuid,boolean,text) TO service_role;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);
 d:=replace(d,'SELECT CASE WHEN', $s$SELECT CASE WHEN p_event='account.challenge_mail' THEN 'account_mail' WHEN$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 d:=replace(d,$s$IN('local_amendment','account_reconciliation')$s$,$s$IN('local_amendment','account_reconciliation','account_mail')$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.job_projection(sa_domain.outbox)'::regprocedure);
 d:=replace(d,$s$IN('local_amendment','account_reconciliation')$s$,$s$IN('local_amendment','account_reconciliation','account_mail')$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.settle_account_failures()'::regprocedure);
 d:=replace(d,'END', $s$
 WITH failed AS(SELECT f.id FROM sa_domain.account_flows f JOIN sa_domain.outbox j ON j.command_key=f.id AND j.event_type='account.challenge_mail'
 WHERE f.mail_state='queued' AND j.status='dead' ORDER BY j.completed_at,j.id FOR UPDATE OF f SKIP LOCKED LIMIT 100)
 UPDATE sa_domain.account_flows f SET mail_state='failed',code_cipher=NULL,updated_at=now() FROM failed x WHERE f.id=x.id;
 END$s$);EXECUTE d;
END $f$;
CREATE INDEX squad_outbox_account_mail ON sa_domain.outbox(available_at,sequence_id) WHERE status IN('pending','leased') AND event_type='account.challenge_mail';

-- Expire secrets and submitted profile data in bounded, service-only batches.
-- This maintenance is allowed in mirror mode and sends no external messages.
GRANT DELETE ON sa_domain.invitation_grants TO sa_account_writer;
CREATE INDEX squad_invitation_actor_expiry ON sa_domain.invitation_grants(actor_id,expires_at DESC);
CREATE FUNCTION sa_domain.squad_account_flow_cleanup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cleaned_ integer;grants_ integer;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 WITH expired AS(SELECT id FROM sa_domain.account_flows WHERE expires_at<=now() AND
 (state IN('pending','processing') OR payload<>'{}' OR code_cipher IS NOT NULL OR password_fingerprint IS NOT NULL OR(email<>'' AND created_at<now()-interval '24 hours'))
 ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 1000)
 UPDATE sa_domain.account_flows f SET state=CASE WHEN state IN('pending','processing') THEN 'expired' ELSE state END,
 code_cipher=NULL,payload='{}',password_fingerprint=NULL,lease_until=NULL,lease_token=NULL,
 email=CASE WHEN created_at<now()-interval '24 hours' THEN '' ELSE email END,
 code_hash=CASE WHEN created_at<now()-interval '24 hours' THEN repeat('0',64) ELSE code_hash END,updated_at=now()
 FROM expired x WHERE f.id=x.id;
 GET DIAGNOSTICS cleaned_=ROW_COUNT;
 WITH expired AS(SELECT id FROM sa_domain.invitation_grants WHERE expires_at<=now() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 1000)
 DELETE FROM sa_domain.invitation_grants g USING expired x WHERE g.id=x.id;
 GET DIAGNOSTICS grants_=ROW_COUNT;
 RETURN jsonb_build_object('expired_flows',cleaned_,'expired_grants',grants_);
END $f$;
ALTER FUNCTION sa_domain.squad_account_flow_cleanup() OWNER TO sa_account_writer;
CREATE FUNCTION canto_api.squad_account_flow_cleanup() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_account_flow_cleanup() $f$;
REVOKE ALL ON FUNCTION sa_domain.squad_account_flow_cleanup(),canto_api.squad_account_flow_cleanup() FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.squad_account_flow_cleanup(),canto_api.squad_account_flow_cleanup() TO service_role;

GRANT SELECT(confirmed_at) ON sa_snapshot_20261019.sa_users TO sa_executor;
-- Report email proof independently from provisioning and business approval.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_person_get(bigint)'::regprocedure);
 d:=replace(d,'customer_registered_by INTO u','customer_registered_by,confirmed_at INTO u');
 d:=replace(d,$s$'archive_dependencies',sa_domain.person_dependencies(p_id)$s$,$s$'archive_dependencies',sa_domain.person_dependencies(p_id),'email_confirmed',u.confirmed_at IS NOT NULL,'invitation_required',u.role NOT IN(0,5,6) AND u.confirmed_at IS NULL$s$);
 EXECUTE d;
END $f$;
NOTIFY pgrst,'reload schema';

REVOKE CREATE ON SCHEMA sa_domain FROM sa_account_writer,sa_guard;
COMMIT;
