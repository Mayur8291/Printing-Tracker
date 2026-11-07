BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;

CREATE FUNCTION sa_domain.input_id(p_value jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE v text:=p_value#>>'{}';
BEGIN
 IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN('number','string') OR v !~ '^[0-9]{1,19}$' OR NOT pg_input_is_valid(v,'bigint') OR v::bigint<1 THEN
 RAISE EXCEPTION 'Expected a positive record ID' USING ERRCODE='22023';END IF;RETURN v::bigint;
END $f$;
CREATE FUNCTION sa_domain.input_number(p_value jsonb,p_min numeric,p_max numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE v text:=p_value#>>'{}';n numeric;
BEGIN
 IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN('number','string') OR length(v)>40 OR v !~ '^-?[0-9]+([.][0-9]{1,8})?$' THEN
 RAISE EXCEPTION 'Expected a finite decimal amount' USING ERRCODE='22023';END IF;
 n:=v::numeric;IF n<p_min OR n>p_max THEN RAISE EXCEPTION 'Amount outside supported bounds' USING ERRCODE='22023';END IF;RETURN n;
END $f$;
CREATE FUNCTION sa_domain.normalize_configuration(p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE base_ bigint;fabric_ bigint;color_ bigint;category_ bigint;part_ jsonb;addon_ jsonb;parts_ jsonb:='[]';addons_ jsonb;
 part_id_ bigint;part_color_ bigint;addon_id_ bigint;addon_color_ bigint;part_join_ bigint;addon_join_ bigint;ad record;groups_ text[];seen_ bigint[]:='{}';seen_ad_ bigint[];
BEGIN
 PERFORM sa_domain.check_fields(p_config,ARRAY['base_product_id','fabric_id','fabric_color_id','category_id','parts']);
 base_:=sa_domain.input_id(p_config->'base_product_id');fabric_:=sa_domain.input_id(p_config->'fabric_id');color_:=sa_domain.input_id(p_config->'fabric_color_id');category_:=sa_domain.input_id(p_config->'category_id');
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=base_ AND b.is_deleted IS NOT TRUE)
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_categories j WHERE j.base_product_id=base_ AND j.category_id=category_ AND j.is_deleted IS NOT TRUE)
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_fabrics j JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=j.fabric_id AND f.is_deleted IS NOT TRUE WHERE j.base_product_id=base_ AND j.fabric_id=fabric_ AND j.is_deleted IS NOT TRUE)
 OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_fabric_colors j JOIN sa_snapshot_20261019.sa_colors c ON c.id=j.color_id AND c.is_deleted IS NOT TRUE WHERE j.fabric_id=fabric_ AND j.color_id=color_ AND j.is_deleted IS NOT TRUE)
 THEN RAISE EXCEPTION 'Invalid or unavailable base, category, fabric or color combination' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(coalesce(p_config->'parts','[]'))<>'array' OR jsonb_array_length(coalesce(p_config->'parts','[]'))>50 THEN RAISE EXCEPTION 'At most 50 parts are allowed' USING ERRCODE='22023';END IF;
 FOR part_ IN SELECT value FROM jsonb_array_elements(coalesce(p_config->'parts','[]')) LOOP
  PERFORM sa_domain.check_fields(part_,ARRAY['part_id','color_id','addons']);part_id_:=sa_domain.input_id(part_->'part_id');part_color_:=sa_domain.input_id(part_->'color_id');
  IF part_id_=ANY(seen_) THEN RAISE EXCEPTION 'Duplicate part' USING ERRCODE='22023';END IF;seen_:=array_append(seen_,part_id_);
  SELECT pc.id INTO part_join_ FROM sa_snapshot_20261019.sa_part_colors pc JOIN sa_snapshot_20261019.sa_colors c ON c.id=pc.color_id AND c.is_deleted IS NOT TRUE
   JOIN sa_snapshot_20261019.sa_parts p ON p.id=pc.part_id AND p.is_deleted IS NOT TRUE
   JOIN sa_snapshot_20261019.sa_base_product_parts bp ON bp.part_id=p.id AND bp.base_product_id=base_ AND bp.is_deleted IS NOT TRUE
   WHERE pc.part_id=part_id_ AND pc.color_id=part_color_ AND pc.is_deleted IS NOT TRUE ORDER BY pc.id LIMIT 1;
  IF part_join_ IS NULL THEN RAISE EXCEPTION 'Invalid part or color combination' USING ERRCODE='22023';END IF;
  IF jsonb_typeof(coalesce(part_->'addons','[]'))<>'array' OR jsonb_array_length(coalesce(part_->'addons','[]'))>30 THEN RAISE EXCEPTION 'At most 30 add-ons per part are allowed' USING ERRCODE='22023';END IF;
  addons_:='[]';seen_ad_:='{}';groups_:='{}';
  FOR addon_ IN SELECT value FROM jsonb_array_elements(coalesce(part_->'addons','[]')) LOOP
   PERFORM sa_domain.check_fields(addon_,ARRAY['addon_id','color_id']);addon_id_:=sa_domain.input_id(addon_->'addon_id');addon_join_:=NULL;
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
    SELECT j.id INTO addon_join_ FROM sa_snapshot_20261019.sa_add_on_colors j JOIN sa_snapshot_20261019.sa_colors c ON c.id=j.color_id AND c.is_deleted IS NOT TRUE
     WHERE j.add_on_id=addon_id_ AND j.color_id=addon_color_ AND j.is_deleted IS NOT TRUE ORDER BY j.id LIMIT 1;
    IF addon_join_ IS NULL THEN RAISE EXCEPTION 'Invalid add-on color' USING ERRCODE='22023';END IF;
   ELSIF addon_->'color_id' IS NOT NULL AND addon_->'color_id'<>'null' THEN RAISE EXCEPTION 'This add-on does not have a color' USING ERRCODE='22023';
   ELSE addon_color_:=NULL;END IF;
   addons_:=addons_||jsonb_build_array(jsonb_build_object('addon_id',addon_id_::text,'color_id',addon_color_::text,'color_link_id',addon_join_::text));
  END LOOP;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'addon_id')::bigint),'[]') INTO addons_ FROM jsonb_array_elements(addons_) x;
  parts_:=parts_||jsonb_build_array(jsonb_build_object('part_id',part_id_::text,'color_id',part_color_::text,'color_link_id',part_join_::text,'addons',addons_));
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'part_id')::bigint),'[]') INTO parts_ FROM jsonb_array_elements(parts_) x;
 RETURN jsonb_build_object('base_product_id',base_::text,'fabric_id',fabric_::text,'fabric_color_id',color_::text,'category_id',category_::text,'parts',parts_);
