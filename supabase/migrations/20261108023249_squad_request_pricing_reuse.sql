BEGIN;
-- Deduplicate identical inputs only inside this STABLE calculation/snapshot.
-- Exact JSON keys (not hashes), no identity/session cache, no cross-call state.
CREATE OR REPLACE FUNCTION sa_domain.calculate_quote(p_request jsonb, p_catalog boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE context_ jsonb;customer_ bigint;address_ bigint;state_ text;line_ jsonb;lines_ jsonb:='[]';quantities_ jsonb;config_ jsonb;cost_ jsonb;
 branding_ jsonb;tax_ jsonb;sku_ record;selection_ jsonb;price_ jsonb;variants_ jsonb;skus_ jsonb;seen_ bigint[];first_group_ text;group_ text;
 qty integer;qty_ integer;count_ integer:=0;line_no integer:=0;unit_ numeric;brand_unit numeric;subtotal numeric;brand_total numeric;cg numeric;sg numeric;ig numeric;
 all_sub numeric:=0;all_brand numeric:=0;all_cg numeric:=0;all_sg numeric:=0;all_ig numeric:=0;all_qty integer:=0;show_cost boolean:=sa_domain.cost_visible();
 config_cache_ jsonb:='{}';quantity_cache_ jsonb:='{}';cost_cache_ jsonb:='{}';cache_key_ text;
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
    cache_key_:='preset:'||sa_domain.input_id(line_->'preset_id')::text;
    config_:=config_cache_->cache_key_;
    IF config_ IS NULL THEN
     config_:=sa_domain.product_configuration(sa_domain.input_id(line_->'preset_id'));
     config_:=sa_domain.normalize_configuration(config_,sa_domain.input_id(line_->'preset_id'));
     config_cache_:=config_cache_||jsonb_build_object(cache_key_,config_);
    END IF;
   ELSE
    cache_key_:='configuration:'||coalesce((line_->'configuration')::text,'null');config_:=config_cache_->cache_key_;
    IF config_ IS NULL THEN config_:=sa_domain.normalize_configuration(line_->'configuration');config_cache_:=config_cache_||jsonb_build_object(cache_key_,config_);END IF;
   END IF;
   count_:=count_+jsonb_array_length(config_->'parts')+(SELECT count(*) FROM jsonb_path_query(config_,'$.parts[*].addons[*]'));
   IF count_>500 THEN RAISE EXCEPTION 'Quote selection budget exceeded; split this request' USING ERRCODE='22023';END IF;
   cache_key_:=jsonb_build_object('quantities',line_->'quantities','sample',line_->'sample')::text;quantities_:=quantity_cache_->cache_key_;
   IF quantities_ IS NULL THEN quantities_:=sa_domain.normalize_quantities(line_->'quantities',line_->'sample');quantity_cache_:=quantity_cache_||jsonb_build_object(cache_key_,quantities_);END IF;
   qty:=(quantities_->>'total_quantity')::int;count_:=count_+jsonb_array_length(quantities_->'quantities');
   cache_key_:=jsonb_build_object('configuration',config_,'quantity',qty,'sample',quantities_->'sample_order')::text;cost_:=cost_cache_->cache_key_;
   IF cost_ IS NULL THEN cost_:=sa_domain.custom_price(config_,qty,(quantities_->>'sample_order')::boolean);cost_cache_:=cost_cache_||jsonb_build_object(cache_key_,cost_);END IF;
   unit_:=(cost_->>'unit_price')::numeric;
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
END $function$;
NOTIFY pgrst,'reload schema';
COMMIT;
