BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
CREATE INDEX squad_orders_production_scope ON sa_snapshot_20261019.sa_orders(id DESC)
 WHERE order_item_type IN(1,2) AND customer_dealer_id IS NULL;
GRANT SELECT(due_on,is_prime,status,is_deleted,deleted_at,uc_status) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT(product_id,sample_order,total_quantity) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(item_id,quantity) ON sa_snapshot_20261019.sa_quantities TO sa_guard;
CREATE POLICY squad_guard_quantities ON sa_snapshot_20261019.sa_quantities FOR SELECT TO sa_guard USING(true);
GRANT SELECT(order_id,state,generation) ON sa_domain.order_requests TO sa_guard;
CREATE POLICY squad_guard_order_requests ON sa_domain.order_requests FOR SELECT TO sa_guard USING(true);

-- Bounded, explicitly scoped read: avoid expanding the same all-order RLS set
-- separately for orders, items and quantities. No prices or user PII are read.
CREATE FUNCTION sa_domain.factory_queue_rows(p_factory_id bigint,p_phase text,p_after bigint,p_count integer) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4]);generation_ bigint:=(SELECT generation FROM sa_domain.runtime_state);
BEGIN
 IF p_count IS NULL OR p_count NOT BETWEEN 1 AND 101 THEN RAISE EXCEPTION 'Invalid page bound' USING ERRCODE='22023';END IF;
 IF p_phase IS NOT NULL AND p_phase NOT IN('unassigned','criteria','cutting','sewing','dispatch','completed') THEN RAISE EXCEPTION 'Invalid production phase' USING ERRCODE='22023';END IF;
 IF a.role_id=4 AND p_factory_id IS NOT NULL AND p_factory_id IS DISTINCT FROM a.factory_id THEN RAISE EXCEPTION 'Factory is outside your scope' USING ERRCODE='42501';END IF;
 RETURN QUERY
 WITH eligible AS MATERIALIZED(
  SELECT o.id,o.due_on,o.is_prime,o.assigned_to_id,o.status FROM sa_snapshot_20261019.sa_orders o
  WHERE a.role_id=2 AND o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL AND o.assigned_worker_id IS NULL
  AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND o.uc_status<>'CANCELLED'
  AND (p_factory_id IS NULL OR o.assigned_to_id IN(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=4 AND factory_id=p_factory_id))
  UNION ALL
  SELECT o.id,o.due_on,o.is_prime,o.assigned_to_id,o.status FROM sa_snapshot_20261019.sa_orders o
  WHERE a.role_id=4 AND o.assigned_to_id IN(SELECT sa_domain.factory_manager_ids()) AND o.assigned_worker_id IS NULL
  AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND o.uc_status<>'CANCELLED'
 ),page AS MATERIALIZED(
  SELECT i.id,i.order_id,i.product_id,i.cutting_master_id,i.sample_order,i.total_quantity,i.cutting_done,i.assigned_to_tailor_quantity,
  i.completed_by_tailor_quantity,i.dispatched_quantity,o.due_on,o.is_prime,o.assigned_to_id FROM sa_snapshot_20261019.sa_items i JOIN eligible o ON o.id=i.order_id
  WHERE i.id<p_after AND i.item_type=0 AND CASE p_phase WHEN 'unassigned' THEN o.status=0 AND o.assigned_to_id IS NULL
  WHEN 'criteria' THEN o.status=0 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_criteria c WHERE c.item_id=i.id AND c.is_checked IS NOT TRUE)
  WHEN 'cutting' THEN o.status=0 AND i.cutting_status<>1 WHEN 'sewing' THEN o.status=0 AND i.cutting_status=1 AND i.completed_by_tailor_quantity_status<>1
  WHEN 'dispatch' THEN o.status=0 AND i.completed_by_tailor_quantity_status=1 AND i.dispatched_status<>1
  WHEN 'completed' THEN i.dispatched_status=1 OR o.status=1 ELSE o.status=0 END ORDER BY i.id DESC LIMIT p_count
 ),quantities AS(SELECT item_id,sum(quantity) quantity FROM sa_snapshot_20261019.sa_quantities WHERE item_id IN(SELECT id FROM page) GROUP BY item_id),
 holds AS(SELECT DISTINCT order_id FROM sa_domain.order_requests WHERE order_id IN(SELECT order_id FROM page) AND state IN('queued','running') AND generation=generation_)
 SELECT jsonb_build_object('id',p.id::text,'order_id',p.order_id::text,'product_id',p.product_id::text,'manager_id',p.assigned_to_id::text,
 'cutter_id',p.cutting_master_id::text,'due_at',p.due_on AT TIME ZONE 'UTC','prime',p.is_prime,'sample',p.sample_order,'planned_quantity',p.total_quantity,
 'work_quantity',coalesce(q.quantity,0),'cut',p.cutting_done,'assigned',p.assigned_to_tailor_quantity,'sewn',p.completed_by_tailor_quantity,
 'dispatched',p.dispatched_quantity,'held',h.order_id IS NOT NULL) FROM page p LEFT JOIN quantities q ON q.item_id=p.id LEFT JOIN holds h ON h.order_id=p.order_id ORDER BY p.id DESC;
