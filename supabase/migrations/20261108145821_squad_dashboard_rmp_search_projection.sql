-- Keep optimized RMP free-text search identical to the returned JSON scalars.
-- SQL concat uses t/f and spaces for timestamps; JSON uses true/false and T.
-- Boolean substring searches must include actual SKU ambiguity/mapping flags.
CREATE OR REPLACE FUNCTION sa_domain.dashboard_rmp_query(p_filters jsonb,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan SET work_mem='32MB' AS $f$
DECLARE r jsonb;need_skus_ boolean;sort_ text:=coalesce(p_query#>>'{sort,key}','id');direction_ text:=coalesce(p_query#>>'{sort,direction}','desc');
 numeric_ boolean:=coalesce((p_query#>>'{sort,numeric}')::boolean,sort_='id');n int:=coalesce((p_query->>'items')::int,20);page_ int:=coalesce((p_query->>'page')::int,1);
BEGIN
 need_skus_:=sort_ IN('rmp_sku_id','rmp_sku_name','sku_ambiguous','sku_unmapped')
  OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(p_query#>'{filters,conditions}','[]')||coalesce(p_query#>'{quick,conditions}','[]')) c WHERE c->>'field' IN('rmp_sku_id','rmp_sku_name','sku_ambiguous','sku_unmapped'))
  OR jsonb_array_length(coalesce(p_query->'option_fields','[]'))>0
  OR coalesce(p_query->>'search','')<>'' AND(strpos('true',lower(p_query->>'search'))>0 OR strpos('false',lower(p_query->>'search'))>0 OR strpos(p_query->>'search',',')>0 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus WHERE strpos(lower(name),lower(p_query->>'search'))>0 OR strpos(id::text,p_query->>'search')>0));
 WITH facts AS MATERIALIZED(SELECT item_id,order_id,ordered_at,customer_id,customer_name,coordinator_name,quantity,subtotal,branding,tax,brand_id,class_id
  FROM sa_domain.sales_rows(coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),coalesce(p_filters->'domain','{}'))
  WHERE item_kind=1 AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   AND(NOT p_filters?'ids' OR item_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))))),
 sku_map AS MATERIALIZED(SELECT k.rmp_brand_id brand_id,k.rmp_class_id class_id,rs.name size_name,
  string_agg(DISTINCT k.id::text,', ' ORDER BY k.id::text) ids,string_agg(DISTINCT k.name,', ' ORDER BY k.name) names,count(*) candidates
  FROM sa_snapshot_20261019.sa_rmp_skus k JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.id=k.rmp_size_id GROUP BY k.rmp_brand_id,k.rmp_class_id,rs.name),
 skus AS(SELECT f.item_id,string_agg(DISTINCT m.ids,', ' ORDER BY m.ids) ids,string_agg(DISTINCT m.names,', ' ORDER BY m.names) names,
  bool_or(m.candidates>1) ambiguous,bool_or(m.ids IS NULL) unmapped FROM facts f
  LEFT JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=f.item_id AND q.quantity>0
  LEFT JOIN sa_snapshot_20261019.sa_sizes z ON z.id=q.size_id
  LEFT JOIN sku_map m ON m.brand_id=f.brand_id AND m.class_id=f.class_id AND m.size_name=z.name WHERE need_skus_ GROUP BY f.item_id),
 dispatch AS(SELECT item_id,max(dispatched_at) at_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id IN(SELECT item_id FROM facts) GROUP BY item_id)
