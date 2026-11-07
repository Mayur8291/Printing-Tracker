BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;

CREATE FUNCTION sa_domain.catalog_media_batch(p_resource text,p_rows jsonb,p_fields text[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 WITH records AS(SELECT value row FROM jsonb_array_elements(p_rows)), fields AS(
 SELECT (r.row->>'id') id,f.field,jsonb_build_object('resource',p_resource,'record_id',r.row->>'id','field',f.field,
 'status',CASE WHEN nullif(r.row->>f.field,'') IS NULL THEN 'empty' ELSE coalesce(m.status,'pending') END) descriptor
 FROM records r CROSS JOIN unnest(p_fields) f(field)
 LEFT JOIN sa_media.references m ON m.resource=p_resource AND m.record_id=(r.row->>'id')::bigint AND m.field=f.field AND m.pointer='' AND m.source_value=r.row->>f.field
 ),grouped AS(SELECT id,jsonb_object_agg(field,descriptor) fields FROM fields GROUP BY id)
 SELECT coalesce(jsonb_object_agg(id,fields),'{}') FROM grouped
$f$;
CREATE FUNCTION sa_domain.base_json(b jsonb,p_media jsonb,p_cost boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',b->>'id','name',b->'name','position',b->'position','base_type_id',b->>'base_product_type_id',
 'size_type_id',b->>'size_type_id','branding_sides',b->'branding_sides','image',p_media->'image')
 || CASE WHEN p_cost THEN jsonb_build_object('costs',jsonb_build_object('stitching_of',b->>'base_of','stitching_sn',b->>'base_sn',
 'trims',b->>'tims_cost','adult_consumption',b->>'adult_consumption','kids_consumption',b->>'kids_consumption',
 'overhead_percentage',b->>'over_header_percentage','sample_rate',b->>'sample_rate','calculator',b->>'calculator')) ELSE '{}' END
$f$;
CREATE FUNCTION sa_domain.rmp_json(c jsonb,p_media jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',c->>'id','name',c->'name','color_id',c->>'rmp_color_id','position',c->'position',
 'images',jsonb_build_array(p_media->'image_1',p_media->'image_2',p_media->'image_3',p_media->'image_4',p_media->'image_5'),'video',p_media->'embeded_video')
$f$;
CREATE FUNCTION sa_domain.catalog_sort(p_position integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT lpad(coalesce((p_position::bigint+2147483648)::text,'4294967295'),10,'0')
$f$;
CREATE FUNCTION sa_domain.catalog_cursor(p_cursor text,p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE v jsonb;
BEGIN
 IF p_cursor IS NULL THEN RETURN NULL;END IF;
 IF length(p_cursor)>2048 THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023';END IF;
 BEGIN v:=convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023';END;
 IF v->>'scope' IS DISTINCT FROM md5(p_context::text) OR jsonb_typeof(v->'sort') IS DISTINCT FROM 'string' OR length(v->>'sort')>512 THEN
 RAISE EXCEPTION 'Cursor no longer matches this view; restart pagination' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.input_id(v->'id');RETURN v;
END $f$;
CREATE FUNCTION sa_domain.catalog_next_cursor(p_id bigint,p_sort text,p_context jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT replace(encode(convert_to(jsonb_build_object('id',p_id::text,'sort',p_sort,'scope',md5(p_context::text))::text,'UTF8'),'base64'),E'\n','')
$f$;

CREATE OR REPLACE FUNCTION sa_domain.v1_catalog_tree(p_kind text DEFAULT 'products',p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ jsonb;raw_ jsonb;page_ jsonb;media_ jsonb;r jsonb;
 resource_ text;last_ jsonb;cost_ boolean:=sa_domain.cost_visible();k text;v jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['base_type_id','category_id','search']);
 IF p_kind IS NULL OR p_kind NOT IN('types','categories','products') OR length(coalesce(p_filters->>'search',''))>100 THEN RAISE EXCEPTION 'Invalid catalogue query' USING ERRCODE='22023';END IF;
 IF p_kind<>'products' AND p_filters-'search'<>'{}'::jsonb THEN RAISE EXCEPTION 'These filters only apply to products' USING ERRCODE='22023';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_filters) LOOP
 IF k='search' THEN IF jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
 ELSE PERFORM sa_domain.input_id(v);END IF;END LOOP;
 ctx:=sa_domain.page_context('catalog.ordered.'||p_kind,p_filters);after_:=sa_domain.catalog_cursor(p_cursor,ctx);
 resource_:=CASE p_kind WHEN 'products' THEN 'base_products' WHEN 'types' THEN 'base_product_types' ELSE 'categories' END;
 WITH scan AS MATERIALIZED(SELECT id,row,sort_key FROM(
 SELECT b.id,to_jsonb(b) row,sa_domain.catalog_sort(b.position) sort_key FROM sa_snapshot_20261019.sa_base_products b
 WHERE p_kind='products' AND b.is_deleted IS NOT TRUE AND (NOT p_filters?'base_type_id' OR b.base_product_type_id=(p_filters->>'base_type_id')::bigint)
 AND (NOT p_filters?'category_id' OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_categories j WHERE j.base_product_id=b.id AND j.category_id=(p_filters->>'category_id')::bigint AND j.is_deleted IS NOT TRUE))
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(b.name),lower(p_filters->>'search'))>0)
 UNION ALL SELECT t.id,to_jsonb(t),sa_domain.catalog_sort(t.position) FROM sa_snapshot_20261019.sa_base_product_types t WHERE p_kind='types' AND t.is_deleted IS NOT TRUE
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(t.name),lower(p_filters->>'search'))>0)
 UNION ALL SELECT c.id,to_jsonb(c),lower(c.name) FROM sa_snapshot_20261019.sa_categories c WHERE p_kind='categories'
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(c.name),lower(p_filters->>'search'))>0)
 ) x WHERE after_ IS NULL OR (sort_key COLLATE "C",id)>((after_->>'sort') COLLATE "C",(after_->>'id')::bigint)
 ORDER BY sort_key COLLATE "C",id LIMIT n+1)
 SELECT coalesce(jsonb_agg(row||jsonb_build_object('_sort',sort_key) ORDER BY sort_key COLLATE "C",id),'[]') INTO raw_ FROM scan;
 SELECT coalesce(jsonb_agg(x.value ORDER BY x.ordinality),'[]') INTO page_ FROM jsonb_array_elements(raw_) WITH ORDINALITY x WHERE ordinality<=n;
 media_:=sa_domain.catalog_media_batch(resource_,page_,ARRAY['image']);
 SELECT coalesce(jsonb_agg(CASE WHEN p_kind='products' THEN sa_domain.base_json(x.value,media_->(x.value->>'id'),cost_)
 ELSE jsonb_build_object('id',x.value->>'id','name',x.value->'name','position',x.value->'position','image',media_->(x.value->>'id')->'image') END ORDER BY x.ordinality),'[]') INTO r FROM jsonb_array_elements(page_) WITH ORDINALITY x;
 last_:=page_->(jsonb_array_length(page_)-1);
 RETURN jsonb_build_object('data',r,'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.catalog_next_cursor((last_->>'id')::bigint,last_->>'_sort',ctx) END);
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_base_product_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();r jsonb;media_ jsonb;
BEGIN
 SELECT to_jsonb(b) INTO r FROM sa_snapshot_20261019.sa_base_products b WHERE id=p_id AND is_deleted IS NOT TRUE;
 IF r IS NULL THEN RAISE EXCEPTION 'Base product not found' USING ERRCODE='P0002';END IF;
 media_:=sa_domain.catalog_media_batch('base_products',jsonb_build_array(r),ARRAY['image']);
 RETURN sa_domain.base_json(r,media_->(r->>'id'),sa_domain.cost_visible());
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_rmp_search(p_filters jsonb DEFAULT '{}',p_customer_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);commercial jsonb:=sa_domain.commercial_context(p_customer_id);
 ctx jsonb;after_ jsonb;raw_ jsonb;page_ jsonb;media_ jsonb;r jsonb;last_ jsonb;
BEGIN
 IF a.role_id=2 THEN RAISE EXCEPTION 'Ready-made catalogue is not available for this role' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.validate_catalog_filters(p_filters);
 ctx:=sa_domain.page_context('catalog.rmp.ordered',jsonb_build_object('filters',p_filters,'commercial',commercial));after_:=sa_domain.catalog_cursor(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT c.*,sa_domain.catalog_sort(c.position) _sort FROM sa_snapshot_20261019.sa_rmp_classes c
 WHERE c.is_deleted IS NOT TRUE AND (after_ IS NULL OR (sa_domain.catalog_sort(c.position) COLLATE "C",c.id)>((after_->>'sort') COLLATE "C",(after_->>'id')::bigint))
 AND (NOT p_filters?'color_id' OR c.rmp_color_id=(p_filters->>'color_id')::bigint)
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id
 JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=s.rmp_category_id
 WHERE s.rmp_class_id=c.id AND s.is_deleted IS NOT TRUE AND b.is_deleted IS NOT TRUE AND cat.is_deleted IS NOT TRUE
 AND (NOT p_filters?'brand_id' OR s.rmp_brand_id=(p_filters->>'brand_id')::bigint)
 AND (NOT p_filters?'category_id' OR s.rmp_category_id=(p_filters->>'category_id')::bigint)
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(concat_ws(' ',c.name,b.name,cat.name,s.name)),lower(p_filters->>'search'))>0))
 ORDER BY sa_domain.catalog_sort(c.position) COLLATE "C",c.id LIMIT n+1)
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s._sort COLLATE "C",s.id),'[]') INTO raw_ FROM scan s;
 SELECT coalesce(jsonb_agg(x.value ORDER BY x.ordinality),'[]') INTO page_ FROM jsonb_array_elements(raw_) WITH ORDINALITY x WHERE ordinality<=n;
 media_:=sa_domain.catalog_media_batch('rmp_classes',page_,ARRAY['image_1','image_2','image_3','image_4','image_5','embeded_video']);
 SELECT coalesce(jsonb_agg(sa_domain.rmp_json(x.value,media_->(x.value->>'id')) ORDER BY x.ordinality),'[]') INTO r FROM jsonb_array_elements(page_) WITH ORDINALITY x;
 last_:=page_->(jsonb_array_length(page_)-1);
 RETURN jsonb_build_object('data',r,'context',commercial,'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.catalog_next_cursor((last_->>'id')::bigint,last_->>'_sort',ctx) END);
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_rmp_detail(p_id bigint,p_customer_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();commercial jsonb:=sa_domain.commercial_context(p_customer_id);r jsonb;media_ jsonb;
BEGIN
 IF a.role_id=2 THEN RAISE EXCEPTION 'Ready-made catalogue is not available for this role' USING ERRCODE='42501';END IF;
 SELECT to_jsonb(c) INTO r FROM sa_snapshot_20261019.sa_rmp_classes c WHERE id=p_id AND is_deleted IS NOT TRUE;
 IF r IS NULL THEN RAISE EXCEPTION 'Product not found or unavailable' USING ERRCODE='P0002';END IF;
 media_:=sa_domain.catalog_media_batch('rmp_classes',jsonb_build_array(r),ARRAY['image_1','image_2','image_3','image_4','image_5','embeded_video']);
 RETURN sa_domain.rmp_json(r,media_->(r->>'id'))||jsonb_build_object('context',commercial);
END $f$;
REVOKE ALL ON FUNCTION sa_domain.catalog_media_batch(text,jsonb,text[]),sa_domain.base_json(jsonb,jsonb,boolean),sa_domain.rmp_json(jsonb,jsonb),
 sa_domain.catalog_sort(integer),sa_domain.catalog_cursor(text,jsonb),sa_domain.catalog_next_cursor(bigint,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.catalog_media_batch(text,jsonb,text[]),sa_domain.base_json(jsonb,jsonb,boolean),sa_domain.rmp_json(jsonb,jsonb),
 sa_domain.catalog_sort(integer),sa_domain.catalog_cursor(text,jsonb),sa_domain.catalog_next_cursor(bigint,text,jsonb) TO sa_executor;
-- Retire the old per-record DB-reading projections now that all call sites batch.
DROP FUNCTION sa_domain.base_projection(sa_snapshot_20261019.sa_base_products);
DROP FUNCTION sa_domain.rmp_projection(sa_snapshot_20261019.sa_rmp_classes);
CREATE OR REPLACE FUNCTION sa_domain.v1_configurator_options(p_base_id bigint,p_kind text,p_parent_id bigint DEFAULT NULL,p_part_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;
 show_cost boolean:=sa_domain.cost_visible();media_ jsonb;resource_ text;
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
 UNION ALL SELECT f.id,jsonb_build_object('id',f.id::text,'name',f.name,'type',f.fabric_type,'uom',f.uom,'image',to_jsonb(f.image))
 || CASE WHEN show_cost THEN jsonb_build_object('price',f.price::text,'gsm',f.gsm::text) ELSE '{}' END
 FROM sa_snapshot_20261019.sa_fabrics f WHERE p_kind='fabrics' AND f.is_deleted IS NOT TRUE
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_fabrics j WHERE j.base_product_id=p_base_id AND j.fabric_id=f.id AND j.is_deleted IS NOT TRUE)
 UNION ALL SELECT p.id,jsonb_build_object('id',p.id::text,'name',p.name,'position',p.position,'order_criteria',p.order_criteria)
 FROM sa_snapshot_20261019.sa_parts p WHERE p_kind='parts' AND p.is_deleted IS NOT TRUE
 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_parts j WHERE j.base_product_id=p_base_id AND j.part_id=p.id AND j.is_deleted IS NOT TRUE)
 UNION ALL SELECT ad.id,jsonb_build_object('id',ad.id::text,'name',ad.add_on,'has_color',ad.has_color,'selection_type',ad.select_type,'group',ad.group_name,
 'position',ad.position,'layer_sort',ad.layer_sort,'image',to_jsonb(ad.image))
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
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 IF p_kind IN('fabrics','addons') THEN
  resource_:=CASE p_kind WHEN 'fabrics' THEN 'fabrics' ELSE 'add_ons' END;
  media_:=sa_domain.catalog_media_batch(resource_,r->'data',ARRAY['image']);
  r:=r||jsonb_build_object('data',(SELECT coalesce(jsonb_agg(x.value||jsonb_build_object('image',media_->(x.value->>'id')->'image') ORDER BY x.ordinality),'[]') FROM jsonb_array_elements(r->'data') WITH ORDINALITY x));
 END IF;RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_catalog_options(p_customer_id bigint DEFAULT NULL,p_kind text DEFAULT 'brands',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);commercial jsonb:=sa_domain.commercial_context(p_customer_id);
 ctx jsonb;after_ bigint;r jsonb;media_ jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('brands','categories','sizes','price_type') THEN RAISE EXCEPTION 'Unknown catalogue selector' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('catalog.options.'||p_kind,commercial);after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT id,payload FROM(
 SELECT b.id,jsonb_build_object('id',b.id::text,'name',b.name,'position',b.position,'main_category',b.main_category,'authorized_brand_id',b.authorized_brand_id::text) payload
 FROM sa_snapshot_20261019.sa_rmp_brands b WHERE p_kind='brands' AND b.is_deleted IS NOT TRUE
 UNION ALL SELECT c.id,jsonb_build_object('id',c.id::text,'name',c.name,'position',c.position,'image',to_jsonb(c.image))
 FROM sa_snapshot_20261019.sa_rmp_categories c WHERE p_kind='categories' AND c.is_deleted IS NOT TRUE
  AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus s WHERE s.rmp_category_id=c.id AND s.is_deleted IS NOT TRUE)
 UNION ALL SELECT s.id,jsonb_build_object('id',s.id::text,'name',s.name,'position',s.position,'size_type',s.size_type)
 FROM sa_snapshot_20261019.sa_rmp_sizes s WHERE p_kind='sizes' AND s.is_deleted IS NOT TRUE
 UNION ALL SELECT t.id,jsonb_build_object('id',t.id::text,'name',t.name) FROM sa_snapshot_20261019.sa_rmp_price_types t
 WHERE p_kind='price_type' AND t.id=(commercial->>'price_type_id')::bigint
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('context',commercial,'data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 IF p_kind='categories' THEN
 media_:=sa_domain.catalog_media_batch('rmp_categories',r->'data',ARRAY['image']);
 r:=r||jsonb_build_object('data',(SELECT coalesce(jsonb_agg(x.value||jsonb_build_object('image',media_->(x.value->>'id')->'image') ORDER BY x.ordinality),'[]') FROM jsonb_array_elements(r->'data') WITH ORDINALITY x));
 END IF;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.sku_prices_batch(p_ids bigint[],p_price_type bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 WITH prices AS(
 SELECT DISTINCT ON(j.rmp_sku_id) j.rmp_sku_id,jsonb_build_object('price_id',p.id::text,'unit_price',p.price::text,'mrp',p.mrp::text,'price_type_id',t.id::text,
 'fallback',t.id IS DISTINCT FROM p_price_type) price
 FROM sa_snapshot_20261019.sa_rmp_sku_prices j JOIN sa_snapshot_20261019.sa_rmp_prices p ON p.id=j.rmp_price_id
 JOIN sa_snapshot_20261019.sa_rmp_price_types t ON t.id=p.rmp_price_type_id
 WHERE j.rmp_sku_id=ANY(p_ids) AND j.is_deleted IS NOT TRUE AND p.is_deleted IS NOT TRUE AND t.is_deleted IS NOT TRUE
 AND p.price>=0 AND (t.id=p_price_type OR t.name='Regular') ORDER BY j.rmp_sku_id,(t.id=p_price_type) DESC NULLS LAST,p.id,j.id)
 SELECT coalesce(jsonb_object_agg(rmp_sku_id::text,price),'{}') FROM prices
$f$;
REVOKE ALL ON FUNCTION sa_domain.sku_prices_batch(bigint[],bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.sku_prices_batch(bigint[],bigint) TO sa_executor;
CREATE OR REPLACE FUNCTION sa_domain.v1_rmp_variants(p_class_id bigint,p_customer_id bigint DEFAULT NULL,p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n integer:=sa_domain.page_limit(p_limit);commercial jsonb:=sa_domain.commercial_context(p_customer_id);
 ctx jsonb;after_ jsonb;raw_ jsonb;page_ jsonb;prices_ jsonb;r jsonb;last_ jsonb;
BEGIN
 IF a.role_id=2 THEN RAISE EXCEPTION 'Ready-made catalogue is not available for this role' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.validate_catalog_filters(p_filters);
 PERFORM 1 FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=p_class_id AND is_deleted IS NOT TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or unavailable' USING ERRCODE='P0002';END IF;
 ctx:=sa_domain.page_context('catalog.variants.ordered',jsonb_build_object('class_id',p_class_id,'filters',p_filters,'commercial',commercial));after_:=sa_domain.catalog_cursor(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT s.*,z.name size_name,z.position size_position,sa_domain.catalog_sort(z.position) _sort FROM sa_snapshot_20261019.sa_rmp_skus s
 JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id AND z.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id AND b.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=s.rmp_category_id AND cat.is_deleted IS NOT TRUE
 WHERE s.rmp_class_id=p_class_id AND s.is_deleted IS NOT TRUE
 AND (after_ IS NULL OR (sa_domain.catalog_sort(z.position) COLLATE "C",s.id)>((after_->>'sort') COLLATE "C",(after_->>'id')::bigint))
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(s.name),lower(p_filters->>'search'))>0)
 AND (NOT p_filters?'color_id' OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_classes c WHERE c.id=s.rmp_class_id AND c.rmp_color_id=(p_filters->>'color_id')::bigint))
 AND (NOT p_filters?'brand_id' OR s.rmp_brand_id=(p_filters->>'brand_id')::bigint)
 AND (NOT p_filters?'category_id' OR s.rmp_category_id=(p_filters->>'category_id')::bigint)
 ORDER BY sa_domain.catalog_sort(z.position) COLLATE "C",s.id LIMIT n+1)
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s._sort COLLATE "C",s.id),'[]') INTO raw_ FROM scan s;
 SELECT coalesce(jsonb_agg(x.value ORDER BY x.ordinality),'[]') INTO page_ FROM jsonb_array_elements(raw_) WITH ORDINALITY x WHERE ordinality<=n;
 prices_:=sa_domain.sku_prices_batch(ARRAY(SELECT (x->>'id')::bigint FROM jsonb_array_elements(page_) x),(commercial->>'price_type_id')::bigint);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.value->>'id','name',p.value->'name','size_id',p.value->>'rmp_size_id',
 'size_name',p.value->'size_name','size_position',p.value->'size_position','brand_id',p.value->>'rmp_brand_id','category_id',p.value->>'rmp_category_id',
 'price',prices_->(p.value->>'id'),'availability',jsonb_build_object('status','not_loaded','one_day',NULL,'three_day',NULL,'as_of',NULL)) ORDER BY p.ordinality),'[]') INTO r FROM jsonb_array_elements(page_) WITH ORDINALITY p;
 last_:=page_->(jsonb_array_length(page_)-1);
 RETURN jsonb_build_object('context',commercial,'data',r,'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.catalog_next_cursor((last_->>'id')::bigint,last_->>'_sort',ctx) END);
END $f$;

REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
