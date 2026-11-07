BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE FUNCTION sa_domain.people_factory_ids(p_factory_id bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH managers AS MATERIALIZED(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=4 AND factory_id=p_factory_id),
 team AS MATERIALIZED(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role IN(5,7,8,9) AND factory_manager_id IN(SELECT id FROM managers))
 SELECT id FROM managers UNION SELECT id FROM team UNION SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=6 AND parent_tailor_id IN(SELECT id FROM team)
$f$;
ALTER FUNCTION sa_domain.people_factory_ids(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.people_factory_ids(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.people_factory_ids(bigint) TO sa_executor;
-- Add an optional trailing filter object while preserving all existing positional
-- calls. Remove the old overload so PostgREST does not resolve ambiguously.
DROP FUNCTION canto_api.v1_people_list(integer,text,text,integer);
DROP FUNCTION sa_domain.v1_people_list(integer,text,text,integer);
CREATE FUNCTION sa_domain.v1_people_list(p_role integer DEFAULT NULL,p_search text DEFAULT '',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30,p_filters jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,4,7,8,10]);n int:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;k text;val jsonb;
BEGIN
 IF(p_role IS NOT NULL AND p_role NOT BETWEEN 0 AND 12) OR p_search IS NULL OR length(p_search)>100 THEN RAISE EXCEPTION 'Invalid directory filters' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.check_fields(p_filters,ARRAY['approved','onboarded','disabled','direct','coordinator_id','dealer_id','zone_id','price_type_id','registered_by','factory_id','manager_id','parent_tailor_id']);
 FOR k,val IN SELECT * FROM jsonb_each(p_filters) LOOP
  IF k IN('approved','registered_by') THEN
   IF jsonb_typeof(val)<>'array' OR jsonb_array_length(val) NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Use a nonempty set of review/origin states' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT FROM jsonb_array_elements(val) x WHERE CASE WHEN k='approved' THEN x NOT IN('true'::jsonb,'false'::jsonb,'null'::jsonb) ELSE x NOT IN('0'::jsonb,'1'::jsonb,'2'::jsonb,'3'::jsonb) END) THEN RAISE EXCEPTION 'Invalid review/origin state' USING ERRCODE='22023';END IF;
  ELSIF k IN('onboarded','disabled','direct') THEN IF jsonb_typeof(val)<>'boolean' THEN RAISE EXCEPTION 'Boolean directory filter required' USING ERRCODE='22023';END IF;
  ELSE PERFORM sa_domain.input_id(val);END IF;
 END LOOP;
 ctx:=sa_domain.page_context('people',jsonb_build_object('role',p_role,'search',p_search,'filters',p_filters));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(
 SELECT u.id,u.name,u.email,u.phone,u.role,u.customer_company_name,u.customer_first_name,u.customer_last_name,u.factory_id,u.approved,u.onboarded,u.disabled
 FROM sa_snapshot_20261019.sa_users u WHERE u.deleted_at IS NULL AND u.id<after_ AND(p_role IS NULL OR u.role=p_role)
 AND(NOT p_filters?'approved' OR p_filters->'approved' @> jsonb_build_array(u.approved))
 AND(NOT p_filters?'registered_by' OR p_filters->'registered_by' @> jsonb_build_array(u.customer_registered_by))
 AND(NOT p_filters?'onboarded' OR u.onboarded=(p_filters->>'onboarded')::boolean)
 AND(NOT p_filters?'disabled' OR u.disabled=(p_filters->>'disabled')::boolean)
 AND(NOT p_filters?'direct' OR coalesce(u.is_direct_deal,false)=(p_filters->>'direct')::boolean)
 AND(NOT p_filters?'coordinator_id' OR u.created_by_id=(p_filters->>'coordinator_id')::bigint)
 AND(NOT p_filters?'dealer_id' OR u.id IN(SELECT user_id FROM sa_snapshot_20261019.sa_user_dealers WHERE dealer_id=(p_filters->>'dealer_id')::bigint))
 AND(NOT p_filters?'zone_id' OR u.zone_id=(p_filters->>'zone_id')::bigint)
 AND(NOT p_filters?'price_type_id' OR u.rmp_price_type_id=(p_filters->>'price_type_id')::bigint)
 AND(NOT p_filters?'factory_id' OR u.id IN(SELECT sa_domain.people_factory_ids((p_filters->>'factory_id')::bigint)))
 AND(NOT p_filters?'manager_id' OR u.factory_manager_id=(p_filters->>'manager_id')::bigint OR(u.role=6 AND u.parent_tailor_id IN(SELECT t.id FROM sa_snapshot_20261019.sa_users t WHERE t.role=5 AND t.factory_manager_id=(p_filters->>'manager_id')::bigint)))
 AND(NOT p_filters?'parent_tailor_id' OR u.parent_tailor_id=(p_filters->>'parent_tailor_id')::bigint)
 AND(p_search='' OR strpos(lower(concat_ws(' ',u.id::text,u.name,u.customer_company_name,u.customer_first_name,u.customer_last_name,CASE WHEN a.role_id IN(0,1,4,10) OR u.id=a.user_id THEN CASE WHEN u.role NOT IN(5,6) THEN u.email END END)),lower(p_search))>0)
 ORDER BY u.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.person_projection(to_jsonb(p),a,(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
 INTO r FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='person' AND v.entity_id=p.id;RETURN r;
END $f$;
ALTER FUNCTION sa_domain.v1_people_list(integer,text,text,integer,jsonb) OWNER TO sa_executor;
CREATE FUNCTION canto_api.v1_people_list(p_role integer DEFAULT NULL,p_search text DEFAULT '',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30,p_filters jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_people_list(p_role,p_search,p_cursor,p_limit,p_filters) $f$;
REVOKE ALL ON FUNCTION sa_domain.v1_people_list(integer,text,text,integer,jsonb),canto_api.v1_people_list(integer,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION sa_domain.v1_people_list(integer,text,text,integer,jsonb),canto_api.v1_people_list(integer,text,text,integer,jsonb) TO sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.v1_people_list(integer,text,text,integer,jsonb) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
