BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor,sa_guard;
GRANT UPDATE(status,comment,due_on,due_time,is_prime,payment_status,paid_amount,updated_at,uc_status,is_force_update,is_deleted,deleted_at,
 assigned_to_id,assigned_worker_id,assigned_by_id,criteria_status,cutting_status,cutting_done,completed_by_tailor_quantity_status,
 completed_by_tailor_quantity,assigned_to_tailor_quantity,tailor_job_status,dispatched_quantity,dispatched_status,delivered_on,
 worker_status,job_worker_reason,diff_in_days,dispatch_to) ON sa_snapshot_20261019.sa_orders TO sa_executor;
CREATE POLICY squad_orders_update ON sa_snapshot_20261019.sa_orders FOR UPDATE TO sa_executor
 USING(sa_domain.can_order(id)) WITH CHECK(sa_domain.can_order(id));
GRANT UPDATE(uc_order_status,cutting_master_id,worker_per_piece_amount,worker_total_amount,job_worker_status,status_change_time,updated_at)
 ON sa_snapshot_20261019.sa_items TO sa_executor;
CREATE POLICY squad_items_update ON sa_snapshot_20261019.sa_items FOR UPDATE TO sa_executor
 USING(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders)) WITH CHECK(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
GRANT UPDATE(is_checked,checked_by_id,unchecked_by_id,updated_by_id,updated_at) ON sa_snapshot_20261019.sa_item_criteria TO sa_executor;
CREATE POLICY squad_criteria_update ON sa_snapshot_20261019.sa_item_criteria FOR UPDATE TO sa_executor
 USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items)) WITH CHECK(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));

-- External changes are durable requests. A successful request is not a provider acknowledgment.
CREATE TABLE sa_domain.order_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id bigint NOT NULL,kind text NOT NULL CHECK(kind IN('cancel','delete','edit')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed')),
 actor_id uuid NOT NULL,generation bigint NOT NULL,command_key uuid NOT NULL,spec jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX squad_one_pending_order_request ON sa_domain.order_requests(order_id) WHERE state IN('queued','running');
ALTER TABLE sa_domain.order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.order_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.order_requests TO sa_executor;
CREATE POLICY squad_order_requests_read ON sa_domain.order_requests FOR SELECT TO sa_executor USING(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
CREATE POLICY squad_order_requests_insert ON sa_domain.order_requests FOR INSERT TO sa_executor WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id) AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));

CREATE FUNCTION sa_domain.lock_order(p_id bigint,p_open boolean DEFAULT true) RETURNS sa_snapshot_20261019.sa_orders
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE o sa_snapshot_20261019.sa_orders%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('order:'||p_id,784139));
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_id AND is_deleted IS NOT TRUE AND deleted_at IS NULL FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 IF p_open AND (o.status=1 OR o.uc_status='CANCELLED') THEN RAISE EXCEPTION 'Order is no longer open' USING ERRCODE='55000';END IF;
 IF p_open AND EXISTS(SELECT FROM sa_domain.order_requests WHERE order_id=p_id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state)) THEN
  RAISE EXCEPTION 'Order has a pending external change; resolve it before further work' USING ERRCODE='55000';END IF;
 RETURN o;
