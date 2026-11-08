BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- The current source rows stay in the existing schema. Amendment history and
-- accepted line quotes are new operational records, not a second live ledger.
CREATE TABLE sa_domain.order_amendments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id bigint NOT NULL,generation bigint NOT NULL,
 actor_id uuid NOT NULL,command_key uuid NOT NULL,reason text NOT NULL,previous_version text NOT NULL,
 source_rows jsonb NOT NULL,accepted_quote jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,command_key));
CREATE INDEX squad_amendments_order ON sa_domain.order_amendments(order_id,generation,created_at DESC,id);
CREATE TABLE sa_domain.line_receipts(
 item_id bigint NOT NULL,generation bigint NOT NULL,order_id bigint NOT NULL,pricing jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(item_id,generation));
ALTER TABLE sa_domain.order_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.order_amendments FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.line_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.line_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.order_amendments,sa_domain.line_receipts TO sa_executor;
CREATE POLICY squad_amendments_read ON sa_domain.order_amendments FOR SELECT TO sa_executor USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders) AND(SELECT (sa_domain.actor()).role_id) IN(0,1));
CREATE POLICY squad_amendments_insert ON sa_domain.order_amendments FOR INSERT TO sa_executor WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id) AND(SELECT (sa_domain.actor()).role_id)=1 AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
CREATE POLICY squad_line_receipts_read ON sa_domain.line_receipts FOR SELECT TO sa_executor USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));
CREATE POLICY squad_line_receipts_insert ON sa_domain.line_receipts FOR INSERT TO sa_executor WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=sa_domain.line_receipts.order_id));

CREATE TABLE sa_domain.archived_designs(branding_id bigint NOT NULL,generation bigint NOT NULL,order_id bigint NOT NULL,amendment_id uuid NOT NULL REFERENCES sa_domain.order_amendments(id),PRIMARY KEY(branding_id,generation));
ALTER TABLE sa_domain.archived_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.archived_designs FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.archived_designs TO sa_executor;
CREATE POLICY squad_archived_designs_read ON sa_domain.archived_designs FOR SELECT TO sa_executor USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
CREATE POLICY squad_archived_designs_insert ON sa_domain.archived_designs FOR INSERT TO sa_executor WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND(SELECT (sa_domain.actor()).role_id)=1 AND amendment_id IN(SELECT id FROM sa_domain.order_amendments WHERE order_id=sa_domain.archived_designs.order_id));
CREATE POLICY squad_archived_art_read ON sa_snapshot_20261019.sa_brandings FOR SELECT TO sa_executor USING(id IN(SELECT branding_id FROM sa_domain.archived_designs));
GRANT UPDATE(item_id) ON sa_snapshot_20261019.sa_brandings TO sa_executor;
CREATE POLICY squad_archive_art ON sa_snapshot_20261019.sa_brandings FOR UPDATE TO sa_executor USING((SELECT (sa_domain.actor()).role_id)=1 AND id IN(SELECT branding_id FROM sa_domain.archived_designs)) WITH CHECK(item_id IS NULL AND(SELECT (sa_domain.actor()).role_id)=1 AND id IN(SELECT branding_id FROM sa_domain.archived_designs));

