BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;

CREATE FUNCTION sa_domain.catalog_actor(p_capability text DEFAULT 'browse') RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor(); key_ text;
BEGIN
 key_:=CASE p_capability WHEN 'browse' THEN '3' WHEN 'configure' THEN '3.3' WHEN 'documents' THEN '3.2' WHEN 'promotions' THEN '3.4' END;
 IF key_ IS NULL OR NOT(a.role_id IN(0,1,3,10) OR (a.role_id=2 AND p_capability='browse')
  OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,key_))) THEN
  RAISE EXCEPTION 'Catalogue capability is not enabled' USING ERRCODE='42501';END IF;
 RETURN a;
END $f$;
CREATE FUNCTION sa_domain.catalog_enabled() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT a.role_id IN(0,1,2,3,10) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'3')) FROM sa_domain.actor() a
$f$;
CREATE FUNCTION sa_domain.cost_visible() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT a.role_id IN(0,1) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'3.3')) FROM sa_domain.actor() a
$f$;
GRANT EXECUTE ON FUNCTION sa_domain.catalog_actor(text),sa_domain.catalog_enabled(),sa_domain.cost_visible() TO sa_guard,sa_executor;

GRANT SELECT(id,rmp_price_type_id,zone_id,is_direct_deal,stock_visibility_percentage) ON sa_snapshot_20261019.sa_users TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_assigned_brands,sa_snapshot_20261019.sa_addresses,sa_snapshot_20261019.sa_cities,
 sa_snapshot_20261019.sa_rmp_price_types,sa_snapshot_20261019.sa_rmp_brands TO sa_guard;
CREATE POLICY squad_catalog_guard ON sa_snapshot_20261019.sa_assigned_brands FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_catalog_guard ON sa_snapshot_20261019.sa_addresses FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_catalog_guard ON sa_snapshot_20261019.sa_cities FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_catalog_guard ON sa_snapshot_20261019.sa_rmp_price_types FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_catalog_guard ON sa_snapshot_20261019.sa_rmp_brands FOR SELECT TO sa_guard USING(true);

-- Use persisted business relationships, never a caller-selected price class.
CREATE FUNCTION sa_domain.commercial_context(p_customer_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor(); customer_ bigint:=coalesce(p_customer_id,a.user_id);
 u record; price_ bigint; zone_ bigint; reason_ text:='regular';
BEGIN
 IF customer_<>a.user_id AND (a.role_id NOT IN(0,1,10) OR NOT sa_domain.can_person(customer_)) THEN
  RAISE EXCEPTION 'Customer context is not available' USING ERRCODE='42501';END IF;
 SELECT id,role,rmp_price_type_id,zone_id,is_direct_deal,stock_visibility_percentage INTO u
 FROM sa_snapshot_20261019.sa_users WHERE id=customer_ AND deleted_at IS NULL AND disabled IS NOT TRUE;
 IF u.id IS NULL OR (customer_<>a.user_id AND u.role NOT IN(3,10)) THEN RAISE EXCEPTION 'Customer context is not available' USING ERRCODE='42501';END IF;
 IF u.role=3 AND u.is_direct_deal IS NOT TRUE AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=u.id) THEN
  zone_:=u.zone_id;
  IF zone_ IS NULL THEN SELECT c.zone_id INTO zone_ FROM sa_snapshot_20261019.sa_addresses d JOIN sa_snapshot_20261019.sa_cities c ON lower(c.name)=lower(d.city)
    WHERE d.user_id=u.id AND d.is_primary AND d.deleted_at IS NULL ORDER BY d.id,c.id LIMIT 1;END IF;
  SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE zone_id=zone_ AND is_deleted IS NOT TRUE ORDER BY id LIMIT 1;
  IF price_ IS NOT NULL THEN reason_:='zone';END IF;
 ELSE
  SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE id=u.rmp_price_type_id AND is_deleted IS NOT TRUE;
  IF price_ IS NOT NULL THEN reason_:='assigned';END IF;
 END IF;
 IF price_ IS NULL THEN SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE name='Regular' AND is_deleted IS NOT TRUE ORDER BY id LIMIT 1;END IF;
 RETURN jsonb_build_object('customer_id',CASE WHEN u.role IN(3,10) THEN u.id::text END,'price_type_id',price_::text,'basis',reason_,
  'stock_visibility_percentage',greatest(0,least(100,coalesce(u.stock_visibility_percentage,100))),
  'generation',(SELECT generation FROM sa_domain.runtime_state));
