BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Report filters are explicit. No caller-provided SQL, arbitrary tables or columns.
CREATE FUNCTION sa_domain.sales_filters(p_filters jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE k text;v jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['status','customer_id','customer_role','zone_id','brand_id','class_id','coordinator_id','order_id','item_id','no_orders','comparison']);
 FOR k,v IN SELECT * FROM jsonb_each(p_filters) LOOP
  IF k IN('customer_id','zone_id','brand_id','class_id','coordinator_id','order_id','item_id') THEN PERFORM sa_domain.input_id(v);
  ELSIF k='customer_role' THEN IF v NOT IN('3'::jsonb,'10'::jsonb) THEN RAISE EXCEPTION 'Choose Customer or Dealer role' USING ERRCODE='22023';END IF;
  ELSIF k='no_orders' THEN IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'no_orders must be boolean' USING ERRCODE='22023';END IF;
  ELSIF k='status' THEN IF jsonb_typeof(v)<>'string' OR v#>>'{}' NOT IN('all','pending','overdue','failed','completed') THEN RAISE EXCEPTION 'Unknown report status' USING ERRCODE='22023';END IF;
  ELSIF k='comparison' THEN IF jsonb_typeof(v)<>'string' OR v#>>'{}' NOT IN('previous_period','weekly','monthly','quarterly','yearly') THEN RAISE EXCEPTION 'Unknown comparison period' USING ERRCODE='22023';END IF;
  END IF;
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.sales_previous_period(p_period jsonb,p_comparison text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 WITH days AS(SELECT(p_period->>'from')::date start_,(p_period->>'before')::date end_),shift AS(SELECT CASE p_comparison WHEN 'weekly' THEN interval '7 days' WHEN 'monthly' THEN interval '1 month' WHEN 'quarterly' THEN interval '3 months' WHEN 'yearly' THEN interval '1 year' ELSE(end_-start_)*interval '1 day' END d,* FROM days)
 SELECT jsonb_build_object('from',(start_-d)::date,'before',(end_-d)::date,'start_utc',((start_-d)::date)::timestamp AT TIME ZONE 'Asia/Kolkata','end_exclusive_utc',((end_-d)::date)::timestamp AT TIME ZONE 'Asia/Kolkata','timezone','Asia/Kolkata') FROM shift
$f$;
CREATE INDEX squad_sales_order_date ON sa_snapshot_20261019.sa_orders((coalesce(created_on,created_at)),id) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
GRANT SELECT(created_by_id,address_id,total_amount,sub_total_amount,branding_amount,cgst_amount,sgst_amount,igst_amount) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT(id,order_id,item_type,rmp_brand_id,rmp_class_id,rmp_category_id,total_quantity,total_amount,branding_amount,per_piece_amount,cgst_amount,sgst_amount,igst_amount,uc_order_status,dispatched_status) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_rmp_classes TO sa_guard;
CREATE POLICY squad_sales_class_guard ON sa_snapshot_20261019.sa_rmp_classes FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.sales_rows(p_start timestamptz,p_end timestamptz,p_filters jsonb)
RETURNS TABLE(item_id bigint,order_id bigint,order_kind integer,item_kind integer,ordered_at timestamp,customer_id bigint,customer_name text,customer_role integer,zone_id bigint,coordinator_id bigint,coordinator_name text,brand_id bigint,brand_name text,class_id bigint,class_name text,quantity bigint,subtotal numeric,branding numeric,tax numeric,closed boolean,order_status integer,provider_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0]);PERFORM sa_domain.sales_filters(p_filters);
 RETURN QUERY SELECT i.id,o.id,o.order_item_type,i.item_type,coalesce(o.created_on,o.created_at),u.id,coalesce(nullif(u.customer_company_name,''),u.name)::text,u.role,u.zone_id,o.customer_sc_id,sc.name::text,i.rmp_brand_id,b.name::text,i.rmp_class_id,cl.name::text,
 i.total_quantity::bigint,i.total_amount,coalesce(i.branding_amount,0),CASE WHEN sa_domain.report_money(i.cgst_amount) IS NOT NULL AND sa_domain.report_money(i.sgst_amount) IS NOT NULL AND sa_domain.report_money(i.igst_amount) IS NOT NULL THEN i.cgst_amount+i.sgst_amount+i.igst_amount END,coalesce(i.uc_order_status IN('COMPLETE','COMPLETED') OR i.dispatched_status=1,false),o.status,o.uc_status::text
 FROM sa_snapshot_20261019.sa_orders o LEFT JOIN sa_snapshot_20261019.sa_items i ON i.order_id=o.id JOIN sa_snapshot_20261019.sa_users u ON u.id=o.customer_id
 LEFT JOIN sa_snapshot_20261019.sa_users sc ON sc.id=o.customer_sc_id LEFT JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=i.rmp_brand_id LEFT JOIN sa_snapshot_20261019.sa_rmp_classes cl ON cl.id=i.rmp_class_id
 WHERE o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND coalesce(o.created_on,o.created_at)>=p_start AT TIME ZONE 'UTC' AND coalesce(o.created_on,o.created_at)<p_end AT TIME ZONE 'UTC'
 AND(NOT p_filters?'customer_id' OR o.customer_id=(p_filters->>'customer_id')::bigint) AND(NOT p_filters?'customer_role' OR u.role=(p_filters->>'customer_role')::int)
 AND(NOT p_filters?'zone_id' OR u.zone_id=(p_filters->>'zone_id')::bigint) AND(NOT p_filters?'coordinator_id' OR o.customer_sc_id=(p_filters->>'coordinator_id')::bigint)
 AND(NOT p_filters?'brand_id' OR i.rmp_brand_id=(p_filters->>'brand_id')::bigint) AND(NOT p_filters?'class_id' OR i.rmp_class_id=(p_filters->>'class_id')::bigint)
 AND(NOT p_filters?'order_id' OR o.id=(p_filters->>'order_id')::bigint) AND(NOT p_filters?'item_id' OR i.id=(p_filters->>'item_id')::bigint)
 AND CASE coalesce(p_filters->>'status','all') WHEN 'pending' THEN o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' WHEN 'overdue' THEN o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.due_on<now() AT TIME ZONE 'UTC' WHEN 'failed' THEN o.uc_status='CANCELLED' WHEN 'completed' THEN o.status=1 AND o.uc_status IS DISTINCT FROM 'CANCELLED' ELSE true END;
