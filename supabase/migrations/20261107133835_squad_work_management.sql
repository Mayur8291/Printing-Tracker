BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE TABLE sa_domain.archived_entities(
 kind text NOT NULL,entity_id bigint NOT NULL,generation bigint NOT NULL,actor_id uuid NOT NULL,
 reason text NOT NULL,archived_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,entity_id,generation)
);
ALTER TABLE sa_domain.archived_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.archived_entities FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.archived_entities TO sa_executor;
CREATE POLICY squad_archive_read ON sa_domain.archived_entities FOR SELECT TO sa_executor USING(true);
CREATE POLICY squad_archive_write ON sa_domain.archived_entities FOR INSERT TO sa_executor WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));

CREATE FUNCTION sa_domain.has_capability(p_capability text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT CASE p_capability WHEN 'notes' THEN a.role_id IN(0,1,2,4) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'1'))
 WHEN 'goals' THEN a.role_id IN(0,1,2) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'2')) ELSE false END FROM sa_domain.actor() a
$f$;
CREATE FUNCTION sa_domain.require_capability(p_capability text) RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_domain.has_capability(p_capability) THEN RAISE EXCEPTION 'Capability is not enabled' USING ERRCODE='42501'; END IF;
 RETURN sa_domain.actor();
END $f$;
CREATE FUNCTION sa_domain.archive_entity(p_kind text,p_id bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Archive reason required (3..500 characters)' USING ERRCODE='22023'; END IF;
 INSERT INTO sa_domain.archived_entities(kind,entity_id,generation,actor_id,reason)
 SELECT p_kind,p_id,generation,sa_domain.request_uid(),btrim(p_reason) FROM sa_domain.runtime_state WHERE singleton;
END $f$;

GRANT SELECT(id,created_by_id,order_id,status) ON sa_snapshot_20261019.sa_tasks TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_task_users TO sa_guard;
CREATE POLICY squad_guard_tasks ON sa_snapshot_20261019.sa_tasks FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_task_users ON sa_snapshot_20261019.sa_task_users FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.assigned_task_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT task_id FROM sa_snapshot_20261019.sa_task_users WHERE user_id=(SELECT (sa_domain.actor()).user_id)
$f$;
ALTER FUNCTION sa_domain.assigned_task_ids() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.managed_task_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT id FROM sa_snapshot_20261019.sa_tasks WHERE (SELECT (sa_domain.actor()).role_id)=0 OR created_by_id=(SELECT (sa_domain.actor()).user_id)
$f$;
ALTER FUNCTION sa_domain.managed_task_ids() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.task_assignees() RETURNS TABLE(id bigint,name text,role integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.id,u.name::text,u.role FROM sa_snapshot_20261019.sa_users u
 WHERE (SELECT sa_domain.has_capability('notes')) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE
 AND (u.role IN(0,1,2,4) OR (u.role IN(11,12) AND sa_domain.feature(u.features,'1')))
$f$;
ALTER FUNCTION sa_domain.task_assignees() OWNER TO sa_guard;
GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_tasks,sa_snapshot_20261019.sa_responsibilities TO sa_executor;
GRANT UPDATE(note,status,deadline,updated_by_id,order_id,updated_at) ON sa_snapshot_20261019.sa_tasks TO sa_executor;
GRANT UPDATE(note,responsibility_type,is_completed,updated_at) ON sa_snapshot_20261019.sa_responsibilities TO sa_executor;
GRANT SELECT,INSERT,DELETE ON sa_snapshot_20261019.sa_task_users TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_tasks_id_seq,sa_snapshot_20261019.sa_task_users_id_seq,sa_snapshot_20261019.sa_responsibilities_id_seq TO sa_executor;
CREATE POLICY squad_task_select ON sa_snapshot_20261019.sa_tasks FOR SELECT TO sa_executor USING(
 (SELECT sa_domain.has_capability('notes')) AND ((SELECT (sa_domain.actor()).role_id)=0 OR created_by_id=(SELECT (sa_domain.actor()).user_id) OR id IN(SELECT sa_domain.assigned_task_ids())));
CREATE POLICY squad_task_insert ON sa_snapshot_20261019.sa_tasks FOR INSERT TO sa_executor WITH CHECK(
 (SELECT sa_domain.has_capability('notes')) AND created_by_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_task_update ON sa_snapshot_20261019.sa_tasks FOR UPDATE TO sa_executor
 USING((SELECT sa_domain.has_capability('notes')) AND ((SELECT (sa_domain.actor()).role_id)=0 OR created_by_id=(SELECT (sa_domain.actor()).user_id) OR id IN(SELECT sa_domain.assigned_task_ids())))
 WITH CHECK((SELECT sa_domain.has_capability('notes')) AND ((SELECT (sa_domain.actor()).role_id)=0 OR created_by_id=(SELECT (sa_domain.actor()).user_id) OR id IN(SELECT sa_domain.assigned_task_ids())));
CREATE POLICY squad_task_members_select ON sa_snapshot_20261019.sa_task_users FOR SELECT TO sa_executor USING(task_id IN(SELECT id FROM sa_snapshot_20261019.sa_tasks));
CREATE POLICY squad_task_members_insert ON sa_snapshot_20261019.sa_task_users FOR INSERT TO sa_executor WITH CHECK(task_id IN(SELECT sa_domain.managed_task_ids()));
CREATE POLICY squad_task_members_delete ON sa_snapshot_20261019.sa_task_users FOR DELETE TO sa_executor USING(task_id IN(SELECT sa_domain.managed_task_ids()));
CREATE POLICY squad_goal_select ON sa_snapshot_20261019.sa_responsibilities FOR SELECT TO sa_executor USING(
 (SELECT sa_domain.has_capability('goals')) AND ((SELECT (sa_domain.actor()).role_id)=0 OR user_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_goal_insert ON sa_snapshot_20261019.sa_responsibilities FOR INSERT TO sa_executor WITH CHECK((SELECT (sa_domain.actor()).role_id)=0 AND created_by_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_goal_update ON sa_snapshot_20261019.sa_responsibilities FOR UPDATE TO sa_executor
 USING((SELECT sa_domain.has_capability('goals')) AND ((SELECT (sa_domain.actor()).role_id)=0 OR user_id=(SELECT (sa_domain.actor()).user_id)))
 WITH CHECK((SELECT sa_domain.has_capability('goals')) AND ((SELECT (sa_domain.actor()).role_id)=0 OR user_id=(SELECT (sa_domain.actor()).user_id)));
CREATE INDEX squad_tasks_creator_page ON sa_snapshot_20261019.sa_tasks(created_by_id,id DESC);
CREATE INDEX squad_tasks_order_page ON sa_snapshot_20261019.sa_tasks(order_id,id DESC);
CREATE INDEX squad_task_members_user_task ON sa_snapshot_20261019.sa_task_users(user_id,task_id);
CREATE INDEX squad_goals_user_page ON sa_snapshot_20261019.sa_responsibilities(user_id,id DESC);

-- Preserve safe change metadata for durable recipient resolution after commit.
CREATE OR REPLACE FUNCTION sa_domain.finish_command(p_operation text,p_key uuid,p_kind text,p_id bigint,p_result jsonb,p_changes jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 UPDATE sa_domain.commands SET result=p_result WHERE actor_id=a.auth_id AND key=p_key AND operation=p_operation AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Command was not reserved' USING ERRCODE='55000'; END IF;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes)
 VALUES(a.auth_id,a.user_id,p_operation,p_kind,p_id,p_key,p_changes);
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 SELECT a.auth_id,p_operation,p_kind,p_id,p_key,generation,p_changes FROM sa_domain.runtime_state WHERE singleton;
 UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 RETURN p_result;
END $f$;

CREATE FUNCTION sa_domain.task_page(p_id bigint,p_state integer,p_order_id bigint,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes'); n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('tasks',jsonb_build_object('id',p_id,'state',p_state,'order',p_order_id)); after_ bigint:=sa_domain.cursor_id(p_cursor,ctx); result jsonb;
BEGIN
 IF p_state IS NOT NULL AND p_state NOT IN(0,1,2) THEN RAISE EXCEPTION 'Invalid task state' USING ERRCODE='22023'; END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_tasks t WHERE id<after_ AND (p_id IS NULL OR id=p_id)
  AND (p_state IS NULL AND status<>2 OR status=p_state) AND (p_order_id IS NULL OR order_id=p_order_id) ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 members AS(SELECT m.task_id,jsonb_agg(DISTINCT m.user_id::text) ids FROM sa_snapshot_20261019.sa_task_users m WHERE m.task_id IN(SELECT id FROM page) GROUP BY m.task_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',t.id::text,'note',t.note,'state',t.status,'deadline',t.deadline,
  'creator_id',t.created_by_id::text,'order_id',t.order_id::text,'assignee_ids',coalesce(m.ids,'[]'),'updated_at',t.updated_at,
  'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY t.id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(t.id),ctx) END)
 INTO result FROM page t LEFT JOIN members m ON m.task_id=t.id LEFT JOIN sa_domain.entity_versions v ON v.kind='task' AND v.entity_id=t.id;
 RETURN result;
END $f$;
CREATE FUNCTION sa_domain.v1_tasks_list(p_state integer DEFAULT NULL,p_order_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.task_page(NULL,p_state,p_order_id,p_cursor,p_limit) $f$;
CREATE FUNCTION sa_domain.v1_task_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb:=sa_domain.task_page(p_id,NULL,NULL,NULL,1)->'data'->0;
BEGIN IF r IS NULL THEN RAISE EXCEPTION 'Record not found or unavailable' USING ERRCODE='P0002'; END IF;RETURN r;END $f$;
CREATE FUNCTION sa_domain.v1_task_assignees(p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes'); n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('task_assignees','{}'); after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.task_assignees() WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name,'role',role) ORDER BY id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_task_save(p_id bigint,p_note text,p_deadline timestamptz,p_order_id bigint,p_assignee_ids bigint[],p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes');cached jsonb;t sa_snapshot_20261019.sa_tasks%ROWTYPE;
 id_ bigint; version_ text; old_ids bigint[];new_ids bigint[];changes_ jsonb;
BEGIN
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 10000 OR p_deadline IS NULL OR NOT isfinite(p_deadline)
  OR p_assignee_ids IS NULL OR cardinality(p_assignee_ids)>50 OR array_position(p_assignee_ids,NULL) IS NOT NULL
  OR (p_id IS NULL AND p_expected_version IS NOT NULL) THEN RAISE EXCEPTION 'Invalid task fields' USING ERRCODE='22023'; END IF;
 cached:=sa_domain.begin_command('task.saved',p_idempotency_key,jsonb_build_object('id',p_id,'note',p_note,'deadline',p_deadline,'order',p_order_id,'assignees',p_assignee_ids,'version',p_expected_version));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_order_id IS NOT NULL AND NOT sa_domain.can_order(p_order_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM unnest(p_assignee_ids) x WHERE x NOT IN(SELECT id FROM sa_domain.task_assignees())) THEN RAISE EXCEPTION 'Assignee unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO new_ids FROM unnest(p_assignee_ids) x WHERE x<>a.user_id;
 IF p_id IS NULL THEN
  INSERT INTO sa_snapshot_20261019.sa_tasks(note,status,deadline,created_by_id,updated_by_id,order_id,created_at,updated_at)
  VALUES(btrim(p_note),0,p_deadline AT TIME ZONE 'UTC',a.user_id,a.user_id,p_order_id,now(),now()) RETURNING id INTO id_;
  version_:=sa_domain.bump_version('task',id_,sa_domain.version('task',id_));old_ids:='{}';
 ELSE
  SELECT * INTO t FROM sa_snapshot_20261019.sa_tasks WHERE id=p_id FOR UPDATE;
  IF t.id IS NULL OR (t.created_by_id<>a.user_id AND a.role_id<>0) OR t.status=2 THEN RAISE EXCEPTION 'Task cannot be edited' USING ERRCODE='42501'; END IF;
  id_:=p_id;version_:=sa_domain.bump_version('task',id_,p_expected_version);
  SELECT coalesce(array_agg(DISTINCT user_id),'{}') INTO old_ids FROM sa_snapshot_20261019.sa_task_users WHERE task_id=id_;
  UPDATE sa_snapshot_20261019.sa_tasks SET note=btrim(p_note),deadline=p_deadline AT TIME ZONE 'UTC',order_id=p_order_id,updated_by_id=a.user_id,updated_at=now() WHERE id=id_;
 END IF;
 DELETE FROM sa_snapshot_20261019.sa_task_users WHERE task_id=id_ AND NOT user_id=ANY(new_ids);
 INSERT INTO sa_snapshot_20261019.sa_task_users(task_id,user_id,created_at,updated_at)
 SELECT id_,x,now(),now() FROM unnest(new_ids) x WHERE NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_task_users m WHERE m.task_id=id_ AND m.user_id=x);
 changes_:=jsonb_build_object('assignees_added',(SELECT coalesce(jsonb_agg(x::text),'[]') FROM unnest(new_ids) x WHERE NOT x=ANY(old_ids)),
  'assignees_removed',(SELECT coalesce(jsonb_agg(x::text),'[]') FROM unnest(old_ids) x WHERE NOT x=ANY(new_ids)));
 RETURN sa_domain.finish_command('task.saved',p_idempotency_key,'task',id_,jsonb_build_object('id',id_::text,'version',version_),changes_);
END $f$;
CREATE FUNCTION sa_domain.v1_task_transition(p_id bigint,p_state integer,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes');cached jsonb;t sa_snapshot_20261019.sa_tasks%ROWTYPE;v text;
BEGIN
 IF p_state IS NULL OR p_state NOT IN(0,1,2) THEN RAISE EXCEPTION 'Invalid task state' USING ERRCODE='22023'; END IF;
 cached:=sa_domain.begin_command('task.transitioned',p_idempotency_key,jsonb_build_object('id',p_id,'state',p_state,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO t FROM sa_snapshot_20261019.sa_tasks WHERE id=p_id FOR UPDATE;
 IF t.id IS NULL OR t.status=2 OR (p_state=2 AND a.role_id<>0 AND t.created_by_id<>a.user_id) THEN RAISE EXCEPTION 'Task transition is not permitted' USING ERRCODE='42501';END IF;
 v:=sa_domain.bump_version('task',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_tasks SET status=p_state,updated_by_id=a.user_id,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('task.transitioned',p_idempotency_key,'task',p_id,jsonb_build_object('id',p_id::text,'state',p_state,'version',v),jsonb_build_object('old_state',t.status,'state',p_state));
END $f$;

CREATE FUNCTION sa_domain.v1_responsibilities_list(p_subject_id bigint DEFAULT NULL,p_kind integer DEFAULT NULL,p_completed boolean DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('goals');n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('responsibilities',jsonb_build_object('subject',p_subject_id,'kind',p_kind,'completed',p_completed));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_kind IS NOT NULL AND p_kind NOT IN(0,1,2) THEN RAISE EXCEPTION 'Invalid responsibility kind' USING ERRCODE='22023';END IF;
 IF a.role_id<>0 AND p_subject_id IS NOT NULL AND p_subject_id<>a.user_id THEN RAISE EXCEPTION 'Subject unavailable' USING ERRCODE='42501';END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_responsibilities g WHERE id<after_
  AND (p_subject_id IS NULL OR user_id=p_subject_id) AND (p_kind IS NULL OR responsibility_type=p_kind) AND (p_completed IS NULL OR is_completed=p_completed)
  AND NOT EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='responsibility' AND x.entity_id=g.id AND x.generation=(ctx->>'generation')::bigint)
  ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',g.id::text,'subject_id',g.user_id::text,'kind',g.responsibility_type,
  'note',g.note,'completed',g.is_completed,'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY g.id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(g.id),ctx) END)
 INTO r FROM page g LEFT JOIN sa_domain.entity_versions v ON v.kind='responsibility' AND v.entity_id=g.id;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_responsibility_save(p_items jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;item_ jsonb;id_ bigint;subject_ bigint;role_ integer;kind_ integer;v text;first_ bigint;
 r jsonb:='[]';old sa_snapshot_20261019.sa_responsibilities%ROWTYPE;
BEGIN
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Expected 1..100 responsibility items' USING ERRCODE='22023'; END IF;
 cached:=sa_domain.begin_command('responsibility.saved',p_idempotency_key,p_items);IF cached IS NOT NULL THEN RETURN cached;END IF;
 FOR item_ IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  PERFORM sa_domain.check_fields(item_,ARRAY['id','subject_id','kind','note','expected_version']);
  subject_:=(item_->>'subject_id')::bigint;kind_:=(item_->>'kind')::int;id_:=(item_->>'id')::bigint;
  IF subject_ IS NULL OR kind_ IS NULL OR kind_ NOT IN(0,1,2) OR jsonb_typeof(item_->'note') IS DISTINCT FROM 'string'
   OR length(btrim(item_->>'note')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Invalid responsibility fields' USING ERRCODE='22023'; END IF;
  SELECT role INTO role_ FROM sa_snapshot_20261019.sa_users WHERE id=subject_ AND role IN(1,2,11,12) AND deleted_at IS NULL AND disabled IS NOT TRUE;
  IF role_ IS NULL THEN RAISE EXCEPTION 'Subject unavailable' USING ERRCODE='42501'; END IF;
  IF id_ IS NULL THEN
   IF item_->>'expected_version' IS NOT NULL THEN RAISE EXCEPTION 'New item cannot have an existing version' USING ERRCODE='22023'; END IF;
   INSERT INTO sa_snapshot_20261019.sa_responsibilities(note,responsibility_type,user_id,is_completed,created_by_id,user_role,created_at,updated_at)
    VALUES(btrim(item_->>'note'),kind_,subject_,false,a.user_id,role_,now(),now()) RETURNING id INTO id_;
   v:=sa_domain.bump_version('responsibility',id_,sa_domain.version('responsibility',id_));
  ELSE
   SELECT * INTO old FROM sa_snapshot_20261019.sa_responsibilities WHERE id=id_ FOR UPDATE;
   IF old.id IS NULL OR old.user_id<>subject_ OR EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='responsibility' AND x.entity_id=id_ AND x.generation=(SELECT generation FROM sa_domain.runtime_state)) THEN
    RAISE EXCEPTION 'Responsibility unavailable or subject changed' USING ERRCODE='42501'; END IF;
   v:=sa_domain.bump_version('responsibility',id_,item_->>'expected_version');
   UPDATE sa_snapshot_20261019.sa_responsibilities SET note=btrim(item_->>'note'),responsibility_type=kind_,updated_at=now() WHERE id=id_;
  END IF;
  first_:=coalesce(first_,id_);r:=r||jsonb_build_array(jsonb_build_object('id',id_::text,'subject_id',subject_::text,'version',v));
 END LOOP;
 RETURN sa_domain.finish_command('responsibility.saved',p_idempotency_key,'responsibility',first_,jsonb_build_object('items',r),jsonb_build_object('items',r));
END $f$;
CREATE FUNCTION sa_domain.v1_responsibility_transition(p_id bigint,p_state text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('goals');cached jsonb;g sa_snapshot_20261019.sa_responsibilities%ROWTYPE;v text;
BEGIN
 IF p_state IS NULL OR p_state NOT IN('pending','completed','archived') THEN RAISE EXCEPTION 'Invalid responsibility state' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('responsibility.transitioned',p_idempotency_key,jsonb_build_object('id',p_id,'state',p_state,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO g FROM sa_snapshot_20261019.sa_responsibilities WHERE id=p_id FOR UPDATE;
 IF g.id IS NULL OR (p_state='archived' AND a.role_id<>0) OR EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='responsibility' AND x.entity_id=p_id AND x.generation=(SELECT generation FROM sa_domain.runtime_state)) THEN
  RAISE EXCEPTION 'Responsibility transition is not permitted' USING ERRCODE='42501';END IF;
 v:=sa_domain.bump_version('responsibility',p_id,p_expected_version);
 IF p_state='archived' THEN PERFORM sa_domain.archive_entity('responsibility',p_id,p_reason);
 ELSE UPDATE sa_snapshot_20261019.sa_responsibilities SET is_completed=(p_state='completed'),updated_at=now() WHERE id=p_id;END IF;
 RETURN sa_domain.finish_command('responsibility.transitioned',p_idempotency_key,'responsibility',p_id,jsonb_build_object('id',p_id::text,'state',p_state,'version',v),jsonb_build_object('state',p_state,'subject_id',g.user_id::text));
END $f$;

-- Generate only these reviewed public wrappers; there is no generic runtime dispatcher.
DO $do$ DECLARE f record;arguments_ text;body_ text; BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_tasks_list','v1_task_get','v1_task_assignees','v1_task_save','v1_task_transition','v1_responsibilities_list','v1_responsibility_save','v1_responsibility_transition']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
  AND p.proname=ANY(ARRAY['has_capability','require_capability','archive_entity','assigned_task_ids','managed_task_ids','task_assignees','task_page']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
  IF f.proname='has_capability' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_guard',f.oid::regprocedure);END IF;
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
