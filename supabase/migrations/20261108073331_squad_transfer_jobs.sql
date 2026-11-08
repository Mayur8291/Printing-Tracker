BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_media_writer,sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.input_number(jsonb,numeric,numeric) TO sa_media_writer;
CREATE TABLE sa_domain.transfer_uploads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,generation bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN('masters','prices','zones')),resource text,
 filename text NOT NULL,bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 10485760),sha256 text,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','verified','used','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',cleaned_at timestamptz
);
CREATE INDEX squad_transfer_upload_owner ON sa_domain.transfer_uploads(actor_id,created_at DESC);
CREATE TABLE sa_domain.transfers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 actor_id uuid NOT NULL,principal text NOT NULL CHECK(principal IN('platform','legacy_admin')),generation bigint NOT NULL,
 direction text NOT NULL CHECK(direction IN('import','export')),kind text NOT NULL,resource text,options jsonb NOT NULL DEFAULT '{}',
 upload_id uuid REFERENCES sa_domain.transfer_uploads,job_id uuid REFERENCES sa_domain.outbox,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','validating','invalid','validated','applying','exporting','completed','failed','cancelled','expired')),
 revision bigint NOT NULL DEFAULT 0,headers jsonb,byte_offset bigint NOT NULL DEFAULT 0,row_offset bigint NOT NULL DEFAULT 0,
 total_rows bigint NOT NULL DEFAULT 0,valid_rows bigint NOT NULL DEFAULT 0,invalid_rows bigint NOT NULL DEFAULT 0,applied_rows bigint NOT NULL DEFAULT 0,
 result jsonb NOT NULL DEFAULT '{}',error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,expires_at timestamptz NOT NULL DEFAULT now()+interval '3 days',
 CHECK(octet_length(options::text)<=32768)
);
CREATE INDEX squad_transfers_owner ON sa_domain.transfers(actor_id,generation,sequence_id DESC);
CREATE TABLE sa_domain.transfer_rows(
 transfer_id uuid NOT NULL REFERENCES sa_domain.transfers ON DELETE CASCADE,row_number bigint NOT NULL CHECK(row_number BETWEEN 1 AND 20000),
 raw jsonb NOT NULL DEFAULT '{}',normalized jsonb,match_key text,target_id bigint,expected_version text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','valid','invalid','applied','failed')),
 errors jsonb NOT NULL DEFAULT '[]',result_id text,
 PRIMARY KEY(transfer_id,row_number),CHECK(octet_length(raw::text)<=131072)
);
CREATE INDEX squad_transfer_keys ON sa_domain.transfer_rows(transfer_id,match_key) WHERE match_key IS NOT NULL;
CREATE TABLE sa_domain.transfer_parts(
 transfer_id uuid NOT NULL REFERENCES sa_domain.transfers ON DELETE CASCADE,part_number integer NOT NULL,
 path text NOT NULL,bytes bigint NOT NULL,sha256 text NOT NULL,PRIMARY KEY(transfer_id,part_number)
);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['transfer_uploads','transfers','transfer_rows','transfer_parts'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_guard',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON sa_domain.%I TO sa_worker',t);
  EXECUTE format('CREATE POLICY transfer_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
  EXECUTE format('CREATE POLICY transfer_worker ON sa_domain.%I TO sa_worker USING(true) WITH CHECK(true)',t);
 END LOOP;
END $f$;
GRANT SELECT,INSERT,UPDATE ON sa_domain.transfer_uploads,sa_domain.transfers TO sa_media_writer;
GRANT SELECT ON sa_domain.transfer_rows,sa_domain.transfer_parts TO sa_media_writer;
GRANT USAGE ON SEQUENCE sa_domain.transfers_sequence_id_seq TO sa_media_writer,sa_worker;
CREATE POLICY transfer_upload_owner ON sa_domain.transfer_uploads TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state)) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state));
CREATE POLICY transfer_owner ON sa_domain.transfers TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state)) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state));
CREATE POLICY transfer_row_owner ON sa_domain.transfer_rows FOR SELECT TO sa_media_writer USING(transfer_id IN(SELECT id FROM sa_domain.transfers));
CREATE POLICY transfer_part_owner ON sa_domain.transfer_parts FOR SELECT TO sa_media_writer USING(transfer_id IN(SELECT id FROM sa_domain.transfers));

