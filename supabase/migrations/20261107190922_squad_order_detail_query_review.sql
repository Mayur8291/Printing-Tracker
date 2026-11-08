BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
-- Keep pricing/selector policies unchanged. Work details resolve only fixed,
-- nonfinancial fields for IDs derived from their already-authorized item.
DROP POLICY squad_work_base ON sa_snapshot_20261019.sa_base_products;
DROP POLICY squad_work_fabric ON sa_snapshot_20261019.sa_fabrics;
DROP POLICY squad_work_part ON sa_snapshot_20261019.sa_parts;
DROP POLICY squad_work_part_color ON sa_snapshot_20261019.sa_part_colors;
DROP POLICY squad_work_addon ON sa_snapshot_20261019.sa_add_ons;
DROP POLICY squad_work_addon_color ON sa_snapshot_20261019.sa_add_on_colors;
DROP POLICY squad_work_category ON sa_snapshot_20261019.sa_categories;
DROP POLICY squad_work_size ON sa_snapshot_20261019.sa_sizes;
DROP POLICY squad_work_rmp_class ON sa_snapshot_20261019.sa_rmp_classes;
DROP POLICY squad_work_rmp_brand ON sa_snapshot_20261019.sa_rmp_brands;
DROP POLICY squad_work_rmp_category ON sa_snapshot_20261019.sa_rmp_categories;
GRANT SELECT(id,name,image) ON sa_snapshot_20261019.sa_base_products TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_base_products FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name,fabric_type,uom,image) ON sa_snapshot_20261019.sa_fabrics TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_fabrics FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_parts TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_parts FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,color_id) ON sa_snapshot_20261019.sa_part_colors TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_part_colors FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,add_on,image) ON sa_snapshot_20261019.sa_add_ons TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_add_ons FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,color_id) ON sa_snapshot_20261019.sa_add_on_colors TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_add_on_colors FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_categories TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_categories FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_sizes TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_sizes FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name,rmp_color_id,image_1,image_2,image_3,image_4,image_5,embeded_video) ON sa_snapshot_20261019.sa_rmp_classes TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_rmp_classes FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_rmp_brands TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_rmp_brands FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_rmp_categories TO sa_guard;
CREATE POLICY squad_detail_labels ON sa_snapshot_20261019.sa_rmp_categories FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.work_master(p_resource text,p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;BEGIN
 CASE p_resource
 WHEN 'base_products' THEN SELECT jsonb_build_object('id',id,'name',name,'image',image) INTO r FROM sa_snapshot_20261019.sa_base_products WHERE id=p_id;
 WHEN 'fabrics' THEN SELECT jsonb_build_object('id',id,'name',name,'fabric_type',fabric_type,'uom',uom,'image',image) INTO r FROM sa_snapshot_20261019.sa_fabrics WHERE id=p_id;
 WHEN 'parts' THEN SELECT jsonb_build_object('id',id,'name',name) INTO r FROM sa_snapshot_20261019.sa_parts WHERE id=p_id;
 WHEN 'part_colors' THEN SELECT jsonb_build_object('id',id,'color_id',color_id) INTO r FROM sa_snapshot_20261019.sa_part_colors WHERE id=p_id;
 WHEN 'add_ons' THEN SELECT jsonb_build_object('id',id,'add_on',add_on,'image',image) INTO r FROM sa_snapshot_20261019.sa_add_ons WHERE id=p_id;
 WHEN 'add_on_colors' THEN SELECT jsonb_build_object('id',id,'color_id',color_id) INTO r FROM sa_snapshot_20261019.sa_add_on_colors WHERE id=p_id;
 WHEN 'categories' THEN SELECT jsonb_build_object('id',id,'name',name) INTO r FROM sa_snapshot_20261019.sa_categories WHERE id=p_id;
 WHEN 'sizes' THEN SELECT jsonb_build_object('id',id,'name',name) INTO r FROM sa_snapshot_20261019.sa_sizes WHERE id=p_id;
 WHEN 'rmp_classes' THEN SELECT jsonb_build_object('id',id,'name',name,'rmp_color_id',rmp_color_id,'image_1',image_1,'image_2',image_2,'image_3',image_3,'image_4',image_4,'image_5',image_5,'embeded_video',embeded_video) INTO r FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=p_id;
 WHEN 'rmp_brands' THEN SELECT jsonb_build_object('id',id,'name',name) INTO r FROM sa_snapshot_20261019.sa_rmp_brands WHERE id=p_id;
 WHEN 'rmp_categories' THEN SELECT jsonb_build_object('id',id,'name',name) INTO r FROM sa_snapshot_20261019.sa_rmp_categories WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Unknown work reference' USING ERRCODE='22023';END CASE;RETURN r;END $f$;
ALTER FUNCTION sa_domain.work_master(text,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_master(text,bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.work_master(text,bigint) TO sa_executor;
CREATE OR REPLACE FUNCTION sa_domain.item_children(p_id bigint, p_section text, p_cursor text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
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
 FROM sa_snapshot_20261019.sa_quantities q LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_sizes,sa_domain.work_master('sizes',q.size_id)) s ON true WHERE p_section='quantities' AND q.item_id=p_id
 UNION ALL SELECT q.id,jsonb_build_object('id',q.id::text,'size_id',q.size_id::text,'size_name',s.name,'quantity',q.quantity)
 FROM sa_snapshot_20261019.sa_extra_quantities q LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_sizes,sa_domain.work_master('sizes',q.size_id)) s ON true WHERE p_section='bulk_plan' AND q.item_id=p_id
 UNION ALL SELECT b.id,jsonb_build_object('id',b.id::text,'type',b.branding_type,'side',b.print_side,'area',b.print_area,'dimension',b.graphic_dimension,
 'width',b.graphic_width::text,'height',b.graphic_height::text,'unit',b.graphic_unit,'comment',left(b.comment,4000),'comment_truncated',length(b.comment)>4000,
 'parent_id',b.parent_id::text,'version',sa_domain.version('branding',b.id),'image',b.image,'mockup_image',b.mockup_image,'attachment',b.attachment)
 FROM sa_snapshot_20261019.sa_brandings b WHERE p_section='brandings' AND b.item_id=p_id
 UNION ALL SELECT c.id,jsonb_build_object('id',c.id::text,'criteria_id',c.criteria_id::text,'name',m.name,'checked',c.is_checked,
 'checked_by_id',c.checked_by_id::text,'unchecked_by_id',c.unchecked_by_id::text,'updated_by_id',c.updated_by_id::text,'updated_at',c.updated_at AT TIME ZONE 'UTC')
 FROM sa_snapshot_20261019.sa_item_criteria c LEFT JOIN sa_snapshot_20261019.sa_criteria m ON m.id=c.criteria_id WHERE p_section='criteria' AND c.item_id=p_id
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'part_id',p.part_id::text,'name',m.name,'color_link_id',p.part_color_id::text,'color_id',col.id::text,'color_name',col.name,'color_hex',col.hex_code)
 FROM sa_snapshot_20261019.sa_product_parts p LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_parts,sa_domain.work_master('parts',p.part_id)) m ON true LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_part_colors,sa_domain.work_master('part_colors',p.part_color_id)) pc ON true LEFT JOIN LATERAL sa_domain.work_color(pc.color_id) col ON true
 WHERE p_section='parts' AND p.product_id=i.product_id
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'product_part_id',p.product_part_id::text,'addon_id',p.add_on_id::text,'name',m.add_on,
 'color_link_id',p.add_on_color_id::text,'color_id',col.id::text,'color_name',col.name,'color_hex',col.hex_code,'image',sa_domain.catalog_media('add_ons',m.id,'image',m.image))
 FROM sa_snapshot_20261019.sa_product_part_add_ons p JOIN sa_snapshot_20261019.sa_product_parts pp ON pp.id=p.product_part_id
 LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_add_ons,sa_domain.work_master('add_ons',p.add_on_id)) m ON true LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_add_on_colors,sa_domain.work_master('add_on_colors',p.add_on_color_id)) ac ON true LEFT JOIN LATERAL sa_domain.work_color(ac.color_id) col ON true
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
END $function$;
CREATE OR REPLACE FUNCTION sa_domain.v1_order_item_get(p_id bigint, p_section text DEFAULT 'quantities'::text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
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
  FROM sa_snapshot_20261019.sa_products p LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_base_products,sa_domain.work_master('base_products',p.base_product_id)) b ON true
  LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_fabrics,sa_domain.work_master('fabrics',p.fabric_id)) f ON true LEFT JOIN LATERAL sa_domain.work_color(p.fabric_color_id) col ON true
  LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_categories,sa_domain.work_master('categories',p.category_id)) cat ON true WHERE p.id=i.product_id;
 ELSE
  SELECT jsonb_build_object('id',c.id::text,'name',c.name,'color_id',c.rmp_color_id::text,'brand_name',b.name,'category_name',cat.name,
   'images',jsonb_build_array(sa_domain.catalog_media('rmp_classes',c.id,'image_1',c.image_1),sa_domain.catalog_media('rmp_classes',c.id,'image_2',c.image_2),sa_domain.catalog_media('rmp_classes',c.id,'image_3',c.image_3),sa_domain.catalog_media('rmp_classes',c.id,'image_4',c.image_4),sa_domain.catalog_media('rmp_classes',c.id,'image_5',c.image_5)),
   'video',sa_domain.catalog_media('rmp_classes',c.id,'embeded_video',c.embeded_video),'master_basis','current_referenced_records') INTO product_
  FROM jsonb_populate_record(NULL::sa_snapshot_20261019.sa_rmp_classes,sa_domain.work_master('rmp_classes',i.rmp_class_id)) c LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_rmp_brands,sa_domain.work_master('rmp_brands',i.rmp_brand_id)) b ON true LEFT JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_rmp_categories,sa_domain.work_master('rmp_categories',i.rmp_category_id)) cat ON true WHERE c.id=i.rmp_class_id;
 END IF;
 RETURN sa_domain.item_projection(to_jsonb(i),a,sa_domain.version('item',p_id))||jsonb_build_object('product',product_,'section',p_section,'records',r,
  'accepted_pricing_available',EXISTS(SELECT FROM sa_domain.line_receipts WHERE item_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state)));