END $f$;
ALTER FUNCTION sa_domain.sales_rows(timestamptz,timestamptz,jsonb) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.sales_aggregate(p_kind text,p_period jsonb,p_filters jsonb,p_after bigint,p_limit int) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE r jsonb;previous_ jsonb:=sa_domain.sales_previous_period(p_period,coalesce(p_filters->>'comparison','previous_period'));
BEGIN
 IF p_kind NOT IN('customers','brands','classes','coordinators','unique_customers') THEN RAISE EXCEPTION 'Unknown aggregate report' USING ERRCODE='22023';END IF;
 WITH current_rows AS MATERIALIZED(SELECT * FROM sa_domain.sales_rows((p_period->>'start_utc')::timestamptz,(p_period->>'end_exclusive_utc')::timestamptz,p_filters)),
 previous_rows AS MATERIALIZED(SELECT * FROM sa_domain.sales_rows((previous_->>'start_utc')::timestamptz,(previous_->>'end_exclusive_utc')::timestamptz,p_filters) WHERE p_kind='customers'),
 chosen AS MATERIALIZED(SELECT *,CASE p_kind WHEN 'customers' THEN customer_id WHEN 'brands' THEN brand_id WHEN 'classes' THEN class_id WHEN 'coordinators' THEN coordinator_id END key_,
 CASE p_kind WHEN 'customers' THEN customer_name WHEN 'brands' THEN brand_name WHEN 'classes' THEN class_name WHEN 'coordinators' THEN coordinator_name END label_
 FROM current_rows WHERE p_kind IN('customers','unique_customers') OR(order_kind=0 AND item_kind=1)),
 grouped AS MATERIALIZED(SELECT key_ id,min(label_) name,count(DISTINCT order_id) orders,sum(quantity) quantity,sum(subtotal) subtotal,sum(branding) branding,sum(tax) tax,sum(quantity) FILTER(WHERE closed) closed_quantity,sum(subtotal) FILTER(WHERE closed) closed_subtotal,
 sum(quantity) FILTER(WHERE customer_role=10) dealer_quantity,sum(subtotal) FILTER(WHERE customer_role=10) dealer_subtotal,sum(quantity) FILTER(WHERE customer_role=10 AND closed) dealer_closed_quantity,
 sum(quantity) FILTER(WHERE customer_role<>10) customer_quantity,sum(subtotal) FILTER(WHERE customer_role<>10) customer_subtotal,sum(quantity) FILTER(WHERE customer_role<>10 AND closed) customer_closed_quantity,
 max(ordered_at) last_order_at,bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal::text IN('NaN','Infinity','-Infinity') OR branding<0 OR branding::text IN('NaN','Infinity','-Infinity') OR tax IS NULL OR tax<0 OR tax::text IN('NaN','Infinity','-Infinity')) invalid
 FROM chosen WHERE key_ IS NOT NULL GROUP BY key_),
 previous_totals AS(SELECT customer_id id,sum(quantity) quantity,sum(subtotal) subtotal,bool_or(quantity IS NULL OR quantity<0 OR sa_domain.report_money(subtotal) IS NULL) invalid FROM previous_rows GROUP BY customer_id),
 scan AS MATERIALIZED(SELECT g.*,p.quantity previous_quantity,p.subtotal previous_subtotal,coalesce(p.invalid,false) previous_invalid FROM grouped g LEFT JOIN previous_totals p ON p.id=g.id WHERE g.id<p_after ORDER BY g.id DESC LIMIT p_limit+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT p_limit)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'name',p.name,'orders',p.orders,'quantity',CASE WHEN p.invalid THEN NULL ELSE p.quantity END,'subtotal',CASE WHEN p.invalid THEN NULL ELSE p.subtotal::text END,'tax',CASE WHEN p.invalid THEN NULL ELSE p.tax::text END,'branding',CASE WHEN p.invalid THEN NULL ELSE p.branding::text END,'gross',CASE WHEN p.invalid THEN NULL ELSE(p.subtotal+p.branding+p.tax)::text END,
 'closed_quantity',CASE WHEN NOT p.invalid THEN coalesce(p.closed_quantity,0) END,'closed_subtotal',CASE WHEN NOT p.invalid THEN coalesce(p.closed_subtotal,0)::text END,'fill_rate',CASE WHEN NOT p.invalid THEN round(100.0*coalesce(p.closed_quantity,0)/nullif(p.quantity,0),2)::text END,
 'dealer_quantity',CASE WHEN NOT p.invalid THEN coalesce(p.dealer_quantity,0) END,'dealer_subtotal',CASE WHEN NOT p.invalid THEN coalesce(p.dealer_subtotal,0)::text END,'dealer_closed_quantity',CASE WHEN NOT p.invalid THEN coalesce(p.dealer_closed_quantity,0) END,'dealer_fill_rate',CASE WHEN NOT p.invalid THEN round(100.0*coalesce(p.dealer_closed_quantity,0)/nullif(p.dealer_quantity,0),2)::text END,
 'customer_quantity',CASE WHEN NOT p.invalid THEN coalesce(p.customer_quantity,0) END,'customer_subtotal',CASE WHEN NOT p.invalid THEN coalesce(p.customer_subtotal,0)::text END,'customer_closed_quantity',CASE WHEN NOT p.invalid THEN coalesce(p.customer_closed_quantity,0) END,'customer_fill_rate',CASE WHEN NOT p.invalid THEN round(100.0*coalesce(p.customer_closed_quantity,0)/nullif(p.customer_quantity,0),2)::text END,
 'last_order_at',p.last_order_at AT TIME ZONE 'UTC','needs_reconciliation',coalesce(p.invalid,false))||CASE WHEN p_kind='customers' THEN jsonb_build_object('previous_needs_reconciliation',p.previous_invalid,'previous_quantity',CASE WHEN NOT p.previous_invalid THEN coalesce(p.previous_quantity,0) END,'previous_subtotal',CASE WHEN NOT p.previous_invalid THEN coalesce(p.previous_subtotal,0)::text END,
 'quantity_difference',CASE WHEN NOT p.invalid AND NOT p.previous_invalid THEN p.quantity-coalesce(p.previous_quantity,0) END,'subtotal_difference',CASE WHEN NOT p.invalid AND NOT p.previous_invalid THEN (p.subtotal-coalesce(p.previous_subtotal,0))::text END,'quantity_growth_percent',CASE WHEN NOT p.invalid AND NOT p.previous_invalid THEN round(100.0*(p.quantity-p.previous_quantity)/nullif(p.previous_quantity,0),2)::text END,
 'subtotal_growth_percent',CASE WHEN NOT p.invalid AND NOT p.previous_invalid THEN round(100.0*(p.subtotal-p.previous_subtotal)/nullif(p.previous_subtotal,0),2)::text END,'growth_basis',CASE WHEN coalesce(p.previous_quantity,0)=0 OR coalesce(p.previous_subtotal,0)=0 THEN 'zero_base_percentage_undefined' ELSE 'uncapped_change' END) ELSE '{}'::jsonb END ORDER BY p.id DESC),'[]'),
 'last_id',min(p.id)::text,'has_more',(SELECT count(*) FROM scan)>p_limit,
 'summary',CASE WHEN p_kind='unique_customers' THEN(SELECT jsonb_build_object('total_unique_customers',count(DISTINCT customer_id),'custom_order_customers',count(DISTINCT customer_id) FILTER(WHERE order_kind=1),'rmp_order_customers',count(DISTINCT customer_id) FILTER(WHERE order_kind=0),'mixed_order_customers',count(DISTINCT customer_id) FILTER(WHERE order_kind=2)) FROM current_rows WHERE provider_status IS DISTINCT FROM 'CANCELLED')
 ELSE(SELECT jsonb_build_object('groups',count(*),'quantity',CASE WHEN NOT coalesce(bool_or(invalid),false) THEN coalesce(sum(quantity),0) END,'subtotal',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(subtotal),0)::text END,'branding',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(branding),0)::text END,'tax',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(tax),0)::text END,'closed_quantity',CASE WHEN NOT coalesce(bool_or(invalid),false) THEN coalesce(sum(closed_quantity),0) END,'closed_subtotal',CASE WHEN NOT coalesce(bool_or(invalid),false) THEN coalesce(sum(closed_subtotal),0)::text END,'needs_reconciliation',coalesce(bool_or(invalid),false)) FROM grouped) END,
 'previous_period',CASE WHEN p_kind='customers' THEN previous_ END) INTO r FROM page p;RETURN r;
