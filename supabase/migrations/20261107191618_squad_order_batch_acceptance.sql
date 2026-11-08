BEGIN;
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
 RETURN jsonb_build_object('id',nextval('sa_snapshot_20261019.sa_items_id_seq'), 'order_id',p_order_id,'item_type',type_,'product_id',product_,
 'rmp_class_id',p_line->'variants'->0->>'class_id','rmp_brand_id',p_line->'variants'->0->>'brand_id','rmp_category_id',p_line->'variants'->0->>'category_id',
 'comment',coalesce(p_settings->>'comment',''),'sample_order',coalesce((p_line->'quantities'->>'sample_order')::boolean,false),'total_amount',p_line->>'subtotal','total_quantity',quantity_,'sample_total_amount',sample_amount,
 'weight_per_piece',weight_,'total_weight',round(weight_*quantity_,2),'per_piece_amount',unit_,'calculated_per_piece_amount',calculated_,
 'rmp_override_price',CASE WHEN type_=1 AND p_line?'override' THEN (p_line->'override'->>'unit_price')::numeric ELSE 0 END,
 'branding_amount',p_line->>'branding_total','cgst_amount',p_line->>'cgst','sgst_amount',p_line->>'sgst','igst_amount',p_line->>'igst','add_on_cost',addons_,'size_type',coalesce(size_type_,''),'created_at',now(),'updated_at',now());
