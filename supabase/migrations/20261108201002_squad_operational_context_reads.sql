BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE INDEX squad_backlinks_purchase_page ON sa_snapshot_20261019.sa_back_order_links(back_order_id,order_id DESC);
CREATE INDEX squad_orders_backorder_parent ON sa_snapshot_20261019.sa_orders(back_order_for_id,id DESC) WHERE back_order_for_id IS NOT NULL;
-- The guard may project only due-change history of a currently readable worker
-- order. This does not expose the generic audit ledger to application roles.
GRANT SELECT(id,operation,kind,entity_id,changes,created_at,generation) ON sa_domain.audit TO sa_guard;
CREATE POLICY squad_worker_context_audit ON sa_domain.audit FOR SELECT TO sa_guard USING(
 kind='order' AND operation IN('order.worker_assigned','order.worker_due_changed')
 AND generation=(SELECT generation FROM sa_domain.runtime_state)
 AND (SELECT (sa_domain.actor()).role_id) IN(0,2,11) AND sa_domain.can_order(entity_id));
CREATE FUNCTION sa_domain.worker_order_context(p_id bigint,p_after bigint,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,11]);o sa_snapshot_20261019.sa_orders;
 generation_ bigint:=(SELECT generation FROM sa_domain.runtime_state);anchor_ bigint;baseline_ sa_domain.worker_due_baselines;last_ jsonb;rows_ jsonb;
BEGIN
 IF p_id IS NULL OR p_id<1 OR p_after IS NULL OR p_after<1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN RAISE EXCEPTION 'Invalid worker context page' USING ERRCODE='22023';END IF;
 IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_id AND is_deleted IS NOT TRUE AND deleted_at IS NULL;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 IF o.assigned_worker_id IS NULL OR o.assigned_to_id IS NOT NULL OR(a.role_id=11 AND o.assigned_worker_id<>a.user_id) THEN
  RETURN jsonb_build_object('data','[]'::jsonb,'commitment',NULL);END IF;
 SELECT coalesce(max(id),0) INTO anchor_ FROM sa_domain.audit WHERE kind='order' AND entity_id=p_id AND operation='order.worker_assigned' AND generation=generation_;
 SELECT * INTO baseline_ FROM sa_domain.worker_due_baselines WHERE order_id=p_id AND generation=generation_ AND worker_id=o.assigned_worker_id ORDER BY assignment_revision DESC LIMIT 1;
 SELECT jsonb_build_object('reason',left(changes->>'reason',4000),'reason_truncated',length(changes->>'reason')>4000,'changed_at',created_at) INTO last_
 FROM sa_domain.audit WHERE kind='order' AND entity_id=p_id AND operation='order.worker_due_changed' AND generation=generation_ AND id>anchor_ ORDER BY id DESC LIMIT 1;
 WITH history AS(SELECT id,created_at,changes FROM sa_domain.audit WHERE kind='order' AND entity_id=p_id AND operation='order.worker_due_changed'
  AND generation=generation_ AND id>anchor_ AND id<p_after ORDER BY id DESC LIMIT p_limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'occurred_at',created_at,'before',changes->'before','after',changes->'after',
 'original_due_at',changes->'original_due_at','baseline_basis',changes->'baseline_basis','reason',left(changes->>'reason',4000),'reason_truncated',length(changes->>'reason')>4000) ORDER BY id DESC),'[]') INTO rows_ FROM history;
 RETURN jsonb_build_object('data',rows_,'commitment',jsonb_build_object('worker_id',o.assigned_worker_id::text,'due_at',o.due_on AT TIME ZONE 'UTC',
 'original_due_at',baseline_.original_due_at,'baseline_basis',coalesce(baseline_.basis,'not_recorded_in_source'),
 'reason',CASE WHEN last_ IS NOT NULL THEN last_->'reason' WHEN anchor_=0 THEN to_jsonb(left(o.job_worker_reason,4000)) END,
 'reason_truncated',CASE WHEN last_ IS NOT NULL THEN last_->'reason_truncated' WHEN anchor_=0 THEN to_jsonb(length(o.job_worker_reason)>4000) ELSE 'false'::jsonb END,
 'changed_at',last_->'changed_at','reason_basis',CASE WHEN last_ IS NOT NULL THEN 'recorded_change' WHEN anchor_=0 AND o.job_worker_reason IS NOT NULL THEN 'legacy_current_value' ELSE 'not_recorded' END));
