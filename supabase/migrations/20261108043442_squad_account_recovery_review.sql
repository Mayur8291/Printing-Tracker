BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_account_writer;
-- Exhausted worker leases must also become visible on the person's account
-- request. Bound this repair independently of total queue size.
CREATE FUNCTION sa_domain.settle_account_failures() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.assert_service_worker();PERFORM sa_domain.worker_write_fence();
 WITH failed AS(SELECT r.id,j.last_error_code FROM sa_domain.account_requests r JOIN sa_domain.outbox j ON j.id=r.job_id
  WHERE r.state IN('queued','processing') AND j.status='dead'
  ORDER BY j.completed_at,j.id FOR UPDATE OF r SKIP LOCKED LIMIT 100)
 UPDATE sa_domain.account_requests r SET state='failed',error_code=f.last_error_code,updated_at=now() FROM failed f WHERE r.id=f.id;
END $f$;
ALTER FUNCTION sa_domain.settle_account_failures() OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.settle_account_failures() FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_guard,sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.settle_account_failures() TO sa_worker;
CREATE INDEX squad_account_open_jobs ON sa_domain.account_requests(job_id) WHERE state IN('queued','processing');
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 d:=replace(d,' WITH candidates AS(', E' PERFORM sa_domain.settle_account_failures();\n WITH candidates AS(');EXECUTE d;
 -- Tailors/subtailors are managed subjects, not new login accounts. Archiving
 -- an unmapped subject needs no UUID/email reservation or provider call.
 d:=pg_get_functiondef('sa_domain.squad_account_prepare(uuid,uuid)'::regprocedure);
 d:=replace(d,$s$ PERFORM pg_advisory_xact_lock(hashtextextended('person-email:'$s$,$s$
 IF (target_->>'legacy_role_id')::integer IN(5,6) AND NOT EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE legacy_user_id=j.aggregate_id) THEN
  target_:=target_||jsonb_build_object('auth_user_id',NULL);
  UPDATE sa_domain.account_requests SET state='processing',desired=target_,updated_at=now() WHERE id=r.id;
  UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
  RETURN target_||jsonb_build_object('managed_subject',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person-email:'$s$);EXECUTE d;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_account_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
