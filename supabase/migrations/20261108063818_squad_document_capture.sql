BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor,sa_guard,sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.account_media_resolve(jsonb) TO sa_executor;
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_category_brands TO sa_executor;
CREATE POLICY squad_document_category_brands ON sa_snapshot_20261019.sa_rmp_category_brands FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
-- Verified inventory paths only. Never fetch the old URL from an Edge worker.
CREATE FUNCTION sa_domain.document_images(p_ids bigint[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('documents');r jsonb;
BEGIN
 IF cardinality(p_ids)>2000 THEN RAISE EXCEPTION 'Image selection too large' USING ERRCODE='22023';END IF;
 WITH classes AS(SELECT c.id,c.image_1_thumb,c.image_1 FROM sa_snapshot_20261019.sa_rmp_classes c WHERE c.id=ANY(p_ids) AND c.is_deleted IS NOT TRUE AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus s WHERE s.rmp_class_id=c.id AND s.is_deleted IS NOT TRUE AND s.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids()))),
 ready AS(SELECT DISTINCT ON(c.id) c.id,o.object_path,o.bytes,o.content_type FROM classes c JOIN sa_media.references ref ON ref.resource='rmp_classes' AND ref.record_id=c.id AND ref.pointer='' AND ref.status='ready' AND ref.field IN('image_1_thumb','image_1') AND ref.source_value=CASE WHEN ref.field='image_1_thumb' THEN c.image_1_thumb ELSE c.image_1 END JOIN sa_media.objects o USING(sha256) WHERE o.content_type IN('image/jpeg','image/png') AND o.bytes<=1048576 ORDER BY c.id,(ref.field='image_1_thumb') DESC)
 SELECT coalesce(jsonb_object_agg(id::text,jsonb_build_object('bucket','canto-media','path',object_path,'bytes',bytes,'content_type',content_type)),'{}') INTO r FROM ready;RETURN r;