END $f$;
ALTER FUNCTION sa_domain.factory_queue_rows(bigint,text,bigint,integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.factory_queue_rows(bigint,text,bigint,integer) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.factory_queue_rows(bigint,text,bigint,integer) TO sa_executor;
CREATE OR REPLACE FUNCTION sa_domain.v1_factory_queue(p_factory_id bigint DEFAULT NULL,p_phase text DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4]);n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('factory_queue',jsonb_build_object('factory_id',p_factory_id,'phase',p_phase));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);raw_ jsonb;r jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::bigint DESC),'[]') INTO raw_ FROM sa_domain.factory_queue_rows(p_factory_id,p_phase,after_,n+1) x;
 WITH page AS(SELECT value x FROM jsonb_array_elements(raw_) ORDER BY (value->>'id')::bigint DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(x||jsonb_build_object('version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY (x->>'id')::bigint DESC),'[]'),
 'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.next_cursor(min((x->>'id')::bigint),ctx) END)
 INTO r FROM page LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=(x->>'id')::bigint;RETURN r;
END $f$;
-- Only staff with inherited factory links need the additional parent lookup.
CREATE OR REPLACE FUNCTION sa_domain.actor() RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor;context_ record;
BEGIN
 SELECT * INTO context_ FROM sa_domain.auth_context();
 IF context_.auth_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000';END IF;
 SELECT context_.auth_id,s.id,s.role,CASE WHEN s.role IN(7,8,9) THEN sa_domain.effective_factory(s.id) ELSE s.factory_id END,coalesce(s.features,'[]') INTO a
 FROM sa_identity.sa_auth_identities m JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id
 WHERE m.auth_user_id=context_.auth_id AND m.enrollment_state='ready' AND s.deleted_at IS NULL AND s.disabled IS NOT TRUE
 AND NOT(s.role=3 AND s.approved IS FALSE) AND s.role IN(0,1,2,3,4,7,8,9,10,11,12) AND lower(btrim(s.email))=lower(btrim(context_.email));
 IF a.user_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000';END IF;RETURN a;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.factory_person_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH managers AS MATERIALIZED(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=4 AND factory_id=(SELECT (sa_domain.actor()).factory_id)),
 team AS MATERIALIZED(SELECT id,role FROM sa_snapshot_20261019.sa_users WHERE role IN(5,7,8,9) AND factory_manager_id IN(SELECT id FROM managers))
 SELECT id FROM managers UNION SELECT id FROM team UNION SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=6 AND parent_tailor_id IN(SELECT id FROM team WHERE role=5)
$f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