END $function$;

-- Avoid expanding every order/product policy in every ordinary media lookup.
GRANT SELECT ON sa_snapshot_20261019.sa_products,sa_snapshot_20261019.sa_product_parts,sa_snapshot_20261019.sa_product_part_add_ons,sa_snapshot_20261019.sa_product_images,sa_snapshot_20261019.sa_brandings TO sa_guard;
CREATE POLICY squad_detail_guard ON sa_snapshot_20261019.sa_products FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_detail_guard ON sa_snapshot_20261019.sa_product_parts FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_detail_guard ON sa_snapshot_20261019.sa_product_part_add_ons FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_detail_guard ON sa_snapshot_20261019.sa_product_images FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_detail_guard ON sa_snapshot_20261019.sa_brandings FOR SELECT TO sa_guard USING(true);
GRANT SELECT ON sa_domain.archived_designs TO sa_guard;
CREATE POLICY squad_archived_guard ON sa_domain.archived_designs FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.work_product_visible(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_products p CROSS JOIN sa_domain.actor() a WHERE p.id=p_id AND
 (a.role_id=0 OR p.created_by_id=a.user_id OR p.id IN(SELECT product_id FROM sa_snapshot_20261019.sa_items WHERE id IN(SELECT sa_domain.scope_item_ids()))))
