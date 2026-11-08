BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor,sa_worker;
CREATE FUNCTION sa_domain.document_recipient() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();email_ text;
BEGIN SELECT email INTO email_ FROM sa_domain.auth_context() WHERE auth_id=a.auth_id;RETURN email_;END $f$;
ALTER FUNCTION sa_domain.document_recipient() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.document_recipient() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_recipient() TO sa_executor;
CREATE FUNCTION sa_domain.document_mail_payload(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;
BEGIN
 SELECT * INTO d FROM sa_domain.documents WHERE id=p_id;
 IF d.id IS NULL OR NOT sa_domain.document_current(d) OR d.state<>'ready' OR d.expires_at<=now() OR d.request->>'delivery' IS DISTINCT FROM 'email' THEN RAISE EXCEPTION 'Document mail unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('document_id',d.id,'kind',d.kind,'email',sa_domain.document_recipient(),'path',d.object_path,'bytes',d.bytes,'sha256',d.sha256,'pages',d.page_count);
END $f$;
ALTER FUNCTION sa_domain.document_mail_payload(uuid) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.document_mail_payload(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_mail_payload(uuid) TO sa_worker;

-- Only successful render publication can create this child; imported data and
-- repeat finish calls produce no duplicate delivery.
DO $f$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('sa_domain.squad_document_finish(uuid,uuid,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$s$IF error_ IS NOT NULL THEN UPDATE sa_domain.documents$s$,$s$IF error_ IS NULL THEN
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  SELECT j.id,j.actor_id,'document.mail','document',j.aggregate_id,j.id,j.generation,j.payload FROM sa_domain.documents x WHERE x.job_id=j.id AND x.request->>'delivery'='email' ON CONFLICT DO NOTHING;
 END IF;
 IF error_ IS NOT NULL THEN UPDATE sa_domain.documents$s$);EXECUTE d;
END $f$;
GRANT INSERT ON sa_domain.outbox TO sa_worker;

CREATE FUNCTION sa_domain.squad_document_mail_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;r jsonb;error_ text;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'document.mail' THEN RAISE EXCEPTION 'Document mail lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Document mail lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  r:=sa_domain.document_mail_payload((j.payload->>'document_id')::uuid);
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;
 END;
 IF error_ IS NOT NULL THEN
  UPDATE sa_domain.documents SET delivery_state='failed' WHERE id=(j.payload->>'document_id')::uuid;
  UPDATE sa_domain.outbox SET status='dead',last_error_code=error_,lease_until=NULL,completed_at=now(),revision=revision+1 WHERE id=j.id;
  UPDATE sa_domain.job_attempts SET state='failed',finished_at=now(),error_code=error_ WHERE lease_token=j.lease_token;
  RETURN jsonb_build_object('id',j.id,'state','dead','error_code',error_);
 END IF;
 UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state','prepared')||r;
END $f$;
ALTER FUNCTION sa_domain.squad_document_mail_prepare(uuid,uuid) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.squad_document_mail_finish(p_id uuid,p_lease_token uuid,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;retry_ boolean;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'document.mail' THEN RAISE EXCEPTION 'Document mail lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Document mail lease expired' USING ERRCODE='40001';END IF;
 IF p_code IS NULL OR p_code NOT IN('SENT','MAIL_NOT_ENABLED','PROVIDER_UNAVAILABLE') THEN RAISE EXCEPTION 'Invalid mail result' USING ERRCODE='22023';END IF;
 retry_:=p_code='PROVIDER_UNAVAILABLE' AND j.attempts<5;
 UPDATE sa_domain.documents SET delivery_state=CASE WHEN p_code='SENT' THEN 'sent' WHEN retry_ THEN 'pending' ELSE 'failed' END WHERE id=(j.payload->>'document_id')::uuid;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN p_code='SENT' THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=CASE WHEN p_code<>'SENT' THEN p_code END WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status=CASE WHEN p_code='SENT' THEN 'done' WHEN retry_ THEN 'pending' ELSE 'dead' END,last_error_code=CASE WHEN p_code<>'SENT' THEN p_code END,lease_until=NULL,completed_at=CASE WHEN NOT retry_ THEN now() END,available_at=now()+make_interval(secs=>least(3600,30*power(2,j.attempts)::int)),revision=revision+1 WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state',CASE WHEN p_code='SENT' THEN 'done' WHEN retry_ THEN 'pending' ELSE 'dead' END);
END $f$;
ALTER FUNCTION sa_domain.squad_document_mail_finish(uuid,uuid,text) OWNER TO sa_worker;

CREATE TABLE sa_domain.document_cleanup(path text PRIMARY KEY,document_id uuid NOT NULL REFERENCES sa_domain.documents,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 CHECK(path~'^g[0-9]+/[a-f0-9-]{36}/[a-f0-9-]{36}/(document|part-[0-9]{4})[.]pdf$'));
ALTER TABLE sa_domain.document_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.document_cleanup FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.document_cleanup TO sa_worker;
CREATE POLICY document_cleanup_worker ON sa_domain.document_cleanup TO sa_worker USING(true) WITH CHECK(true);
CREATE FUNCTION sa_domain.squad_document_cleanup(p_completed text[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_completed IS NULL OR cardinality(p_completed)>100 THEN RAISE EXCEPTION 'At most 100 cleanup paths' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RETURN jsonb_build_object('paths','[]'::jsonb,'paused',true);END IF;
 UPDATE sa_domain.document_cleanup SET deleted_at=now() WHERE path=ANY(p_completed) AND deleted_at IS NULL;
 UPDATE sa_domain.documents d SET state='failed',error_code=j.last_error_code FROM sa_domain.outbox j WHERE j.id=d.job_id AND j.status='dead' AND d.state IN('queued','rendering');
 UPDATE sa_domain.documents d SET delivery_state='failed' FROM sa_domain.outbox j WHERE j.event_type='document.mail' AND j.payload->>'document_id'=d.id::text AND j.status='dead' AND d.delivery_state='pending';
 UPDATE sa_domain.documents SET state='expired' WHERE state='ready' AND kind='catalogue' AND expires_at<=now();
 -- Small bounded batches; only generated outputs. Operational final PDFs are
 -- retained. All parts are expendable after a ready document or a terminal job.
 WITH eligible AS(SELECT d.* FROM sa_domain.documents d WHERE(d.state IN('ready','expired') OR d.state='failed' AND d.created_at<now()-interval '1 day') AND(d.parts_cleanup_queued_at IS NULL OR d.state IN('expired','failed') AND d.output_cleanup_queued_at IS NULL) AND NOT EXISTS(SELECT FROM sa_domain.outbox j WHERE j.id=d.job_id AND j.status IN('pending','leased')) ORDER BY d.sequence_id LIMIT 100),
 paths AS(SELECT d.id,'g'||d.generation::text||'/'||d.actor_id::text||'/'||d.id::text||'/part-'||lpad(i::text,4,'0')||'.pdf' path FROM eligible d CROSS JOIN LATERAL generate_series(0,CASE WHEN jsonb_array_length(coalesce(d.snapshot->'rows','[]'))>d.part_size THEN ceil(jsonb_array_length(d.snapshot->'rows')/d.part_size::numeric)::int-1 ELSE -1 END) i
 UNION ALL SELECT d.id,'g'||d.generation::text||'/'||d.actor_id::text||'/'||d.id::text||'/document.pdf' FROM eligible d WHERE d.state IN('expired','failed'))
 ,queued AS(INSERT INTO sa_domain.document_cleanup(path,document_id) SELECT path,id FROM paths ON CONFLICT DO NOTHING RETURNING document_id)
 UPDATE sa_domain.documents d SET parts_cleanup_queued_at=now(),output_cleanup_queued_at=CASE WHEN d.state IN('expired','failed') THEN now() ELSE d.output_cleanup_queued_at END WHERE d.id IN(SELECT id FROM eligible);
 RETURN(SELECT jsonb_build_object('paths',coalesce(jsonb_agg(path ORDER BY created_at,path),'[]'),'paused',false) FROM(SELECT path,created_at FROM sa_domain.document_cleanup WHERE deleted_at IS NULL ORDER BY created_at,path LIMIT 100) x);
END $f$;
ALTER FUNCTION sa_domain.squad_document_cleanup(text[]) OWNER TO sa_worker;
DO $f$ DECLARE d text;signature_ text;BEGIN
 SELECT pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure) INTO d;d:=replace(d,'SELECT CASE WHEN',$$SELECT CASE WHEN p_event='document.mail' THEN 'document_mail' WHEN$$);EXECUTE d;
 FOREACH signature_ IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP
  SELECT pg_get_functiondef(signature_::regprocedure) INTO d;d:=replace(d,'''document_render''','''document_render'',''document_mail''');EXECUTE d;
 END LOOP;
 -- At most one CPU-bound render per Edge invocation; other queued work can
 -- share the batch. A locked first render waits for a subsequent tick.
 SELECT pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure) INTO d;
 d:=replace(d,'ORDER BY available_at,sequence_id FOR UPDATE SKIP LOCKED LIMIT p_limit',
 $s$AND(event_type<>'document.requested' OR id=(SELECT x.id FROM sa_domain.outbox x WHERE x.generation=g AND x.attempts<5 AND x.status='pending' AND x.available_at<=now() AND x.event_type='document.requested' ORDER BY x.available_at,x.sequence_id LIMIT 1))
 ORDER BY available_at,sequence_id FOR UPDATE SKIP LOCKED LIMIT p_limit$s$);EXECUTE d;
END $f$;
DO $f$ DECLARE f record;args_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['squad_document_mail_prepare','squad_document_mail_finish','squad_document_cleanup']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),'SELECT sa_domain.'||f.proname||'('||args_||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO service_role',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
