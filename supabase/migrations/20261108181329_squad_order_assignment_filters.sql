-- Bounded assignment queues retain existing actor/RLS visibility and cursor context.
-- Dual legacy assignments intentionally appear in both queues and in ambiguous.
-- No new grants, ownership changes, or commands. Existing RPC context binds all filters.
CREATE OR REPLACE FUNCTION sa_domain.validate_order_filters(p_filters jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE field_ text; value_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['state','type','prime','criteria','assigned','customer_id','created_from','created_before','due_before','search','worker_status','assignment_kind']);
 IF (p_filters?'state' AND p_filters->>'state' NOT IN('pending','completed','cancelled','overdue','critical'))
 OR (p_filters?'type' AND (p_filters->>'type' IS NULL OR p_filters->>'type' NOT IN('0','1','2')))
 OR (p_filters?'criteria' AND p_filters->>'criteria' NOT IN('0','1'))
 OR (p_filters?'worker_status' AND p_filters->>'worker_status' NOT IN('0','1'))
 OR (p_filters?'assigned' AND jsonb_typeof(p_filters->'assigned')<>'boolean')
 OR (p_filters?'prime' AND jsonb_typeof(p_filters->'prime')<>'boolean')
 OR (p_filters?'assignment_kind' AND (jsonb_typeof(p_filters->'assignment_kind')<>'string' OR p_filters->>'assignment_kind' NOT IN('factory','job_worker','unassigned','ambiguous')))
 OR length(coalesce(p_filters->>'search',''))>100 THEN RAISE EXCEPTION 'Invalid order filters' USING ERRCODE='22023'; END IF;
 FOR field_,value_ IN SELECT * FROM jsonb_each(p_filters) LOOP
  IF value_='null'::jsonb OR jsonb_typeof(value_) IN('array','object') THEN RAISE EXCEPTION 'Invalid filter value' USING ERRCODE='22023'; END IF;
  IF field_='customer_id' AND (NOT pg_input_is_valid(value_#>>'{}','bigint') OR (value_#>>'{}')::bigint<1) THEN RAISE EXCEPTION 'Invalid customer ID' USING ERRCODE='22023'; END IF;
  IF field_ IN('created_from','created_before','due_before') AND (jsonb_typeof(value_)<>'string' OR NOT pg_input_is_valid(value_#>>'{}','timestamptz')) THEN RAISE EXCEPTION 'Invalid date filter' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_filters?'created_from' AND p_filters?'created_before' AND (p_filters->>'created_from')::timestamptz>=(p_filters->>'created_before')::timestamptz THEN
  RAISE EXCEPTION 'Date range must be increasing' USING ERRCODE='22023'; END IF;
END $f$;
-- SQL-standard body binds object references at creation, without a mutable name
-- lookup. Omitting SET permits planner inlining: cursor/limit and aggregates push
-- into the actual indexed query instead of materializing the entire order set.
CREATE OR REPLACE FUNCTION sa_domain.filtered_orders(p_filters jsonb) RETURNS SETOF sa_snapshot_20261019.sa_orders
LANGUAGE sql STABLE BEGIN ATOMIC
 SELECT o.* FROM sa_snapshot_20261019.sa_orders o
 WHERE o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL
  AND (NOT p_filters?'state' OR CASE p_filters->>'state'
   WHEN 'pending' THEN o.status=0 AND o.uc_status<>'CANCELLED'
   WHEN 'completed' THEN o.status=1 AND o.uc_status<>'CANCELLED'
   WHEN 'cancelled' THEN o.uc_status='CANCELLED'
   WHEN 'overdue' THEN o.status=0 AND o.uc_status<>'CANCELLED' AND o.due_on<(now() AT TIME ZONE 'UTC')
   WHEN 'critical' THEN o.status=0 AND o.uc_status<>'CANCELLED' AND o.due_on<(now() AT TIME ZONE 'UTC')+interval '3 days' END)
  AND (NOT p_filters?'type' OR o.order_item_type=(p_filters->>'type')::int)
  AND (NOT p_filters?'criteria' OR o.criteria_status=(p_filters->>'criteria')::int)
  AND (NOT p_filters?'prime' OR o.is_prime=(p_filters->>'prime')::boolean)
  AND (NOT p_filters?'worker_status' OR o.worker_status=(p_filters->>'worker_status')::int)
  AND (NOT p_filters?'assigned' OR (o.assigned_to_id IS NOT NULL OR o.assigned_worker_id IS NOT NULL OR (o.is_force_update AND o.status=1))=(p_filters->>'assigned')::boolean)
  AND (NOT p_filters?'assignment_kind' OR CASE p_filters->>'assignment_kind'
   WHEN 'factory' THEN o.assigned_to_id IS NOT NULL
   WHEN 'job_worker' THEN o.assigned_worker_id IS NOT NULL
   WHEN 'unassigned' THEN o.assigned_to_id IS NULL AND o.assigned_worker_id IS NULL
   WHEN 'ambiguous' THEN o.assigned_to_id IS NOT NULL AND o.assigned_worker_id IS NOT NULL END)
  AND (NOT p_filters?'customer_id' OR o.customer_id=(p_filters->>'customer_id')::bigint)
  AND (NOT p_filters?'created_from' OR o.created_at>=(p_filters->>'created_from')::timestamptz AT TIME ZONE 'UTC')
  AND (NOT p_filters?'created_before' OR o.created_at<(p_filters->>'created_before')::timestamptz AT TIME ZONE 'UTC')
  AND (NOT p_filters?'due_before' OR o.due_on<(p_filters->>'due_before')::timestamptz AT TIME ZONE 'UTC')
  AND (coalesce(p_filters->>'search','')='' OR o.id::text ILIKE '%'||replace(replace(replace(p_filters->>'search','\','\\'),'%','\%'),'_','\_')||'%'
   OR o.uc_order_id ILIKE '%'||replace(replace(replace(p_filters->>'search','\','\\'),'%','\%'),'_','\_')||'%'
   OR o.customer_id IN(SELECT sa_domain.search_customer_ids(p_filters->>'search')));
END;