END $function$;
REVOKE ALL ON FUNCTION sa_domain.prepare_order_line(bigint,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.prepare_order_line(bigint,jsonb,jsonb,text) TO sa_executor;

CREATE FUNCTION sa_domain.create_order_lines(p_order_id bigint,p_lines jsonb,p_settings jsonb,p_state text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE prepared_ jsonb:='[]';quantities_ jsonb:='[]';extras_ jsonb:='[]';l jsonb;r jsonb;q jsonb;v jsonb;b jsonb;sample_ jsonb;
 item_ bigint;size_ bigint;tax_ jsonb;names_ jsonb;name_ text;criterion_ bigint;result_ jsonb;
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Expected one to fifty order lines' USING ERRCODE='22023';END IF;
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
END $f$;
REVOKE ALL ON FUNCTION sa_domain.create_order_lines(bigint,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.create_order_lines(bigint,jsonb,jsonb,text) TO sa_executor;

GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
GRANT SELECT ON sa_domain.order_receipts TO sa_guard;
-- Whole-row copies are required for the immutable amendment record. Access to
-- this projection is still restricted to the owning SC and exact order ID.
GRANT SELECT ON sa_snapshot_20261019.sa_orders,sa_snapshot_20261019.sa_items,sa_snapshot_20261019.sa_quantities TO sa_guard;
CREATE POLICY squad_receipt_history_guard ON sa_domain.order_receipts FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.amendment_source_rows(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);result_ jsonb;ids_ bigint[];
BEGIN
 IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002';END IF;
 SELECT array_agg(id ORDER BY id) INTO ids_ FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id;
 SELECT jsonb_build_object('order',to_jsonb(o),'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_items i WHERE id=ANY(ids_)),
 'quantities',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_quantities q WHERE item_id=ANY(ids_)),
 'extra_quantities',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_extra_quantities q WHERE item_id=ANY(ids_)),
 'brandings',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_brandings b WHERE item_id=ANY(ids_)),
 'criteria',(SELECT coalesce(jsonb_agg(to_jsonb(cr) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_item_criteria cr WHERE item_id=ANY(ids_)),
 'receipt',(SELECT to_jsonb(r) FROM sa_domain.order_receipts r WHERE order_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state))) INTO result_
 FROM sa_snapshot_20261019.sa_orders o WHERE id=p_id;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.amendment_source_rows(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.amendment_source_rows(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.amendment_source_rows(bigint) TO sa_executor;
CREATE FUNCTION sa_domain.receipt_item_parent(p_item bigint,p_order bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE id=p_item AND order_id=p_order)
$f$;
ALTER FUNCTION sa_domain.receipt_item_parent(bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.receipt_item_parent(bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.receipt_item_parent(bigint,bigint) TO sa_executor;
ALTER POLICY squad_line_receipts_insert ON sa_domain.line_receipts WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND sa_domain.can_write_order_lines(order_id) AND sa_domain.receipt_item_parent(item_id,order_id));
CREATE OR REPLACE FUNCTION sa_domain.v1_order_place(p_quote_id uuid, p_expected_version text, p_details jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,3,10]);cached jsonb;q sa_domain.quotes%ROWTYPE;current_ jsonb;plan_ jsonb;delivery_ jsonb;group_ jsonb;l jsonb;
 settings_ jsonb;payment_ jsonb;status_ text;paid_ numeric;total_ numeric;group_total numeric;group_paid numeric;due_ timestamptz;id_ bigint;item_ bigint;ids_ bigint[]:='{}';orders_ jsonb:='[]';items_ jsonb;
 source_ text;key_ text;value_ jsonb;version_ text;type_ integer;normalized_ jsonb;
BEGIN
 cached:=sa_domain.begin_command('orders.placed',p_idempotency_key,jsonb_build_object('quote_id',p_quote_id,'version',p_expected_version,'details',p_details));IF cached IS NOT NULL THEN RETURN cached;END IF;
 q:=sa_domain.validated_order_quote(p_quote_id,p_expected_version);
 normalized_:=sa_domain.order_details(p_details,q.result);
 settings_:=normalized_->'line_settings';payment_:=normalized_->'payment';due_:=(normalized_->>'due_at')::timestamptz;
 status_:=payment_->>'status';paid_:=(payment_->>'paid_amount')::numeric;total_:=(q.result->>'total')::numeric;
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
  items_:=sa_domain.create_order_lines(id_,group_->'lines',settings_,delivery_->>'state');
  INSERT INTO sa_domain.order_receipts(order_id,quote_id,actor_id,generation,pricing,delivery,rounding_adjustment)
  VALUES(id_,q.id,a.auth_id,q.generation,group_,delivery_,(group_->>'rounding_adjustment')::numeric);
  version_:=sa_domain.bump_version('order',id_,sa_domain.version('order',id_));ids_:=array_append(ids_,id_);
  orders_:=orders_||jsonb_build_array(jsonb_build_object('id',id_::text,'version',version_,'items',items_,'total_amount',group_total::text,
   'paid_amount',group_paid::text,'rounding_adjustment',group_->>'rounding_adjustment','integration_status','queued'));
 END LOOP;
 UPDATE sa_domain.quotes SET accepted_order_ids=ids_ WHERE id=q.id;
 RETURN sa_domain.finish_command('orders.placed',p_idempotency_key,'order_batch',ids_[1],jsonb_build_object('orders',orders_,'quote_id',q.id,'total_amount',total_::text,'paid_amount',paid_::text),
 jsonb_build_object('order_ids',to_jsonb(ARRAY(SELECT x::text FROM unnest(ids_) x)),'customer_id',q.customer_id::text,'provider',source_));
END $function$;
CREATE OR REPLACE FUNCTION sa_domain.apply_order_amendment(p_id bigint, p_spec jsonb, p_command_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);o sa_snapshot_20261019.sa_orders%ROWTYPE;ids_ bigint[];before_ jsonb;group_ jsonb:=p_spec->'group';details_ jsonb:=p_spec->'details';l jsonb;item_ bigint;items_ jsonb:='[]';amendment_ uuid;type_ int;paid_ numeric:=(details_->'payment'->>'paid_amount')::numeric;generation_ bigint;
BEGIN
 o:=sa_domain.lock_order(p_id,false);PERFORM sa_domain.assert_order_amendable(p_id);
 IF sa_domain.version('order',p_id) IS DISTINCT FROM p_spec->>'version' THEN RAISE EXCEPTION 'Order changed before amendment publication' USING ERRCODE='40001';END IF;
 SELECT generation INTO generation_ FROM sa_domain.runtime_state;
 IF generation_ IS DISTINCT FROM(p_spec->>'generation')::bigint THEN RAISE EXCEPTION 'Source was refreshed; amendment is obsolete' USING ERRCODE='40001';END IF;
 before_:=sa_domain.amendment_source_rows(p_id);
 SELECT array_agg((value->>'id')::bigint) INTO ids_ FROM jsonb_array_elements(before_->'items');
 IF octet_length(before_::text)>1048576 THEN RAISE EXCEPTION 'Order history exceeds interactive amendment budget' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.order_amendments(order_id,generation,actor_id,command_key,reason,previous_version,source_rows,accepted_quote)
 VALUES(p_id,generation_,a.auth_id,p_command_key,p_spec->>'reason',p_spec->>'previous_version',before_,p_spec) RETURNING id INTO amendment_;
 SELECT CASE WHEN bool_and(x->>'kind'='rmp') THEN 0 WHEN bool_and(x->>'kind'='custom') THEN 1 ELSE 2 END INTO type_ FROM jsonb_array_elements(group_->'lines') x;
 UPDATE sa_snapshot_20261019.sa_orders SET address_id=(p_spec->'delivery'->>'address_id')::bigint,order_item_type=type_,comment=coalesce(details_->>'comment',o.comment),due_on=(details_->>'due_at')::timestamptz AT TIME ZONE 'UTC',due_time=(details_->>'due_at')::timestamptz AT TIME ZONE 'UTC',
 total_amount=(group_->>'total')::numeric,sub_total_amount=(group_->>'subtotal')::numeric,branding_amount=(group_->>'branding_total')::numeric,cgst_amount=(group_->>'cgst')::numeric,sgst_amount=(group_->>'sgst')::numeric,igst_amount=(group_->>'igst')::numeric,total_quantity=(group_->>'quantity')::int,
 paid_amount=paid_,payment_status=CASE WHEN paid_=(group_->>'total')::numeric THEN 0 WHEN paid_=0 THEN 1 ELSE 2 END,is_updated=true,criteria_status=0,cutting_status=0,updated_at=now() WHERE id=p_id;
 items_:=sa_domain.create_order_lines(p_id,group_->'lines',details_->'line_settings',p_spec->'delivery'->>'state');
 -- Keep the original preset/art scope alive until its replacements exist.
 DELETE FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(ids_);
 DELETE FROM sa_snapshot_20261019.sa_extra_quantities WHERE item_id=ANY(ids_);
 DELETE FROM sa_snapshot_20261019.sa_item_criteria WHERE item_id=ANY(ids_);
 INSERT INTO sa_domain.archived_designs(branding_id,generation,order_id,amendment_id)
 SELECT id,generation_,p_id,amendment_ FROM sa_snapshot_20261019.sa_brandings WHERE item_id=ANY(ids_);
 UPDATE sa_snapshot_20261019.sa_brandings SET item_id=NULL WHERE item_id=ANY(ids_);
 DELETE FROM sa_snapshot_20261019.sa_items WHERE id=ANY(ids_);
 INSERT INTO sa_domain.order_receipts(order_id,quote_id,actor_id,generation,pricing,delivery,rounding_adjustment)
 VALUES(p_id,(p_spec->>'quote_id')::uuid,a.auth_id,generation_,group_,p_spec->'delivery',(group_->>'rounding_adjustment')::numeric)
 ON CONFLICT(order_id,generation) DO UPDATE SET quote_id=excluded.quote_id,actor_id=excluded.actor_id,pricing=excluded.pricing,delivery=excluded.delivery,rounding_adjustment=excluded.rounding_adjustment,created_at=now();
 RETURN jsonb_build_object('id',p_id::text,'version',p_spec->>'version','state','applied','amendment_id',amendment_,'items',items_,'total_amount',group_->>'total','paid_amount',paid_::text,'original_identity_and_dates_preserved',true);
END $function$;
CREATE OR REPLACE FUNCTION sa_domain.assert_order_amendable(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);ids_ bigint[];
BEGIN
 IF NOT sa_domain.can_order(p_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002';END IF;
 SELECT array_agg(id) INTO ids_ FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id;
 IF cardinality(ids_)>50 THEN RAISE EXCEPTION 'This order exceeds the interactive amendment limit' USING ERRCODE='54000';END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE id=p_id AND(status<>0 OR uc_status IN('COMPLETE','COMPLETED','CANCELLED') OR assigned_to_id IS NOT NULL OR assigned_worker_id IS NOT NULL OR cutting_done<>0 OR assigned_to_tailor_quantity<>0 OR completed_by_tailor_quantity<>0 OR dispatched_quantity<>0))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE id=ANY(ids_) AND(cutting_done<>0 OR assigned_to_tailor_quantity<>0 OR completed_by_tailor_quantity<>0 OR dispatched_quantity<>0 OR job_worker_status>0 OR uc_order_status IN('COMPLETE','COMPLETED')))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(ids_) AND(cutting_done<>0 OR assigned_to_tailor_quantity<>0 OR completed_by_tailor_quantity<>0 OR dispatched_quantity<>0))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities WHERE item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_assign_dates WHERE item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates WHERE item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_stocks WHERE order_id=p_id OR item_id=ANY(ids_))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_back_order_links WHERE order_id=p_id OR back_order_id=p_id)
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE id=p_id AND back_order_for_id IS NOT NULL)
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_ratings WHERE(rating_on_type='Order' AND rating_on_id=p_id) OR(rating_on_type='Item' AND rating_on_id=ANY(ids_)))
 THEN
 RAISE EXCEPTION 'Assigned work, fulfillment or linked history requires reconciliation; this order cannot be replaced' USING ERRCODE='55000';END IF;
 IF(SELECT count(*) FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(ids_))+(SELECT count(*) FROM sa_snapshot_20261019.sa_extra_quantities WHERE item_id=ANY(ids_))
 +(SELECT count(*) FROM sa_snapshot_20261019.sa_brandings WHERE item_id=ANY(ids_))+(SELECT count(*) FROM sa_snapshot_20261019.sa_item_criteria WHERE item_id=ANY(ids_))>1000 THEN
 RAISE EXCEPTION 'This order requires a bounded amendment job' USING ERRCODE='54000';END IF;
END $function$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
DROP FUNCTION sa_domain.create_order_line(bigint,jsonb,jsonb,text);
DROP FUNCTION sa_domain.attach_order_criteria(bigint,bigint,boolean);
NOTIFY pgrst,'reload schema';
COMMIT;