END $f$;

CREATE FUNCTION sa_domain.normalize_quantities(p_quantities jsonb,p_sample jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE q jsonb;size_ bigint;n numeric;total_ integer:=0;items_ jsonb:='[]';seen_ bigint[]:='{}';sample_ jsonb:=NULL;
BEGIN
 IF p_quantities IS NULL OR jsonb_typeof(p_quantities)<>'array' OR jsonb_array_length(p_quantities) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Provide 1..100 size quantities' USING ERRCODE='22023';END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(p_quantities) LOOP
  PERFORM sa_domain.check_fields(q,ARRAY['size_id','quantity']);size_:=sa_domain.input_id(q->'size_id');n:=sa_domain.input_number(q->'quantity',1,100000);
  IF n<>trunc(n) OR size_=ANY(seen_) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_sizes WHERE id=size_) THEN RAISE EXCEPTION 'Invalid, duplicate or unavailable size quantity' USING ERRCODE='22023';END IF;
  total_:=total_+n::integer;seen_:=array_append(seen_,size_);items_:=items_||jsonb_build_array(jsonb_build_object('size_id',size_::text,'quantity',n::integer));
 END LOOP;
 IF total_>1000000 THEN RAISE EXCEPTION 'Maximum item quantity exceeded' USING ERRCODE='22023';END IF;
 IF p_sample IS NOT NULL AND p_sample<>'null' THEN
  PERFORM sa_domain.check_fields(p_sample,ARRAY['size_id','quantity']);size_:=sa_domain.input_id(p_sample->'size_id');n:=sa_domain.input_number(p_sample->'quantity',1,100000);
  IF n<>trunc(n) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_sizes WHERE id=size_) THEN RAISE EXCEPTION 'Invalid sample quantity' USING ERRCODE='22023';END IF;
  sample_:=jsonb_build_object('size_id',size_::text,'quantity',n::integer);
 END IF;
 SELECT jsonb_agg(x ORDER BY (x->>'size_id')::bigint) INTO items_ FROM jsonb_array_elements(items_) x;
 -- For sample orders the size plan is retained separately as legacy extra_quantities.
 RETURN jsonb_build_object('quantities',items_,'total_quantity',total_,'sample',sample_,'sample_order',sample_ IS NOT NULL);