END $f$;

GRANT SELECT(id,name,email,phone,customer_first_name,customer_last_name,customer_company_name,customer_registered_by,onboarded,approved,gst_no,airtable_id,zone_id,rmp_price_type_id,is_direct_deal,created_by_id) ON sa_snapshot_20261019.sa_users TO sa_guard;
CREATE FUNCTION sa_domain.sales_customer_directory(p_filters jsonb,p_after bigint,p_limit int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0]);PERFORM sa_domain.sales_filters(p_filters);
 WITH scan AS MATERIALIZED(SELECT u.id,u.name,u.email,u.phone,u.customer_first_name,u.customer_last_name,u.customer_company_name,u.customer_registered_by,u.onboarded,u.approved,u.gst_no,u.airtable_id,u.zone_id,u.rmp_price_type_id,u.is_direct_deal,u.created_by_id
 FROM sa_snapshot_20261019.sa_users u WHERE u.role=3 AND u.deleted_at IS NULL AND u.id<p_after
 AND(NOT p_filters?'customer_id' OR u.id=(p_filters->>'customer_id')::bigint) AND(NOT p_filters?'zone_id' OR u.zone_id=(p_filters->>'zone_id')::bigint) AND(NOT p_filters?'coordinator_id' OR u.created_by_id=(p_filters->>'coordinator_id')::bigint)
 AND(NOT coalesce((p_filters->>'no_orders')::boolean,false) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o WHERE o.customer_id=u.id AND o.deleted_at IS NULL AND o.is_deleted IS NOT TRUE)) ORDER BY u.id DESC LIMIT p_limit+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT p_limit),
 addresses AS(SELECT DISTINCT ON(a.user_id) a.user_id,a.address,a.state,a.city,a.zip_code FROM sa_snapshot_20261019.sa_addresses a WHERE a.user_id IN(SELECT id FROM page) AND a.deleted_at IS NULL ORDER BY a.user_id,a.is_primary DESC NULLS LAST,a.id),
 dealers AS(SELECT l.user_id,min(d.id) id,count(*) n FROM sa_snapshot_20261019.sa_user_dealers l JOIN sa_snapshot_20261019.sa_users d ON d.id=l.dealer_id AND d.role=10 AND d.deleted_at IS NULL JOIN page p ON p.id=l.user_id AND p.is_direct_deal IS NOT TRUE GROUP BY l.user_id),
 last_order AS(SELECT o.customer_id,max(coalesce(o.created_on,o.created_at)) at_ FROM sa_snapshot_20261019.sa_orders o WHERE o.customer_id IN(SELECT id FROM page) AND o.deleted_at IS NULL AND o.is_deleted IS NOT TRUE GROUP BY o.customer_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'name',p.name,'email',p.email,'phone',p.phone,'first_name',p.customer_first_name,'last_name',p.customer_last_name,'company_name',p.customer_company_name,'registered_by',p.customer_registered_by,'approved',p.approved,'onboarded',p.onboarded,'gst_no',p.gst_no,'source_record_id',p.airtable_id,
 'coordinator',CASE WHEN sc.id IS NOT NULL THEN jsonb_build_object('id',sc.id::text,'name',sc.name,'email',sc.email) END,'first_dealer',CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id',d.id::text,'name',d.name,'email',d.email) END,'dealer_count',coalesce(ds.n,0),
 'zone',jsonb_build_object('id',z.id::text,'name',z.name),'price_type',jsonb_build_object('id',pt.id::text,'name',pt.name),
 'address',CASE WHEN a.user_id IS NOT NULL THEN jsonb_build_object('address',a.address,'state',a.state,'city',a.city,'zip_code',a.zip_code) END,'last_order_at',lo.at_ AT TIME ZONE 'UTC') ORDER BY p.id DESC),'[]'),
 'has_more',(SELECT count(*) FROM scan)>p_limit,'last_id',min(p.id)::text,'summary',jsonb_build_object('period_applies',false,'address_basis','active_primary_then_first')) INTO r
 FROM page p LEFT JOIN addresses a ON a.user_id=p.id LEFT JOIN dealers ds ON ds.user_id=p.id LEFT JOIN sa_snapshot_20261019.sa_users d ON d.id=ds.id LEFT JOIN sa_snapshot_20261019.sa_users sc ON sc.id=p.created_by_id AND sc.role=1
 LEFT JOIN sa_snapshot_20261019.sa_zones z ON z.id=p.zone_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=p.rmp_price_type_id LEFT JOIN last_order lo ON lo.customer_id=p.id;RETURN r;
