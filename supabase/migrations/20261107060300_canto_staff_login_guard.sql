-- Keep ordinary staff sign-in independent of long snapshot table locks.
CREATE OR REPLACE FUNCTION sa_identity.sa_validate_scott_auth_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a auth.users%ROWTYPE; m sa_identity.sa_auth_identities%ROWTYPE; eligible boolean;
BEGIN
 SELECT * INTO a FROM auth.users WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO m FROM sa_identity.sa_auth_identities WHERE auth_user_id=a.id;
 IF NOT FOUND THEN
   IF a.role IS DISTINCT FROM 'sa_app' AND EXISTS(SELECT FROM sa_identity.existing_staff_users WHERE id=a.id) THEN RETURN NEW; END IF;
   -- Login/session maintenance must not wait on snapshot publication for a
   -- non-Canto account whose identity was already checked when it was created.
   -- New accounts and email/role changes still run all collision checks below.
   IF TG_OP='UPDATE' AND a.role IS DISTINCT FROM 'sa_app'
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.email IS NOT DISTINCT FROM OLD.email
      AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
   IF a.role='sa_app' OR EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE canonical_email=lower(btrim(a.email)))
      OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=lower(btrim(a.email))) THEN
     RAISE EXCEPTION 'Canto identity requires its reserved registration';
   END IF;
   RETURN NEW;
 END IF;
 IF a.role IS DISTINCT FROM 'sa_app' THEN RAISE EXCEPTION 'Canto identity cannot change execution role'; END IF;
 SELECT s.deleted_at IS NULL AND s.disabled IS NOT TRUE
   AND NOT(coalesce(s.role=3,false) AND s.approved IS FALSE)
   AND lower(btrim(s.email))=lower(btrim(a.email))
 INTO eligible FROM sa_snapshot_20261019.sa_users s WHERE s.id=m.legacy_user_id;
 IF m.enrollment_state <> 'ready' OR eligible IS DISTINCT FROM true THEN
   IF a.banned_until IS NULL OR a.banned_until < '2100-01-01'::timestamptz THEN
     RAISE EXCEPTION 'Canto identity is blocked';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sa_identity.sa_validate_scott_auth_state() FROM PUBLIC;