END $f$;
ALTER FUNCTION sa_domain.commercial_context(bigint) OWNER TO sa_guard;
GRANT SELECT ON sa_domain.runtime_state TO sa_guard;
CREATE POLICY squad_runtime_guard ON sa_domain.runtime_state FOR SELECT TO sa_guard USING(true);

-- Legacy dealers with no brand assignments have unrestricted catalogue browsing.
-- Explicit assignments restrict the dealer; customer fulfillment is checked at placement.
CREATE FUNCTION sa_domain.catalog_brand_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT b.id FROM sa_snapshot_20261019.sa_rmp_brands b CROSS JOIN sa_domain.actor() a
 WHERE b.is_deleted IS NOT TRUE AND (a.role_id<>10 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_assigned_brands WHERE user_id=a.user_id)
 OR b.authorized_brand_id IN(SELECT authorized_brand_id FROM sa_snapshot_20261019.sa_assigned_brands WHERE user_id=a.user_id))
$f$;
ALTER FUNCTION sa_domain.catalog_brand_ids() OWNER TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.commercial_context(bigint),sa_domain.catalog_brand_ids() TO sa_executor;
GRANT SELECT ON sa_snapshot_20261019.sa_base_products TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_products FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_base_product_types TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_product_types FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_base_product_categories TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_product_categories FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_base_product_fabrics TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_product_fabrics FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_base_product_parts TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_product_parts FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_base_size_types TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_size_types FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_size_types TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_size_types FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_sizes TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_sizes FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_categories TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_categories FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_fabrics TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_fabrics FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_fabric_colors TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_fabric_colors FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_parts TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_parts FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_part_colors TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_part_colors FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_add_ons TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_add_ons FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_add_on_colors TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_add_on_colors FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_add_on_parts TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_add_on_parts FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_add_on_base_products TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_add_on_base_products FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_base_product_asset_infos TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_base_product_asset_infos FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_asset_infos TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_asset_infos FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_profit_margins TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_profit_margins FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_categories TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_categories FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_colors TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_colors FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_sizes TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_sizes FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_authorized_brands TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_authorized_brands FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_price_types TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_price_types FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_prices TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_prices FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_sku_prices TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_sku_prices FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_rmp_min_infos TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_min_infos FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
GRANT SELECT ON sa_snapshot_20261019.sa_colors,sa_snapshot_20261019.sa_rmp_brands,sa_snapshot_20261019.sa_rmp_skus,sa_snapshot_20261019.sa_rmp_classes TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_colors FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()) AND (created_by_id IS NULL OR created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_brands FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()) AND id IN(SELECT sa_domain.catalog_brand_ids()));
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_skus FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()) AND rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids()));
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_rmp_classes FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()) AND id IN(SELECT rmp_class_id FROM sa_snapshot_20261019.sa_rmp_skus WHERE is_deleted IS NOT TRUE));
GRANT USAGE ON SCHEMA sa_media TO sa_executor;
GRANT SELECT ON sa_media.references TO sa_executor;
CREATE POLICY squad_media_reference_read ON sa_media.references FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
-- A descriptor is not a storage grant. Media access later revalidates the resource.
CREATE FUNCTION sa_domain.catalog_media(p_resource text,p_id bigint,p_field text,p_value text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('resource',p_resource,'record_id',p_id::text,'field',p_field,'status',
  CASE WHEN nullif(p_value,'') IS NULL THEN 'empty' ELSE coalesce((SELECT r.status FROM sa_media.references r
  WHERE r.resource=p_resource AND r.record_id=p_id AND r.field=p_field AND r.pointer='' AND r.source_value=p_value),'pending') END)
$f$;
CREATE FUNCTION sa_domain.base_projection(b sa_snapshot_20261019.sa_base_products) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',b.id::text,'name',b.name,'position',b.position,'base_type_id',b.base_product_type_id::text,
 'size_type_id',b.size_type_id::text,'branding_sides',b.branding_sides,'image',sa_domain.catalog_media('base_products',b.id,'image',b.image))
 || CASE WHEN sa_domain.cost_visible() THEN jsonb_build_object('costs',jsonb_build_object('stitching_of',b.base_of::text,'stitching_sn',b.base_sn::text,
 'trims',b.tims_cost::text,'adult_consumption',b.adult_consumption::text,'kids_consumption',b.kids_consumption::text,
 'overhead_percentage',b.over_header_percentage::text,'sample_rate',b.sample_rate::text,'calculator',b.calculator::text)) ELSE '{}' END