END $f$;
ALTER FUNCTION sa_domain.worker_order_context(bigint,bigint,integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.worker_order_context(bigint,bigint,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.worker_order_context(bigint,bigint,integer) TO sa_executor;

-- Required fourth argument keeps existing order detail clients unambiguous.
CREATE FUNCTION sa_domain.v1_order_get(p_id bigint,p_item_cursor text,p_item_limit integer,p_section text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]);n integer:=sa_domain.page_limit(p_item_limit);
 ctx jsonb;after_ bigint;rows_ jsonb;result_ jsonb;work_ jsonb;
BEGIN
 IF p_section IS NULL OR p_section NOT IN('backorders','worker_history') THEN RAISE EXCEPTION 'Unknown order section' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE id=p_id AND is_deleted IS NOT TRUE AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 ctx:=sa_domain.page_context('order_section',jsonb_build_object('order_id',p_id,'version',sa_domain.version('order',p_id),'section',p_section));
 after_:=sa_domain.cursor_id(p_item_cursor,ctx);
 IF p_section='worker_history' THEN
  work_:=sa_domain.worker_order_context(p_id,after_,n+1);rows_:=work_->'data';
 ELSE
  -- Link rows and both endpoint orders retain executor RLS. A readable demand
  -- never discloses an unreadable purchase ID (or the reverse).
  WITH links AS(
   SELECT back_order_id id,'purchase'::text direction FROM sa_snapshot_20261019.sa_back_order_links WHERE order_id=p_id AND back_order_id<after_
   UNION ALL SELECT order_id,'demand' FROM sa_snapshot_20261019.sa_back_order_links WHERE back_order_id=p_id AND order_id<after_
   UNION ALL SELECT back_order_for_id,'demand' FROM sa_snapshot_20261019.sa_orders WHERE id=p_id AND back_order_for_id<after_
   UNION ALL SELECT id,'purchase' FROM sa_snapshot_20261019.sa_orders WHERE back_order_for_id=p_id AND id<after_),
  grouped AS(SELECT l.id,CASE WHEN count(DISTINCT l.direction)>1 THEN 'ambiguous' ELSE min(l.direction) END direction FROM links l
   JOIN sa_snapshot_20261019.sa_orders o ON o.id=l.id AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL
   WHERE l.id<>p_id GROUP BY l.id ORDER BY l.id DESC LIMIT n+1)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id::text,'direction',g.direction,'status',o.status,'type',o.order_item_type,
   'total_quantity',o.total_quantity,'due_at',o.due_on AT TIME ZONE 'UTC','created_at',o.created_at AT TIME ZONE 'UTC','version',sa_domain.version('order',g.id)) ORDER BY g.id DESC),'[]')
  INTO rows_ FROM grouped g JOIN sa_snapshot_20261019.sa_orders o ON o.id=g.id;
 END IF;
 WITH page AS(SELECT value x FROM jsonb_array_elements(rows_) ORDER BY(value->>'id')::bigint DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(x ORDER BY(x->>'id')::bigint DESC),'[]'),
 'next_cursor',CASE WHEN jsonb_array_length(rows_)>n THEN sa_domain.next_cursor(min((x->>'id')::bigint),ctx) END) INTO result_ FROM page;
 RETURN result_||jsonb_build_object('section',p_section,'order_id',p_id::text,'version',sa_domain.version('order',p_id))
 ||CASE WHEN p_section='worker_history' THEN jsonb_build_object('commitment',work_->'commitment') ELSE '{}'::jsonb END;
END $f$;
ALTER FUNCTION sa_domain.v1_order_get(bigint,text,integer,text) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_order_get(bigint,text,integer,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_order_get(bigint,text,integer,text) TO sa_app;
CREATE FUNCTION canto_api.v1_order_get(p_id bigint,p_item_cursor text,p_item_limit integer,p_section text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$SELECT sa_domain.v1_order_get(p_id,p_item_cursor,p_item_limit,p_section)$f$;
REVOKE ALL ON FUNCTION canto_api.v1_order_get(bigint,text,integer,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_order_get(bigint,text,integer,text) TO sa_app;
-- Keep every existing projection and finance permission; append only the
-- original worker stage timestamp for operational readers.
DO $patch$DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.item_projection(jsonb,sa_domain.actor,text)'::regprocedure);
 IF strpos(d,$old$'worker_stage',i->'job_worker_status'$old$)=0 THEN RAISE EXCEPTION 'Expected item stage projection missing';END IF;
 d:=replace(d,$old$'worker_stage',i->'job_worker_status'$old$,$new$'worker_stage',i->'job_worker_status','worker_stage_changed_at',CASE WHEN a.role_id IN(0,2,11) THEN (i->>'status_change_time')||'Z' END$new$);
 EXECUTE d;
END $patch$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
