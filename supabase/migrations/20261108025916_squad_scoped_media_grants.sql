BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
GRANT USAGE ON SCHEMA sa_media TO sa_guard;
GRANT SELECT ON sa_media.objects,sa_media.references TO sa_guard;
CREATE POLICY squad_media_objects_guard ON sa_media.objects FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_media_references_guard ON sa_media.references FOR SELECT TO sa_guard USING(true);
GRANT SELECT ON sa_domain.design_owners TO sa_guard;
CREATE POLICY squad_media_design_owners ON sa_domain.design_owners FOR SELECT TO sa_guard USING(true);
-- The allowlist also covers embedded legacy links discovered by the inventory.
-- It never permits a caller-selected database column or arbitrary SQL identifier.
CREATE FUNCTION sa_domain.media_fields() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT '{"add_ons":["image"],"asset_infos":["asset"],"authorized_brands":["logo"],"base_product_types":["image"],"base_products":["image"],"brandings":["image","mockup_image","attachment","comment"],"bulk_uploads":["file"],"catalogues":["url"],"fabrics":["image"],"product_images":["image"],"products":["images","comment"],"promotional_banners":["image"],"promotions":["thumbnail","link"],"rmp_categories":["image"],"rmp_classes":["image_1","image_2","image_3","image_4","image_5","image_1_thumb","image_2_thumb","image_3_thumb","image_4_thumb","image_5_thumb","embeded_video"],"users":["profile_image"],"orders":["comment"],"items":["comment"],"tasks":["note"]}'::jsonb
$f$;
DO $f$ DECLARE resource_ text;fields_ jsonb;columns_ text;BEGIN
 FOR resource_,fields_ IN SELECT * FROM jsonb_each(sa_domain.media_fields()) LOOP
  SELECT string_agg(quote_ident(value),',') INTO columns_ FROM jsonb_array_elements_text(fields_);
  EXECUTE format('GRANT SELECT(id,%s) ON sa_snapshot_20261019.%I TO sa_guard',columns_,'sa_'||resource_);
  EXECUTE format('CREATE POLICY squad_media_guard ON sa_snapshot_20261019.%I FOR SELECT TO sa_guard USING(true)','sa_'||resource_);
 END LOOP;
END $f$;
GRANT SELECT(id,is_deleted) ON sa_snapshot_20261019.sa_base_products,sa_snapshot_20261019.sa_base_product_types,sa_snapshot_20261019.sa_fabrics,sa_snapshot_20261019.sa_add_ons,sa_snapshot_20261019.sa_asset_infos,sa_snapshot_20261019.sa_authorized_brands,sa_snapshot_20261019.sa_rmp_classes,sa_snapshot_20261019.sa_rmp_categories,sa_snapshot_20261019.sa_promotions TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_base_product_asset_infos,sa_snapshot_20261019.sa_rmp_skus,sa_snapshot_20261019.sa_promotional_banners TO sa_guard;
CREATE POLICY squad_media_asset_links ON sa_snapshot_20261019.sa_base_product_asset_infos FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_media_skus ON sa_snapshot_20261019.sa_rmp_skus FOR SELECT TO sa_guard USING(true);
GRANT SELECT(user_id,is_expired) ON sa_snapshot_20261019.sa_catalogues TO sa_guard;
GRANT SELECT(user_id) ON sa_snapshot_20261019.sa_bulk_uploads TO sa_guard;
GRANT SELECT(created_by_id) ON sa_snapshot_20261019.sa_tasks TO sa_guard;

-- A disabled catalogue capability does not expose unrelated owned presets;
-- assigned work keeps its historical material/artwork access.
CREATE OR REPLACE FUNCTION sa_domain.work_product_visible(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_products p CROSS JOIN sa_domain.actor() a WHERE p.id=p_id AND
 (a.role_id=0 OR(p.created_by_id=a.user_id AND(sa_domain.effective_capabilities(a.role_id,a.features)->>'catalogue')::boolean)
 OR p.id IN(SELECT product_id FROM sa_snapshot_20261019.sa_items WHERE id IN(SELECT sa_domain.scope_item_ids()))))
