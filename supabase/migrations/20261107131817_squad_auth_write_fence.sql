BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
-- GoTrue writes credentials outside business RPCs. Fence only meaningful credential
-- changes; ordinary sign-in/session timestamps must remain unaffected.
CREATE FUNCTION sa_domain.auth_write_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE s sa_sync.environment_state%ROWTYPE; allow_tests boolean;
BEGIN
 IF OLD.role IS DISTINCT FROM 'sa_app' OR ROW(NEW.encrypted_password,NEW.email,NEW.banned_until)
   IS NOT DISTINCT FROM ROW(OLD.encrypted_password,OLD.email,OLD.banned_until) THEN RETURN NEW; END IF;
 -- Only the SQL publication operator can authorize source credential reconciliation.
 -- This GUC is not accepted from any client RPC or JWT field.
 IF current_setting('squad.source_enrollment',true)='on' AND pg_has_role(session_user,'postgres','MEMBER') THEN RETURN NEW; END IF;
 -- GoTrue already holds the Auth row. Never wait behind a refresh holding the
 -- exclusive advisory lock and waiting for that same Auth row.
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN
  RAISE EXCEPTION 'Refresh in progress; retry account change later' USING ERRCODE='55000'; END IF;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;
 SELECT allow_test_writes INTO allow_tests FROM sa_domain.runtime_state WHERE singleton;
 IF s.active_job IS NOT NULL OR (NOT s.cutover AND NOT(s.environment='staging' AND allow_tests)) THEN
  RAISE EXCEPTION 'Account changes are disabled while this environment mirrors the old system' USING ERRCODE='55000'; END IF;
 UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.auth_write_fence() OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.auth_write_fence() FROM PUBLIC,anon,authenticated,sa_app,sa_guard;
CREATE TRIGGER squad_auth_write_fence BEFORE UPDATE OF encrypted_password,email,banned_until ON auth.users
 FOR EACH ROW EXECUTE FUNCTION sa_domain.auth_write_fence();
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
COMMIT;
