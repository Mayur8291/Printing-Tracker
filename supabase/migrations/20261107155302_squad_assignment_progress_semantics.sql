BEGIN;
-- Assignment coverage and completed tailoring are different business states.
CREATE OR REPLACE FUNCTION sa_domain.order_progress_totals(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;
BEGIN
 IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 WITH sizes AS(SELECT q.item_id,sum(q.quantity) required FROM sa_snapshot_20261019.sa_quantities q JOIN sa_snapshot_20261019.sa_items x ON x.id=q.item_id WHERE x.order_id=p_id GROUP BY q.item_id)
 SELECT jsonb_build_object('item_count',count(*),'custom_count',count(*) FILTER(WHERE item_type=0),'rmp_count',count(*) FILTER(WHERE item_type=1),
 'cut',coalesce(sum(cutting_done),0),'assigned',coalesce(sum(assigned_to_tailor_quantity),0),'sewn',coalesce(sum(completed_by_tailor_quantity),0),
 'dispatched',coalesce(sum(dispatched_quantity),0),'cut_complete',coalesce(bool_and(cutting_status=1) FILTER(WHERE item_type=0),false),
 'sewn_complete',coalesce(bool_and(completed_by_tailor_quantity_status=1) FILTER(WHERE item_type=0),false),
 'assigned_complete',coalesce(bool_and(coalesce(s.required,0)>0 AND coalesce(i.assigned_to_tailor_quantity,0)>=s.required) FILTER(WHERE i.item_type=0),false),
 'job_complete',coalesce(bool_and(tailor_job_status=1) FILTER(WHERE item_type=0),false),
 'dispatch_complete',coalesce(bool_and(dispatched_status=1) FILTER(WHERE item_type=0),false),
 'all_dispatch_complete',coalesce(bool_and(dispatched_status=1),false),
 'worker_complete',coalesce(bool_and(job_worker_status=5) FILTER(WHERE item_type=0),false)) INTO r
 FROM sa_snapshot_20261019.sa_items i LEFT JOIN sizes s ON s.item_id=i.id WHERE i.order_id=p_id;
 RETURN r||jsonb_build_object('criteria_complete',NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_criteria c
 JOIN sa_snapshot_20261019.sa_items i ON i.id=c.item_id WHERE i.order_id=p_id AND c.is_checked IS NOT TRUE));
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.recompute_order_progress(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE o sa_snapshot_20261019.sa_orders:=sa_domain.lock_order(p_id,false);r jsonb:=sa_domain.order_progress_totals(p_id);complete_ boolean;dispatch_ boolean;
BEGIN
 dispatch_:=CASE WHEN o.customer_dealer_id IS NOT NULL THEN (r->>'all_dispatch_complete')::boolean ELSE (r->>'dispatch_complete')::boolean END;
 complete_:=CASE WHEN o.uc_status='CANCELLED' OR o.is_deleted THEN false WHEN o.is_force_update THEN true
 WHEN o.assigned_worker_id IS NOT NULL AND (r->>'custom_count')::int>0 THEN (r->>'worker_complete')::boolean AND ((r->>'rmp_count')::int=0 OR o.uc_status='COMPLETE')
 WHEN (r->>'custom_count')::int>0 AND (r->>'rmp_count')::int>0 THEN dispatch_ AND o.uc_status='COMPLETE'
 WHEN (r->>'custom_count')::int>0 OR o.customer_dealer_id IS NOT NULL THEN dispatch_
 WHEN (r->>'rmp_count')::int>0 THEN o.uc_status='COMPLETE' ELSE false END;
 UPDATE sa_snapshot_20261019.sa_orders SET cutting_done=(r->>'cut')::int,assigned_to_tailor_quantity=(r->>'assigned')::int,
 completed_by_tailor_quantity=(r->>'sewn')::int,dispatched_quantity=(r->>'dispatched')::int,
 cutting_status=CASE WHEN (r->>'cut_complete')::boolean THEN 1 ELSE 0 END,
 completed_by_tailor_quantity_status=CASE WHEN (r->>'sewn_complete')::boolean THEN 1 ELSE 0 END,
 tailor_job_status=CASE WHEN (r->>'job_complete')::boolean THEN 1 ELSE 0 END,
 dispatched_status=CASE WHEN dispatch_ THEN 1 ELSE 0 END,criteria_status=CASE WHEN (r->>'criteria_complete')::boolean THEN 1 ELSE 0 END,
 worker_status=CASE WHEN (r->>'worker_complete')::boolean THEN 1 ELSE 0 END,status=CASE WHEN complete_ THEN 1 ELSE 0 END,
 delivered_on=CASE WHEN complete_ THEN coalesce(delivered_on,now() AT TIME ZONE 'UTC') ELSE delivered_on END,updated_at=now() WHERE id=p_id;
 RETURN r||jsonb_build_object('completed',complete_,'became_completed',complete_ AND o.status<>1);
END $f$;

NOTIFY pgrst,'reload schema';
COMMIT;