$f$;
CREATE FUNCTION sa_domain.media_allowed(p_resource text,p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.ops_context();a sa_domain.actor;browse_ boolean;exists_ boolean;
BEGIN
 IF NOT sa_domain.media_fields()?p_resource OR p_id IS NULL OR p_id<1 THEN RETURN false;END IF;
 IF(context_->>'platform')::boolean THEN
  -- Printing Tracker authority covers its masters and operational files only.
  IF p_resource NOT IN('add_ons','asset_infos','authorized_brands','base_product_types','base_products','fabrics','promotional_banners','promotions','rmp_categories','rmp_classes','bulk_uploads','catalogues') THEN RETURN false;END IF;
  IF p_resource='catalogues' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_catalogues WHERE id=p_id AND is_expired IS NOT TRUE);END IF;
  EXECUTE format('SELECT EXISTS(SELECT FROM sa_snapshot_20261019.%I WHERE id=$1)','sa_'||p_resource) INTO exists_ USING p_id;RETURN exists_;
 END IF;
 a:=sa_domain.actor();
 -- catalog_enabled is the existing canonical browse capability calculation.
 browse_:=sa_domain.catalog_enabled();
 CASE p_resource
 WHEN 'users' THEN RETURN sa_domain.can_person(p_id);
 WHEN 'orders' THEN RETURN p_id IN(SELECT sa_domain.scope_order_ids());
 WHEN 'items' THEN RETURN p_id IN(SELECT sa_domain.scope_item_ids());
 WHEN 'tasks' THEN RETURN sa_domain.has_capability('notes') AND (p_id IN(SELECT sa_domain.managed_task_ids()) OR p_id IN(SELECT sa_domain.assigned_task_ids()));
 WHEN 'products' THEN RETURN sa_domain.work_product_visible(p_id);
 WHEN 'product_images' THEN RETURN sa_domain.work_media_visible(p_resource,p_id);
 WHEN 'brandings' THEN RETURN sa_domain.work_media_visible(p_resource,p_id) OR(browse_ AND EXISTS(SELECT FROM sa_domain.design_owners WHERE branding_id=p_id AND actor_id=a.auth_id AND generation=(SELECT generation FROM sa_domain.runtime_state)));
 WHEN 'catalogues' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_catalogues WHERE id=p_id AND is_expired IS NOT TRUE AND(user_id=a.user_id OR a.role_id=0)) AND (a.role_id=0 OR (sa_domain.effective_capabilities(a.role_id,a.features)->>'documents')::boolean);
 WHEN 'bulk_uploads' THEN RETURN a.role_id=0 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_bulk_uploads WHERE id=p_id);
 WHEN 'promotions' THEN RETURN (sa_domain.effective_capabilities(a.role_id,a.features)->>'promotions')::boolean AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_promotions WHERE id=p_id AND is_deleted IS NOT TRUE);
 WHEN 'promotional_banners' THEN RETURN browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_promotional_banners b WHERE b.id=p_id AND b.is_deleted IS NOT TRUE
  AND(b.rmp_brand_id IS NULL OR b.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids()))
  AND(b.rmp_class_id IS NULL OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_classes c WHERE c.id=b.rmp_class_id AND c.is_deleted IS NOT TRUE AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus sku WHERE sku.rmp_class_id=c.id AND sku.is_deleted IS NOT TRUE AND sku.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids())))));
 WHEN 'rmp_classes' THEN RETURN (browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_classes c WHERE id=p_id AND is_deleted IS NOT TRUE
  AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus s WHERE s.rmp_class_id=c.id AND s.is_deleted IS NOT TRUE AND s.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids())))) OR sa_domain.work_media_visible(p_resource,p_id);
 WHEN 'asset_infos' THEN RETURN (browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_asset_infos WHERE id=p_id AND is_deleted IS NOT TRUE)) OR EXISTS(
  SELECT FROM sa_snapshot_20261019.sa_base_product_asset_infos x WHERE x.asset_info_id=p_id AND sa_domain.work_media_visible('base_products',x.base_product_id));
 WHEN 'base_product_types' THEN RETURN browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_types WHERE id=p_id AND is_deleted IS NOT TRUE);
 WHEN 'authorized_brands' THEN RETURN browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_authorized_brands WHERE id=p_id AND is_deleted IS NOT TRUE);
 WHEN 'rmp_categories' THEN RETURN browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_categories WHERE id=p_id AND is_deleted IS NOT TRUE);
 ELSE
  EXECUTE format('SELECT EXISTS(SELECT FROM sa_snapshot_20261019.%I WHERE id=$1 AND is_deleted IS NOT TRUE)','sa_'||p_resource) INTO exists_ USING p_id;
  RETURN (browse_ AND exists_) OR sa_domain.work_media_visible(p_resource,p_id);
 END CASE;
