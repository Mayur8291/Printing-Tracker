BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_products,sa_snapshot_20261019.sa_product_parts,sa_snapshot_20261019.sa_product_part_add_ons TO sa_executor;
GRANT UPDATE(name,style_number,branding_enabled,updated_at) ON sa_snapshot_20261019.sa_products TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_products_id_seq,sa_snapshot_20261019.sa_product_parts_id_seq,sa_snapshot_20261019.sa_product_part_add_ons_id_seq TO sa_executor;
CREATE POLICY squad_products_read ON sa_snapshot_20261019.sa_products FOR SELECT TO sa_executor USING(
 created_by_id=(SELECT (sa_domain.actor()).user_id) OR (SELECT (sa_domain.actor()).role_id)=0
 OR id IN(SELECT product_id FROM sa_snapshot_20261019.sa_items WHERE product_id IS NOT NULL));
CREATE POLICY squad_products_insert ON sa_snapshot_20261019.sa_products FOR INSERT TO sa_executor WITH CHECK(created_by_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_products_update ON sa_snapshot_20261019.sa_products FOR UPDATE TO sa_executor USING(created_by_id=(SELECT (sa_domain.actor()).user_id)
 OR (SELECT (sa_domain.actor()).role_id)=1) WITH CHECK(created_by_id=(SELECT (sa_domain.actor()).user_id) OR (SELECT (sa_domain.actor()).role_id)=1);
CREATE POLICY squad_product_parts_read ON sa_snapshot_20261019.sa_product_parts FOR SELECT TO sa_executor USING(product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products));
CREATE POLICY squad_product_parts_insert ON sa_snapshot_20261019.sa_product_parts FOR INSERT TO sa_executor WITH CHECK(product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_product_addons_read ON sa_snapshot_20261019.sa_product_part_add_ons FOR SELECT TO sa_executor USING(product_part_id IN(SELECT id FROM sa_snapshot_20261019.sa_product_parts));
CREATE POLICY squad_product_addons_insert ON sa_snapshot_20261019.sa_product_part_add_ons FOR INSERT TO sa_executor WITH CHECK(product_part_id IN(
 SELECT pp.id FROM sa_snapshot_20261019.sa_product_parts pp JOIN sa_snapshot_20261019.sa_products p ON p.id=pp.product_id WHERE p.created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE INDEX squad_products_owner_configuration ON sa_snapshot_20261019.sa_products(created_by_id,base_product_id,fabric_id,fabric_color_id,category_id,id);
CREATE INDEX squad_product_parts_product ON sa_snapshot_20261019.sa_product_parts(product_id,part_id,id);
CREATE INDEX squad_product_addons_part ON sa_snapshot_20261019.sa_product_part_add_ons(product_part_id,add_on_id,id);
CREATE TABLE sa_domain.preset_index(actor_id uuid NOT NULL,generation bigint NOT NULL,fingerprint text NOT NULL,product_id bigint NOT NULL,
 PRIMARY KEY(actor_id,generation,fingerprint));
ALTER TABLE sa_domain.preset_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.preset_index FORCE ROW LEVEL SECURITY;
CREATE POLICY squad_preset_owner ON sa_domain.preset_index TO sa_executor USING(actor_id=(SELECT (sa_domain.actor()).auth_id)) WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id));
GRANT SELECT,INSERT ON sa_domain.preset_index TO sa_executor;

CREATE FUNCTION sa_domain.product_configuration(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('base_product_id',p.base_product_id::text,'fabric_id',p.fabric_id::text,'fabric_color_id',p.fabric_color_id::text,'category_id',p.category_id::text,
 'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('part_id',pp.part_id::text,'color_id',pc.color_id::text,'color_link_id',pp.part_color_id::text,
 'addons',coalesce((SELECT jsonb_agg(jsonb_build_object('addon_id',pa.add_on_id::text,'color_id',ac.color_id::text,'color_link_id',pa.add_on_color_id::text) ORDER BY pa.add_on_id,pa.add_on_color_id,pa.id)
 FROM sa_snapshot_20261019.sa_product_part_add_ons pa LEFT JOIN sa_snapshot_20261019.sa_add_on_colors ac ON ac.id=pa.add_on_color_id WHERE pa.product_part_id=pp.id),'[]')) ORDER BY pp.part_id,pp.part_color_id,pp.id)
 FROM sa_snapshot_20261019.sa_product_parts pp LEFT JOIN sa_snapshot_20261019.sa_part_colors pc ON pc.id=pp.part_color_id WHERE pp.product_id=p.id),'[]'))
 FROM sa_snapshot_20261019.sa_products p WHERE p.id=p_id