CREATE FUNCTION sa_domain.validated_order_quote(p_quote_id uuid,p_expected_version text) RETURNS sa_domain.quotes
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE q sa_domain.quotes%ROWTYPE;current_ jsonb;id_ bigint;
BEGIN
 SELECT * INTO q FROM sa_domain.quotes WHERE id=p_quote_id FOR UPDATE;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found or unavailable' USING ERRCODE='P0002';END IF;
 IF q.accepted_order_ids IS NOT NULL THEN RAISE EXCEPTION 'This quote has already been accepted' USING ERRCODE='40001';END IF;
 IF q.expires_at<=clock_timestamp() OR q.generation<>(SELECT generation FROM sa_domain.runtime_state) OR(q.generation||':'||q.revision) IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'Quote changed or expired; request a new quote' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||q.customer_id,784139));
 FOR id_ IN SELECT DISTINCT(value#>>'{}')::bigint FROM jsonb_path_query(q.request,'$.lines[*].brandings[*].design_id') selected_design(value) ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('branding:'||id_,784139));
 END LOOP;
 current_:=sa_domain.calculate_quote(q.request,false);
 IF current_<>q.base_result OR sa_domain.override_quote_prices(current_,q.overrides)<>q.result THEN RAISE EXCEPTION 'Pricing inputs changed; request a new quote' USING ERRCODE='40001';END IF;
 RETURN q;
END $f$;
CREATE FUNCTION sa_domain.validate_order_line_settings(p_lines jsonb,p_settings jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE l jsonb;settings_ jsonb;product_ bigint;config_ jsonb;
BEGIN
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  settings_:=coalesce(p_settings->(l->>'line'),'{}');PERFORM sa_domain.check_fields(settings_,ARRAY['product_id','comment','size_type_id']);
  IF settings_?'comment' AND(jsonb_typeof(settings_->'comment')<>'string' OR length(settings_->>'comment')>4000) THEN RAISE EXCEPTION 'Invalid item comment' USING ERRCODE='22023';END IF;
  IF l->>'kind'='custom' THEN
   product_:=sa_domain.input_id(settings_->'product_id');config_:=sa_domain.product_configuration(product_);
   IF config_ IS NULL OR config_<>l->'configuration' THEN RAISE EXCEPTION 'Preset is unavailable or does not match the quote' USING ERRCODE='22023';END IF;
   IF settings_?'size_type_id' AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_size_types st WHERE st.id=sa_domain.input_id(settings_->'size_type_id') AND st.is_deleted IS NOT TRUE AND(EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_size_types b WHERE b.base_product_id=(config_->>'base_product_id')::bigint AND b.size_type_id=st.id AND b.is_deleted IS NOT TRUE) OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=(config_->>'base_product_id')::bigint AND b.size_type_id=st.id))) THEN RAISE EXCEPTION 'Size type is incompatible with the base product' USING ERRCODE='22023';END IF;
  ELSIF settings_?'product_id' OR settings_?'size_type_id' THEN RAISE EXCEPTION 'Ready-made lines cannot select a custom preset or size type' USING ERRCODE='22023';END IF;
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.order_details(p_details jsonb,p_pricing jsonb,p_previous_paid numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,3,10]);settings_ jsonb;payment_ jsonb;status_ text;paid_ numeric;total_ numeric:=(p_pricing->>'total')::numeric;due_ timestamptz;key_ text;value_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_details,ARRAY['due_at','comment','line_settings','payment']);
 IF jsonb_typeof(p_details->'due_at') IS DISTINCT FROM 'string' OR length(p_details->>'due_at')>40
 OR(p_details->>'due_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR NOT pg_input_is_valid(p_details->>'due_at','timestamptz')
 OR(p_details?'comment' AND(jsonb_typeof(p_details->'comment')<>'string' OR length(p_details->>'comment')>4000)) THEN RAISE EXCEPTION 'A valid due timestamp with timezone and bounded comment are required' USING ERRCODE='22023';END IF;
 due_:=(p_details->>'due_at')::timestamptz;
 IF due_<'2000-01-01'::timestamptz OR due_>now()+interval '10 years' THEN RAISE EXCEPTION 'Due date is outside the supported range' USING ERRCODE='22023';END IF;
 settings_:=coalesce(p_details->'line_settings','{}');payment_:=coalesce(p_details->'payment','{}');
 IF jsonb_typeof(settings_)<>'object' THEN RAISE EXCEPTION 'Line settings must be an object keyed by quote line' USING ERRCODE='22023';END IF;
 FOR key_,value_ IN SELECT * FROM jsonb_each(settings_) LOOP
  IF key_ !~ '^[1-9][0-9]?$' OR key_::int>jsonb_array_length(p_pricing->'lines') THEN RAISE EXCEPTION 'Unknown quote line settings' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.check_fields(value_,ARRAY['product_id','comment','size_type_id']);
 END LOOP;
 PERFORM sa_domain.validate_order_line_settings(p_pricing->'lines',settings_);
 IF total_<0 OR total_>1000000000000 OR total_::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Order amount exceeds supported bounds' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.check_fields(payment_,ARRAY['status','paid_amount']);
 IF NOT p_details?'payment' AND p_previous_paid IS NOT NULL THEN
  IF p_previous_paid<0 OR p_previous_paid>total_ OR p_previous_paid::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Existing payment requires explicit reconciliation with the new total' USING ERRCODE='22023';END IF;
  paid_:=p_previous_paid;status_:=CASE WHEN paid_=0 THEN 'unpaid' WHEN paid_=total_ THEN 'paid' ELSE 'partial' END;
 ELSE
  status_:=coalesce(payment_->>'status','unpaid');
  IF status_ NOT IN('paid','unpaid','partial') THEN RAISE EXCEPTION 'Invalid payment status' USING ERRCODE='22023';END IF;
  paid_:=CASE status_ WHEN 'paid' THEN total_ WHEN 'unpaid' THEN 0 ELSE sa_domain.input_number(payment_->'paid_amount',0,total_) END;
  IF(status_='partial' AND(paid_<=0 OR paid_>=total_)) OR paid_<>round(paid_,2)
  OR(status_<>'partial' AND payment_?'paid_amount' AND sa_domain.input_number(payment_->'paid_amount',0,total_)<>paid_) THEN RAISE EXCEPTION 'Payment amount does not match payment status' USING ERRCODE='22023';END IF;
 END IF;
 IF a.role_id<>1 AND(status_<>'unpaid' OR paid_<>0) THEN RAISE EXCEPTION 'Only a Sales Coordinator can record payment' USING ERRCODE='42501';END IF;
 RETURN p_details||jsonb_build_object('due_at',due_,'line_settings',settings_,'payment',jsonb_build_object('status',status_,'paid_amount',paid_::text));
END $f$;

-- Shared acceptance validation is used by placement and amendment.
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
END $function$;

CREATE OR REPLACE FUNCTION sa_domain.create_order_line(p_order_id bigint, p_line jsonb, p_settings jsonb, p_state text)
 RETURNS bigint
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
 INSERT INTO sa_domain.line_receipts(item_id,generation,order_id,pricing) SELECT item_,generation,p_order_id,p_line FROM sa_domain.runtime_state;
 RETURN item_;
END $function$;

-- Check dependency tables under the private lookup role, including records that
-- are not independently visible in the caller's ordinary work queues.
GRANT SELECT ON sa_snapshot_20261019.sa_stocks,sa_snapshot_20261019.sa_back_order_links,sa_snapshot_20261019.sa_brandings,
 sa_snapshot_20261019.sa_item_tailors,sa_snapshot_20261019.sa_job_sheet_assign_quantities,sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates TO sa_guard;
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['stocks','back_order_links','brandings','item_tailors','job_sheet_assign_quantities','job_sheet_tailor_mark_dates'] LOOP
  EXECUTE format('CREATE POLICY squad_amendment_guard ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.assert_order_amendable(p_id bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);ids_ bigint[];
BEGIN
 IF NOT EXISTS(SELECT FROM sa_domain.scope_order_ids() s(id) WHERE id=p_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002';END IF;
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
END $f$;
ALTER FUNCTION sa_domain.assert_order_amendable(bigint) OWNER TO sa_guard;
GRANT SELECT(back_order_for_id,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_extra_quantities,sa_snapshot_20261019.sa_item_criteria TO sa_guard;
CREATE POLICY squad_amendment_extras_guard ON sa_snapshot_20261019.sa_extra_quantities FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_amendment_criteria_guard ON sa_snapshot_20261019.sa_item_criteria FOR SELECT TO sa_guard USING(true);

-- An SC may replace lines in their scoped order without rewriting its creator.
ALTER POLICY squad_order_media_copy ON sa_media.references WITH CHECK(resource='brandings' AND record_id IN(SELECT b.id FROM sa_snapshot_20261019.sa_brandings b JOIN sa_snapshot_20261019.sa_items i ON i.id=b.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id) OR((SELECT (sa_domain.actor()).role_id)=1 AND o.customer_sc_id=(SELECT (sa_domain.actor()).user_id))));
ALTER POLICY squad_items_insert ON sa_snapshot_20261019.sa_items WITH CHECK(order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE created_by_id=(SELECT (sa_domain.actor()).user_id) OR((SELECT (sa_domain.actor()).role_id)=1 AND customer_sc_id=(SELECT (sa_domain.actor()).user_id))));
DO $f$ DECLARE t text;policy_ text;BEGIN
 FOR t,policy_ IN SELECT * FROM(VALUES('quantities','squad_quantities_insert'),('extra_quantities','squad_extras_insert'),('brandings','squad_brandings_insert'),('item_criteria','squad_criteria_insert')) x LOOP
  EXECUTE format('ALTER POLICY %I ON sa_snapshot_20261019.sa_%I WITH CHECK(item_id IN(SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.created_by_id=(SELECT (sa_domain.actor()).user_id) OR((SELECT (sa_domain.actor()).role_id)=1 AND o.customer_sc_id=(SELECT (sa_domain.actor()).user_id))))',policy_,t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['quantities','extra_quantities','item_criteria'] LOOP
  EXECUTE format('GRANT DELETE ON sa_snapshot_20261019.sa_%I TO sa_executor',t);
  EXECUTE format('CREATE POLICY squad_amendment_delete ON sa_snapshot_20261019.sa_%I FOR DELETE TO sa_executor USING((SELECT (sa_domain.actor()).role_id)=1 AND item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items))',t);
 END LOOP;
END $f$;
GRANT DELETE ON sa_snapshot_20261019.sa_items TO sa_executor;
CREATE POLICY squad_amendment_delete ON sa_snapshot_20261019.sa_items FOR DELETE TO sa_executor USING((SELECT (sa_domain.actor()).role_id)=1 AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
GRANT UPDATE(address_id,order_item_type,total_amount,sub_total_amount,branding_amount,cgst_amount,sgst_amount,igst_amount,total_quantity,is_updated) ON sa_snapshot_20261019.sa_orders TO sa_executor;
GRANT UPDATE(quote_id,actor_id,pricing,delivery,rounding_adjustment,created_at) ON sa_domain.order_receipts TO sa_executor;
CREATE POLICY squad_receipts_update ON sa_domain.order_receipts FOR UPDATE TO sa_executor USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND(SELECT (sa_domain.actor()).role_id)=1 AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders)) WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id) AND(SELECT (sa_domain.actor()).role_id)=1 AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders));
ALTER POLICY squad_receipts_insert ON sa_domain.order_receipts WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT (sa_domain.actor()).auth_id) AND order_id IN(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE created_by_id=(SELECT (sa_domain.actor()).user_id) OR((SELECT (sa_domain.actor()).role_id)=1 AND customer_sc_id=(SELECT (sa_domain.actor()).user_id))));