END $f$;
ALTER FUNCTION sa_domain.sales_customer_directory(jsonb,bigint,integer) OWNER TO sa_guard;

-- Private admin report joins: one page of items, then batch all child data.
GRANT EXECUTE ON FUNCTION sa_domain.input_id(jsonb) TO sa_guard;
GRANT SELECT(created_at) ON sa_snapshot_20261019.sa_users TO sa_guard;
GRANT SELECT(id,product_id,comment,weight_per_piece,airtable_order_report_id,updated_at) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(due_on,delivered_on,assigned_to_id,total_quantity,criteria_status) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_products,sa_snapshot_20261019.sa_product_parts,sa_snapshot_20261019.sa_product_part_add_ons,
 sa_snapshot_20261019.sa_base_products,sa_snapshot_20261019.sa_fabrics,sa_snapshot_20261019.sa_profit_margins,sa_snapshot_20261019.sa_add_ons,
 sa_snapshot_20261019.sa_rmp_skus,sa_snapshot_20261019.sa_rmp_sizes,sa_snapshot_20261019.sa_rmp_classes,sa_snapshot_20261019.sa_rmp_colors,sa_snapshot_20261019.sa_rmp_categories,
 sa_snapshot_20261019.sa_sizes,sa_snapshot_20261019.sa_ratings TO sa_guard;
