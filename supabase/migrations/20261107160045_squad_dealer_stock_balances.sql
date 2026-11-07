BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Canonical stock identity excludes owners, artwork and preset names, exactly as
-- legacy comparable-value matching. Batch the part/add-on graph once per set.
GRANT SELECT(id,base_product_id,fabric_id,fabric_color_id,category_id) ON sa_snapshot_20261019.sa_products TO sa_guard;
GRANT SELECT(id,product_id,part_id,part_color_id) ON sa_snapshot_20261019.sa_product_parts TO sa_guard;
GRANT SELECT(id,product_part_id,add_on_id,add_on_color_id) ON sa_snapshot_20261019.sa_product_part_add_ons TO sa_guard;
CREATE POLICY squad_guard_stock_configuration ON sa_snapshot_20261019.sa_products FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_stock_configuration ON sa_snapshot_20261019.sa_product_parts FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_stock_configuration ON sa_snapshot_20261019.sa_product_part_add_ons FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.stock_product_keys(p_ids bigint[]) RETURNS TABLE(product_id bigint,fingerprint text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH parts AS MATERIALIZED(SELECT id,product_id,part_id,part_color_id FROM sa_snapshot_20261019.sa_product_parts WHERE product_id=ANY(p_ids)),
 addons AS(SELECT a.product_part_id,jsonb_agg(jsonb_build_array(a.add_on_id,a.add_on_color_id) ORDER BY a.add_on_id,a.add_on_color_id,a.id) data
 FROM sa_snapshot_20261019.sa_product_part_add_ons a JOIN parts p ON p.id=a.product_part_id GROUP BY a.product_part_id),
 configurations AS(SELECT p.product_id,jsonb_agg(jsonb_build_array(p.part_id,p.part_color_id,coalesce(a.data,'[]')) ORDER BY p.part_id,p.part_color_id,p.id) data
 FROM parts p LEFT JOIN addons a ON a.product_part_id=p.id GROUP BY p.product_id)
 SELECT p.id,encode(sha256(convert_to(jsonb_build_array(p.base_product_id,p.fabric_id,p.fabric_color_id,p.category_id,coalesce(c.data,'[]'))::text,'UTF8')),'hex')
 FROM sa_snapshot_20261019.sa_products p LEFT JOIN configurations c ON c.product_id=p.id WHERE p.id=ANY(p_ids)
$f$;
ALTER FUNCTION sa_domain.stock_product_keys(bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.stock_product_keys(bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.stock_product_keys(bigint[]) TO sa_executor,sa_guard;

CREATE FUNCTION sa_domain.stock_view_context(p_dealer_id bigint,p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,3,10]);dealer_ bigint:=coalesce(p_dealer_id,CASE WHEN a.role_id=10 THEN a.user_id END);customer_ bigint:=coalesce(p_customer_id,a.user_id);u record;
BEGIN
 IF dealer_ IS NULL OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=dealer_ AND role=10 AND disabled IS NOT TRUE AND deleted_at IS NULL) THEN
 RAISE EXCEPTION 'Dealer inventory is unavailable' USING ERRCODE='42501';END IF;
 IF a.role_id=10 THEN
  IF dealer_<>a.user_id OR (p_customer_id IS NOT NULL AND p_customer_id<>a.user_id) THEN RAISE EXCEPTION 'Use your own dealer stock context' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('dealer_id',dealer_::text,'customer_id',a.user_id::text,'physical',true,'visibility_percentage',100);
 END IF;
 SELECT id,created_by_id,stock_visibility_percentage,is_direct_deal INTO u FROM sa_snapshot_20261019.sa_users WHERE id=customer_ AND role=3 AND deleted_at IS NULL AND disabled IS NOT TRUE AND approved IS NOT FALSE;
 IF u.id IS NULL OR (a.role_id=3 AND customer_<>a.user_id) OR (a.role_id=1 AND u.created_by_id IS DISTINCT FROM a.user_id) OR u.is_direct_deal IS TRUE
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=customer_ AND dealer_id=dealer_) THEN
 RAISE EXCEPTION 'Dealer inventory is outside this customer relationship' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('dealer_id',dealer_::text,'customer_id',customer_::text,'physical',false,'visibility_percentage',greatest(0,least(100,coalesce(u.stock_visibility_percentage,100))));
END $f$;
ALTER FUNCTION sa_domain.stock_view_context(bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.stock_view_context(bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.stock_view_context(bigint,bigint) TO sa_executor;
GRANT SELECT(id,user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,product_id,rmp_sku_id) ON sa_snapshot_20261019.sa_stocks TO sa_guard;
GRANT SELECT(stock_id,qty) ON sa_snapshot_20261019.sa_stock_useds TO sa_guard;
CREATE POLICY squad_guard_stock ON sa_snapshot_20261019.sa_stocks FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_stock ON sa_snapshot_20261019.sa_stock_useds FOR SELECT TO sa_guard USING(true);
CREATE INDEX squad_stock_dealer_variant ON sa_snapshot_20261019.sa_stocks(user_id,stock_type,size_id,id);
CREATE INDEX squad_stock_origin ON sa_snapshot_20261019.sa_stocks(user_id,item_id,size_id,id);
CREATE INDEX squad_stock_consumption ON sa_snapshot_20261019.sa_stock_useds(stock_id);

-- Private ledger projection. The calling RPC validates the dealer/customer
-- relationship before this fixed read; commands will reuse the same anomalies.
GRANT SELECT(size_id) ON sa_snapshot_20261019.sa_quantities TO sa_guard;
CREATE FUNCTION sa_domain.stock_balances(p_dealer_id bigint) RETURNS TABLE(
 id bigint,stock_key text,stock_type integer,size_id bigint,product_id bigint,rmp_class_id bigint,rmp_brand_id bigint,rmp_category_id bigint,
 received bigint,consumed bigint,available bigint,needs_reconciliation boolean,receipt_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
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
 OR (s.stock_type=1 AND s.fingerprint IS NULL) OR (s.stock_type=0 AND (s.rmp_class_id IS NULL OR s.rmp_brand_id IS NULL OR s.rmp_category_id IS NULL))),count(*)
 FROM checked s GROUP BY s.key_,s.stock_type,s.size_id,s.rmp_class_id,s.rmp_brand_id,s.rmp_category_id
$f$;
ALTER FUNCTION sa_domain.stock_balances(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.stock_balances(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.stock_balances(bigint) TO sa_executor;

CREATE FUNCTION sa_domain.v1_dealer_stock(p_dealer_id bigint DEFAULT NULL,p_customer_id bigint DEFAULT NULL,p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
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
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.stock_balances((context_->>'dealer_id')::bigint) s
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
ALTER FUNCTION sa_domain.v1_dealer_stock(bigint,bigint,jsonb,text,integer) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_dealer_stock(bigint,bigint,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION sa_domain.v1_dealer_stock(bigint,bigint,jsonb,text,integer) TO sa_app;
CREATE FUNCTION canto_api.v1_dealer_stock(p_dealer_id bigint DEFAULT NULL,p_customer_id bigint DEFAULT NULL,p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_dealer_stock(p_dealer_id,p_customer_id,p_filters,p_cursor,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_dealer_stock(bigint,bigint,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.v1_dealer_stock(bigint,bigint,jsonb,text,integer) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