CREATE FUNCTION sa_domain.apply_order_amendment(p_id bigint,p_spec jsonb,p_command_key uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);o sa_snapshot_20261019.sa_orders%ROWTYPE;ids_ bigint[];before_ jsonb;group_ jsonb:=p_spec->'group';details_ jsonb:=p_spec->'details';l jsonb;item_ bigint;items_ jsonb:='[]';amendment_ uuid;type_ int;paid_ numeric:=(details_->'payment'->>'paid_amount')::numeric;generation_ bigint;
BEGIN
 o:=sa_domain.lock_order(p_id,false);PERFORM sa_domain.assert_order_amendable(p_id);
 IF sa_domain.version('order',p_id) IS DISTINCT FROM p_spec->>'version' THEN RAISE EXCEPTION 'Order changed before amendment publication' USING ERRCODE='40001';END IF;
 SELECT generation INTO generation_ FROM sa_domain.runtime_state;
 IF generation_ IS DISTINCT FROM(p_spec->>'generation')::bigint THEN RAISE EXCEPTION 'Source was refreshed; amendment is obsolete' USING ERRCODE='40001';END IF;
 SELECT array_agg(id ORDER BY id) INTO ids_ FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id;
 SELECT jsonb_build_object('order',to_jsonb(o),'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_items i WHERE id=ANY(ids_)),
 'quantities',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_quantities q WHERE item_id=ANY(ids_)),
 'extra_quantities',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_extra_quantities q WHERE item_id=ANY(ids_)),
 'brandings',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_brandings b WHERE item_id=ANY(ids_)),
 'criteria',(SELECT coalesce(jsonb_agg(to_jsonb(cr) ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_item_criteria cr WHERE item_id=ANY(ids_)),
 'receipt',(SELECT to_jsonb(r) FROM sa_domain.order_receipts r WHERE order_id=p_id AND generation=generation_)) INTO before_;
 IF octet_length(before_::text)>1048576 THEN RAISE EXCEPTION 'Order history exceeds interactive amendment budget' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.order_amendments(order_id,generation,actor_id,command_key,reason,previous_version,source_rows,accepted_quote)
 VALUES(p_id,generation_,a.auth_id,p_command_key,p_spec->>'reason',p_spec->>'previous_version',before_,p_spec) RETURNING id INTO amendment_;
 SELECT CASE WHEN bool_and(x->>'kind'='rmp') THEN 0 WHEN bool_and(x->>'kind'='custom') THEN 1 ELSE 2 END INTO type_ FROM jsonb_array_elements(group_->'lines') x;
 UPDATE sa_snapshot_20261019.sa_orders SET address_id=(p_spec->'delivery'->>'address_id')::bigint,order_item_type=type_,comment=coalesce(details_->>'comment',o.comment),due_on=(details_->>'due_at')::timestamptz AT TIME ZONE 'UTC',due_time=(details_->>'due_at')::timestamptz AT TIME ZONE 'UTC',
 total_amount=(group_->>'total')::numeric,sub_total_amount=(group_->>'subtotal')::numeric,branding_amount=(group_->>'branding_total')::numeric,cgst_amount=(group_->>'cgst')::numeric,sgst_amount=(group_->>'sgst')::numeric,igst_amount=(group_->>'igst')::numeric,total_quantity=(group_->>'quantity')::int,
 paid_amount=paid_,payment_status=CASE WHEN paid_=(group_->>'total')::numeric THEN 0 WHEN paid_=0 THEN 1 ELSE 2 END,is_updated=true,criteria_status=0,cutting_status=0,updated_at=now() WHERE id=p_id;
 FOR l IN SELECT value FROM jsonb_array_elements(group_->'lines') LOOP
  item_:=sa_domain.create_order_line(p_id,l,coalesce(details_->'line_settings'->(l->>'line'),'{}'),p_spec->'delivery'->>'state');
  items_:=items_||jsonb_build_array(jsonb_build_object('line',l->'line','item_id',item_::text));
 END LOOP;
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
END $f$;

CREATE FUNCTION sa_domain.v1_order_edit(p_id bigint,p_quote_id uuid,p_quote_version text,p_details jsonb,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
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
 IF provider_ THEN
  INSERT INTO sa_domain.order_requests(order_id,kind,actor_id,generation,command_key,spec) VALUES(p_id,'edit',a.auth_id,q.generation,p_idempotency_key,spec_) RETURNING id INTO request_;
  result_:=jsonb_build_object('id',p_id::text,'version',v,'state','queued','request_id',request_,'proposed_total_amount',group_->>'total','provider_confirmation_required',true);
 ELSE result_:=sa_domain.apply_order_amendment(p_id,spec_,p_idempotency_key);END IF;
 UPDATE sa_domain.quotes SET accepted_order_ids=ARRAY[p_id] WHERE id=q.id;
 RETURN sa_domain.finish_command('order.edited',p_idempotency_key,'order',p_id,result_,jsonb_build_object('reason',reason_,'request_id',request_,'old_total',o.total_amount::text,'new_total',group_->>'total','provider_confirmation_required',provider_));
END $f$;

DO $f$ DECLARE p record;call_ text;BEGIN
 FOR p IN SELECT pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY['validate_order_line_settings','validated_order_quote','order_details','assert_order_amendable','apply_order_amendment','v1_order_edit']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor',p.proname,p.args);
  IF p.proname='v1_order_edit' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s),' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_branding_save(p_id bigint, p_product_id bigint, p_spec jsonb, p_expected_version text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
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
  IF old_.id IS NULL OR EXISTS(SELECT FROM sa_domain.archived_designs WHERE branding_id=old_.id) OR old_.item_id IS NOT NULL OR old_.product_id IS DISTINCT FROM p_product_id OR NOT(
   EXISTS(SELECT FROM sa_domain.design_owners WHERE branding_id=id_ AND generation=(SELECT generation FROM sa_domain.runtime_state))
   OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_products WHERE id=old_.product_id AND created_by_id=a.user_id)) THEN
   RAISE EXCEPTION 'Design not found or not editable' USING ERRCODE='P0002';END IF;
  v:=sa_domain.bump_version('branding',id_,p_expected_version);
  UPDATE sa_snapshot_20261019.sa_brandings SET comment=coalesce(p_spec->>'comment',''),print_side=p_spec->>'side',print_area=p_spec->>'print_area',
   branding_type=CASE p_spec->>'type' WHEN 'print' THEN 0 ELSE 1 END,graphic_dimension=(p_spec->>'width')||'x'||(p_spec->>'height'),
   graphic_width=(p_spec->>'width')::numeric,graphic_height=(p_spec->>'height')::numeric,graphic_unit='inch',updated_at=now() WHERE id=id_;
 END IF;
 RETURN sa_domain.finish_command('design.saved',p_idempotency_key,'branding',id_,jsonb_build_object('id',id_::text,'version',v,'product_id',p_product_id::text),jsonb_build_object('product_id',p_product_id::text));
END $function$;

REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