GRANT SELECT ON sa_domain.order_receipts TO sa_guard;
CREATE POLICY squad_report_receipt_guard ON sa_domain.order_receipts FOR SELECT TO sa_guard USING(true);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['products','product_parts','product_part_add_ons','base_products','fabrics','profit_margins','add_ons','rmp_skus','rmp_sizes','rmp_classes','rmp_colors','rmp_categories','sizes','ratings'] LOOP
  EXECUTE format('CREATE POLICY squad_sales_guard ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.report_money(p_value numeric) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN p_value>=0 AND p_value::text NOT IN('NaN','Infinity','-Infinity') THEN p_value::text END
$f$;
CREATE FUNCTION sa_domain.sales_item_details(p_kind text,p_period jsonb,p_filters jsonb,p_after bigint,p_limit int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0]);
 WITH scan AS MATERIALIZED(SELECT s.* FROM sa_domain.sales_rows((p_period->>'start_utc')::timestamptz,(p_period->>'end_exclusive_utc')::timestamptz,p_filters) s
 WHERE s.item_id<p_after AND(p_kind='order_items' OR(p_kind='custom_items' AND s.item_kind=0) OR(p_kind='rmp_items' AND s.item_kind=1)) ORDER BY s.item_id DESC LIMIT p_limit+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY item_id DESC LIMIT p_limit),
 items_ AS MATERIALIZED(SELECT i.id,i.product_id,i.comment,i.total_quantity,i.item_type,i.dispatched_status,i.weight_per_piece,i.per_piece_amount,i.rmp_category_id,i.airtable_order_report_id FROM sa_snapshot_20261019.sa_items i WHERE i.id IN(SELECT item_id FROM page)),
 quantity_rows AS MATERIALIZED(SELECT q.item_id,q.id,q.size_id,s.name,q.quantity,row_number() OVER(PARTITION BY q.item_id ORDER BY q.id) pos FROM sa_snapshot_20261019.sa_quantities q LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE q.item_id IN(SELECT item_id FROM page)),
 quantities AS(SELECT item_id,sum(quantity) total,count(*) rows_,bool_or(quantity IS NULL OR quantity<0) invalid,
 jsonb_agg(jsonb_build_object('id',id::text,'size_id',size_id::text,'name',name,'quantity',quantity) ORDER BY id) FILTER(WHERE pos<=100) data FROM quantity_rows GROUP BY item_id),
 sku_candidates AS MATERIALIZED(SELECT q.item_id,q.size_id,k.id,k.name,k.is_deleted,
 row_number() OVER(PARTITION BY q.item_id,q.size_id ORDER BY rs.is_deleted,k.is_deleted,rs.id,k.id) pos,
 count(*) OVER(PARTITION BY q.item_id,q.size_id) candidates FROM(SELECT DISTINCT item_id,size_id,name FROM quantity_rows WHERE quantity>0 AND pos<=100) q
 JOIN page p ON p.item_id=q.item_id AND p.item_kind=1 JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.name=q.name
 JOIN sa_snapshot_20261019.sa_rmp_skus k ON k.rmp_size_id=rs.id AND k.rmp_class_id=p.class_id AND k.rmp_brand_id=p.brand_id),
 skus AS(SELECT item_id,jsonb_agg(jsonb_build_object('size_id',size_id::text,'sku_id',id::text,'name',name,'archived',is_deleted,'candidate_count',candidates) ORDER BY size_id) data FROM sku_candidates WHERE pos=1 GROUP BY item_id),
 products_ AS MATERIALIZED(SELECT p.* FROM sa_snapshot_20261019.sa_products p WHERE p.id IN(SELECT product_id FROM items_)),
 addons AS(SELECT pp.product_id,sum(a.add_on_price) price,sum(a.add_on_of) of_,sum(a.add_on_sn) sn_,count(*) count_,bool_or(a.id IS NULL OR sa_domain.report_money(a.add_on_price) IS NULL OR sa_domain.report_money(a.add_on_of) IS NULL OR sa_domain.report_money(a.add_on_sn) IS NULL) invalid
 FROM sa_snapshot_20261019.sa_product_parts pp JOIN sa_snapshot_20261019.sa_product_part_add_ons l ON l.product_part_id=pp.id LEFT JOIN sa_snapshot_20261019.sa_add_ons a ON a.id=l.add_on_id WHERE pp.product_id IN(SELECT id FROM products_) GROUP BY pp.product_id),
 margins AS(SELECT i.id,min(m.margin_percentage) margin,count(m.id) candidates FROM items_ i LEFT JOIN sa_snapshot_20261019.sa_profit_margins m ON i.total_quantity BETWEEN m.min_range AND m.max_range AND m.is_deleted IS NOT TRUE WHERE i.item_type=0 GROUP BY i.id),
 dispatch AS(SELECT item_id,max(dispatched_at) at_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id IN(SELECT item_id FROM page) GROUP BY item_id),
 feedback AS(SELECT DISTINCT ON(q.rating_on_id) q.rating_on_id,q.id,q.rating,q.positive_comments,q.negative_comments FROM sa_snapshot_20261019.sa_ratings q
 WHERE q.rating_on_type='Order' AND q.rating_on_id IN(SELECT order_id FROM page) AND q.from_role='Customer'
 AND NOT EXISTS(SELECT FROM sa_domain.rating_moderation m WHERE m.rating_id=q.id AND m.generation=(SELECT generation FROM sa_domain.runtime_state)) ORDER BY q.rating_on_id,q.id DESC),
 order_totals AS(SELECT order_id,sum(total_amount+branding_amount+cgst_amount+sgst_amount+igst_amount) line_gross,
 bool_or(sa_domain.report_money(total_amount) IS NULL OR sa_domain.report_money(branding_amount) IS NULL OR sa_domain.report_money(cgst_amount) IS NULL OR sa_domain.report_money(sgst_amount) IS NULL OR sa_domain.report_money(igst_amount) IS NULL) invalid FROM sa_snapshot_20261019.sa_items WHERE order_id IN(SELECT order_id FROM page) GROUP BY order_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object(
 'id',p.item_id::text,'order_id',p.order_id::text,'kind',p.item_kind,'order_kind',p.order_kind,'ordered_at',p.ordered_at AT TIME ZONE 'UTC','due_at',o.due_on AT TIME ZONE 'UTC','delivered_at',o.delivered_on AT TIME ZONE 'UTC','dispatched_at',CASE WHEN i.dispatched_status=1 THEN d.at_ AT TIME ZONE 'UTC' END,
 'status',p.order_status,'provider_status',p.provider_status,'customer',jsonb_build_object('id',p.customer_id::text,'name',p.customer_name,'phone',u.phone,'role',p.customer_role,'price_type',pt.name),'coordinator',jsonb_build_object('id',p.coordinator_id::text,'name',p.coordinator_name),'created_by',jsonb_build_object('id',creator.id::text,'name',creator.name),
 'address',jsonb_build_object('city',addr.city,'state',addr.state),'brand',jsonb_build_object('id',p.brand_id::text,'name',p.brand_name),'class',jsonb_build_object('id',p.class_id::text,'name',p.class_name),'color',col.name,'category',cat.name,
 'quantity',p.quantity,'size_quantity',q.total,'sizes',coalesce(q.data,'[]'),'size_rows',coalesce(q.rows_,0),'sizes_truncated',coalesce(q.rows_>100,false),'quantity_needs_reconciliation',q.rows_ IS NULL OR q.invalid OR q.total IS DISTINCT FROM p.quantity,
 'subtotal',sa_domain.report_money(p.subtotal),'branding',sa_domain.report_money(p.branding),'tax',sa_domain.report_money(p.tax),
 'gross',CASE WHEN sa_domain.report_money(p.subtotal) IS NOT NULL AND sa_domain.report_money(p.branding) IS NOT NULL AND sa_domain.report_money(p.tax) IS NOT NULL THEN(p.subtotal+p.branding+p.tax)::text END,
 'unit_subtotal',CASE WHEN p.quantity>0 AND sa_domain.report_money(p.subtotal) IS NOT NULL THEN round(p.subtotal/p.quantity,6)::text END,'stored_unit_price',sa_domain.report_money(i.per_piece_amount),
 'order_amounts',jsonb_build_object('subtotal',sa_domain.report_money(o.sub_total_amount),'branding',sa_domain.report_money(o.branding_amount),'tax',sa_domain.report_money(o.cgst_amount+o.sgst_amount+o.igst_amount),'gross',sa_domain.report_money(o.total_amount),'line_gross',CASE WHEN NOT ot.invalid THEN sa_domain.report_money(ot.line_gross) END,'difference',CASE WHEN NOT ot.invalid AND sa_domain.report_money(o.total_amount) IS NOT NULL THEN(o.total_amount-ot.line_gross)::text END,'accepted_rounding_adjustment',receipt.rounding_adjustment::text,'basis','order_header_not_additive_per_item'),
 'remark',left(i.comment,4000),'remark_truncated',length(i.comment)>4000,'source_record_id',i.airtable_order_report_id,
 'feedback',CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id::text,'rating',CASE WHEN f.rating BETWEEN 1 AND 5 THEN f.rating::text END,'positive_comments',left(f.positive_comments,2000),'negative_comments',left(f.negative_comments,2000)) END,
 'product',CASE WHEN pr.id IS NOT NULL THEN jsonb_build_object('id',pr.id::text,'name',pr.name,'description',left(pr.comment,4000)) END,
 'current_master_costs',CASE WHEN i.item_type=0 THEN jsonb_build_object('basis','current_masters_not_accepted_historical_cost','base_of',sa_domain.report_money(bp.base_of),'base_sn',sa_domain.report_money(bp.base_sn),'trims',sa_domain.report_money(bp.tims_cost),'overhead_percent',sa_domain.report_money(bp.over_header_percentage),
 'fabric_rate',sa_domain.report_money(fab.price),'fabric_consumption',sa_domain.report_money(i.weight_per_piece),'selected_addon_cost',CASE WHEN NOT coalesce(ad.invalid,false) THEN sa_domain.report_money(coalesce(ad.price,0)) END,'selected_addon_of',CASE WHEN NOT coalesce(ad.invalid,false) THEN sa_domain.report_money(coalesce(ad.of_,0)) END,'selected_addon_sn',CASE WHEN NOT coalesce(ad.invalid,false) THEN sa_domain.report_money(coalesce(ad.sn_,0)) END,
 'margin_percent',CASE WHEN mg.candidates=1 THEN sa_domain.report_money(mg.margin) END,'margin_candidates',mg.candidates,'factory',factory.name) END,
 'sku',CASE WHEN p.item_kind=1 THEN jsonb_build_object('basis','inferred_from_legacy_size_name_not_accepted_variant','data',coalesce(sk.data,'[]')) END
 ) ORDER BY p.item_id DESC),'[]'),'has_more',(SELECT count(*) FROM scan)>p_limit,'last_id',min(p.item_id)::text,'summary',jsonb_build_object('scope','page','amount_basis','stored_item_subtotal_plus_branding_plus_tax','cost_basis','current_masters','size_row_limit_per_item',100)) INTO r
 FROM page p JOIN items_ i ON i.id=p.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=p.order_id JOIN sa_snapshot_20261019.sa_users u ON u.id=p.customer_id
 LEFT JOIN sa_snapshot_20261019.sa_users creator ON creator.id=o.created_by_id LEFT JOIN sa_snapshot_20261019.sa_users fm ON fm.id=o.assigned_to_id LEFT JOIN sa_snapshot_20261019.sa_factories factory ON factory.id=fm.factory_id
 LEFT JOIN sa_snapshot_20261019.sa_addresses addr ON addr.id=o.address_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN sa_snapshot_20261019.sa_rmp_classes cl ON cl.id=p.class_id LEFT JOIN sa_snapshot_20261019.sa_rmp_colors col ON col.id=cl.rmp_color_id LEFT JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=i.rmp_category_id
 LEFT JOIN quantities q ON q.item_id=p.item_id LEFT JOIN skus sk ON sk.item_id=p.item_id LEFT JOIN products_ pr ON pr.id=i.product_id LEFT JOIN sa_snapshot_20261019.sa_base_products bp ON bp.id=pr.base_product_id LEFT JOIN sa_snapshot_20261019.sa_fabrics fab ON fab.id=pr.fabric_id
 LEFT JOIN addons ad ON ad.product_id=pr.id LEFT JOIN margins mg ON mg.id=p.item_id LEFT JOIN dispatch d ON d.item_id=p.item_id LEFT JOIN feedback f ON f.rating_on_id=p.order_id LEFT JOIN order_totals ot ON ot.order_id=p.order_id
 LEFT JOIN sa_domain.order_receipts receipt ON receipt.order_id=p.order_id AND receipt.generation=(SELECT generation FROM sa_domain.runtime_state);
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.sales_item_details(text,jsonb,jsonb,bigint,integer) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.v1_sales_report(p_kind text,p_from date DEFAULT NULL,p_before date DEFAULT NULL,p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit int DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);period_ jsonb:=sa_domain.report_period(p_from,p_before);n int:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('customers','unique_customers','brands','classes','coordinators','customer_directory','order_items','custom_items','rmp_items') THEN RAISE EXCEPTION 'Unknown sales report' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.sales_filters(p_filters);
 IF p_kind='customer_directory' THEN PERFORM sa_domain.check_fields(p_filters,ARRAY['customer_id','zone_id','coordinator_id','no_orders']);
 ELSE
  IF p_filters?'no_orders' OR(p_filters?'comparison' AND p_kind<>'customers') THEN RAISE EXCEPTION 'Filter not applicable to this report' USING ERRCODE='22023';END IF;
 END IF;
 IF p_kind='unique_customers' AND p_cursor IS NOT NULL THEN RAISE EXCEPTION 'Summary report has no pages' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.report_context('sales_report',jsonb_build_object('kind',p_kind,'period',period_,'filters',p_filters));after_:=sa_domain.cursor_id(p_cursor,ctx);
 IF p_kind='customer_directory' THEN r:=sa_domain.sales_customer_directory(p_filters,after_,n);
 ELSIF p_kind IN('order_items','custom_items','rmp_items') THEN r:=sa_domain.sales_item_details(p_kind,period_,p_filters,after_,n);
 ELSE r:=sa_domain.sales_aggregate(p_kind,period_,p_filters,after_,n);END IF;
 RETURN(r-'last_id'-'has_more')||jsonb_build_object('next_cursor',CASE WHEN(r->>'has_more')::boolean THEN sa_domain.next_cursor((r->>'last_id')::bigint,ctx) END,'report',p_kind,'period',period_,'as_of',now(),
 'basis',jsonb_build_object('order_date','created_on_fallback_created_at_UTC','customer_attribution','stored_order_customer_sc_id','rmp_aggregate','pure_ready_made_orders','closed_item','provider_complete_or_completed_or_dispatched','status','cancelled_separate_from_completed','pagination','id_descending_revision_bound'));
