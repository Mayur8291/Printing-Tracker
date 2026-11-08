-- Preserve the existing RMP Overview Customer Type Sales cards.
-- Both default and filtered paths group the complete result before pagination.
-- Unknown amounts/quantities remain null; missing price types form an Unknown group.
CREATE OR REPLACE FUNCTION sa_domain.dashboard_fast_result(p_report text,p_tab text,p_filters jsonb,p_page integer,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan SET work_mem='32MB' AS $f$
DECLARE result_ jsonb;ids_ jsonb;summary_ jsonb;total_ bigint;data_ jsonb;start_ timestamptz;end_ timestamptz;
BEGIN
 IF p_report='customers' THEN
  SELECT count(*) INTO total_ FROM sa_snapshot_20261019.sa_users WHERE role=3 AND deleted_at IS NULL AND(NOT p_filters?'zone_id' OR zone_id=(p_filters->>'zone_id')::bigint);
  SELECT coalesce(jsonb_agg(sa_domain.dashboard_customer(id) ORDER BY id DESC),'[]') INTO data_ FROM(
   SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=3 AND deleted_at IS NULL AND(NOT p_filters?'zone_id' OR zone_id=(p_filters->>'zone_id')::bigint) ORDER BY id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit) page;
  summary_:=jsonb_build_object('count',total_,'sums','{}');
 ELSIF p_report='rmp_sales' AND p_tab IN('brand','class','coordinator') THEN
  result_:=sa_domain.sales_aggregate(CASE p_tab WHEN 'brand' THEN 'brands' WHEN 'class' THEN 'classes' ELSE 'coordinators' END,
   sa_domain.report_period((p_filters->>'from')::date,(p_filters->>'before')::date),coalesce(p_filters->'domain','{}'),9223372036854775807,least(p_page*p_limit,100000));
  total_:=(result_#>>'{summary,groups}')::bigint;
  SELECT coalesce(jsonb_agg(sa_domain.dashboard_breakdown_row(v,p_filters) ORDER BY ord),'[]') INTO data_
   FROM jsonb_array_elements(result_->'data') WITH ORDINALITY x(v,ord) WHERE ord>(p_page-1)*p_limit;
  summary_:=jsonb_build_object('count',total_,'sums',jsonb_build_object('item_qty',result_#>>'{summary,quantity}','ordered_qty',result_#>>'{summary,quantity}',
   'order_value',result_#>>'{summary,subtotal}','closed_ordered_qty',result_#>>'{summary,closed_quantity}'));
 ELSIF p_report IN('order_reports','rmp_order_reports') THEN
  start_:=coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz);
  end_:=coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz);
  IF p_report='rmp_order_reports' AND coalesce(p_filters#>>'{domain,status}','all')<>'overdue' THEN
   SELECT total_count,summary INTO total_,summary_ FROM sa_domain.dashboard_summaries
   WHERE revision=(SELECT generation::text||':'||edit_revision::text FROM sa_domain.runtime_state CROSS JOIN sa_sync.environment_state)
   AND filter_key=md5(p_filters::text) AND created_at>now()-interval '5 minutes';
  END IF;
  IF summary_ IS NULL THEN
  WITH stats AS(SELECT count(*) n,sum(quantity) qty,
   sum(CASE WHEN p_report='order_reports' THEN coalesce((SELECT sum(q.quantity) FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=sales_rows.item_id),0) ELSE quantity END) total_qty,sum(subtotal+branding+tax) gross,
   bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric OR branding IS NULL OR branding<0 OR branding>='Infinity'::numeric OR tax IS NULL) invalid
   FROM sa_domain.sales_rows(start_,end_,coalesce(p_filters->'domain','{}'))
   WHERE item_kind=CASE p_report WHEN 'order_reports' THEN 0 ELSE 1 END AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint))
  SELECT n,jsonb_build_object('count',n,'sums',jsonb_build_object('quantity',coalesce(qty,0)::text,'total_quantity',coalesce(total_qty,0)::text,
   'total_amount',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(gross,0)::text END)) INTO total_,summary_ FROM stats;
  END IF;
  SELECT coalesce(jsonb_agg(item_id::text ORDER BY item_id DESC),'[]') INTO ids_ FROM(
   SELECT item_id FROM sa_domain.sales_rows(start_,end_,coalesce(p_filters->'domain','{}'))
   WHERE item_kind=CASE p_report WHEN 'order_reports' THEN 0 ELSE 1 END AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   ORDER BY item_id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit) page;
  SELECT coalesce(jsonb_agg(v ORDER BY(v->>'id')::bigint DESC),'[]') INTO data_ FROM sa_domain.dashboard_item_rows(p_report,p_filters||jsonb_build_object('ids',ids_)) v;
 ELSIF p_report='tailor_reports' THEN
  WITH facts AS MATERIALIZED(SELECT f.item_id,f.quantity FROM sa_domain.sales_rows(
   coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),coalesce(p_filters->'domain','{}')) f
   WHERE EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d WHERE d.item_id=f.item_id)
   AND(NOT p_filters?'id' OR f.item_id=(p_filters->>'id')::bigint)),
  page AS(SELECT item_id FROM facts ORDER BY item_id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit),
  completed AS(SELECT d.item_id,sum(mq.completed_quantity) qty FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d
   JOIN sa_snapshot_20261019.sa_job_sheet_mark_tailors m ON m.job_sheet_tailor_mark_date_id=d.id
   JOIN sa_snapshot_20261019.sa_mark_tailor_quantities mq ON mq.job_sheet_mark_tailor_id=m.id
   JOIN sa_snapshot_20261019.sa_item_tailor_quantities iq ON iq.id=mq.item_tailor_quantity_id
   JOIN sa_snapshot_20261019.sa_quantities q ON q.id=iq.quantity_id JOIN sa_snapshot_20261019.sa_sizes z ON z.id=q.size_id
   WHERE d.item_id IN(SELECT item_id FROM facts) GROUP BY d.item_id),
  addons AS(SELECT pp.product_id,sum(a.add_on_of) of_,sum(a.add_on_sn) sn_ FROM sa_snapshot_20261019.sa_product_parts pp
   JOIN sa_snapshot_20261019.sa_product_part_add_ons pa ON pa.product_part_id=pp.id JOIN sa_snapshot_20261019.sa_add_ons a ON a.id=pa.add_on_id GROUP BY pp.product_id),
  values_ AS(SELECT f.quantity,coalesce(c.qty,0) completed,coalesce(c.qty,0)*(bp.base_of+bp.base_sn+coalesce(a.of_,0)+coalesce(a.sn_,0)) amount
   FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id LEFT JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id
   LEFT JOIN sa_snapshot_20261019.sa_base_products bp ON bp.id=p.base_product_id LEFT JOIN addons a ON a.product_id=p.id LEFT JOIN completed c ON c.item_id=i.id)
  SELECT count(*),(SELECT coalesce(jsonb_agg(item_id::text ORDER BY item_id DESC),'[]') FROM page),jsonb_build_object('count',count(*),'sums',jsonb_build_object(
   'quantity',coalesce(sum(quantity),0)::text,'total_quantity',coalesce(sum(completed),0)::text,
   'total_amount',CASE WHEN NOT coalesce(bool_or(sa_domain.report_money(amount) IS NULL),false) THEN coalesce(sum(amount),0)::text END)) INTO total_,ids_,summary_ FROM values_;
  SELECT coalesce(jsonb_agg(v ORDER BY(v->>'id')::bigint DESC),'[]') INTO data_ FROM sa_domain.dashboard_item_rows(p_report,p_filters||jsonb_build_object('ids',ids_)) v;
 ELSIF p_report='customer_performance' THEN
  PERFORM sa_domain.report_period((p_filters->>'from')::date,(p_filters->>'before')::date);
  PERFORM sa_domain.report_period((p_filters->>'from_b')::date,(p_filters->>'before_b')::date);
  WITH a AS(SELECT customer_id,sum(quantity) qty,sum(subtotal) val,bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric) invalid
   FROM sa_domain.sales_rows((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata',(p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata',coalesce(p_filters->'domain','{}')) GROUP BY customer_id),
  b AS(SELECT customer_id,sum(quantity) qty,sum(subtotal) val,bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric) invalid
   FROM sa_domain.sales_rows((p_filters->>'from_b')::date::timestamp AT TIME ZONE 'Asia/Kolkata',(p_filters->>'before_b')::date::timestamp AT TIME ZONE 'Asia/Kolkata',coalesce(p_filters->'domain','{}')) GROUP BY customer_id),
  rows AS MATERIALIZED(SELECT u.id,coalesce(a.qty,0) qa,coalesce(a.val,0) va,coalesce(b.qty,0) qb,coalesce(b.val,0) vb,coalesce(a.invalid,false) ia,coalesce(b.invalid,false) ib
   FROM sa_snapshot_20261019.sa_users u LEFT JOIN a ON a.customer_id=u.id LEFT JOIN b ON b.customer_id=u.id WHERE u.role=3 AND u.deleted_at IS NULL
   AND CASE coalesce(p_filters->>'history','all') WHEN 'has_orders' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_id=u.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE)
   WHEN 'no_orders_yet' THEN NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_id=u.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE) ELSE true END),
  page AS(SELECT * FROM rows ORDER BY id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit),
  projected AS(SELECT jsonb_build_object('id',r.id::text,'customer_id',r.id::text,'customer_name',coalesce(nullif(u.customer_company_name,''),u.name),
   'customer_type',pt.name,'zone',z.name,'last_purchased_date',l.at_ AT TIME ZONE 'UTC',
   'qtyA',CASE WHEN NOT ia THEN qa END,'valueA',CASE WHEN NOT ia THEN va::text END,
   'qtyB',CASE WHEN NOT ib THEN qb END,'valueB',CASE WHEN NOT ib THEN vb::text END,
   'qtyChange',CASE WHEN NOT(ia OR ib) THEN qb-qa END,'valueChange',CASE WHEN NOT(ia OR ib) THEN(vb-va)::text END,
   'qtyChangePct',CASE WHEN NOT(ia OR ib) THEN round(100.0*(qb-qa)/nullif(qa,0),2) END,
   'valueChangePct',CASE WHEN NOT(ia OR ib) THEN round(100.0*(vb-va)/nullif(va,0),2) END,
   'needs_reconciliation',ia OR ib) v,r.id FROM page r JOIN sa_snapshot_20261019.sa_users u ON u.id=r.id
   LEFT JOIN sa_snapshot_20261019.sa_zones z ON z.id=u.zone_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
   LEFT JOIN LATERAL(SELECT max(coalesce(created_on,created_at)) at_ FROM sa_snapshot_20261019.sa_orders
    WHERE customer_id=r.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE) l ON true)
  SELECT count(*),(SELECT coalesce(jsonb_agg(v ORDER BY id DESC),'[]') FROM projected),jsonb_build_object('count',count(*),'sums',jsonb_build_object(
   'qtyA',CASE WHEN NOT coalesce(bool_or(ia),false) THEN coalesce(sum(qa),0)::text END,'valueA',CASE WHEN NOT coalesce(bool_or(ia),false) THEN coalesce(sum(va),0)::text END,
   'qtyB',CASE WHEN NOT coalesce(bool_or(ib),false) THEN coalesce(sum(qb),0)::text END,'valueB',CASE WHEN NOT coalesce(bool_or(ib),false) THEN coalesce(sum(vb),0)::text END))
   INTO total_,data_,summary_ FROM rows;
 ELSIF p_report IN('order_reports','rmp_order_reports','order_tracking') OR p_report='rmp_sales' AND p_tab IN('','overview') THEN
  start_:=coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz);
  end_:=coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz);
  WITH facts AS MATERIALIZED(SELECT item_id,order_id,customer_id,quantity,subtotal,branding,tax,closed FROM sa_domain.sales_rows(start_,end_,coalesce(p_filters->'domain','{}')) f
   WHERE CASE p_report WHEN 'order_reports' THEN item_kind=0 WHEN 'rmp_order_reports' THEN item_kind=1 WHEN 'rmp_sales' THEN order_kind=0 AND item_kind=1 ELSE true END
   AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   AND(coalesce(jsonb_array_length(p_filters->'customer_ids'),0)=0 OR customer_id::text IN(SELECT jsonb_array_elements_text(p_filters->'customer_ids')))
   AND(NOT coalesce((p_filters->>'oos')::boolean,false) OR provider_status IN('OOS','OUT_OF_STOCK'))),
  keys_ AS(SELECT item_id id FROM facts WHERE p_report IN('order_reports','rmp_order_reports') UNION ALL SELECT DISTINCT order_id FROM facts WHERE p_report IN('order_tracking','rmp_sales')),
  page AS(SELECT id FROM keys_ ORDER BY id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit),
  stats AS(SELECT count(*) n,sum(quantity) qty,sum(quantity) FILTER(WHERE closed) closed_qty,
   sum(subtotal) subtotal,sum(subtotal+branding+tax) gross,
   bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric) invalid,
   bool_or(branding IS NULL OR branding<0 OR branding>='Infinity'::numeric OR tax IS NULL OR tax<0 OR tax>='Infinity'::numeric) invalid_tax FROM facts),
  customer_types AS(
   SELECT coalesce(nullif(btrim(pt.name),''),'Unknown') type,
    CASE WHEN NOT bool_or(f.quantity IS NULL OR f.quantity<0 OR sa_domain.report_money(f.subtotal) IS NULL) THEN sum(f.quantity)::text END qty,
    CASE WHEN NOT bool_or(f.quantity IS NULL OR f.quantity<0 OR sa_domain.report_money(f.subtotal) IS NULL) THEN sum(f.subtotal)::text END amount
   FROM facts f JOIN sa_snapshot_20261019.sa_users u ON u.id=f.customer_id
   LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
   WHERE p_report='rmp_sales' GROUP BY coalesce(nullif(btrim(pt.name),''),'Unknown'))
  SELECT CASE WHEN p_report IN('order_tracking','rmp_sales') THEN (SELECT count(*) FROM keys_) ELSE n END,(SELECT coalesce(jsonb_agg(id::text ORDER BY id DESC),'[]') FROM page),
   jsonb_build_object('count',CASE WHEN p_report IN('order_tracking','rmp_sales') THEN (SELECT count(*) FROM keys_) ELSE n END,'sums',jsonb_build_object(
    'quantity',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(qty,0)::text END,
    'total_quantity',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(qty,0)::text END,
    'total_qty',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(qty,0)::text END,
    'closed_qty',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(closed_qty,0)::text END,
    'total_amount',CASE WHEN NOT coalesce(invalid,false) THEN CASE WHEN p_report IN('order_tracking','rmp_sales') THEN coalesce(subtotal,0)::text WHEN NOT coalesce(invalid_tax,false) THEN coalesce(gross,0)::text END END))
   ||CASE WHEN p_report='rmp_sales' THEN jsonb_build_object('customerTypeBreakdown',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('type',type,'qty',qty,'amount',amount) ORDER BY type),'[]') FROM customer_types)) ELSE '{}'::jsonb END
   INTO total_,ids_,summary_ FROM stats;
  SELECT coalesce(jsonb_agg(v ORDER BY(v->>'id')::bigint DESC),'[]') INTO data_ FROM sa_domain.dashboard_rows(p_report,p_tab,p_filters||jsonb_build_object('ids',ids_)) v;
 ELSE RETURN NULL;END IF;
 RETURN jsonb_build_object('data',data_,'totalCount',total_,'totalPages',greatest(1,ceil(total_::numeric/p_limit)),'page',p_page,'pageSize',p_limit,'totalCountIsExact',true,'summary',summary_,'options','{}');