-- Extend the existing staff guard only for an unforgeable leased-job context.
-- The subject must still be a current, unbanned Printing Tracker administrator.
-- This does not turn a legacy role-0 account into Printing Tracker staff.
DO $f$ DECLARE definition_ text;BEGIN
 SELECT pg_get_functiondef('sa_admin.is_admin()'::regprocedure) INTO definition_;
 definition_:=replace(definition_,'auth.uid()', 'sa_domain.request_uid()');
 definition_:=replace(definition_, $s$coalesce(auth.jwt()->>'role','') = 'authenticated'$s$,
 $s$(coalesce(auth.jwt()->>'role','') = 'authenticated' OR(current_setting('role',true)='service_role' AND sa_domain.worker_actor_id() IS NOT NULL))$s$);
 definition_:=replace(definition_, $s$AND EXISTS (SELECT 1 FROM auth.sessions s$s$,
 $s$AND (current_setting('role',true)='service_role' AND sa_domain.worker_actor_id() IS NOT NULL OR EXISTS (SELECT 1 FROM auth.sessions s$s$);
 definition_:=replace(definition_,$s$AND (s.not_after IS NULL OR s.not_after>now()));$s$,$s$AND (s.not_after IS NULL OR s.not_after>now())));$s$);
 IF position('AND (current_setting(''role'',true)=''service_role''' IN definition_)=0 OR position('auth.uid()' IN definition_)>0 THEN
  RAISE EXCEPTION 'Unexpected Masters administrator guard definition';
 END IF;
 EXECUTE definition_;
 SELECT pg_get_functiondef('sa_domain.ops_context()'::regprocedure) INTO definition_;
 definition_:=replace(definition_,$s$IF nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='authenticated' THEN$s$,
 $s$IF nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='authenticated' OR(current_setting('role',true)='service_role' AND sa_admin.is_admin()) THEN$s$);EXECUTE definition_;
 SELECT pg_get_functiondef('sa_admin.master_request(text,text,jsonb)'::regprocedure) INTO definition_;
 definition_:=replace(definition_,'auth.uid()','sa_domain.request_uid()');EXECUTE definition_;
END $f$;

