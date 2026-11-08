BEGIN;
-- This temporary capability is registered only by the trusted staging harness.
-- It permits two exact download renders, never a queue drain or email delivery.
CREATE TABLE sa_domain.document_rehearsals(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox(id),
 document_id uuid NOT NULL UNIQUE REFERENCES sa_domain.documents(id),
 actor_id uuid NOT NULL,generation bigint NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
ALTER TABLE sa_domain.document_rehearsals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.document_rehearsals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sa_domain.document_rehearsals FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT SELECT ON sa_domain.document_rehearsals TO sa_worker;
CREATE POLICY document_rehearsal_worker ON sa_domain.document_rehearsals FOR SELECT TO sa_worker USING(true);
-- Retain exact render provenance after capability revocation and document
-- cleanup. A receipt is not itself a capability, and carries no source data.
CREATE TABLE sa_domain.document_rehearsal_receipts(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox(id),document_id uuid NOT NULL,
 lease_token uuid,phase text NOT NULL CHECK(phase IN('registered','prepare','finish','exhausted')),
 document_xmin text NOT NULL,document_sha256 text NOT NULL CHECK(document_sha256~'^[a-f0-9]{64}$'),
 job_state text NOT NULL CHECK(job_state IN('pending','leased','done','dead')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sa_domain.document_rehearsal_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.document_rehearsal_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sa_domain.document_rehearsal_receipts FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT SELECT,UPDATE ON sa_domain.document_rehearsal_receipts TO sa_worker;
CREATE POLICY document_rehearsal_receipt_worker ON sa_domain.document_rehearsal_receipts TO sa_worker USING(true) WITH CHECK(true);

CREATE FUNCTION sa_domain.document_rehearsal_register() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;j sa_domain.outbox;s sa_sync.environment_state;r sa_domain.runtime_state;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Document rehearsal registration is immutable' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Source refresh in progress' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('document-rehearsal-register',784144));
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;
 SELECT * INTO r FROM sa_domain.runtime_state WHERE singleton;
 NEW.created_at:=clock_timestamp();
 IF s.environment IS DISTINCT FROM 'staging' OR s.cutover IS DISTINCT FROM false OR s.active_job IS NOT NULL
  OR r.allow_test_writes IS DISTINCT FROM true OR (NEW.actor_id=ANY(r.test_actor_ids)) IS NOT TRUE
  OR NEW.generation IS DISTINCT FROM r.generation OR NEW.expires_at IS NULL
  OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>NEW.created_at+interval '15 minutes'
  OR r.test_write_expires_at IS NULL OR NEW.expires_at>r.test_write_expires_at THEN
  RAISE EXCEPTION 'Document rehearsal scope unavailable' USING ERRCODE='55000';
 END IF;
 IF (SELECT count(*) FROM sa_domain.document_rehearsals WHERE expires_at>NEW.created_at)>=2 THEN
  RAISE EXCEPTION 'At most two document rehearsals may be active' USING ERRCODE='54000';
 END IF;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=NEW.job_id FOR UPDATE;
 SELECT * INTO d FROM sa_domain.documents WHERE id=NEW.document_id FOR UPDATE;
 IF d.id IS NULL OR j.id IS NULL OR d.job_id IS DISTINCT FROM j.id
  OR d.actor_id IS DISTINCT FROM NEW.actor_id OR j.actor_id IS DISTINCT FROM NEW.actor_id
  OR d.generation IS DISTINCT FROM NEW.generation OR j.generation IS DISTINCT FROM NEW.generation
  OR d.kind NOT IN('delivery_challan','tailor_weekly') OR d.request->>'delivery' IS DISTINCT FROM 'download'
  OR d.delivery_state<>'not_requested' OR d.state<>'queued' OR d.snapshot IS NOT NULL OR d.snapshot_hash IS NOT NULL
  OR d.captured_at IS NOT NULL OR d.completed_at IS NOT NULL OR d.parts<>'[]' OR d.next_part<>0
  OR d.object_path IS NOT NULL OR d.bytes IS NOT NULL OR d.sha256 IS NOT NULL OR d.page_count IS NOT NULL
  OR d.parts_cleanup_queued_at IS NOT NULL OR d.output_cleanup_queued_at IS NOT NULL
  OR j.status<>'pending' OR j.attempts<>0 OR j.lease_token IS NOT NULL OR j.lease_until IS NOT NULL
  OR j.event_type<>'document.requested' OR j.aggregate_kind<>'document' OR j.aggregate_id IS DISTINCT FROM d.sequence_id
  OR j.payload IS DISTINCT FROM jsonb_build_object('document_id',d.id)
  OR NOT EXISTS(SELECT 1 FROM sa_domain.audit a WHERE a.actor_id=NEW.actor_id AND a.command_key=j.command_key
    AND a.generation=NEW.generation AND a.operation='document.requested' AND a.kind='document'
    AND a.entity_id=d.sequence_id AND a.changes=jsonb_build_object('document_id',d.id)) THEN
  RAISE EXCEPTION 'Only an untouched audited download document may be registered' USING ERRCODE='42501';
 END IF;
 NEW.request_hash:=encode(sha256(convert_to(jsonb_build_object('kind',d.kind,'request',d.request,
   'actor_id',d.actor_id,'generation',d.generation)::text,'UTF8')),'hex');
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.document_rehearsal_register() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER document_rehearsal_registration BEFORE INSERT OR UPDATE ON sa_domain.document_rehearsals
 FOR EACH ROW EXECUTE FUNCTION sa_domain.document_rehearsal_register();
CREATE FUNCTION sa_domain.document_rehearsal_seed_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 INSERT INTO sa_domain.document_rehearsal_receipts(job_id,document_id,phase,document_xmin,document_sha256,job_state)
 SELECT NEW.job_id,d.id,'registered',d.xmin::text,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),'pending'
 FROM sa_domain.documents d WHERE d.id=NEW.document_id
 ON CONFLICT(job_id) DO UPDATE SET document_id=excluded.document_id,lease_token=NULL,phase='registered',
 document_xmin=excluded.document_xmin,document_sha256=excluded.document_sha256,job_state='pending',recorded_at=clock_timestamp();
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.document_rehearsal_seed_receipt() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER document_rehearsal_initial_receipt AFTER INSERT ON sa_domain.document_rehearsals
 FOR EACH ROW EXECUTE FUNCTION sa_domain.document_rehearsal_seed_receipt();

GRANT CREATE ON SCHEMA sa_domain TO sa_worker,sa_executor;
CREATE FUNCTION sa_domain.document_rehearsal_scope(p_id uuid) RETURNS sa_domain.document_rehearsals
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.document_rehearsals;d sa_domain.documents;j sa_domain.outbox;
 s sa_sync.environment_state;r sa_domain.runtime_state;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Source refresh in progress' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;
 SELECT * INTO r FROM sa_domain.runtime_state WHERE singleton;
 SELECT * INTO c FROM sa_domain.document_rehearsals WHERE job_id=p_id;
 IF c.job_id IS NULL OR s.environment IS DISTINCT FROM 'staging' OR s.cutover IS DISTINCT FROM false
  OR s.active_job IS NOT NULL OR r.allow_test_writes IS DISTINCT FROM true OR (c.actor_id=ANY(r.test_actor_ids)) IS NOT TRUE
  OR c.generation IS DISTINCT FROM r.generation OR c.expires_at<=clock_timestamp()
  OR r.test_write_expires_at IS NULL OR r.test_write_expires_at<=clock_timestamp() OR c.expires_at>r.test_write_expires_at THEN
  RAISE EXCEPTION 'Document rehearsal scope unavailable' USING ERRCODE='55000';
 END IF;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id;
 SELECT * INTO d FROM sa_domain.documents WHERE id=c.document_id;
 IF d.id IS NULL OR j.id IS NULL OR d.job_id IS DISTINCT FROM j.id
  OR d.actor_id IS DISTINCT FROM c.actor_id OR j.actor_id IS DISTINCT FROM c.actor_id
  OR d.generation IS DISTINCT FROM c.generation OR j.generation IS DISTINCT FROM c.generation
  OR d.kind NOT IN('delivery_challan','tailor_weekly') OR d.request->>'delivery' IS DISTINCT FROM 'download'
  OR d.delivery_state<>'not_requested' OR j.event_type<>'document.requested' OR j.aggregate_kind<>'document'
  OR j.aggregate_id IS DISTINCT FROM d.sequence_id OR j.payload IS DISTINCT FROM jsonb_build_object('document_id',d.id)
  OR c.request_hash<>encode(sha256(convert_to(jsonb_build_object('kind',d.kind,'request',d.request,
   'actor_id',d.actor_id,'generation',d.generation)::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Document rehearsal binding changed' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM sa_domain.documents x JOIN sa_domain.document_rehearsal_receipts proof
  ON proof.job_id=c.job_id AND proof.document_id=x.id WHERE x.id=c.document_id AND proof.document_xmin=x.xmin::text
  AND proof.document_sha256=encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'Document changed outside its rehearsal worker' USING ERRCODE='42501';
 END IF;
 RETURN c;
END $f$;
ALTER FUNCTION sa_domain.document_rehearsal_scope(uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.document_rehearsal_scope(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;

-- Reuse ordinary current Auth/source/role/scope checks under the existing exact
-- transaction-local worker context; this adds no broader impersonation bridge.
CREATE FUNCTION sa_domain.document_rehearsal_current(p_document uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;
BEGIN
 SELECT * INTO d FROM sa_domain.documents WHERE id=p_document;
 IF d.id IS NULL OR sa_domain.document_current(d) IS NOT TRUE THEN
  RAISE EXCEPTION 'Document authority changed' USING ERRCODE='42501';
 END IF;
 PERFORM sa_domain.document_spec(d.kind,d.request);
END $f$;
ALTER FUNCTION sa_domain.document_rehearsal_current(uuid) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.document_rehearsal_current(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_rehearsal_current(uuid) TO sa_worker;

CREATE FUNCTION sa_domain.document_rehearsal_record(p_id uuid,p_lease_token uuid,p_phase text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sa_sync.environment_state WHERE singleton AND environment='staging' AND NOT cutover)
  OR NOT EXISTS(SELECT 1 FROM sa_domain.document_rehearsals WHERE job_id=p_id) THEN RETURN;END IF;
 IF p_phase NOT IN('prepare','finish','exhausted') OR p_lease_token IS NULL THEN
  RAISE EXCEPTION 'Invalid document rehearsal receipt' USING ERRCODE='22023';
 END IF;
 UPDATE sa_domain.document_rehearsal_receipts proof SET lease_token=p_lease_token,phase=p_phase,
  document_xmin=d.xmin::text,document_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),
  job_state=j.status,recorded_at=clock_timestamp()
 FROM sa_domain.document_rehearsals c JOIN sa_domain.documents d ON d.id=c.document_id
 JOIN sa_domain.outbox j ON j.id=c.job_id
 WHERE proof.job_id=p_id AND proof.document_id=d.id AND c.job_id=p_id AND j.lease_token=p_lease_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document rehearsal receipt unavailable' USING ERRCODE='42501';END IF;
END $f$;
ALTER FUNCTION sa_domain.document_rehearsal_record(uuid,uuid,text) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.document_rehearsal_record(uuid,uuid,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.document_worker_fence(p_id uuid,p_lease_token uuid) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.document_rehearsals;j sa_domain.outbox;
BEGIN
 IF (SELECT cutover FROM sa_sync.environment_state WHERE singleton) THEN RETURN sa_domain.worker_write_fence();END IF;
 c:=sa_domain.document_rehearsal_scope(p_id);
 -- Serialize with the same job -> document order as the ordinary workers, then
 -- revalidate the proof after any foreign writer has released the document.
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 PERFORM 1 FROM sa_domain.documents WHERE id=c.document_id FOR UPDATE;
 c:=sa_domain.document_rehearsal_scope(p_id);
 IF p_lease_token IS NULL OR j.lease_token IS DISTINCT FROM p_lease_token
  OR (j.status='leased' AND (j.lease_until IS NULL OR j.lease_until<=clock_timestamp())) THEN
  RAISE EXCEPTION 'Document lease unavailable' USING ERRCODE='PT409';
 END IF;
 IF j.status='leased' THEN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  PERFORM sa_domain.document_rehearsal_current(c.document_id);
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 END IF;
 RETURN c.generation;
END $f$;
ALTER FUNCTION sa_domain.document_worker_fence(uuid,uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.document_worker_fence(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.squad_document_rehearsal_claim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.document_rehearsals;j sa_domain.outbox;token_ uuid:=gen_random_uuid();deadline_ timestamptz;
BEGIN
 PERFORM sa_domain.assert_service_worker();c:=sa_domain.document_rehearsal_scope(p_id);
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE SKIP LOCKED;
 IF j.id IS NULL OR j.status IN('done','dead') OR(j.status='leased' AND j.lease_until>clock_timestamp())
  OR(j.status='pending' AND j.available_at>clock_timestamp()) THEN RETURN jsonb_build_object('jobs','[]'::jsonb);END IF;
 PERFORM 1 FROM sa_domain.documents WHERE id=c.document_id FOR UPDATE;
 c:=sa_domain.document_rehearsal_scope(p_id);
 IF j.status NOT IN('pending','leased') THEN RAISE EXCEPTION 'Document job unavailable' USING ERRCODE='55000';END IF;
 IF j.attempts>=5 THEN
  UPDATE sa_domain.job_attempts SET state='failed',finished_at=now(),error_code='LEASE_EXHAUSTED' WHERE job_id=j.id AND state='leased';
  UPDATE sa_domain.outbox SET status='dead',lease_until=NULL,last_error_code='LEASE_EXHAUSTED',completed_at=now(),revision=revision+1 WHERE id=j.id;
  UPDATE sa_domain.documents SET state='failed',error_code='LEASE_EXHAUSTED' WHERE id=c.document_id;
  PERFORM sa_domain.document_rehearsal_record(j.id,j.lease_token,'exhausted');
  RETURN jsonb_build_object('jobs','[]'::jsonb);
 END IF;
 UPDATE sa_domain.job_attempts SET state='expired',finished_at=now(),error_code='LEASE_EXPIRED' WHERE job_id=j.id AND state='leased';
 deadline_:=least(clock_timestamp()+interval '180 seconds',c.expires_at);
 UPDATE sa_domain.outbox SET status='leased',lease_token=token_,lease_until=deadline_,attempts=attempts+1,revision=revision+1 WHERE id=j.id RETURNING * INTO j;
 INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
 PERFORM sa_domain.document_rehearsal_current(c.document_id);
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 INSERT INTO sa_domain.job_attempts(job_id,lease_token,attempt,state) VALUES(j.id,j.lease_token,j.attempts,'leased');
 RETURN jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('id',j.id,'lease_token',j.lease_token,
  'handler','document_render','attempt',j.attempts,'lease_until',j.lease_until)));
END $f$;
ALTER FUNCTION sa_domain.squad_document_rehearsal_claim(uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_document_rehearsal_claim(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_document_rehearsal_claim(uuid) TO service_role;
CREATE FUNCTION canto_api.squad_document_rehearsal_claim(p_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.squad_document_rehearsal_claim(p_id)
$f$;
REVOKE ALL ON FUNCTION canto_api.squad_document_rehearsal_claim(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_document_rehearsal_claim(uuid) TO service_role;

-- Preserve all existing worker/result contracts, security owners and grants.
-- In particular no generic job claim, worker fence or mail function is changed.
DO $f$ DECLARE sig text;definition_ text;needle_ text:='g:=sa_domain.worker_write_fence();';BEGIN
 FOREACH sig IN ARRAY ARRAY['sa_domain.squad_document_prepare(uuid,uuid)','sa_domain.squad_document_finish(uuid,uuid,jsonb)'] LOOP
  definition_:=pg_get_functiondef(sig::regprocedure);
  IF (length(definition_)-length(replace(definition_,needle_,'')))/length(needle_)<>1 THEN
   RAISE EXCEPTION 'Expected one document worker fence in %',sig;
  END IF;
  definition_:=replace(definition_,needle_,'g:=sa_domain.document_worker_fence(p_id,p_lease_token);');
  IF sig='sa_domain.squad_document_prepare(uuid,uuid)' THEN
   needle_:='lease_until=statement_timestamp()+interval ''180 seconds''';
   IF (length(definition_)-length(replace(definition_,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Expected document lease extension';END IF;
   definition_:=replace(definition_,needle_,$s$lease_until=CASE WHEN(SELECT cutover FROM sa_sync.environment_state WHERE singleton)
    THEN statement_timestamp()+interval '180 seconds' ELSE least(statement_timestamp()+interval '180 seconds',
     (SELECT expires_at FROM sa_domain.document_rehearsals WHERE job_id=p_id)) END$s$);
   needle_:='g:=sa_domain.worker_write_fence();';
  END IF;
  EXECUTE definition_;
 END LOOP;
END $f$;
-- Successful results and their exact stored row proof commit atomically. The
-- initial receipt prevents a retry from blessing a foreign document edit.
ALTER FUNCTION sa_domain.squad_document_prepare(uuid,uuid) RENAME TO document_prepare_standard;
ALTER FUNCTION sa_domain.squad_document_finish(uuid,uuid,jsonb) RENAME TO document_finish_standard;
REVOKE ALL ON FUNCTION sa_domain.document_prepare_standard(uuid,uuid),sa_domain.document_finish_standard(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.squad_document_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE result_ jsonb;
BEGIN
 result_:=sa_domain.document_prepare_standard(p_id,p_lease_token);
 PERFORM sa_domain.document_rehearsal_record(p_id,p_lease_token,'prepare');
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.squad_document_prepare(uuid,uuid) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.squad_document_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE result_ jsonb;
BEGIN
 result_:=sa_domain.document_finish_standard(p_id,p_lease_token,p_result);
 PERFORM sa_domain.document_rehearsal_record(p_id,p_lease_token,'finish');
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.squad_document_finish(uuid,uuid,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_document_prepare(uuid,uuid),sa_domain.squad_document_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_document_prepare(uuid,uuid),sa_domain.squad_document_finish(uuid,uuid,jsonb) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
