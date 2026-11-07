BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
ALTER TABLE sa_domain.quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.quotes ADD COLUMN accepted_order_ids bigint[];

-- Business routing reads only eligible relationships; no client-supplied dealer/SC.
CREATE FUNCTION sa_domain.order_customer_context(p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,3,10]);u record;sc_ bigint;dealers_ jsonb;
BEGIN
 PERFORM sa_domain.commercial_context(p_customer_id);
 SELECT id,role,created_by_id,approved,is_direct_deal INTO u FROM sa_snapshot_20261019.sa_users
 WHERE id=p_customer_id AND role IN(3,10) AND deleted_at IS NULL AND disabled IS NOT TRUE;
 IF u.id IS NULL OR (u.role=3 AND u.approved IS FALSE) THEN RAISE EXCEPTION 'Customer is not eligible to order' USING ERRCODE='42501';END IF;
 SELECT id INTO sc_ FROM sa_snapshot_20261019.sa_users WHERE id=u.created_by_id AND role=1 AND deleted_at IS NULL AND disabled IS NOT TRUE;
 SELECT coalesce(jsonb_agg(d.id::text ORDER BY (d.id=a.user_id) DESC,link.id,d.id),'[]') INTO dealers_
 FROM sa_snapshot_20261019.sa_user_dealers link JOIN sa_snapshot_20261019.sa_users d ON d.id=link.dealer_id AND d.role=10 AND d.deleted_at IS NULL AND d.disabled IS NOT TRUE
 WHERE link.user_id=u.id AND u.is_direct_deal IS NOT TRUE;
 RETURN jsonb_build_object('customer_id',u.id::text,'coordinator_id',sc_::text,'dealer_ids',dealers_,'direct',u.is_direct_deal IS TRUE);