END $f$;
ALTER FUNCTION sa_domain.document_images(bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.document_images(bigint[]) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_images(bigint[]) TO sa_executor;

CREATE FUNCTION sa_domain.document_catalogue(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('documents');sel jsonb:=coalesce(p_request->'selection','{}');commercial jsonb:=sa_domain.commercial_context();
 cats bigint[]:=sa_domain.document_ids(coalesce(sel->'category_ids','[]'));brands bigint[]:=sa_domain.document_ids(coalesce(sel->'brand_ids','[]'));classes bigint[]:=sa_domain.document_ids(coalesce(sel->'class_ids','[]'));
 no_cats bigint[]:=sa_domain.document_ids(coalesce(sel->'exclude_category_ids','[]'));no_brands bigint[]:=sa_domain.document_ids(coalesce(sel->'exclude_brand_ids','[]'));no_classes bigint[]:=sa_domain.document_ids(coalesce(sel->'exclude_class_ids','[]'));
 selected_ jsonb;ids_ bigint[];prices_ jsonb;images_ jsonb;rows_ jsonb;markup_ numeric:=coalesce((p_request->'markup'->>'value')::numeric,0);
BEGIN
 WITH selected AS(SELECT DISTINCT s.id,s.rmp_class_id,s.rmp_brand_id,c.id category_id,s.rmp_size_id,z.name size_name,z.position size_position,cl.name class_name,b.name brand_name,c.name category_name,col.name color_name
 FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_classes cl ON cl.id=s.rmp_class_id AND cl.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id AND b.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_category_brands cb ON cb.rmp_brand_id=b.id AND cb.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_categories c ON c.id=cb.rmp_category_id AND c.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id AND z.is_deleted IS NOT TRUE
 LEFT JOIN sa_snapshot_20261019.sa_rmp_colors col ON col.id=cl.rmp_color_id
 WHERE s.is_deleted IS NOT TRUE AND s.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids())
 AND(cardinality(cats)=0 OR c.id=ANY(cats)) AND(cardinality(brands)=0 OR b.id=ANY(brands)) AND(cardinality(classes)=0 OR cl.id=ANY(classes))
 AND c.id<>ALL(no_cats) AND b.id<>ALL(no_brands) AND cl.id<>ALL(no_classes) AND(NOT sel?'parent_category' OR b.main_category=sel->>'parent_category')
 ORDER BY c.id,s.rmp_brand_id,s.rmp_class_id,s.id LIMIT 20001)
 SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO selected_ FROM selected s;
 IF jsonb_array_length(selected_)>20000 THEN RAISE EXCEPTION 'Select fewer categories; variant limit is 20000' USING ERRCODE='54000';END IF;
 SELECT coalesce(array_agg(DISTINCT(x->>'id')::bigint),'{}') INTO ids_ FROM jsonb_array_elements(selected_) x;
 prices_:=sa_domain.sku_prices_batch(ids_,(commercial->>'price_type_id')::bigint);
 SELECT coalesce(array_agg(DISTINCT(x->>'rmp_class_id')::bigint),'{}') INTO ids_ FROM jsonb_array_elements(selected_) x;
 images_:=sa_domain.document_images(ids_);
 WITH variants AS(SELECT x.*,prices_->x.id::text price FROM jsonb_to_recordset(selected_) AS x(id bigint,rmp_class_id bigint,rmp_brand_id bigint,category_id bigint,rmp_size_id bigint,size_name text,size_position integer,class_name text,brand_name text,category_name text,color_name text)),
 grouped AS(SELECT category_id,rmp_brand_id,rmp_class_id,min(category_name) category_name,min(brand_name) brand_name,min(class_name) class_name,min(color_name) color_name,
 min((price->>'unit_price')::numeric) unit_price,min((price->>'mrp')::numeric) mrp,bool_or(price IS NULL) missing_price,
 jsonb_agg(jsonb_build_object('sku_id',id::text,'size_id',rmp_size_id::text,'size',size_name,'unit_price',price->>'unit_price','mrp',price->>'mrp','stock',NULL) ORDER BY sa_domain.catalog_sort(size_position) COLLATE "C",id) variants FROM variants GROUP BY category_id,rmp_brand_id,rmp_class_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('class_id',rmp_class_id::text,'brand_id',rmp_brand_id::text,'category_id',category_id::text,'name',class_name,'brand',brand_name,'category',category_name,'color',color_name,
 'unit_price',unit_price::text,'display_price',round(CASE WHEN p_request->'markup'->>'kind'='fixed' THEN unit_price+markup_ ELSE unit_price*(1+markup_/100) END,2)::text,'mrp',mrp::text,'missing_price',missing_price,'variants',variants,
 'image',images_->rmp_class_id::text,'stock_status','provider_snapshot_unavailable') ORDER BY category_id,rmp_brand_id,rmp_class_id),'[]') INTO rows_ FROM grouped;
 IF jsonb_array_length(rows_)>2000 THEN RAISE EXCEPTION 'Select fewer categories; product limit is 2000' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('rows',rows_,'commercial',commercial,'currency','INR','pricing_basis','shared_sku_price_selection_v1','stock_basis','unavailable_until_provider_reconciliation','grouping','category_brand_class','presentation',p_request-'selection'-'terms_reference');