END $f$;

CREATE OR REPLACE FUNCTION sa_domain.dashboard_query(p_report text,p_tab text,p_filters jsonb,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan AS $f$
DECLARE r jsonb;revision_ text;n int:=coalesce((p_query->>'items')::int,20);page_ int:=coalesce((p_query->>'page')::int,1);
 sort_ text:=coalesce(nullif(p_query#>>'{sort,key}',''),'id');direction_ text:=coalesce(p_query#>>'{sort,direction}','desc');
 numeric_ boolean:=coalesce((p_query#>>'{sort,numeric}')::boolean,sort_='id');sums_ jsonb;counts_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_query,ARRAY['page','items','search','filters','quick','sort','option_fields','revision']);
 PERFORM sa_domain.check_fields(p_filters,ARRAY['from','before','from_b','before_b','domain','id','ids','history','oos','customer_ids','zone_id']);
 IF p_filters?'domain' THEN
  PERFORM sa_domain.check_fields(p_filters->'domain',ARRAY['status','customer_id','customer_role','zone_id','coordinator_id','brand_id','class_id','order_id','item_id']);
  IF p_filters#>>'{domain,status}' NOT IN('all','pending','overdue','failed','completed') THEN RAISE EXCEPTION 'Invalid report status' USING ERRCODE='22023';END IF;
 END IF;
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 IF n NOT BETWEEN 1 AND 500 OR page_ NOT BETWEEN 1 AND 100000 OR direction_ NOT IN('asc','desc') OR length(coalesce(p_query->>'search',''))>200 THEN RAISE EXCEPTION 'Invalid dashboard query' USING ERRCODE='22023';END IF;
 SELECT generation::text||':'||edit_revision::text INTO revision_ FROM sa_domain.runtime_state CROSS JOIN sa_sync.environment_state;
 IF p_query?'revision' AND p_query->>'revision' IS DISTINCT FROM revision_ THEN RAISE EXCEPTION 'Data changed during paging; refresh and retry' USING ERRCODE='PT409';END IF;
 IF coalesce(jsonb_array_length(p_query#>'{filters,conditions}'),0)=0 AND coalesce(jsonb_array_length(p_query#>'{quick,conditions}'),0)=0
 AND coalesce(p_query->>'search','')='' AND coalesce(p_query#>>'{sort,key}','id')='id' AND direction_='desc' AND coalesce(jsonb_array_length(p_query->'option_fields'),0)=0 THEN
  r:=sa_domain.dashboard_fast_result(p_report,p_tab,p_filters,page_,n);
  IF r IS NOT NULL THEN RETURN r||jsonb_build_object('revision',revision_,'metadata',
   (SELECT jsonb_build_object('environment',environment,'generation',generation,'editRevision',edit_revision,'syncedRevision',synced_revision,
    'canWrite',cutover OR(environment='staging' AND sa_domain.rehearsal_actor_allowed(sa_domain.request_uid())),'ownership',CASE WHEN cutover THEN 'supabase' ELSE 'mirror' END,'asOf',s.updated_at,'timezone','Asia/Kolkata') FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state));END IF;
 END IF;
 IF p_report='rmp_order_reports' THEN
  r:=sa_domain.dashboard_rmp_query(p_filters,p_query);
  RETURN r||jsonb_build_object('revision',revision_,'metadata',(SELECT jsonb_build_object('environment',environment,'generation',generation,'editRevision',edit_revision,'syncedRevision',synced_revision,
   'canWrite',cutover OR(environment='staging' AND sa_domain.rehearsal_actor_allowed(sa_domain.request_uid())),'ownership',CASE WHEN cutover THEN 'supabase' ELSE 'mirror' END,'asOf',s.updated_at,'timezone','Asia/Kolkata') FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state));
 END IF;
 WITH base AS MATERIALIZED(SELECT v FROM sa_domain.dashboard_rows(p_report,p_tab,p_filters) v),
 filtered AS MATERIALIZED(SELECT v FROM base WHERE(coalesce(jsonb_array_length(p_query#>'{filters,conditions}'),0)=0 OR sa_domain.dashboard_match(v,p_query->'filters'))
 AND(coalesce(jsonb_array_length(p_query#>'{quick,conditions}'),0)=0 OR sa_domain.dashboard_match(v,p_query->'quick'))
  AND (coalesce(p_query->>'search','')='' OR EXISTS(SELECT FROM jsonb_each_text(v) e WHERE strpos(lower(e.value),lower(p_query->>'search'))>0))),
 page AS(SELECT v FROM filtered ORDER BY
  CASE WHEN direction_='asc' AND numeric_ THEN sa_domain.dashboard_number(v->>sort_) END ASC NULLS LAST,
  CASE WHEN direction_='desc' AND numeric_ THEN sa_domain.dashboard_number(v->>sort_) END DESC NULLS LAST,
  CASE WHEN direction_='asc' AND NOT numeric_ THEN lower(v->>sort_) END ASC NULLS LAST,
  CASE WHEN direction_='desc' AND NOT numeric_ THEN lower(v->>sort_) END DESC NULLS LAST,(v->>'id')::bigint DESC
  LIMIT n OFFSET(page_-1)*n),
 sums AS(SELECT e.key,CASE WHEN count(*) FILTER(WHERE sa_domain.dashboard_number(e.value) IS NULL)>0 THEN NULL ELSE sum(sa_domain.dashboard_number(e.value))::text END value
  FROM filtered f CROSS JOIN LATERAL(SELECT key,f.v->>key value FROM unnest(ARRAY['total_amount','total_quantity','quantity','inventory','total_qty','closed_qty','item_qty','ordered_qty','order_value','closed_ordered_qty','qtyA','qtyB','valueA','valueB']) key WHERE f.v?key) e GROUP BY e.key),
 customer_types AS(
  SELECT coalesce(nullif(btrim(v->>'customer_type'),''),'Unknown') type,
   CASE WHEN NOT bool_or(sa_domain.dashboard_number(v->>'total_qty') IS NULL) THEN sum(sa_domain.dashboard_number(v->>'total_qty'))::text END qty,
   CASE WHEN NOT bool_or(sa_domain.dashboard_number(v->>'total_amount') IS NULL) THEN sum(sa_domain.dashboard_number(v->>'total_amount'))::text END amount
  FROM filtered WHERE p_report='rmp_sales' AND p_tab IN('','overview') GROUP BY coalesce(nullif(btrim(v->>'customer_type'),''),'Unknown')),
 options AS(SELECT key,jsonb_agg(value ORDER BY value) values_ FROM(SELECT DISTINCT e.key,e.value FROM base CROSS JOIN LATERAL jsonb_each_text(v) e
  WHERE e.key IN(SELECT jsonb_array_elements_text(coalesce(p_query->'option_fields','[]'))) AND e.value IS NOT NULL AND e.value<>'') choices GROUP BY key)
 SELECT jsonb_build_object('data',coalesce((SELECT jsonb_agg(v) FROM page),'[]'),
  'page',page_,'pageSize',n,'totalCount',(SELECT count(*) FROM filtered),'totalPages',greatest(1,ceil((SELECT count(*) FROM filtered)::numeric/n)),
  'totalCountIsExact',true,'revision',revision_,'summary',jsonb_build_object('count',(SELECT count(*) FROM filtered),
   'sums',coalesce((SELECT jsonb_object_agg(key,value) FROM sums),'{}'),'outOfStockCount',(SELECT count(*) FROM filtered WHERE v->>'status'='out of stock'),
   'unknownInventoryCount',(SELECT count(*) FROM filtered WHERE p_report='total_inventory' AND v->>'inventory' IS NULL))
   ||CASE WHEN p_report='rmp_sales' AND p_tab IN('','overview') THEN jsonb_build_object('customerTypeBreakdown',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('type',type,'qty',qty,'amount',amount) ORDER BY type),'[]') FROM customer_types)) ELSE '{}'::jsonb END,
  'options',coalesce((SELECT jsonb_object_agg(key,values_) FROM options),'{}'),
  'metadata',(SELECT jsonb_build_object('environment',environment,'generation',generation,'editRevision',edit_revision,'syncedRevision',synced_revision,
    'canWrite',cutover OR(environment='staging' AND sa_domain.rehearsal_actor_allowed(sa_domain.request_uid())),'ownership',CASE WHEN cutover THEN 'supabase' ELSE 'mirror' END,'asOf',s.updated_at,'timezone','Asia/Kolkata') FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state)) INTO r;
 RETURN r;
END $f$;