$f$;
CREATE FUNCTION sa_domain.v1_product_configure(p_configuration jsonb,p_name text,p_comment text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');cached jsonb;config_ jsonb;hash_ text;generation_ bigint;id_ bigint;part_id_ bigint;
 part_ jsonb;addon_ jsonb;reused_ boolean;version_ text;
BEGIN
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>120 OR p_comment IS NULL OR length(p_comment)>4000 THEN RAISE EXCEPTION 'Provide a name up to 120 characters and a comment up to 4000 characters' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('preset.configured',p_idempotency_key,jsonb_build_object('configuration',p_configuration,'name',p_name,'comment',p_comment));IF cached IS NOT NULL THEN RETURN cached;END IF;
 config_:=sa_domain.normalize_configuration(p_configuration);hash_:=encode(sha256(convert_to(config_::text,'UTF8')),'hex');
 SELECT generation INTO generation_ FROM sa_domain.runtime_state;
 PERFORM pg_advisory_xact_lock(hashtextextended('preset:'||a.auth_id||':'||hash_,0));
 SELECT product_id INTO id_ FROM sa_domain.preset_index WHERE actor_id=a.auth_id AND generation=generation_ AND fingerprint=hash_;
 IF id_ IS NULL THEN
  SELECT p.id INTO id_ FROM sa_snapshot_20261019.sa_products p WHERE p.created_by_id=a.user_id AND p.product_type=0
  AND p.base_product_id=(config_->>'base_product_id')::bigint AND p.fabric_id=(config_->>'fabric_id')::bigint
  AND p.fabric_color_id=(config_->>'fabric_color_id')::bigint AND p.category_id=(config_->>'category_id')::bigint
  AND sa_domain.product_configuration(p.id)=config_ ORDER BY p.id LIMIT 1;
 END IF;
 reused_:=id_ IS NOT NULL;
 IF NOT reused_ THEN
  INSERT INTO sa_snapshot_20261019.sa_products(product_type,name,comment,base_product_id,fabric_id,fabric_color_id,category_id,created_by_id,branding_enabled,created_at,updated_at)
  VALUES(0,btrim(p_name),p_comment,(config_->>'base_product_id')::bigint,(config_->>'fabric_id')::bigint,(config_->>'fabric_color_id')::bigint,(config_->>'category_id')::bigint,a.user_id,false,now(),now()) RETURNING id INTO id_;
  UPDATE sa_snapshot_20261019.sa_products SET style_number='CP-'||lpad(id_::text,greatest(4,length(id_::text)),'0') WHERE id=id_;
  FOR part_ IN SELECT value FROM jsonb_array_elements(config_->'parts') LOOP
   INSERT INTO sa_snapshot_20261019.sa_product_parts(product_id,part_id,part_color_id,created_at,updated_at)
   VALUES(id_,(part_->>'part_id')::bigint,(part_->>'color_link_id')::bigint,now(),now()) RETURNING id INTO part_id_;
   FOR addon_ IN SELECT value FROM jsonb_array_elements(part_->'addons') LOOP
    INSERT INTO sa_snapshot_20261019.sa_product_part_add_ons(product_part_id,add_on_id,add_on_color_id,created_at,updated_at)
    VALUES(part_id_,(addon_->>'addon_id')::bigint,(addon_->>'color_link_id')::bigint,now(),now());
   END LOOP;
  END LOOP;
  version_:=sa_domain.bump_version('product',id_,sa_domain.version('product',id_));
 ELSE version_:=sa_domain.version('product',id_);END IF;
 INSERT INTO sa_domain.preset_index(actor_id,generation,fingerprint,product_id) VALUES(a.auth_id,generation_,hash_,id_) ON CONFLICT DO NOTHING;
 RETURN sa_domain.finish_command('preset.configured',p_idempotency_key,'product',id_,jsonb_build_object('id',id_::text,'version',version_,'reused',reused_,'fingerprint',hash_,
 'style_number',(SELECT style_number FROM sa_snapshot_20261019.sa_products WHERE id=id_)),jsonb_build_object('reused',reused_));
END $f$;
CREATE FUNCTION sa_domain.v1_presets_list(p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;k text;v jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['id','base_product_id','style_number','search']);
 FOR k,v IN SELECT * FROM jsonb_each(p_filters) LOOP
  IF k IN('id','base_product_id') THEN PERFORM sa_domain.input_id(v);
  ELSIF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>120 THEN RAISE EXCEPTION 'Invalid preset filter' USING ERRCODE='22023';END IF;
 END LOOP;
 ctx:=sa_domain.page_context('presets',p_filters);after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT p.id,p.name,p.style_number,p.comment,p.base_product_id,p.fabric_id,p.category_id,p.branding_enabled FROM sa_snapshot_20261019.sa_products p
 WHERE p.product_type=0 AND p.id<after_ AND (NOT p_filters?'id' OR p.id=(p_filters->>'id')::bigint)
 AND (NOT p_filters?'base_product_id' OR p.base_product_id=(p_filters->>'base_product_id')::bigint)
 AND (NOT p_filters?'style_number' OR p.style_number=p_filters->>'style_number')
 AND (coalesce(p_filters->>'search','')='' OR strpos(lower(concat_ws(' ',p.name,p.style_number)),lower(p_filters->>'search'))>0)
 ORDER BY p.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'name',p.name,'style_number',p.style_number,'base_product_id',p.base_product_id::text,
 'fabric_id',p.fabric_id::text,'category_id',p.category_id::text,'branding_enabled',p.branding_enabled,'version',(ctx->>'generation')||':'||coalesce(v.revision,0))
 ||CASE WHEN p_filters?'id' OR p_filters?'style_number' THEN jsonb_build_object('comment',p.comment,'configuration',sa_domain.product_configuration(p.id)) ELSE '{}' END ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO r
 FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='product' AND v.entity_id=p.id;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_preset_rename(p_id bigint,p_name text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);cached jsonb;version_ text;
