BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Minimal member labels for already-visible tasks. Private callers cannot use
-- this as an unrestricted user directory; the task scope is checked here too.
CREATE FUNCTION sa_domain.task_members(p_ids bigint[],p_query text DEFAULT NULL)
RETURNS TABLE(task_id bigint,user_id bigint,name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 IF NOT sa_domain.has_capability('notes') THEN RAISE EXCEPTION 'Capability is not enabled' USING ERRCODE='42501';END IF;
 IF (p_ids IS NULL AND nullif(btrim(p_query),'') IS NULL) OR cardinality(p_ids)>100 OR length(p_query)>200 THEN
  RAISE EXCEPTION 'Invalid task member lookup' USING ERRCODE='22023';END IF;
 RETURN QUERY SELECT m.task_id,m.user_id,u.name::text
 FROM sa_snapshot_20261019.sa_task_users m
 JOIN sa_snapshot_20261019.sa_users u ON u.id=m.user_id
 JOIN sa_snapshot_20261019.sa_tasks t ON t.id=m.task_id
 WHERE(p_ids IS NULL OR m.task_id=ANY(p_ids))
 AND(p_query IS NULL OR position(lower(btrim(p_query)) in lower(coalesce(u.name,'')))>0)
 AND(a.role_id=0 OR t.created_by_id=a.user_id OR t.id IN(SELECT sa_domain.assigned_task_ids()));
END $f$;
ALTER FUNCTION sa_domain.task_members(bigint[],text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.task_members(bigint[],text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.task_members(bigint[],text) TO sa_executor;

CREATE FUNCTION sa_domain.task_page_filtered(p_id bigint,p_state integer,p_order_id bigint,p_cursor text,p_limit integer,p_query text,p_assignment text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes');n integer:=sa_domain.page_limit(p_limit);
 q text:=nullif(btrim(p_query),'');assignment_ text:=coalesce(p_assignment,'all');ctx jsonb;after_ bigint;result_ jsonb;
BEGIN
 IF(p_state IS NOT NULL AND p_state NOT IN(0,1,2)) OR length(q)>200 OR assignment_ NOT IN('all','by_me','to_me') OR p_order_id<=0 THEN
  RAISE EXCEPTION 'Invalid task filter' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('tasks',jsonb_build_object('id',p_id,'state',p_state,'order',p_order_id,'query',q,'assignment',assignment_));
 after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH matches AS MATERIALIZED(SELECT DISTINCT task_id FROM sa_domain.task_members(CASE WHEN q IS NULL THEN ARRAY[]::bigint[] END,q) WHERE q IS NOT NULL),
 scan AS MATERIALIZED(SELECT t.* FROM sa_snapshot_20261019.sa_tasks t WHERE t.id<after_ AND(p_id IS NULL OR t.id=p_id)
 AND(p_state IS NULL AND t.status<>2 OR t.status=p_state) AND(p_order_id IS NULL OR t.order_id=p_order_id)
 AND(assignment_='all' OR assignment_='by_me' AND t.created_by_id=a.user_id OR assignment_='to_me' AND t.id IN(SELECT sa_domain.assigned_task_ids()))
 AND(q IS NULL OR position(lower(q) in lower(coalesce(t.note,'')))>0 OR t.order_id::text=q OR t.id IN(SELECT task_id FROM matches))
 ORDER BY t.id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 members AS MATERIALIZED(SELECT task_id,jsonb_agg(user_id::text ORDER BY user_id) ids,
 jsonb_agg(jsonb_build_object('id',user_id::text,'name',name) ORDER BY user_id) labels
 FROM(SELECT DISTINCT * FROM sa_domain.task_members(ARRAY(SELECT id FROM page))) x GROUP BY task_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',t.id::text,'note',t.note,'state',t.status,
 'deadline',t.deadline AT TIME ZONE 'UTC','creator_id',t.created_by_id::text,'order_id',t.order_id::text,
 'assignee_ids',coalesce(m.ids,'[]'),'assignees',coalesce(m.labels,'[]'),'updated_at',t.updated_at AT TIME ZONE 'UTC',
 'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY t.id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(t.id),ctx) END)
 INTO result_ FROM page t LEFT JOIN members m ON m.task_id=t.id LEFT JOIN sa_domain.entity_versions v ON v.kind='task' AND v.entity_id=t.id;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.task_page_filtered(bigint,integer,bigint,text,integer,text,text) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.task_page_filtered(bigint,integer,bigint,text,integer,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE OR REPLACE FUNCTION sa_domain.task_page(p_id bigint,p_state integer,p_order_id bigint,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT sa_domain.task_page_filtered(p_id,p_state,p_order_id,p_cursor,p_limit,NULL,'all')
$f$;
-- Preserve old argument names/defaults; existing clients remain valid. Avoid
-- PostgREST ambiguity by replacing, rather than overloading, each RPC.
DROP FUNCTION canto_api.v1_tasks_list(integer,bigint,text,integer);
DROP FUNCTION sa_domain.v1_tasks_list(integer,bigint,text,integer);
CREATE FUNCTION sa_domain.v1_tasks_list(p_state integer DEFAULT NULL,p_order_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30,p_query text DEFAULT NULL,p_assignment text DEFAULT 'all') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.task_page_filtered(NULL,p_state,p_order_id,p_cursor,p_limit,p_query,p_assignment)
$f$;
DROP FUNCTION canto_api.v1_task_assignees(text,integer);
DROP FUNCTION sa_domain.v1_task_assignees(text,integer);
CREATE FUNCTION sa_domain.v1_task_assignees(p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30,p_query text DEFAULT NULL,p_role integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes');n integer:=sa_domain.page_limit(p_limit);q text:=nullif(btrim(p_query),'');ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF length(q)>200 OR(p_role IS NOT NULL AND p_role NOT IN(0,1,2,4,11,12)) THEN RAISE EXCEPTION 'Invalid assignee filter' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('task_assignees',jsonb_build_object('query',q,'role',p_role));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.task_assignees() WHERE id<after_ AND(p_role IS NULL OR role=p_role)
 AND(q IS NULL OR position(lower(q) in lower(coalesce(name,'')))>0) ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name,'role',role) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;
DO $f$ DECLARE x record;args text;BEGIN
 FOR x IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname IN('v1_tasks_list','v1_task_assignees') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',x.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',x.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',x.oid::regprocedure);
  SELECT string_agg(quote_ident(v),',') INTO args FROM unnest(x.proargnames) v;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS %L',x.proname,pg_get_function_arguments(x.oid),format('SELECT sa_domain.%I(%s)',x.proname,args));
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',x.proname,pg_get_function_identity_arguments(x.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',x.proname,pg_get_function_identity_arguments(x.oid));
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