END $f$;
ALTER FUNCTION sa_domain.order_customer_context(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.order_dealer_for_brand(p_customer_id bigint,p_brand_id bigint) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.order_customer_context(p_customer_id);id_ bigint;
BEGIN
 SELECT d.id INTO id_ FROM sa_snapshot_20261019.sa_user_dealers link
 JOIN sa_snapshot_20261019.sa_users d ON d.id=link.dealer_id AND d.role=10 AND d.deleted_at IS NULL AND d.disabled IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_assigned_brands ab ON ab.user_id=d.id
 JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.authorized_brand_id=ab.authorized_brand_id AND b.id=p_brand_id AND b.is_deleted IS NOT TRUE
 WHERE link.user_id=p_customer_id ORDER BY (d.id=(SELECT (sa_domain.actor()).user_id)) DESC,link.id,d.id LIMIT 1;
 RETURN id_;
END $f$;
ALTER FUNCTION sa_domain.order_dealer_for_brand(bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.order_customer_context(bigint),sa_domain.order_dealer_for_brand(bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.order_customer_context(bigint),sa_domain.order_dealer_for_brand(bigint,bigint) TO sa_executor;

GRANT INSERT ON sa_snapshot_20261019.sa_orders,sa_snapshot_20261019.sa_items,sa_snapshot_20261019.sa_quantities,sa_snapshot_20261019.sa_extra_quantities,
 sa_snapshot_20261019.sa_brandings,sa_snapshot_20261019.sa_item_criteria,sa_snapshot_20261019.sa_criteria,sa_snapshot_20261019.sa_sizes TO sa_executor;
GRANT SELECT ON sa_snapshot_20261019.sa_extra_quantities,sa_snapshot_20261019.sa_brandings,sa_snapshot_20261019.sa_item_criteria,sa_snapshot_20261019.sa_criteria TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_orders_id_seq,sa_snapshot_20261019.sa_items_id_seq,sa_snapshot_20261019.sa_quantities_id_seq,
 sa_snapshot_20261019.sa_extra_quantities_id_seq,sa_snapshot_20261019.sa_brandings_id_seq,sa_snapshot_20261019.sa_item_criteria_id_seq,sa_snapshot_20261019.sa_criteria_id_seq,sa_snapshot_20261019.sa_sizes_id_seq TO sa_executor;
CREATE POLICY squad_orders_insert ON sa_snapshot_20261019.sa_orders FOR INSERT TO sa_executor WITH CHECK(created_by_id=(SELECT (sa_domain.actor()).user_id) AND sa_domain.can_person(customer_id));
CREATE POLICY squad_items_insert ON sa_snapshot_20261019.sa_items FOR INSERT TO sa_executor WITH CHECK(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_quantities_insert ON sa_snapshot_20261019.sa_quantities FOR INSERT TO sa_executor WITH CHECK(item_id IN(SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_extras_insert ON sa_snapshot_20261019.sa_extra_quantities FOR INSERT TO sa_executor WITH CHECK(item_id IN(SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_extras_read ON sa_snapshot_20261019.sa_extra_quantities FOR SELECT TO sa_executor USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY squad_brandings_insert ON sa_snapshot_20261019.sa_brandings FOR INSERT TO sa_executor WITH CHECK(item_id IN(SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_brandings_read ON sa_snapshot_20261019.sa_brandings FOR SELECT TO sa_executor USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items) OR product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products));
CREATE POLICY squad_criteria_insert ON sa_snapshot_20261019.sa_item_criteria FOR INSERT TO sa_executor WITH CHECK(item_id IN(SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_criteria_read ON sa_snapshot_20261019.sa_item_criteria FOR SELECT TO sa_executor USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY squad_criteria_names ON sa_snapshot_20261019.sa_criteria FOR SELECT TO sa_executor USING((SELECT (sa_domain.actor()).user_id) IS NOT NULL);
CREATE POLICY squad_criteria_names_insert ON sa_snapshot_20261019.sa_criteria FOR INSERT TO sa_executor WITH CHECK((SELECT (sa_domain.actor()).role_id) IN(1,3,10));
CREATE POLICY squad_sizes_insert ON sa_snapshot_20261019.sa_sizes FOR INSERT TO sa_executor WITH CHECK((SELECT (sa_domain.actor()).role_id) IN(1,3,10));
CREATE INDEX squad_sizes_name ON sa_snapshot_20261019.sa_sizes(name,id);
CREATE INDEX squad_criteria_name ON sa_snapshot_20261019.sa_criteria(name,id);

CREATE FUNCTION sa_domain.order_size(p_name text) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE id_ bigint;
BEGIN
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>100 THEN RAISE EXCEPTION 'Invalid size name' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('size:'||p_name,0));
 SELECT id INTO id_ FROM sa_snapshot_20261019.sa_sizes WHERE name=p_name ORDER BY id LIMIT 1;
 IF id_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_sizes(name,created_at,updated_at) VALUES(p_name,now(),now()) RETURNING id INTO id_;END IF;RETURN id_;
END $f$;
CREATE FUNCTION sa_domain.attach_order_criteria(p_item_id bigint,p_product_id bigint,p_branding boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE name_ text;id_ bigint;
BEGIN
 FOR name_ IN SELECT DISTINCT x.name FROM(
 SELECT unnest(ARRAY['Fabric','Trims']||CASE WHEN p_branding THEN ARRAY['Branding'] ELSE ARRAY[]::text[] END) name
 UNION SELECT p.name FROM sa_snapshot_20261019.sa_product_parts pp JOIN sa_snapshot_20261019.sa_parts p ON p.id=pp.part_id WHERE pp.product_id=p_product_id AND p.order_criteria) x ORDER BY x.name LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('criteria:'||name_,0));
  SELECT id INTO id_ FROM sa_snapshot_20261019.sa_criteria WHERE name=name_ ORDER BY id LIMIT 1;
  IF id_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_criteria(name,created_at,updated_at) VALUES(name_,now(),now()) RETURNING id INTO id_;END IF;
  INSERT INTO sa_snapshot_20261019.sa_item_criteria(item_id,criteria_id,is_checked,created_at,updated_at) VALUES(p_item_id,id_,false,now(),now());
 END LOOP;
END $f$;

-- Artwork has independent ownership; canonical preset matching never grants it.
CREATE TABLE sa_domain.design_owners(branding_id bigint PRIMARY KEY,actor_id uuid NOT NULL,generation bigint NOT NULL);
ALTER TABLE sa_domain.design_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.design_owners FORCE ROW LEVEL SECURITY;
CREATE POLICY squad_design_owners ON sa_domain.design_owners TO sa_executor USING(actor_id=(SELECT (sa_domain.actor()).auth_id)) WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id));
GRANT SELECT,INSERT ON sa_domain.design_owners TO sa_executor;
CREATE POLICY squad_design_read ON sa_snapshot_20261019.sa_brandings FOR SELECT TO sa_executor USING(id IN(SELECT branding_id FROM sa_domain.design_owners WHERE generation=(SELECT generation FROM sa_domain.runtime_state)));
CREATE POLICY squad_design_insert ON sa_snapshot_20261019.sa_brandings FOR INSERT TO sa_executor WITH CHECK(item_id IS NULL AND id IN(SELECT branding_id FROM sa_domain.design_owners WHERE generation=(SELECT generation FROM sa_domain.runtime_state)));
GRANT UPDATE(comment,print_side,print_area,branding_type,graphic_dimension,graphic_width,graphic_height,graphic_unit,updated_at) ON sa_snapshot_20261019.sa_brandings TO sa_executor;
CREATE POLICY squad_design_update ON sa_snapshot_20261019.sa_brandings FOR UPDATE TO sa_executor USING(item_id IS NULL AND (
 id IN(SELECT branding_id FROM sa_domain.design_owners WHERE generation=(SELECT generation FROM sa_domain.runtime_state))
 OR product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)))) WITH CHECK(item_id IS NULL);
CREATE FUNCTION sa_domain.v1_branding_save(p_id bigint,p_product_id bigint,p_spec jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');cached jsonb;id_ bigint;v text;old_ sa_snapshot_20261019.sa_brandings%ROWTYPE;verified jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_spec,ARRAY['type','side','width','height','unit','comment','print_area']);
 verified:=sa_domain.branding_price(jsonb_build_array(p_spec-'comment'-'print_area'),1);
 IF (p_spec?'comment' AND (jsonb_typeof(p_spec->'comment')<>'string' OR length(p_spec->>'comment')>4000))
 OR (p_spec?'print_area' AND (jsonb_typeof(p_spec->'print_area')<>'string' OR length(p_spec->>'print_area')>120)) THEN RAISE EXCEPTION 'Invalid design comment or print area' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('design.saved',p_idempotency_key,jsonb_build_object('id',p_id,'product_id',p_product_id,'spec',p_spec,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF p_product_id IS NOT NULL AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_products WHERE id=p_product_id AND created_by_id=a.user_id) THEN
 RAISE EXCEPTION 'Design template must belong to your preset' USING ERRCODE='42501';END IF;
 IF p_id IS NULL THEN
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'New designs do not have a version' USING ERRCODE='22023';END IF;
  id_:=nextval('sa_snapshot_20261019.sa_brandings_id_seq');
  INSERT INTO sa_domain.design_owners(branding_id,actor_id,generation) SELECT id_,a.auth_id,generation FROM sa_domain.runtime_state;
  INSERT INTO sa_snapshot_20261019.sa_brandings(id,product_id,comment,print_side,print_area,branding_type,graphic_dimension,graphic_width,graphic_height,graphic_unit,created_at,updated_at)
  VALUES(id_,p_product_id,coalesce(p_spec->>'comment',''),p_spec->>'side',p_spec->>'print_area',CASE p_spec->>'type' WHEN 'print' THEN 0 ELSE 1 END,
  (p_spec->>'width')||'x'||(p_spec->>'height'),(p_spec->>'width')::numeric,(p_spec->>'height')::numeric,'inch',now(),now());
  v:=sa_domain.bump_version('branding',id_,sa_domain.version('branding',id_));
 ELSE
  id_:=p_id;SELECT * INTO old_ FROM sa_snapshot_20261019.sa_brandings WHERE id=id_ FOR UPDATE;
  IF old_.id IS NULL OR old_.item_id IS NOT NULL OR old_.product_id IS DISTINCT FROM p_product_id OR NOT(
   EXISTS(SELECT FROM sa_domain.design_owners WHERE branding_id=id_ AND generation=(SELECT generation FROM sa_domain.runtime_state))
   OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_products WHERE id=old_.product_id AND created_by_id=a.user_id)) THEN
   RAISE EXCEPTION 'Design not found or not editable' USING ERRCODE='P0002';END IF;
  v:=sa_domain.bump_version('branding',id_,p_expected_version);
  UPDATE sa_snapshot_20261019.sa_brandings SET comment=coalesce(p_spec->>'comment',''),print_side=p_spec->>'side',print_area=p_spec->>'print_area',
   branding_type=CASE p_spec->>'type' WHEN 'print' THEN 0 ELSE 1 END,graphic_dimension=(p_spec->>'width')||'x'||(p_spec->>'height'),
   graphic_width=(p_spec->>'width')::numeric,graphic_height=(p_spec->>'height')::numeric,graphic_unit='inch',updated_at=now() WHERE id=id_;
 END IF;
 RETURN sa_domain.finish_command('design.saved',p_idempotency_key,'branding',id_,jsonb_build_object('id',id_::text,'version',v,'product_id',p_product_id::text),jsonb_build_object('product_id',p_product_id::text));
END $f$;

CREATE FUNCTION sa_domain.order_plan(p_quote jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.order_customer_context((p_quote->'context'->>'customer_id')::bigint);l jsonb;lines_ jsonb:='[]';groups_ jsonb;
 dealer_ bigint;pure_rmp boolean;
BEGIN
 pure_rmp:=NOT EXISTS(SELECT FROM jsonb_array_elements(p_quote->'lines') x WHERE x->>'kind'='custom');
 FOR l IN SELECT value FROM jsonb_array_elements(p_quote->'lines') LOOP
  dealer_:=(context_->'dealer_ids'->>0)::bigint;
  IF pure_rmp AND jsonb_array_length(context_->'dealer_ids')>0 THEN
   dealer_:=sa_domain.order_dealer_for_brand((context_->>'customer_id')::bigint,(l->'variants'->0->>'brand_id')::bigint);
   IF dealer_ IS NULL THEN RAISE EXCEPTION 'No eligible linked dealer is authorized for one of these brands' USING ERRCODE='22023';END IF;
  END IF;
  lines_:=lines_||jsonb_build_array(l||jsonb_build_object('dealer_id',dealer_::text));
 END LOOP;
 WITH groups AS(SELECT line_value->>'dealer_id' dealer_id,jsonb_agg(line_value ORDER BY (line_value->>'line')::int) lines,
 sum((line_value->>'subtotal')::numeric) subtotal,sum((line_value->>'branding_total')::numeric) branding,sum((line_value->>'cgst')::numeric) cgst,
 sum((line_value->>'sgst')::numeric) sgst,sum((line_value->>'igst')::numeric) igst,sum((line_value->>'quantity')::int) quantity
 FROM jsonb_array_elements(lines_) line_value GROUP BY line_value->>'dealer_id')
 SELECT jsonb_agg(jsonb_build_object('dealer_id',dealer_id,'lines',lines,'subtotal',subtotal::text,'branding_total',branding::text,
 'cgst',cgst::text,'sgst',sgst::text,'igst',igst::text,'quantity',quantity,'unrounded_total',(subtotal+branding+cgst+sgst+igst)::text,'total',round(subtotal+branding+cgst+sgst+igst,2)::text,'rounding_adjustment','0') ORDER BY dealer_id::bigint NULLS FIRST)
 INTO groups_ FROM groups;
 WITH shares AS(SELECT value,ordinality,(value->>'unrounded_total')::numeric*100 exact_cents
 FROM jsonb_array_elements(groups_) WITH ORDINALITY), ranked AS(
 SELECT *,floor(exact_cents) cents,row_number() OVER(ORDER BY exact_cents-floor(exact_cents) DESC,ordinality) priority,
 (p_quote->>'total')::numeric*100-sum(floor(exact_cents)) OVER() remaining FROM shares),allocated AS(
 SELECT *, (cents+CASE WHEN priority<=remaining THEN 1 ELSE 0 END)/100 amount FROM ranked)
 SELECT jsonb_agg((value-'unrounded_total')||jsonb_build_object('total',amount::text,'rounding_adjustment',(amount-(value->>'total')::numeric)::text) ORDER BY ordinality)
 INTO groups_ FROM allocated;
 RETURN jsonb_build_object('context',context_,'groups',groups_);
END $f$;

CREATE FUNCTION sa_domain.design_for_order(p_spec jsonb,p_require_file boolean DEFAULT true) RETURNS sa_snapshot_20261019.sa_brandings
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE b sa_snapshot_20261019.sa_brandings%ROWTYPE;
BEGIN
 IF NOT p_spec?'design_id' THEN
  IF p_require_file THEN RAISE EXCEPTION 'Finalize and select the design before placing this order' USING ERRCODE='22023';END IF;RETURN NULL;
 END IF;
 SELECT * INTO b FROM sa_snapshot_20261019.sa_brandings WHERE id=sa_domain.input_id(p_spec->'design_id');
 IF b.id IS NULL THEN RAISE EXCEPTION 'Design not found or unavailable' USING ERRCODE='P0002';END IF;
 IF p_spec->>'design_version' IS DISTINCT FROM sa_domain.version('branding',b.id) OR b.graphic_width IS DISTINCT FROM (p_spec->>'width')::numeric
 OR b.graphic_height IS DISTINCT FROM (p_spec->>'height')::numeric OR b.print_side IS DISTINCT FROM p_spec->>'side'
 OR b.graphic_unit IS DISTINCT FROM p_spec->>'unit' OR b.branding_type IS DISTINCT FROM (CASE p_spec->>'type' WHEN 'print' THEN 0 ELSE 1 END) THEN
 RAISE EXCEPTION 'Design changed; reload and quote again' USING ERRCODE='40001';END IF;
 IF p_require_file AND NOT EXISTS(SELECT FROM sa_media.references r WHERE r.resource='brandings' AND r.record_id=b.id AND r.field='image' AND r.pointer='' AND r.source_value=b.image AND r.status='ready') THEN
 RAISE EXCEPTION 'The design image is not available in this environment' USING ERRCODE='22023';END IF;
 RETURN b;
END $f$;
GRANT INSERT ON sa_media.references TO sa_executor;
CREATE POLICY squad_order_media_copy ON sa_media.references FOR INSERT TO sa_executor WITH CHECK(resource='brandings' AND record_id IN(
 SELECT b.id FROM sa_snapshot_20261019.sa_brandings b JOIN sa_snapshot_20261019.sa_items i ON i.id=b.item_id
 JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE FUNCTION sa_domain.attach_order_design(p_item_id bigint,p_spec jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE b sa_snapshot_20261019.sa_brandings:=sa_domain.design_for_order(p_spec,true);id_ bigint;
BEGIN
 INSERT INTO sa_snapshot_20261019.sa_brandings(item_id,parent_id,image,mockup_image,attachment,comment,print_side,print_area,branding_type,graphic_dimension,graphic_width,graphic_height,graphic_unit,created_at,updated_at)
 VALUES(p_item_id,b.id,b.image,b.mockup_image,b.attachment,b.comment,b.print_side,b.print_area,b.branding_type,b.graphic_dimension,b.graphic_width,b.graphic_height,b.graphic_unit,now(),now()) RETURNING id INTO id_;
 INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,source_url,status,sha256)
 SELECT 'brandings',id_,r.field,r.pointer,r.source_value,r.source_url,r.status,r.sha256 FROM sa_media.references r WHERE r.resource='brandings' AND r.record_id=b.id
 AND r.field IN('image','mockup_image','attachment') AND r.source_value=CASE r.field WHEN 'image' THEN b.image WHEN 'mockup_image' THEN b.mockup_image ELSE b.attachment END;
 RETURN id_;
END $f$;

CREATE TABLE sa_domain.order_receipts(order_id bigint PRIMARY KEY,quote_id uuid NOT NULL,actor_id uuid NOT NULL,generation bigint NOT NULL,
 pricing jsonb NOT NULL,delivery jsonb NOT NULL,rounding_adjustment numeric NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE sa_domain.order_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.order_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.order_receipts TO sa_executor;
CREATE POLICY squad_receipts_read ON sa_domain.order_receipts FOR SELECT TO sa_executor USING(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
CREATE POLICY squad_receipts_insert ON sa_domain.order_receipts FOR INSERT TO sa_executor WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id) AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE FUNCTION sa_domain.delivery_context(p_customer_id bigint,p_address_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.quote_address(p_customer_id,p_address_id);
 RETURN(SELECT jsonb_build_object('address_id',id::text,'address',address,'state',state,'city',city,'zip_code',zip_code) FROM sa_snapshot_20261019.sa_addresses WHERE id=p_address_id AND user_id=p_customer_id AND deleted_at IS NULL);
END $f$;
ALTER FUNCTION sa_domain.delivery_context(bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.delivery_context(bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.delivery_context(bigint,bigint) TO sa_executor;

CREATE FUNCTION sa_domain.create_order_line(p_order_id bigint,p_line jsonb,p_settings jsonb,p_state text) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE product_ bigint;item_ bigint;size_ bigint;type_ integer;size_type_ text;config_ jsonb;cost_ jsonb;variant_ jsonb;q jsonb;tax_ jsonb;branding_ jsonb;
 unit_ numeric;calculated_ numeric;weight_ numeric:=0;addons_ numeric:=0;quantity_ integer:=(p_line->>'quantity')::int;sample_ jsonb:=p_line->'quantities'->'sample';sample_amount numeric:=0;
BEGIN
 PERFORM sa_domain.check_fields(p_settings,ARRAY['product_id','comment','size_type_id']);
 IF p_settings?'comment' AND (jsonb_typeof(p_settings->'comment')<>'string' OR length(p_settings->>'comment')>4000) THEN RAISE EXCEPTION 'Invalid item comment' USING ERRCODE='22023';END IF;
 type_:=CASE p_line->>'kind' WHEN 'custom' THEN 0 ELSE 1 END;
 IF type_=0 THEN
  product_:=sa_domain.input_id(p_settings->'product_id');config_:=sa_domain.product_configuration(product_);
  IF config_ IS NULL OR config_<>p_line->'configuration' THEN RAISE EXCEPTION 'Preset is unavailable or does not match the quote' USING ERRCODE='22023';END IF;
  cost_:=sa_domain.custom_price(config_,quantity_,(p_line->'quantities'->>'sample_order')::boolean);
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
 INSERT INTO sa_snapshot_20261019.sa_items(order_id,item_type,product_id,rmp_class_id,rmp_brand_id,rmp_category_id,comment,sample_order,total_amount,total_quantity,sample_total_amount,
 weight_per_piece,total_weight,per_piece_amount,calculated_per_piece_amount,rmp_override_price,branding_amount,cgst_amount,sgst_amount,igst_amount,add_on_cost,size_type,created_at,updated_at)
 VALUES(p_order_id,type_,product_,(p_line->'variants'->0->>'class_id')::bigint,(p_line->'variants'->0->>'brand_id')::bigint,(p_line->'variants'->0->>'category_id')::bigint,
 coalesce(p_settings->>'comment',''),coalesce((p_line->'quantities'->>'sample_order')::boolean,false),(p_line->>'subtotal')::numeric,quantity_,sample_amount,
 weight_,round(weight_*quantity_,2),unit_,calculated_,CASE WHEN type_=1 AND p_line?'override' THEN (p_line->'override'->>'unit_price')::numeric ELSE 0 END,
 (p_line->>'branding_total')::numeric,(p_line->>'cgst')::numeric,(p_line->>'sgst')::numeric,(p_line->>'igst')::numeric,addons_,coalesce(size_type_,''),now(),now()) RETURNING id INTO item_;
 IF type_=0 THEN
  IF sample_ IS NOT NULL AND sample_<>'null' THEN
   INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(item_,(sample_->>'size_id')::bigint,(sample_->>'quantity')::int,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_extra_quantities(item_id,size_id,quantity,created_at,updated_at)
   SELECT item_,(x->>'size_id')::bigint,(x->>'quantity')::int,now(),now() FROM jsonb_array_elements(p_line->'quantities'->'quantities') x;
  ELSE
   INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,cgst,sgst,igst,created_at,updated_at)
   SELECT item_,(x->>'size_id')::bigint,(x->>'quantity')::int,(p_line->>'cgst')::numeric/quantity_*(x->>'quantity')::int,
   (p_line->>'sgst')::numeric/quantity_*(x->>'quantity')::int,(p_line->>'igst')::numeric/quantity_*(x->>'quantity')::int,now(),now()
   FROM jsonb_array_elements(p_line->'quantities'->'quantities') x;
  END IF;
  PERFORM sa_domain.attach_order_criteria(item_,product_,jsonb_array_length(p_line->'branding'->'placements')>0);
 ELSE
  FOR variant_ IN SELECT value FROM jsonb_array_elements(p_line->'variants') LOOP
   SELECT sa_domain.order_size(z.name),sa_domain.unit_tax((variant_->>'unit_price')::numeric+(p_line->'branding'->>'unit_price')::numeric,p_state,s.cgst,s.sgst,s.igst)
   INTO size_,tax_ FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id WHERE s.id=(variant_->>'sku_id')::bigint;
   INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,cgst,sgst,igst,created_at,updated_at)
   VALUES(item_,size_,(variant_->>'quantity')::int,(tax_->>'cgst')::numeric*(variant_->>'quantity')::int,(tax_->>'sgst')::numeric*(variant_->>'quantity')::int,(tax_->>'igst')::numeric*(variant_->>'quantity')::int,now(),now());
  END LOOP;
 END IF;
 FOR branding_ IN SELECT value FROM jsonb_array_elements(p_line->'branding'->'placements') LOOP PERFORM sa_domain.attach_order_design(item_,branding_);END LOOP;
 RETURN item_;
END $f$;

CREATE FUNCTION sa_domain.allocate_order_payment(p_groups jsonb,p_paid numeric,p_total numeric) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 WITH shares AS(SELECT value,ordinality,CASE WHEN p_total=0 THEN 0 ELSE p_paid*100*(value->>'total')::numeric/p_total END share
 FROM jsonb_array_elements(p_groups) WITH ORDINALITY),ranked AS(
 SELECT *,floor(share) cents,row_number() OVER(ORDER BY share-floor(share) DESC,ordinality) priority,
 p_paid*100-sum(floor(share)) OVER() remaining FROM shares)
 SELECT jsonb_agg(value||jsonb_build_object('paid_amount',((cents+CASE WHEN priority<=remaining THEN 1 ELSE 0 END)/100)::text) ORDER BY ordinality) FROM ranked
$f$;
GRANT SELECT(key,value) ON sa_snapshot_20261019.sa_settings TO sa_executor;
CREATE POLICY squad_provider_setting ON sa_snapshot_20261019.sa_settings FOR SELECT TO sa_executor USING(key='use_dashboard');
CREATE FUNCTION sa_domain.v1_order_place(p_quote_id uuid,p_expected_version text,p_details jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,3,10]);cached jsonb;q sa_domain.quotes%ROWTYPE;current_ jsonb;plan_ jsonb;delivery_ jsonb;group_ jsonb;l jsonb;
 settings_ jsonb;payment_ jsonb;status_ text;paid_ numeric;total_ numeric;group_total numeric;group_paid numeric;due_ timestamptz;id_ bigint;item_ bigint;ids_ bigint[]:='{}';orders_ jsonb:='[]';items_ jsonb;
 source_ text;key_ text;value_ jsonb;version_ text;type_ integer;
BEGIN
 PERFORM sa_domain.check_fields(p_details,ARRAY['due_at','comment','line_settings','payment']);
 IF jsonb_typeof(p_details->'due_at') IS DISTINCT FROM 'string' OR length(p_details->>'due_at')>40
 OR (p_details->>'due_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR NOT pg_input_is_valid(p_details->>'due_at','timestamptz')
 OR (p_details?'comment' AND (jsonb_typeof(p_details->'comment')<>'string' OR length(p_details->>'comment')>4000)) THEN RAISE EXCEPTION 'A valid due timestamp with timezone and bounded comment are required' USING ERRCODE='22023';END IF;
 due_:=(p_details->>'due_at')::timestamptz;
 IF due_<'2000-01-01'::timestamptz OR due_>now()+interval '10 years' THEN RAISE EXCEPTION 'Due date is outside the supported range' USING ERRCODE='22023';END IF;
 settings_:=coalesce(p_details->'line_settings','{}');payment_:=coalesce(p_details->'payment','{}');
 IF jsonb_typeof(settings_)<>'object' THEN RAISE EXCEPTION 'Line settings must be an object keyed by quote line' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.check_fields(payment_,ARRAY['status','paid_amount']);status_:=coalesce(payment_->>'status','unpaid');
 IF status_ NOT IN('paid','unpaid','partial') THEN RAISE EXCEPTION 'Invalid payment status' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('orders.placed',p_idempotency_key,jsonb_build_object('quote_id',p_quote_id,'version',p_expected_version,'details',p_details));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO q FROM sa_domain.quotes WHERE id=p_quote_id FOR UPDATE;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found or unavailable' USING ERRCODE='P0002';END IF;
 IF q.accepted_order_ids IS NOT NULL THEN RAISE EXCEPTION 'This quote has already been accepted' USING ERRCODE='40001';END IF;
 IF q.expires_at<=clock_timestamp() OR q.generation<>(SELECT generation FROM sa_domain.runtime_state) OR (q.generation||':'||q.revision) IS DISTINCT FROM p_expected_version THEN
 RAISE EXCEPTION 'Quote changed or expired; request a new quote' USING ERRCODE='40001';END IF;
 -- Serialize commercial relationship and artwork changes against acceptance.
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||q.customer_id,784139));
 FOR id_ IN SELECT DISTINCT (value #>> '{}')::bigint FROM jsonb_path_query(q.request,'$.lines[*].brandings[*].design_id') AS selected_design(value) ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('branding:'||id_,784139));
 END LOOP;
 current_:=sa_domain.calculate_quote(q.request,false);
 IF current_<>q.base_result THEN RAISE EXCEPTION 'Pricing inputs changed; request a new quote' USING ERRCODE='40001';END IF;
 IF sa_domain.override_quote_prices(current_,q.overrides)<>q.result THEN RAISE EXCEPTION 'Quote no longer matches its pricing inputs' USING ERRCODE='40001';END IF;
 FOR key_,value_ IN SELECT * FROM jsonb_each(settings_) LOOP
  IF key_ !~ '^[1-9][0-9]?$' OR key_::int>jsonb_array_length(q.result->'lines') THEN RAISE EXCEPTION 'Unknown quote line settings' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.check_fields(value_,ARRAY['product_id','comment','size_type_id']);
 END LOOP;
 total_:=(q.result->>'total')::numeric;
 IF total_<0 OR total_>1000000000000 THEN RAISE EXCEPTION 'Order amount exceeds supported bounds' USING ERRCODE='22023';END IF;
 paid_:=CASE status_ WHEN 'paid' THEN total_ WHEN 'unpaid' THEN 0 ELSE sa_domain.input_number(payment_->'paid_amount',0,total_) END;
 IF (status_='partial' AND (paid_<=0 OR paid_>=total_)) OR paid_<>round(paid_,2)
 OR (status_<>'partial' AND payment_?'paid_amount' AND sa_domain.input_number(payment_->'paid_amount',0,total_)<>paid_) THEN
 RAISE EXCEPTION 'Payment amount does not match payment status' USING ERRCODE='22023';END IF;
 IF a.role_id<>1 AND (status_<>'unpaid' OR paid_<>0) THEN RAISE EXCEPTION 'Only a Sales Coordinator can record payment' USING ERRCODE='42501';END IF;
 plan_:=sa_domain.order_plan(q.result);delivery_:=sa_domain.delivery_context(q.customer_id,(q.result->>'address_id')::bigint);
 plan_:=jsonb_set(plan_,'{groups}',sa_domain.allocate_order_payment(plan_->'groups',paid_,total_));
 SELECT CASE WHEN coalesce(bool_or(value='true'),false) THEN 'dashboard' ELSE 'unicommerce' END INTO source_ FROM sa_snapshot_20261019.sa_settings WHERE key='use_dashboard';
 FOR group_ IN SELECT value FROM jsonb_array_elements(plan_->'groups') LOOP
  group_total:=(group_->>'total')::numeric;group_paid:=(group_->>'paid_amount')::numeric;
  SELECT CASE WHEN bool_and(x->>'kind'='rmp') THEN 0 WHEN bool_and(x->>'kind'='custom') THEN 1 ELSE 2 END INTO type_ FROM jsonb_array_elements(group_->'lines') x;
  INSERT INTO sa_snapshot_20261019.sa_orders(status,comment,created_on,due_on,due_time,customer_id,address_id,customer_sc_id,customer_dealer_id,created_by_id,order_item_type,
   total_amount,branding_amount,sub_total_amount,cgst_amount,sgst_amount,igst_amount,total_quantity,payment_status,paid_amount,order_source,created_at,updated_at)
  VALUES(0,coalesce(p_details->>'comment',''),now(),due_ AT TIME ZONE 'UTC',due_ AT TIME ZONE 'UTC',q.customer_id,(q.result->>'address_id')::bigint,
   (plan_->'context'->>'coordinator_id')::bigint,(group_->>'dealer_id')::bigint,a.user_id,type_,group_total,(group_->>'branding_total')::numeric,(group_->>'subtotal')::numeric,
   (group_->>'cgst')::numeric,(group_->>'sgst')::numeric,(group_->>'igst')::numeric,(group_->>'quantity')::int,
   CASE WHEN group_paid=group_total THEN 0 WHEN group_paid=0 THEN 1 ELSE 2 END,group_paid,source_,now(),now()) RETURNING id INTO id_;
  items_:='[]';
  FOR l IN SELECT value FROM jsonb_array_elements(group_->'lines') LOOP
   item_:=sa_domain.create_order_line(id_,l,coalesce(settings_->(l->>'line'),'{}'),delivery_->>'state');
   items_:=items_||jsonb_build_array(jsonb_build_object('line',l->'line','item_id',item_::text));
  END LOOP;
  INSERT INTO sa_domain.order_receipts(order_id,quote_id,actor_id,generation,pricing,delivery,rounding_adjustment)
  VALUES(id_,q.id,a.auth_id,q.generation,group_,delivery_,(group_->>'rounding_adjustment')::numeric);
  version_:=sa_domain.bump_version('order',id_,sa_domain.version('order',id_));ids_:=array_append(ids_,id_);
  orders_:=orders_||jsonb_build_array(jsonb_build_object('id',id_::text,'version',version_,'items',items_,'total_amount',group_total::text,
   'paid_amount',group_paid::text,'rounding_adjustment',group_->>'rounding_adjustment','integration_status','queued'));
 END LOOP;
 UPDATE sa_domain.quotes SET accepted_order_ids=ids_ WHERE id=q.id;
 RETURN sa_domain.finish_command('orders.placed',p_idempotency_key,'order_batch',ids_[1],jsonb_build_object('orders',orders_,'quote_id',q.id,'total_amount',total_::text,'paid_amount',paid_::text),
 jsonb_build_object('order_ids',to_jsonb(ARRAY(SELECT x::text FROM unnest(ids_) x)),'customer_id',q.customer_id::text,'provider',source_));
END $f$;

CREATE OR REPLACE FUNCTION sa_domain.branding_price(p_brandings jsonb,p_quantity integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE b jsonb;w numeric;h numeric;price_ numeric:=0;rate numeric;total_ numeric:=0;items_ jsonb:='[]';m sa_snapshot_20261019.sa_profit_margins%ROWTYPE;
BEGIN
 IF p_brandings IS NULL OR jsonb_typeof(p_brandings)<>'array' OR jsonb_array_length(p_brandings)>20 THEN RAISE EXCEPTION 'At most 20 branding placements allowed' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM sa_snapshot_20261019.sa_profit_margins WHERE is_deleted IS NOT TRUE AND p_quantity BETWEEN min_range AND max_range ORDER BY id LIMIT 1;
 FOR b IN SELECT value FROM jsonb_array_elements(p_brandings) LOOP
  PERFORM sa_domain.check_fields(b,ARRAY['type','side','width','height','unit','design_id','design_version']);
  IF b->>'type' IS NULL OR b->>'type' NOT IN('print','embroidery') OR b->>'unit' IS DISTINCT FROM 'inch' OR nullif(btrim(b->>'side'),'') IS NULL OR length(b->>'side')>80 THEN
   RAISE EXCEPTION 'Invalid branding type, side or unit' USING ERRCODE='22023';END IF;
  w:=sa_domain.input_number(b->'width',0.01,1000);h:=sa_domain.input_number(b->'height',0.01,1000);
  rate:=coalesce(CASE WHEN b->>'type'='print' THEN m.branding_print ELSE m.branding_embroidery END,0);
  IF rate<0 THEN RAISE EXCEPTION 'Invalid branding rate' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.design_for_order(b,false);
  price_:=w*h*rate;total_:=total_+price_;items_:=items_||jsonb_build_array(b||jsonb_build_object('unit_price',price_::text));
 END LOOP;
 RETURN jsonb_build_object('unit_price',total_::text,'placements',items_);
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
  PERFORM sa_domain.check_fields(part_,ARRAY['part_id','color_id','color_link_id','addons']);part_id_:=sa_domain.input_id(part_->'part_id');part_color_:=sa_domain.input_id(part_->'color_id');
  IF part_id_=ANY(seen_) THEN RAISE EXCEPTION 'Duplicate part' USING ERRCODE='22023';END IF;seen_:=array_append(seen_,part_id_);
  SELECT pc.id INTO part_join_ FROM sa_snapshot_20261019.sa_part_colors pc JOIN sa_snapshot_20261019.sa_colors c ON c.id=pc.color_id AND c.is_deleted IS NOT TRUE
   JOIN sa_snapshot_20261019.sa_parts p ON p.id=pc.part_id AND p.is_deleted IS NOT TRUE
   JOIN sa_snapshot_20261019.sa_base_product_parts bp ON bp.part_id=p.id AND bp.base_product_id=base_ AND bp.is_deleted IS NOT TRUE
   WHERE pc.part_id=part_id_ AND pc.color_id=part_color_ AND pc.is_deleted IS NOT TRUE ORDER BY pc.id LIMIT 1;
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
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_branding_save','v1_order_place']) LOOP
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
 AND p.proname=ANY(ARRAY['order_size','attach_order_criteria','order_plan','design_for_order','attach_order_design','create_order_line','allocate_order_payment']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
