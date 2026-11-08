BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_criteria TO sa_guard;
CREATE POLICY squad_detail_criteria_labels ON sa_snapshot_20261019.sa_criteria FOR SELECT TO sa_guard USING(true);
CREATE OR REPLACE FUNCTION sa_domain.work_masters(p_resource text, p_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE r jsonb;BEGIN
 CASE p_resource
 WHEN 'base_products' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name,'image',image)),'{}') INTO r FROM sa_snapshot_20261019.sa_base_products WHERE id=ANY(p_ids);
 WHEN 'fabrics' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name,'fabric_type',fabric_type,'uom',uom,'image',image)),'{}') INTO r FROM sa_snapshot_20261019.sa_fabrics WHERE id=ANY(p_ids);
 WHEN 'parts' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name)),'{}') INTO r FROM sa_snapshot_20261019.sa_parts WHERE id=ANY(p_ids);
 WHEN 'part_colors' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'color_id',color_id)),'{}') INTO r FROM sa_snapshot_20261019.sa_part_colors WHERE id=ANY(p_ids);
 WHEN 'add_ons' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'add_on',add_on,'image',image)),'{}') INTO r FROM sa_snapshot_20261019.sa_add_ons WHERE id=ANY(p_ids);
 WHEN 'add_on_colors' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'color_id',color_id)),'{}') INTO r FROM sa_snapshot_20261019.sa_add_on_colors WHERE id=ANY(p_ids);
 WHEN 'categories' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name)),'{}') INTO r FROM sa_snapshot_20261019.sa_categories WHERE id=ANY(p_ids);
 WHEN 'sizes' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name)),'{}') INTO r FROM sa_snapshot_20261019.sa_sizes WHERE id=ANY(p_ids);
 WHEN 'rmp_classes' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name,'rmp_color_id',rmp_color_id,'image_1',image_1,'image_2',image_2,'image_3',image_3,'image_4',image_4,'image_5',image_5,'embeded_video',embeded_video)),'{}') INTO r FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=ANY(p_ids);
 WHEN 'rmp_brands' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name)),'{}') INTO r FROM sa_snapshot_20261019.sa_rmp_brands WHERE id=ANY(p_ids);
 WHEN 'rmp_categories' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name)),'{}') INTO r FROM sa_snapshot_20261019.sa_rmp_categories WHERE id=ANY(p_ids);
 WHEN 'colors' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name,'hex_code',hex_code)),'{}') INTO r FROM sa_snapshot_20261019.sa_colors WHERE id=ANY(p_ids);
 WHEN 'criteria' THEN SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('id',id,'name',name)),'{}') INTO r FROM sa_snapshot_20261019.sa_criteria WHERE id=ANY(p_ids);
 ELSE RAISE EXCEPTION 'Unknown work reference' USING ERRCODE='22023';END CASE;RETURN r;END $function$;
