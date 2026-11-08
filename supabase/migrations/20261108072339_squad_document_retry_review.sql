BEGIN;
DO $f$ DECLARE definition_ text;BEGIN
 SELECT pg_get_functiondef('sa_domain.v1_job_retry(uuid,text,text,uuid)'::regprocedure) INTO definition_;
 definition_:=replace(definition_,'''PROVIDER_UNAVAILABLE'',''LEASE_EXHAUSTED''','''PROVIDER_UNAVAILABLE'',''LEASE_EXHAUSTED'',''STORAGE_UNAVAILABLE''');
 definition_:=replace(definition_,$s$ UPDATE sa_domain.outbox SET status='pending',attempts=0$s$,$s$
 IF j.event_type IN('document.requested','document.mail') THEN
  DECLARE d sa_domain.documents;BEGIN
   SELECT * INTO d FROM sa_domain.documents WHERE id=(j.payload->>'document_id')::uuid FOR UPDATE;
   -- Failed output cleanup starts after 24 hours. The one-hour margin exceeds
   -- every worker lease/runtime and prevents retry racing that cleanup window.
   IF d.id IS NULL OR d.created_at<=now()-interval '23 hours' OR d.state='expired' OR d.output_cleanup_queued_at IS NOT NULL OR(j.event_type='document.requested' AND d.parts_cleanup_queued_at IS NOT NULL) OR(j.event_type='document.mail' AND d.state<>'ready') THEN
    RAISE EXCEPTION 'Document retention window requires a fresh request' USING ERRCODE='55000';
   END IF;
   UPDATE sa_domain.documents SET state=CASE WHEN j.event_type='document.requested' THEN 'queued' ELSE state END,error_code=CASE WHEN j.event_type='document.requested' THEN NULL ELSE error_code END,delivery_state=CASE WHEN j.event_type='document.mail' THEN 'pending' ELSE delivery_state END WHERE id=d.id;
  END;
 END IF;
 UPDATE sa_domain.outbox SET status='pending',attempts=0$s$);
 EXECUTE definition_;
END $f$;
COMMIT;