$f$;
CREATE FUNCTION sa_domain.v1_catalog_tree(p_kind text DEFAULT 'products',p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;result jsonb;k text;v jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['base_type_id','category_id','search']);
 IF p_kind NOT IN('types','categories','products') OR p_kind IS NULL OR length(coalesce(p_filters->>'search',''))>100 THEN RAISE EXCEPTION 'Invalid catalogue query' USING ERRCODE='22023';END IF;
 IF p_kind<>'products' AND p_filters-'search'<>'{}'::jsonb THEN RAISE EXCEPTION 'These filters only apply to products' USING ERRCODE='22023';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_filters) LOOP
  IF k='search' THEN IF jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
  ELSIF v='null'::jsonb OR NOT pg_input_is_valid(v#>>'{}','bigint') OR (v#>>'{}')::bigint<1 THEN RAISE EXCEPTION 'Invalid catalogue filter' USING ERRCODE='22023';END IF;
 END LOOP;
 ctx:=sa_domain.page_context('catalog.'||p_kind,p_filters);after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(
 SELECT id,payload FROM (
 SELECT b.id,sa_domain.base_projection(b) payload FROM sa_snapshot_20261019.sa_base_products b
 WHERE p_kind='products' AND b.is_deleted IS NOT TRUE AND (NOT p_filters?'base_type_id' OR b.base_product_type_id=(p_filters->>'base_type_id')::bigint)
 AND (NOT p_filters?'category_id' OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_categories j WHERE j.base_product_id=b.id AND j.category_id=(p_filters->>'category_id')::bigint AND j.is_deleted IS NOT TRUE))
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(b.name),lower(p_filters->>'search'))>0)
 UNION ALL SELECT t.id,jsonb_build_object('id',t.id::text,'name',t.name,'position',t.position,'image',sa_domain.catalog_media('base_product_types',t.id,'image',t.image))
 FROM sa_snapshot_20261019.sa_base_product_types t WHERE p_kind='types' AND t.is_deleted IS NOT TRUE AND (coalesce(p_filters->>'search','')='' OR strpos(lower(t.name),lower(p_filters->>'search'))>0)
 UNION ALL SELECT c.id,jsonb_build_object('id',c.id::text,'name',c.name) FROM sa_snapshot_20261019.sa_categories c WHERE p_kind='categories' AND (coalesce(p_filters->>'search','')='' OR strpos(lower(c.name),lower(p_filters->>'search'))>0)
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO result FROM page;
 RETURN result;
END $f$;
CREATE FUNCTION sa_domain.v1_base_product_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();r jsonb;
BEGIN
 SELECT sa_domain.base_projection(b) INTO r FROM sa_snapshot_20261019.sa_base_products b WHERE id=p_id AND is_deleted IS NOT TRUE;
 IF r IS NULL THEN RAISE EXCEPTION 'Base product not found' USING ERRCODE='P0002';END IF;
 RETURN r;
