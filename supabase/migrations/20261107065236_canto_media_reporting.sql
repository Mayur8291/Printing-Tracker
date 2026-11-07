CREATE INDEX canto_media_reference_objects ON sa_media.references(sha256) WHERE sha256 IS NOT NULL;
CREATE FUNCTION canto_api.media_exceptions(page_number integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF page_number<1 OR page_number>100000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM
   (SELECT resource,record_id,field,pointer,status FROM sa_media.references WHERE status<>'ready'
    ORDER BY resource,record_id,field,pointer LIMIT 1000 OFFSET (page_number-1)::bigint*1000) x);
END $$;
REVOKE ALL ON FUNCTION canto_api.media_exceptions(integer) FROM PUBLIC,anon,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.media_exceptions(integer) TO authenticated;

CREATE OR REPLACE FUNCTION canto_api.refresh_reconcile(job_id uuid, outcome text, workflow_run_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j sa_sync.jobs; committed jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(20261107,1) THEN RETURN jsonb_build_object('busy',true); END IF;
  SELECT * INTO j FROM sa_sync.jobs WHERE id=job_id FOR UPDATE;
  IF NOT FOUND OR j.status IN ('succeeded','failed') THEN RETURN '{}'; END IF;
  IF outcome NOT IN ('dispatch_rejected','workflow_completed') THEN RAISE EXCEPTION 'Invalid reconciliation'; END IF;
  IF outcome='dispatch_rejected' AND j.status<>'queued' THEN RETURN '{}'; END IF;
  SELECT report INTO committed FROM sa_sync.refresh_runs WHERE report->>'job_id'=job_id::text ORDER BY committed_at DESC LIMIT 1;
  UPDATE sa_sync.jobs SET status=CASE WHEN committed IS NOT NULL THEN 'succeeded' ELSE 'failed' END,
    stage=CASE WHEN committed IS NOT NULL THEN 'verified' ELSE 'failed' END,finished_at=now(),
    github_run_id=coalesce(workflow_run_id,github_run_id),
    summary=CASE WHEN committed IS NULL THEN summary ELSE jsonb_build_object('changes',committed->'changes','rows',committed->'rows','tables',committed->'tables','users',committed->'users','auth_enrollment',committed->'auth_enrollment','public_schema_unchanged',committed->'public_schema_unchanged','staff_auth_unchanged',committed->'staff_auth_unchanged','media',committed->'media') END,
    message=CASE WHEN committed IS NOT NULL THEN NULL WHEN outcome='dispatch_rejected' THEN 'The refresh worker could not be started. No data was replaced. Try again.' ELSE 'The worker stopped without a verified commit. No refresh was published. You can retry.' END
    WHERE id=job_id;
  UPDATE sa_sync.environment_state SET active_job=NULL,updated_at=now() WHERE active_job=job_id;
  RETURN jsonb_build_object('reconciled',true);
END;
$$;
REVOKE ALL ON FUNCTION canto_api.refresh_reconcile(uuid,text,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT USAGE ON SCHEMA canto_api TO service_role;
GRANT EXECUTE ON FUNCTION canto_api.refresh_reconcile(uuid,text,text) TO service_role;
