BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE FUNCTION sa_domain.work_person(p_id bigint,p_roles integer[],p_factory_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;
BEGIN
 SELECT jsonb_build_object('id',id::text,'factory_id',factory_id::text,'role',role) INTO r FROM sa_snapshot_20261019.sa_users
 WHERE id=p_id AND role=ANY(p_roles) AND disabled IS NOT TRUE AND deleted_at IS NULL AND (p_factory_id IS NULL OR factory_id=p_factory_id);
 IF r IS NULL THEN RAISE EXCEPTION 'Active person in the required role and factory was not found' USING ERRCODE='22023';END IF;RETURN r;
END $f$;
ALTER FUNCTION sa_domain.work_person(bigint,integer[],bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.lock_item(p_id bigint) RETURNS sa_snapshot_20261019.sa_items
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE i sa_snapshot_20261019.sa_items%ROWTYPE;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found or unavailable' USING ERRCODE='P0002';END IF;
 PERFORM sa_domain.lock_order(i.order_id);PERFORM pg_advisory_xact_lock(hashtextextended('item:'||p_id,784139));
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id FOR UPDATE;RETURN i;
END $f$;
CREATE FUNCTION sa_domain.assert_reassignable(p_order_id bigint) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF sa_domain.order_has_work(p_order_id) OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE order_id=p_order_id AND (job_worker_status>0 OR worker_per_piece_amount>0)) THEN
 RAISE EXCEPTION 'Active work or agreed worker costs must be reconciled before reassignment' USING ERRCODE='55000';END IF;
END $f$;
CREATE FUNCTION sa_domain.clear_cutter_assignments(p_order_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) SELECT 'item',id,1 FROM sa_snapshot_20261019.sa_items WHERE order_id=p_order_id AND cutting_master_id IS NOT NULL
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=sa_domain.entity_versions.revision+1;
 UPDATE sa_snapshot_20261019.sa_items SET cutting_master_id=NULL,updated_at=now() WHERE order_id=p_order_id AND cutting_master_id IS NOT NULL;
END $f$;
CREATE TABLE sa_domain.worker_due_baselines(order_id bigint NOT NULL,generation bigint NOT NULL,assignment_revision bigint NOT NULL,worker_id bigint NOT NULL,original_due_at timestamptz NOT NULL,
 basis text NOT NULL CHECK(basis IN('assignment','first_observed_change')),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(order_id,generation,assignment_revision));
ALTER TABLE sa_domain.worker_due_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.worker_due_baselines FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.worker_due_baselines TO sa_executor;
CREATE POLICY squad_worker_baselines ON sa_domain.worker_due_baselines TO sa_executor
 USING(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders)) WITH CHECK(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));

