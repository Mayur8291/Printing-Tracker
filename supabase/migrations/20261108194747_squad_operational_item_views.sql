BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE INDEX squad_tailor_item_page ON sa_snapshot_20261019.sa_item_tailors(tailor_id,item_id DESC);
-- Current item queues are distinct from the append-only assignment/completion
-- ledgers. A tailor's tab follows that tailor link's completion status; an
-- inspector's tab follows the item's completion status, as in the source app.
CREATE FUNCTION sa_domain.operational_item_rows(p_tailor_id bigint,p_completed boolean,p_item_id bigint,p_order_id bigint,p_after bigint,p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4,7,8]);
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 OR p_after IS NULL OR p_after<1 OR p_tailor_id<1 OR p_item_id<1 OR p_order_id<1 THEN
  RAISE EXCEPTION 'Invalid work filter' USING ERRCODE='22023';END IF;
 IF p_tailor_id IS NOT NULL AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_tailor_id AND u.role IN(5,6) AND sa_domain.can_person(u.id)) THEN RETURN;END IF;
 RETURN QUERY WITH allowed AS MATERIALIZED(SELECT id FROM sa_domain.scope_item_ids() s(id)),
 candidates AS MATERIALIZED(
 SELECT i.* FROM allowed scoped JOIN sa_snapshot_20261019.sa_items i ON i.id=scoped.id
 WHERE i.id<p_after AND i.item_type=0 AND(p_item_id IS NULL OR i.id=p_item_id) AND(p_order_id IS NULL OR i.order_id=p_order_id)
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_tailors t WHERE t.item_id=i.id AND(p_tailor_id IS NULL OR t.tailor_id=p_tailor_id)
  AND(p_tailor_id IS NULL OR p_completed IS NULL OR t.completed_quantity_status=CASE WHEN p_completed THEN 1 ELSE 0 END))
 AND(p_tailor_id IS NOT NULL OR p_completed IS NULL OR i.completed_by_tailor_quantity_status=CASE WHEN p_completed THEN 1 ELSE 0 END)
 ORDER BY i.id DESC LIMIT p_limit)
 SELECT jsonb_build_object('id',i.id::text,'order_id',i.order_id::text,'product_name',p.name,
 'quantity',i.total_quantity,'tailor_id',p_tailor_id::text,
 'assigned',CASE WHEN p_tailor_id IS NULL THEN i.assigned_to_tailor_quantity ELSE t.assigned END,
 'inspected',CASE WHEN p_tailor_id IS NULL THEN i.completed_by_tailor_quantity ELSE t.inspected END,
 'completed',CASE WHEN p_tailor_id IS NULL THEN i.completed_by_tailor_quantity_status=1 ELSE t.completed END,
 'needs_reconciliation',CASE WHEN p_tailor_id IS NULL THEN i.assigned_to_tailor_quantity<0 OR i.completed_by_tailor_quantity<0 OR i.completed_by_tailor_quantity>i.assigned_to_tailor_quantity
 ELSE t.links<>1 OR t.assigned<0 OR t.inspected<0 OR t.inspected>t.assigned END,
 'due_at',i.job_sheet_due_on AT TIME ZONE 'UTC','created_at',i.created_at AT TIME ZONE 'UTC')
 FROM candidates i LEFT JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id
 LEFT JOIN LATERAL(SELECT sum(assigned_quantity) assigned,sum(completed_quantity) inspected,bool_and(completed_quantity_status=1) completed,count(*) links
 FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=i.id AND tailor_id=p_tailor_id) t ON p_tailor_id IS NOT NULL
 ORDER BY i.id DESC;
END $f$;
ALTER FUNCTION sa_domain.operational_item_rows(bigint,boolean,bigint,bigint,bigint,integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.operational_item_rows(bigint,boolean,bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.operational_item_rows(bigint,boolean,bigint,bigint,bigint,integer) TO sa_executor;

CREATE FUNCTION sa_domain.v1_operational_items(p_tailor_id bigint DEFAULT NULL,p_completed boolean DEFAULT false,p_item_id bigint DEFAULT NULL,p_order_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4,7,8]);n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;raw_ jsonb;r jsonb;
BEGIN
 IF p_tailor_id<1 OR p_item_id<1 OR p_order_id<1 THEN RAISE EXCEPTION 'Invalid work filter' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('operational_items',jsonb_build_object('tailor',p_tailor_id,'completed',p_completed,'item',p_item_id,'order',p_order_id));
 after_:=sa_domain.cursor_id(p_cursor,ctx);
 SELECT coalesce(jsonb_agg(x ORDER BY(x->>'id')::bigint DESC),'[]') INTO raw_ FROM sa_domain.operational_item_rows(p_tailor_id,p_completed,p_item_id,p_order_id,after_,n+1) x;
 WITH page AS(SELECT value x FROM jsonb_array_elements(raw_) ORDER BY(value->>'id')::bigint DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(x||jsonb_build_object('version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY(x->>'id')::bigint DESC),'[]'),
 'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.next_cursor(min((x->>'id')::bigint),ctx) END,
 'status_basis',CASE WHEN p_tailor_id IS NULL THEN 'item_inspection' ELSE 'selected_tailor_assignment' END)
 INTO r FROM page LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=(x->>'id')::bigint;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.v1_operational_items(bigint,boolean,bigint,bigint,text,integer) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_operational_items(bigint,boolean,bigint,bigint,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_operational_items(bigint,boolean,bigint,bigint,text,integer) TO sa_app;
CREATE FUNCTION canto_api.v1_operational_items(p_tailor_id bigint DEFAULT NULL,p_completed boolean DEFAULT false,p_item_id bigint DEFAULT NULL,p_order_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.v1_operational_items(p_tailor_id,p_completed,p_item_id,p_order_id,p_cursor,p_limit)
$f$;
REVOKE ALL ON FUNCTION canto_api.v1_operational_items(bigint,boolean,bigint,bigint,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_operational_items(bigint,boolean,bigint,bigint,text,integer) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
