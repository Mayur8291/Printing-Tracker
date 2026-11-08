BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_media_writer;
-- Existing refresh infrastructure is also present in a clean local bootstrap.
CREATE TABLE IF NOT EXISTS sa_sync.refresh_runs(run_id text PRIMARY KEY,environment text NOT NULL,committed_at timestamptz NOT NULL DEFAULT now(),report jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sa_sync.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),environment text NOT NULL CHECK(environment IN('staging','production')),
 requested_by uuid NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','failed','unconfirmed')),stage text NOT NULL DEFAULT 'queued',
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,heartbeat_at timestamptz,discard_revision bigint,run_id text,summary jsonb,message text,backup_prefix text,github_run_id text);
ALTER TABLE sa_sync.refresh_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_sync.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sa_sync.refresh_runs,sa_sync.jobs FROM PUBLIC,anon,authenticated,sa_app;
GRANT SELECT ON sa_sync.refresh_runs TO sa_guard;
GRANT SELECT ON sa_sync.environment_state,sa_domain.runtime_state TO sa_guard;
CREATE POLICY squad_cutover_environment_guard ON sa_sync.environment_state FOR SELECT TO sa_guard USING(singleton);
GRANT SELECT(environment,status) ON sa_sync.jobs TO sa_guard;
CREATE POLICY squad_cutover_refresh_read ON sa_sync.refresh_runs FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_cutover_jobs_read ON sa_sync.jobs FOR SELECT TO sa_guard USING(true);
CREATE INDEX IF NOT EXISTS squad_refresh_runs_latest ON sa_sync.refresh_runs(committed_at DESC,run_id DESC);

-- Only an explicit release operator can create this production authorization.
-- No API, service-role or app executor receives INSERT/UPDATE/DELETE permission.
CREATE TABLE sa_domain.production_release_authorizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 500),
 source_run_id text NOT NULL,artifact_sha256 text NOT NULL CHECK(artifact_sha256~'^[a-f0-9]{64}$'),
 generation bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 revoked_at timestamptz,CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
CREATE TABLE sa_domain.cutover_acceptances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),environment text NOT NULL CHECK(environment IN('staging','production')),
 source_run_id text NOT NULL,generation bigint NOT NULL,edit_revision bigint NOT NULL,
 facts_sha256 text NOT NULL,artifact_sha256 text NOT NULL CHECK(artifact_sha256~'^[a-f0-9]{64}$'),
 source_frozen_at timestamptz NOT NULL,source_watermark text NOT NULL,freeze_attestation text NOT NULL,
 verification jsonb NOT NULL,media_policy text NOT NULL CHECK(media_policy IN('all_available','reviewed_source_missing')),
 media_report_sha256 text NOT NULL,identity_policy text NOT NULL CHECK(identity_policy IN('all_eligible','reviewed_identity_exceptions')),
 identity_report_sha256 text NOT NULL,release_authorization_id uuid REFERENCES sa_domain.production_release_authorizations,
 verified_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',revoked_at timestamptz
);
CREATE TABLE sa_domain.cutover_commits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),environment text NOT NULL UNIQUE CHECK(environment IN('staging','production')),
 actor_id uuid NOT NULL,command_key uuid NOT NULL,acceptance_id uuid NOT NULL REFERENCES sa_domain.cutover_acceptances,
 generation bigint NOT NULL,before_generation bigint NOT NULL,edit_revision bigint NOT NULL,
 source_run_id text NOT NULL,source_archive_sha256 text NOT NULL,source_watermark text NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT now(),result jsonb NOT NULL,UNIQUE(actor_id,command_key)
);
ALTER TABLE sa_domain.production_release_authorizations ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.production_release_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.cutover_acceptances ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.cutover_acceptances FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.cutover_commits ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.cutover_commits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sa_domain.production_release_authorizations,sa_domain.cutover_acceptances,sa_domain.cutover_commits FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT SELECT ON sa_domain.production_release_authorizations,sa_domain.cutover_acceptances,sa_domain.cutover_commits TO sa_guard;
GRANT SELECT,INSERT ON sa_domain.cutover_acceptances TO sa_worker;
GRANT SELECT,INSERT ON sa_domain.cutover_commits TO sa_media_writer;
CREATE POLICY squad_cutover_release_guard ON sa_domain.production_release_authorizations FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_cutover_acceptance_guard ON sa_domain.cutover_acceptances FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_cutover_commit_guard ON sa_domain.cutover_commits FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_cutover_acceptance_worker ON sa_domain.cutover_acceptances TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY squad_cutover_commit_writer ON sa_domain.cutover_commits TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
GRANT UPDATE(cutover) ON sa_sync.environment_state TO sa_media_writer;
GRANT UPDATE(generation,allow_test_writes) ON sa_domain.runtime_state TO sa_media_writer;
CREATE POLICY squad_cutover_runtime_write ON sa_domain.runtime_state FOR UPDATE TO sa_media_writer USING(singleton) WITH CHECK(singleton);
CREATE POLICY squad_cutover_audit ON sa_domain.audit FOR SELECT TO sa_executor USING(kind='cutover' AND coalesce(((SELECT sa_domain.ops_context())->>'platform')::boolean,false));

