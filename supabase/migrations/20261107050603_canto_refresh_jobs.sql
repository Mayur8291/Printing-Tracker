ALTER TABLE sa_sync.environment_state ADD COLUMN IF NOT EXISTS environment text;
ALTER TABLE sa_sync.environment_state ADD COLUMN IF NOT EXISTS active_job uuid;
CREATE TABLE IF NOT EXISTS sa_sync.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), environment text NOT NULL CHECK(environment IN ('staging','production')),
  requested_by uuid NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','unconfirmed')),
  stage text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
  finished_at timestamptz, heartbeat_at timestamptz, discard_revision bigint, run_id text,
  summary jsonb, message text, backup_prefix text, github_run_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS canto_one_active_refresh ON sa_sync.jobs(environment) WHERE status IN ('queued','running','unconfirmed');
ALTER TABLE sa_sync.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sa_sync.jobs FROM PUBLIC,anon,authenticated,sa_app;

CREATE OR REPLACE FUNCTION canto_api.request_refresh(environment text, discard_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state_ sa_sync.environment_state; job_ sa_sync.jobs;
BEGIN
  IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF NOT pg_try_advisory_xact_lock(20261107,1) THEN RAISE EXCEPTION 'A refresh or save is already running' USING ERRCODE='PT409'; END IF;
  SELECT * INTO state_ FROM sa_sync.environment_state WHERE singleton FOR UPDATE;
  IF state_.environment IS DISTINCT FROM request_refresh.environment THEN RAISE EXCEPTION 'Environment mismatch' USING ERRCODE='22023'; END IF;
  IF state_.cutover THEN RAISE EXCEPTION 'Old-system refresh is disabled after cutover' USING ERRCODE='PT409'; END IF;
  IF state_.active_job IS NOT NULL THEN RAISE EXCEPTION 'A refresh is already active' USING ERRCODE='PT409'; END IF;
  IF state_.edit_revision<>state_.synced_revision AND discard_revision IS DISTINCT FROM state_.edit_revision THEN
    RAISE EXCEPTION 'Supabase has local edits. Review and confirm their replacement before refreshing.' USING ERRCODE='PT409';
  END IF;
  INSERT INTO sa_sync.jobs(environment,requested_by,discard_revision)
  VALUES(request_refresh.environment,auth.uid(),request_refresh.discard_revision) RETURNING * INTO job_;
  UPDATE sa_sync.environment_state SET active_job=job_.id,updated_at=now() WHERE singleton;
  RETURN to_jsonb(job_)-'backup_prefix';
END;
$$;

CREATE OR REPLACE FUNCTION canto_api.refresh_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state_ jsonb; jobs_ jsonb; last_ jsonb;
BEGIN
  IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  SELECT to_jsonb(s) INTO state_ FROM sa_sync.environment_state s WHERE singleton;
  SELECT coalesce(jsonb_agg(to_jsonb(j)-'backup_prefix' ORDER BY created_at DESC),'[]') INTO jobs_
  FROM (SELECT * FROM sa_sync.jobs ORDER BY created_at DESC LIMIT 20) j;
  SELECT jsonb_build_object('committed_at',committed_at,'capture',report->'capture','run_id',run_id)
    INTO last_ FROM sa_sync.refresh_runs ORDER BY committed_at DESC LIMIT 1;
  RETURN jsonb_build_object('state',state_,'jobs',jobs_,'last_success',last_);
END;
$$;
REVOKE ALL ON FUNCTION canto_api.request_refresh(text,bigint),canto_api.refresh_status() FROM PUBLIC,anon,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.request_refresh(text,bigint),canto_api.refresh_status() TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('canto-sync-backups','canto-sync-backups',false,16777216)
ON CONFLICT(id) DO NOTHING;

-- Only the authenticated Edge controller may reconcile completed or rejected workflows.
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
    summary=CASE WHEN committed IS NULL THEN summary ELSE jsonb_build_object('changes',committed->'changes','rows',committed->'rows','tables',committed->'tables','users',committed->'users','auth_enrollment',committed->'auth_enrollment','public_schema_unchanged',committed->'public_schema_unchanged','staff_auth_unchanged',committed->'staff_auth_unchanged') END,
    message=CASE WHEN committed IS NOT NULL THEN NULL WHEN outcome='dispatch_rejected' THEN 'The refresh worker could not be started. No data was replaced. Try again.' ELSE 'The worker stopped without a verified commit. No refresh was published. You can retry.' END
    WHERE id=job_id;
  UPDATE sa_sync.environment_state SET active_job=NULL,updated_at=now() WHERE active_job=job_id;
  RETURN jsonb_build_object('reconciled',true);
END;
$$;
REVOKE ALL ON FUNCTION canto_api.refresh_reconcile(uuid,text,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT USAGE ON SCHEMA canto_api TO service_role;
GRANT EXECUTE ON FUNCTION canto_api.refresh_reconcile(uuid,text,text) TO service_role;