END $f$;
CREATE FUNCTION sa_domain.v1_item_quantity_validate(p_quantities jsonb,p_sample jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');
BEGIN RETURN sa_domain.normalize_quantities(p_quantities,p_sample);END $f$;

CREATE FUNCTION sa_domain.custom_price(p_config jsonb,p_quantity integer,p_sample boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE b sa_snapshot_20261019.sa_base_products%ROWTYPE;f sa_snapshot_20261019.sa_fabrics%ROWTYPE;category_ text;
 consumption numeric;fabric_cost numeric;addons_cost numeric;manufacturing numeric;overhead numeric;profit numeric;rate numeric;unit_ numeric;
BEGIN
 SELECT * INTO b FROM sa_snapshot_20261019.sa_base_products WHERE id=(p_config->>'base_product_id')::bigint;
 SELECT * INTO f FROM sa_snapshot_20261019.sa_fabrics WHERE id=(p_config->>'fabric_id')::bigint;
 SELECT lower(name) INTO category_ FROM sa_snapshot_20261019.sa_categories WHERE id=(p_config->>'category_id')::bigint;
 IF f.uom='METER' AND category_ IN('men','women','kids') THEN consumption:=coalesce(CASE WHEN category_='kids' THEN b.kids_consumption ELSE b.adult_consumption END,0);
 ELSIF f.uom='KG' THEN consumption:=coalesce(b.calculator,0)*coalesce(f.gsm,0)*2/10000/1000;
 ELSE RAISE EXCEPTION 'Unsupported fabric unit or consumption category' USING ERRCODE='22023';END IF;
 fabric_cost:=coalesce(f.price,0)*consumption;
 SELECT coalesce(sum(coalesce(ad.add_on_price,0)+coalesce(ad.add_on_of,0)+coalesce(ad.add_on_sn,0)),0) INTO addons_cost
 FROM jsonb_array_elements(p_config->'parts') part CROSS JOIN LATERAL jsonb_array_elements(part->'addons') a
 JOIN sa_snapshot_20261019.sa_add_ons ad ON ad.id=(a->>'addon_id')::bigint;
 manufacturing:=fabric_cost+coalesce(b.base_of,0)+coalesce(b.base_sn,0)+coalesce(b.tims_cost,0)+addons_cost;
 overhead:=manufacturing*coalesce(b.over_header_percentage,0)/100;
 SELECT m.margin_percentage INTO rate FROM sa_snapshot_20261019.sa_profit_margins m WHERE m.is_deleted IS NOT TRUE AND p_quantity BETWEEN m.min_range AND m.max_range ORDER BY m.id LIMIT 1;
 profit:=(manufacturing+overhead)*coalesce(rate,0)/100;
 unit_:=CASE WHEN p_quantity<6 OR p_sample THEN coalesce(b.sample_rate,0) ELSE round(manufacturing+overhead+profit,3) END;
 IF least(consumption,fabric_cost,addons_cost,manufacturing,overhead,profit,unit_)<0 OR unit_>100000000 THEN RAISE EXCEPTION 'Invalid catalogue costing data' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('unit_price',unit_::text,'sample_rate_applied',p_quantity<6 OR p_sample,'consumption',consumption::text,
 'costs',jsonb_build_object('fabric',fabric_cost::text,'stitching',(coalesce(b.base_of,0)+coalesce(b.base_sn,0))::text,'trims',coalesce(b.tims_cost,0)::text,
 'addons',addons_cost::text,'manufacturing',manufacturing::text,'overhead',overhead::text,'profit',profit::text,'margin_percentage',coalesce(rate,0)::text));
END $f$;
CREATE FUNCTION sa_domain.branding_price(p_brandings jsonb,p_quantity integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE b jsonb;w numeric;h numeric;price_ numeric:=0;rate numeric;total_ numeric:=0;items_ jsonb:='[]';m sa_snapshot_20261019.sa_profit_margins%ROWTYPE;
BEGIN
 IF p_brandings IS NULL OR jsonb_typeof(p_brandings)<>'array' OR jsonb_array_length(p_brandings)>20 THEN RAISE EXCEPTION 'At most 20 branding placements allowed' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM sa_snapshot_20261019.sa_profit_margins WHERE is_deleted IS NOT TRUE AND p_quantity BETWEEN min_range AND max_range ORDER BY id LIMIT 1;
 FOR b IN SELECT value FROM jsonb_array_elements(p_brandings) LOOP
  PERFORM sa_domain.check_fields(b,ARRAY['type','side','width','height','unit']);
  IF b->>'type' IS NULL OR b->>'type' NOT IN('print','embroidery') OR b->>'unit' IS DISTINCT FROM 'inch' OR nullif(btrim(b->>'side'),'') IS NULL OR length(b->>'side')>80 THEN
   RAISE EXCEPTION 'Invalid branding type, side or unit' USING ERRCODE='22023';END IF;
  w:=sa_domain.input_number(b->'width',0.01,1000);h:=sa_domain.input_number(b->'height',0.01,1000);
  rate:=coalesce(CASE WHEN b->>'type'='print' THEN m.branding_print ELSE m.branding_embroidery END,0);
  IF rate<0 THEN RAISE EXCEPTION 'Invalid branding rate' USING ERRCODE='22023';END IF;
  price_:=w*h*rate;total_:=total_+price_;items_:=items_||jsonb_build_array(b||jsonb_build_object('unit_price',price_::text));
 END LOOP;
 RETURN jsonb_build_object('unit_price',total_::text,'placements',items_);
END $f$;
CREATE FUNCTION sa_domain.unit_tax(p_amount numeric,p_state text,p_cgst numeric DEFAULT NULL,p_sgst numeric DEFAULT NULL,p_igst numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE in_state boolean:=lower(btrim(p_state))='karnataka';cg numeric:=0;sg numeric:=0;ig numeric:=0;
BEGIN
 IF nullif(btrim(p_state),'') IS NULL THEN RAISE EXCEPTION 'Delivery state is required' USING ERRCODE='22023';END IF;
 IF in_state THEN cg:=coalesce(p_cgst,CASE WHEN p_amount<999 THEN 2.5 ELSE 6 END);sg:=coalesce(p_sgst,CASE WHEN p_amount<999 THEN 2.5 ELSE 6 END);
 ELSE ig:=coalesce(p_igst,CASE WHEN p_amount<999 THEN 5 ELSE 12 END);END IF;
 IF least(cg,sg,ig)<0 OR greatest(cg,sg,ig)>100 THEN RAISE EXCEPTION 'Invalid tax rate' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('schedule','legacy-flutter-develop-5d55d946','cgst',round(p_amount*cg/100,2)::text,'sgst',round(p_amount*sg/100,2)::text,'igst',round(p_amount*ig/100,2)::text);
END $f$;

CREATE FUNCTION sa_domain.quote_address(p_customer_id bigint,p_address_id bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.commercial_context(p_customer_id);state_ text;
BEGIN
 IF context_->>'customer_id' IS NULL THEN RAISE EXCEPTION 'Select a customer for an order quote' USING ERRCODE='22023';END IF;
 SELECT state INTO state_ FROM sa_snapshot_20261019.sa_addresses WHERE id=p_address_id AND user_id=p_customer_id AND deleted_at IS NULL;
 IF nullif(btrim(state_),'') IS NULL THEN RAISE EXCEPTION 'Delivery address not found or incomplete' USING ERRCODE='P0002';END IF;RETURN state_;
END $f$;
ALTER FUNCTION sa_domain.quote_address(bigint,bigint) OWNER TO sa_guard;

CREATE TABLE sa_domain.quotes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,customer_id bigint,generation bigint NOT NULL,
 revision bigint NOT NULL DEFAULT 1,request jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
ALTER TABLE sa_domain.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY squad_quotes_owner ON sa_domain.quotes TO sa_executor USING(actor_id=(SELECT (sa_domain.actor()).auth_id)) WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id));
GRANT SELECT,INSERT,UPDATE ON sa_domain.quotes TO sa_executor;
CREATE INDEX squad_quotes_expiry ON sa_domain.quotes(expires_at);

CREATE FUNCTION sa_domain.calculate_quote(p_request jsonb,p_catalog boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb;customer_ bigint;address_ bigint;state_ text;line_ jsonb;lines_ jsonb:='[]';quantities_ jsonb;config_ jsonb;cost_ jsonb;
 branding_ jsonb;tax_ jsonb;sku_ record;selection_ jsonb;price_ jsonb;variants_ jsonb;skus_ jsonb;seen_ bigint[];first_group_ text;group_ text;
 qty integer;qty_ integer;count_ integer:=0;line_no integer:=0;unit_ numeric;brand_unit numeric;subtotal numeric;brand_total numeric;cg numeric;sg numeric;ig numeric;
 all_sub numeric:=0;all_brand numeric:=0;all_cg numeric:=0;all_sg numeric:=0;all_ig numeric:=0;all_qty integer:=0;show_cost boolean:=sa_domain.cost_visible();
BEGIN
 PERFORM sa_domain.check_fields(p_request,ARRAY['customer_id','address_id','lines']);
 IF octet_length(p_request::text)>131072 OR jsonb_typeof(p_request->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'lines') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Provide 1..50 quote lines within 128 KB' USING ERRCODE='22023';END IF;
 IF p_request?'customer_id' AND p_request->'customer_id'<>'null' THEN customer_:=sa_domain.input_id(p_request->'customer_id');END IF;
 context_:=sa_domain.commercial_context(customer_);customer_:=(context_->>'customer_id')::bigint;
 IF NOT p_catalog THEN
  address_:=sa_domain.input_id(p_request->'address_id');state_:=sa_domain.quote_address(customer_,address_);
 END IF;
 FOR line_ IN SELECT value FROM jsonb_array_elements(p_request->'lines') LOOP
  line_no:=line_no+1;subtotal:=0;brand_total:=0;cg:=0;sg:=0;ig:=0;variants_:='[]';cost_:=NULL;config_:=NULL;quantities_:=NULL;
  IF line_->>'kind'='custom' THEN
   PERFORM sa_domain.check_fields(line_,ARRAY['kind','configuration','quantities','sample','brandings']);
   config_:=sa_domain.normalize_configuration(line_->'configuration');quantities_:=sa_domain.normalize_quantities(line_->'quantities',line_->'sample');
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
    JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=s.rmp_category_id AND cat.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id AND z.is_deleted IS NOT TRUE
    WHERE s.id=(selection_->>'sku_id')::bigint AND s.is_deleted IS NOT TRUE;
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
 'address_id',address_::text,'lines',lines_,'quantity',all_qty,'subtotal',all_sub::text,'branding_total',all_brand::text,'cgst',all_cg::text,'sgst',all_sg::text,'igst',all_ig::text,
 'total',round(all_sub+all_brand+all_cg+all_sg+all_ig,2)::text);
END $f$;
CREATE FUNCTION sa_domain.v1_quote(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');r jsonb;q sa_domain.quotes%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 r:=sa_domain.calculate_quote(p_request,false);
 INSERT INTO sa_domain.quotes(actor_id,customer_id,generation,request,result)
 SELECT a.auth_id,(r->'context'->>'customer_id')::bigint,generation,p_request,r FROM sa_domain.runtime_state RETURNING * INTO q;
 RETURN r||jsonb_build_object('quote_id',q.id,'version',q.generation||':'||q.revision,'expires_at',q.expires_at,
 'fingerprint',encode(sha256(convert_to(r::text,'UTF8')),'hex'));
END $f$;
CREATE FUNCTION sa_domain.v1_catalogue_quote(p_request jsonb,p_markup jsonb DEFAULT '{"kind":"percentage","value":"0"}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('documents');r jsonb;markup_ numeric;lines_ jsonb:='[]';l jsonb;variants_ jsonb;v jsonb;price_ numeric;
BEGIN
 PERFORM sa_domain.check_fields(p_markup,ARRAY['kind','value']);
 IF p_markup->>'kind' IS NULL OR p_markup->>'kind' NOT IN('percentage','fixed') THEN RAISE EXCEPTION 'Invalid markup kind' USING ERRCODE='22023';END IF;
 markup_:=sa_domain.input_number(p_markup->'value',0,CASE WHEN p_markup->>'kind'='percentage' THEN 10000 ELSE 10000000 END);
 r:=sa_domain.calculate_quote(p_request,true);
 FOR l IN SELECT value FROM jsonb_array_elements(r->'lines') LOOP
  variants_:='[]';
  FOR v IN SELECT value FROM jsonb_array_elements(l->'variants') LOOP
   price_:=(v->>'unit_price')::numeric+(l->'branding'->>'unit_price')::numeric;
   price_:=CASE WHEN p_markup->>'kind'='percentage' THEN price_*(1+markup_/100) ELSE price_+markup_ END;
   variants_:=variants_||jsonb_build_array(v||jsonb_build_object('display_unit_price',round(price_,2)::text));
  END LOOP;
  lines_:=lines_||jsonb_build_array(l||jsonb_build_object('variants',variants_));
 END LOOP;
 RETURN r||jsonb_build_object('lines',lines_,'markup',p_markup,'purpose','catalogue_display_only');
END $f$;

DO $do$ DECLARE f record;arguments_ text;body_ text; BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_quote','v1_catalogue_quote','v1_item_quantity_validate']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
 AND p.proname=ANY(ARRAY['input_id','input_number','normalize_configuration','normalize_quantities','custom_price','branding_price','unit_tax','quote_address','calculate_quote']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
