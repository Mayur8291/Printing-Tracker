BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor,sa_guard;
-- Production actors need the masters referenced by their visible work, even
-- when the optional product-browsing tab is disabled. Deleted masters remain
-- readable through historical orders; this does not make them orderable.
CREATE POLICY squad_work_base ON sa_snapshot_20261019.sa_base_products FOR SELECT TO sa_executor USING(id IN(SELECT base_product_id FROM sa_snapshot_20261019.sa_products));
CREATE POLICY squad_work_fabric ON sa_snapshot_20261019.sa_fabrics FOR SELECT TO sa_executor USING(id IN(SELECT fabric_id FROM sa_snapshot_20261019.sa_products));
CREATE POLICY squad_work_part ON sa_snapshot_20261019.sa_parts FOR SELECT TO sa_executor USING(id IN(SELECT part_id FROM sa_snapshot_20261019.sa_product_parts));
CREATE POLICY squad_work_part_color ON sa_snapshot_20261019.sa_part_colors FOR SELECT TO sa_executor USING(id IN(SELECT part_color_id FROM sa_snapshot_20261019.sa_product_parts));
CREATE POLICY squad_work_addon ON sa_snapshot_20261019.sa_add_ons FOR SELECT TO sa_executor USING(id IN(SELECT add_on_id FROM sa_snapshot_20261019.sa_product_part_add_ons));
CREATE POLICY squad_work_addon_color ON sa_snapshot_20261019.sa_add_on_colors FOR SELECT TO sa_executor USING(id IN(SELECT add_on_color_id FROM sa_snapshot_20261019.sa_product_part_add_ons));
-- The private-color selector policy stays unchanged. Only an already-scoped
-- work detail may resolve these labels; the helper is inaccessible to clients.
GRANT SELECT(id,name,hex_code) ON sa_snapshot_20261019.sa_colors TO sa_guard;
CREATE FUNCTION sa_domain.work_color(p_id bigint) RETURNS TABLE(id bigint,name text,hex_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT id,name::text,hex_code::text FROM sa_snapshot_20261019.sa_colors WHERE id=p_id
$f$;
ALTER FUNCTION sa_domain.work_color(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_color(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.work_color(bigint) TO sa_executor;
CREATE POLICY squad_work_category ON sa_snapshot_20261019.sa_categories FOR SELECT TO sa_executor USING(id IN(SELECT category_id FROM sa_snapshot_20261019.sa_products));
CREATE POLICY squad_work_size ON sa_snapshot_20261019.sa_sizes FOR SELECT TO sa_executor USING(id IN(SELECT size_id FROM sa_snapshot_20261019.sa_quantities) OR id IN(SELECT size_id FROM sa_snapshot_20261019.sa_extra_quantities));
CREATE POLICY squad_work_rmp_class ON sa_snapshot_20261019.sa_rmp_classes FOR SELECT TO sa_executor USING(id IN(SELECT rmp_class_id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY squad_work_rmp_brand ON sa_snapshot_20261019.sa_rmp_brands FOR SELECT TO sa_executor USING(id IN(SELECT rmp_brand_id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY squad_work_rmp_category ON sa_snapshot_20261019.sa_rmp_categories FOR SELECT TO sa_executor USING(id IN(SELECT rmp_category_id FROM sa_snapshot_20261019.sa_items));
GRANT SELECT ON sa_snapshot_20261019.sa_product_images TO sa_executor;
CREATE POLICY squad_work_images ON sa_snapshot_20261019.sa_product_images FOR SELECT TO sa_executor USING(product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products));
CREATE POLICY squad_work_media ON sa_media.references FOR SELECT TO sa_executor USING(
 (resource='brandings' AND record_id IN(SELECT id FROM sa_snapshot_20261019.sa_brandings))
 OR(resource='base_products' AND record_id IN(SELECT base_product_id FROM sa_snapshot_20261019.sa_products))
 OR(resource='fabrics' AND record_id IN(SELECT fabric_id FROM sa_snapshot_20261019.sa_products))
 OR(resource='add_ons' AND record_id IN(SELECT add_on_id FROM sa_snapshot_20261019.sa_product_part_add_ons))
 OR(resource='products' AND record_id IN(SELECT id FROM sa_snapshot_20261019.sa_products))
 OR(resource='product_images' AND record_id IN(SELECT id FROM sa_snapshot_20261019.sa_product_images))
 OR(resource='rmp_classes' AND record_id IN(SELECT rmp_class_id FROM sa_snapshot_20261019.sa_items)));

CREATE FUNCTION sa_domain.item_projection(i jsonb,a sa_domain.actor,p_version text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',i->>'id','order_id',i->>'order_id','type',i->'item_type','product_id',i->>'product_id',
 'rmp_class_id',i->>'rmp_class_id','rmp_brand_id',i->>'rmp_brand_id','rmp_category_id',i->>'rmp_category_id',
 'total_quantity',i->'total_quantity','sample_order',i->'sample_order','worker_stage',i->'job_worker_status',
 'cut',i->'cutting_done','assigned',i->'assigned_to_tailor_quantity','sewn',i->'completed_by_tailor_quantity','dispatched',i->'dispatched_quantity',
 'provider_status',i->'uc_order_status','comment',left(i->>'comment',4000),'comment_truncated',length(i->>'comment')>4000,
 'version',p_version,'progress',jsonb_build_object('cutting',i->'cutting_status','sample_cutting',i->'sample_cutting_status',
 'sample_cut',i->'sample_cutting_done','tailor',i->'tailor_job_status','inspection',i->'completed_by_tailor_quantity_status','dispatch',i->'dispatched_status',
 'jobsheet_assigned',i->'job_sheet_assigned','jobsheet_due_at',(i->>'job_sheet_due_on')||'Z','jobsheet_completed_at',(i->>'job_sheet_completion_by')||'Z'))
 ||CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('unit_amount',i->>'per_piece_amount','total_amount',i->>'total_amount',
 'branding_amount',i->>'branding_amount','sample_amount',i->>'sample_total_amount','cgst_amount',i->>'cgst_amount','sgst_amount',i->>'sgst_amount','igst_amount',i->>'igst_amount') ELSE '{}' END
 ||CASE WHEN a.role_id IN(2,11) THEN jsonb_build_object('worker_unit_cost',i->>'worker_per_piece_amount','worker_total_cost',i->>'worker_total_amount') ELSE '{}' END
 ||CASE WHEN a.role_id IN(0,1,2,4,8,11) THEN jsonb_build_object('fabric_consumption',jsonb_build_object('per_piece',i->>'weight_per_piece','total',i->>'total_weight','basis','stored_order_item')) ELSE '{}' END
$f$;
CREATE FUNCTION sa_domain.item_context(p_id bigint,p_section text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT sa_domain.page_context('order_item.'||p_section,jsonb_build_object('item_id',p_id,'version',sa_domain.version('item',p_id)))
$f$;
CREATE FUNCTION sa_domain.item_children(p_id bigint,p_section text,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.item_context(p_id,p_section);
 after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);i sa_snapshot_20261019.sa_items%ROWTYPE;r jsonb;raw_ jsonb;media_ jsonb;receipt_ jsonb;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found or unavailable' USING ERRCODE='P0002';END IF;
 IF p_section IS NULL OR p_section NOT IN('quantities','bulk_plan','brandings','criteria','parts','addons','images','source_images','variants') THEN RAISE EXCEPTION 'Unknown item section' USING ERRCODE='22023';END IF;
 IF p_section='criteria' AND a.role_id NOT IN(0,1,2,4,7,9) THEN RAISE EXCEPTION 'Checklist is not available for this role' USING ERRCODE='42501';END IF;
 IF p_section='variants' THEN SELECT pricing INTO receipt_ FROM sa_domain.line_receipts WHERE item_id=p_id AND generation=(ctx->>'generation')::bigint;END IF;
 WITH scan AS MATERIALIZED(SELECT id,payload FROM(
 SELECT q.id,jsonb_build_object('id',q.id::text,'size_id',q.size_id::text,'size_name',s.name,'quantity',q.quantity,'cut',q.cutting_done,
 'assigned',q.assigned_to_tailor_quantity,'completed',q.completed_by_tailor_quantity,'dispatched',q.dispatched_quantity) payload
 FROM sa_snapshot_20261019.sa_quantities q LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE p_section='quantities' AND q.item_id=p_id
 UNION ALL SELECT q.id,jsonb_build_object('id',q.id::text,'size_id',q.size_id::text,'size_name',s.name,'quantity',q.quantity)
 FROM sa_snapshot_20261019.sa_extra_quantities q LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE p_section='bulk_plan' AND q.item_id=p_id
 UNION ALL SELECT b.id,jsonb_build_object('id',b.id::text,'type',b.branding_type,'side',b.print_side,'area',b.print_area,'dimension',b.graphic_dimension,
 'width',b.graphic_width::text,'height',b.graphic_height::text,'unit',b.graphic_unit,'comment',left(b.comment,4000),'comment_truncated',length(b.comment)>4000,
 'parent_id',b.parent_id::text,'version',sa_domain.version('branding',b.id),'image',b.image,'mockup_image',b.mockup_image,'attachment',b.attachment)
 FROM sa_snapshot_20261019.sa_brandings b WHERE p_section='brandings' AND b.item_id=p_id
 UNION ALL SELECT c.id,jsonb_build_object('id',c.id::text,'criteria_id',c.criteria_id::text,'name',m.name,'checked',c.is_checked,
 'checked_by_id',c.checked_by_id::text,'unchecked_by_id',c.unchecked_by_id::text,'updated_by_id',c.updated_by_id::text,'updated_at',c.updated_at AT TIME ZONE 'UTC')
 FROM sa_snapshot_20261019.sa_item_criteria c LEFT JOIN sa_snapshot_20261019.sa_criteria m ON m.id=c.criteria_id WHERE p_section='criteria' AND c.item_id=p_id
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'part_id',p.part_id::text,'name',m.name,'color_link_id',p.part_color_id::text,'color_id',col.id::text,'color_name',col.name,'color_hex',col.hex_code)
 FROM sa_snapshot_20261019.sa_product_parts p LEFT JOIN sa_snapshot_20261019.sa_parts m ON m.id=p.part_id LEFT JOIN sa_snapshot_20261019.sa_part_colors pc ON pc.id=p.part_color_id LEFT JOIN LATERAL sa_domain.work_color(pc.color_id) col ON true
 WHERE p_section='parts' AND p.product_id=i.product_id
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'product_part_id',p.product_part_id::text,'addon_id',p.add_on_id::text,'name',m.add_on,
 'color_link_id',p.add_on_color_id::text,'color_id',col.id::text,'color_name',col.name,'color_hex',col.hex_code,'image',sa_domain.catalog_media('add_ons',m.id,'image',m.image))
 FROM sa_snapshot_20261019.sa_product_part_add_ons p JOIN sa_snapshot_20261019.sa_product_parts pp ON pp.id=p.product_part_id
 LEFT JOIN sa_snapshot_20261019.sa_add_ons m ON m.id=p.add_on_id LEFT JOIN sa_snapshot_20261019.sa_add_on_colors ac ON ac.id=p.add_on_color_id LEFT JOIN LATERAL sa_domain.work_color(ac.color_id) col ON true
 WHERE p_section='addons' AND pp.product_id=i.product_id
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'comment',left(p.comment,4000),'image',sa_domain.catalog_media('product_images',p.id,'image',p.image))
 FROM sa_snapshot_20261019.sa_product_images p WHERE p_section='images' AND p.product_id=i.product_id
 UNION ALL SELECT m.ordinality,jsonb_build_object('id',m.ordinality::text,'image',jsonb_build_object('resource','products','record_id',i.product_id::text,'field','images','pointer',m.pointer,'status',m.status))
 FROM(SELECT pointer,status,row_number() OVER(ORDER BY pointer COLLATE "C") ordinality FROM sa_media.references WHERE p_section='source_images' AND resource='products' AND record_id=i.product_id AND field='images') m
 UNION ALL SELECT v.ordinality,jsonb_build_object('id',v.ordinality::text,'sku_id',v.value->>'sku_id','size_id',v.value->>'size_id','quantity',v.value->'quantity')
 ||CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('unit_amount',v.value->>'unit_price','subtotal',((v.value->>'unit_price')::numeric*(v.value->>'quantity')::numeric)::text) ELSE '{}' END
 FROM jsonb_array_elements(coalesce(receipt_->'variants','[]')) WITH ORDINALITY v WHERE p_section='variants'
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 IF p_section='brandings' THEN
  media_:=sa_domain.catalog_media_batch('brandings',r->'data',ARRAY['image','mockup_image','attachment']);
  r:=r||jsonb_build_object('data',(SELECT coalesce(jsonb_agg(value||media_->(value->>'id') ORDER BY ordinality),'[]') FROM jsonb_array_elements(r->'data') WITH ORDINALITY));
 END IF;
 IF p_section='variants' THEN r:=r||jsonb_build_object('basis',CASE WHEN receipt_ IS NULL THEN 'not_recorded_in_source' ELSE 'accepted_quote' END);END IF;
 RETURN r;
END $f$;

CREATE FUNCTION sa_domain.v1_order_item_get(p_id bigint,p_section text DEFAULT 'quantities',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]);i sa_snapshot_20261019.sa_items%ROWTYPE;product_ jsonb;r jsonb;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found or unavailable' USING ERRCODE='P0002';END IF;
 r:=sa_domain.item_children(p_id,p_section,p_cursor,p_limit);
 IF i.item_type=0 THEN
  SELECT jsonb_build_object('id',p.id::text,'name',p.name,'style_number',p.style_number,'comment',left(p.comment,4000),'comment_truncated',length(p.comment)>4000,
   'category',jsonb_build_object('id',p.category_id::text,'name',cat.name),
   'base_product',jsonb_build_object('id',p.base_product_id::text,'name',b.name,'image',sa_domain.catalog_media('base_products',b.id,'image',b.image)),
   'fabric',jsonb_build_object('id',p.fabric_id::text,'name',f.name,'type',f.fabric_type,'uom',f.uom,'image',sa_domain.catalog_media('fabrics',f.id,'image',f.image)),
   'color',jsonb_build_object('id',p.fabric_color_id::text,'name',col.name,'hex',col.hex_code),'master_basis','current_referenced_records') INTO product_
  FROM sa_snapshot_20261019.sa_products p LEFT JOIN sa_snapshot_20261019.sa_base_products b ON b.id=p.base_product_id
  LEFT JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=p.fabric_id LEFT JOIN LATERAL sa_domain.work_color(p.fabric_color_id) col ON true
  LEFT JOIN sa_snapshot_20261019.sa_categories cat ON cat.id=p.category_id WHERE p.id=i.product_id;
 ELSE
  SELECT jsonb_build_object('id',c.id::text,'name',c.name,'color_id',c.rmp_color_id::text,'brand_name',b.name,'category_name',cat.name,
   'images',jsonb_build_array(sa_domain.catalog_media('rmp_classes',c.id,'image_1',c.image_1),sa_domain.catalog_media('rmp_classes',c.id,'image_2',c.image_2),sa_domain.catalog_media('rmp_classes',c.id,'image_3',c.image_3),sa_domain.catalog_media('rmp_classes',c.id,'image_4',c.image_4),sa_domain.catalog_media('rmp_classes',c.id,'image_5',c.image_5)),
   'video',sa_domain.catalog_media('rmp_classes',c.id,'embeded_video',c.embeded_video),'master_basis','current_referenced_records') INTO product_
  FROM sa_snapshot_20261019.sa_rmp_classes c LEFT JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=i.rmp_brand_id LEFT JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=i.rmp_category_id WHERE c.id=i.rmp_class_id;
 END IF;
 RETURN sa_domain.item_projection(to_jsonb(i),a,sa_domain.version('item',p_id))||jsonb_build_object('product',product_,'section',p_section,'records',r,
  'accepted_pricing_available',EXISTS(SELECT FROM sa_domain.line_receipts WHERE item_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state)));
END $f$;

-- Keep order headers and cards light. Each card includes at most 20 size rows;
-- the cursor continues through the same section contract used by item detail.
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
 sizes AS MATERIALIZED(SELECT p.id,sa_domain.item_children(p.id,'quantities',NULL,20) data FROM page p)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.item_projection(to_jsonb(p),a,(ctx->>'generation')||':'||coalesce(v.revision,0))
 ||jsonb_build_object('quantities',q.data->'data','quantities_next_cursor',q.data->'next_cursor') ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO items_
 FROM page p LEFT JOIN sizes q ON q.id=p.id LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=p.id;
 RETURN result||jsonb_build_object('dispatch_destination',sa_domain.order_dispatch_destination(p_id),'items',items_,'pending_change',(SELECT jsonb_build_object('id',id,'kind',kind,'state',state,'created_at',created_at)
 FROM sa_domain.order_requests WHERE order_id=p_id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state) LIMIT 1));
END $f$;

ALTER FUNCTION sa_domain.v1_order_item_get(bigint,text,text,integer) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.item_projection(jsonb,sa_domain.actor,text),sa_domain.item_context(bigint,text),sa_domain.item_children(bigint,text,text,integer),sa_domain.v1_order_item_get(bigint,text,text,integer) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.item_projection(jsonb,sa_domain.actor,text),sa_domain.item_context(bigint,text),sa_domain.item_children(bigint,text,text,integer) TO sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.v1_order_item_get(bigint,text,text,integer) TO sa_app;
CREATE FUNCTION canto_api.v1_order_item_get(p_id bigint,p_section text DEFAULT 'quantities',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_order_item_get(p_id,p_section,p_cursor,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_order_item_get(bigint,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.v1_order_item_get(bigint,text,text,integer) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
