-- Private identity isolation. Existing public functions and business data are unchanged.
CREATE SCHEMA IF NOT EXISTS sa_identity;
CREATE SCHEMA IF NOT EXISTS sa_sync;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_app') THEN
 CREATE ROLE sa_app NOLOGIN NOINHERIT; END IF; END $$;
GRANT sa_app TO authenticator;
CREATE TABLE IF NOT EXISTS sa_sync.legacy_identity_keys(legacy_user_id bigint PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sa_identity.sa_auth_identities(
 auth_user_id uuid PRIMARY KEY, legacy_user_id bigint UNIQUE NOT NULL REFERENCES sa_sync.legacy_identity_keys(legacy_user_id),
 canonical_email text NOT NULL, import_disposition text NOT NULL,
 enrollment_state text NOT NULL, source_was_confirmed boolean NOT NULL,
 confirmation_basis text NOT NULL, reserved_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE sa_sync.legacy_identity_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_identity.sa_auth_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA sa_identity FROM PUBLIC,anon,authenticated,sa_app;
REVOKE ALL ON ALL TABLES IN SCHEMA sa_identity FROM PUBLIC,anon,authenticated,sa_app;
REVOKE ALL ON sa_sync.legacy_identity_keys FROM PUBLIC,anon,authenticated,sa_app;

-- Preserve pre-existing staff even if a future Rails email collides with theirs.
CREATE TABLE IF NOT EXISTS sa_identity.existing_staff_users(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
ALTER TABLE sa_identity.existing_staff_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sa_identity.existing_staff_users FROM PUBLIC,anon,authenticated,sa_app;
INSERT INTO sa_identity.existing_staff_users SELECT id FROM auth.users WHERE role IS DISTINCT FROM 'sa_app'
 ON CONFLICT DO NOTHING;

-- Used only by the Auth trigger WHEN clause; mapped imports skip staff profile provisioning.
CREATE OR REPLACE FUNCTION sa_identity.is_reserved(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM sa_identity.sa_auth_identities WHERE auth_user_id=p_id)
$$;
REVOKE ALL ON FUNCTION sa_identity.is_reserved(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA sa_identity TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION sa_identity.is_reserved(uuid) TO supabase_auth_admin;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW
 WHEN (NOT sa_identity.is_reserved(NEW.id)) EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION sa_identity.sa_validate_scott_auth_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a auth.users%ROWTYPE; m sa_identity.sa_auth_identities%ROWTYPE; eligible boolean;
BEGIN
 SELECT * INTO a FROM auth.users WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO m FROM sa_identity.sa_auth_identities WHERE auth_user_id=a.id;
 IF NOT FOUND THEN
   IF a.role IS DISTINCT FROM 'sa_app' AND EXISTS(SELECT FROM sa_identity.existing_staff_users WHERE id=a.id) THEN RETURN NEW; END IF;
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
DROP TRIGGER IF EXISTS sa_validate_scott_auth_state ON auth.users;
CREATE CONSTRAINT TRIGGER sa_validate_scott_auth_state AFTER INSERT OR UPDATE ON auth.users
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sa_identity.sa_validate_scott_auth_state();

CREATE OR REPLACE FUNCTION sa_identity.sa_protect_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SA identity reservations cannot be deleted'; END IF;
 IF ROW(NEW.auth_user_id,NEW.legacy_user_id,NEW.canonical_email,NEW.import_disposition,
        NEW.source_was_confirmed,NEW.confirmation_basis,NEW.reserved_at)
 IS DISTINCT FROM ROW(OLD.auth_user_id,OLD.legacy_user_id,OLD.canonical_email,OLD.import_disposition,
        OLD.source_was_confirmed,OLD.confirmation_basis,OLD.reserved_at) THEN
   RAISE EXCEPTION 'SA identity reservation classification is immutable';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sa_identity.sa_protect_reservation() FROM PUBLIC;
DROP TRIGGER IF EXISTS sa_protect_reservation ON sa_identity.sa_auth_identities;
CREATE TRIGGER sa_protect_reservation BEFORE DELETE OR UPDATE ON sa_identity.sa_auth_identities
 FOR EACH ROW EXECUTE FUNCTION sa_identity.sa_protect_reservation();
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname='canto_reservation_values') THEN
 ALTER TABLE sa_identity.sa_auth_identities ADD CONSTRAINT canto_reservation_values CHECK(
 import_disposition IN ('candidate','inactive','identity_exception') AND enrollment_state IN ('pending','ready','blocked')
 AND confirmation_basis IN ('source_confirmed','owner_approved_grandfather','not_activated'));
 END IF;
END $$;