CREATE FUNCTION sa_domain.v1_order_assign_factory(p_id bigint,p_manager_id bigint,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;target_ jsonb;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 cached:=sa_domain.begin_command('order.factory_assigned',p_idempotency_key,jsonb_build_object('id',p_id,'manager',p_manager_id,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);PERFORM sa_domain.assert_reassignable(p_id);
 IF o.customer_dealer_id IS NOT NULL OR o.order_item_type NOT IN(1,2) THEN RAISE EXCEPTION 'Order is not in factory production scope' USING ERRCODE='42501';END IF;
 IF p_manager_id IS NOT NULL THEN
  target_:=sa_domain.work_person(p_manager_id,ARRAY[4]);
  IF target_->>'factory_id' IS NULL THEN RAISE EXCEPTION 'Manager must belong to a factory' USING ERRCODE='22023';END IF;
 END IF;
 v:=sa_domain.bump_version('order',p_id,p_expected_version);
 IF o.assigned_to_id IS DISTINCT FROM p_manager_id OR o.assigned_worker_id IS NOT NULL THEN PERFORM sa_domain.clear_cutter_assignments(p_id);END IF;
 UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=p_manager_id,assigned_worker_id=NULL,assigned_by_id=a.user_id,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('order.factory_assigned',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'manager_id',p_manager_id::text,'factory_id',target_->>'factory_id'),
 jsonb_build_object('before_manager',o.assigned_to_id::text,'before_worker',o.assigned_worker_id::text,'after_manager',p_manager_id::text,'reason',reason_));
END $f$;
CREATE FUNCTION sa_domain.v1_order_assign_worker(p_id bigint,p_worker_id bigint,p_due_at text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;reason_ text:=sa_domain.command_reason(p_reason);due_ timestamptz:=sa_domain.due_timestamp(p_due_at);
BEGIN
 IF p_worker_id IS NULL OR p_worker_id>2147483647 THEN RAISE EXCEPTION 'A supported worker ID is required' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('order.worker_assigned',p_idempotency_key,jsonb_build_object('id',p_id,'worker',p_worker_id,'due',due_,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);PERFORM sa_domain.assert_reassignable(p_id);PERFORM sa_domain.work_person(p_worker_id,ARRAY[11]);
 IF o.customer_dealer_id IS NOT NULL OR o.order_item_type NOT IN(1,2) THEN RAISE EXCEPTION 'Order is not in job-work scope' USING ERRCODE='42501';END IF;
 v:=sa_domain.bump_version('order',p_id,p_expected_version);PERFORM sa_domain.clear_cutter_assignments(p_id);
 INSERT INTO sa_domain.worker_due_baselines(order_id,generation,assignment_revision,worker_id,original_due_at,basis) SELECT p_id,generation,split_part(v,':',2)::bigint,p_worker_id,due_,'assignment' FROM sa_domain.runtime_state;
 UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=p_worker_id,assigned_to_id=NULL,assigned_by_id=a.user_id,due_on=due_ AT TIME ZONE 'UTC',due_time=due_ AT TIME ZONE 'UTC',updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('order.worker_assigned',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'worker_id',p_worker_id::text,'due_at',due_),
 jsonb_build_object('before_manager',o.assigned_to_id::text,'before_worker',o.assigned_worker_id::text,'after_worker',p_worker_id::text,'reason',reason_));
END $f$;
CREATE FUNCTION sa_domain.v1_item_assign_cutter(p_id bigint,p_cutter_id bigint,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[4]);i sa_snapshot_20261019.sa_items;o sa_snapshot_20261019.sa_orders;cached jsonb;v text;ov text;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 cached:=sa_domain.begin_command('item.cutter_assigned',p_idempotency_key,jsonb_build_object('id',p_id,'cutter',p_cutter_id,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 i:=sa_domain.lock_item(p_id);o:=sa_domain.lock_order(i.order_id);
 IF i.item_type<>0 OR o.assigned_worker_id IS NOT NULL OR o.assigned_to_id IS NULL OR a.factory_id IS NULL THEN RAISE EXCEPTION 'Item is not in factory cutting scope' USING ERRCODE='42501';END IF;
 IF i.cutting_done>0 OR i.assigned_to_tailor_quantity>0 OR i.completed_by_tailor_quantity>0 OR i.dispatched_quantity>0 THEN RAISE EXCEPTION 'Cutting assignment has active work' USING ERRCODE='55000';END IF;
 IF p_cutter_id IS NOT NULL THEN PERFORM sa_domain.work_person(p_cutter_id,ARRAY[9],a.factory_id);END IF;
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',o.id,sa_domain.version('order',o.id));
 UPDATE sa_snapshot_20261019.sa_items SET cutting_master_id=p_cutter_id,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('item.cutter_assigned',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'version',v,'order_version',ov,'cutter_id',p_cutter_id::text),
 jsonb_build_object('order_id',o.id::text,'before',i.cutting_master_id::text,'after',p_cutter_id::text,'reason',reason_));
END $f$;
CREATE FUNCTION sa_domain.v1_item_criteria_save(p_id bigint,p_checks jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4]);i sa_snapshot_20261019.sa_items;cached jsonb;v text;ov text;entry_ jsonb;ids_ bigint[]:='{}';id_ bigint;progress_ jsonb;
BEGIN
 IF p_checks IS NULL OR jsonb_typeof(p_checks)<>'array' OR jsonb_array_length(p_checks) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Provide 1 to 100 checklist updates' USING ERRCODE='22023';END IF;
 FOR entry_ IN SELECT value FROM jsonb_array_elements(p_checks) LOOP
  PERFORM sa_domain.check_fields(entry_,ARRAY['id','checked']);id_:=sa_domain.input_id(entry_->'id');
  IF id_=ANY(ids_) OR jsonb_typeof(entry_->'checked') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Checklist IDs must be unique and checked must be boolean' USING ERRCODE='22023';END IF;
  ids_:=array_append(ids_,id_);
 END LOOP;
 cached:=sa_domain.begin_command('item.criteria_changed',p_idempotency_key,jsonb_build_object('id',p_id,'checks',p_checks,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 i:=sa_domain.lock_item(p_id);
 IF i.item_type<>0 OR (SELECT count(*) FROM sa_snapshot_20261019.sa_item_criteria WHERE item_id=p_id AND id=ANY(ids_))<>cardinality(ids_) THEN RAISE EXCEPTION 'Checklist entries do not belong to this custom item' USING ERRCODE='22023';END IF;
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',i.order_id,sa_domain.version('order',i.order_id));
 UPDATE sa_snapshot_20261019.sa_item_criteria c SET is_checked=(x->>'checked')::boolean,updated_by_id=a.user_id,
 checked_by_id=CASE WHEN (x->>'checked')::boolean THEN a.user_id ELSE c.checked_by_id END,
 unchecked_by_id=CASE WHEN NOT (x->>'checked')::boolean THEN a.user_id ELSE c.unchecked_by_id END,updated_at=now()
 FROM jsonb_array_elements(p_checks) x WHERE c.id=(x->>'id')::bigint AND c.item_id=p_id;
 progress_:=sa_domain.recompute_order_progress(i.order_id);
 RETURN sa_domain.finish_command('item.criteria_changed',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'version',v,'order_version',ov,'criteria_complete',progress_->'criteria_complete'),
 jsonb_build_object('order_id',i.order_id::text,'checks',p_checks,'progress',progress_));
END $f$;
CREATE FUNCTION sa_domain.v1_worker_cost_save(p_id bigint,p_unit_cost numeric,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2]);i sa_snapshot_20261019.sa_items;o sa_snapshot_20261019.sa_orders;cached jsonb;v text;ov text;total_ numeric;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 IF p_unit_cost IS NULL OR p_unit_cost::text IN('NaN','Infinity','-Infinity') OR p_unit_cost<0 OR p_unit_cost>1000000 OR p_unit_cost<>round(p_unit_cost,3) THEN
 RAISE EXCEPTION 'Worker unit cost must be a nonnegative decimal with at most three places' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('item.worker_cost_changed',p_idempotency_key,jsonb_build_object('id',p_id,'cost',p_unit_cost,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 i:=sa_domain.lock_item(p_id);o:=sa_domain.lock_order(i.order_id);
 IF i.item_type<>0 OR o.assigned_worker_id IS NULL OR o.assigned_to_id IS NOT NULL THEN RAISE EXCEPTION 'Assign this custom work to a job worker first' USING ERRCODE='55000';END IF;
 total_:=round(p_unit_cost*i.total_quantity,2);
 IF total_>1000000000000 THEN RAISE EXCEPTION 'Worker total exceeds supported bounds' USING ERRCODE='22023';END IF;
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',o.id,sa_domain.version('order',o.id));
 UPDATE sa_snapshot_20261019.sa_items SET worker_per_piece_amount=p_unit_cost,worker_total_amount=total_,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('item.worker_cost_changed',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'version',v,'order_version',ov,'unit_cost',p_unit_cost::text,'total_cost',total_::text),
 jsonb_build_object('order_id',o.id::text,'worker_id',o.assigned_worker_id::text,'before',i.worker_per_piece_amount::text,'after',p_unit_cost::text,'reason',reason_));
END $f$;
CREATE FUNCTION sa_domain.v1_worker_stage_save(p_id bigint,p_stage integer,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,11]);i sa_snapshot_20261019.sa_items;o sa_snapshot_20261019.sa_orders;cached jsonb;v text;ov text;progress_ jsonb;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 IF p_stage IS NULL OR p_stage NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'Stage must be 0 through 5' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('item.worker_stage_changed',p_idempotency_key,jsonb_build_object('id',p_id,'stage',p_stage,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 i:=sa_domain.lock_item(p_id);o:=sa_domain.lock_order(i.order_id);
 IF i.item_type<>0 OR o.assigned_worker_id IS NULL OR o.assigned_to_id IS NOT NULL OR (a.role_id=11 AND o.assigned_worker_id<>a.user_id) THEN
 RAISE EXCEPTION 'Item is not assigned job work in your scope' USING ERRCODE='42501';END IF;
 IF p_stage=i.job_worker_status OR (a.role_id=11 AND p_stage<>coalesce(i.job_worker_status,0)+1) THEN
 RAISE EXCEPTION 'Workers advance one stage at a time; PC corrections require a reason' USING ERRCODE='22023';END IF;
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',o.id,sa_domain.version('order',o.id));
 UPDATE sa_snapshot_20261019.sa_items SET job_worker_status=p_stage,status_change_time=now(),updated_at=now() WHERE id=p_id;
 progress_:=sa_domain.recompute_order_progress(o.id);
 RETURN sa_domain.finish_command('item.worker_stage_changed',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'version',v,'order_version',ov,'stage',p_stage,'order_completed',progress_->'completed'),
 jsonb_build_object('order_id',o.id::text,'worker_id',o.assigned_worker_id::text,'before',i.job_worker_status,'after',p_stage,'reason',reason_,'progress',progress_));
END $f$;
CREATE FUNCTION sa_domain.v1_worker_due_save(p_id bigint,p_due_at text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,11]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;baseline_ sa_domain.worker_due_baselines;
 due_ timestamptz:=sa_domain.due_timestamp(p_due_at);reason_ text:=sa_domain.command_reason(p_reason);days_ integer;
BEGIN
 cached:=sa_domain.begin_command('order.worker_due_changed',p_idempotency_key,jsonb_build_object('id',p_id,'due',due_,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);
 IF o.assigned_worker_id IS NULL OR o.assigned_to_id IS NOT NULL OR (a.role_id=11 AND o.assigned_worker_id<>a.user_id) THEN RAISE EXCEPTION 'Order is not assigned job work in your scope' USING ERRCODE='42501';END IF;
 IF o.due_on IS NULL THEN RAISE EXCEPTION 'Establish a valid original due date before recording a worker change' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('order',p_id,p_expected_version);
 INSERT INTO sa_domain.worker_due_baselines(order_id,generation,assignment_revision,worker_id,original_due_at,basis)
 SELECT p_id,generation,split_part(v,':',2)::bigint,o.assigned_worker_id,o.due_on AT TIME ZONE 'UTC','first_observed_change' FROM sa_domain.runtime_state s
 WHERE NOT EXISTS(SELECT FROM sa_domain.worker_due_baselines b WHERE b.order_id=p_id AND b.generation=s.generation AND b.worker_id=o.assigned_worker_id);
 SELECT * INTO baseline_ FROM sa_domain.worker_due_baselines WHERE order_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state) AND worker_id=o.assigned_worker_id ORDER BY assignment_revision DESC LIMIT 1;
 days_:=(due_ AT TIME ZONE 'Asia/Kolkata')::date-(baseline_.original_due_at AT TIME ZONE 'Asia/Kolkata')::date;
 UPDATE sa_snapshot_20261019.sa_orders SET due_on=due_ AT TIME ZONE 'UTC',due_time=due_ AT TIME ZONE 'UTC',diff_in_days=days_::text,job_worker_reason=reason_,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('order.worker_due_changed',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'due_at',due_,'original_due_at',baseline_.original_due_at,'baseline_basis',baseline_.basis,'delta_days',days_),
 jsonb_build_object('before',o.due_on AT TIME ZONE 'UTC','after',due_,'original_due_at',baseline_.original_due_at,'baseline_basis',baseline_.basis,'reason',reason_));
END $f$;

CREATE FUNCTION sa_domain.v1_factory_queue(p_factory_id bigint DEFAULT NULL,p_phase text DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4]);n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('factory_queue',jsonb_build_object('factory_id',p_factory_id,'phase',p_phase));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_phase IS NOT NULL AND p_phase NOT IN('unassigned','criteria','cutting','sewing','dispatch','completed') THEN RAISE EXCEPTION 'Invalid production phase' USING ERRCODE='22023';END IF;
 IF a.role_id=4 AND p_factory_id IS NOT NULL AND p_factory_id IS DISTINCT FROM a.factory_id THEN RAISE EXCEPTION 'Factory is outside your scope' USING ERRCODE='42501';END IF;
 WITH scan AS MATERIALIZED(SELECT i.*,o.due_on,o.is_prime,o.customer_id,o.assigned_to_id,o.status order_status FROM sa_snapshot_20261019.sa_items i
 JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id LEFT JOIN sa_snapshot_20261019.sa_users manager ON manager.id=o.assigned_to_id
 WHERE i.id<after_ AND i.item_type=0 AND o.assigned_worker_id IS NULL AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND o.uc_status<>'CANCELLED'
 AND (p_factory_id IS NULL OR manager.factory_id=p_factory_id)
 AND CASE p_phase WHEN 'unassigned' THEN o.status=0 AND o.assigned_to_id IS NULL
 WHEN 'criteria' THEN o.status=0 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_criteria c WHERE c.item_id=i.id AND c.is_checked IS NOT TRUE)
 WHEN 'cutting' THEN o.status=0 AND i.cutting_status<>1 WHEN 'sewing' THEN o.status=0 AND i.cutting_status=1 AND i.completed_by_tailor_quantity_status<>1
 WHEN 'dispatch' THEN o.status=0 AND i.completed_by_tailor_quantity_status=1 AND i.dispatched_status<>1
 WHEN 'completed' THEN i.dispatched_status=1 OR o.status=1 ELSE o.status=0 END
 ORDER BY i.id DESC LIMIT n+1),page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 quantities AS(SELECT item_id,sum(quantity) quantity FROM sa_snapshot_20261019.sa_quantities WHERE item_id IN(SELECT id FROM page) GROUP BY item_id),
 holds AS(SELECT DISTINCT order_id FROM sa_domain.order_requests WHERE order_id IN(SELECT order_id FROM page) AND state IN('queued','running') AND generation=(ctx->>'generation')::bigint)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'order_id',p.order_id::text,'product_id',p.product_id::text,
 'manager_id',p.assigned_to_id::text,'cutter_id',p.cutting_master_id::text,'due_at',p.due_on AT TIME ZONE 'UTC','prime',p.is_prime,'sample',p.sample_order,
 'planned_quantity',p.total_quantity,'work_quantity',coalesce(q.quantity,0),'cut',p.cutting_done,'assigned',p.assigned_to_tailor_quantity,
 'sewn',p.completed_by_tailor_quantity,'dispatched',p.dispatched_quantity,'held',h.order_id IS NOT NULL,'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
 INTO r FROM page p LEFT JOIN quantities q ON q.item_id=p.id LEFT JOIN holds h ON h.order_id=p.order_id LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=p.id;
 RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_production_progress(p_order_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4,9]);o sa_snapshot_20261019.sa_orders;
