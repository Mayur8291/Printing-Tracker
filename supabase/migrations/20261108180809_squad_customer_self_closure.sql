BEGIN;
-- WEB-GAP-01: Flutter Customer Delete Account -> Rails User#delete_account.
-- Preserve historical foreign keys. Keep the immutable canonical email reservation
-- instead of Rails' email suffix, so closure cannot accidentally re-enroll the same
-- identity. Existing administrator archive/self-protection remains unchanged.
GRANT CREATE ON SCHEMA sa_domain TO sa_account_writer;
GRANT EXECUTE ON FUNCTION sa_domain.actor(),sa_domain.require_roles(integer[]) TO sa_account_writer;

-- Read-only proof bridge. A refreshed JWT's iat is not password reauthentication:
-- require signed password AMR and a newly created, still-live current session.
-- https://supabase.com/docs/guides/auth/jwt-fields
CREATE FUNCTION sa_domain.self_closure_password_proof() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE claims_ jsonb:=auth.jwt();subject_ uuid:=auth.uid();session_ uuid;proof_ boolean;
BEGIN
 IF subject_ IS NULL OR claims_->>'role' IS DISTINCT FROM 'sa_app'
 OR jsonb_typeof(claims_->'amr') IS DISTINCT FROM 'array'
 OR coalesce(claims_->>'session_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
  RAISE EXCEPTION 'Sign in with your password again before closing your account' USING ERRCODE='28000';
 END IF;
 session_:=(claims_->>'session_id')::uuid;
 SELECT EXISTS(SELECT FROM jsonb_array_elements(claims_->'amr') a
 WHERE a->>'method'='password' AND jsonb_typeof(a->'timestamp')='number'
 AND CASE WHEN a->>'timestamp' ~ '^[0-9]{1,12}$' THEN (a->>'timestamp')::numeric
 BETWEEN extract(epoch FROM statement_timestamp()-interval '5 minutes') AND extract(epoch FROM statement_timestamp()+interval '30 seconds') ELSE false END) INTO proof_;
 IF NOT proof_ OR NOT EXISTS(SELECT FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
 WHERE s.id=session_ AND s.user_id=subject_ AND u.role='sa_app'
 AND (u.banned_until IS NULL OR u.banned_until<statement_timestamp())
 AND (s.not_after IS NULL OR s.not_after>statement_timestamp())
 AND s.created_at>=statement_timestamp()-interval '5 minutes'
 AND s.created_at<=statement_timestamp()+interval '30 seconds') THEN
  RAISE EXCEPTION 'Sign in with your password again before closing your account' USING ERRCODE='28000';
 END IF;
 RETURN session_;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.self_closure_password_proof() FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_executor,sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.self_closure_password_proof() TO sa_account_writer;

-- Narrow hosted-Auth mutation bridge: no target UUID/legacy ID is accepted.
-- The only permitted target is this signed subject's already completed self-close
-- command and blocked customer mapping. No Auth password, email, or metadata write.
CREATE FUNCTION sa_domain.revoke_closed_self_sessions(p_command_key uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE subject_ uuid:=auth.uid();legacy_ bigint;recorded_ jsonb;auth_ uuid;
BEGIN
 IF subject_ IS NULL OR auth.jwt()->>'role' IS DISTINCT FROM 'sa_app' OR p_command_key IS NULL THEN
  RAISE EXCEPTION 'Completed self-closure required' USING ERRCODE='42501';END IF;
 SELECT c.result,m.legacy_user_id INTO recorded_,legacy_
 FROM sa_domain.commands c JOIN sa_domain.runtime_state s ON s.generation=c.generation
 JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=c.actor_id AND m.enrollment_state='blocked'
 JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id AND u.role=3 AND u.disabled IS TRUE AND u.deleted_at IS NOT NULL
 WHERE c.actor_id=subject_ AND c.key=p_command_key AND c.operation='account.closed'
 AND c.result->>'state'='closed' AND c.result->>'id'=m.legacy_user_id::text
 AND EXISTS(SELECT FROM sa_domain.audit a WHERE a.actor_id=subject_ AND a.command_key=c.key
  AND a.operation='account.closed' AND a.entity_id=m.legacy_user_id AND a.generation=s.generation);
 IF recorded_ IS NULL THEN RAISE EXCEPTION 'Completed self-closure required' USING ERRCODE='42501';END IF;
 -- Serialize this account mutation, ban future sign-ins and remove existing
 -- sessions atomically. Application access also checks ban/source/mapping state;
 -- provider-level concurrent login behavior requires hosted Auth acceptance.
 SELECT a.id INTO auth_ FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id
 WHERE a.id=subject_ AND a.role='sa_app' AND m.legacy_user_id=legacy_
 AND lower(btrim(a.email))=m.canonical_email FOR UPDATE OF a;
 IF auth_ IS NULL THEN RAISE EXCEPTION 'Mapped account unavailable' USING ERRCODE='28000';END IF;
 UPDATE auth.users SET banned_until='9999-12-31 23:59:59+00'::timestamptz,updated_at=now() WHERE id=auth_;
 DELETE FROM auth.refresh_tokens WHERE user_id=auth_::text;
 DELETE FROM auth.sessions WHERE user_id=auth_;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.revoke_closed_self_sessions(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_executor,sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.revoke_closed_self_sessions(uuid) TO sa_account_writer;
COMMENT ON FUNCTION sa_domain.revoke_closed_self_sessions(uuid) IS 'Reviewed self-only hosted Auth bridge: own completed account.closed command/current generation/audit/blocked Customer mapping; ban mapped own user, remove own sessions and refresh tokens. No arbitrary target, password/email or metadata access.';

-- Reuse the installed account worker for durable provider state verification.
-- finish_command queues this event without calling the administrator-only revoke.
DO $f$ DECLARE definition_ text;needle_ text:='SELECT CASE WHEN';BEGIN
 definition_:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);
 IF position(needle_ IN definition_)=0 THEN RAISE EXCEPTION 'Account handler insertion point unavailable';END IF;
 EXECUTE replace(definition_,needle_,'SELECT CASE WHEN p_event=''account.closed'' THEN ''account_reconciliation'' WHEN');
END $f$;

CREATE FUNCTION sa_domain.v1_account_close(p_expected_version text,p_idempotency_key uuid,p_confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE claims_ jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
 subject_ uuid:=sa_domain.request_uid();session_ text;payload_ jsonb;hash_ bytea;prior_ sa_domain.commands;
 actor_ sa_domain.actor;user_ record;generation_ bigint;version_ text;result_ jsonb;
BEGIN
 IF subject_ IS NULL OR claims_->>'role' IS DISTINCT FROM 'sa_app' THEN RAISE EXCEPTION 'Customer session required' USING ERRCODE='42501';END IF;
 IF p_confirmation IS DISTINCT FROM 'DELETE MY ACCOUNT' OR p_idempotency_key IS NULL OR p_expected_version IS NULL OR length(p_expected_version)>80 THEN
  RAISE EXCEPTION 'Type DELETE MY ACCOUNT and review the current account version' USING ERRCODE='22023';END IF;
 session_:=claims_->>'session_id';
 IF coalesce(session_,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'Customer session required' USING ERRCODE='28000';END IF;
 payload_:=jsonb_build_object('version',p_expected_version,'confirmation',p_confirmation,'session_id',session_);
 hash_:=sha256(convert_to(payload_::text,'UTF8'));
 SELECT generation INTO generation_ FROM sa_domain.runtime_state WHERE singleton;
 SELECT * INTO prior_ FROM sa_domain.commands WHERE actor_id=subject_ AND key=p_idempotency_key;
 IF prior_.key IS NOT NULL THEN
  IF prior_.operation<>'account.closed' OR prior_.payload_hash<>hash_ THEN RAISE EXCEPTION 'Idempotency key was used for a different request' USING ERRCODE='22023';END IF;
  IF prior_.generation<>generation_ THEN RAISE EXCEPTION 'Closure receipt predates a refresh' USING ERRCODE='PT409';END IF;
  -- A lost response can be retried with the original still-signed access token.
  -- Return only that exact own receipt; never restore a revoked session or write.
  IF prior_.result->>'state'='closed' AND EXISTS(SELECT FROM sa_identity.sa_auth_identities m
   JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id
   WHERE m.auth_user_id=subject_ AND m.enrollment_state='blocked' AND u.role=3
   AND u.disabled IS TRUE AND u.deleted_at IS NOT NULL AND prior_.result->>'id'=u.id::text) THEN RETURN prior_.result;END IF;
 END IF;
 actor_:=sa_domain.require_roles(ARRAY[3]);
 PERFORM sa_domain.self_closure_password_proof();
 result_:=sa_domain.begin_command('account.closed',p_idempotency_key,payload_);
 IF result_ IS NOT NULL THEN RETURN result_;END IF;
 PERFORM sa_domain.person_structure_fence();
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||actor_.user_id,784139));
 SELECT id,role,deleted_at,disabled INTO user_ FROM sa_snapshot_20261019.sa_users WHERE id=actor_.user_id FOR UPDATE;
 IF user_.id IS NULL OR user_.role<>3 OR user_.deleted_at IS NOT NULL OR user_.disabled IS TRUE THEN
  RAISE EXCEPTION 'Customer account is no longer eligible' USING ERRCODE='28000';END IF;
 version_:=sa_domain.bump_version('person',actor_.user_id,p_expected_version);
 result_:=jsonb_build_object('id',actor_.user_id::text,'version',version_,'state','closed','sessions_revoked',true,'account_reconciliation','queued');
 -- Finish while ops_context can still resolve the live customer. All following
 -- changes are in this same transaction; any Auth error rolls the ledger back.
 PERFORM sa_domain.finish_command('account.closed',p_idempotency_key,'person',actor_.user_id,result_,
  jsonb_build_object('self_service',true,'historical_records_preserved',true,'canonical_email_reserved',true));
 UPDATE sa_snapshot_20261019.sa_users SET disabled=true,disabled_at=now() AT TIME ZONE 'UTC',
  deleted_at=now() AT TIME ZONE 'UTC',updated_at=now() AT TIME ZONE 'UTC' WHERE id=actor_.user_id;
 UPDATE sa_identity.sa_auth_identities SET enrollment_state='blocked' WHERE auth_user_id=subject_ AND legacy_user_id=actor_.user_id;
 PERFORM sa_domain.revoke_closed_self_sessions(p_idempotency_key);
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.v1_account_close(text,uuid,text) OWNER TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_account_close(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role,sa_executor,sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.v1_account_close(text,uuid,text) TO sa_app;
CREATE FUNCTION canto_api.v1_account_close(p_expected_version text,p_idempotency_key uuid,p_confirmation text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_account_close(p_expected_version,p_idempotency_key,p_confirmation) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_account_close(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_account_close(text,uuid,text) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_account_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