END $f$;
ALTER FUNCTION sa_domain.media_allowed(text,bigint) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.media_leaf(p_value text,p_pointer text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE node_ jsonb;pointer_ text:=split_part(p_pointer,'#text:',1);segment_ text;value_ text;range_ text[];start_ integer;end_ integer;
BEGIN
 IF p_value IS NULL OR length(p_pointer)>1024 OR octet_length(p_value)>1048576 THEN RETURN NULL;END IF;
 IF pointer_='' THEN value_:=p_value;
 ELSE
  IF left(pointer_,1)<>'/' THEN RETURN NULL;END IF;
  BEGIN node_:=p_value::jsonb;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END;
  FOREACH segment_ IN ARRAY string_to_array(substring(pointer_ FROM 2),'/') LOOP
   IF segment_~'~([^01]|$)' THEN RETURN NULL;END IF;
   segment_:=replace(replace(segment_,'~1','/'),'~0','~');
   IF jsonb_typeof(node_)='array' THEN
    IF segment_ !~ '^(0|[1-9][0-9]{0,8})$' THEN RETURN NULL;END IF;node_:=node_->segment_::integer;
   ELSE node_:=node_->segment_;END IF;
  END LOOP;
  IF jsonb_typeof(node_)<>'string' THEN RETURN NULL;END IF;value_:=node_#>>'{}';
 END IF;
 IF strpos(p_pointer,'#text:')>0 THEN
  range_:=regexp_match(p_pointer,'#text:([0-9]{1,7}):([0-9]{1,7})$');IF range_ IS NULL THEN RETURN NULL;END IF;
  start_:=range_[1]::integer;end_:=range_[2]::integer;IF end_<=start_ OR end_>length(value_) THEN RETURN NULL;END IF;
  value_:=substring(value_ FROM start_+1 FOR end_-start_);
 END IF;
 RETURN value_;
END $f$;
CREATE FUNCTION sa_domain.account_media_resolve(p_references jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ref_ jsonb;resource_ text;id_ bigint;field_ text;pointer_ text;source_ text;leaf_ text;r record;result_ jsonb:='[]';descriptor_ jsonb;
BEGIN
 PERFORM sa_domain.ops_context();
 IF jsonb_typeof(p_references) IS DISTINCT FROM 'array' OR jsonb_array_length(p_references) NOT BETWEEN 1 AND 25 OR octet_length(p_references::text)>32768 THEN RAISE EXCEPTION 'Resolve 1..25 media references within 32KB' USING ERRCODE='22023';END IF;
 FOR ref_ IN SELECT value FROM jsonb_array_elements(p_references) LOOP
  PERFORM sa_domain.check_fields(ref_,ARRAY['resource','record_id','field','pointer']);
  resource_:=ref_->>'resource';field_:=ref_->>'field';pointer_:=coalesce(ref_->>'pointer','');id_:=sa_domain.input_id(ref_->'record_id');
  IF NOT coalesce(sa_domain.media_fields()->resource_?field_,false) OR length(pointer_)>1024 OR(ref_?'pointer' AND jsonb_typeof(ref_->'pointer')<>'string') THEN RAISE EXCEPTION 'Unsupported media reference' USING ERRCODE='22023';END IF;
  IF NOT sa_domain.media_allowed(resource_,id_) THEN RAISE EXCEPTION 'Media not found' USING ERRCODE='P0002';END IF;
  EXECUTE format('SELECT %I::text FROM sa_snapshot_20261019.%I WHERE id=$1',field_,'sa_'||resource_) INTO source_ USING id_;
  leaf_:=sa_domain.media_leaf(source_,pointer_);
  SELECT x.status,x.source_value,x.source_url,o.object_path,o.bytes,o.content_type INTO r FROM sa_media.references x LEFT JOIN sa_media.objects o USING(sha256)
  WHERE x.resource=resource_ AND x.record_id=id_ AND x.field=field_ AND x.pointer=pointer_ AND x.source_value=leaf_;
  descriptor_:=jsonb_build_object('resource',resource_,'record_id',id_::text,'field',field_,'pointer',pointer_,
   'status',CASE WHEN nullif(source_,'') IS NULL OR leaf_='' THEN 'empty' WHEN leaf_ IS NULL THEN 'unavailable' WHEN r.status='ready' AND r.object_path IS NULL THEN 'unavailable' ELSE coalesce(r.status,'pending') END);
  IF r.status='ready' AND r.object_path IS NOT NULL THEN
   descriptor_:=descriptor_||jsonb_build_object('bucket','canto-media','object_path',r.object_path,'bytes',r.bytes::text,'content_type',r.content_type);
  ELSIF r.status='external' THEN
   -- Only already-supported HTTPS media providers are handed to the client.
   -- No server-side request ever follows a source URL.
   IF leaf_~*'^https://(www[.])?(youtube[.]com|youtu[.]be|drive[.]google[.]com|docs[.]google[.]com|vimeo[.]com)/[^[:space:]]*$' AND length(leaf_)<=4096 THEN
    descriptor_:=descriptor_||jsonb_build_object('url',leaf_);
   ELSE descriptor_:=descriptor_||jsonb_build_object('status','external_unavailable');END IF;
  END IF;
  result_:=result_||jsonb_build_array(descriptor_);
 END LOOP;
 RETURN jsonb_build_object('references',result_,'expires_in',120,'generation',(SELECT generation::text FROM sa_domain.runtime_state),'as_of',now());
END $f$;
ALTER FUNCTION sa_domain.account_media_resolve(jsonb) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.media_fields(),sa_domain.media_leaf(text,text),sa_domain.media_allowed(text,bigint),sa_domain.account_media_resolve(jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.media_fields(),sa_domain.media_leaf(text,text),sa_domain.media_allowed(text,bigint) TO sa_guard,sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.catalog_enabled(),sa_domain.catalog_brand_ids(),sa_domain.effective_capabilities(integer,jsonb),sa_domain.has_capability(text),sa_domain.managed_task_ids(),sa_domain.assigned_task_ids(),sa_domain.check_fields(jsonb,text[]),sa_domain.input_id(jsonb) TO sa_guard;
CREATE FUNCTION canto_api.account_media_resolve(p_references jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_media_resolve(p_references) $f$;
REVOKE ALL ON FUNCTION canto_api.account_media_resolve(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION canto_api.account_media_resolve(jsonb),sa_domain.account_media_resolve(jsonb) TO sa_app,authenticated;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
