-- Resolve notification links without scanning every responsibility page.
BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
CREATE FUNCTION sa_domain.v1_responsibility_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('goals');g sa_snapshot_20261019.sa_responsibilities;r jsonb;
BEGIN
 SELECT * INTO g FROM sa_snapshot_20261019.sa_responsibilities WHERE id=p_id;
 IF g.id IS NULL OR (a.role_id<>0 AND g.user_id<>a.user_id) OR EXISTS(
 SELECT FROM sa_domain.archived_entities x WHERE x.kind='responsibility' AND x.entity_id=p_id
 AND x.generation=(SELECT generation FROM sa_domain.runtime_state)) THEN
 RAISE EXCEPTION 'Responsibility unavailable' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('id',g.id::text,'subject_id',g.user_id::text,'kind',g.responsibility_type,
 'note',g.note,'completed',g.is_completed,'version',sa_domain.version('responsibility',g.id));
END $f$;
ALTER FUNCTION sa_domain.v1_responsibility_get(bigint) OWNER TO sa_executor;
CREATE FUNCTION canto_api.v1_responsibility_get(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_responsibility_get(p_id) $f$;
REVOKE ALL ON FUNCTION sa_domain.v1_responsibility_get(bigint),canto_api.v1_responsibility_get(bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_responsibility_get(bigint),canto_api.v1_responsibility_get(bigint) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
