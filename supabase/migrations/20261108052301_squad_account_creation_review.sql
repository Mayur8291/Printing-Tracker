BEGIN;
-- GoTrue first inserts the account, then sets its database role and app metadata
-- in the same transaction. Capture password enrollment on the role transition,
-- as well as ordinary password updates; the deferred guard sees the final intent.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.account_credential_capture()'::regprocedure);
 d:=replace(d,'ELSE changed_:=NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password;END IF;',
 'ELSE changed_:=NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password OR(OLD.role IS DISTINCT FROM ''sa_app'' AND NEW.encrypted_password IS NOT NULL);END IF;');
 EXECUTE d;
END $f$;
DROP TRIGGER squad_account_password_capture ON auth.users;
CREATE TRIGGER squad_account_password_capture BEFORE INSERT OR UPDATE OF encrypted_password,role ON auth.users FOR EACH ROW EXECUTE FUNCTION sa_domain.account_credential_capture('password');
DROP TRIGGER squad_account_credential_fence ON auth.users;
CREATE CONSTRAINT TRIGGER squad_account_credential_fence AFTER INSERT OR UPDATE OF encrypted_password,raw_app_meta_data,role ON auth.users
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sa_domain.account_credential_fence();
COMMIT;
