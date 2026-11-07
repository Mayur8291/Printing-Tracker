BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
-- Legacy staff inherit their factory from their manager; sub-tailors inherit via
-- the parent tailor. A client's own factory_id never overrides these links.
CREATE FUNCTION sa_domain.effective_factory(p_user_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN u.role IN(5,7,8,9) THEN m.factory_id WHEN u.role=6 THEN tm.factory_id ELSE u.factory_id END
 FROM sa_snapshot_20261019.sa_users u
 LEFT JOIN sa_snapshot_20261019.sa_users m ON m.id=u.factory_manager_id AND m.role=4
 LEFT JOIN sa_snapshot_20261019.sa_users t ON t.id=u.parent_tailor_id AND t.role=5
 LEFT JOIN sa_snapshot_20261019.sa_users tm ON tm.id=t.factory_manager_id AND tm.role=4 WHERE u.id=p_user_id
$f$;
ALTER FUNCTION sa_domain.effective_factory(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.factory_person_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH managers AS MATERIALIZED(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=4 AND factory_id=(SELECT (sa_domain.actor()).factory_id)),
 team AS MATERIALIZED(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role IN(5,7,8,9) AND factory_manager_id IN(SELECT id FROM managers))
 SELECT id FROM managers UNION SELECT id FROM team UNION SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=6 AND parent_tailor_id IN(SELECT id FROM team)
$f$;
ALTER FUNCTION sa_domain.factory_person_ids() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.effective_factory(bigint),sa_domain.factory_person_ids() FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.effective_factory(bigint),sa_domain.factory_person_ids() TO sa_executor,sa_guard;

CREATE OR REPLACE FUNCTION sa_domain.actor() RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor;context_ record;
BEGIN
 SELECT * INTO context_ FROM sa_domain.auth_context();
 IF context_.auth_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000';END IF;
 SELECT context_.auth_id,s.id,s.role,sa_domain.effective_factory(s.id),coalesce(s.features,'[]') INTO a
 FROM sa_identity.sa_auth_identities m JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id
 WHERE m.auth_user_id=context_.auth_id AND m.enrollment_state='ready' AND s.deleted_at IS NULL AND s.disabled IS NOT TRUE
 AND NOT(s.role=3 AND s.approved IS FALSE) AND s.role IN(0,1,2,3,4,7,8,9,10,11,12) AND lower(btrim(s.email))=lower(btrim(context_.email));
 IF a.user_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000';END IF;RETURN a;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.can_person(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users target CROSS JOIN sa_domain.actor() a
 WHERE target.id=p_id AND (a.role_id=0 OR target.id=a.user_id
 OR (a.role_id=1 AND target.role IN(3,10) AND target.created_by_id=a.user_id)
 OR (a.role_id=10 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.user_id=target.id AND d.dealer_id=a.user_id))
 OR (a.role_id=2 AND target.role IN(1,2,4,5,6,7,8,9,11))
 OR (a.role_id IN(4,7,8,9) AND target.id IN(SELECT sa_domain.factory_person_ids()))))
$f$;
ALTER POLICY squad_executor_people_read ON sa_snapshot_20261019.sa_users USING(
 id=(SELECT (sa_domain.actor()).user_id) OR (SELECT (sa_domain.actor()).role_id)=0
 OR ((SELECT (sa_domain.actor()).role_id)=1 AND role IN(3,10) AND created_by_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id)=10 AND id IN(SELECT sa_domain.dealer_customer_ids()))
 OR ((SELECT (sa_domain.actor()).role_id)=2 AND role IN(1,2,4,5,6,7,8,9,11))
 OR ((SELECT (sa_domain.actor()).role_id) IN(4,7,8,9) AND id IN(SELECT sa_domain.factory_person_ids())));
CREATE OR REPLACE FUNCTION sa_domain.work_person(p_id bigint,p_roles integer[],p_factory_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;
BEGIN
 SELECT jsonb_build_object('id',id::text,'factory_id',sa_domain.effective_factory(id)::text,'role',role) INTO r FROM sa_snapshot_20261019.sa_users
 WHERE id=p_id AND role=ANY(p_roles) AND disabled IS NOT TRUE AND deleted_at IS NULL AND (p_factory_id IS NULL OR sa_domain.effective_factory(id)=p_factory_id);
 IF r IS NULL THEN RAISE EXCEPTION 'Active person in the required role and factory was not found' USING ERRCODE='22023';END IF;RETURN r;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
