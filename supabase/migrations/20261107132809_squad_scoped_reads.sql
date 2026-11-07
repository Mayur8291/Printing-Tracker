BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;

-- Set-valued scope helpers are evaluated once, rather than querying actor/session
-- state once per displayed row. The lookup role still has no write privileges.
CREATE FUNCTION sa_domain.dealer_customer_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT d.user_id FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.dealer_id=(SELECT (sa_domain.actor()).user_id)
$f$;
ALTER FUNCTION sa_domain.dealer_customer_ids() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.factory_manager_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.id FROM sa_snapshot_20261019.sa_users u WHERE u.factory_id=(SELECT (sa_domain.actor()).factory_id) AND u.role=4
$f$;
ALTER FUNCTION sa_domain.factory_manager_ids() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.cutter_order_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT DISTINCT i.order_id FROM sa_snapshot_20261019.sa_items i WHERE i.cutting_master_id=(SELECT (sa_domain.actor()).user_id)
$f$;
ALTER FUNCTION sa_domain.cutter_order_ids() OWNER TO sa_guard;
GRANT SELECT(name,customer_company_name,customer_first_name,customer_last_name) ON sa_snapshot_20261019.sa_users TO sa_guard;
CREATE FUNCTION sa_domain.search_customer_ids(p_term text) RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.id FROM sa_snapshot_20261019.sa_users u WHERE u.deleted_at IS NULL AND u.role IN(3,10)
  AND concat_ws(' ',u.name,u.customer_company_name,u.customer_first_name,u.customer_last_name)
   ILIKE '%'||replace(replace(replace(p_term,'\','\\'),'%','\%'),'_','\_')||'%'
$f$;
ALTER FUNCTION sa_domain.search_customer_ids(text) OWNER TO sa_guard;

-- Rails order_item_type: ready-made=0, custom=1, mixed=2.
-- PC production scope includes custom lines in mixed orders, excluding dealer fulfillment.
CREATE OR REPLACE FUNCTION sa_domain.can_order(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o CROSS JOIN sa_domain.actor() a
 WHERE o.id=p_id AND (a.role_id=0 OR (a.role_id=1 AND o.customer_sc_id=a.user_id)
 OR (a.role_id=2 AND o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL)
 OR (a.role_id IN(3,10) AND o.customer_id=a.user_id)
 OR (a.role_id=10 AND o.customer_dealer_id=a.user_id)
 OR (a.role_id=11 AND o.assigned_worker_id=a.user_id)
 OR (a.role_id IN(4,7,8) AND o.assigned_to_id IN(SELECT sa_domain.factory_manager_ids()))
 OR (a.role_id=9 AND o.id IN(SELECT sa_domain.cutter_order_ids()))))
$f$;

ALTER POLICY squad_executor_people_read ON sa_snapshot_20261019.sa_users USING(
 id=(SELECT (sa_domain.actor()).user_id) OR (SELECT (sa_domain.actor()).role_id)=0
 OR ((SELECT (sa_domain.actor()).role_id)=1 AND role IN(3,10) AND created_by_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id)=10 AND id IN(SELECT sa_domain.dealer_customer_ids()))
 OR ((SELECT (sa_domain.actor()).role_id)=2 AND role IN(1,2,4,5,6,7,8,9,11))
 OR ((SELECT (sa_domain.actor()).role_id) IN(4,7,8,9) AND factory_id=(SELECT (sa_domain.actor()).factory_id) AND role IN(4,5,6,7,8,9))
);
GRANT SELECT ON sa_snapshot_20261019.sa_orders,sa_snapshot_20261019.sa_items,sa_snapshot_20261019.sa_quantities TO sa_executor;
CREATE POLICY squad_executor_orders_read ON sa_snapshot_20261019.sa_orders FOR SELECT TO sa_executor USING(
 (SELECT (sa_domain.actor()).role_id)=0
 OR ((SELECT (sa_domain.actor()).role_id)=1 AND customer_sc_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id)=2 AND order_item_type IN(1,2) AND customer_dealer_id IS NULL)
 OR ((SELECT (sa_domain.actor()).role_id) IN(3,10) AND customer_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id)=10 AND customer_dealer_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id)=11 AND assigned_worker_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id) IN(4,7,8) AND assigned_to_id IN(SELECT sa_domain.factory_manager_ids()))
 OR ((SELECT (sa_domain.actor()).role_id)=9 AND id IN(SELECT sa_domain.cutter_order_ids()))
);
CREATE POLICY squad_executor_items_read ON sa_snapshot_20261019.sa_items FOR SELECT TO sa_executor
 USING(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders)
   AND ((SELECT (sa_domain.actor()).role_id)<>9 OR cutting_master_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_executor_quantities_read ON sa_snapshot_20261019.sa_quantities FOR SELECT TO sa_executor
 USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));

