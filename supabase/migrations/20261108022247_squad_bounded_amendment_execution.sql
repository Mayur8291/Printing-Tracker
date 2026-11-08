BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
CREATE FUNCTION sa_domain.amendment_runs_inline(p_id bigint,p_lines jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_array_length(p_lines)<=5
 AND(SELECT count(*) FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id)<=5
 AND(SELECT count(*) FROM sa_snapshot_20261019.sa_quantities WHERE item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id))<=50
 AND(SELECT coalesce(sum(CASE WHEN x->>'kind'='custom' THEN jsonb_array_length(x->'quantities'->'quantities') ELSE jsonb_array_length(x->'variants') END),0) FROM jsonb_array_elements(p_lines) x)<=50
 AND(SELECT coalesce(sum(jsonb_array_length(x->'branding'->'placements')),0) FROM jsonb_array_elements(p_lines) x)<=10
$f$;
ALTER FUNCTION sa_domain.amendment_runs_inline(bigint,jsonb) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.amendment_runs_inline(bigint,jsonb) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.amendment_runs_inline(bigint,jsonb) TO sa_executor;
CREATE OR REPLACE FUNCTION sa_domain.v1_order_edit(p_id bigint, p_quote_id uuid, p_quote_version text, p_details jsonb, p_reason text, p_expected_version text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);cached jsonb;o sa_snapshot_20261019.sa_orders%ROWTYPE;q sa_domain.quotes%ROWTYPE;details_ jsonb;plan_ jsonb;group_ jsonb;delivery_ jsonb;reason_ text:=sa_domain.command_reason(p_reason);v text;spec_ jsonb;request_ uuid;result_ jsonb;provider_ boolean;
BEGIN
 cached:=sa_domain.begin_command('order.edited',p_idempotency_key,jsonb_build_object('id',p_id,'quote_id',p_quote_id,'quote_version',p_quote_version,'details',p_details,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(p_id);PERFORM sa_domain.assert_order_amendable(p_id);
 q:=sa_domain.validated_order_quote(p_quote_id,p_quote_version);
 IF q.customer_id<>o.customer_id THEN RAISE EXCEPTION 'An amendment cannot transfer the order to another customer' USING ERRCODE='22023';END IF;
 details_:=sa_domain.order_details(p_details,q.result,o.paid_amount);plan_:=sa_domain.order_plan(q.result);
 IF jsonb_array_length(plan_->'groups')<>1 THEN RAISE EXCEPTION 'This change creates multiple fulfillment orders; use replacement orders after cancellation' USING ERRCODE='22023';END IF;
 group_:=plan_->'groups'->0;
 IF(group_->>'dealer_id')::bigint IS DISTINCT FROM o.customer_dealer_id OR(plan_->'context'->>'coordinator_id')::bigint IS DISTINCT FROM o.customer_sc_id THEN RAISE EXCEPTION 'Order routing changed; reconcile ownership before editing' USING ERRCODE='55000';END IF;
 delivery_:=sa_domain.delivery_context(q.customer_id,(q.result->>'address_id')::bigint);
 v:=sa_domain.bump_version('order',p_id,p_expected_version);
 spec_:=jsonb_build_object('quote_id',q.id,'generation',q.generation,'group',group_,'details',details_,'delivery',delivery_,'reason',reason_,'previous_version',p_expected_version,'version',v);
 provider_:=nullif(o.uc_order_id,'') IS NOT NULL OR nullif(o.dashboard_reservation_id,'') IS NOT NULL
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id AND item_type=1)
 OR EXISTS(SELECT FROM jsonb_array_elements(group_->'lines') x WHERE x->>'kind'='rmp');
 spec_:=spec_||jsonb_build_object('provider_confirmation_required',provider_);
 IF provider_ OR NOT sa_domain.amendment_runs_inline(p_id,group_->'lines') THEN
  INSERT INTO sa_domain.order_requests(order_id,kind,actor_id,generation,command_key,spec) VALUES(p_id,'edit',a.auth_id,q.generation,p_idempotency_key,spec_) RETURNING id INTO request_;
  result_:=jsonb_build_object('id',p_id::text,'version',v,'state','queued','request_id',request_,'proposed_total_amount',group_->>'total','provider_confirmation_required',provider_,'execution','background');
 ELSE result_:=sa_domain.apply_order_amendment(p_id,spec_,p_idempotency_key);END IF;
 UPDATE sa_domain.quotes SET accepted_order_ids=ARRAY[p_id] WHERE id=q.id;
 RETURN sa_domain.finish_command('order.edited',p_idempotency_key,'order',p_id,result_,jsonb_build_object('reason',reason_,'request_id',request_,'old_total',o.total_amount::text,'new_total',group_->>'total','provider_confirmation_required',provider_));
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
  product_:=sa_domain.input_id(p_settings->'product_id');config_:=sa_domain.product_configuration(product_);
  IF config_ IS NULL OR config_<>p_line->'configuration' THEN RAISE EXCEPTION 'Preset is unavailable or does not match the quote' USING ERRCODE='22023';END IF;
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

ALTER TABLE sa_domain.order_requests ADD COLUMN result jsonb;
GRANT UPDATE(state,result,updated_at) ON sa_domain.order_requests TO sa_executor;
CREATE POLICY squad_local_amendment_finish ON sa_domain.order_requests FOR UPDATE TO sa_executor USING(actor_id=(SELECT (sa_domain.actor()).auth_id) AND generation=(SELECT generation FROM sa_domain.runtime_state) AND(SELECT (sa_domain.actor()).role_id)=1)
 WITH CHECK(actor_id=(SELECT (sa_domain.actor()).auth_id) AND generation=(SELECT generation FROM sa_domain.runtime_state) AND(SELECT (sa_domain.actor()).role_id)=1);
CREATE FUNCTION sa_domain.execute_local_amendment(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);r sa_domain.order_requests%ROWTYPE;cached jsonb;result_ jsonb;v text;
BEGIN
 cached:=sa_domain.begin_command('order.amendment_applied',p_request_id,jsonb_build_object('request_id',p_request_id));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO r FROM sa_domain.order_requests WHERE id=p_request_id FOR UPDATE;
 IF r.id IS NULL OR r.actor_id<>a.auth_id OR r.generation<>(SELECT generation FROM sa_domain.runtime_state) THEN RAISE EXCEPTION 'Amendment request not available' USING ERRCODE='P0002';END IF;
 IF r.kind<>'edit' OR r.state NOT IN('queued','running') OR coalesce((r.spec->>'provider_confirmation_required')::boolean,true) THEN RAISE EXCEPTION 'Amendment is not ready for local execution' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('order',r.order_id,r.spec->>'version');
 result_:=sa_domain.apply_order_amendment(r.order_id,r.spec||jsonb_build_object('version',v),r.command_key);
 UPDATE sa_domain.order_requests SET state='succeeded',result=result_,updated_at=now() WHERE id=p_request_id;
 RETURN sa_domain.finish_command('order.amendment_applied',p_request_id,'order',r.order_id,result_,jsonb_build_object('request_id',p_request_id,'reason',r.spec->>'reason'));
END $f$;
REVOKE ALL ON FUNCTION sa_domain.execute_local_amendment(uuid) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.execute_local_amendment(uuid) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
