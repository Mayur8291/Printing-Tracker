--137: Selected JobWorker order context from pinned sc_detail_view.
-- An optional exact assignment predicate intersects the existing order RLS.
DO $migration$
DECLARE definition_ text;needle_ text;
BEGIN
 definition_:=pg_get_functiondef('sa_domain.validate_order_filters(jsonb)'::regprocedure);
 needle_:=$s$'manager_id','coordinator_id'$s$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected person filters missing';END IF;
 definition_:=replace(definition_,needle_,$s$'manager_id','coordinator_id','worker_id'$s$);
 EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.filtered_orders(jsonb)'::regprocedure);
 needle_:=$s$((NOT (filtered_orders.p_filters ? 'coordinator_id'::text)) OR (o.customer_sc_id = ((filtered_orders.p_filters ->> 'coordinator_id'::text))::bigint))$s$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected normalized coordinator filter missing';END IF;
 definition_:=replace(definition_,needle_,needle_||$s$
 AND (NOT p_filters?'worker_id' OR o.assigned_worker_id=(p_filters->>'worker_id')::bigint)$s$);
 EXECUTE definition_;
END $migration$;