END $f$;
ALTER FUNCTION sa_domain.document_catalogue(jsonb) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.document_catalogue(jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

GRANT SELECT(id,name,customer_company_name,gst_no,phone) ON sa_snapshot_20261019.sa_users TO sa_guard;
GRANT SELECT(id,order_id,product_id,total_quantity,per_piece_amount,cgst_amount,sgst_amount,igst_amount) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT ON sa_domain.dispatch_receipts TO sa_guard;
CREATE POLICY squad_document_receipts_guard ON sa_domain.dispatch_receipts FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name,base_product_id) ON sa_snapshot_20261019.sa_products TO sa_guard;
GRANT SELECT(id,product_id,image) ON sa_snapshot_20261019.sa_product_images TO sa_guard;
CREATE POLICY squad_document_product_guard ON sa_snapshot_20261019.sa_product_images FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.document_challan(p_item bigint,p_dispatch bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[4,7,10]);i record;d record;customer_ jsonb;rows_ jsonb;qty_ bigint;price_ numeric;cg numeric;sg numeric;ig numeric;destination_ jsonb;basis_ text;product_ jsonb;
BEGIN
 IF NOT sa_domain.can_item(p_item) THEN RAISE EXCEPTION 'Dispatch unavailable' USING ERRCODE='P0002';END IF;
 SELECT id,order_id,product_id,total_quantity,per_piece_amount,cgst_amount,sgst_amount,igst_amount INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_item;
 SELECT id,item_id,dispatched_at INTO d FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE id=p_dispatch AND item_id=p_item;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Dispatch unavailable' USING ERRCODE='P0002';END IF;
 SELECT jsonb_build_object('id',u.id::text,'name',coalesce(nullif(u.customer_company_name,''),u.name),'company',u.customer_company_name,'phone',u.phone,'gst_no',u.gst_no) INTO customer_ FROM sa_snapshot_20261019.sa_orders o JOIN sa_snapshot_20261019.sa_users u ON u.id=o.customer_id WHERE o.id=i.order_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('size',s.name,'quantity',q.dispatched_quantity,'quantity_id',v.id::text) ORDER BY q.id),'[]'),sum(q.dispatched_quantity)
 INTO rows_,qty_ FROM sa_snapshot_20261019.sa_dispatched_quantities q JOIN sa_snapshot_20261019.sa_quantities v ON v.id=q.quantity_id AND v.item_id=p_item LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=v.size_id WHERE q.job_sheet_dispatched_date_id=p_dispatch;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_dispatched_quantities q LEFT JOIN sa_snapshot_20261019.sa_quantities v ON v.id=q.quantity_id WHERE q.job_sheet_dispatched_date_id=p_dispatch AND(v.id IS NULL OR v.item_id IS DISTINCT FROM p_item OR q.dispatched_quantity IS NULL OR q.dispatched_quantity<0)) THEN RAISE EXCEPTION 'Dispatch history needs reconciliation' USING ERRCODE='55000';END IF;
 IF customer_ IS NULL OR qty_ IS NULL OR qty_<=0 OR i.total_quantity IS NULL OR i.total_quantity<=0 OR qty_>i.total_quantity OR i.per_piece_amount IS NULL OR least(i.per_piece_amount,coalesce(i.cgst_amount,0),coalesce(i.sgst_amount,0),coalesce(i.igst_amount,0))<0 OR EXISTS(SELECT FROM jsonb_array_elements(rows_) x WHERE(x->>'quantity')::int<0) THEN RAISE EXCEPTION 'Dispatch quantities or amounts need reconciliation' USING ERRCODE='55000';END IF;
 price_:=round(i.per_piece_amount::numeric*qty_,2);cg:=round(coalesce(i.cgst_amount,0)::numeric*qty_/i.total_quantity,2);sg:=round(coalesce(i.sgst_amount,0)::numeric*qty_/i.total_quantity,2);ig:=round(coalesce(i.igst_amount,0)::numeric*qty_/i.total_quantity,2);
 SELECT destination INTO destination_ FROM sa_domain.dispatch_receipts WHERE dispatch_id=p_dispatch AND generation=(SELECT generation FROM sa_domain.runtime_state);basis_:=CASE WHEN destination_ IS NULL THEN 'current_order_only' ELSE 'dispatch_snapshot' END;
 SELECT jsonb_build_object('name',p.name,'base_product',b.name,'image',(
 SELECT jsonb_build_object('bucket','canto-media','path',o.object_path,'bytes',o.bytes,'content_type',o.content_type)
 FROM sa_media.references ref JOIN sa_media.objects o USING(sha256)
 WHERE ref.status='ready' AND ref.pointer='' AND o.content_type IN('image/png','image/jpeg') AND o.bytes<=1048576
 AND((ref.resource='product_images' AND ref.record_id=pi.id AND ref.field='image' AND ref.source_value=pi.image) OR(ref.resource='base_products' AND ref.record_id=b.id AND ref.field='image' AND ref.source_value=b.image)) ORDER BY(ref.resource='product_images') DESC LIMIT 1)) INTO product_
 FROM sa_snapshot_20261019.sa_products p LEFT JOIN sa_snapshot_20261019.sa_base_products b ON b.id=p.base_product_id
 LEFT JOIN LATERAL(SELECT id,image FROM sa_snapshot_20261019.sa_product_images WHERE product_id=p.id ORDER BY id LIMIT 1) pi ON true WHERE p.id=i.product_id;
 RETURN jsonb_build_object('product',product_,'rows',rows_,'customer',customer_,'item_id',p_item::text,'order_id',i.order_id::text,'dispatch_id',p_dispatch::text,'dispatched_at',d.dispatched_at AT TIME ZONE 'UTC','destination',coalesce(destination_,sa_domain.order_dispatch_destination(i.order_id)),'destination_basis',basis_,
 'quantity',qty_,'order_quantity',i.total_quantity,'unit_price',i.per_piece_amount::text,'subtotal',price_::text,'cgst',cg::text,'sgst',sg::text,'igst',ig::text,'total',(price_+cg+sg+ig)::text,'currency','INR','quantity_basis','selected_dispatch_only','amount_basis','current_item_pro_rata_at_snapshot');