$f$;
ALTER FUNCTION sa_domain.work_product_visible(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_product_visible(bigint) FROM PUBLIC,anon,authenticated,sa_app;
CREATE FUNCTION sa_domain.work_media_visible(p_resource text,p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 CASE p_resource
 WHEN 'products' THEN RETURN sa_domain.work_product_visible(p_id);
 WHEN 'base_products' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_products WHERE base_product_id=p_id AND sa_domain.work_product_visible(id));
 WHEN 'fabrics' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_products WHERE fabric_id=p_id AND sa_domain.work_product_visible(id));
 WHEN 'add_ons' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_product_part_add_ons x JOIN sa_snapshot_20261019.sa_product_parts p ON p.id=x.product_part_id WHERE x.add_on_id=p_id AND sa_domain.work_product_visible(p.product_id));
 WHEN 'product_images' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_product_images WHERE id=p_id AND sa_domain.work_product_visible(product_id));
 WHEN 'rmp_classes' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE rmp_class_id=p_id AND id IN(SELECT sa_domain.scope_item_ids()));
 WHEN 'brandings' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_brandings WHERE id=p_id AND(item_id IN(SELECT sa_domain.scope_item_ids()) OR sa_domain.work_product_visible(product_id)))
  OR EXISTS(SELECT FROM sa_domain.archived_designs WHERE branding_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state) AND order_id IN(SELECT sa_domain.scope_order_ids()));
 ELSE RETURN false;END CASE;
END $f$;
ALTER FUNCTION sa_domain.work_media_visible(text,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_media_visible(text,bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.work_media_visible(text,bigint) TO sa_executor;
ALTER POLICY squad_work_media ON sa_media.references USING((SELECT NOT sa_domain.catalog_enabled()) AND sa_domain.work_media_visible(resource,record_id));
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