ALTER FUNCTION sa_domain.work_masters(text,bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_masters(text,bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.work_masters(text,bigint[]) TO sa_executor;

CREATE OR REPLACE FUNCTION sa_domain.item_children(p_id bigint,p_section text,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.item_context(p_id,p_section);
 after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);i sa_snapshot_20261019.sa_items%ROWTYPE;r jsonb;raw_ jsonb;page_ jsonb;media_ jsonb:='{}';receipt_ jsonb;
 labels_ jsonb:='{}';links_ jsonb:='{}';colors_ jsonb:='{}';child_ jsonb;last_ bigint;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found or unavailable' USING ERRCODE='P0002';END IF;
 IF p_section IS NULL OR p_section NOT IN('quantities','bulk_plan','brandings','criteria','parts','addons','images','source_images','variants') THEN RAISE EXCEPTION 'Unknown item section' USING ERRCODE='22023';END IF;
 IF p_section='criteria' AND a.role_id NOT IN(0,1,2,4,7,9) THEN RAISE EXCEPTION 'Checklist is not available for this role' USING ERRCODE='42501';END IF;
 IF p_section='variants' THEN SELECT pricing INTO receipt_ FROM sa_domain.line_receipts WHERE item_id=p_id AND generation=(ctx->>'generation')::bigint;END IF;
 WITH scan AS(SELECT id,payload FROM(
 SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_quantities q WHERE p_section='quantities' AND q.item_id=p_id
 UNION ALL SELECT q.id,to_jsonb(q) FROM sa_snapshot_20261019.sa_extra_quantities q WHERE p_section='bulk_plan' AND q.item_id=p_id
 UNION ALL SELECT q.id,to_jsonb(q) FROM sa_snapshot_20261019.sa_brandings q WHERE p_section='brandings' AND q.item_id=p_id
 UNION ALL SELECT q.id,to_jsonb(q) FROM sa_snapshot_20261019.sa_item_criteria q WHERE p_section='criteria' AND q.item_id=p_id
 UNION ALL SELECT q.id,to_jsonb(q) FROM sa_snapshot_20261019.sa_product_parts q WHERE p_section='parts' AND q.product_id=i.product_id
 UNION ALL SELECT q.id,to_jsonb(q) FROM sa_snapshot_20261019.sa_product_part_add_ons q JOIN sa_snapshot_20261019.sa_product_parts p ON p.id=q.product_part_id WHERE p_section='addons' AND p.product_id=i.product_id
 UNION ALL SELECT q.id,to_jsonb(q) FROM sa_snapshot_20261019.sa_product_images q WHERE p_section='images' AND q.product_id=i.product_id
 UNION ALL SELECT m.ordinality,jsonb_build_object('id',m.ordinality,'pointer',m.pointer,'status',m.status) FROM(SELECT pointer,status,row_number() OVER(ORDER BY pointer COLLATE "C") ordinality FROM sa_media.references WHERE p_section='source_images' AND resource='products' AND record_id=i.product_id AND field='images') m
 UNION ALL SELECT v.ordinality,v.value||jsonb_build_object('id',v.ordinality) FROM jsonb_array_elements(coalesce(receipt_->'variants','[]')) WITH ORDINALITY v WHERE p_section='variants'
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1)
 SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') INTO raw_ FROM scan;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'),min((value->>'id')::bigint) INTO page_,last_ FROM jsonb_array_elements(raw_) WITH ORDINALITY WHERE ordinality<=n;
 -- Only the requested page contributes lookup IDs. Each label/media family is
 -- fetched once, including private historical colours, without a per-row query.
 IF p_section IN('quantities','bulk_plan') THEN labels_:=sa_domain.work_masters('sizes',ARRAY(SELECT DISTINCT (value->>'size_id')::bigint FROM jsonb_array_elements(page_)));
 ELSIF p_section='criteria' THEN labels_:=sa_domain.work_masters('criteria',ARRAY(SELECT DISTINCT (value->>'criteria_id')::bigint FROM jsonb_array_elements(page_)));
 ELSIF p_section='parts' THEN
  labels_:=sa_domain.work_masters('parts',ARRAY(SELECT DISTINCT (value->>'part_id')::bigint FROM jsonb_array_elements(page_)));
  links_:=sa_domain.work_masters('part_colors',ARRAY(SELECT DISTINCT (value->>'part_color_id')::bigint FROM jsonb_array_elements(page_)));
 ELSIF p_section='addons' THEN
  labels_:=sa_domain.work_masters('add_ons',ARRAY(SELECT DISTINCT (value->>'add_on_id')::bigint FROM jsonb_array_elements(page_)));
  links_:=sa_domain.work_masters('add_on_colors',ARRAY(SELECT DISTINCT (value->>'add_on_color_id')::bigint FROM jsonb_array_elements(page_)));
  media_:=sa_domain.catalog_media_batch('add_ons',(SELECT coalesce(jsonb_agg(value),'[]') FROM jsonb_each(labels_)),ARRAY['image']);
 ELSIF p_section='brandings' THEN media_:=sa_domain.catalog_media_batch('brandings',page_,ARRAY['image','mockup_image','attachment']);
 ELSIF p_section='images' THEN media_:=sa_domain.catalog_media_batch('product_images',page_,ARRAY['image']);END IF;
 IF p_section IN('parts','addons') THEN colors_:=sa_domain.work_masters('colors',ARRAY(SELECT DISTINCT (value->>'color_id')::bigint FROM jsonb_each(links_)));END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x->>'id')||CASE p_section
 WHEN 'quantities' THEN jsonb_build_object('size_id',x->>'size_id','size_name',labels_->(x->>'size_id')->'name','quantity',x->'quantity','cut',x->'cutting_done','assigned',x->'assigned_to_tailor_quantity','completed',x->'completed_by_tailor_quantity','dispatched',x->'dispatched_quantity')
 WHEN 'bulk_plan' THEN jsonb_build_object('size_id',x->>'size_id','size_name',labels_->(x->>'size_id')->'name','quantity',x->'quantity')
 WHEN 'brandings' THEN jsonb_build_object('type',x->'branding_type','side',x->'print_side','area',x->'print_area','dimension',x->'graphic_dimension','width',x->>'graphic_width','height',x->>'graphic_height','unit',x->'graphic_unit','comment',left(x->>'comment',4000),'comment_truncated',length(x->>'comment')>4000,'parent_id',x->>'parent_id','version',(ctx->>'generation')||':'||coalesce(v.revision,0))||(media_->(x->>'id'))
 WHEN 'criteria' THEN jsonb_build_object('criteria_id',x->>'criteria_id','name',labels_->(x->>'criteria_id')->'name','checked',x->'is_checked','checked_by_id',x->>'checked_by_id','unchecked_by_id',x->>'unchecked_by_id','updated_by_id',x->>'updated_by_id','updated_at',(x->>'updated_at')||'Z')
 WHEN 'parts' THEN jsonb_build_object('part_id',x->>'part_id','name',labels_->(x->>'part_id')->'name','color_link_id',x->>'part_color_id','color_id',links_->(x->>'part_color_id')->>'color_id','color_name',colors_->(links_->(x->>'part_color_id')->>'color_id')->'name','color_hex',colors_->(links_->(x->>'part_color_id')->>'color_id')->'hex_code')
 WHEN 'addons' THEN jsonb_build_object('product_part_id',x->>'product_part_id','addon_id',x->>'add_on_id','name',labels_->(x->>'add_on_id')->'add_on','color_link_id',x->>'add_on_color_id','color_id',links_->(x->>'add_on_color_id')->>'color_id','color_name',colors_->(links_->(x->>'add_on_color_id')->>'color_id')->'name','color_hex',colors_->(links_->(x->>'add_on_color_id')->>'color_id')->'hex_code','image',media_->(x->>'add_on_id')->'image')
 WHEN 'images' THEN jsonb_build_object('comment',left(x->>'comment',4000),'image',media_->(x->>'id')->'image')
 WHEN 'source_images' THEN jsonb_build_object('image',jsonb_build_object('resource','products','record_id',i.product_id::text,'field','images','pointer',x->'pointer','status',x->'status'))
 WHEN 'variants' THEN jsonb_build_object('sku_id',x->>'sku_id','size_id',x->>'size_id','quantity',x->'quantity')||CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('unit_amount',x->>'unit_price','subtotal',((x->>'unit_price')::numeric*(x->>'quantity')::numeric)::text) ELSE '{}' END
 END ORDER BY p.ordinality),'[]') INTO r FROM jsonb_array_elements(page_) WITH ORDINALITY p(x,ordinality) LEFT JOIN sa_domain.entity_versions v ON p_section='brandings' AND v.kind='branding' AND v.entity_id=(x->>'id')::bigint;
 RETURN jsonb_build_object('data',r,'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.next_cursor(last_,ctx) END)
 ||CASE WHEN p_section='variants' THEN jsonb_build_object('basis',CASE WHEN receipt_ IS NULL THEN 'not_recorded_in_source' ELSE 'accepted_quote' END) ELSE '{}' END;
END $f$;

CREATE OR REPLACE FUNCTION sa_domain.v1_order_get(p_id bigint,p_item_cursor text DEFAULT NULL,p_item_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]);n integer:=sa_domain.page_limit(p_item_limit);
 ctx jsonb:=sa_domain.page_context('order_items',jsonb_build_object('order_id',p_id,'version',sa_domain.version('order',p_id)));
 after_ bigint:=sa_domain.cursor_id(p_item_cursor,ctx);result jsonb;items_ jsonb;
