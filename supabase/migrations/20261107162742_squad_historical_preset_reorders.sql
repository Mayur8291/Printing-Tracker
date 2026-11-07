BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor,sa_guard;
-- This private projection returns active IDs only. The caller first loads the
-- exact preset through executor RLS; arbitrary configurations get no exception.
-- Private colours remain absent from other users' configurator selectors.
GRANT SELECT(id,is_deleted) ON sa_snapshot_20261019.sa_colors TO sa_guard;
CREATE POLICY squad_guard_active_color ON sa_snapshot_20261019.sa_colors FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.active_preset_colors(p_ids bigint[]) RETURNS bigint[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.actor();
 IF cardinality(p_ids)>500 THEN RAISE EXCEPTION 'Preset colour budget exceeded' USING ERRCODE='22023';END IF;
 RETURN (SELECT coalesce(array_agg(id),'{}') FROM sa_snapshot_20261019.sa_colors WHERE id=ANY(p_ids) AND is_deleted IS NOT TRUE);
END $f$;
ALTER FUNCTION sa_domain.active_preset_colors(bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.active_preset_colors(bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.active_preset_colors(bigint[]) TO sa_executor;
CREATE FUNCTION sa_domain.normalize_configuration(p_config jsonb,p_preset_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE base_ bigint;fabric_ bigint;color_ bigint;category_ bigint;part_ jsonb;addon_ jsonb;parts_ jsonb:='[]';addons_ jsonb;
 part_id_ bigint;part_color_ bigint;addon_id_ bigint;addon_color_ bigint;part_join_ bigint;addon_join_ bigint;ad record;groups_ text[];seen_ bigint[]:='{}';seen_ad_ bigint[];
 colors_ bigint[];requested_colors_ bigint[];preset_ jsonb;
BEGIN
 IF p_preset_id IS NOT NULL THEN
  preset_:=sa_domain.product_configuration(p_preset_id);
  IF preset_ IS NULL OR preset_ IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'Preset is unavailable or its configuration changed' USING ERRCODE='P0002';END IF;
 END IF;
 SELECT coalesce(array_agg(DISTINCT sa_domain.input_id(value)),'{}') INTO requested_colors_ FROM(
  SELECT p_config->'fabric_color_id' value UNION ALL SELECT jsonb_path_query(p_config,'$.parts[*].color_id') UNION ALL SELECT jsonb_path_query(p_config,'$.parts[*].addons[*].color_id')
 ) x WHERE value IS NOT NULL AND value<>'null';
 IF p_preset_id IS NOT NULL THEN colors_:=sa_domain.active_preset_colors(requested_colors_);
 ELSE SELECT coalesce(array_agg(id),'{}') INTO colors_ FROM sa_snapshot_20261019.sa_colors WHERE id=ANY(requested_colors_) AND is_deleted IS NOT TRUE;END IF;
 PERFORM sa_domain.check_fields(p_config,ARRAY['base_product_id','fabric_id','fabric_color_id','category_id','parts']);
 base_:=sa_domain.input_id(p_config->'base_product_id');fabric_:=sa_domain.input_id(p_config->'fabric_id');color_:=sa_domain.input_id(p_config->'fabric_color_id');category_:=sa_domain.input_id(p_config->'category_id');
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=base_ AND b.is_deleted IS NOT TRUE)
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_categories j WHERE j.base_product_id=base_ AND j.category_id=category_ AND j.is_deleted IS NOT TRUE)
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_fabrics j JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=j.fabric_id AND f.is_deleted IS NOT TRUE WHERE j.base_product_id=base_ AND j.fabric_id=fabric_ AND j.is_deleted IS NOT TRUE)
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_fabric_colors j WHERE j.fabric_id=fabric_ AND j.color_id=color_ AND color_=ANY(colors_) AND j.is_deleted IS NOT TRUE)
 THEN RAISE EXCEPTION 'Invalid or unavailable base, category, fabric or color combination' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(coalesce(p_config->'parts','[]'))<>'array' OR jsonb_array_length(coalesce(p_config->'parts','[]'))>50 THEN RAISE EXCEPTION 'At most 50 parts are allowed' USING ERRCODE='22023';END IF;
 FOR part_ IN SELECT value FROM jsonb_array_elements(coalesce(p_config->'parts','[]')) LOOP
  PERFORM sa_domain.check_fields(part_,ARRAY['part_id','color_id','color_link_id','addons']);part_id_:=sa_domain.input_id(part_->'part_id');part_color_:=sa_domain.input_id(part_->'color_id');
  IF part_id_=ANY(seen_) THEN RAISE EXCEPTION 'Duplicate part' USING ERRCODE='22023';END IF;seen_:=array_append(seen_,part_id_);
  SELECT pc.id INTO part_join_ FROM sa_snapshot_20261019.sa_part_colors pc
   JOIN sa_snapshot_20261019.sa_parts p ON p.id=pc.part_id AND p.is_deleted IS NOT TRUE
   JOIN sa_snapshot_20261019.sa_base_product_parts bp ON bp.part_id=p.id AND bp.base_product_id=base_ AND bp.is_deleted IS NOT TRUE
   WHERE pc.part_id=part_id_ AND pc.color_id=part_color_ AND part_color_=ANY(colors_) AND pc.is_deleted IS NOT TRUE ORDER BY pc.id LIMIT 1;
  IF part_join_ IS NULL THEN RAISE EXCEPTION 'Invalid part or color combination' USING ERRCODE='22023';END IF;
  IF jsonb_typeof(coalesce(part_->'addons','[]'))<>'array' OR jsonb_array_length(coalesce(part_->'addons','[]'))>30 THEN RAISE EXCEPTION 'At most 30 add-ons per part are allowed' USING ERRCODE='22023';END IF;
  addons_:='[]';seen_ad_:='{}';groups_:='{}';
  FOR addon_ IN SELECT value FROM jsonb_array_elements(coalesce(part_->'addons','[]')) LOOP
   PERFORM sa_domain.check_fields(addon_,ARRAY['addon_id','color_id','color_link_id']);addon_id_:=sa_domain.input_id(addon_->'addon_id');addon_join_:=NULL;
   IF addon_id_=ANY(seen_ad_) THEN RAISE EXCEPTION 'Duplicate add-on' USING ERRCODE='22023';END IF;seen_ad_:=array_append(seen_ad_,addon_id_);
   SELECT x.id,x.has_color,x.group_name,x.select_type INTO ad FROM sa_snapshot_20261019.sa_add_ons x
   WHERE x.id=addon_id_ AND x.is_deleted IS NOT TRUE
   AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_on_parts j WHERE j.part_id=part_id_ AND j.add_on_id=x.id AND j.is_deleted IS NOT TRUE)
   AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_on_base_products j WHERE j.base_product_id=base_ AND j.add_on_id=x.id AND j.is_deleted IS NOT TRUE);
   IF ad.id IS NULL THEN RAISE EXCEPTION 'Add-on is not compatible with this base and part' USING ERRCODE='22023';END IF;
   IF ad.select_type=0 AND coalesce(ad.group_name,'')=ANY(groups_) THEN RAISE EXCEPTION 'Only one add-on from a single-selection group is allowed' USING ERRCODE='22023';END IF;
   IF ad.select_type=0 THEN groups_:=array_append(groups_,coalesce(ad.group_name,''));END IF;
   IF ad.has_color THEN
    addon_color_:=sa_domain.input_id(addon_->'color_id');
    SELECT j.id INTO addon_join_ FROM sa_snapshot_20261019.sa_add_on_colors j
     WHERE j.add_on_id=addon_id_ AND j.color_id=addon_color_ AND addon_color_=ANY(colors_) AND j.is_deleted IS NOT TRUE ORDER BY j.id LIMIT 1;
    IF addon_join_ IS NULL THEN RAISE EXCEPTION 'Invalid add-on color' USING ERRCODE='22023';END IF;
   ELSIF addon_->'color_id' IS NOT NULL AND addon_->'color_id'<>'null' THEN RAISE EXCEPTION 'This add-on does not have a color' USING ERRCODE='22023';
   ELSE addon_color_:=NULL;END IF;
   addons_:=addons_||jsonb_build_array(jsonb_build_object('addon_id',addon_id_::text,'color_id',addon_color_::text,'color_link_id',addon_join_::text));
  END LOOP;
  IF EXISTS(SELECT addon_group.group_name FROM jsonb_array_elements(addons_) x JOIN sa_snapshot_20261019.sa_add_ons addon_group ON addon_group.id=(x->>'addon_id')::bigint
   GROUP BY addon_group.group_name HAVING bool_or(addon_group.select_type=0) AND count(*)>1) THEN RAISE EXCEPTION 'Only one add-on from a single-selection group is allowed' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'addon_id')::bigint),'[]') INTO addons_ FROM jsonb_array_elements(addons_) x;
  parts_:=parts_||jsonb_build_array(jsonb_build_object('part_id',part_id_::text,'color_id',part_color_::text,'color_link_id',part_join_::text,'addons',addons_));
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'part_id')::bigint),'[]') INTO parts_ FROM jsonb_array_elements(parts_) x;
 RETURN jsonb_build_object('base_product_id',base_::text,'fabric_id',fabric_::text,'fabric_color_id',color_::text,'category_id',category_::text,'parts',parts_);
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.calculate_quote(p_request jsonb,p_catalog boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb;customer_ bigint;address_ bigint;state_ text;line_ jsonb;lines_ jsonb:='[]';quantities_ jsonb;config_ jsonb;cost_ jsonb;
 branding_ jsonb;tax_ jsonb;sku_ record;selection_ jsonb;price_ jsonb;variants_ jsonb;skus_ jsonb;seen_ bigint[];first_group_ text;group_ text;
 qty integer;qty_ integer;count_ integer:=0;line_no integer:=0;unit_ numeric;brand_unit numeric;subtotal numeric;brand_total numeric;cg numeric;sg numeric;ig numeric;
 all_sub numeric:=0;all_brand numeric:=0;all_cg numeric:=0;all_sg numeric:=0;all_ig numeric:=0;all_qty integer:=0;show_cost boolean:=sa_domain.cost_visible();
BEGIN
 PERFORM sa_domain.check_fields(p_request,ARRAY['customer_id','address_id','lines']);
 IF octet_length(p_request::text)>131072 OR jsonb_typeof(p_request->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'lines') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Provide 1..50 quote lines within 128 KB' USING ERRCODE='22023';END IF;
 IF (SELECT count(*) FROM jsonb_path_query(p_request,'$.lines[*].configuration.parts[*]'))
 +(SELECT count(*) FROM jsonb_path_query(p_request,'$.lines[*].configuration.parts[*].addons[*]'))
 +(SELECT count(*) FROM jsonb_path_query(p_request,'$.lines[*].skus[*]'))
 +(SELECT count(*) FROM jsonb_path_query(p_request,'$.lines[*].quantities[*]'))
 +(SELECT count(*) FROM jsonb_path_query(p_request,'$.lines[*].brandings[*]'))>500 THEN
 RAISE EXCEPTION 'Quote selection budget exceeded; split this request' USING ERRCODE='22023';END IF;
 IF p_request?'customer_id' AND p_request->'customer_id'<>'null' THEN customer_:=sa_domain.input_id(p_request->'customer_id');END IF;
 context_:=sa_domain.commercial_context(customer_);customer_:=(context_->>'customer_id')::bigint;
 IF NOT p_catalog THEN
  address_:=sa_domain.input_id(p_request->'address_id');state_:=sa_domain.quote_address(customer_,address_);
 END IF;
 FOR line_ IN SELECT value FROM jsonb_array_elements(p_request->'lines') LOOP
  count_:=count_+jsonb_array_length(coalesce(line_->'brandings','[]'));line_no:=line_no+1;subtotal:=0;brand_total:=0;cg:=0;sg:=0;ig:=0;variants_:='[]';cost_:=NULL;config_:=NULL;quantities_:=NULL;
  IF line_->>'kind'='custom' THEN
   PERFORM sa_domain.check_fields(line_,ARRAY['kind','configuration','preset_id','quantities','sample','brandings']);
   IF line_?'preset_id' THEN
    IF line_?'configuration' THEN RAISE EXCEPTION 'Choose an existing preset or a new configuration, not both' USING ERRCODE='22023';END IF;
    config_:=sa_domain.product_configuration(sa_domain.input_id(line_->'preset_id'));
    config_:=sa_domain.normalize_configuration(config_,sa_domain.input_id(line_->'preset_id'));
   ELSE config_:=sa_domain.normalize_configuration(line_->'configuration');END IF;
   count_:=count_+jsonb_array_length(config_->'parts')+(SELECT count(*) FROM jsonb_path_query(config_,'$.parts[*].addons[*]'));
   IF count_>500 THEN RAISE EXCEPTION 'Quote selection budget exceeded; split this request' USING ERRCODE='22023';END IF;
   quantities_:=sa_domain.normalize_quantities(line_->'quantities',line_->'sample');
   qty:=(quantities_->>'total_quantity')::int;count_:=count_+jsonb_array_length(quantities_->'quantities');
   cost_:=sa_domain.custom_price(config_,qty,(quantities_->>'sample_order')::boolean);unit_:=(cost_->>'unit_price')::numeric;
   branding_:=sa_domain.branding_price(coalesce(line_->'brandings','[]'),qty);brand_unit:=(branding_->>'unit_price')::numeric;
   subtotal:=round(unit_*qty,2);brand_total:=brand_unit*qty;
   IF NOT p_catalog THEN tax_:=sa_domain.unit_tax(unit_+brand_unit,state_);cg:=(tax_->>'cgst')::numeric*qty;sg:=(tax_->>'sgst')::numeric*qty;ig:=(tax_->>'igst')::numeric*qty;END IF;
   variants_:=jsonb_build_array(jsonb_build_object('unit_price',unit_::text,'quantity',qty,'sample_rate_applied',cost_->'sample_rate_applied'));
  ELSIF line_->>'kind'='rmp' THEN
   PERFORM sa_domain.check_fields(line_,ARRAY['kind','skus','brandings']);skus_:=line_->'skus';
   IF jsonb_typeof(skus_) IS DISTINCT FROM 'array' OR jsonb_array_length(skus_) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Provide 1..100 SKU quantities' USING ERRCODE='22023';END IF;
   qty:=0;seen_:='{}';first_group_:=NULL;
   FOR selection_ IN SELECT value FROM jsonb_array_elements(skus_) LOOP
    PERFORM sa_domain.check_fields(selection_,ARRAY['sku_id','quantity']);
    unit_:=sa_domain.input_number(selection_->'quantity',1,100000);
    IF unit_<>trunc(unit_) THEN RAISE EXCEPTION 'Quantity must be an integer' USING ERRCODE='22023';END IF;
    qty:=qty+unit_::int;IF sa_domain.input_id(selection_->'sku_id')=ANY(seen_) THEN RAISE EXCEPTION 'Duplicate SKU' USING ERRCODE='22023';END IF;
    seen_:=array_append(seen_,sa_domain.input_id(selection_->'sku_id'));
   END LOOP;
   IF qty>1000000 THEN RAISE EXCEPTION 'Maximum item quantity exceeded' USING ERRCODE='22023';END IF;
   count_:=count_+jsonb_array_length(skus_);branding_:=sa_domain.branding_price(coalesce(line_->'brandings','[]'),qty);brand_unit:=(branding_->>'unit_price')::numeric;brand_total:=brand_unit*qty;
   FOR selection_ IN SELECT value FROM jsonb_array_elements(skus_) LOOP
    qty_:=(selection_->>'quantity')::numeric::int;
    SELECT s.* INTO sku_ FROM sa_snapshot_20261019.sa_rmp_skus s
    JOIN sa_snapshot_20261019.sa_rmp_classes c ON c.id=s.rmp_class_id AND c.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id AND b.is_deleted IS NOT TRUE
    LEFT JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=s.rmp_category_id AND cat.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id AND z.is_deleted IS NOT TRUE
    WHERE s.id=(selection_->>'sku_id')::bigint AND s.is_deleted IS NOT TRUE AND (s.rmp_category_id IS NULL OR cat.id IS NOT NULL);
    IF sku_.id IS NULL THEN RAISE EXCEPTION 'SKU not found or unavailable' USING ERRCODE='P0002';END IF;
    group_:=concat_ws(':',sku_.rmp_class_id,sku_.rmp_brand_id,sku_.rmp_category_id);
    IF first_group_ IS NOT NULL AND first_group_<>group_ THEN RAISE EXCEPTION 'Each ready-made line must share class, brand and category' USING ERRCODE='22023';END IF;first_group_:=group_;
    price_:=sa_domain.sku_price(sku_.id,(context_->>'price_type_id')::bigint);
    IF price_ IS NULL THEN RAISE EXCEPTION 'No eligible price for SKU' USING ERRCODE='22023';END IF;
    unit_:=(price_->>'unit_price')::numeric;subtotal:=subtotal+unit_*qty_;
    IF NOT p_catalog THEN tax_:=sa_domain.unit_tax(unit_+brand_unit,state_,sku_.cgst,sku_.sgst,sku_.igst);
     cg:=cg+(tax_->>'cgst')::numeric*qty_;sg:=sg+(tax_->>'sgst')::numeric*qty_;ig:=ig+(tax_->>'igst')::numeric*qty_;END IF;
    variants_:=variants_||jsonb_build_array(jsonb_build_object('sku_id',sku_.id::text,'size_id',sku_.rmp_size_id::text,'class_id',sku_.rmp_class_id::text,
     'brand_id',sku_.rmp_brand_id::text,'category_id',sku_.rmp_category_id::text,'quantity',qty_,'unit_price',unit_::text,'price',price_));
   END LOOP;
   subtotal:=round(subtotal,2);
  ELSE RAISE EXCEPTION 'Unknown quote line kind' USING ERRCODE='22023';END IF;
  IF count_>500 THEN RAISE EXCEPTION 'A quote supports at most 500 quantity selections' USING ERRCODE='22023';END IF;
  all_sub:=all_sub+subtotal;all_brand:=all_brand+brand_total;all_cg:=all_cg+cg;all_sg:=all_sg+sg;all_ig:=all_ig+ig;all_qty:=all_qty+qty;
  lines_:=lines_||jsonb_build_array(jsonb_build_object('line',line_no,'kind',line_->>'kind','configuration',config_,'quantities',quantities_,
   'variants',variants_,'branding',branding_,'quantity',qty,'subtotal',subtotal::text,'branding_total',brand_total::text,
   'cgst',cg::text,'sgst',sg::text,'igst',ig::text,'total',round(subtotal+brand_total+cg+sg+ig,2)::text)
   || CASE WHEN show_cost AND cost_ IS NOT NULL THEN jsonb_build_object('costs',cost_->'costs','consumption',cost_->'consumption') ELSE '{}' END);
 END LOOP;
 RETURN jsonb_build_object('currency','INR','pricing_version','legacy-flutter-develop-5d55d946-v1','tax_included',NOT p_catalog,'context',context_,
 'address_id',address_::text,'tax_state',state_,'lines',lines_,'quantity',all_qty,'subtotal',all_sub::text,'branding_total',all_brand::text,'cgst',all_cg::text,'sgst',all_sg::text,'igst',all_ig::text,
 'total',round(all_sub+all_brand+all_cg+all_sg+all_ig,2)::text);
END $f$;

ALTER FUNCTION sa_domain.normalize_configuration(jsonb,bigint) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.normalize_configuration(jsonb,bigint) FROM PUBLIC,anon,authenticated,sa_app;
CREATE OR REPLACE FUNCTION sa_domain.normalize_configuration(p_config jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$ SELECT sa_domain.normalize_configuration(p_config,NULL::bigint) $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
