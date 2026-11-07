BEGIN;
-- The Auth bridge returns at most one row. Its default SETOF estimate of 1000
-- made the join in actor() repeatedly scan the identity/user population.
ALTER FUNCTION sa_domain.auth_context() ROWS 1;
CREATE OR REPLACE FUNCTION sa_domain.actor() RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor;context_ record;
BEGIN
 SELECT * INTO context_ FROM sa_domain.auth_context();
 IF context_.auth_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000';END IF;
 SELECT context_.auth_id,s.id,s.role,s.factory_id,coalesce(s.features,'[]') INTO a
 FROM sa_identity.sa_auth_identities m JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id
 WHERE m.auth_user_id=context_.auth_id AND m.enrollment_state='ready' AND s.deleted_at IS NULL AND s.disabled IS NOT TRUE
 AND NOT(s.role=3 AND s.approved IS FALSE) AND s.role IN(0,1,2,3,4,7,8,9,10,11,12) AND lower(btrim(s.email))=lower(btrim(context_.email));
 IF a.user_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000';END IF;RETURN a;
END $f$;
COMMIT;
