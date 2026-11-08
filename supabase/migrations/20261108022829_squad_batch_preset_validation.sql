BEGIN;
CREATE FUNCTION sa_domain.product_configurations(p_ids bigint[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 WITH products AS MATERIALIZED(SELECT id,base_product_id,fabric_id,fabric_color_id,category_id FROM sa_snapshot_20261019.sa_products WHERE id=ANY(p_ids)),
 parts AS MATERIALIZED(SELECT pp.* FROM sa_snapshot_20261019.sa_product_parts pp WHERE product_id IN(SELECT id FROM products)),
 addons AS(SELECT pa.product_part_id,jsonb_agg(jsonb_build_object('addon_id',pa.add_on_id::text,'color_id',ac.color_id::text,'color_link_id',pa.add_on_color_id::text) ORDER BY pa.add_on_id,pa.add_on_color_id,pa.id) data
 FROM sa_snapshot_20261019.sa_product_part_add_ons pa LEFT JOIN sa_snapshot_20261019.sa_add_on_colors ac ON ac.id=pa.add_on_color_id WHERE pa.product_part_id IN(SELECT id FROM parts) GROUP BY pa.product_part_id),
 grouped AS(SELECT pp.product_id,jsonb_agg(jsonb_build_object('part_id',pp.part_id::text,'color_id',pc.color_id::text,'color_link_id',pp.part_color_id::text,'addons',coalesce(a.data,'[]')) ORDER BY pp.part_id,pp.part_color_id,pp.id) data
 FROM parts pp LEFT JOIN sa_snapshot_20261019.sa_part_colors pc ON pc.id=pp.part_color_id LEFT JOIN addons a ON a.product_part_id=pp.id GROUP BY pp.product_id)
 SELECT coalesce(jsonb_object_agg(p.id::text,jsonb_build_object('base_product_id',p.base_product_id::text,'fabric_id',p.fabric_id::text,'fabric_color_id',p.fabric_color_id::text,'category_id',p.category_id::text,'parts',coalesce(g.data,'[]'))),'{}')
 FROM products p LEFT JOIN grouped g ON g.product_id=p.id
$f$;
REVOKE ALL ON FUNCTION sa_domain.product_configurations(bigint[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.product_configurations(bigint[]) TO sa_executor;
CREATE OR REPLACE FUNCTION sa_domain.product_configuration(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$ SELECT sa_domain.product_configurations(ARRAY[p_id])->p_id::text $f$;
CREATE OR REPLACE FUNCTION sa_domain.validate_order_line_settings(p_lines jsonb, p_settings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE l jsonb;settings_ jsonb;product_ bigint;config_ jsonb;configs_ jsonb;
BEGIN
 configs_:=sa_domain.product_configurations(ARRAY(SELECT DISTINCT sa_domain.input_id(p_settings->(x->>'line')->'product_id') FROM jsonb_array_elements(p_lines) x WHERE x->>'kind'='custom'));
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  settings_:=coalesce(p_settings->(l->>'line'),'{}');PERFORM sa_domain.check_fields(settings_,ARRAY['product_id','comment','size_type_id']);
  IF settings_?'comment' AND(jsonb_typeof(settings_->'comment')<>'string' OR length(settings_->>'comment')>4000) THEN RAISE EXCEPTION 'Invalid item comment' USING ERRCODE='22023';END IF;
  IF l->>'kind'='custom' THEN
   product_:=sa_domain.input_id(settings_->'product_id');config_:=configs_->product_::text;
   IF config_ IS NULL OR config_<>l->'configuration' THEN RAISE EXCEPTION 'Preset is unavailable or does not match the quote' USING ERRCODE='22023';END IF;
   IF settings_?'size_type_id' AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_size_types st WHERE st.id=sa_domain.input_id(settings_->'size_type_id') AND st.is_deleted IS NOT TRUE AND(EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_size_types b WHERE b.base_product_id=(config_->>'base_product_id')::bigint AND b.size_type_id=st.id AND b.is_deleted IS NOT TRUE) OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=(config_->>'base_product_id')::bigint AND b.size_type_id=st.id))) THEN RAISE EXCEPTION 'Size type is incompatible with the base product' USING ERRCODE='22023';END IF;
  ELSIF settings_?'product_id' OR settings_?'size_type_id' THEN RAISE EXCEPTION 'Ready-made lines cannot select a custom preset or size type' USING ERRCODE='22023';END IF;
 END LOOP;
END $function$;
CREATE OR REPLACE FUNCTION sa_domain.prepare_order_line(p_order_id bigint, p_line jsonb, p_settings jsonb, p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE product_ bigint;item_ bigint;size_ bigint;type_ integer;size_type_ text;config_ jsonb;cost_ jsonb;variant_ jsonb;q jsonb;tax_ jsonb;branding_ jsonb;
 unit_ numeric;calculated_ numeric;weight_ numeric:=0;addons_ numeric:=0;quantity_ integer:=(p_line->>'quantity')::int;sample_ jsonb:=p_line->'quantities'->'sample';sample_amount numeric:=0;
BEGIN
 PERFORM sa_domain.check_fields(p_settings,ARRAY['product_id','comment','size_type_id']);
 IF p_settings?'comment' AND (jsonb_typeof(p_settings->'comment')<>'string' OR length(p_settings->>'comment')>4000) THEN RAISE EXCEPTION 'Invalid item comment' USING ERRCODE='22023';END IF;
 type_:=CASE p_line->>'kind' WHEN 'custom' THEN 0 ELSE 1 END;
 IF type_=0 THEN
  product_:=sa_domain.input_id(p_settings->'product_id');config_:=p_line->'configuration';
  IF p_line?'costs' AND p_line?'consumption' THEN
   cost_:=jsonb_build_object('costs',p_line->'costs','consumption',p_line->'consumption','unit_price',coalesce(p_line->'variants'->0->>'calculated_unit_price',p_line->'variants'->0->>'unit_price'));
  ELSE cost_:=sa_domain.custom_price(config_,quantity_,(p_line->'quantities'->>'sample_order')::boolean);END IF;
  weight_:=(cost_->>'consumption')::numeric;addons_:=(cost_->'costs'->>'addons')::numeric;
  unit_:=(p_line->'variants'->0->>'unit_price')::numeric;calculated_:=(cost_->>'unit_price')::numeric;
  IF sample_ IS NOT NULL AND sample_<>'null' THEN sample_amount:=unit_*(sample_->>'quantity')::int;END IF;
  IF p_settings?'size_type_id' THEN
   SELECT st.name INTO size_type_ FROM sa_snapshot_20261019.sa_size_types st WHERE st.id=sa_domain.input_id(p_settings->'size_type_id') AND st.is_deleted IS NOT TRUE
   AND (EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_size_types b WHERE b.base_product_id=(config_->>'base_product_id')::bigint AND b.size_type_id=st.id AND b.is_deleted IS NOT TRUE)
    OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=(config_->>'base_product_id')::bigint AND b.size_type_id=st.id));
   IF size_type_ IS NULL THEN RAISE EXCEPTION 'Size type is incompatible with the base product' USING ERRCODE='22023';END IF;
  END IF;
 ELSE
  IF p_settings?'product_id' OR p_settings?'size_type_id' THEN RAISE EXCEPTION 'Ready-made lines cannot select a custom preset or size type' USING ERRCODE='22023';END IF;
  unit_:=round((p_line->>'subtotal')::numeric/quantity_,3);
  SELECT round(sum(coalesce(x->>'calculated_unit_price',x->>'unit_price')::numeric*(x->>'quantity')::int)/quantity_,3) INTO calculated_ FROM jsonb_array_elements(p_line->'variants') x;
 END IF;
 RETURN jsonb_build_object('id',nextval('sa_snapshot_20261019.sa_items_id_seq'), 'order_id',p_order_id,'item_type',type_,'product_id',product_,
 'rmp_class_id',p_line->'variants'->0->>'class_id','rmp_brand_id',p_line->'variants'->0->>'brand_id','rmp_category_id',p_line->'variants'->0->>'category_id',
 'comment',coalesce(p_settings->>'comment',''),'sample_order',coalesce((p_line->'quantities'->>'sample_order')::boolean,false),'total_amount',p_line->>'subtotal','total_quantity',quantity_,'sample_total_amount',sample_amount,
 'weight_per_piece',weight_,'total_weight',round(weight_*quantity_,2),'per_piece_amount',unit_,'calculated_per_piece_amount',calculated_,
 'rmp_override_price',CASE WHEN type_=1 AND p_line?'override' THEN (p_line->'override'->>'unit_price')::numeric ELSE 0 END,
 'branding_amount',p_line->>'branding_total','cgst_amount',p_line->>'cgst','sgst_amount',p_line->>'sgst','igst_amount',p_line->>'igst','add_on_cost',addons_,'size_type',coalesce(size_type_,''),'created_at',now(),'updated_at',now());
END $function$;
CREATE OR REPLACE FUNCTION sa_domain.create_order_lines(p_order_id bigint, p_lines jsonb, p_settings jsonb, p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE prepared_ jsonb:='[]';quantities_ jsonb:='[]';extras_ jsonb:='[]';l jsonb;r jsonb;q jsonb;v jsonb;b jsonb;sample_ jsonb;
 item_ bigint;size_ bigint;tax_ jsonb;names_ jsonb;name_ text;criterion_ bigint;result_ jsonb;
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Expected one to fifty order lines' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.validate_order_line_settings(p_lines,p_settings);
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  r:=sa_domain.prepare_order_line(p_order_id,l,coalesce(p_settings->(l->>'line'),'{}'),p_state);item_:=(r->>'id')::bigint;
  prepared_:=prepared_||jsonb_build_array(jsonb_build_object('record',r,'quote',l));
  IF l->>'kind'='custom' THEN
   sample_:=l->'quantities'->'sample';
   IF sample_ IS NOT NULL AND sample_<>'null' THEN
    quantities_:=quantities_||jsonb_build_array(jsonb_build_object('item_id',item_,'size_id',sample_->>'size_id','quantity',sample_->'quantity','cgst',0,'sgst',0,'igst',0));
    FOR q IN SELECT value FROM jsonb_array_elements(l->'quantities'->'quantities') LOOP extras_:=extras_||jsonb_build_array(q||jsonb_build_object('item_id',item_));END LOOP;
   ELSE
    FOR q IN SELECT value FROM jsonb_array_elements(l->'quantities'->'quantities') LOOP
     quantities_:=quantities_||jsonb_build_array(q||jsonb_build_object('item_id',item_,'cgst',(l->>'cgst')::numeric/(l->>'quantity')::int*(q->>'quantity')::int,
     'sgst',(l->>'sgst')::numeric/(l->>'quantity')::int*(q->>'quantity')::int,'igst',(l->>'igst')::numeric/(l->>'quantity')::int*(q->>'quantity')::int));
    END LOOP;
   END IF;
  ELSE
   FOR v IN SELECT value FROM jsonb_array_elements(l->'variants') LOOP
    SELECT sa_domain.order_size(z.name),sa_domain.unit_tax((v->>'unit_price')::numeric+(l->'branding'->>'unit_price')::numeric,p_state,s.cgst,s.sgst,s.igst)
    INTO size_,tax_ FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id WHERE s.id=(v->>'sku_id')::bigint;
    quantities_:=quantities_||jsonb_build_array(jsonb_build_object('item_id',item_,'size_id',size_,'quantity',v->'quantity','cgst',(tax_->>'cgst')::numeric*(v->>'quantity')::int,
     'sgst',(tax_->>'sgst')::numeric*(v->>'quantity')::int,'igst',(tax_->>'igst')::numeric*(v->>'quantity')::int));
   END LOOP;
  END IF;
 END LOOP;
 INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,product_id,rmp_class_id,rmp_brand_id,rmp_category_id,comment,sample_order,total_amount,total_quantity,sample_total_amount,
 weight_per_piece,total_weight,per_piece_amount,calculated_per_piece_amount,rmp_override_price,branding_amount,cgst_amount,sgst_amount,igst_amount,add_on_cost,size_type,created_at,updated_at)
 SELECT x.id,x.order_id,x.item_type,x.product_id,x.rmp_class_id,x.rmp_brand_id,x.rmp_category_id,x.comment,x.sample_order,x.total_amount,x.total_quantity,x.sample_total_amount,
 x.weight_per_piece,x.total_weight,x.per_piece_amount,x.calculated_per_piece_amount,x.rmp_override_price,x.branding_amount,x.cgst_amount,x.sgst_amount,x.igst_amount,x.add_on_cost,x.size_type,x.created_at,x.updated_at
 FROM jsonb_populate_recordset(NULL::sa_snapshot_20261019.sa_items,(SELECT jsonb_agg(value->'record') FROM jsonb_array_elements(prepared_))) x;
 INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,cgst,sgst,igst,created_at,updated_at)
 SELECT x.item_id,x.size_id,x.quantity,x.cgst,x.sgst,x.igst,now(),now() FROM jsonb_populate_recordset(NULL::sa_snapshot_20261019.sa_quantities,quantities_) x;
 INSERT INTO sa_snapshot_20261019.sa_extra_quantities(item_id,size_id,quantity,created_at,updated_at)
 SELECT x.item_id,x.size_id,x.quantity,now(),now() FROM jsonb_populate_recordset(NULL::sa_snapshot_20261019.sa_extra_quantities,extras_) x;
 -- Build checklist names once for the whole batch; acquire name locks in a
 -- stable order, then insert every item/criterion relation in one statement.
 WITH lines AS MATERIALIZED(SELECT (value->'record'->>'id')::bigint item_id,(value->'record'->>'product_id')::bigint product_id,value->'quote' quote FROM jsonb_array_elements(prepared_) WHERE value->'quote'->>'kind'='custom'),
 names AS(SELECT l.item_id,unnest(ARRAY['Fabric','Trims']||CASE WHEN jsonb_array_length(l.quote->'branding'->'placements')>0 THEN ARRAY['Branding'] ELSE ARRAY[]::text[] END) name FROM lines l
 UNION SELECT l.item_id,p.name FROM lines l JOIN sa_snapshot_20261019.sa_product_parts pp ON pp.product_id=l.product_id JOIN sa_snapshot_20261019.sa_parts p ON p.id=pp.part_id WHERE p.order_criteria)
 SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'name',name)),'[]') INTO names_ FROM names;
 FOR name_ IN SELECT DISTINCT value->>'name' FROM jsonb_array_elements(names_) ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('criteria:'||name_,0));
  SELECT id INTO criterion_ FROM sa_snapshot_20261019.sa_criteria WHERE name=name_ ORDER BY id LIMIT 1;
  IF criterion_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_criteria(name,created_at,updated_at) VALUES(name_,now(),now());END IF;
 END LOOP;
 INSERT INTO sa_snapshot_20261019.sa_item_criteria(item_id,criteria_id,is_checked,created_at,updated_at)
 SELECT (n->>'item_id')::bigint,c.id,false,now(),now() FROM jsonb_array_elements(names_) n JOIN LATERAL(SELECT id FROM sa_snapshot_20261019.sa_criteria WHERE name=n->>'name' ORDER BY id LIMIT 1) c ON true;
 FOR r IN SELECT value FROM jsonb_array_elements(prepared_) LOOP
  FOR b IN SELECT value FROM jsonb_array_elements(r->'quote'->'branding'->'placements') LOOP PERFORM sa_domain.attach_order_design((r->'record'->>'id')::bigint,b);END LOOP;
 END LOOP;
 INSERT INTO sa_domain.line_receipts(item_id,generation,order_id,pricing)
 SELECT (j.value->'record'->>'id')::bigint,s.generation,p_order_id,j.value->'quote' FROM jsonb_array_elements(prepared_) j(value) CROSS JOIN sa_domain.runtime_state s;
 SELECT jsonb_agg(jsonb_build_object('line',value->'quote'->'line','item_id',value->'record'->>'id') ORDER BY (value->'quote'->>'line')::int) INTO result_ FROM jsonb_array_elements(prepared_);
 RETURN result_;
END $function$;
NOTIFY pgrst,'reload schema';
COMMIT;