BEGIN
 SELECT sa_domain.order_projection(to_jsonb(o),a,sa_domain.version('order',o.id))||jsonb_build_object('comment',left(o.comment,4000),'comment_truncated',length(o.comment)>4000)
 INTO result FROM sa_snapshot_20261019.sa_orders o WHERE o.id=p_id AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL;
 IF result IS NULL THEN RAISE EXCEPTION 'Record not found or unavailable' USING ERRCODE='P0002';END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id AND id<after_ ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 quantities AS MATERIALIZED(SELECT q.* FROM page p CROSS JOIN LATERAL(SELECT q.*,row_number() OVER(ORDER BY id DESC) rn FROM sa_snapshot_20261019.sa_quantities q WHERE item_id=p.id ORDER BY id DESC LIMIT 21) q),
 labels AS MATERIALIZED(SELECT sa_domain.work_masters('sizes',ARRAY(SELECT DISTINCT size_id FROM quantities WHERE rn<=20)) data),
 sizes AS(SELECT q.item_id,jsonb_build_object('data',jsonb_agg(jsonb_build_object('id',q.id::text,'size_id',q.size_id::text,'size_name',labels.data->q.size_id::text->'name','quantity',q.quantity,'cut',q.cutting_done,'assigned',q.assigned_to_tailor_quantity,'completed',q.completed_by_tailor_quantity,'dispatched',q.dispatched_quantity) ORDER BY q.id DESC) FILTER(WHERE rn<=20),
 'next_cursor',CASE WHEN count(*)>20 THEN sa_domain.next_cursor(min(q.id) FILTER(WHERE rn<=20),sa_domain.item_context(q.item_id,'quantities')) END) data FROM quantities q CROSS JOIN labels GROUP BY q.item_id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.item_projection(to_jsonb(p),a,(ctx->>'generation')||':'||coalesce(v.revision,0))
 ||jsonb_build_object('quantities',coalesce(q.data->'data','[]'),'quantities_next_cursor',q.data->'next_cursor') ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO items_
 FROM page p LEFT JOIN sizes q ON q.item_id=p.id LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=p.id;
 RETURN result||jsonb_build_object('dispatch_destination',sa_domain.order_dispatch_destination(p_id),'items',items_,'pending_change',(SELECT jsonb_build_object('id',id,'kind',kind,'state',state,'created_at',created_at)
 FROM sa_domain.order_requests WHERE order_id=p_id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state) LIMIT 1));
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
