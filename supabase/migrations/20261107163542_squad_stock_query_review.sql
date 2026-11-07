BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE INDEX squad_stock_dealer_size ON sa_snapshot_20261019.sa_stocks(user_id,size_id,id);
CREATE INDEX squad_quantity_item_size ON sa_snapshot_20261019.sa_quantities(item_id,size_id);
-- Batch source-origin validation once, rather than three correlated probes per
-- receipt. Single-size dispatches inspect only that size's inventory.
CREATE FUNCTION sa_domain.stock_balances(p_dealer_id bigint,p_size_ids bigint[])
 RETURNS TABLE(id bigint, stock_key text, stock_type integer, size_id bigint, product_id bigint, rmp_class_id bigint, rmp_brand_id bigint, rmp_category_id bigint, received bigint, consumed bigint, available bigint, needs_reconciliation boolean, receipt_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 WITH base AS MATERIALIZED(SELECT s.id,s.user_id,s.order_id,s.item_id,s.size_id,s.stock_type,s.quantity,s.dispatched_quantity,s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id,s.product_id
 FROM sa_snapshot_20261019.sa_stocks s WHERE s.user_id=p_dealer_id AND (p_size_ids IS NULL OR s.size_id=ANY(p_size_ids))),
 origins AS MATERIALIZED(SELECT i.id,i.order_id,o.customer_id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.id=ANY(ARRAY(SELECT DISTINCT item_id FROM base))),
 sizes AS MATERIALIZED(SELECT DISTINCT q.item_id,q.size_id FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=ANY(ARRAY(SELECT DISTINCT item_id FROM base))),
 receipts AS MATERIALIZED(SELECT s.*,coalesce(o.order_id=s.order_id AND o.customer_id=s.user_id AND z.item_id IS NOT NULL,false) origin_valid
 FROM base s LEFT JOIN origins o ON o.id=s.item_id LEFT JOIN sizes z ON z.item_id=s.item_id AND z.size_id=s.size_id),
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

CREATE OR REPLACE FUNCTION sa_domain.stock_balances(p_dealer_id bigint)
 RETURNS TABLE(id bigint, stock_key text, stock_type integer, size_id bigint, product_id bigint, rmp_class_id bigint, rmp_brand_id bigint, rmp_category_id bigint, received bigint, consumed bigint, available bigint, needs_reconciliation boolean, receipt_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ SELECT * FROM sa_domain.stock_balances(p_dealer_id,NULL::bigint[]) $function$;
CREATE OR REPLACE FUNCTION sa_domain.consume_dealer_stock(p_item sa_snapshot_20261019.sa_items,p_quantity_id bigint,p_dispatch_id bigint,p_amount integer,p_at timestamptz) RETURNS jsonb
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
 SELECT * INTO balance_ FROM sa_domain.stock_balances(a.user_id,ARRAY[size_]) WHERE stock_key=key_ AND size_id=size_;
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

CREATE OR REPLACE FUNCTION sa_domain.dealer_dispatch_availability(p_item_ids bigint[]) RETURNS TABLE(id bigint,stock_status text,available_to_dispatch bigint,remaining_quantity bigint)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[10]);
BEGIN
 IF coalesce(cardinality(p_item_ids),0)>100 THEN RAISE EXCEPTION 'Availability page exceeds 100 items' USING ERRCODE='22023';END IF;
 RETURN QUERY WITH selected AS MATERIALIZED(SELECT i.id,i.product_id,i.item_type,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id FROM sa_snapshot_20261019.sa_items i
 JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.id=ANY(p_item_ids) AND o.customer_dealer_id=a.user_id AND o.customer_id<>a.user_id),
 keys AS MATERIALIZED(SELECT * FROM sa_domain.stock_product_keys(ARRAY(SELECT product_id FROM selected WHERE product_id IS NOT NULL))),
 balances AS MATERIALIZED(SELECT * FROM sa_domain.stock_balances(a.user_id,ARRAY(SELECT DISTINCT size_id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(p_item_ids)))),
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
CREATE OR REPLACE FUNCTION sa_domain.v1_dealer_stock(p_dealer_id bigint DEFAULT NULL,p_customer_id bigint DEFAULT NULL,p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.stock_view_context(p_dealer_id,p_customer_id);n int:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;
 kind_ int;product_ bigint;class_ bigint;brand_ bigint;size_ bigint;key_ text;r jsonb;percentage_ int:=(context_->>'visibility_percentage')::int;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['kind','product_id','rmp_class_id','rmp_brand_id','size_id']);
 IF p_filters?'kind' THEN
  IF p_filters->>'kind' IS NULL OR p_filters->>'kind' NOT IN('rmp','custom') THEN RAISE EXCEPTION 'Invalid stock kind' USING ERRCODE='22023';END IF;
  kind_:=CASE p_filters->>'kind' WHEN 'rmp' THEN 0 ELSE 1 END;
 END IF;
 IF p_filters?'product_id' THEN product_:=sa_domain.input_id(p_filters->'product_id');SELECT 'c:'||fingerprint INTO key_ FROM sa_domain.stock_product_keys(ARRAY[product_]);END IF;
 IF p_filters?'rmp_class_id' THEN class_:=sa_domain.input_id(p_filters->'rmp_class_id');END IF;
 IF p_filters?'rmp_brand_id' THEN brand_:=sa_domain.input_id(p_filters->'rmp_brand_id');END IF;
 IF p_filters?'size_id' THEN size_:=sa_domain.input_id(p_filters->'size_id');END IF;
 IF (context_->>'physical')::boolean IS FALSE AND product_ IS NULL AND class_ IS NULL THEN RAISE EXCEPTION 'Choose a product before viewing customer stock' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('dealer_stock',jsonb_build_object('context',context_,'filters',p_filters));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.stock_balances((context_->>'dealer_id')::bigint,CASE WHEN size_ IS NOT NULL THEN ARRAY[size_] END) s
 WHERE s.id<after_ AND (kind_ IS NULL OR s.stock_type=kind_) AND (product_ IS NULL OR s.stock_key=key_)
 AND (class_ IS NULL OR s.rmp_class_id=class_) AND (brand_ IS NULL OR s.rmp_brand_id=brand_) AND (size_ IS NULL OR s.size_id=size_) ORDER BY s.id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'key',stock_key,'kind',CASE stock_type WHEN 0 THEN 'rmp' ELSE 'custom' END,
 'size_id',size_id::text,'product_id',product_id::text,'rmp_class_id',rmp_class_id::text,'rmp_brand_id',rmp_brand_id::text,'rmp_category_id',rmp_category_id::text,
 'status',CASE WHEN needs_reconciliation THEN 'needs_reconciliation' ELSE 'ready' END,
 'available',CASE WHEN needs_reconciliation THEN NULL ELSE floor(available*percentage_/100.0) END)
 ||CASE WHEN (context_->>'physical')::boolean THEN jsonb_build_object('received',received,'consumed',consumed,'receipt_count',receipt_count) ELSE '{}' END ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END,'context',context_) INTO r FROM page;RETURN r;
END $f$;

ALTER FUNCTION sa_domain.stock_balances(bigint,bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.stock_balances(bigint,bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.stock_balances(bigint,bigint[]) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
