BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_executor,sa_integrator;
ALTER TABLE sa_domain.warehouse_operations ADD COLUMN saga jsonb NOT NULL DEFAULT '{}';
ALTER TABLE sa_domain.warehouse_operations ADD CONSTRAINT warehouse_saga_bound CHECK(octet_length(saga::text)<=2097152);
GRANT UPDATE(result) ON sa_domain.order_requests TO sa_worker;
GRANT SELECT ON sa_domain.order_requests TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.unit_tax(numeric,text,numeric,numeric,numeric) TO sa_guard;
-- The original durable order event is the job: no second copy or extra endpoint.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);
 d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event IN('order.edited','order.cancellation_requested') AND nullif(p_payload->>'request_id','') IS NOT NULL AND p_payload->>'provider_confirmation_required'='true' THEN 'warehouse' WHEN$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.integration_order_id()'::regprocedure);
 d:=replace(d,'''warehouse.order_reconcile''','''warehouse.order_reconcile'',''order.edited'',''order.cancellation_requested''');EXECUTE d;
END $f$;

CREATE FUNCTION sa_domain.warehouse_amendment_payload(p_request uuid,p_provider text,p_facility text,p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE r sa_domain.order_requests;o sa_snapshot_20261019.sa_orders;u sa_snapshot_20261019.sa_users;delivery_ jsonb;address_ jsonb;name_ text;state_ text;prefix_ text;customer_ jsonb;
 l jsonb;v jsonb;tax_ jsonb;sku_ sa_snapshot_20261019.sa_rmp_skus;unit_ numeric;qty_ integer;piece_ integer;count_ integer:=0;lines_ jsonb:='[]';line_code text;comment_ text;line_total numeric;
BEGIN
 SELECT * INTO r FROM sa_domain.order_requests WHERE id=p_request;
 IF r.id IS NULL OR r.kind<>'edit' OR NOT sa_domain.can_order(r.order_id) THEN RAISE EXCEPTION 'Amendment unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=r.order_id;SELECT * INTO u FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_id;
 delivery_:=r.spec->'delivery';state_:=sa_domain.warehouse_state_code(delivery_->>'state');name_:=coalesce(nullif(btrim(u.customer_company_name),''),nullif(btrim(u.name),''));
 prefix_:=CASE(SELECT environment FROM sa_sync.environment_state) WHEN 'staging' THEN 'S' ELSE 'P' END;
 IF state_ IS NULL OR name_ IS NULL OR nullif(btrim(delivery_->>'address'),'') IS NULL OR nullif(btrim(delivery_->>'city'),'') IS NULL OR nullif(btrim(delivery_->>'zip_code'),'') IS NULL THEN RAISE EXCEPTION 'Amendment delivery is incomplete' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(r.spec->'group'->'lines') WHERE value->>'kind'='rmp' LOOP
  line_total:=0;comment_:=r.spec->'details'->'line_settings'->(l->>'line')->>'comment';
  FOR v IN SELECT value FROM jsonb_array_elements(l->'variants') LOOP
   SELECT * INTO sku_ FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=(v->>'sku_id')::bigint;
   IF sku_.id IS NULL OR nullif(sku_.name,'') IS NULL THEN RAISE EXCEPTION 'Amendment SKU unavailable' USING ERRCODE='55000';END IF;
   qty_:=(v->>'quantity')::integer;unit_:=(v->>'unit_price')::numeric+coalesce((l->'branding'->>'unit_price')::numeric,0);
   tax_:=sa_domain.unit_tax(unit_,delivery_->>'state',sku_.cgst,sku_.sgst,sku_.igst);unit_:=unit_+(tax_->>'cgst')::numeric+(tax_->>'sgst')::numeric+(tax_->>'igst')::numeric;
   line_total:=line_total+unit_*qty_;line_code:=prefix_||'-R'||replace(r.id::text,'-','')||'-'||(l->>'line')||'-'||sku_.id;
   IF p_provider='dashboard' THEN count_:=count_+1;IF count_>250 THEN RAISE EXCEPTION 'Dashboard line limit exceeded' USING ERRCODE='54000';END IF;
    lines_:=lines_||jsonb_build_array(jsonb_build_object('item_code',line_code,'sku_code',sku_.name,'quantity',qty_,'unit_price',unit_));
   ELSE count_:=count_+qty_;IF count_>2000 THEN RAISE EXCEPTION 'Uniware piece limit exceeded' USING ERRCODE='54000';END IF;
    SELECT lines_||jsonb_agg(jsonb_build_object('code',line_code||'-'||n,'itemSku',sku_.name,'shippingMethodCode','STD','giftWrap',false,'facilityCode',p_facility,'totalPrice',unit_,'sellingPrice',unit_,'prepaidAmount',0,'discount',0,'shippingCharges',0,'customFieldValues',jsonb_build_array(jsonb_build_object('name','Comment','value',left(coalesce(comment_,''),350)))) ORDER BY n) INTO lines_ FROM generate_series(1,qty_) n;
   END IF;
  END LOOP;
  IF round(line_total,2) IS DISTINCT FROM (l->>'total')::numeric THEN RAISE EXCEPTION 'Accepted amendment taxes changed' USING ERRCODE='40001';END IF;
 END LOOP;
 IF count_=0 THEN RETURN NULL;END IF;
 IF p_provider='dashboard' THEN
  address_:=jsonb_build_object('name',name_,'address_line1',delivery_->>'address','city',delivery_->>'city','state',state_,'country','IN','pincode',delivery_->>'zip_code','phone',u.phone,'email',u.email);
  customer_:=jsonb_build_object('code',coalesce(nullif(u.uc_customer_id,''),prefix_||'-'||u.id),'name',name_,'email',u.email,'phone',u.phone);
  RETURN jsonb_build_object('order_code',p_code,'facility_code',p_facility,'due_on',r.spec->'details'->>'due_at','customer',customer_,'shipping_address',address_,'payment',jsonb_build_object('instrument','CASH','cash_on_delivery',true),'comment',coalesce(r.spec->'details'->>'comment',o.comment,''),'items',lines_);
 END IF;
 IF p_provider<>'unicommerce' OR u.uc_customer_id IS DISTINCT FROM prefix_||'-'||u.id THEN RAISE EXCEPTION 'Customer synchronization required before amendment' USING ERRCODE='55000';END IF;
 address_:=jsonb_build_object('id',delivery_->>'address_id','name',name_,'addressLine1',delivery_->>'address','city',delivery_->>'city','state',state_,'country','IN','pincode',delivery_->>'zip_code','phone',u.phone,'email',u.email);
 RETURN jsonb_build_object('saleOrder',jsonb_build_object('code',p_code,'displayOrderCode',p_code,'displayOrderDateTime',o.created_on AT TIME ZONE 'UTC','customerCode',u.uc_customer_id,'customerName',name_,'channel','Custom','notificationEmail',u.email,'notificationMobile',u.phone,'cashOnDelivery',true,'paymentInstrument','CASH','addresses',jsonb_build_array(address_),'billingAddress',jsonb_build_object('referenceId',delivery_->>'address_id'),'shippingAddress',jsonb_build_object('referenceId',delivery_->>'address_id'),'totalCashOnDeliveryCharges',0,'fulfillmentTat',r.spec->'details'->>'due_at','saleOrderItems',lines_));
END $f$;
ALTER FUNCTION sa_domain.warehouse_amendment_payload(uuid,text,text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_amendment_payload(uuid,text,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_amendment_payload(uuid,text,text,text) TO sa_worker;

-- The narrow worker request capability is backed by the actual current lease.
CREATE FUNCTION sa_domain.warehouse_change_request_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT (j.payload->>'request_id')::uuid FROM sa_domain.worker_context c JOIN sa_domain.outbox j ON j.id=c.job_id
 WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.actor_id=sa_domain.worker_actor_id()
 AND j.lease_token=c.lease_token AND j.status='leased' AND j.lease_until>statement_timestamp()
 AND j.event_type IN('order.edited','order.cancellation_requested') AND j.payload->>'provider_confirmation_required'='true'
$f$;
ALTER FUNCTION sa_domain.warehouse_change_request_id() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_change_request_id() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_change_request_id() TO sa_guard,sa_worker,sa_executor;
-- All original structural and scope checks stay shared. Only this private copy
-- omits the external-operation gate; change_info excludes every other intent.
DO $f$ DECLARE d text;BEGIN d:=pg_get_functiondef('sa_domain.assert_order_amendable(bigint)'::regprocedure);
 d:=replace(d,'sa_domain.assert_order_amendable(', 'sa_domain.assert_warehouse_amendable(');
 d:=replace(d,' PERFORM sa_domain.assert_warehouse_idle(p_id);','');EXECUTE d;END $f$;
ALTER FUNCTION sa_domain.assert_warehouse_amendable(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.assert_warehouse_amendable(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.assert_warehouse_amendable(bigint) TO sa_guard;
CREATE FUNCTION sa_domain.warehouse_change_info(p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.order_requests;o sa_snapshot_20261019.sa_orders;a sa_domain.actor:=sa_domain.actor();sku_ bigint;row_ record;items_ jsonb:='[]';prefix_ text;code_ text;
BEGIN
 SELECT * INTO r FROM sa_domain.order_requests WHERE id=p_request;
 IF r.id IS NULL OR r.actor_id<>a.auth_id OR r.generation<>(SELECT generation FROM sa_domain.runtime_state) OR r.state NOT IN('queued','running') OR NOT sa_domain.can_order(r.order_id) THEN RAISE EXCEPTION 'Current change authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=r.order_id AND deleted_at IS NULL AND is_deleted IS NOT TRUE;
 IF nullif(o.dashboard_reservation_id,'') IS NOT NULL AND nullif(o.uc_order_id,'') IS NULL THEN RAISE EXCEPTION 'Reservation identity needs reconciliation' USING ERRCODE='55000';END IF;
 IF o.id IS NULL OR r.kind NOT IN('edit','cancel','delete') OR a.role_id NOT IN(1,10) OR(r.kind='edit' AND a.role_id<>1) OR(a.role_id=10 AND(r.kind<>'cancel' OR o.customer_dealer_id IS DISTINCT FROM a.user_id OR o.customer_id=a.user_id)) THEN RAISE EXCEPTION 'Change authority unavailable' USING ERRCODE='42501';END IF;
 IF sa_domain.version('order',o.id) IS DISTINCT FROM coalesce(r.spec->>'version',r.spec->>'order_version') THEN RAISE EXCEPTION 'Order changed after request' USING ERRCODE='40001';END IF;
 IF o.uc_status IN('COMPLETE','COMPLETED','CANCELLED') OR o.status=1 OR o.dispatched_quantity>0 OR(sa_domain.order_progress_totals(o.id)->>'dispatched')::bigint>0 THEN RAISE EXCEPTION 'Fulfilled order needs reconciliation' USING ERRCODE='55000';END IF;
 IF p_request IS DISTINCT FROM sa_domain.warehouse_change_request_id() THEN RAISE EXCEPTION 'Change lease capability required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT FROM sa_domain.warehouse_operations WHERE order_id=o.id AND generation=r.generation AND request_id IS DISTINCT FROM r.id AND attempted AND operation IN('submit','amend','cancel') AND state IN('ready','reconciliation_required')) THEN RAISE EXCEPTION 'Other warehouse operation unresolved' USING ERRCODE='55000';END IF;
 IF r.kind='edit' THEN PERFORM sa_domain.assert_warehouse_amendable(o.id);END IF;
 FOR row_ IN SELECT i.id,i.rmp_class_id,i.rmp_brand_id,i.rmp_category_id,q.size_id,sum(q.quantity)::bigint quantity FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=i.id WHERE i.order_id=o.id AND i.item_type=1 GROUP BY i.id,q.size_id ORDER BY i.id,q.size_id LOOP
  sku_:=sa_domain.stock_sku(row_.rmp_class_id,row_.rmp_brand_id,row_.rmp_category_id,row_.size_id);
  items_:=items_||jsonb_build_array(jsonb_build_object('sku_code',(SELECT name FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=sku_),'quantity',row_.quantity));
 END LOOP;
 prefix_:=CASE(SELECT environment FROM sa_sync.environment_state) WHEN 'staging' THEN 'S-' ELSE 'P-' END;code_:=prefix_||o.id;
 IF o.order_source='unicommerce' AND nullif(o.uc_order_id,'') IS NOT NULL THEN
  IF o.uc_order_id=code_ THEN code_:=code_||'-1';
  ELSIF o.uc_order_id~('^'||code_||'-[1-9][0-9]{0,8}$') THEN code_:=code_||'-'||((split_part(o.uc_order_id,'-',3))::bigint+1);
  ELSE RAISE EXCEPTION 'External replacement code requires reconciliation' USING ERRCODE='40001';END IF;
 END IF;
 RETURN jsonb_build_object('order_id',o.id::text,'customer_id',o.customer_id::text,'dealer_id',o.customer_dealer_id,'external_id',nullif(o.uc_order_id,''),'provider',o.order_source,'old_items',items_,'replacement_code',code_,'version',sa_domain.version('order',o.id));
END $f$;
ALTER FUNCTION sa_domain.warehouse_change_info(uuid) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_change_info(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_change_info(uuid) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_change_publish(p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();r sa_domain.order_requests;o sa_snapshot_20261019.sa_orders;v text;result_ jsonb;cached jsonb;
BEGIN
 SELECT * INTO r FROM sa_domain.order_requests WHERE id=p_request FOR UPDATE;
 IF r.id IS NULL OR r.actor_id<>a.auth_id OR r.generation<>(SELECT generation FROM sa_domain.runtime_state) OR r.state NOT IN('queued','running') THEN RAISE EXCEPTION 'Change request unavailable' USING ERRCODE='42501';END IF;
 IF p_request IS DISTINCT FROM sa_domain.warehouse_change_request_id() THEN RAISE EXCEPTION 'Change lease capability required' USING ERRCODE='42501';END IF;
 cached:=sa_domain.begin_command(CASE r.kind WHEN 'edit' THEN 'order.amendment_applied' ELSE 'order.provider_cancelled' END,r.id,jsonb_build_object('request_id',r.id));IF cached IS NOT NULL THEN RETURN cached;END IF;
 o:=sa_domain.lock_order(r.order_id,false);
 IF r.kind='edit' THEN
  v:=sa_domain.bump_version('order',r.order_id,r.spec->>'version');result_:=sa_domain.apply_order_amendment(r.order_id,r.spec||jsonb_build_object('version',v),r.command_key);
  result_:=sa_domain.finish_command('order.amendment_applied',r.id,'order',r.order_id,result_,jsonb_build_object('request_id',r.id,'reason',r.spec->>'reason','price_changed',result_->'price_changed'));
 ELSE
  IF a.role_id NOT IN(1,10) OR NOT sa_domain.can_order(o.id) OR(a.role_id=10 AND(r.kind<>'cancel' OR o.customer_dealer_id IS DISTINCT FROM a.user_id OR o.customer_id=a.user_id)) THEN RAISE EXCEPTION 'Cancellation authority changed' USING ERRCODE='42501';END IF;
  IF o.uc_status IN('COMPLETE','COMPLETED') OR o.dispatched_quantity>0 OR(sa_domain.order_progress_totals(o.id)->>'dispatched')::bigint>0 THEN RAISE EXCEPTION 'Fulfilled order cannot be canceled' USING ERRCODE='55000';END IF;
  v:=sa_domain.bump_version('order',r.order_id,r.spec->>'order_version');
  UPDATE sa_snapshot_20261019.sa_orders SET uc_status='CANCELLED',status=0,is_force_update=false,is_deleted=(r.kind='delete'),deleted_at=CASE WHEN r.kind='delete' THEN now() AT TIME ZONE 'UTC' END,updated_at=now() WHERE id=o.id;
  UPDATE sa_snapshot_20261019.sa_items SET uc_order_status='CANCELLED',updated_at=now() WHERE order_id=o.id AND item_type=1;
  result_:=jsonb_build_object('id',o.id::text,'version',v,'state',CASE r.kind WHEN 'delete' THEN 'deleted' ELSE 'cancelled' END);
  result_:=sa_domain.finish_command('order.provider_cancelled',r.id,'order',o.id,result_,jsonb_build_object('request_id',r.id,'reason',r.spec->>'reason','kind',r.kind));
 END IF;
 UPDATE sa_domain.order_requests SET state='succeeded',result=result_,updated_at=now() WHERE id=r.id;RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.warehouse_change_publish(uuid) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.warehouse_change_publish(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_change_publish(uuid) TO sa_worker;

CREATE POLICY warehouse_cancel_request_finish ON sa_domain.order_requests FOR UPDATE TO sa_executor
 USING(id=(SELECT sa_domain.warehouse_change_request_id()) AND actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state) AND kind='cancel')
 WITH CHECK(id=(SELECT sa_domain.warehouse_change_request_id()) AND actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state) AND kind='cancel');

-- Provider webhooks/reconciliation are retained but quarantined during an
-- amendment. They must never publish an old-order cancellation mid-replacement.
CREATE FUNCTION sa_domain.warehouse_change_pending(p_order bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_domain.order_requests WHERE order_id=p_order AND generation=(SELECT generation FROM sa_domain.runtime_state) AND state IN('queued','running') AND(kind IN('cancel','delete') OR spec->>'provider_confirmation_required'='true'))
$f$;
ALTER FUNCTION sa_domain.warehouse_change_pending(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_change_pending(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_change_pending(bigint) TO sa_integrator;
DO $f$ DECLARE d text;BEGIN d:=pg_get_functiondef('sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text)'::regprocedure);
 d:=replace(d,' o:=sa_domain.lock_order(p_order,false);', $s$ IF sa_domain.warehouse_change_pending(p_order) THEN RETURN jsonb_build_object('state','quarantined','reason','ORDER_CHANGE_PENDING');END IF;
 o:=sa_domain.lock_order(p_order,false);$s$);EXECUTE d;END $f$;

GRANT SELECT ON sa_domain.warehouse_operations TO sa_integrator;
CREATE POLICY integration_change_operation ON sa_domain.warehouse_operations FOR SELECT TO sa_integrator USING(order_id=(SELECT sa_domain.integration_order_id()));
GRANT DELETE ON sa_domain.warehouse_links TO sa_integrator;
CREATE FUNCTION sa_domain.warehouse_change_reference(p_request uuid,p_external_id text,p_external_code text,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE op sa_domain.warehouse_operations;o sa_snapshot_20261019.sa_orders;
BEGIN
 SELECT * INTO op FROM sa_domain.warehouse_operations WHERE request_id=p_request AND order_id=sa_domain.integration_order_id() AND generation=(SELECT generation FROM sa_domain.runtime_state) AND state='confirmed';
 IF op.id IS NULL OR op.operation<>'amend' OR op.phase NOT IN('amend','submit','cancel') THEN RAISE EXCEPTION 'Confirmed amendment capability required' USING ERRCODE='42501';END IF;
 o:=sa_domain.lock_order(op.order_id,false);
 IF nullif(o.uc_order_id,'') IS DISTINCT FROM op.saga->>'original_external_id' THEN RAISE EXCEPTION 'External reference changed' USING ERRCODE='40001';END IF;
 IF op.phase='cancel' THEN
  IF p_external_id IS NOT NULL OR p_external_code IS NOT NULL OR op.saga->'replacement' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unexpected cancellation publication' USING ERRCODE='22023';END IF;
  DELETE FROM sa_domain.warehouse_links WHERE order_id=o.id;
  UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id=NULL,uc_status='',updated_at=now() WHERE id=o.id;
 ELSE
  IF p_external_id IS DISTINCT FROM op.result->>'external_id' OR p_external_code IS DISTINCT FROM op.external_code OR p_status NOT IN('PENDING','PROCESSING') OR p_status IS NULL THEN RAISE EXCEPTION 'Replacement proof mismatch' USING ERRCODE='22023';END IF;
  INSERT INTO sa_domain.warehouse_links(order_id,provider,external_id,external_code,generation,status,last_event_at,last_event_id)
   VALUES(o.id,op.provider,p_external_id,p_external_code,op.generation,p_status,now(),'amendment_'||op.id)
   ON CONFLICT(order_id) DO UPDATE SET provider=excluded.provider,external_id=excluded.external_id,external_code=excluded.external_code,generation=excluded.generation,status=excluded.status,last_event_at=excluded.last_event_at,last_event_id=excluded.last_event_id,updated_at=now();
  UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id=p_external_id,uc_status=p_status,order_source=op.provider,updated_at=now() WHERE id=o.id;
  UPDATE sa_snapshot_20261019.sa_items SET uc_order_status=p_status,updated_at=now() WHERE order_id=o.id AND item_type=1;
 END IF;
END $f$;
ALTER FUNCTION sa_domain.warehouse_change_reference(uuid,text,text,text) OWNER TO sa_integrator;
REVOKE ALL ON FUNCTION sa_domain.warehouse_change_reference(uuid,text,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_change_reference(uuid,text,text,text) TO sa_worker;

-- Phase progression commits evidence before making the next HTTP eligible.
CREATE FUNCTION sa_domain.warehouse_change_advance(p_job sa_domain.outbox,p_op sa_domain.warehouse_operations,p_phase text,p_payload jsonb,p_result jsonb,p_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 UPDATE sa_domain.warehouse_operations SET phase=p_phase,payload=p_payload,request_key='squad_'||replace(p_job.id::text,'-','')||'_'||p_phase,
 external_code=coalesce(p_code,external_code),external_id=CASE WHEN p_phase='submit' THEN NULL ELSE external_id END,
 saga=jsonb_set(saga,ARRAY['history',p_op.phase],jsonb_build_object('request_key',p_op.request_key,'payload',p_op.payload,'result',p_result),true),
 proof='{}',result='{}',state='ready',attempted=false,last_prepare_prior_attempted=false,prepared_lease_token=NULL,updated_at=now() WHERE id=p_op.id;
 UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=p_job.lease_token;
 UPDATE sa_domain.outbox SET status='pending',attempts=0,available_at=now(),lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=p_job.id;
 RETURN jsonb_build_object('state','pending','phase',p_phase);
END $f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_change_advance(sa_domain.outbox,sa_domain.warehouse_operations,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_change_advance(sa_domain.outbox,sa_domain.warehouse_operations,text,jsonb,jsonb,text) TO sa_worker;

ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) RENAME TO warehouse_prepare_customer_base;
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) RENAME TO warehouse_finish_customer_base;
REVOKE ALL ON FUNCTION sa_domain.warehouse_prepare_customer_base(uuid,uuid),sa_domain.warehouse_finish_customer_base(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_prepare_customer_base(uuid,uuid),sa_domain.warehouse_finish_customer_base(uuid,uuid,jsonb) TO sa_worker;
CREATE FUNCTION sa_domain.squad_warehouse_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;op sa_domain.warehouse_operations;req sa_domain.order_requests;g bigint;cfg jsonb;info_ jsonb;new_ jsonb;phase_ text;code_ text;prior_ boolean;error_ text;r jsonb;customer_ jsonb;child_ sa_domain.outbox;
BEGIN
 PERFORM sa_domain.assert_service_worker();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id;
 IF j.event_type NOT IN('order.edited','order.cancellation_requested') OR j.event_type IS NULL OR j.payload->>'provider_confirmation_required' IS DISTINCT FROM 'true' THEN RETURN sa_domain.warehouse_prepare_customer_base(p_id,p_lease_token);END IF;
 g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Change lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Change lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('order:'||j.aggregate_id,784139));
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  SELECT * INTO req FROM sa_domain.order_requests WHERE id=(j.payload->>'request_id')::uuid AND order_id=j.aggregate_id FOR UPDATE;
  info_:=sa_domain.warehouse_change_info(req.id);
  SELECT * INTO op FROM sa_domain.warehouse_operations WHERE job_id=j.id FOR UPDATE;
  IF op.id IS NULL THEN
   IF info_->>'external_id' IS NULL AND(info_->>'dealer_id' IS NOT NULL OR req.kind<>'edit' OR NOT EXISTS(SELECT FROM jsonb_array_elements(req.spec->'group'->'lines') WHERE value->>'kind'='rmp')) THEN
    r:=sa_domain.warehouse_change_publish(req.id);DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN sa_domain.warehouse_job_settle(j,r);
   END IF;
   IF NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Warehouse ownership inactive' USING ERRCODE='55000';END IF;
   IF info_->>'external_id' IS NOT NULL AND(info_->>'dealer_id' IS NOT NULL OR info_->>'provider' IS DISTINCT FROM cfg->>'provider') THEN RAISE EXCEPTION 'External ownership conflict' USING ERRCODE='55000';END IF;
   -- Dealer-linked orders consume dealer stock and never reach the provider.
   IF info_->>'dealer_id' IS NOT NULL THEN new_:=NULL;
   ELSIF req.kind='edit' THEN
    IF cfg->>'provider'='unicommerce' AND EXISTS(SELECT FROM jsonb_array_elements(req.spec->'group'->'lines') WHERE value->>'kind'='rmp') THEN
     customer_:=sa_domain.warehouse_order_customer(req.order_id);
     IF customer_->>'code' IS NULL THEN
      INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(j.actor_id,'warehouse.customer','person',(customer_->>'id')::bigint,j.id,g,jsonb_build_object('operation','customer','source_job',j.id)) ON CONFLICT DO NOTHING;
      SELECT * INTO child_ FROM sa_domain.outbox WHERE actor_id=j.actor_id AND command_key=j.id AND event_type='warehouse.customer' AND aggregate_id=(customer_->>'id')::bigint;
      IF child_.status IN('dead','done') THEN RAISE EXCEPTION 'Customer synchronization failed' USING ERRCODE='55000';END IF;
      DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
      UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
      UPDATE sa_domain.outbox SET status='pending',attempts=greatest(attempts-1,0),available_at=now()+interval '10 seconds',lease_until=NULL,lease_token=NULL,revision=revision+1 WHERE id=j.id;
      RETURN jsonb_build_object('state','pending','dependency','customer','dependency_job_id',child_.id);
     END IF;
    END IF;
    new_:=sa_domain.warehouse_amendment_payload(req.id,cfg->>'provider',cfg->>'one_day_facility',info_->>'replacement_code');
   END IF;
   IF info_->>'external_id' IS NULL AND new_ IS NULL THEN
    r:=sa_domain.warehouse_change_publish(req.id);DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN sa_domain.warehouse_job_settle(j,r);
   END IF;
   phase_:=CASE WHEN info_->>'external_id' IS NULL THEN 'submit' ELSE 'inspect' END;
   code_:=CASE WHEN phase_='submit' THEN info_->>'replacement_code' WHEN cfg->>'provider'='unicommerce' THEN info_->>'external_id' ELSE CASE cfg->>'environment' WHEN 'staging' THEN 'S-' ELSE 'P-' END||req.order_id END;
   INSERT INTO sa_domain.warehouse_operations(job_id,generation,provider,operation,phase,order_id,request_id,request_key,facility_code,external_id,external_code,payload,saga)
   VALUES(j.id,g,cfg->>'provider',CASE req.kind WHEN 'edit' THEN 'amend' ELSE 'cancel' END,phase_,req.order_id,req.id,'squad_'||replace(j.id::text,'-','')||'_'||phase_,cfg->>'one_day_facility',info_->>'external_id',code_,CASE WHEN phase_='submit' THEN new_ ELSE '{}'::jsonb END,jsonb_build_object('original_external_id',info_->>'external_id','replacement_code',info_->>'replacement_code','replacement',new_,'old_items',info_->'old_items','history','{}'::jsonb)) RETURNING * INTO op;
  END IF;
  IF NOT coalesce((cfg->>'ready')::boolean,false) OR op.provider<>cfg->>'provider' OR op.generation<>g OR op.state NOT IN('ready','reconciliation_required') THEN RAISE EXCEPTION 'Change intent unavailable' USING ERRCODE='55000';END IF;
  prior_:=op.attempted;UPDATE sa_domain.warehouse_operations SET attempted=true,last_prepare_prior_attempted=prior_,prepared_lease_token=p_lease_token,state='ready',updated_at=now() WHERE id=op.id;
  UPDATE sa_domain.order_requests SET state='running',updated_at=now() WHERE id=req.id;
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  RETURN jsonb_build_object('state','prepared','intent_id',op.id,'provider',op.provider,'operation',op.phase,'purpose','amend','request_key',op.request_key,'project_ref',cfg->>'project_ref','environment',cfg->>'environment','facility_code',op.facility_code,'provider_order_id',op.external_id,'order_code',op.external_code,'payload',op.payload,'attempted',prior_);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;END;
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN sa_domain.warehouse_job_settle(j,'{}',error_,false);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) TO service_role;
CREATE FUNCTION sa_domain.squad_warehouse_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;op sa_domain.warehouse_operations;req sa_domain.order_requests;cfg jsonb;g bigint;info_ jsonb;r jsonb;error_ text;payload_ jsonb;expected_ jsonb;observed_ jsonb;codes_ jsonb;phase_ text;status_ text;event_ jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id;
 IF j.event_type NOT IN('order.edited','order.cancellation_requested') OR j.event_type IS NULL OR j.payload->>'provider_confirmation_required' IS DISTINCT FROM 'true' THEN RETURN sa_domain.warehouse_finish_customer_base(p_id,p_lease_token,p_result);END IF;
 g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Change result lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status,'replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Change result lease expired' USING ERRCODE='40001';END IF;
 SELECT * INTO op FROM sa_domain.warehouse_operations WHERE job_id=j.id AND generation=g FOR UPDATE;
 IF op.id IS NULL OR op.request_id IS NULL OR NOT op.attempted OR op.prepared_lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Prepared change unavailable' USING ERRCODE='55000';END IF;
 IF p_result->>'code' IN('RETRY','RECONCILIATION_REQUIRED','REJECTED') THEN
  -- Base settlement is shared, but phase history must survive later failures.
  r:=sa_domain.warehouse_finish_customer_base(p_id,p_lease_token,p_result);RETURN r;
 END IF;
 BEGIN
  PERFORM sa_domain.check_fields(p_result,ARRAY['code','external_id','external_code','status','proof']);
  IF jsonb_typeof(p_result->'proof') IS DISTINCT FROM 'object' OR octet_length(p_result::text)>2097152 OR p_result->>'code' IS DISTINCT FROM (CASE op.phase WHEN 'inspect' THEN 'OBSERVED' ELSE 'CONFIRMED' END) OR p_result->>'external_code' IS DISTINCT FROM op.external_code OR nullif(p_result->>'external_id','') IS NULL OR(op.external_id IS NOT NULL AND p_result->>'external_id' IS DISTINCT FROM op.external_id) THEN RAISE EXCEPTION 'Change result identity mismatch' USING ERRCODE='22023';END IF;
  IF op.provider<>cfg->>'provider' OR NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Warehouse configuration changed' USING ERRCODE='55000';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('order:'||op.order_id,784139));
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  SELECT * INTO req FROM sa_domain.order_requests WHERE id=op.request_id FOR UPDATE;
  info_:=sa_domain.warehouse_change_info(req.id);
  IF op.phase='inspect' THEN
   IF p_result->>'status' IS NULL OR p_result->>'status' NOT IN('CREATED','PENDING_VERIFICATION','PENDING','PROCESSING') OR jsonb_typeof(p_result->'proof'->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'proof'->'items') NOT BETWEEN 1 AND (CASE op.provider WHEN 'dashboard' THEN 250 ELSE 2000 END) THEN RAISE EXCEPTION 'Provider order cannot safely change' USING ERRCODE='55000';END IF;
   SELECT jsonb_object_agg(sku,n) INTO expected_ FROM(SELECT value->>'sku_code' sku,sum((value->>'quantity')::bigint) n FROM jsonb_array_elements(op.saga->'old_items') GROUP BY 1)x;
   IF op.provider='dashboard' THEN
    IF nullif(p_result->'proof'->>'updated_at','') IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(p_result->'proof'->'items') WHERE jsonb_typeof(value->'quantity') IS DISTINCT FROM 'number' OR(value->>'quantity')::numeric<=0 OR(value->>'quantity')::numeric<>trunc((value->>'quantity')::numeric) OR(value->>'dispatched_quantity')::numeric IS DISTINCT FROM 0::numeric) THEN RAISE EXCEPTION 'Provider partial dispatch or missing version' USING ERRCODE='55000';END IF;
    PERFORM(p_result->'proof'->>'updated_at')::timestamptz;
    SELECT jsonb_object_agg(sku,n) INTO observed_ FROM(SELECT value->>'sku_code' sku,sum((value->>'quantity')::bigint) n FROM jsonb_array_elements(p_result->'proof'->'items') GROUP BY 1)x;
   ELSE
    IF EXISTS(SELECT FROM jsonb_array_elements(p_result->'proof'->'items') WHERE value->>'facility_code' IS DISTINCT FROM op.facility_code OR value->>'status' IS NULL OR value->>'status' NOT IN('CREATED','PENDING_VERIFICATION','PROCESSING','ALLOCATED','UNALLOCATED','PICKING','PICKED','PACKING','PACKED') OR nullif(value->>'code','') IS NULL) OR(SELECT count(DISTINCT value->>'code') FROM jsonb_array_elements(p_result->'proof'->'items'))<>jsonb_array_length(p_result->'proof'->'items') THEN RAISE EXCEPTION 'Provider item state requires reconciliation' USING ERRCODE='55000';END IF;
    SELECT jsonb_object_agg(sku,n) INTO observed_ FROM(SELECT value->>'sku_code' sku,count(*) n FROM jsonb_array_elements(p_result->'proof'->'items') GROUP BY 1)x;
   END IF;
   IF expected_ IS NULL OR expected_ IS DISTINCT FROM observed_ THEN RAISE EXCEPTION 'Provider SKU quantities differ from source order' USING ERRCODE='40001';END IF;
   IF op.provider='dashboard' AND op.operation='amend' AND op.saga->'replacement'<>'null'::jsonb THEN
    phase_:='amend';payload_:=((op.saga->'replacement')-'order_code'-'facility_code'-'payment')||jsonb_build_object('expected_updated_at',p_result->'proof'->>'updated_at');
   ELSE
    phase_:='cancel';IF op.provider='dashboard' THEN payload_:=jsonb_build_object('reason',req.spec->>'reason');
    ELSE SELECT jsonb_agg(value->>'code' ORDER BY value->>'code') INTO codes_ FROM jsonb_array_elements(p_result->'proof'->'items');payload_:=jsonb_build_object('saleOrderCode',op.external_code,'cancellationReason',req.spec->>'reason','saleOrderItemCodes',codes_);END IF;
   END IF;
   r:=sa_domain.warehouse_change_advance(j,op,phase_,payload_,p_result);
  ELSE
   IF op.provider='dashboard' AND(p_result->'proof'->>'request_key' IS DISTINCT FROM op.request_key OR p_result->'proof'->>'source' IS NULL OR p_result->'proof'->>'source' NOT IN('atomic_mutation_response','durable_mutation_result')) THEN RAISE EXCEPTION 'Durable provider mutation proof required' USING ERRCODE='22023';END IF;
   IF op.phase='cancel' THEN
    IF op.provider='dashboard' THEN IF p_result->>'status' IS DISTINCT FROM 'CANCELLED' THEN RAISE EXCEPTION 'Cancellation is not confirmed' USING ERRCODE='55000';END IF;
    ELSE
     SELECT jsonb_agg(value ORDER BY value) INTO codes_ FROM jsonb_array_elements_text(p_result->'proof'->'cancelled_item_codes');
     IF codes_ IS DISTINCT FROM op.payload->'saleOrderItemCodes' OR jsonb_typeof(p_result->'proof'->'items') IS DISTINCT FROM 'array' OR EXISTS(SELECT FROM jsonb_array_elements_text(codes_) wanted WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(p_result->'proof'->'items') item WHERE item->>'code'=wanted AND item->>'status'='CANCELLED')) THEN RAISE EXCEPTION 'Every original item must be confirmed cancelled' USING ERRCODE='55000';END IF;
    END IF;
    IF op.operation='amend' AND op.saga->'replacement'<>'null'::jsonb THEN
     r:=sa_domain.warehouse_change_advance(j,op,'submit',op.saga->'replacement',p_result,op.saga->>'replacement_code');
     DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN r;
    END IF;
   ELSIF op.phase IN('amend','submit') THEN
    status_:=CASE p_result->>'status' WHEN 'CREATED' THEN 'PENDING' WHEN 'PENDING_VERIFICATION' THEN 'PENDING' ELSE p_result->>'status' END;
    IF status_ IS NULL OR status_ NOT IN('PENDING','PROCESSING') THEN RAISE EXCEPTION 'Replacement order not safely open' USING ERRCODE='55000';END IF;
    IF op.provider='unicommerce' AND p_result->>'external_id' IS DISTINCT FROM op.external_code THEN RAISE EXCEPTION 'Replacement identity mismatch' USING ERRCODE='22023';END IF;
   ELSE RAISE EXCEPTION 'Unexpected change phase' USING ERRCODE='55000';END IF;
   -- Recompute before any local publication: tax/profile/delivery changes while
   -- HTTP was in flight require reconciliation instead of different money.
   IF op.operation='amend' AND sa_domain.warehouse_amendment_payload(req.id,op.provider,op.facility_code,op.saga->>'replacement_code') IS DISTINCT FROM nullif(op.saga->'replacement','null'::jsonb) THEN RAISE EXCEPTION 'Frozen amendment source changed' USING ERRCODE='40001';END IF;
   UPDATE sa_domain.warehouse_operations SET state='confirmed',proof=p_result->'proof',result=p_result,updated_at=now() WHERE id=op.id;
   r:=sa_domain.warehouse_change_publish(req.id);
   IF op.operation='amend' THEN
    INSERT INTO sa_domain.integration_context VALUES(pg_backend_pid(),txid_current(),j.id,j.lease_token,op.order_id,g);
    PERFORM sa_domain.warehouse_change_reference(req.id,CASE WHEN op.phase='cancel' THEN NULL ELSE p_result->>'external_id' END,CASE WHEN op.phase='cancel' THEN NULL ELSE op.external_code END,status_);
    DELETE FROM sa_domain.integration_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
   END IF;
   UPDATE sa_domain.warehouse_operations SET result=r||jsonb_build_object('external_id',p_result->>'external_id','external_code',p_result->>'external_code'),updated_at=now() WHERE id=op.id;
   r:=sa_domain.warehouse_job_settle(j,r);
  END IF;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;
  UPDATE sa_domain.warehouse_operations SET state='reconciliation_required',proof=coalesce(p_result->'proof','{}'),result=jsonb_build_object('error_code',error_,'external_id',p_result->>'external_id','external_code',p_result->>'external_code'),updated_at=now() WHERE id=op.id;
  r:=sa_domain.warehouse_job_settle(j,'{}',error_,false);
 END;
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();DELETE FROM sa_domain.integration_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_executor,sa_integrator;
NOTIFY pgrst,'reload schema';
COMMIT;