CREATE INDEX squad_people_created_role_id ON sa_snapshot_20261019.sa_users(created_by_id,role,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX squad_people_factory_role_id ON sa_snapshot_20261019.sa_users(factory_id,role,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX squad_orders_customer_page ON sa_snapshot_20261019.sa_orders(customer_id,id DESC) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
CREATE INDEX squad_orders_sc_page ON sa_snapshot_20261019.sa_orders(customer_sc_id,id DESC) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
CREATE INDEX squad_orders_factory_page ON sa_snapshot_20261019.sa_orders(assigned_to_id,id DESC) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
CREATE INDEX squad_orders_worker_page ON sa_snapshot_20261019.sa_orders(assigned_worker_id,id DESC) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
CREATE INDEX squad_orders_dealer_page ON sa_snapshot_20261019.sa_orders(customer_dealer_id,id DESC) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
CREATE INDEX squad_items_order_page ON sa_snapshot_20261019.sa_items(order_id,id DESC);
CREATE INDEX squad_items_cutter_order ON sa_snapshot_20261019.sa_items(cutting_master_id,order_id);

CREATE FUNCTION sa_domain.page_context(p_resource text,p_filters jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('resource',p_resource,'actor',a.user_id,'role',a.role_id,'factory',a.factory_id,'generation',s.generation,'filters',p_filters)
 FROM sa_domain.actor() a CROSS JOIN sa_domain.runtime_state s WHERE s.singleton
$f$;
CREATE FUNCTION sa_domain.cursor_id(p_cursor text,p_context jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE value_ jsonb; id_ bigint;
BEGIN
 IF p_cursor IS NULL THEN RETURN 9223372036854775807; END IF;
 IF length(p_cursor)>2048 THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END IF;
 BEGIN
  value_:=convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;id_:=(value_->>'after')::bigint;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END;
 IF id_ IS NULL OR id_<1 OR value_->>'scope' IS DISTINCT FROM md5(p_context::text) THEN
  RAISE EXCEPTION 'Cursor no longer matches this view; restart pagination' USING ERRCODE='22023'; END IF;
 RETURN id_;
END $f$;
CREATE FUNCTION sa_domain.next_cursor(p_id bigint,p_context jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT replace(encode(convert_to(jsonb_build_object('after',p_id::text,'scope',md5(p_context::text))::text,'UTF8'),'base64'),E'\n','')
$f$;
CREATE FUNCTION sa_domain.person_projection(p jsonb,a sa_domain.actor,p_version text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p->>'id','name',p->'name','role',p->'role','company_name',p->'customer_company_name',
   'first_name',p->'customer_first_name','last_name',p->'customer_last_name','approved',p->'approved','onboarded',p->'onboarded',
   'disabled',p->'disabled','version',p_version)
 || CASE WHEN a.role_id IN(0,1,4,10) OR (p->>'id')::bigint=a.user_id THEN jsonb_build_object('email',p->'email','phone',p->'phone') ELSE '{}' END
 || CASE WHEN a.role_id IN(0,2,4,7,8,9) THEN jsonb_build_object('factory_id',p->>'factory_id') ELSE '{}' END
$f$;
CREATE FUNCTION sa_domain.v1_people_list(p_role integer DEFAULT NULL,p_search text DEFAULT '',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,4,7,8,10]); n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb; after_ bigint; result jsonb;
BEGIN
 IF (p_role IS NOT NULL AND p_role NOT BETWEEN 0 AND 12) OR p_search IS NULL OR length(p_search)>100 THEN
  RAISE EXCEPTION 'Invalid directory filters' USING ERRCODE='22023'; END IF;
 ctx:=sa_domain.page_context('people',jsonb_build_object('role',p_role,'search',p_search));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(
  SELECT u.id,u.name,u.email,u.phone,u.role,u.customer_company_name,u.customer_first_name,u.customer_last_name,
   u.factory_id,u.approved,u.onboarded,u.disabled
  FROM sa_snapshot_20261019.sa_users u WHERE u.deleted_at IS NULL AND u.id<after_
   AND (p_role IS NULL OR u.role=p_role)
   AND (p_search='' OR concat_ws(' ',u.name,u.customer_company_name,u.customer_first_name,u.customer_last_name) ILIKE '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%')
  ORDER BY u.id DESC LIMIT n+1
 ),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.person_projection(to_jsonb(p),a,(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
 INTO result FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='person' AND v.entity_id=p.id;
 RETURN result;
END $f$;
ALTER FUNCTION sa_domain.v1_people_list(integer,text,text,integer) OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_person_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,4,7,8,10]); result jsonb;
BEGIN
 SELECT sa_domain.person_projection(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'phone',u.phone,'role',u.role,
  'customer_company_name',u.customer_company_name,'customer_first_name',u.customer_first_name,'customer_last_name',u.customer_last_name,
  'factory_id',u.factory_id,'approved',u.approved,'onboarded',u.onboarded,'disabled',u.disabled),a,sa_domain.version('person',u.id))
 INTO result FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_id AND u.deleted_at IS NULL;
 IF result IS NULL THEN RAISE EXCEPTION 'Record not found or unavailable' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $f$;
ALTER FUNCTION sa_domain.v1_person_get(bigint) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.order_projection(o jsonb,a sa_domain.actor,p_version text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',o->>'id','customer_id',o->>'customer_id','status',o->'status','provider_status',o->'uc_status',
  'created_at',o->'created_at','created_on',o->'created_on','due_on',o->'due_on','delivered_on',o->'delivered_on','type',o->'order_item_type',
  'total_quantity',o->'total_quantity','cut_quantity',o->'cutting_done','sewn_quantity',o->'completed_by_tailor_quantity',
  'dispatched_quantity',o->'dispatched_quantity','cutting_status',o->'cutting_status','stitching_status',o->'completed_by_tailor_quantity_status',
  'dispatch_status',o->'dispatched_status','criteria_status',o->'criteria_status','worker_status',o->'worker_status','is_prime',o->'is_prime',
  'force_completed',o->'is_force_update','version',p_version)
 || CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('total_amount',o->>'total_amount','sub_total_amount',o->>'sub_total_amount',
  'branding_amount',o->>'branding_amount','cgst_amount',o->>'cgst_amount','sgst_amount',o->>'sgst_amount','igst_amount',o->>'igst_amount',
  'payment_status',o->'payment_status','paid_amount',o->>'paid_amount') ELSE '{}' END
 || CASE WHEN a.role_id IN(0,1,2,4,7,8,9,11) THEN jsonb_build_object('factory_manager_id',o->>'assigned_to_id','worker_id',o->>'assigned_worker_id') ELSE '{}' END
$f$;
CREATE FUNCTION sa_domain.validate_order_filters(p_filters jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE field_ text; value_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['state','type','prime','criteria','assigned','customer_id','created_from','created_before','due_before','search','worker_status']);
 IF (p_filters?'state' AND p_filters->>'state' NOT IN('pending','completed','cancelled','overdue','critical'))
 OR (p_filters?'type' AND (p_filters->>'type' IS NULL OR p_filters->>'type' NOT IN('0','1','2')))
 OR (p_filters?'criteria' AND p_filters->>'criteria' NOT IN('0','1'))
 OR (p_filters?'worker_status' AND p_filters->>'worker_status' NOT IN('0','1'))
 OR (p_filters?'assigned' AND jsonb_typeof(p_filters->'assigned')<>'boolean')
 OR (p_filters?'prime' AND jsonb_typeof(p_filters->'prime')<>'boolean')
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
CREATE FUNCTION sa_domain.filtered_orders(p_filters jsonb) RETURNS SETOF sa_snapshot_20261019.sa_orders
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
  AND (NOT p_filters?'customer_id' OR o.customer_id=(p_filters->>'customer_id')::bigint)
  AND (NOT p_filters?'created_from' OR o.created_at>=(p_filters->>'created_from')::timestamptz AT TIME ZONE 'UTC')
  AND (NOT p_filters?'created_before' OR o.created_at<(p_filters->>'created_before')::timestamptz AT TIME ZONE 'UTC')
  AND (NOT p_filters?'due_before' OR o.due_on<(p_filters->>'due_before')::timestamptz AT TIME ZONE 'UTC')
  AND (coalesce(p_filters->>'search','')='' OR o.id::text ILIKE '%'||replace(replace(replace(p_filters->>'search','\','\\'),'%','\%'),'_','\_')||'%'
   OR o.uc_order_id ILIKE '%'||replace(replace(replace(p_filters->>'search','\','\\'),'%','\%'),'_','\_')||'%'
   OR o.customer_id IN(SELECT sa_domain.search_customer_ids(p_filters->>'search')));
END;
CREATE FUNCTION sa_domain.v1_orders_list(p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]); n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('orders',p_filters); after_ bigint:=sa_domain.cursor_id(p_cursor,ctx); result jsonb;
BEGIN
 PERFORM sa_domain.validate_order_filters(p_filters);
 WITH scan AS MATERIALIZED(SELECT o.* FROM sa_domain.filtered_orders(p_filters) o WHERE o.id<after_ ORDER BY o.id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.order_projection(to_jsonb(p),a,(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
 INTO result FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='order' AND v.entity_id=p.id;
 RETURN result;
END $f$;
ALTER FUNCTION sa_domain.v1_orders_list(jsonb,text,integer) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.v1_order_get(p_id bigint,p_item_cursor text DEFAULT NULL,p_item_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
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
 RETURN result||jsonb_build_object('items',items_);
END $f$;
ALTER FUNCTION sa_domain.v1_order_get(bigint,text,integer) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.v1_dashboard(p_filters jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]); result jsonb;
BEGIN
 PERFORM sa_domain.validate_order_filters(p_filters);
 SELECT jsonb_build_object('orders',count(*),'pending',count(*) FILTER(WHERE o.status=0 AND o.uc_status<>'CANCELLED'),
  'completed',count(*) FILTER(WHERE o.status=1 AND o.uc_status<>'CANCELLED'),'cancelled',count(*) FILTER(WHERE o.uc_status='CANCELLED'),
  'quantity',coalesce(sum(o.total_quantity),0),'dispatched',coalesce(sum(o.dispatched_quantity),0),'as_of',now())
  ||CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('total_amount',coalesce(sum(o.total_amount),0)::text) ELSE '{}' END
 INTO result FROM sa_domain.filtered_orders(p_filters) o;
 RETURN result;
END $f$;
ALTER FUNCTION sa_domain.v1_dashboard(jsonb) OWNER TO sa_executor;

CREATE FUNCTION canto_api.v1_people_list(p_role integer DEFAULT NULL,p_search text DEFAULT '',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_people_list(p_role,p_search,p_cursor,p_limit) $f$;
CREATE FUNCTION canto_api.v1_person_get(p_id bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_person_get(p_id) $f$;
CREATE FUNCTION canto_api.v1_orders_list(p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_orders_list(p_filters,p_cursor,p_limit) $f$;
CREATE FUNCTION canto_api.v1_order_get(p_id bigint,p_item_cursor text DEFAULT NULL,p_item_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_order_get(p_id,p_item_cursor,p_item_limit) $f$;
CREATE FUNCTION canto_api.v1_dashboard(p_filters jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_dashboard(p_filters) $f$;

DO $do$ DECLARE fn record; BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='sa_domain' AND p.proname IN('dealer_customer_ids','factory_manager_ids','cutter_order_ids','search_customer_ids','page_context','cursor_id','next_cursor','person_projection','order_projection','filtered_orders','validate_order_filters','v1_people_list','v1_person_get','v1_orders_list','v1_order_get','v1_dashboard'))
  OR (n.nspname='canto_api' AND p.proname IN('v1_people_list','v1_person_get','v1_orders_list','v1_order_get','v1_dashboard')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',fn.signature);
  IF fn.nspname='sa_domain' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',fn.signature); END IF;
  IF fn.proname LIKE 'v1_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',fn.signature); END IF;
  IF fn.proname IN('dealer_customer_ids','factory_manager_ids','cutter_order_ids') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_guard',fn.signature); END IF;
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