END $f$;
ALTER FUNCTION sa_domain.document_challan(bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.document_challan(bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_challan(bigint,bigint) TO sa_executor;

-- One set-based read of the shared earnings engine; no repeated page totals.
CREATE FUNCTION sa_domain.document_tailor(p_tailor bigint,p_week date,p_team boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;start_ timestamptz:=p_week::timestamp AT TIME ZONE 'Asia/Kolkata';end_ timestamptz:=(p_week+7)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
 WITH rows AS MATERIALIZED(SELECT e.*,u.name tailor_name FROM sa_domain.tailor_earnings_rows(p_tailor,start_,end_,p_team) e LEFT JOIN sa_snapshot_20261019.sa_users u ON u.id=e.tailor_id ORDER BY e.id DESC LIMIT 2001)
 SELECT jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'item_id',item_id::text,'tailor_id',tailor_id::text,'tailor_name',tailor_name,'base_product_id',base_product_id::text,'product_name',product_name,'assigned',assigned,'completed',completed,'pending',greatest(0,assigned-completed),'of_rate',of_rate::text,'sn_rate',sn_rate::text,'unit_rate',(of_rate+sn_rate)::text,'amount',amount::text,'status',CASE WHEN needs_reconciliation THEN 'needs_reconciliation' ELSE 'calculated' END) ORDER BY id DESC),'[]'),
 'summary',jsonb_build_object('rows',count(*),'assigned',coalesce(sum(assigned),0),'completed',coalesce(sum(completed),0),'pending',coalesce(sum(greatest(0,assigned-completed)),0),'amount',CASE WHEN bool_or(needs_reconciliation) THEN NULL ELSE coalesce(sum(amount),0)::text END,'calculated_subtotal',coalesce(sum(amount),0)::text,'needs_reconciliation',coalesce(bool_or(needs_reconciliation),false))) INTO r FROM rows;
 IF jsonb_array_length(r->'rows')>2000 THEN RAISE EXCEPTION 'Weekly report exceeds 2000 work rows' USING ERRCODE='54000';END IF;
 RETURN r||jsonb_build_object('tailor_id',p_tailor::text,'tailor_name',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=p_tailor),'period',jsonb_build_object('week_start',p_week,'week_end',p_week+6,'start_utc',start_,'end_exclusive_utc',end_,'timezone','Asia/Kolkata'),'basis',jsonb_build_object('formula','legacy-tailor-v1','rates','current_master','addons','all_linked_base_addons','period','assignment_date','completion','current_at_read'));
END $f$;
ALTER FUNCTION sa_domain.document_tailor(bigint,date,boolean) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.document_tailor(bigint,date,boolean) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_tailor(bigint,date,boolean) TO sa_executor;