END $f$;

CREATE FUNCTION sa_domain.sales_coordinator_data(p_subject_id bigint,p_period jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2]);r jsonb;
BEGIN
 IF a.role_id=1 AND p_subject_id<>a.user_id THEN RAISE EXCEPTION 'Only your coordinator metrics are available' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_subject_id AND role=1 AND deleted_at IS NULL AND disabled IS NOT TRUE) THEN RAISE EXCEPTION 'Coordinator unavailable' USING ERRCODE='P0002';END IF;
 WITH orders_ AS MATERIALIZED(SELECT o.id,o.customer_id,o.status,o.uc_status,o.created_on,o.created_at,o.due_on,o.criteria_status,o.total_amount FROM sa_snapshot_20261019.sa_orders o WHERE o.customer_sc_id=p_subject_id AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL
 AND(a.role_id<>2 OR o.id IN(SELECT sa_domain.scope_order_ids()))),
 cohort AS MATERIALIZED(SELECT * FROM orders_ WHERE coalesce(created_on,created_at)>=(p_period->>'start_utc')::timestamptz AT TIME ZONE 'UTC' AND coalesce(created_on,created_at)<(p_period->>'end_exclusive_utc')::timestamptz AT TIME ZONE 'UTC'),
 customers AS(SELECT u.id,u.role,u.approved,u.onboarded,u.created_at FROM sa_snapshot_20261019.sa_users u WHERE u.created_by_id=p_subject_id AND u.role IN(3,10) AND u.deleted_at IS NULL AND(a.role_id<>2 OR u.role=3)),
 feedback AS(SELECT q.rating FROM sa_snapshot_20261019.sa_ratings q WHERE q.to_id=p_subject_id AND q.to_role='SalesCoordinator' AND q.from_role='Customer' AND q.rating_on_type='Order' AND q.rating_on_id IN(SELECT id FROM orders_) AND q.created_at>=(p_period->>'start_utc')::timestamptz AT TIME ZONE 'UTC' AND q.created_at<(p_period->>'end_exclusive_utc')::timestamptz AT TIME ZONE 'UTC' AND NOT EXISTS(SELECT FROM sa_domain.rating_moderation m WHERE m.rating_id=q.id AND m.generation=(SELECT generation FROM sa_domain.runtime_state)))
 SELECT jsonb_build_object('subject_id',p_subject_id::text,'customers',(SELECT jsonb_build_object('current',count(*) FILTER(WHERE role=3),'dealers',CASE WHEN a.role_id<>2 THEN count(*) FILTER(WHERE role=10) END,'pending_approval',count(*) FILTER(WHERE approved IS NOT TRUE),'pending_onboarding',count(*) FILTER(WHERE onboarded IS NOT TRUE),'new_in_period',count(*) FILTER(WHERE created_at>=(p_period->>'start_utc')::timestamptz AT TIME ZONE 'UTC' AND created_at<(p_period->>'end_exclusive_utc')::timestamptz AT TIME ZONE 'UTC')) FROM customers),
 'orders',(SELECT jsonb_build_object('total',count(*),'completed',count(*) FILTER(WHERE status=1 AND uc_status IS DISTINCT FROM 'CANCELLED'),'cancelled',count(*) FILTER(WHERE uc_status='CANCELLED'),'pending',count(*) FILTER(WHERE status=0 AND uc_status IS DISTINCT FROM 'CANCELLED'),'unique_customers',count(DISTINCT customer_id) FILTER(WHERE uc_status IS DISTINCT FROM 'CANCELLED')) FROM cohort),
 'backlog',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status=0 AND uc_status IS DISTINCT FROM 'CANCELLED'),'pending_criteria',count(*) FILTER(WHERE status=0 AND criteria_status=0 AND uc_status IS DISTINCT FROM 'CANCELLED'),'overdue',count(*) FILTER(WHERE status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND due_on<now() AT TIME ZONE 'UTC'),'critical',count(*) FILTER(WHERE status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND due_on>=now() AT TIME ZONE 'UTC' AND due_on<(now()+interval '3 days') AT TIME ZONE 'UTC')) FROM orders_),
 'feedback',(SELECT jsonb_build_object('count',count(*),'average',round(avg(rating) FILTER(WHERE rating BETWEEN 1 AND 5),2)::text,'invalid_source_count',count(*) FILTER(WHERE rating IS NULL OR NOT rating BETWEEN 1 AND 5)) FROM feedback),
 'basis',jsonb_build_object('customers','current_assigned_roster','orders','order_creation_cohort','backlog','current_all_dates','completed','cancelled_excluded','amount','stored_order_gross_cancelled_excluded','critical','upcoming_3_days_excludes_overdue'))||CASE WHEN a.role_id<>2 THEN
 jsonb_build_object('sales',(SELECT jsonb_build_object('placed',CASE WHEN bool_or(sa_domain.report_money(total_amount) IS NULL) THEN NULL ELSE coalesce(sum(total_amount),0)::text END,'completed',CASE WHEN bool_or(sa_domain.report_money(total_amount) IS NULL) FILTER(WHERE status=1) THEN NULL ELSE coalesce(sum(total_amount) FILTER(WHERE status=1),0)::text END,'needs_reconciliation',coalesce(bool_or(sa_domain.report_money(total_amount) IS NULL),false)) FROM cohort WHERE uc_status IS DISTINCT FROM 'CANCELLED')) ELSE '{}'::jsonb END INTO r;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.sales_coordinator_data(bigint,jsonb) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.v1_sales_coordinator_metrics(p_subject_id bigint DEFAULT NULL,p_from date DEFAULT NULL,p_before date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2]);subject_ bigint:=coalesce(p_subject_id,CASE WHEN a.role_id=1 THEN a.user_id END);period_ jsonb:=sa_domain.report_period(p_from,p_before);r jsonb;
BEGIN
 IF subject_ IS NULL THEN RAISE EXCEPTION 'Choose a coordinator' USING ERRCODE='22023';END IF;
 r:=sa_domain.sales_coordinator_data(subject_,period_);
 IF a.role_id<>2 THEN r:=r||jsonb_build_object('targets',sa_domain.v1_milestones_list(subject_,NULL,10),'target_basis','existing_milestone_created_at_calendar_contract');END IF;
 RETURN r||jsonb_build_object('period',period_,'as_of',now());
END $f$;

DO $f$ DECLARE p record;call_ text;BEGIN
 FOR p IN SELECT pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args,pr.provolatile FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY[
 'sales_filters','sales_previous_period','sales_rows','sales_aggregate','sales_customer_directory','report_money','sales_item_details','sales_coordinator_data','v1_sales_report','v1_sales_coordinator_metrics']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor,sa_guard',p.proname,p.args);
  IF p.proname LIKE 'v1_%' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s),' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