END $f$;

-- Price links, not the denormalized rmp_prices.rmp_sku_id, are authoritative.
CREATE FUNCTION sa_domain.sku_price(p_sku_id bigint,p_price_type bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('price_id',p.id::text,'unit_price',p.price::text,'mrp',p.mrp::text,'price_type_id',t.id::text,
  'fallback',t.id IS DISTINCT FROM p_price_type)
 FROM sa_snapshot_20261019.sa_rmp_sku_prices j JOIN sa_snapshot_20261019.sa_rmp_prices p ON p.id=j.rmp_price_id
 JOIN sa_snapshot_20261019.sa_rmp_price_types t ON t.id=p.rmp_price_type_id
 WHERE j.rmp_sku_id=p_sku_id AND j.is_deleted IS NOT TRUE AND p.is_deleted IS NOT TRUE AND t.is_deleted IS NOT TRUE
 AND p.price>=0 AND (t.id=p_price_type OR t.name='Regular') ORDER BY (t.id=p_price_type) DESC NULLS LAST,p.id,j.id LIMIT 1
$f$;
CREATE FUNCTION sa_domain.v1_catalog_options(p_customer_id bigint DEFAULT NULL,p_kind text DEFAULT 'brands',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);commercial jsonb:=sa_domain.commercial_context(p_customer_id);
 ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('brands','categories','sizes','price_type') THEN RAISE EXCEPTION 'Unknown catalogue selector' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('catalog.options.'||p_kind,commercial);after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT id,payload FROM(
 SELECT b.id,jsonb_build_object('id',b.id::text,'name',b.name,'position',b.position,'main_category',b.main_category,'authorized_brand_id',b.authorized_brand_id::text) payload
 FROM sa_snapshot_20261019.sa_rmp_brands b WHERE p_kind='brands' AND b.is_deleted IS NOT TRUE
 UNION ALL SELECT c.id,jsonb_build_object('id',c.id::text,'name',c.name,'position',c.position,'image',sa_domain.catalog_media('rmp_categories',c.id,'image',c.image))
 FROM sa_snapshot_20261019.sa_rmp_categories c WHERE p_kind='categories' AND c.is_deleted IS NOT TRUE
  AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus s WHERE s.rmp_category_id=c.id AND s.is_deleted IS NOT TRUE)
 UNION ALL SELECT s.id,jsonb_build_object('id',s.id::text,'name',s.name,'position',s.position,'size_type',s.size_type)
 FROM sa_snapshot_20261019.sa_rmp_sizes s WHERE p_kind='sizes' AND s.is_deleted IS NOT TRUE
 UNION ALL SELECT t.id,jsonb_build_object('id',t.id::text,'name',t.name) FROM sa_snapshot_20261019.sa_rmp_price_types t
 WHERE p_kind='price_type' AND t.id=(commercial->>'price_type_id')::bigint
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('context',commercial,'data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 RETURN r;
END $f$;
CREATE FUNCTION sa_domain.rmp_projection(c sa_snapshot_20261019.sa_rmp_classes) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',c.id::text,'name',c.name,'color_id',c.rmp_color_id::text,'position',c.position,
  'images',jsonb_build_array(sa_domain.catalog_media('rmp_classes',c.id,'image_1',c.image_1),sa_domain.catalog_media('rmp_classes',c.id,'image_2',c.image_2),
  sa_domain.catalog_media('rmp_classes',c.id,'image_3',c.image_3),sa_domain.catalog_media('rmp_classes',c.id,'image_4',c.image_4),sa_domain.catalog_media('rmp_classes',c.id,'image_5',c.image_5)),
  'video',sa_domain.catalog_media('rmp_classes',c.id,'embeded_video',c.embeded_video))
$f$;
CREATE FUNCTION sa_domain.validate_catalog_filters(p_filters jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE k text;v jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['brand_id','category_id','color_id','search']);
 FOR k,v IN SELECT * FROM jsonb_each(p_filters) LOOP
  IF k='search' THEN IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>100 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
  ELSIF v='null'::jsonb OR NOT pg_input_is_valid(v#>>'{}','bigint') OR (v#>>'{}')::bigint<1 THEN RAISE EXCEPTION 'Invalid catalogue filter' USING ERRCODE='22023';END IF;
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.v1_rmp_search(p_filters jsonb DEFAULT '{}',p_customer_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);commercial jsonb:=sa_domain.commercial_context(p_customer_id);
 ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF a.role_id=2 THEN RAISE EXCEPTION 'Ready-made catalogue is not available for this role' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.validate_catalog_filters(p_filters);
 ctx:=sa_domain.page_context('catalog.rmp',jsonb_build_object('filters',p_filters,'commercial',commercial));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT c.* FROM sa_snapshot_20261019.sa_rmp_classes c
 WHERE c.id<after_ AND c.is_deleted IS NOT TRUE AND (NOT p_filters?'color_id' OR c.rmp_color_id=(p_filters->>'color_id')::bigint)
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id
 JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=s.rmp_category_id
 WHERE s.rmp_class_id=c.id AND s.is_deleted IS NOT TRUE AND b.is_deleted IS NOT TRUE AND cat.is_deleted IS NOT TRUE
 AND (NOT p_filters?'brand_id' OR s.rmp_brand_id=(p_filters->>'brand_id')::bigint)
 AND (NOT p_filters?'category_id' OR s.rmp_category_id=(p_filters->>'category_id')::bigint)
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(concat_ws(' ',c.name,b.name,cat.name,s.name)),lower(p_filters->>'search'))>0))
 ORDER BY c.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.rmp_projection(p) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END,'context',commercial)
 INTO r FROM page p;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_rmp_detail(p_id bigint,p_customer_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();commercial jsonb:=sa_domain.commercial_context(p_customer_id);r jsonb;
BEGIN
 IF a.role_id=2 THEN RAISE EXCEPTION 'Ready-made catalogue is not available for this role' USING ERRCODE='42501';END IF;
 SELECT sa_domain.rmp_projection(c)||jsonb_build_object('context',commercial) INTO r FROM sa_snapshot_20261019.sa_rmp_classes c WHERE id=p_id AND is_deleted IS NOT TRUE;
 IF r IS NULL THEN RAISE EXCEPTION 'Product not found or unavailable' USING ERRCODE='P0002';END IF;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_rmp_variants(p_class_id bigint,p_customer_id bigint DEFAULT NULL,p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);commercial jsonb:=sa_domain.commercial_context(p_customer_id);
 ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF a.role_id=2 THEN RAISE EXCEPTION 'Ready-made catalogue is not available for this role' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.validate_catalog_filters(p_filters);
 PERFORM 1 FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=p_class_id AND is_deleted IS NOT TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or unavailable' USING ERRCODE='P0002';END IF;
 ctx:=sa_domain.page_context('catalog.variants',jsonb_build_object('class_id',p_class_id,'filters',p_filters,'commercial',commercial));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT s.*,z.name size_name,z.position size_position FROM sa_snapshot_20261019.sa_rmp_skus s
 JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id AND z.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id AND b.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=s.rmp_category_id AND cat.is_deleted IS NOT TRUE
 WHERE s.rmp_class_id=p_class_id AND s.is_deleted IS NOT TRUE AND s.id<after_
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(s.name),lower(p_filters->>'search'))>0)
 AND (NOT p_filters?'color_id' OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_classes c WHERE c.id=s.rmp_class_id AND c.rmp_color_id=(p_filters->>'color_id')::bigint))
 AND (NOT p_filters?'brand_id' OR s.rmp_brand_id=(p_filters->>'brand_id')::bigint)
 AND (NOT p_filters?'category_id' OR s.rmp_category_id=(p_filters->>'category_id')::bigint)
 ORDER BY s.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('context',commercial,'data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'name',p.name,'size_id',p.rmp_size_id::text,
 'size_name',p.size_name,'size_position',p.size_position,'brand_id',p.rmp_brand_id::text,'category_id',p.rmp_category_id::text,
 'price',sa_domain.sku_price(p.id,(commercial->>'price_type_id')::bigint),
 'availability',jsonb_build_object('status','not_loaded','one_day',NULL,'three_day',NULL,'as_of',NULL)) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO r FROM page p;RETURN r;