, flat AS MATERIALIZED(SELECT CAST(f.item_id AS text) AS "id",'OD-' || prefix_ || f.order_id AS "order_id",'OD-' || prefix_ || f.order_id AS "order_number",CAST(f.customer_id AS text) AS "customer_id",prefix_ || f.customer_id AS "customer_code",f.customer_name AS "customer_name",pt.name AS "customer_type",pg_catalog.timezone('UTC', f.ordered_at) AS "order_date",f.quantity AS "quantity",f.quantity AS "total_quantity",
 CASE
 WHEN f.quantity > 0 THEN sa_domain.report_money(f.subtotal / f.quantity) END AS "price",
 CASE
 WHEN sa_domain.report_money(f.subtotal) IS NOT NULL AND sa_domain.report_money(f.branding) IS NOT NULL AND f.tax IS NOT NULL THEN CAST(f.subtotal + f.branding + f.tax AS text) END AS "total_amount",
 CASE
 WHEN o.uc_status = 'CANCELLED' THEN 'CANCELLED'
 WHEN o.status = 1 THEN 'COMPLETED' ELSE 'PENDING' END AS "order_status",f.coordinator_name AS "sales_coordinator",
 CASE
 WHEN NOT(k.ambiguous OR k.unmapped) THEN k.ids END AS "rmp_sku_id",
 CASE
 WHEN NOT(k.ambiguous OR k.unmapped) THEN k.names END AS "rmp_sku_name",COALESCE(k.ambiguous, FALSE) AS "sku_ambiguous",COALESCE(k.unmapped, TRUE) AS "sku_unmapped",
 CASE
 WHEN i.dispatched_status = 1 THEN pg_catalog.timezone('UTC', d.at_) END AS "dispatch_date",pg_catalog.timezone('UTC', o.due_on) AS "delivery_required_on",pg_catalog.timezone('UTC', o.due_on) AS "expected_delivery_date",
 CASE
 WHEN i.dispatched_status = 1 THEN pg_catalog.timezone('UTC', d.at_) END AS "actual_delivery_date",pg_catalog.timezone('UTC', i.created_at) AS "created_at",pg_catalog.timezone('UTC', i.updated_at) AS "updated_at",'stored_item_gross_exact_decimal' AS "basis"
 FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=f.order_id
 JOIN sa_snapshot_20261019.sa_users u ON u.id=f.customer_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN skus k ON k.item_id=f.item_id LEFT JOIN dispatch d ON d.item_id=f.item_id
 CROSS JOIN(SELECT CASE environment
 WHEN 'production' THEN 'P-' ELSE 'S-' END prefix_ FROM sa_sync.environment_state) env),
 filtered AS MATERIALIZED(SELECT * FROM flat WHERE
 (coalesce(jsonb_array_length(p_query#>'{filters,conditions}'),0)=0 OR sa_domain.dashboard_match(to_jsonb(flat),p_query->'filters'))
 AND(coalesce(jsonb_array_length(p_query#>'{quick,conditions}'),0)=0 OR sa_domain.dashboard_match(to_jsonb(flat),p_query->'quick'))
 AND(coalesce(p_query->>'search','')='' OR strpos(lower(concat_ws(chr(10),"id","order_id","order_number","customer_id","customer_code","customer_name","customer_type",(to_jsonb("order_date") #>> '{}'),"quantity","total_quantity","price","total_amount","order_status","sales_coordinator","rmp_sku_id","rmp_sku_name","sku_ambiguous"::text,"sku_unmapped"::text,(to_jsonb("dispatch_date") #>> '{}'),(to_jsonb("delivery_required_on") #>> '{}'),(to_jsonb("expected_delivery_date") #>> '{}'),(to_jsonb("actual_delivery_date") #>> '{}'),(to_jsonb("created_at") #>> '{}'),(to_jsonb("updated_at") #>> '{}'),"basis")),lower(p_query->>'search'))>0)),
 page AS(SELECT * FROM filtered ORDER BY
 CASE
 WHEN direction_='asc' AND numeric_ THEN sa_domain.dashboard_number(CASE sort_
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END ASC NULLS LAST,
 CASE
 WHEN direction_='desc' AND numeric_ THEN sa_domain.dashboard_number(CASE sort_
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END DESC NULLS LAST,
 CASE
 WHEN direction_='asc' AND NOT numeric_ THEN lower(CASE sort_
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END ASC NULLS LAST,
 CASE
 WHEN direction_='desc' AND NOT numeric_ THEN lower(CASE sort_
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END DESC NULLS LAST,id::bigint DESC LIMIT n OFFSET(page_-1)*n),
 stats AS(SELECT count(*) count_,sum(quantity) qty,sum(total_amount::numeric) amount,bool_or(total_amount IS NULL OR quantity IS NULL OR quantity<0) invalid,bool_or(quantity IS NULL OR quantity<0) invalid_qty FROM filtered),
 options AS(SELECT k,jsonb_agg(v ORDER BY v) values_ FROM(SELECT DISTINCT k,
 CASE k
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END v FROM flat CROSS JOIN jsonb_array_elements_text(coalesce(p_query->'option_fields','[]')) k) x WHERE v IS NOT NULL AND v<>'' GROUP BY k)
 SELECT jsonb_build_object('data',coalesce((SELECT jsonb_agg(v ORDER BY p.position) FROM sa_domain.dashboard_rmp_rows(p_filters||jsonb_build_object('ids',(SELECT coalesce(jsonb_agg(id),'[]') FROM page))) v JOIN(SELECT id,row_number() OVER() position FROM page) p ON p.id=v->>'id'),'[]'),
 'totalCount',count_,'totalPages',greatest(1,ceil(count_::numeric/n)),'page',page_,'pageSize',n,'totalCountIsExact',true,
 'summary',jsonb_build_object('count',count_,'sums',jsonb_build_object('quantity',
 CASE
 WHEN NOT coalesce(invalid_qty,false) THEN coalesce(qty,0)::text END,'total_quantity',
 CASE
 WHEN NOT coalesce(invalid_qty,false) THEN coalesce(qty,0)::text END,'total_amount',
 CASE
 WHEN NOT coalesce(invalid,false) THEN coalesce(amount,0)::text END)),
 'options',coalesce((SELECT jsonb_object_agg(k,values_) FROM options),'{}')) INTO r FROM stats;
 RETURN r;
END $f$;
