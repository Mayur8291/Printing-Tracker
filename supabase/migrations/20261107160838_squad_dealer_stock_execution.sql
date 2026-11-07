BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_stocks,sa_snapshot_20261019.sa_stock_useds TO sa_executor;
GRANT UPDATE(dispatched_quantity,updated_at) ON sa_snapshot_20261019.sa_stocks TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_stocks_id_seq,sa_snapshot_20261019.sa_stock_useds_id_seq TO sa_executor;
CREATE POLICY squad_stock_read ON sa_snapshot_20261019.sa_stocks FOR SELECT TO sa_executor
 USING(user_id=(SELECT (sa_domain.actor()).user_id) OR order_id IN(SELECT sa_domain.scope_order_ids()));
CREATE POLICY squad_stock_update ON sa_snapshot_20261019.sa_stocks FOR UPDATE TO sa_executor
 USING(user_id=(SELECT (sa_domain.actor()).user_id)) WITH CHECK(user_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_stock_insert ON sa_snapshot_20261019.sa_stocks FOR INSERT TO sa_executor
 WITH CHECK(order_id IN(SELECT sa_domain.scope_order_ids()) AND item_id IN(SELECT sa_domain.scope_item_ids()));
CREATE POLICY squad_stock_used_read ON sa_snapshot_20261019.sa_stock_useds FOR SELECT TO sa_executor USING(stock_id IN(SELECT id FROM sa_snapshot_20261019.sa_stocks));
CREATE POLICY squad_stock_used_insert ON sa_snapshot_20261019.sa_stock_useds FOR INSERT TO sa_executor
 WITH CHECK(stock_id IN(SELECT id FROM sa_snapshot_20261019.sa_stocks WHERE user_id=(SELECT (sa_domain.actor()).user_id))
 AND dispatched_quantity_id IN(SELECT id FROM sa_snapshot_20261019.sa_dispatched_quantities));
CREATE INDEX squad_stock_used_dispatch ON sa_snapshot_20261019.sa_stock_useds(dispatched_quantity_id,stock_id);
GRANT SELECT(id,rmp_class_id,rmp_brand_id,rmp_category_id,rmp_size_id,is_deleted,updated_at) ON sa_snapshot_20261019.sa_rmp_skus TO sa_guard;
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_rmp_sizes,sa_snapshot_20261019.sa_sizes TO sa_guard;
CREATE POLICY squad_guard_stock_sku ON sa_snapshot_20261019.sa_rmp_skus FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_stock_sku ON sa_snapshot_20261019.sa_rmp_sizes FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_stock_sku ON sa_snapshot_20261019.sa_sizes FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.stock_order_owner(p_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT o.customer_id FROM sa_snapshot_20261019.sa_orders o JOIN sa_snapshot_20261019.sa_users u ON u.id=o.customer_id WHERE o.id=p_id AND u.role=10
$f$;
ALTER FUNCTION sa_domain.stock_order_owner(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.stock_sku(p_class bigint,p_brand bigint,p_category bigint,p_size bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT k.id FROM sa_snapshot_20261019.sa_rmp_skus k JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.id=k.rmp_size_id
 JOIN sa_snapshot_20261019.sa_sizes s ON s.name=rs.name AND s.id=p_size
 WHERE k.rmp_class_id=p_class AND k.rmp_brand_id=p_brand AND k.rmp_category_id IS NOT DISTINCT FROM p_category
 ORDER BY k.is_deleted ASC NULLS LAST,k.updated_at DESC,k.id DESC LIMIT 1
$f$;
ALTER FUNCTION sa_domain.stock_sku(bigint,bigint,bigint,bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.stock_item_key(p_item sa_snapshot_20261019.sa_items) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE key_ text;
BEGIN
 IF p_item.item_type=1 AND p_item.rmp_class_id IS NOT NULL AND p_item.rmp_brand_id IS NOT NULL THEN RETURN 'r:'||concat_ws(':',p_item.rmp_class_id,p_item.rmp_brand_id,p_item.rmp_category_id);END IF;
 IF p_item.item_type=0 AND p_item.product_id IS NOT NULL THEN SELECT 'c:'||fingerprint INTO key_ FROM sa_domain.stock_product_keys(ARRAY[p_item.product_id]);END IF;
 IF key_ IS NULL THEN RAISE EXCEPTION 'Item has no valid stock identity' USING ERRCODE='55000';END IF;RETURN key_;
END $f$;
-- Receipts belong to the original purchase item/size. Existing ambiguous origins
-- require reconciliation; retries never invent a second receipt.
CREATE FUNCTION sa_domain.receive_dealer_stock(p_item_id bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE i sa_snapshot_20261019.sa_items;o sa_snapshot_20261019.sa_orders;q record;s sa_snapshot_20261019.sa_stocks;dealer_ bigint;count_ int;inserted_ int:=0;sku_ bigint;kind_ int;ready_ boolean;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_item_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Receipt item unavailable' USING ERRCODE='P0002';END IF;
 o:=sa_domain.lock_order(i.order_id,false);PERFORM pg_advisory_xact_lock(hashtextextended('item:'||p_item_id,784139));
 IF o.uc_status='CANCELLED' THEN RAISE EXCEPTION 'Cancelled purchases cannot receive stock' USING ERRCODE='55000';END IF;
 dealer_:=sa_domain.stock_order_owner(o.id);IF dealer_ IS NULL THEN RETURN jsonb_build_object('received',0);END IF;
 SELECT count(*)>0 AND coalesce(bool_and(quantity>0 AND (i.item_type=1 OR (o.assigned_worker_id IS NOT NULL AND i.job_worker_status=5) OR dispatched_quantity>=quantity)),false) INTO ready_ FROM sa_snapshot_20261019.sa_quantities WHERE item_id=p_item_id AND coalesce(quantity,0)<>0;
 IF (i.item_type=1 AND i.uc_order_status IS DISTINCT FROM 'COMPLETE') OR (i.item_type=0 AND NOT ready_) THEN RETURN jsonb_build_object('received',0,'state','awaiting_completion');END IF;
 IF ready_ IS NOT TRUE OR i.item_type NOT IN(0,1) THEN RAISE EXCEPTION 'Receipt quantities require reconciliation' USING ERRCODE='55000';END IF;
 PERFORM sa_domain.stock_item_key(i);PERFORM pg_advisory_xact_lock(hashtextextended('dealer-stock:'||dealer_,784139));kind_:=CASE i.item_type WHEN 1 THEN 0 ELSE 1 END;
 FOR q IN SELECT size_id,sum(quantity)::bigint quantity FROM sa_snapshot_20261019.sa_quantities WHERE item_id=p_item_id GROUP BY size_id ORDER BY size_id LOOP
  IF q.quantity=0 THEN CONTINUE;END IF;
  IF q.size_id IS NULL OR q.quantity<0 OR q.quantity>2147483647 THEN RAISE EXCEPTION 'Invalid receipt size/quantity' USING ERRCODE='55000';END IF;
  SELECT count(*) INTO count_ FROM sa_snapshot_20261019.sa_stocks WHERE user_id=dealer_ AND item_id=p_item_id AND size_id=q.size_id;
  IF count_>1 THEN RAISE EXCEPTION 'Duplicate stock receipt origin requires reconciliation' USING ERRCODE='55000';END IF;
  SELECT * INTO s FROM sa_snapshot_20261019.sa_stocks WHERE user_id=dealer_ AND item_id=p_item_id AND size_id=q.size_id FOR UPDATE;
  IF s.id IS NOT NULL THEN
   IF s.quantity IS DISTINCT FROM q.quantity OR s.stock_type IS DISTINCT FROM kind_ OR s.order_id IS DISTINCT FROM o.id OR s.product_id IS DISTINCT FROM i.product_id
    OR s.rmp_class_id IS DISTINCT FROM i.rmp_class_id OR s.rmp_brand_id IS DISTINCT FROM i.rmp_brand_id OR s.rmp_category_id IS DISTINCT FROM i.rmp_category_id THEN
    RAISE EXCEPTION 'Existing stock receipt differs from its origin' USING ERRCODE='55000';END IF;
   CONTINUE;
  END IF;
  sku_:=CASE WHEN i.item_type=1 THEN sa_domain.stock_sku(i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id,q.size_id) END;
  IF i.item_type=1 AND sku_ IS NULL THEN RAISE EXCEPTION 'Receipt SKU could not be resolved from the original size' USING ERRCODE='55000';END IF;
  INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,product_id,rmp_class_id,rmp_brand_id,rmp_category_id,rmp_sku_id,created_at,updated_at)
   VALUES(dealer_,o.id,p_item_id,q.size_id,kind_,q.quantity,0,i.product_id,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id,sku_,now(),now());inserted_:=inserted_+1;
 END LOOP;
 RETURN jsonb_build_object('received',inserted_,'dealer_id',dealer_::text,'state','ready');
END $f$;
CREATE FUNCTION sa_domain.consume_dealer_stock(p_item sa_snapshot_20261019.sa_items,p_quantity_id bigint,p_dispatch_id bigint,p_amount integer,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);key_ text:=sa_domain.stock_item_key(p_item);size_ bigint;balance_ record;s record;remaining_ int:=p_amount;used_ int;ids_ bigint[];result_ jsonb:='[]';id_ bigint;
BEGIN
 IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid stock allocation amount' USING ERRCODE='22023';END IF;
 SELECT size_id INTO size_ FROM sa_snapshot_20261019.sa_quantities WHERE id=p_quantity_id AND item_id=p_item.id;
 IF size_ IS NULL OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_dispatched_quantities h JOIN sa_snapshot_20261019.sa_job_sheet_dispatched_dates d ON d.id=h.job_sheet_dispatched_date_id
 JOIN sa_snapshot_20261019.sa_orders o ON o.id=p_item.order_id WHERE h.id=p_dispatch_id AND h.quantity_id=p_quantity_id AND h.dispatched_quantity=p_amount AND d.item_id=p_item.id AND o.customer_dealer_id=a.user_id AND o.customer_id<>a.user_id) THEN
 RAISE EXCEPTION 'Dispatch is outside your dealer fulfillment scope' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dealer-stock:'||a.user_id,784139));
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_stock_useds WHERE dispatched_quantity_id=p_dispatch_id) THEN RAISE EXCEPTION 'Dispatch already has stock allocations' USING ERRCODE='40001';END IF;
 SELECT * INTO balance_ FROM sa_domain.stock_balances(a.user_id) WHERE stock_key=key_ AND size_id=size_;
 IF balance_.id IS NULL OR balance_.available<p_amount THEN RAISE EXCEPTION 'Insufficient dealer stock' USING ERRCODE='55000';END IF;
 IF balance_.needs_reconciliation THEN RAISE EXCEPTION 'Dealer inventory requires reconciliation before allocation' USING ERRCODE='55000';END IF;
 IF p_item.item_type=0 THEN
  SELECT array_agg(product_id) INTO ids_ FROM sa_domain.stock_product_keys(ARRAY(SELECT DISTINCT product_id FROM sa_snapshot_20261019.sa_stocks WHERE user_id=a.user_id AND stock_type=1 AND size_id=size_)) WHERE 'c:'||fingerprint=key_;
 END IF;
 FOR s IN SELECT * FROM sa_snapshot_20261019.sa_stocks WHERE user_id=a.user_id AND size_id=size_ AND created_at<=p_at AT TIME ZONE 'UTC'
 AND ((p_item.item_type=0 AND stock_type=1 AND product_id=ANY(ids_)) OR (p_item.item_type=1 AND stock_type=0 AND rmp_class_id=p_item.rmp_class_id AND rmp_brand_id=p_item.rmp_brand_id AND rmp_category_id IS NOT DISTINCT FROM p_item.rmp_category_id))
 ORDER BY id FOR UPDATE LOOP
  used_:=least(remaining_,s.quantity-coalesce(s.dispatched_quantity,0));IF used_<=0 THEN CONTINUE;END IF;
  INSERT INTO sa_snapshot_20261019.sa_stock_useds(stock_id,dispatched_quantity_id,qty,created_at,updated_at) VALUES(s.id,p_dispatch_id,used_,now(),now()) RETURNING id INTO id_;
  UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=coalesce(dispatched_quantity,0)+used_,updated_at=now() WHERE id=s.id;
  result_:=result_||jsonb_build_array(jsonb_build_object('id',id_::text,'receipt_id',s.id::text,'quantity',used_));remaining_:=remaining_-used_;EXIT WHEN remaining_=0;
 END LOOP;
 IF remaining_<>0 THEN RAISE EXCEPTION 'Stock available at the dispatch time is insufficient' USING ERRCODE='55000';END IF;RETURN result_;
END $f$;

-- RMP category is optional in the legacy SKU model.
CREATE OR REPLACE FUNCTION sa_domain.stock_balances(p_dealer_id bigint)
 RETURNS TABLE(id bigint, stock_key text, stock_type integer, size_id bigint, product_id bigint, rmp_class_id bigint, rmp_brand_id bigint, rmp_category_id bigint, received bigint, consumed bigint, available bigint, needs_reconciliation boolean, receipt_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 WITH receipts AS MATERIALIZED(SELECT s.id,s.user_id,s.order_id,s.item_id,s.size_id,s.stock_type,s.quantity,s.dispatched_quantity,s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id,s.product_id,
 EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o JOIN sa_snapshot_20261019.sa_items i ON i.order_id=o.id WHERE o.id=s.order_id AND i.id=s.item_id AND o.customer_id=s.user_id)
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=s.item_id AND q.size_id=s.size_id) origin_valid
 FROM sa_snapshot_20261019.sa_stocks s WHERE s.user_id=p_dealer_id),
 keys AS MATERIALIZED(SELECT * FROM sa_domain.stock_product_keys(ARRAY(SELECT DISTINCT product_id FROM receipts WHERE product_id IS NOT NULL))),
 used AS(SELECT u.stock_id,sum(u.qty)::bigint quantity,bool_or(u.qty IS NULL OR u.qty<0) invalid FROM sa_snapshot_20261019.sa_stock_useds u JOIN receipts s ON s.id=u.stock_id GROUP BY u.stock_id),
 keyed AS(SELECT s.*,CASE WHEN s.stock_type=0 THEN 'r:'||concat_ws(':',s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id) ELSE 'c:'||coalesce(k.fingerprint,'invalid-'||s.id) END key_,
 coalesce(u.quantity,0) used_,coalesce(u.invalid,false) invalid_,k.fingerprint FROM receipts s LEFT JOIN keys k ON k.product_id=s.product_id LEFT JOIN used u ON u.stock_id=s.id),
 checked AS(SELECT *,count(*) OVER(PARTITION BY order_id,item_id,size_id,key_) origins FROM keyed)
 SELECT min(s.id),s.key_,s.stock_type,s.size_id,min(s.product_id),s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id,
 sum(coalesce(s.quantity,0))::bigint,sum(s.used_)::bigint,sum(coalesce(s.quantity,0)-s.used_)::bigint,
 bool_or(NOT s.origin_valid OR s.origins>1 OR s.quantity IS NULL OR s.quantity<0 OR s.used_>s.quantity OR s.invalid_ OR coalesce(s.dispatched_quantity,0)<>s.used_
 OR s.size_id IS NULL OR s.item_id IS NULL OR s.order_id IS NULL OR s.stock_type IS NULL OR s.stock_type NOT IN(0,1)
 OR (s.stock_type=1 AND s.fingerprint IS NULL) OR (s.stock_type=0 AND (s.rmp_class_id IS NULL OR s.rmp_brand_id IS NULL))),count(*)
 FROM checked s GROUP BY s.key_,s.stock_type,s.size_id,s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id
$function$;

CREATE OR REPLACE FUNCTION sa_domain.v1_dispatch_record(p_id bigint,p_quantities jsonb,p_occurred_at text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[7,10]);i sa_snapshot_20261019.sa_items;q sa_snapshot_20261019.sa_quantities;cached jsonb;x jsonb;qty_ int;date_ bigint;v text;ov text;progress_ jsonb;t timestamptz;o sa_snapshot_20261019.sa_orders;stock_ jsonb;allocations_ jsonb:='[]';dispatch_row_ bigint;
BEGIN
 PERFORM sa_domain.work_rows(p_quantities,'dispatch');
 cached:=sa_domain.begin_command('item.dispatched',p_idempotency_key,jsonb_build_object('id',p_id,'rows',p_quantities,'at',p_occurred_at,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 t:=sa_domain.work_timestamp(p_occurred_at);i:=sa_domain.lock_item(p_id);IF a.role_id=7 THEN PERFORM sa_domain.assert_factory_work(i);PERFORM sa_domain.assert_work_balances(p_id);
 ELSE
  SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=i.order_id;
  IF o.customer_dealer_id IS DISTINCT FROM a.user_id OR o.customer_id=a.user_id OR o.assigned_to_id IS NOT NULL OR o.assigned_worker_id IS NOT NULL
   OR coalesce(i.cutting_done,0)>0 OR coalesce(i.assigned_to_tailor_quantity,0)>0 OR coalesce(i.completed_by_tailor_quantity,0)>0 THEN
   RAISE EXCEPTION 'Order is not solely dealer stock fulfillment' USING ERRCODE='42501';END IF;
  IF EXISTS(WITH history AS(SELECT h.quantity_id,sum(h.dispatched_quantity) quantity,bool_or(h.dispatched_quantity<0) invalid FROM sa_snapshot_20261019.sa_dispatched_quantities h
   JOIN sa_snapshot_20261019.sa_job_sheet_dispatched_dates d ON d.id=h.job_sheet_dispatched_date_id WHERE d.item_id=p_id GROUP BY h.quantity_id)
   SELECT FROM sa_snapshot_20261019.sa_quantities size_row LEFT JOIN history h ON h.quantity_id=size_row.id WHERE size_row.item_id=p_id
   AND (coalesce(size_row.dispatched_quantity,0)<>coalesce(h.quantity,0) OR size_row.quantity<coalesce(h.quantity,0) OR coalesce(h.invalid,false) OR coalesce(h.quantity,0)<0)) THEN
   RAISE EXCEPTION 'Dealer dispatch history requires reconciliation' USING ERRCODE='55000';END IF;
 END IF;
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',i.order_id,sa_domain.version('order',i.order_id));
 INSERT INTO sa_snapshot_20261019.sa_job_sheet_dispatched_dates(item_id,dispatched_at,created_at,updated_at) VALUES(p_id,t,now(),now()) RETURNING id INTO date_;
 FOR x IN SELECT value FROM jsonb_array_elements(p_quantities) ORDER BY (value->>'quantity_id')::bigint LOOP
  SELECT * INTO q FROM sa_snapshot_20261019.sa_quantities WHERE id=(x->>'quantity_id')::bigint AND item_id=p_id FOR UPDATE;qty_:=(x->>'quantity')::int;
  IF q.id IS NULL OR coalesce(q.dispatched_quantity,0)<0 OR qty_>(CASE WHEN a.role_id=7 THEN least(coalesce(q.completed_by_tailor_quantity,0),coalesce(q.quantity,0)) ELSE coalesce(q.quantity,0) END)-coalesce(q.dispatched_quantity,0) THEN
   RAISE EXCEPTION 'Dispatch exceeds the available quantity for this size' USING ERRCODE='22023';END IF;
  INSERT INTO sa_snapshot_20261019.sa_dispatched_quantities(job_sheet_dispatched_date_id,quantity_id,qty,dispatched_quantity,created_at,updated_at)
   VALUES(date_,q.id,(CASE WHEN a.role_id=7 THEN q.completed_by_tailor_quantity ELSE q.quantity END)-coalesce(q.dispatched_quantity,0),qty_,now(),now()) RETURNING id INTO dispatch_row_;
  IF a.role_id=10 THEN allocations_:=allocations_||sa_domain.consume_dealer_stock(i,q.id,dispatch_row_,qty_,t);END IF;
  UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=coalesce(dispatched_quantity,0)+qty_,updated_at=now() WHERE id=q.id;
 END LOOP;
 UPDATE sa_snapshot_20261019.sa_orders SET last_dispatched_at=greatest(last_dispatched_at,t AT TIME ZONE 'UTC') WHERE id=i.order_id;
 progress_:=sa_domain.recompute_item_progress(p_id);stock_:=sa_domain.receive_dealer_stock(p_id);
 RETURN sa_domain.finish_command('item.dispatched',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'history_id',date_::text,'version',v,'order_version',ov,'progress',progress_,'stock_receipt',stock_,'stock_allocations',allocations_),jsonb_build_object('order_id',i.order_id::text,'rows',p_quantities,'at',t,'stock_receipt',stock_,'stock_allocations',allocations_));
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.recompute_order_progress(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE o sa_snapshot_20261019.sa_orders:=sa_domain.lock_order(p_id,false);r jsonb:=sa_domain.order_progress_totals(p_id);complete_ boolean;dispatch_ boolean;
BEGIN
 dispatch_:=CASE WHEN o.customer_dealer_id IS NOT NULL THEN (r->>'all_dispatch_complete')::boolean ELSE (r->>'dispatch_complete')::boolean END;
 complete_:=CASE WHEN o.uc_status='CANCELLED' OR o.is_deleted THEN false WHEN o.is_force_update THEN true
 WHEN o.assigned_worker_id IS NOT NULL AND (r->>'custom_count')::int>0 THEN (r->>'worker_complete')::boolean AND ((r->>'rmp_count')::int=0 OR o.uc_status='COMPLETE')
 WHEN o.customer_dealer_id IS NOT NULL THEN (r->>'all_dispatch_complete')::boolean
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
END $function$;


CREATE OR REPLACE FUNCTION sa_domain.v1_worker_stage_save(p_id bigint,p_stage integer,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,11]);i sa_snapshot_20261019.sa_items;o sa_snapshot_20261019.sa_orders;cached jsonb;v text;ov text;progress_ jsonb;stock_ jsonb;reason_ text:=sa_domain.command_reason(p_reason);
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
 progress_:=sa_domain.recompute_order_progress(o.id);stock_:=sa_domain.receive_dealer_stock(p_id);
 RETURN sa_domain.finish_command('item.worker_stage_changed',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'version',v,'order_version',ov,'stage',p_stage,'order_completed',progress_->'completed','stock_receipt',stock_),
 jsonb_build_object('order_id',o.id::text,'worker_id',o.assigned_worker_id::text,'before',i.job_worker_status,'after',p_stage,'reason',reason_,'progress',progress_));
END $f$;
CREATE FUNCTION sa_domain.dealer_dispatch_availability(p_item_ids bigint[]) RETURNS TABLE(id bigint,stock_status text,available_to_dispatch bigint,remaining_quantity bigint)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);
BEGIN
 IF coalesce(cardinality(p_item_ids),0)>100 THEN RAISE EXCEPTION 'Availability page exceeds 100 items' USING ERRCODE='22023';END IF;
 RETURN QUERY WITH selected AS MATERIALIZED(SELECT i.id,i.product_id,i.item_type,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id FROM sa_snapshot_20261019.sa_items i
 JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.id=ANY(p_item_ids) AND o.customer_dealer_id=a.user_id AND o.customer_id<>a.user_id),
 keys AS MATERIALIZED(SELECT * FROM sa_domain.stock_product_keys(ARRAY(SELECT product_id FROM selected WHERE product_id IS NOT NULL))),
 balances AS MATERIALIZED(SELECT * FROM sa_domain.stock_balances(a.user_id)),
 demand AS(SELECT q.item_id,q.size_id,sum(coalesce(q.quantity,0)-coalesce(q.dispatched_quantity,0)) remaining,bool_or(q.quantity IS NULL OR q.quantity<q.dispatched_quantity) invalid
 FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=ANY(p_item_ids) GROUP BY q.item_id,q.size_id),
 summary AS(SELECT i.id,count(d.size_id) size_count,sum(d.remaining)::bigint remaining,
 sum(least(greatest(d.remaining,0),greatest(coalesce(b.available,0),0)))::bigint available,
 bool_or(coalesce(d.invalid,false) OR coalesce(b.needs_reconciliation,false) OR (i.item_type=0 AND k.fingerprint IS NULL) OR (i.item_type=1 AND (i.rmp_class_id IS NULL OR i.rmp_brand_id IS NULL))) invalid
 FROM selected i LEFT JOIN keys k ON k.product_id=i.product_id LEFT JOIN demand d ON d.item_id=i.id
 LEFT JOIN balances b ON b.size_id=d.size_id AND b.stock_key=CASE WHEN i.item_type=0 THEN 'c:'||k.fingerprint ELSE 'r:'||concat_ws(':',i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id) END GROUP BY i.id)
 SELECT s.id,CASE WHEN s.size_count=0 OR s.invalid THEN 'needs_reconciliation' WHEN s.remaining=0 THEN 'complete' WHEN s.available=0 THEN 'waiting_stock' WHEN s.available<s.remaining THEN 'partial' ELSE 'ready' END,
 CASE WHEN s.size_count=0 OR s.invalid THEN NULL ELSE s.available END,coalesce(s.remaining,0) FROM summary s;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.dealer_dispatch_availability(bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.dealer_dispatch_availability(bigint[]) TO sa_executor;

CREATE OR REPLACE FUNCTION sa_domain.work_detail(p_id bigint,p_kind text,p_quantity_cursor text,p_history_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(CASE WHEN p_kind='cutting' THEN ARRAY[4,9] ELSE ARRAY[4,7,10] END);i sa_snapshot_20261019.sa_items;n int:=sa_domain.page_limit(p_limit);
 qc jsonb:=sa_domain.page_context('work_sizes',jsonb_build_object('item',p_id,'kind',p_kind));hc jsonb:=sa_domain.page_context('work_history',jsonb_build_object('item',p_id,'kind',p_kind));
 qa bigint:=sa_domain.cursor_id(p_quantity_cursor,qc);ha bigint:=sa_domain.cursor_id(p_history_cursor,hc);qpage jsonb;hpage jsonb;result_ jsonb;availability_ jsonb;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found or unavailable' USING ERRCODE='P0002';END IF;
 IF a.role_id=10 AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE id=i.order_id AND customer_dealer_id=a.user_id AND customer_id<>a.user_id) THEN RAISE EXCEPTION 'Dealer fulfillment item unavailable' USING ERRCODE='P0002';END IF;
 WITH scan AS MATERIALIZED(SELECT q.id,q.size_id,s.name size_name,q.quantity,q.cutting_done,q.assigned_to_tailor_quantity,q.completed_by_tailor_quantity,q.dispatched_quantity
  FROM sa_snapshot_20261019.sa_quantities q LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE q.item_id=p_id AND q.id<qa ORDER BY q.id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'size_id',size_id::text,'size_name',size_name,'quantity',quantity,
 'cut',cutting_done,'assigned',assigned_to_tailor_quantity,'inspected',completed_by_tailor_quantity,'picked',completed_by_tailor_quantity,'dispatched',dispatched_quantity,
 'remaining',CASE WHEN p_kind='cutting' THEN quantity-coalesce(cutting_done,0) WHEN a.role_id=10 THEN quantity-coalesce(dispatched_quantity,0) ELSE least(coalesce(quantity,0),coalesce(completed_by_tailor_quantity,0))-coalesce(dispatched_quantity,0) END) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),qc) END) INTO qpage FROM page;
 WITH scan AS MATERIALIZED(
  SELECT q.id,d.id history_id,q.quantity_id,q.qty remaining_before,q.cutting_done quantity,d.cutting_date occurred_at FROM sa_snapshot_20261019.sa_mark_cutting_quantities q
  JOIN sa_snapshot_20261019.sa_mark_cuttings d ON d.id=q.mark_cutting_id WHERE p_kind='cutting' AND d.item_id=p_id AND q.id<ha
  UNION ALL
  SELECT q.id,d.id,q.quantity_id,q.qty,q.dispatched_quantity,d.dispatched_at FROM sa_snapshot_20261019.sa_dispatched_quantities q
  JOIN sa_snapshot_20261019.sa_job_sheet_dispatched_dates d ON d.id=q.job_sheet_dispatched_date_id WHERE p_kind='dispatch' AND d.item_id=p_id AND q.id<ha
  ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'history_id',history_id::text,'quantity_id',quantity_id::text,'remaining_before',remaining_before,
 'quantity',quantity,'occurred_at',occurred_at AT TIME ZONE 'UTC') ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),hc) END) INTO hpage FROM page;
 result_:=jsonb_build_object('id',i.id::text,'order_id',i.order_id::text,'product_id',i.product_id::text,'sample',i.sample_order,'planned_quantity',i.total_quantity,
 'version',sa_domain.version('item',i.id),'quantities',qpage,'history',hpage);
 IF a.role_id=10 THEN SELECT to_jsonb(x)-'id' INTO availability_ FROM sa_domain.dealer_dispatch_availability(ARRAY[p_id]) x;result_:=result_||coalesce(availability_,'{}');END IF;
 RETURN result_;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.work_queue(p_kind text,p_completed boolean,p_order_id bigint,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(CASE WHEN p_kind='cutting' THEN ARRAY[4,9] ELSE ARRAY[4,7,10] END);n int:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('work_queue',jsonb_build_object('kind',p_kind,'completed',p_completed,'order',p_order_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;availability_ jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT i.id,i.order_id,i.product_id,i.cutting_master_id,i.sample_order,i.cutting_done,i.assigned_to_tailor_quantity,i.completed_by_tailor_quantity,i.dispatched_quantity,o.due_on,o.is_prime,
  EXISTS(SELECT FROM sa_domain.order_requests r WHERE r.order_id=o.id AND r.state IN('queued','running')) held
  FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
  WHERE i.id<after_ AND (p_order_id IS NULL OR i.order_id=p_order_id) AND o.assigned_worker_id IS NULL AND ((a.role_id<>10 AND i.item_type=0 AND o.assigned_to_id IS NOT NULL AND o.customer_dealer_id IS NULL) OR (a.role_id=10 AND i.item_type IN(0,1) AND o.customer_dealer_id=a.user_id AND o.customer_id<>a.user_id AND o.assigned_to_id IS NULL))
  AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND o.uc_status<>'CANCELLED'
  AND CASE WHEN p_completed THEN CASE WHEN p_kind='cutting' THEN i.cutting_status=1 ELSE i.dispatched_status=1 END
   ELSE o.status=0 AND CASE WHEN p_kind='cutting' THEN i.cutting_status<>1 WHEN a.role_id=10 THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=i.id AND q.quantity>coalesce(q.dispatched_quantity,0)) ELSE i.completed_by_tailor_quantity>i.dispatched_quantity END END
  ORDER BY i.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'order_id',p.order_id::text,'product_id',p.product_id::text,'cutter_id',p.cutting_master_id::text,
 'sample',p.sample_order,'cut',p.cutting_done,'assigned',p.assigned_to_tailor_quantity,'inspected',p.completed_by_tailor_quantity,'dispatched',p.dispatched_quantity,
 'due_at',p.due_on AT TIME ZONE 'UTC','prime',p.is_prime,'held',p.held,'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO r FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=p.id;
 IF a.role_id=10 THEN
  SELECT coalesce(jsonb_object_agg(x.id::text,to_jsonb(x)-'id'),'{}') INTO availability_ FROM sa_domain.dealer_dispatch_availability(ARRAY(SELECT (value->>'id')::bigint FROM jsonb_array_elements(r->'data'))) x;
  r:=jsonb_set(r,'{data}',(SELECT coalesce(jsonb_agg(value||coalesce(availability_->(value->>'id'),'{}') ORDER BY ordinality),'[]') FROM jsonb_array_elements(r->'data') WITH ORDINALITY));
 END IF;RETURN r;
END $f$;
DO $do$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
 AND p.proname=ANY(ARRAY['stock_order_owner','stock_sku','stock_item_key','receive_dealer_stock','consume_dealer_stock']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