END $f$;

-- Every collection is paged separately; no recursively expanded catalogue graph.
CREATE FUNCTION sa_domain.v1_configurator_options(p_base_id bigint,p_kind text,p_parent_id bigint DEFAULT NULL,p_part_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;
 show_cost boolean:=sa_domain.cost_visible();
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('categories','fabrics','fabric_colors','parts','part_colors','addons','addon_colors','size_types') THEN RAISE EXCEPTION 'Unknown configuration selector' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM sa_snapshot_20261019.sa_base_products WHERE id=p_base_id AND is_deleted IS NOT TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Base product unavailable' USING ERRCODE='P0002';END IF;
 IF p_kind IN('fabric_colors','part_colors','addons','addon_colors') AND p_parent_id IS NULL THEN RAISE EXCEPTION 'Parent selection required' USING ERRCODE='22023';END IF;
 IF p_kind='addon_colors' AND p_part_id IS NULL THEN RAISE EXCEPTION 'Part selection required' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('configure.'||p_kind,jsonb_build_object('base_id',p_base_id,'parent_id',p_parent_id,'part_id',p_part_id));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT id,payload FROM(
 SELECT c.id,jsonb_build_object('id',c.id::text,'name',c.name) payload FROM sa_snapshot_20261019.sa_categories c
 WHERE p_kind='categories' AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_categories j WHERE j.base_product_id=p_base_id AND j.category_id=c.id AND j.is_deleted IS NOT TRUE)
 UNION ALL SELECT f.id,jsonb_build_object('id',f.id::text,'name',f.name,'type',f.fabric_type,'uom',f.uom,'image',sa_domain.catalog_media('fabrics',f.id,'image',f.image))
 || CASE WHEN show_cost THEN jsonb_build_object('price',f.price::text,'gsm',f.gsm::text) ELSE '{}' END
 FROM sa_snapshot_20261019.sa_fabrics f WHERE p_kind='fabrics' AND f.is_deleted IS NOT TRUE
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_fabrics j WHERE j.base_product_id=p_base_id AND j.fabric_id=f.id AND j.is_deleted IS NOT TRUE)
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'name',p.name,'position',p.position,'order_criteria',p.order_criteria)
 FROM sa_snapshot_20261019.sa_parts p WHERE p_kind='parts' AND p.is_deleted IS NOT TRUE
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_parts j WHERE j.base_product_id=p_base_id AND j.part_id=p.id AND j.is_deleted IS NOT TRUE)
 UNION ALL SELECT ad.id,jsonb_build_object('id',ad.id::text,'name',ad.add_on,'has_color',ad.has_color,'selection_type',ad.select_type,'group',ad.group_name,
 'position',ad.position,'layer_sort',ad.layer_sort,'image',sa_domain.catalog_media('add_ons',ad.id,'image',ad.image))
 || CASE WHEN show_cost THEN jsonb_build_object('price',ad.add_on_price::text,'of',ad.add_on_of::text,'sn',ad.add_on_sn::text) ELSE '{}' END
 FROM sa_snapshot_20261019.sa_add_ons ad WHERE p_kind='addons' AND ad.is_deleted IS NOT TRUE
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_on_parts j JOIN sa_snapshot_20261019.sa_parts p ON p.id=j.part_id AND p.is_deleted IS NOT TRUE
  JOIN sa_snapshot_20261019.sa_base_product_parts bp ON bp.part_id=p.id AND bp.base_product_id=p_base_id AND bp.is_deleted IS NOT TRUE
  WHERE j.add_on_id=ad.id AND j.part_id=p_parent_id AND j.is_deleted IS NOT TRUE)
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_on_base_products j WHERE j.add_on_id=ad.id AND j.base_product_id=p_base_id AND j.is_deleted IS NOT TRUE)
 UNION ALL SELECT c.id,jsonb_build_object('id',c.id::text,'name',c.name,'hex',c.hex_code) FROM sa_snapshot_20261019.sa_colors c WHERE c.is_deleted IS NOT TRUE AND (
 (p_kind='fabric_colors' AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_fabric_colors j JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=j.fabric_id AND f.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_base_product_fabrics b ON b.fabric_id=f.id AND b.base_product_id=p_base_id AND b.is_deleted IS NOT TRUE WHERE j.color_id=c.id AND j.fabric_id=p_parent_id AND j.is_deleted IS NOT TRUE))
 OR(p_kind='part_colors' AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_part_colors j JOIN sa_snapshot_20261019.sa_parts p ON p.id=j.part_id AND p.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_base_product_parts b ON b.part_id=p.id AND b.base_product_id=p_base_id AND b.is_deleted IS NOT TRUE WHERE j.color_id=c.id AND j.part_id=p_parent_id AND j.is_deleted IS NOT TRUE))
 OR(p_kind='addon_colors' AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_on_colors j JOIN sa_snapshot_20261019.sa_add_ons ad ON ad.id=j.add_on_id AND ad.is_deleted IS NOT TRUE AND ad.has_color
 JOIN sa_snapshot_20261019.sa_add_on_parts ap ON ap.add_on_id=ad.id AND ap.part_id=p_part_id AND ap.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_base_product_parts bp ON bp.part_id=ap.part_id AND bp.base_product_id=p_base_id AND bp.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_parts p ON p.id=bp.part_id AND p.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_add_on_base_products ab ON ab.add_on_id=ad.id AND ab.base_product_id=p_base_id AND ab.is_deleted IS NOT TRUE
 WHERE j.color_id=c.id AND j.add_on_id=p_parent_id AND j.is_deleted IS NOT TRUE)))
 UNION ALL SELECT st.id,jsonb_build_object('id',st.id::text,'name',st.name) FROM sa_snapshot_20261019.sa_size_types st WHERE p_kind='size_types' AND st.is_deleted IS NOT TRUE
 AND (EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_size_types b WHERE b.base_product_id=p_base_id AND b.size_type_id=st.id AND b.is_deleted IS NOT TRUE)
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=p_base_id AND b.size_type_id=st.id))
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;