BEGIN
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_order_id AND is_deleted IS NOT TRUE AND deleted_at IS NULL;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 RETURN sa_domain.order_progress_totals(o.id)||jsonb_build_object('id',o.id::text,'version',sa_domain.version('order',o.id),'status',o.status,'provider_status',o.uc_status,'as_of',now());
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
 tailor_job_status=CASE WHEN (r->>'assigned_complete')::boolean THEN 1 ELSE 0 END,
 dispatched_status=CASE WHEN dispatch_ THEN 1 ELSE 0 END,criteria_status=CASE WHEN (r->>'criteria_complete')::boolean THEN 1 ELSE 0 END,
 worker_status=CASE WHEN (r->>'worker_complete')::boolean THEN 1 ELSE 0 END,status=CASE WHEN complete_ THEN 1 ELSE 0 END,
 delivered_on=CASE WHEN complete_ THEN coalesce(delivered_on,now() AT TIME ZONE 'UTC') ELSE delivered_on END,updated_at=now() WHERE id=p_id;
 RETURN r||jsonb_build_object('completed',complete_,'became_completed',complete_ AND o.status<>1);
END $f$;

DO $do$ DECLARE f record;arguments_ text;body_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_order_assign_factory','v1_order_assign_worker','v1_item_assign_cutter','v1_item_criteria_save','v1_worker_cost_save','v1_worker_stage_save','v1_worker_due_save','v1_factory_queue','v1_production_progress']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
 AND p.proname=ANY(ARRAY['work_person','lock_item','assert_reassignable','clear_cutter_assignments']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
