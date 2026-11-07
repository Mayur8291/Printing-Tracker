BEGIN;
-- Hosted Supabase does not let postgres delegate USAGE on its managed auth schema.
-- Keep one narrow, read-only Auth bridge as postgres; business functions continue
-- under NOBYPASSRLS roles. No authenticated-role membership is granted to app roles.
-- https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema-9e32e7
CREATE FUNCTION sa_domain.request_uid() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$f$;
REVOKE ALL ON FUNCTION sa_domain.request_uid() FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.request_uid() TO sa_guard,sa_executor;

CREATE FUNCTION sa_domain.auth_context() RETURNS TABLE(auth_id uuid,email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.id,u.email::text FROM auth.users u
 WHERE u.id=auth.uid() AND u.role='sa_app' AND auth.jwt()->>'role'='sa_app'
  AND (u.banned_until IS NULL OR u.banned_until<now())
  AND EXISTS(SELECT FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid
    AND s.user_id=u.id AND (s.not_after IS NULL OR s.not_after>now()))
$f$;
REVOKE ALL ON FUNCTION sa_domain.auth_context() FROM PUBLIC,anon,authenticated,sa_app,sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.auth_context() TO sa_guard;
COMMENT ON FUNCTION sa_domain.auth_context() IS 'Reviewed hosted-Auth privilege bridge: read-only, current verified subject/session only; never an arbitrary user ID. Sole postgres-owned domain definer exception.';

CREATE OR REPLACE FUNCTION sa_domain.actor() RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor;
BEGIN
 SELECT u.auth_id,s.id,s.role,s.factory_id,coalesce(s.features,'[]') INTO a
 FROM sa_domain.auth_context() u
 JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=u.auth_id AND m.enrollment_state='ready'
 JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id
 WHERE s.deleted_at IS NULL AND s.disabled IS NOT TRUE AND NOT(s.role=3 AND s.approved IS FALSE)
  AND s.role IN(0,1,2,3,4,7,8,9,10,11,12) AND lower(btrim(s.email))=lower(btrim(u.email));
 IF a.user_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000'; END IF;
 RETURN a;
END $f$;

ALTER POLICY executor_commands ON sa_domain.commands
 USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
ALTER POLICY executor_audit ON sa_domain.audit WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
ALTER POLICY executor_events ON sa_domain.outbox WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));

REVOKE SELECT(id,role,email,banned_until) ON auth.users FROM sa_guard;
REVOKE SELECT(id,user_id,not_after) ON auth.sessions FROM sa_guard;
REVOKE USAGE ON SCHEMA auth FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