CREATE FUNCTION sa_domain.cutover_platform() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'authenticated' OR nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' IS DISTINCT FROM 'authenticated' OR NOT sa_admin.is_admin()
 THEN RAISE EXCEPTION 'Current platform administrator session required' USING ERRCODE='42501';END IF;
 RETURN sa_domain.request_uid();
END $f$;
ALTER FUNCTION sa_domain.cutover_platform() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.cutover_platform() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.cutover_platform() TO sa_media_writer;

-- Provider ingress uses a verified activation, never a test-write flag or an
-- independently toggled boolean. The ledger survives source generations.
CREATE FUNCTION sa_domain.ownership_epoch() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('environment',s.environment,'generation',r.generation::text,'activated_at',c.committed_at,
 'source_run_id',c.source_run_id,'acceptance_id',c.acceptance_id)
 FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state r
 LEFT JOIN sa_domain.cutover_commits c ON c.environment=s.environment AND c.generation=r.generation AND s.cutover
 WHERE s.singleton AND r.singleton
$f$;
ALTER FUNCTION sa_domain.ownership_epoch() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.ownership_epoch() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.ownership_epoch() TO sa_guard,sa_worker,sa_executor;

GRANT SELECT(import_disposition) ON sa_identity.sa_auth_identities TO sa_guard;
GRANT SELECT(status,generation) ON sa_domain.outbox TO sa_guard;
GRANT SELECT(state) ON sa_domain.order_requests,sa_domain.account_requests,sa_domain.account_flows,sa_domain.transfers TO sa_guard;
GRANT SELECT(state,delivery_state) ON sa_domain.documents TO sa_guard;
GRANT SELECT(state,expires_at) ON sa_domain.transfer_uploads TO sa_guard;
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['outbox','order_requests','account_requests','account_flows','documents','transfers','transfer_uploads'] LOOP
  EXECUTE format('CREATE POLICY squad_cutover_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $f$;

CREATE FUNCTION sa_domain.cutover_facts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE s sa_sync.environment_state;r sa_domain.runtime_state;run_ sa_sync.refresh_runs;media_ jsonb;identity_ jsonb;work_ jsonb;stock_ bigint;bad_ bigint;source_ jsonb;
BEGIN
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;SELECT * INTO r FROM sa_domain.runtime_state WHERE singleton;
 SELECT * INTO run_ FROM sa_sync.refresh_runs ORDER BY committed_at DESC,run_id DESC LIMIT 1;
 SELECT jsonb_build_object('references',count(*),'missing',count(*) FILTER(WHERE x.status='missing'),'external',count(*) FILTER(WHERE x.status='external'),
 'unverified',count(*) FILTER(WHERE x.status NOT IN('ready','missing','external') OR x.status IS NULL OR x.status='ready' AND(o.sha256 IS NULL OR o.bytes<=0 OR o.verified_at IS NULL)),
 'report_sha256',encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(x.resource,x.record_id,x.field,x.pointer,x.status,x.source_value,x.sha256,o.bytes,o.object_path)
 ORDER BY x.resource,x.record_id,x.field,x.pointer),'[]')::text,'UTF8')),'hex')) INTO media_
 FROM sa_media.references x LEFT JOIN sa_media.objects o USING(sha256);
 SELECT jsonb_build_object('pending_mappings',count(*) FILTER(WHERE m.enrollment_state NOT IN('ready','blocked') OR m.enrollment_state IS NULL),
 'missing_source_mappings',(SELECT count(*) FROM sa_snapshot_20261019.sa_users u LEFT JOIN sa_identity.sa_auth_identities a ON a.legacy_user_id=u.id WHERE a.auth_user_id IS NULL),
 'report_sha256',encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(m.legacy_user_id,m.auth_user_id,m.import_disposition,m.enrollment_state) ORDER BY m.legacy_user_id),'[]')::text,'UTF8')),'hex'),
 'reported_exceptions',coalesce(run_.report->'auth_enrollment'->'identity_exception_count','null')) INTO identity_ FROM sa_identity.sa_auth_identities m;
 SELECT jsonb_build_object(
 'refresh_jobs',(SELECT count(*) FROM sa_sync.jobs WHERE environment=s.environment AND status IN('queued','running','unconfirmed')),
 'events',(SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')),
 'order_requests',(SELECT count(*) FROM sa_domain.order_requests WHERE state IN('queued','running')),
 'account_requests',(SELECT count(*) FROM sa_domain.account_requests WHERE state IN('queued','processing','failed')),
 'account_flows',(SELECT count(*) FROM sa_domain.account_flows WHERE state IN('pending','processing')),
 'documents',(SELECT count(*) FROM sa_domain.documents WHERE state IN('queued','rendering') OR delivery_state='pending'),
 'transfers',(SELECT count(*) FROM sa_domain.transfers WHERE state IN('queued','validating','validated','applying','exporting')),
 'media_uploads',(SELECT count(*) FROM sa_domain.media_uploads WHERE state IN('reserved','verified') AND expires_at>now()),
 'transfer_uploads',(SELECT count(*) FROM sa_domain.transfer_uploads WHERE state IN('reserved','verified') AND expires_at>now())) INTO work_;
 SELECT count(*) INTO stock_ FROM(SELECT DISTINCT user_id FROM sa_snapshot_20261019.sa_stocks WHERE user_id IS NOT NULL)d
 CROSS JOIN LATERAL sa_domain.stock_balances(d.user_id) b WHERE b.needs_reconciliation;
 SELECT count(*) INTO bad_ FROM sa_snapshot_20261019.sa_stocks st LEFT JOIN sa_snapshot_20261019.sa_users u ON u.id=st.user_id WHERE u.role IS DISTINCT FROM 10;
 source_:=jsonb_build_object('run_id',run_.run_id,'environment',run_.environment,'committed_at',run_.committed_at,'archive_sha256',run_.report->>'archive_sha256',
 'source_schema_sha256',run_.report->>'source_schema_sha256','capture',run_.report->'capture','generation',run_.report->'domain'->>'generation',
 'tables',run_.report->'tables','rows',run_.report->'rows','status',run_.report->>'status',
 'table_report_sha256',encode(sha256(convert_to(coalesce(run_.report->'table_content','null')::text,'UTF8')),'hex'),
 'auth_parity',run_.report->'auth_enrollment'->'password_hash_role_identity_parity','public_unchanged',run_.report->'public_schema_unchanged','staff_unchanged',run_.report->'staff_auth_unchanged');
 RETURN jsonb_build_object('environment',s.environment,'generation',r.generation::text,'edit_revision',s.edit_revision::text,'synced_revision',s.synced_revision::text,
 'cutover',s.cutover,'test_writes',r.allow_test_writes,'active_job',s.active_job,'source',source_,'media',media_,'identity',identity_,'unfinished',work_,
 'stock',jsonb_build_object('ambiguous_groups',stock_,'invalid_owners',bad_));
END $f$;
ALTER FUNCTION sa_domain.cutover_facts() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.cutover_facts() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.cutover_facts() TO sa_guard,sa_worker,sa_media_writer;

-- A trusted release verifier registers its artifact only after actual machine
-- checks. Source-write freeze is separately identified as operator attestation.
-- Clients cannot submit or waive machine checks through preview/commit.
CREATE FUNCTION sa_domain.squad_cutover_acceptance_register(p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE f jsonb;v jsonb;keys_ text[]:=ARRAY['auth_password_identity_parity','table_content_parity','sequence_high_water','media_storage_integrity','stock_source_integrity',
 'persona_journeys','workflow_acceptance','permission_matrix','refresh_rehearsal','mixed_load','provider_configuration','rollback_rehearsal'];k text;a sa_domain.cutover_acceptances;
 frozen_ timestamptz;verified_ timestamptz;release_ uuid;
BEGIN
 PERFORM sa_domain.assert_service_worker();PERFORM sa_domain.check_fields(p_evidence,ARRAY['source_run_id','source_watermark','source_frozen_at','freeze_attestation','artifact_sha256','verification','media_policy','media_report_sha256','identity_policy','identity_report_sha256','verified_at','release_authorization_id']);
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 f:=sa_domain.cutover_facts();
 IF f->>'environment' NOT IN('staging','production') OR (f->>'cutover')::boolean OR f->>'active_job' IS NOT NULL OR f->>'edit_revision'<>f->>'synced_revision' OR(f->>'test_writes')::boolean
 THEN RAISE EXCEPTION 'Environment is not a clean source mirror' USING ERRCODE='55000';END IF;
 IF p_evidence->>'source_run_id' IS DISTINCT FROM f->'source'->>'run_id' OR p_evidence->>'source_run_id' IS NULL THEN RAISE EXCEPTION 'Acceptance must bind the latest committed source run' USING ERRCODE='40001';END IF;
 v:=p_evidence->'verification';PERFORM sa_domain.check_fields(v,keys_);
 FOREACH k IN ARRAY keys_ LOOP IF v->k IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'All machine verification gates must pass: %',k USING ERRCODE='22023';END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['artifact_sha256','media_report_sha256','identity_report_sha256'] LOOP
  IF jsonb_typeof(p_evidence->k) IS DISTINCT FROM 'string' OR p_evidence->>k !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Evidence digest required' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['source_watermark','freeze_attestation'] LOOP
  IF jsonb_typeof(p_evidence->k) IS DISTINCT FROM 'string' OR length(btrim(p_evidence->>k)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Source freeze attestation and watermark required' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['source_frozen_at','verified_at'] LOOP
  IF pg_input_is_valid(p_evidence->>k,'timestamptz') IS NOT TRUE OR p_evidence->>k !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Evidence times require explicit timezone' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['started_at','finished_at'] LOOP
  IF pg_input_is_valid(f->'source'->'capture'->>k,'timestamptz') IS NOT TRUE OR f->'source'->'capture'->>k !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  THEN RAISE EXCEPTION 'Source capture times are missing or invalid' USING ERRCODE='22023';END IF;
 END LOOP;
 IF pg_input_is_valid(f->'source'->>'committed_at','timestamptz') IS NOT TRUE
 OR (f->'source'->'capture'->>'started_at')::timestamptz>(f->'source'->'capture'->>'finished_at')::timestamptz
 OR (f->'source'->'capture'->>'finished_at')::timestamptz>(f->'source'->>'committed_at')::timestamptz
 OR (f->'source'->>'committed_at')::timestamptz>now()
 THEN RAISE EXCEPTION 'Source capture time order is invalid' USING ERRCODE='22023';END IF;
 frozen_:=(p_evidence->>'source_frozen_at')::timestamptz;verified_:=(p_evidence->>'verified_at')::timestamptz;
 IF verified_>now() OR verified_<now()-interval '30 minutes' OR frozen_>verified_ OR frozen_<now()-interval '24 hours'
 OR frozen_>(f->'source'->'capture'->>'started_at')::timestamptz OR verified_<(f->'source'->>'committed_at')::timestamptz
 THEN RAISE EXCEPTION 'Source freeze or verification time is stale/inconsistent' USING ERRCODE='22023';END IF;
 IF p_evidence->>'media_report_sha256' IS DISTINCT FROM f->'media'->>'report_sha256' OR p_evidence->>'identity_report_sha256' IS DISTINCT FROM f->'identity'->>'report_sha256'
 THEN RAISE EXCEPTION 'Reviewed exception evidence changed' USING ERRCODE='40001';END IF;
 IF coalesce(p_evidence->>'media_policy','') NOT IN('all_available','reviewed_source_missing') OR coalesce(p_evidence->>'identity_policy','') NOT IN('all_eligible','reviewed_identity_exceptions')
 THEN RAISE EXCEPTION 'Explicit exception policy required' USING ERRCODE='22023';END IF;
 IF p_evidence->>'release_authorization_id' IS NOT NULL THEN
  IF pg_input_is_valid(p_evidence->>'release_authorization_id','uuid') IS NOT TRUE THEN RAISE EXCEPTION 'Invalid release authorization' USING ERRCODE='22023';END IF;release_:=(p_evidence->>'release_authorization_id')::uuid;
 END IF;
 INSERT INTO sa_domain.cutover_acceptances(environment,source_run_id,generation,edit_revision,facts_sha256,artifact_sha256,source_frozen_at,source_watermark,freeze_attestation,
 verification,media_policy,media_report_sha256,identity_policy,identity_report_sha256,release_authorization_id,verified_at)
 VALUES(f->>'environment',p_evidence->>'source_run_id',(f->>'generation')::bigint,(f->>'edit_revision')::bigint,encode(sha256(convert_to(f::text,'UTF8')),'hex'),p_evidence->>'artifact_sha256',
 frozen_,p_evidence->>'source_watermark',p_evidence->>'freeze_attestation',v,p_evidence->>'media_policy',p_evidence->>'media_report_sha256',p_evidence->>'identity_policy',p_evidence->>'identity_report_sha256',release_,verified_) RETURNING * INTO a;
 RETURN jsonb_build_object('id',a.id,'environment',a.environment,'source_run_id',a.source_run_id,'generation',a.generation::text,'artifact_sha256',a.artifact_sha256,'expires_at',a.expires_at);
END $f$;
ALTER FUNCTION sa_domain.squad_cutover_acceptance_register(jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_cutover_acceptance_register(jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_cutover_acceptance_register(jsonb) TO service_role;

CREATE FUNCTION sa_domain.cutover_preview_data(p_acceptance_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE f jsonb:=sa_domain.cutover_facts();a sa_domain.cutover_acceptances;release_ sa_domain.production_release_authorizations;c jsonb;envelope_ jsonb;source_ jsonb:=f->'source';capture_ jsonb:=f->'source'->'capture';
BEGIN
 SELECT * INTO a FROM sa_domain.cutover_acceptances WHERE id=p_acceptance_id;
 IF a.release_authorization_id IS NOT NULL THEN SELECT * INTO release_ FROM sa_domain.production_release_authorizations WHERE id=a.release_authorization_id;END IF;
 c:=jsonb_build_object(
 'mirror',f->'cutover'='false'::jsonb,'test_override_off',f->'test_writes'='false'::jsonb,
 'clean_revision',f->>'edit_revision'=f->>'synced_revision','no_active_refresh',f->>'active_job' IS NULL,
 'no_unfinished_work',NOT EXISTS(SELECT FROM jsonb_each_text(f->'unfinished') x WHERE x.value::bigint<>0),
 'stock_unambiguous',(f->'stock'->>'ambiguous_groups')::bigint=0 AND(f->'stock'->>'invalid_owners')::bigint=0,
 'identity_mappings_complete',(f->'identity'->>'pending_mappings')::bigint=0 AND(f->'identity'->>'missing_source_mappings')::bigint=0,
 'media_verified',(f->'media'->>'unverified')::bigint=0,
 'source_verified',coalesce(source_->>'status'='committed' AND source_->>'environment'=f->>'environment' AND source_->>'generation'=f->>'generation'
 AND source_->'auth_parity'='true'::jsonb AND source_->'public_unchanged'='true'::jsonb AND source_->'staff_unchanged'='true'::jsonb
 AND source_->>'archive_sha256'~'^[a-f0-9]{64}$' AND source_->>'source_schema_sha256'~'^[a-f0-9]{64}$' AND source_->'tables'='86'::jsonb,false),
 'source_timestamps',CASE WHEN pg_input_is_valid(capture_->>'started_at','timestamptz') IS TRUE AND pg_input_is_valid(capture_->>'finished_at','timestamptz') IS TRUE
 AND pg_input_is_valid(source_->>'committed_at','timestamptz') IS TRUE AND capture_->>'started_at'~'(Z|[+-][0-9]{2}:[0-9]{2})$' AND capture_->>'finished_at'~'(Z|[+-][0-9]{2}:[0-9]{2})$'
 THEN (capture_->>'started_at')::timestamptz<=(capture_->>'finished_at')::timestamptz AND(capture_->>'finished_at')::timestamptz<=(source_->>'committed_at')::timestamptz
 AND(source_->>'committed_at')::timestamptz<=now() AND(capture_->>'started_at')::timestamptz>=now()-interval '24 hours' ELSE false END,
 'source_environment',coalesce(capture_->>'environment'=f->>'environment' AND capture_->>'archive_sha256'=source_->>'archive_sha256'
 AND CASE f->>'environment' WHEN 'staging' THEN capture_->>'source_host'='64.227.186.227' AND capture_->>'database'='scott_international_backend_staging_v2' AND capture_->>'destination'='scvojtvgnkmbupvyslmb'
 WHEN 'production' THEN capture_->>'source_host'='165.22.210.53' AND capture_->>'database'='scott_international_backend_production' AND capture_->>'destination'='levwrmvqdntngeasrtnb' ELSE false END,false),
 'acceptance_current',a.id IS NOT NULL AND a.environment=f->>'environment' AND a.generation=(f->>'generation')::bigint AND a.edit_revision=(f->>'edit_revision')::bigint
 AND a.source_run_id=source_->>'run_id' AND a.facts_sha256=encode(sha256(convert_to(f::text,'UTF8')),'hex') AND a.expires_at>now() AND a.revoked_at IS NULL,
 'media_exception_policy',coalesce(a.media_report_sha256=f->'media'->>'report_sha256' AND((f->'media'->>'missing')::bigint=0 AND(f->'media'->>'external')::bigint=0 OR a.media_policy='reviewed_source_missing'),false),
 'identity_exception_policy',coalesce(a.identity_report_sha256=f->'identity'->>'report_sha256' AND((f->'identity'->>'reported_exceptions')::bigint=0 OR a.identity_policy='reviewed_identity_exceptions'),false),
 'production_release',f->>'environment'='staging' OR coalesce(release_.id IS NOT NULL AND release_.revoked_at IS NULL AND release_.expires_at>now() AND release_.source_run_id=a.source_run_id
 AND release_.artifact_sha256=a.artifact_sha256 AND release_.generation=a.generation,false));
 envelope_:=jsonb_build_object('facts',f,'acceptance',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'artifact_sha256',a.artifact_sha256,'expires_at',a.expires_at,
 'source_watermark',a.source_watermark,'source_frozen_at',a.source_frozen_at,'freeze_attestation',a.freeze_attestation,'verified_at',a.verified_at,'media_policy',a.media_policy,'identity_policy',a.identity_policy) END,'checks',c);
 RETURN envelope_||jsonb_build_object('ready',NOT EXISTS(SELECT FROM jsonb_each(c)x WHERE x.value IS DISTINCT FROM 'true'::jsonb),
 'blockers',(SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') FROM jsonb_each(c)x WHERE x.value IS DISTINCT FROM 'true'::jsonb),
 'version',encode(sha256(convert_to(envelope_::text,'UTF8')),'hex'));
END $f$;
ALTER FUNCTION sa_domain.cutover_preview_data(uuid) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.cutover_preview_data(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.cutover_preview_data(uuid) TO sa_media_writer;

CREATE FUNCTION sa_domain.v1_cutover_preview(p_acceptance_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.cutover_platform();
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 RETURN sa_domain.cutover_preview_data(p_acceptance_id)||jsonb_build_object('as_of',now());
END $f$;
ALTER FUNCTION sa_domain.v1_cutover_preview(uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_cutover_preview(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_cutover_preview(uuid) TO authenticated;

CREATE FUNCTION sa_domain.v1_cutover_commit(p_acceptance_id uuid,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE actor_ uuid:=sa_domain.cutover_platform();p jsonb;f jsonb;hash_ bytea:=sha256(convert_to(jsonb_build_object('acceptance_id',p_acceptance_id,'version',p_expected_version)::text,'UTF8'));
 old_ sa_domain.commands;s sa_sync.environment_state;generation_ bigint;id_ uuid:=gen_random_uuid();result_ jsonb;
BEGIN
 IF p_acceptance_id IS NULL OR p_idempotency_key IS NULL OR p_expected_version IS NULL OR p_expected_version!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Acceptance, preview version and idempotency key required' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock(20261107,1) OR NOT pg_try_advisory_xact_lock(20261107,2) THEN RAISE EXCEPTION 'Refresh or business writes are active' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton FOR UPDATE;SELECT generation INTO generation_ FROM sa_domain.runtime_state WHERE singleton FOR UPDATE;
 SELECT * INTO old_ FROM sa_domain.commands WHERE actor_id=actor_ AND key=p_idempotency_key FOR UPDATE;
 IF old_.key IS NOT NULL THEN
  IF old_.operation<>'ownership.cutover' OR old_.payload_hash<>hash_ THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='22023';END IF;
  IF old_.result IS NOT NULL AND EXISTS(SELECT FROM sa_domain.cutover_commits c WHERE c.actor_id=actor_ AND c.command_key=p_idempotency_key AND c.environment=s.environment AND c.generation=generation_ AND s.cutover) THEN RETURN old_.result;END IF;
  RAISE EXCEPTION 'Previous ownership command no longer matches this environment' USING ERRCODE='40001';
 END IF;
 IF s.cutover OR EXISTS(SELECT FROM sa_domain.cutover_commits WHERE environment=s.environment) THEN RAISE EXCEPTION 'Ownership was already activated; no reverse cutover is supported' USING ERRCODE='55000';END IF;
 p:=sa_domain.cutover_preview_data(p_acceptance_id);f:=p->'facts';
 IF p->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Cutover evidence changed; preview again' USING ERRCODE='40001';END IF;
 IF p->'ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Cutover acceptance gates have not passed' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.commands(actor_id,key,operation,payload_hash,generation) VALUES(actor_,p_idempotency_key,'ownership.cutover',hash_,generation_);
 UPDATE sa_sync.environment_state SET cutover=true,edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 UPDATE sa_domain.runtime_state SET generation=generation+1,allow_test_writes=false WHERE singleton RETURNING generation INTO generation_;
 result_:=jsonb_build_object('id',id_,'environment',s.environment,'owned',true,'generation',generation_::text,'activated_at',now(),
 'source_run_id',f->'source'->>'run_id','source_watermark',p->'acceptance'->>'source_watermark','acceptance_id',p_acceptance_id,'old_source_refresh_enabled',false);
 INSERT INTO sa_domain.cutover_commits(id,environment,actor_id,command_key,acceptance_id,generation,before_generation,edit_revision,source_run_id,source_archive_sha256,source_watermark,result)
 VALUES(id_,s.environment,actor_,p_idempotency_key,p_acceptance_id,generation_,generation_-1,s.edit_revision+1,f->'source'->>'run_id',f->'source'->>'archive_sha256',p->'acceptance'->>'source_watermark',result_);
 UPDATE sa_domain.commands SET result=result_ WHERE actor_id=actor_ AND key=p_idempotency_key;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes)
 VALUES(actor_,NULL,'ownership.cutover','cutover',generation_,p_idempotency_key,result_||jsonb_build_object('artifact_sha256',p->'acceptance'->>'artifact_sha256','before_edit_revision',s.edit_revision));
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.v1_cutover_commit(uuid,text,uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_cutover_commit(uuid,text,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_cutover_commit(uuid,text,uuid) TO authenticated;

CREATE FUNCTION canto_api.v1_cutover_preview(p_acceptance_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_cutover_preview(p_acceptance_id) $f$;
CREATE FUNCTION canto_api.v1_cutover_commit(p_acceptance_id uuid,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_cutover_commit(p_acceptance_id,p_expected_version,p_idempotency_key) $f$;
CREATE FUNCTION canto_api.squad_cutover_acceptance_register(p_evidence jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_cutover_acceptance_register(p_evidence) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_cutover_preview(uuid),canto_api.v1_cutover_commit(uuid,text,uuid),canto_api.squad_cutover_acceptance_register(jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_cutover_preview(uuid),canto_api.v1_cutover_commit(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION canto_api.squad_cutover_acceptance_register(jsonb) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