CREATE INDEX squad_rmp_sku_catalog ON sa_snapshot_20261019.sa_rmp_skus(rmp_class_id,rmp_brand_id,rmp_category_id,id DESC) WHERE is_deleted IS NOT TRUE;
CREATE INDEX squad_sku_price_links ON sa_snapshot_20261019.sa_rmp_sku_prices(rmp_sku_id,rmp_price_id) WHERE is_deleted IS NOT TRUE;
CREATE INDEX squad_base_catalog ON sa_snapshot_20261019.sa_base_products(base_product_type_id,id DESC) WHERE is_deleted IS NOT TRUE;

DO $do$ DECLARE f record;arguments_ text;body_ text; BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_catalog_tree','v1_base_product_get','v1_catalog_options','v1_rmp_search','v1_rmp_detail','v1_rmp_variants','v1_configurator_options']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  EXECUTE format('ALTER FUNCTION %s SET timezone=''UTC''',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
 AND p.proname=ANY(ARRAY['catalog_media','base_projection','sku_price','rmp_projection','validate_catalog_filters']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE ALL ON FUNCTION sa_domain.catalog_actor(text),sa_domain.catalog_enabled(),sa_domain.cost_visible(),sa_domain.commercial_context(bigint),sa_domain.catalog_brand_ids() FROM PUBLIC,anon,authenticated,sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
