BEGIN;
-- A staging rehearsal grants writes only to its exact disposable principals.
-- The switch remains false by default and expires even if the runner crashes.
ALTER TABLE sa_domain.runtime_state
 ADD COLUMN test_actor_ids uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN test_write_expires_at timestamptz,
 ADD CONSTRAINT squad_rehearsal_actor_bound CHECK(cardinality(test_actor_ids)<=32 AND array_position(test_actor_ids,NULL) IS NULL);
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
CREATE FUNCTION sa_domain.rehearsal_actor_allowed(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_domain.runtime_state WHERE singleton AND allow_test_writes
   AND p_actor=ANY(test_actor_ids) AND test_write_expires_at>statement_timestamp())
$f$;
ALTER FUNCTION sa_domain.rehearsal_actor_allowed(uuid) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.rehearsal_actor_allowed(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.rehearsal_actor_allowed(uuid) TO sa_executor,sa_media_writer,sa_account_writer;
DO $f$
DECLARE sig text; old_ text; new_ text; definition_ text;
BEGIN
 FOR sig,old_,new_ IN SELECT * FROM (VALUES
  ('sa_domain.begin_command(text,uuid,jsonb)',
   's.environment=''staging'' AND allow_tests',
   's.environment=''staging'' AND sa_domain.rehearsal_actor_allowed((ctx->>''auth_id'')::uuid)'),
  ('sa_domain.begin_media_command(text,uuid,jsonb)',
   's.environment=''staging'' AND allow_',
   's.environment=''staging'' AND sa_domain.rehearsal_actor_allowed(actor_)'),
  ('sa_domain.auth_write_fence()',
   's.environment=''staging'' AND allow_tests',
   's.environment=''staging'' AND sa_domain.rehearsal_actor_allowed(OLD.id)')
 ) AS changes(signature,old_text,new_text)
 LOOP
  definition_:=pg_get_functiondef(sig::regprocedure);
  IF position(old_ in definition_)=0 OR position(old_ in substring(definition_ from position(old_ in definition_)+length(old_)))>0 THEN
   RAISE EXCEPTION 'Expected unique staging rehearsal fence missing in %',sig;
  END IF;
  EXECUTE replace(definition_,old_,new_);
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
COMMIT;