CREATE FUNCTION sa_domain.transfer_context(p_kind text,p_resource text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();spec_ jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('masters','prices','zones','airtable','export') THEN RAISE EXCEPTION 'Unknown transfer kind' USING ERRCODE='22023';END IF;
 IF (p_kind IN('masters','prices','export') AND NOT(ctx->>'platform')::boolean) OR (p_kind IN('zones','airtable') AND NOT((ctx->>'platform')::boolean OR(ctx->>'admin')::boolean)) THEN RAISE EXCEPTION 'Transfer administrator required' USING ERRCODE='42501';END IF;
 IF p_kind IN('masters','export') THEN
  SELECT spec INTO spec_ FROM sa_admin.master_contracts WHERE resource=p_resource;
  IF spec_ IS NULL OR(p_kind='masters' AND coalesce((spec_->>'readOnly')::boolean,false)) THEN RAISE EXCEPTION 'Master resource unavailable' USING ERRCODE='22023';END IF;
 ELSIF p_resource IS NOT NULL AND NOT(p_kind='prices' AND p_resource='rmp_prices') THEN RAISE EXCEPTION 'Unexpected transfer resource' USING ERRCODE='22023';END IF;
 RETURN ctx;
END $f$;
ALTER FUNCTION sa_domain.transfer_context(text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.transfer_context(text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.transfer_context(text,text) TO sa_media_writer,sa_worker;
GRANT SELECT ON sa_domain.integration_preferences TO sa_guard;
CREATE POLICY transfer_preferences_guard ON sa_domain.integration_preferences FOR SELECT TO sa_guard USING(true);

CREATE FUNCTION sa_domain.transfer_current(t sa_domain.transfers) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.transfer_context(CASE WHEN t.direction='export' THEN 'export' ELSE t.kind END,t.resource);
BEGIN RETURN t.actor_id=(ctx->>'auth_id')::uuid AND t.principal=CASE WHEN(ctx->>'platform')::boolean THEN 'platform' ELSE 'legacy_admin' END AND t.generation=(SELECT generation FROM sa_domain.runtime_state);END $f$;
ALTER FUNCTION sa_domain.transfer_current(sa_domain.transfers) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.transfer_current(sa_domain.transfers) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.transfer_current(sa_domain.transfers) TO sa_guard,sa_worker;

CREATE FUNCTION sa_domain.account_transfer_upload(p_kind text,p_resource text,p_file jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.transfer_context(p_kind,p_resource);u sa_domain.transfer_uploads;cached_ jsonb;r jsonb;size_ bigint;
BEGIN
 IF p_kind NOT IN('masters','prices','zones') THEN RAISE EXCEPTION 'CSV transfer required' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.check_fields(p_file,ARRAY['filename','bytes']);
 IF jsonb_typeof(p_file->'filename') IS DISTINCT FROM 'string' OR length(p_file->>'filename') NOT BETWEEN 5 AND 180 OR p_file->>'filename'~'[/\\[:cntrl:]]' OR lower(p_file->>'filename') NOT LIKE '%.csv' THEN RAISE EXCEPTION 'Choose a CSV file' USING ERRCODE='22023';END IF;
 size_:=sa_domain.input_number(p_file->'bytes',1,10485760);
 IF size_::numeric<>(p_file->>'bytes')::numeric THEN RAISE EXCEPTION 'Integer file size required' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_media_command('transfer.upload',p_idempotency_key,jsonb_build_object('kind',p_kind,'resource',p_resource,'file',p_file));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('transfer-upload:'||(ctx->>'auth_id'),784145));
 IF(SELECT count(*) FROM sa_domain.transfer_uploads WHERE actor_id=(ctx->>'auth_id')::uuid AND created_at>now()-interval '1 day')>=20 THEN RAISE EXCEPTION 'Daily transfer upload quota exceeded' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.transfer_uploads(actor_id,generation,kind,resource,filename,bytes)
 SELECT(ctx->>'auth_id')::uuid,generation,p_kind,p_resource,p_file->>'filename',size_ FROM sa_domain.runtime_state RETURNING * INTO u;
 r:=jsonb_build_object('id',u.id,'bucket','squad-transfers','path','inputs/'||u.id::text||'/file.csv','bytes',u.bytes::text,'state',u.state,'expires_at',u.expires_at);
 UPDATE sa_domain.commands SET result=r WHERE actor_id=u.actor_id AND key=p_idempotency_key;RETURN r;
END $f$;
ALTER FUNCTION sa_domain.account_transfer_upload(text,text,jsonb,uuid) OWNER TO sa_media_writer;

CREATE FUNCTION sa_domain.account_transfer_input(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE u sa_domain.transfer_uploads;ctx jsonb:=sa_domain.ops_context();
BEGIN
 SELECT * INTO u FROM sa_domain.transfer_uploads WHERE id=p_id AND actor_id=(ctx->>'auth_id')::uuid AND generation=(SELECT generation FROM sa_domain.runtime_state);
 IF u.id IS NULL THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='P0002';END IF;
 PERFORM sa_domain.transfer_context(u.kind,u.resource);
 IF u.state='expired' OR u.expires_at<=now() THEN RAISE EXCEPTION 'Upload expired' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('id',u.id,'bucket','squad-transfers','path','inputs/'||u.id::text||'/file.csv','bytes',u.bytes::text,'sha256',u.sha256,'state',u.state,'expires_at',u.expires_at);
END $f$;
ALTER FUNCTION sa_domain.account_transfer_input(uuid) OWNER TO sa_media_writer;

CREATE FUNCTION sa_domain.account_transfer_verified(p_id uuid,p_bytes bigint,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE u sa_domain.transfer_uploads;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RAISE EXCEPTION 'Refresh active' USING ERRCODE='55000';END IF;
 SELECT * INTO u FROM sa_domain.transfer_uploads WHERE id=p_id FOR UPDATE;
 IF u.id IS NULL OR u.generation<>(SELECT generation FROM sa_domain.runtime_state) OR u.expires_at<=now() OR u.state NOT IN('reserved','verified','used') THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='P0002';END IF;
 IF p_bytes IS DISTINCT FROM u.bytes OR p_sha256 IS NULL OR p_sha256!~'^[a-f0-9]{64}$' OR(u.sha256 IS NOT NULL AND u.sha256<>p_sha256) THEN RAISE EXCEPTION 'Upload verification conflict' USING ERRCODE='22023';END IF;
 UPDATE sa_domain.transfer_uploads SET sha256=p_sha256,state=CASE WHEN state='reserved' THEN 'verified' ELSE state END,expires_at=greatest(expires_at,now()+interval '3 days') WHERE id=u.id RETURNING * INTO u;
 RETURN jsonb_build_object('id',u.id,'state',u.state,'sha256',u.sha256);
END $f$;
ALTER FUNCTION sa_domain.account_transfer_verified(uuid,bigint,text) OWNER TO sa_worker;

DO $f$ DECLARE f record;args_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['account_transfer_upload','account_transfer_input','account_transfer_verified']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE '' END,'SELECT sa_domain.'||f.proname||'('||args_||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO %s',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid),CASE WHEN f.proname='account_transfer_verified' THEN 'service_role' ELSE 'sa_app,authenticated' END);
 END LOOP;
END $f$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('squad-transfers','squad-transfers',false,10485760,ARRAY['text/csv','application/octet-stream']) ON CONFLICT(id) DO NOTHING;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_media_writer,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
