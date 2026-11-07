BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor,sa_guard;
CREATE TABLE sa_domain.dispatch_receipts(
 dispatch_id bigint NOT NULL,order_id bigint NOT NULL,actor_id uuid NOT NULL,generation bigint NOT NULL,
 destination jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(dispatch_id,generation));
ALTER TABLE sa_domain.dispatch_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.dispatch_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.dispatch_receipts TO sa_executor;
CREATE POLICY squad_dispatch_receipt_read ON sa_domain.dispatch_receipts FOR SELECT TO sa_executor USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND order_id IN(SELECT sa_domain.scope_order_ids()));
CREATE POLICY squad_dispatch_receipt_insert ON sa_domain.dispatch_receipts FOR INSERT TO sa_executor WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id) AND order_id IN(SELECT sa_domain.scope_order_ids()));
-- Source refresh can reuse numeric IDs from discarded mirror writes. Preserve
-- operational history by generation without attaching it to the reused record.
ALTER TABLE sa_domain.order_receipts DROP CONSTRAINT order_receipts_pkey;
ALTER TABLE sa_domain.order_receipts ADD PRIMARY KEY(order_id,generation);
ALTER TABLE sa_domain.design_owners DROP CONSTRAINT design_owners_pkey;
ALTER TABLE sa_domain.design_owners ADD PRIMARY KEY(branding_id,generation);
ALTER POLICY squad_receipts_read ON sa_domain.order_receipts USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND order_id IN(SELECT sa_domain.scope_order_ids()));
ALTER POLICY squad_receipts_insert ON sa_domain.order_receipts WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id) AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
ALTER POLICY squad_design_owners ON sa_domain.design_owners USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id)) WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id));
GRANT SELECT(id,address_id,customer_id,dispatch_to) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT(id,user_id,address,state,city,zip_code,deleted_at) ON sa_snapshot_20261019.sa_addresses TO sa_guard;
-- The legacy source has four enum values, not a destination directory or ID.
-- Customer address is projected only through a visible order. Fixed facility
-- modes retain their identity without inventing unverified facility addresses.
CREATE FUNCTION sa_domain.order_dispatch_destination(p_order_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();o record;address_ jsonb;
BEGIN
 IF NOT sa_domain.can_order(p_order_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002';END IF;
 SELECT id,address_id,customer_id,dispatch_to INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_order_id;
 IF o.dispatch_to=1 AND a.role_id IN(0,1,2,3,4,7,10) THEN
  SELECT jsonb_build_object('id',id::text,'address',address,'state',state,'city',city,'zip_code',zip_code) INTO address_
  FROM sa_snapshot_20261019.sa_addresses WHERE id=o.address_id AND user_id=o.customer_id AND deleted_at IS NULL;
 END IF;
 RETURN jsonb_build_object('mode',CASE coalesce(o.dispatch_to,0) WHEN 0 THEN 'not_defined' WHEN 1 THEN 'customer' WHEN 2 THEN 'ho' WHEN 3 THEN 'makali_factory' ELSE 'unknown' END,'address',address_);
END $f$;
ALTER FUNCTION sa_domain.order_dispatch_destination(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.order_dispatch_destination(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.order_dispatch_destination(bigint) TO sa_executor;
CREATE FUNCTION sa_domain.capture_dispatch_receipt(p_dispatch_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[7,10]);order_ bigint;
BEGIN
 SELECT i.order_id INTO order_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates d JOIN sa_snapshot_20261019.sa_items i ON i.id=d.item_id WHERE d.id=p_dispatch_id;
 IF order_ IS NULL THEN RAISE EXCEPTION 'Dispatch unavailable' USING ERRCODE='P0002';END IF;
 INSERT INTO sa_domain.dispatch_receipts(dispatch_id,order_id,actor_id,generation,destination)
 SELECT p_dispatch_id,order_,a.auth_id,generation,sa_domain.order_dispatch_destination(order_) FROM sa_domain.runtime_state;
END $f$;
ALTER FUNCTION sa_domain.capture_dispatch_receipt(bigint) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.capture_dispatch_receipt(bigint) FROM PUBLIC,anon,authenticated,sa_app;

CREATE FUNCTION sa_domain.v1_dispatch_destination_save(p_id bigint,p_destination text,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,7]);cached jsonb;o sa_snapshot_20261019.sa_orders;value_ int;v text;destination_ jsonb;
BEGIN
 IF p_destination IS NULL OR p_destination NOT IN('not_defined','customer','ho','makali_factory') THEN RAISE EXCEPTION 'Invalid dispatch destination' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.command_reason(p_reason);
 cached:=sa_domain.begin_command('order.destination_changed',p_idempotency_key,jsonb_build_object('id',p_id,'destination',p_destination,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);v:=sa_domain.bump_version('order',p_id,p_expected_version);
 value_:=CASE p_destination WHEN 'customer' THEN 1 WHEN 'ho' THEN 2 WHEN 'makali_factory' THEN 3 ELSE 0 END;
 UPDATE sa_snapshot_20261019.sa_orders SET dispatch_to=value_,updated_at=now() WHERE id=p_id;
 destination_:=sa_domain.order_dispatch_destination(p_id);
 IF value_=1 AND destination_->'address'='null' THEN RAISE EXCEPTION 'Customer delivery address unavailable' USING ERRCODE='22023';END IF;
 RETURN sa_domain.finish_command('order.destination_changed',p_idempotency_key,'order',p_id,jsonb_build_object('id',p_id::text,'version',v,'destination',destination_),jsonb_build_object('before',o.dispatch_to,'after',value_,'reason',p_reason));
END $f$;

CREATE FUNCTION sa_domain.v1_deliveries_list(p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[4,7,10]);n int:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;start_ timestamp;end_ timestamp;order_ bigint;customer_ bigint;r jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['from','before','order_id','customer_id']);
 IF p_filters?'from' THEN start_:=(sa_domain.due_timestamp(p_filters->>'from') AT TIME ZONE 'UTC');END IF;
 IF p_filters?'before' THEN end_:=(sa_domain.due_timestamp(p_filters->>'before') AT TIME ZONE 'UTC');END IF;
 IF start_ IS NOT NULL AND end_ IS NOT NULL AND start_>=end_ THEN RAISE EXCEPTION 'Delivery range is empty or reversed' USING ERRCODE='22023';END IF;
 IF p_filters?'order_id' THEN order_:=sa_domain.input_id(p_filters->'order_id');END IF;
 IF p_filters?'customer_id' THEN customer_:=sa_domain.input_id(p_filters->'customer_id');END IF;
 ctx:=sa_domain.page_context('deliveries',p_filters);after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT d.id,d.item_id,d.dispatched_at,i.order_id,o.customer_id,o.uc_status,o.status FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates d
 JOIN sa_snapshot_20261019.sa_items i ON i.id=d.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 WHERE d.id<after_ AND (a.role_id<>10 OR (o.customer_dealer_id=a.user_id AND o.customer_id<>a.user_id))
 AND (order_ IS NULL OR o.id=order_) AND (customer_ IS NULL OR o.customer_id=customer_)
 AND (start_ IS NULL OR d.dispatched_at>=start_) AND (end_ IS NULL OR d.dispatched_at<end_) ORDER BY d.id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 quantities AS(SELECT q.job_sheet_dispatched_date_id,sum(q.dispatched_quantity) quantity,count(*) sizes FROM sa_snapshot_20261019.sa_dispatched_quantities q
 WHERE q.job_sheet_dispatched_date_id IN(SELECT id FROM page) GROUP BY q.job_sheet_dispatched_date_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'item_id',p.item_id::text,'order_id',p.order_id::text,'customer_id',p.customer_id::text,
 'occurred_at',p.dispatched_at AT TIME ZONE 'UTC','quantity',coalesce(q.quantity,0),'size_rows',coalesce(q.sizes,0),
 'order_state',CASE WHEN p.uc_status='CANCELLED' THEN 'cancelled' WHEN p.status=1 THEN 'completed' ELSE 'pending' END,
 'history_state','recorded','destination',coalesce(receipt.destination,sa_domain.order_dispatch_destination(p.order_id)),
 'destination_basis',CASE WHEN receipt.dispatch_id IS NULL THEN 'current_order_only' ELSE 'dispatch_snapshot' END) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO r
 FROM page p LEFT JOIN quantities q ON q.job_sheet_dispatched_date_id=p.id LEFT JOIN sa_domain.dispatch_receipts receipt ON receipt.dispatch_id=p.id AND receipt.generation=(ctx->>'generation')::bigint;
 RETURN r;
END $f$;

DO $do$ DECLARE f record;args text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname IN('v1_dispatch_destination_save','v1_deliveries_list') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,format('SELECT sa_domain.%I(%s)',f.proname,args));
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
END $do$;
-- Both call sites retain their reviewed scope/quantity behavior. Capture the
-- destination with the immutable dispatch event; later edits cannot rewrite it.
DO $do$ DECLARE original_ text;changed_ text;needle_ text;BEGIN
 SELECT pg_get_functiondef('sa_domain.v1_dispatch_record(bigint,jsonb,text,text,uuid)'::regprocedure) INTO original_;
 needle_:='VALUES(p_id,t,now(),now()) RETURNING id INTO date_;';
 changed_:=replace(original_,needle_,needle_||' PERFORM sa_domain.capture_dispatch_receipt(date_);');
 IF changed_=original_ THEN RAISE EXCEPTION 'Expected dispatch insertion was not found';END IF;EXECUTE changed_;
 SELECT pg_get_functiondef('sa_domain.v1_order_get(bigint,text,integer)'::regprocedure) INTO original_;
 needle_:='RETURN result||jsonb_build_object(''items'',items_,';
 changed_:=replace(original_,needle_,'RETURN result||jsonb_build_object(''dispatch_destination'',sa_domain.order_dispatch_destination(p_id))||jsonb_build_object(''items'',items_,');
 IF changed_=original_ THEN RAISE EXCEPTION 'Expected order detail projection was not found';END IF;EXECUTE changed_;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
