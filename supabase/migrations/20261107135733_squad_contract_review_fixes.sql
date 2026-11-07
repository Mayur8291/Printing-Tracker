BEGIN;
-- Review correction: an administrator editing another person's task must preserve
-- the original creator rule. All RPC date/time rendering uses explicit UTC.
CREATE OR REPLACE FUNCTION sa_domain.v1_task_save(p_id bigint,p_note text,p_deadline timestamptz,p_order_id bigint,p_assignee_ids bigint[],p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
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
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO new_ids FROM unnest(p_assignee_ids) x WHERE x<>coalesce(t.created_by_id,a.user_id);
 DELETE FROM sa_snapshot_20261019.sa_task_users WHERE task_id=id_ AND NOT user_id=ANY(new_ids);
 INSERT INTO sa_snapshot_20261019.sa_task_users(task_id,user_id,created_at,updated_at)
 SELECT id_,x,now(),now() FROM unnest(new_ids) x WHERE NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_task_users m WHERE m.task_id=id_ AND m.user_id=x);
 changes_:=jsonb_build_object('assignees_added',(SELECT coalesce(jsonb_agg(x::text),'[]') FROM unnest(new_ids) x WHERE NOT x=ANY(old_ids)),
  'assignees_removed',(SELECT coalesce(jsonb_agg(x::text),'[]') FROM unnest(old_ids) x WHERE NOT x=ANY(new_ids)));
 RETURN sa_domain.finish_command('task.saved',p_idempotency_key,'task',id_,jsonb_build_object('id',id_::text,'version',version_),changes_);
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.task_page(p_id bigint,p_state integer,p_order_id bigint,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes'); n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('tasks',jsonb_build_object('id',p_id,'state',p_state,'order',p_order_id)); after_ bigint:=sa_domain.cursor_id(p_cursor,ctx); result jsonb;
BEGIN
 IF p_state IS NOT NULL AND p_state NOT IN(0,1,2) THEN RAISE EXCEPTION 'Invalid task state' USING ERRCODE='22023'; END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_tasks t WHERE id<after_ AND (p_id IS NULL OR id=p_id)
  AND (p_state IS NULL AND status<>2 OR status=p_state) AND (p_order_id IS NULL OR order_id=p_order_id) ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 members AS(SELECT m.task_id,jsonb_agg(DISTINCT m.user_id::text) ids FROM sa_snapshot_20261019.sa_task_users m WHERE m.task_id IN(SELECT id FROM page) GROUP BY m.task_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',t.id::text,'note',t.note,'state',t.status,'deadline',t.deadline AT TIME ZONE 'UTC',
  'creator_id',t.created_by_id::text,'order_id',t.order_id::text,'assignee_ids',coalesce(m.ids,'[]'),'updated_at',t.updated_at AT TIME ZONE 'UTC',
  'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY t.id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(t.id),ctx) END)
 INTO result FROM page t LEFT JOIN members m ON m.task_id=t.id LEFT JOIN sa_domain.entity_versions v ON v.kind='task' AND v.entity_id=t.id;
 RETURN result;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.order_projection(o jsonb,a sa_domain.actor,p_version text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',o->>'id','customer_id',o->>'customer_id','status',o->'status','provider_status',o->'uc_status',
  'created_at',(o->>'created_at')||'Z','created_on',(o->>'created_on')||'Z','due_on',(o->>'due_on')||'Z','delivered_on',(o->>'delivered_on')||'Z','type',o->'order_item_type',
  'total_quantity',o->'total_quantity','cut_quantity',o->'cutting_done','sewn_quantity',o->'completed_by_tailor_quantity',
  'dispatched_quantity',o->'dispatched_quantity','cutting_status',o->'cutting_status','stitching_status',o->'completed_by_tailor_quantity_status',
  'dispatch_status',o->'dispatched_status','criteria_status',o->'criteria_status','worker_status',o->'worker_status','is_prime',o->'is_prime',
  'force_completed',o->'is_force_update','version',p_version)
 || CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('total_amount',o->>'total_amount','sub_total_amount',o->>'sub_total_amount',
  'branding_amount',o->>'branding_amount','cgst_amount',o->>'cgst_amount','sgst_amount',o->>'sgst_amount','igst_amount',o->>'igst_amount',
  'payment_status',o->'payment_status','paid_amount',o->>'paid_amount') ELSE '{}' END
 || CASE WHEN a.role_id IN(0,1,2,4,7,8,9,11) THEN jsonb_build_object('factory_manager_id',o->>'assigned_to_id','worker_id',o->>'assigned_worker_id') ELSE '{}' END
$f$;
DO $do$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='sa_domain' AND p.proname LIKE 'v1_%' LOOP
  EXECUTE format('ALTER FUNCTION %s SET timezone TO %L',f.oid::regprocedure,'UTC');
 END LOOP;
END $do$;
NOTIFY pgrst,'reload schema';
COMMIT;