CREATE FUNCTION sa_domain.document_capture(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;snapshot_ jsonb;r jsonb;rows_ jsonb:='[]';cursor_ text;terms_ jsonb;
BEGIN
 SELECT * INTO d FROM sa_domain.documents WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL OR NOT sa_domain.document_current(d) THEN RAISE EXCEPTION 'Document authority changed' USING ERRCODE='42501';END IF;
 IF d.state='expired' THEN RAISE EXCEPTION 'Document expired; request a fresh copy' USING ERRCODE='55000';END IF;
 IF d.snapshot IS NULL THEN
  PERFORM sa_domain.document_spec(d.kind,d.request);
  IF d.kind='catalogue' THEN snapshot_:=sa_domain.document_catalogue(d.request);
  ELSIF d.kind='delivery_challan' THEN snapshot_:=sa_domain.document_challan((d.request->>'item_id')::bigint,(d.request->>'dispatch_id')::bigint);
  ELSE snapshot_:=sa_domain.document_tailor((d.request->>'tailor_id')::bigint,(d.request->>'week_start')::date,coalesce((d.request->>'include_team')::boolean,false));
  END IF;
  IF d.request?'terms_reference' THEN
   terms_:=(sa_domain.account_media_resolve(jsonb_build_array(d.request->'terms_reference'))->'references')->0;
   IF terms_->>'status' IS DISTINCT FROM 'ready' OR terms_->>'content_type' NOT IN('application/pdf','image/png','image/jpeg','text/plain') OR(terms_->>'bytes')::bigint>5242880 THEN RAISE EXCEPTION 'Terms attachment must be a verified document of at most 5 MB' USING ERRCODE='22023';END IF;
   snapshot_:=snapshot_||jsonb_build_object('terms_attachment',jsonb_build_object('bucket',terms_->>'bucket','path',terms_->>'object_path','bytes',(terms_->>'bytes')::bigint,'content_type',terms_->>'content_type'));
  END IF;
  IF coalesce((SELECT sum(bytes_) FROM (SELECT DISTINCT x->'image'->>'path', (x->'image'->>'bytes')::bigint bytes_ FROM jsonb_array_elements(snapshot_->'rows') x WHERE x->'image'->>'path' IS NOT NULL) q),0)>25165824 THEN RAISE EXCEPTION 'Selected images exceed 24 MB; select fewer categories' USING ERRCODE='54000';END IF;
  snapshot_:=snapshot_||jsonb_build_object('kind',d.kind,'document_id',d.id,'generation',d.generation::text,'captured_at',now(),'timezone','Asia/Kolkata','template_version','squad-documents-v1');
  IF octet_length(snapshot_::text)>8388608 THEN RAISE EXCEPTION 'Document snapshot exceeds 8 MB' USING ERRCODE='54000';END IF;
  UPDATE sa_domain.documents SET authority_scope=jsonb_build_object('brands',coalesce((SELECT jsonb_agg(DISTINCT x->>'brand_id') FROM jsonb_array_elements(snapshot_->'rows') x WHERE x->>'brand_id' IS NOT NULL),'[]'),'items',coalesce((SELECT jsonb_agg(DISTINCT x->>'item_id') FROM jsonb_array_elements(snapshot_->'rows') x WHERE x->>'item_id' IS NOT NULL),'[]')),snapshot=snapshot_,snapshot_hash=encode(sha256(convert_to(snapshot_::text,'UTF8')),'hex'),captured_at=now(),part_size=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(snapshot_->'rows') x WHERE x->'image' IS NOT NULL AND x->'image'<>'null') THEN 10 ELSE 100 END,state='rendering' WHERE id=d.id RETURNING * INTO d;
 END IF;
 UPDATE sa_domain.documents SET state='rendering',error_code=NULL WHERE id=d.id;
 RETURN jsonb_build_object('document_id',d.id,'snapshot',d.snapshot,'snapshot_hash',d.snapshot_hash,'object_path','g'||d.generation::text||'/'||d.actor_id::text||'/'||d.id::text||'/document.pdf');
END $f$;
ALTER FUNCTION sa_domain.document_capture(uuid) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.document_capture(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_capture(uuid) TO sa_worker;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard,sa_worker;
COMMIT;