END $f$;
CREATE FUNCTION sa_domain.command_reason(p_reason text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'A reason of 1 to 2000 characters is required' USING ERRCODE='22023';END IF;
 RETURN btrim(p_reason);
END $f$;
CREATE FUNCTION sa_domain.due_timestamp(p_due text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE t timestamptz;
BEGIN
 IF p_due IS NULL OR length(p_due)>40 OR p_due !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR NOT pg_input_is_valid(p_due,'timestamptz') THEN
 RAISE EXCEPTION 'Due timestamp must include a timezone' USING ERRCODE='22023';END IF;
 t:=p_due::timestamptz;
 IF t<'2000-01-01'::timestamptz OR t>now()+interval '10 years' THEN RAISE EXCEPTION 'Due date outside supported range' USING ERRCODE='22023';END IF;RETURN t;
END $f$;

-- Scoped read-only guard aggregates all items, including those not assigned to the current cutter.
GRANT SELECT(item_type,cutting_status,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,completed_by_tailor_quantity_status,
 tailor_job_status,dispatched_quantity,dispatched_status,job_worker_status) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(item_id,is_checked) ON sa_snapshot_20261019.sa_item_criteria TO sa_guard;
CREATE POLICY squad_guard_criteria_read ON sa_snapshot_20261019.sa_item_criteria FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.order_progress_totals(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;
BEGIN
 IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order not found or unavailable' USING ERRCODE='P0002';END IF;
 SELECT jsonb_build_object('item_count',count(*),'custom_count',count(*) FILTER(WHERE item_type=0),'rmp_count',count(*) FILTER(WHERE item_type=1),
 'cut',coalesce(sum(cutting_done),0),'assigned',coalesce(sum(assigned_to_tailor_quantity),0),'sewn',coalesce(sum(completed_by_tailor_quantity),0),
 'dispatched',coalesce(sum(dispatched_quantity),0),'cut_complete',coalesce(bool_and(cutting_status=1) FILTER(WHERE item_type=0),false),
 'sewn_complete',coalesce(bool_and(completed_by_tailor_quantity_status=1) FILTER(WHERE item_type=0),false),
 'assigned_complete',coalesce(bool_and(tailor_job_status=1) FILTER(WHERE item_type=0),false),
 'dispatch_complete',coalesce(bool_and(dispatched_status=1) FILTER(WHERE item_type=0),false),
 'all_dispatch_complete',coalesce(bool_and(dispatched_status=1),false),
 'worker_complete',coalesce(bool_and(job_worker_status=5) FILTER(WHERE item_type=0),false)) INTO r
 FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id;
 RETURN r||jsonb_build_object('criteria_complete',NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_criteria c
 JOIN sa_snapshot_20261019.sa_items i ON i.id=c.item_id WHERE i.order_id=p_id AND c.is_checked IS NOT TRUE));
END $f$;
ALTER FUNCTION sa_domain.order_progress_totals(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.recompute_order_progress(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE o sa_snapshot_20261019.sa_orders:=sa_domain.lock_order(p_id,false);r jsonb:=sa_domain.order_progress_totals(p_id);complete_ boolean;dispatch_ boolean;
BEGIN
 dispatch_:=CASE WHEN o.customer_dealer_id IS NOT NULL THEN (r->>'all_dispatch_complete')::boolean ELSE (r->>'dispatch_complete')::boolean END;
 complete_:=CASE WHEN o.uc_status='CANCELLED' OR o.is_deleted THEN false WHEN o.is_force_update THEN true
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
CREATE FUNCTION sa_domain.order_has_work(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT coalesce((r->>'cut')::bigint>0 OR (r->>'assigned')::bigint>0 OR (r->>'sewn')::bigint>0 OR (r->>'dispatched')::bigint>0,false)
 FROM sa_domain.order_progress_totals(p_id) r
$f$;

CREATE FUNCTION sa_domain.v1_order_priority_save(p_id bigint,p_prime boolean,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 IF p_prime IS NULL THEN RAISE EXCEPTION 'Prime must be true or false' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('order.priority_changed',p_idempotency_key,jsonb_build_object('id',p_id,'prime',p_prime,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);v:=sa_domain.bump_version('order',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_orders SET is_prime=p_prime,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('order.priority_changed',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'is_prime',p_prime),jsonb_build_object('before',o.is_prime,'after',p_prime,'reason',reason_));
END $f$;
CREATE FUNCTION sa_domain.v1_order_due_save(p_id bigint,p_due_at text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;reason_ text:=sa_domain.command_reason(p_reason);due_ timestamptz:=sa_domain.due_timestamp(p_due_at);
BEGIN
 cached:=sa_domain.begin_command('order.due_changed',p_idempotency_key,jsonb_build_object('id',p_id,'due',due_,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);v:=sa_domain.bump_version('order',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_orders SET due_on=due_ AT TIME ZONE 'UTC',due_time=due_ AT TIME ZONE 'UTC',updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('order.due_changed',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'due_at',due_),jsonb_build_object('before',o.due_on AT TIME ZONE 'UTC','after',due_,'reason',reason_));
END $f$;
CREATE FUNCTION sa_domain.v1_order_payment_record(p_id bigint,p_status text,p_paid_amount numeric,p_reference text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;reference_ text:=sa_domain.command_reason(p_reference);status_ integer;
BEGIN
 IF p_status IS NULL OR p_status NOT IN('paid','unpaid','partial') OR p_paid_amount IS NULL OR p_paid_amount::text IN('NaN','Infinity','-Infinity') OR p_paid_amount<0 OR p_paid_amount<>round(p_paid_amount,2) THEN
 RAISE EXCEPTION 'Invalid payment status or amount' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('order.payment_recorded',p_idempotency_key,jsonb_build_object('id',p_id,'status',p_status,'amount',p_paid_amount,'reference',reference_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id,false);
 IF EXISTS(SELECT FROM sa_domain.order_requests WHERE order_id=p_id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state)) THEN RAISE EXCEPTION 'Resolve pending order changes before recording payment' USING ERRCODE='55000';END IF;
 IF o.uc_status='CANCELLED' THEN RAISE EXCEPTION 'Payment changes on cancelled orders require reconciliation' USING ERRCODE='55000';END IF;
 IF p_paid_amount>o.total_amount OR (p_status='paid' AND p_paid_amount<>o.total_amount) OR (p_status='unpaid' AND p_paid_amount<>0)
 OR (p_status='partial' AND (p_paid_amount<=0 OR p_paid_amount>=o.total_amount)) THEN RAISE EXCEPTION 'Amount does not match payment status and total' USING ERRCODE='22023';END IF;
 status_:=CASE p_status WHEN 'paid' THEN 0 WHEN 'unpaid' THEN 1 ELSE 2 END;v:=sa_domain.bump_version('order',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_orders SET payment_status=status_,paid_amount=p_paid_amount,updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('order.payment_recorded',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'payment_status',status_,'paid_amount',p_paid_amount::text),
 jsonb_build_object('before_amount',o.paid_amount::text,'after_amount',p_paid_amount::text,'before_status',o.payment_status,'after_status',status_,'reference',reference_));
END $f$;
CREATE FUNCTION sa_domain.v1_order_force_complete(p_id bigint,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;reason_ text:=sa_domain.command_reason(p_reason);progress_ jsonb;
BEGIN
 cached:=sa_domain.begin_command('order.force_completed',p_idempotency_key,jsonb_build_object('id',p_id,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);v:=sa_domain.bump_version('order',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_orders SET is_force_update=true,uc_status='COMPLETE',updated_at=now() WHERE id=p_id;
 UPDATE sa_snapshot_20261019.sa_items SET uc_order_status='COMPLETE',updated_at=now() WHERE order_id=p_id AND item_type=1;
 progress_:=sa_domain.recompute_order_progress(p_id);
 RETURN sa_domain.finish_command('order.force_completed',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'status',1,'force_completed',true),
 jsonb_build_object('reason',reason_,'before_status',o.status,'progress',progress_,'external_fulfillment_confirmed',false));
END $f$;
CREATE FUNCTION sa_domain.v1_order_cancel(p_id bigint,p_kind text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,10]);o sa_snapshot_20261019.sa_orders;cached jsonb;v text;reason_ text:=sa_domain.command_reason(p_reason);request_ uuid;provider_ boolean;state_ text;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('cancel','delete') THEN RAISE EXCEPTION 'Kind must be cancel or delete' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('order.cancellation_requested',p_idempotency_key,jsonb_build_object('id',p_id,'kind',p_kind,'reason',reason_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);
 IF a.role_id=10 AND (p_kind<>'cancel' OR o.customer_dealer_id IS DISTINCT FROM a.user_id OR o.customer_id=a.user_id) THEN RAISE EXCEPTION 'Dealers may only cancel their linked customer fulfillment' USING ERRCODE='42501';END IF;
 IF o.uc_status='COMPLETE' OR o.dispatched_quantity>0 OR (sa_domain.order_progress_totals(p_id)->>'dispatched')::bigint>0 THEN
 RAISE EXCEPTION 'Fulfilled or partially dispatched orders require a separate reconciliation' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('order',p_id,p_expected_version);
 provider_:=nullif(o.uc_order_id,'') IS NOT NULL OR nullif(o.dashboard_reservation_id,'') IS NOT NULL OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id AND item_type=1);
 IF provider_ THEN
  INSERT INTO sa_domain.order_requests(order_id,kind,actor_id,generation,command_key,spec)
  SELECT p_id,p_kind,a.auth_id,generation,p_idempotency_key,jsonb_build_object('reason',reason_,'order_version',v) FROM sa_domain.runtime_state RETURNING id INTO request_;
  state_:='queued';
 ELSE
  UPDATE sa_snapshot_20261019.sa_orders SET uc_status='CANCELLED',status=0,is_force_update=false,
   is_deleted=(p_kind='delete'),deleted_at=CASE WHEN p_kind='delete' THEN now() AT TIME ZONE 'UTC' END,updated_at=now() WHERE id=p_id;
  state_:=CASE p_kind WHEN 'delete' THEN 'deleted' ELSE 'cancelled' END;
 END IF;
 RETURN sa_domain.finish_command('order.cancellation_requested',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'state',state_,'request_id',request_),
 jsonb_build_object('kind',p_kind,'reason',reason_,'request_id',request_,'provider_confirmation_required',provider_));
END $f$;

CREATE OR REPLACE FUNCTION sa_domain.v1_order_get(p_id bigint,p_item_cursor text DEFAULT NULL,p_item_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]); n integer:=sa_domain.page_limit(p_item_limit);
 ctx jsonb:=sa_domain.page_context('order_items',jsonb_build_object('order_id',p_id)); after_ bigint:=sa_domain.cursor_id(p_item_cursor,ctx); result jsonb; items_ jsonb;
BEGIN
 SELECT sa_domain.order_projection(to_jsonb(o),a,sa_domain.version('order',o.id))||jsonb_build_object('comment',o.comment)
 INTO result FROM sa_snapshot_20261019.sa_orders o WHERE o.id=p_id AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL;
 IF result IS NULL THEN RAISE EXCEPTION 'Record not found or unavailable' USING ERRCODE='P0002'; END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id AND id<after_ ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 quantities AS(SELECT q.item_id,jsonb_agg(jsonb_build_object('id',q.id::text,'size_id',q.size_id::text,'quantity',q.quantity,'cut',q.cutting_done,
   'assigned',q.assigned_to_tailor_quantity,'completed',q.completed_by_tailor_quantity,'dispatched',q.dispatched_quantity) ORDER BY q.size_id,q.id) data
   FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id IN(SELECT id FROM page) GROUP BY q.item_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'type',p.item_type,'product_id',p.product_id::text,
  'rmp_class_id',p.rmp_class_id::text,'rmp_brand_id',p.rmp_brand_id::text,'total_quantity',p.total_quantity,'sample_order',p.sample_order,
  'worker_stage',p.job_worker_status,'cut',p.cutting_done,'sewn',p.completed_by_tailor_quantity,'dispatched',p.dispatched_quantity,
  'version',(ctx->>'generation')||':'||coalesce(v.revision,0),'quantities',coalesce(q.data,'[]'))
  || CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('unit_amount',p.per_piece_amount::text,'total_amount',p.total_amount::text) ELSE '{}' END
  || CASE WHEN a.role_id=2 THEN jsonb_build_object('worker_unit_cost',p.worker_per_piece_amount::text,'worker_total_cost',p.worker_total_amount::text) ELSE '{}' END
  ORDER BY p.id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
 INTO items_ FROM page p LEFT JOIN quantities q ON q.item_id=p.id LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=p.id;
 RETURN result||jsonb_build_object('items',items_,'pending_change',(SELECT jsonb_build_object('id',id,'kind',kind,'state',state,'created_at',created_at)
  FROM sa_domain.order_requests WHERE order_id=p_id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state) LIMIT 1));
END $f$;

-- Wrapper creation is metadata-driven only at migration time; runtime dispatch remains typed.
DO $do$ DECLARE f record;arguments_ text;body_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_order_priority_save','v1_order_due_save','v1_order_payment_record','v1_order_force_complete','v1_order_cancel']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
 AND p.proname=ANY(ARRAY['lock_order','command_reason','due_timestamp','order_progress_totals','recompute_order_progress','order_has_work']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