BEGIN
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>120 THEN RAISE EXCEPTION 'Invalid preset name' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('preset.renamed',p_idempotency_key,jsonb_build_object('id',p_id,'name',p_name,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM sa_snapshot_20261019.sa_products WHERE id=p_id AND product_type=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Preset not found or unavailable' USING ERRCODE='P0002';END IF;
 version_:=sa_domain.bump_version('product',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_products SET name=btrim(p_name),updated_at=now() WHERE id=p_id;
 RETURN sa_domain.finish_command('preset.renamed',p_idempotency_key,'product',p_id,jsonb_build_object('id',p_id::text,'version',version_),jsonb_build_object('name',btrim(p_name)));
END $f$;

GRANT INSERT ON sa_snapshot_20261019.sa_colors,sa_snapshot_20261019.sa_fabric_colors,sa_snapshot_20261019.sa_part_colors,sa_snapshot_20261019.sa_add_on_colors TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_colors_id_seq,sa_snapshot_20261019.sa_fabric_colors_id_seq,sa_snapshot_20261019.sa_part_colors_id_seq,sa_snapshot_20261019.sa_add_on_colors_id_seq TO sa_executor;
CREATE POLICY squad_color_insert ON sa_snapshot_20261019.sa_colors FOR INSERT TO sa_executor WITH CHECK(created_by_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_fabric_color_insert ON sa_snapshot_20261019.sa_fabric_colors FOR INSERT TO sa_executor WITH CHECK(color_id IN(SELECT id FROM sa_snapshot_20261019.sa_colors WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_part_color_insert ON sa_snapshot_20261019.sa_part_colors FOR INSERT TO sa_executor WITH CHECK(color_id IN(SELECT id FROM sa_snapshot_20261019.sa_colors WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_addon_color_insert ON sa_snapshot_20261019.sa_add_on_colors FOR INSERT TO sa_executor WITH CHECK(color_id IN(SELECT id FROM sa_snapshot_20261019.sa_colors WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE FUNCTION sa_domain.v1_color_save(p_target_kind text,p_target_id bigint,p_name text,p_hex text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');cached jsonb;id_ bigint;hex_ text:=upper(p_hex);reused_ boolean;version_ text;
BEGIN
 IF p_target_kind IS NULL OR p_target_kind NOT IN('fabric','part','addon') OR p_target_id IS NULL OR p_target_id<1
 OR nullif(btrim(p_name),'') IS NULL OR length(p_name)>80 OR hex_ IS NULL OR hex_ !~ '^#[0-9A-F]{6}$' THEN
 RAISE EXCEPTION 'Invalid color name, hex value or target' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('color.created',p_idempotency_key,jsonb_build_object('kind',p_target_kind,'target',p_target_id,'name',p_name,'hex',p_hex));IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF NOT (CASE p_target_kind
 WHEN 'fabric' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_fabrics WHERE id=p_target_id AND is_deleted IS NOT TRUE)
 WHEN 'part' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_parts WHERE id=p_target_id AND is_deleted IS NOT TRUE)
 WHEN 'addon' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_ons WHERE id=p_target_id AND is_deleted IS NOT TRUE AND has_color) END) THEN
 RAISE EXCEPTION 'Color target is unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('color:'||a.user_id||':'||p_target_kind||':'||p_target_id||':'||hex_,0));
 SELECT c.id INTO id_ FROM sa_snapshot_20261019.sa_colors c WHERE c.is_deleted IS NOT TRUE AND upper(c.hex_code)=hex_
 AND CASE p_target_kind
 WHEN 'fabric' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_fabric_colors j WHERE j.fabric_id=p_target_id AND j.color_id=c.id AND j.is_deleted IS NOT TRUE)
 WHEN 'part' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_part_colors j WHERE j.part_id=p_target_id AND j.color_id=c.id AND j.is_deleted IS NOT TRUE)
 WHEN 'addon' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_add_on_colors j WHERE j.add_on_id=p_target_id AND j.color_id=c.id AND j.is_deleted IS NOT TRUE) END
 ORDER BY (c.created_by_id IS NULL) DESC,c.id LIMIT 1;
 reused_:=id_ IS NOT NULL;
 IF NOT reused_ THEN
  INSERT INTO sa_snapshot_20261019.sa_colors(name,hex_code,created_by_id,is_deleted,source,created_at,updated_at) VALUES(btrim(p_name),hex_,a.user_id,false,1,now(),now()) RETURNING id INTO id_;
  CASE p_target_kind
  WHEN 'fabric' THEN INSERT INTO sa_snapshot_20261019.sa_fabric_colors(fabric_id,color_id,is_deleted,created_at,updated_at) VALUES(p_target_id,id_,false,now(),now());
  WHEN 'part' THEN INSERT INTO sa_snapshot_20261019.sa_part_colors(part_id,color_id,is_deleted,created_at,updated_at) VALUES(p_target_id,id_,false,now(),now());
  WHEN 'addon' THEN INSERT INTO sa_snapshot_20261019.sa_add_on_colors(add_on_id,color_id,is_deleted,created_at,updated_at) VALUES(p_target_id,id_,false,now(),now());END CASE;
  version_:=sa_domain.bump_version('color',id_,sa_domain.version('color',id_));
 ELSE version_:=sa_domain.version('color',id_);END IF;
 RETURN sa_domain.finish_command('color.created',p_idempotency_key,'color',id_,jsonb_build_object('id',id_::text,'version',version_,'reused',reused_,'hex',hex_,
 'name',(SELECT name FROM sa_snapshot_20261019.sa_colors WHERE id=id_)),jsonb_build_object('target_kind',p_target_kind,'target_id',p_target_id::text));
END $f$;

ALTER TABLE sa_domain.quotes ADD COLUMN ledger_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE;
ALTER TABLE sa_domain.quotes ADD COLUMN base_result jsonb;
UPDATE sa_domain.quotes SET base_result=result;
ALTER TABLE sa_domain.quotes ALTER COLUMN base_result SET NOT NULL;
ALTER TABLE sa_domain.quotes ADD COLUMN overrides jsonb NOT NULL DEFAULT '{}';
GRANT USAGE ON SEQUENCE sa_domain.quotes_ledger_id_seq TO sa_executor;

CREATE FUNCTION sa_domain.override_quote_prices(p_base jsonb,p_overrides jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE l jsonb;v jsonb;over_ jsonb;unit_ numeric;brand_ numeric;qty_ integer;tax_ jsonb;sku_ record;lines_ jsonb:='[]';variants_ jsonb;
 sub_ numeric;cg numeric;sg numeric;ig numeric;all_sub numeric:=0;all_cg numeric:=0;all_sg numeric:=0;all_ig numeric:=0;state_ text;
BEGIN
 state_:=sa_domain.quote_address((p_base->'context'->>'customer_id')::bigint,(p_base->>'address_id')::bigint);
 FOR l IN SELECT value FROM jsonb_array_elements(p_base->'lines') LOOP
  over_:=p_overrides->(l->>'line');
  IF over_ IS NOT NULL THEN
   unit_:=sa_domain.input_number(over_->'unit_price',0,100000000);brand_:=(l->'branding'->>'unit_price')::numeric;sub_:=0;cg:=0;sg:=0;ig:=0;variants_:='[]';
   FOR v IN SELECT value FROM jsonb_array_elements(l->'variants') LOOP
    qty_:=(v->>'quantity')::int;sub_:=sub_+unit_*qty_;
    IF l->>'kind'='rmp' THEN
     SELECT cgst,sgst,igst INTO sku_ FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=(v->>'sku_id')::bigint AND is_deleted IS NOT TRUE;
     IF NOT FOUND THEN RAISE EXCEPTION 'SKU no longer available' USING ERRCODE='40001';END IF;
     tax_:=sa_domain.unit_tax(unit_+brand_,state_,sku_.cgst,sku_.sgst,sku_.igst);
    ELSE tax_:=sa_domain.unit_tax(unit_+brand_,state_);END IF;
    cg:=cg+(tax_->>'cgst')::numeric*qty_;sg:=sg+(tax_->>'sgst')::numeric*qty_;ig:=ig+(tax_->>'igst')::numeric*qty_;
    variants_:=variants_||jsonb_build_array(v||jsonb_build_object('calculated_unit_price',v->>'unit_price','unit_price',unit_::text));
   END LOOP;
   sub_:=round(sub_,2);
   l:=l||jsonb_build_object('variants',variants_,'override',over_,'subtotal',sub_::text,'cgst',cg::text,'sgst',sg::text,'igst',ig::text,
    'total',round(sub_+(l->>'branding_total')::numeric+cg+sg+ig,2)::text);
  END IF;
  all_sub:=all_sub+(l->>'subtotal')::numeric;all_cg:=all_cg+(l->>'cgst')::numeric;all_sg:=all_sg+(l->>'sgst')::numeric;all_ig:=all_ig+(l->>'igst')::numeric;
  lines_:=lines_||jsonb_build_array(l);
 END LOOP;
 RETURN p_base||jsonb_build_object('lines',lines_,'subtotal',all_sub::text,'cgst',all_cg::text,'sgst',all_sg::text,'igst',all_ig::text,
 'total',round(all_sub+(p_base->>'branding_total')::numeric+all_cg+all_sg+all_ig,2)::text);
END $f$;
CREATE FUNCTION sa_domain.v1_quote_override(p_quote_id uuid,p_line integer,p_unit_price numeric,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);cached jsonb;q sa_domain.quotes%ROWTYPE;current_ jsonb;result_ jsonb;
BEGIN
 PERFORM sa_domain.input_number(to_jsonb(p_unit_price),0,100000000);
 IF nullif(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))<5 OR length(p_reason)>1000 OR p_line IS NULL OR p_line<1 THEN RAISE EXCEPTION 'Provide a valid quote line and override reason' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('quote.overridden',p_idempotency_key,jsonb_build_object('quote_id',p_quote_id,'line',p_line,'unit_price',p_unit_price,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO q FROM sa_domain.quotes WHERE id=p_quote_id FOR UPDATE;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found or unavailable' USING ERRCODE='P0002';END IF;
 IF q.expires_at<=clock_timestamp() OR q.generation<>(SELECT generation FROM sa_domain.runtime_state) OR (q.generation||':'||q.revision) IS DISTINCT FROM p_expected_version THEN
 RAISE EXCEPTION 'Quote changed or expired; request a new quote' USING ERRCODE='40001';END IF;
 IF p_line>jsonb_array_length(q.result->'lines') THEN RAISE EXCEPTION 'Invalid quote line' USING ERRCODE='22023';END IF;
 current_:=sa_domain.calculate_quote(q.request,false);
 IF current_<>q.base_result THEN RAISE EXCEPTION 'Pricing inputs changed; request a new quote' USING ERRCODE='40001';END IF;
 q.overrides:=q.overrides||jsonb_build_object(p_line::text,jsonb_build_object('unit_price',p_unit_price::text,'reason',btrim(p_reason)));
 result_:=sa_domain.override_quote_prices(q.base_result,q.overrides);
 UPDATE sa_domain.quotes SET overrides=q.overrides,result=result_,revision=revision+1 WHERE id=q.id RETURNING * INTO q;
 result_:=result_||jsonb_build_object('quote_id',q.id,'version',q.generation||':'||q.revision,'expires_at',q.expires_at,
  'fingerprint',encode(sha256(convert_to(result_::text,'UTF8')),'hex'));
 RETURN sa_domain.finish_command('quote.overridden',p_idempotency_key,'quote',q.ledger_id,result_,jsonb_build_object('quote_id',q.id,'line',p_line,'unit_price',p_unit_price::text,'reason',btrim(p_reason)));
END $f$;
REVOKE ALL ON FUNCTION sa_domain.override_quote_prices(jsonb,jsonb) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.override_quote_prices(jsonb,jsonb) TO sa_executor;

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
 'address_id',address_::text,'tax_state',state_,'lines',lines_,'quantity',all_qty,'subtotal',all_sub::text,'branding_total',all_brand::text,'cgst',all_cg::text,'sgst',all_sg::text,'igst',all_ig::text,
 'total',round(all_sub+all_brand+all_cg+all_sg+all_ig,2)::text);
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_quote(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');r jsonb;q sa_domain.quotes%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 r:=sa_domain.calculate_quote(p_request,false);
 INSERT INTO sa_domain.quotes(actor_id,customer_id,generation,request,result,base_result)
 SELECT a.auth_id,(r->'context'->>'customer_id')::bigint,generation,p_request,r,r FROM sa_domain.runtime_state RETURNING * INTO q;
 RETURN r||jsonb_build_object('quote_id',q.id,'version',q.generation||':'||q.revision,'expires_at',q.expires_at,
 'fingerprint',encode(sha256(convert_to(r::text,'UTF8')),'hex'));
END $f$;

CREATE OR REPLACE FUNCTION sa_domain.v1_configurator_options(p_base_id bigint,p_kind text,p_parent_id bigint DEFAULT NULL,p_part_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;
 show_cost boolean:=sa_domain.cost_visible();media_ jsonb;resource_ text;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('categories','fabrics','fabric_colors','parts','part_colors','addons','addon_colors','size_types','assets') THEN RAISE EXCEPTION 'Unknown configuration selector' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM sa_snapshot_20261019.sa_base_products WHERE id=p_base_id AND is_deleted IS NOT TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Base product unavailable' USING ERRCODE='P0002';END IF;
 IF p_kind IN('fabric_colors','part_colors','addons','addon_colors') AND p_parent_id IS NULL THEN RAISE EXCEPTION 'Parent selection required' USING ERRCODE='22023';END IF;
 IF p_kind='addon_colors' AND p_part_id IS NULL THEN RAISE EXCEPTION 'Part selection required' USING ERRCODE='22023';END IF;
 IF p_kind='assets' AND ((p_parent_id IS NULL)<>(p_part_id IS NULL)) THEN RAISE EXCEPTION 'Select both part and add-on for a preview layer' USING ERRCODE='22023';END IF;
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
 UNION ALL SELECT ai.id,jsonb_build_object('id',ai.id::text,'name','Preview layer','asset',ai.asset,
 'offset_x',ai."dX"::text,'offset_y',ai."dY"::text,'mirror_offset_x',ai."mirrorDX"::text,'height_ratio',ai."assetHeightRespToBox"::text,'part_id',p_part_id::text,'addon_id',p_parent_id::text)
 FROM sa_snapshot_20261019.sa_asset_infos ai WHERE p_kind='assets' AND ai.is_deleted IS NOT TRUE AND (
 (p_parent_id IS NULL AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=p_base_id AND b.asset_info_id=ai.id))
 OR(p_parent_id IS NOT NULL AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_product_asset_infos m
 JOIN sa_snapshot_20261019.sa_base_product_parts bp ON bp.base_product_id=m.base_product_id AND bp.part_id=m.part_id AND bp.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_parts part ON part.id=bp.part_id AND part.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_add_ons ad ON ad.id=m.add_on_id AND ad.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_add_on_parts ap ON ap.part_id=part.id AND ap.add_on_id=ad.id AND ap.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_add_on_base_products ab ON ab.base_product_id=m.base_product_id AND ab.add_on_id=ad.id AND ab.is_deleted IS NOT TRUE
 WHERE m.base_product_id=p_base_id AND m.part_id=p_part_id AND m.add_on_id=p_parent_id AND m.asset_info_id=ai.id AND m.is_deleted IS NOT TRUE)))
 ) x WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(payload ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 IF p_kind IN('fabrics','addons') THEN
  resource_:=CASE p_kind WHEN 'fabrics' THEN 'fabrics' ELSE 'add_ons' END;
  media_:=sa_domain.catalog_media_batch(resource_,r->'data',ARRAY['image']);
  r:=r||jsonb_build_object('data',(SELECT coalesce(jsonb_agg(x.value||jsonb_build_object('image',media_->(x.value->>'id')->'image') ORDER BY x.ordinality),'[]') FROM jsonb_array_elements(r->'data') WITH ORDINALITY x));
 ELSIF p_kind='assets' THEN
 media_:=sa_domain.catalog_media_batch('asset_infos',r->'data',ARRAY['asset']);
 r:=r||jsonb_build_object('data',(SELECT coalesce(jsonb_agg(x.value||jsonb_build_object('asset',media_->(x.value->>'id')->'asset') ORDER BY x.ordinality),'[]') FROM jsonb_array_elements(r->'data') WITH ORDINALITY x));
 END IF;RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.normalize_configuration(p_config jsonb) RETURNS jsonb
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
  IF EXISTS(SELECT addon_group.group_name FROM jsonb_array_elements(addons_) x JOIN sa_snapshot_20261019.sa_add_ons addon_group ON addon_group.id=(x->>'addon_id')::bigint
   GROUP BY addon_group.group_name HAVING bool_or(addon_group.select_type=0) AND count(*)>1) THEN RAISE EXCEPTION 'Only one add-on from a single-selection group is allowed' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'addon_id')::bigint),'[]') INTO addons_ FROM jsonb_array_elements(addons_) x;
  parts_:=parts_||jsonb_build_array(jsonb_build_object('part_id',part_id_::text,'color_id',part_color_::text,'color_link_id',part_join_::text,'addons',addons_));
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'part_id')::bigint),'[]') INTO parts_ FROM jsonb_array_elements(parts_) x;
 RETURN jsonb_build_object('base_product_id',base_::text,'fabric_id',fabric_::text,'fabric_color_id',color_::text,'category_id',category_::text,'parts',parts_);
END $f$;
DO $do$ DECLARE f record;arguments_ text;body_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_product_configure','v1_presets_list','v1_preset_rename','v1_color_save','v1_quote_override']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
END $do$;
REVOKE ALL ON FUNCTION sa_domain.product_configuration(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.product_configuration(bigint) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
