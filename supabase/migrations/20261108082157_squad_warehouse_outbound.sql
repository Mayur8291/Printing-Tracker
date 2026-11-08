BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_worker,sa_guard,sa_executor;
CREATE TABLE sa_domain.warehouse_operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL UNIQUE REFERENCES sa_domain.outbox,
 generation bigint NOT NULL,provider text NOT NULL,operation text NOT NULL,phase text NOT NULL DEFAULT 'ready',
 order_id bigint,request_id uuid,reconciliation_id uuid REFERENCES sa_domain.warehouse_reconciliations,
 request_key text NOT NULL UNIQUE,facility_code text NOT NULL,external_id text,external_code text,
 payload jsonb NOT NULL,attempted boolean NOT NULL DEFAULT false,last_prepare_prior_attempted boolean NOT NULL DEFAULT false,prepared_lease_token uuid,state text NOT NULL DEFAULT 'ready',
 proof jsonb NOT NULL DEFAULT '{}',result jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(payload::text)<=2097152),CHECK(octet_length(proof::text)<=2097152),
 CHECK(state IN('ready','confirmed','rejected','reconciliation_required'))
);
ALTER TABLE sa_domain.warehouse_operations ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.warehouse_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.warehouse_operations TO sa_worker;
GRANT SELECT ON sa_domain.warehouse_operations TO sa_guard;
CREATE POLICY warehouse_operation_worker ON sa_domain.warehouse_operations TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY warehouse_operation_guard ON sa_domain.warehouse_operations FOR SELECT TO sa_guard USING(true);
CREATE INDEX warehouse_outbox_reconciliation ON sa_domain.outbox((payload->>'reconciliation_id'),status) WHERE event_type IN('warehouse.order_reconcile','warehouse.inventory','warehouse.reconcile');
CREATE INDEX warehouse_operation_order ON sa_domain.warehouse_operations(order_id,generation,state) WHERE attempted AND order_id IS NOT NULL;
CREATE INDEX warehouse_operation_reconciliation ON sa_domain.warehouse_operations(reconciliation_id,state) WHERE reconciliation_id IS NOT NULL;
ALTER TABLE sa_domain.warehouse_reconciliations ADD COLUMN phase text NOT NULL DEFAULT 'orders',ADD COLUMN ceiling_id bigint,ADD COLUMN enumeration_done boolean NOT NULL DEFAULT false;
GRANT SELECT ON sa_domain.line_receipts TO sa_guard;
CREATE POLICY warehouse_line_receipt_read ON sa_domain.line_receipts FOR SELECT TO sa_guard USING(true);
GRANT SELECT ON sa_snapshot_20261019.sa_users,sa_snapshot_20261019.sa_addresses,sa_snapshot_20261019.sa_rmp_skus TO sa_guard;

CREATE FUNCTION sa_domain.warehouse_state_code(p_state text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT '{"andaman & nicobar islands":"AN","andhra pradesh (old)":"AP","arunachal pradesh":"AR","assam":"AS","bihar":"BR","chandigarh":"CH","chhattisgarh":"CT","dadra & nagar haveli":"DN","daman & diu":"DD","delhi":"DL","goa":"GA","gujarat":"GJ","haryana":"HR","himachal pradesh":"HP","jammu & kashmir":"JK","jharkhand":"JH","karnataka":"KA","kerala":"KL","lakshadweep":"LD","madhya pradesh":"MP","maharashtra":"MH","manipur":"MN","meghalaya":"ML","mizoram":"MZ","nagaland":"NL","odisha":"OR","puducherry":"PY","punjab":"PB","rajasthan":"RJ","sikkim":"SK","tamil nadu":"TN","tripura":"TR","uttar pradesh":"UP","uttarakhand":"UT","west bengal":"WB","telangana":"TL","andhra pradesh":"AD","ladakh":"LA"}'::jsonb->>lower(btrim(p_state))
$f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_state_code(text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_state_code(text) TO sa_guard,sa_worker;

-- Only the lease-backed current actor can request this payload. Monetary values
-- come from accepted line receipts and stored tax quantities, never live prices.
CREATE FUNCTION sa_domain.warehouse_order_payload(p_order bigint,p_provider text,p_facility text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE o sa_snapshot_20261019.sa_orders;u sa_snapshot_20261019.sa_users;delivery_ jsonb;address_ jsonb;customer_ jsonb;lines_ jsonb:='[]';row_ record;v jsonb;sku_ sa_snapshot_20261019.sa_rmp_skus;tax_ numeric;qty_ bigint;price_ numeric;prefix_ text;code_ text;state_ text;piece_ bigint;count_ bigint:=0;name_ text;
BEGIN
 IF NOT sa_domain.can_order(p_order) THEN RAISE EXCEPTION 'Order authority unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_order AND deleted_at IS NULL AND is_deleted IS NOT TRUE;
 IF o.id IS NULL OR o.customer_dealer_id IS NOT NULL THEN RAISE EXCEPTION 'Order is not a direct warehouse order' USING ERRCODE='55000';END IF;
 SELECT * INTO u FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_id;
 SELECT delivery INTO delivery_ FROM sa_domain.order_receipts WHERE order_id=p_order AND generation=(SELECT generation FROM sa_domain.runtime_state);
 IF delivery_ IS NULL THEN RAISE EXCEPTION 'Accepted delivery receipt is required' USING ERRCODE='55000';END IF;
 prefix_:=CASE(SELECT environment FROM sa_sync.environment_state) WHEN 'staging' THEN 'S' ELSE 'P' END;code_:=prefix_||'-'||o.id;
 state_:=sa_domain.warehouse_state_code(delivery_->>'state');name_:=coalesce(nullif(btrim(u.customer_company_name),''),u.name);
 IF state_ IS NULL OR nullif(btrim(delivery_->>'address'),'') IS NULL OR nullif(btrim(delivery_->>'city'),'') IS NULL OR nullif(btrim(delivery_->>'zip_code'),'') IS NULL OR nullif(btrim(name_),'') IS NULL OR o.due_on IS NULL THEN RAISE EXCEPTION 'Warehouse shipping details incomplete' USING ERRCODE='22023';END IF;
 address_:=jsonb_build_object('name',name_,'address_line1',delivery_->>'address','city',delivery_->>'city','state',state_,'country','IN','pincode',delivery_->>'zip_code','phone',u.phone,'email',u.email);
 customer_:=jsonb_build_object('code',coalesce(nullif(u.uc_customer_id,''),prefix_||'-'||u.id),'name',name_,'email',u.email,'phone',u.phone);
 FOR row_ IN SELECT i.id,i.comment,r.pricing FROM sa_snapshot_20261019.sa_items i LEFT JOIN sa_domain.line_receipts r ON r.item_id=i.id AND r.generation=(SELECT generation FROM sa_domain.runtime_state) WHERE i.order_id=p_order AND i.item_type=1 ORDER BY i.id LOOP
  IF row_.pricing IS NULL THEN RAISE EXCEPTION 'Accepted pricing receipt is required' USING ERRCODE='55000';END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(row_.pricing->'variants') LOOP
   qty_:=(v->>'quantity')::bigint;SELECT * INTO sku_ FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=(v->>'sku_id')::bigint;
   SELECT sum(coalesce(q.cgst,0)+coalesce(q.sgst,0)+coalesce(q.igst,0)) INTO tax_ FROM sa_snapshot_20261019.sa_quantities q JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.name=s.name WHERE q.item_id=row_.id AND rs.id=(v->>'size_id')::bigint HAVING sum(q.quantity)=qty_;
   IF sku_.id IS NULL OR tax_ IS NULL OR qty_<=0 THEN RAISE EXCEPTION 'Accepted variant identity/quantity mismatch' USING ERRCODE='55000';END IF;
   price_:=(v->>'unit_price')::numeric+coalesce((row_.pricing->'branding'->>'unit_price')::numeric,0)+tax_/qty_;
   IF price_<0 OR price_>1000000000000 THEN RAISE EXCEPTION 'Invalid accepted warehouse amount' USING ERRCODE='22023';END IF;
   IF p_provider='dashboard' THEN
    count_:=count_+1;IF count_>250 THEN RAISE EXCEPTION 'Warehouse line limit exceeded' USING ERRCODE='54000';END IF;
    lines_:=lines_||jsonb_build_array(jsonb_build_object('item_code',prefix_||'-'||row_.id||'-'||sku_.id,'sku_code',sku_.name,'quantity',qty_,'unit_price',price_));
   ELSE
    count_:=count_+qty_;IF count_>2000 THEN RAISE EXCEPTION 'Uniware piece limit exceeded' USING ERRCODE='54000';END IF;
    SELECT lines_||jsonb_agg(jsonb_build_object('code',prefix_||'-'||piece||'-'||row_.id||'-'||sku_.id,'itemSku',sku_.name,'shippingMethodCode','STD','giftWrap',false,'facilityCode',p_facility,'totalPrice',price_,'sellingPrice',price_,'prepaidAmount',0,'discount',0,'shippingCharges',0,'customFieldValues',jsonb_build_array(jsonb_build_object('name','Comment','value',left(coalesce(row_.comment,''),350)))) ORDER BY piece) INTO lines_ FROM generate_series(1,qty_) piece;
   END IF;
  END LOOP;
 END LOOP;
 IF count_=0 THEN RAISE EXCEPTION 'No warehouse items' USING ERRCODE='55000';END IF;
 IF p_provider='dashboard' THEN RETURN jsonb_build_object('order_code',code_,'facility_code',p_facility,'due_on',o.due_on AT TIME ZONE 'UTC','customer',customer_,'shipping_address',address_,'payment',jsonb_build_object('instrument','CASH','cash_on_delivery',true),'comment',coalesce(o.comment,''),'items',lines_);END IF;
 IF p_provider<>'unicommerce' OR nullif(u.uc_customer_id,'') IS NULL THEN RAISE EXCEPTION 'Warehouse customer synchronization required' USING ERRCODE='55000';END IF;
 address_:=jsonb_build_object('id',delivery_->>'address_id','name',name_,'addressLine1',delivery_->>'address','city',delivery_->>'city','state',state_,'country','IN','pincode',delivery_->>'zip_code','phone',u.phone,'email',u.email);
 RETURN jsonb_build_object('saleOrder',jsonb_build_object('code',code_,'displayOrderCode',code_,'displayOrderDateTime',o.created_on AT TIME ZONE 'UTC','customerCode',u.uc_customer_id,'customerName',name_,'channel','Custom','notificationEmail',u.email,'notificationMobile',u.phone,'cashOnDelivery',true,'paymentInstrument','CASH','addresses',jsonb_build_array(address_),'billingAddress',jsonb_build_object('referenceId',delivery_->>'address_id'),'shippingAddress',jsonb_build_object('referenceId',delivery_->>'address_id'),'totalCashOnDeliveryCharges',0,'fulfillmentTat',o.due_on AT TIME ZONE 'UTC','saleOrderItems',lines_));
END $f$;
ALTER FUNCTION sa_domain.warehouse_order_payload(bigint,text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_order_payload(bigint,text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_order_payload(bigint,text,text) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_order_info(p_order bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_admin.is_admin() AND NOT sa_domain.can_order(p_order) THEN RAISE EXCEPTION 'Order authority unavailable' USING ERRCODE='42501';END IF;
 RETURN(SELECT jsonb_build_object('id',o.id::text,'external_id',nullif(o.uc_order_id,''),'provider',o.order_source,'dealer_id',o.customer_dealer_id,'has_rmp',EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE order_id=o.id AND item_type=1),'version',sa_domain.version('order',o.id),'status',o.status,'warehouse_status',o.uc_status,'pending_change',EXISTS(SELECT FROM sa_domain.order_requests WHERE order_id=o.id AND generation=(SELECT generation FROM sa_domain.runtime_state) AND state IN('queued','running'))) FROM sa_snapshot_20261019.sa_orders o WHERE o.id=p_order AND o.deleted_at IS NULL AND o.is_deleted IS NOT TRUE);
END $f$;
ALTER FUNCTION sa_domain.warehouse_order_info(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_order_info(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_order_info(bigint) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_fanout() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE id_ bigint;cfg jsonb;
BEGIN
 IF NEW.event_type<>'orders.placed' THEN RETURN NEW;END IF;
 cfg:=sa_domain.warehouse_configuration();IF NOT coalesce((cfg->>'ready')::boolean,false) THEN RETURN NEW;END IF;
 FOR id_ IN SELECT value::bigint FROM jsonb_array_elements_text(NEW.payload->'order_ids') LOOP
  INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(NEW.actor_id,'warehouse.order','order',id_,gen_random_uuid(),NEW.generation,jsonb_build_object('operation','submit','source_job',NEW.id));
 END LOOP;RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.warehouse_fanout() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_fanout() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER warehouse_order_fanout AFTER INSERT ON sa_domain.outbox FOR EACH ROW WHEN(NEW.event_type='orders.placed') EXECUTE FUNCTION sa_domain.warehouse_fanout();

CREATE FUNCTION sa_domain.warehouse_reconcile_page(p_phase text,p_cursor bigint,p_ceiling bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT CASE p_phase WHEN 'orders' THEN(SELECT jsonb_build_object('ceiling',coalesce(p_ceiling,(SELECT max(id) FROM sa_snapshot_20261019.sa_orders)), 'data',coalesce(jsonb_agg(jsonb_build_object('id',id::text) ORDER BY id),'[]')) FROM(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE id>p_cursor AND(p_ceiling IS NULL OR id<=p_ceiling) AND deleted_at IS NULL AND is_deleted IS NOT TRUE AND nullif(uc_order_id,'') IS NOT NULL ORDER BY id LIMIT 50)x)
 ELSE(SELECT jsonb_build_object('ceiling',coalesce(p_ceiling,(SELECT max(id) FROM sa_snapshot_20261019.sa_rmp_skus)),'data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'code',name) ORDER BY id),'[]')) FROM(SELECT id,name FROM sa_snapshot_20261019.sa_rmp_skus WHERE id>p_cursor AND(p_ceiling IS NULL OR id<=p_ceiling) AND is_deleted IS NOT TRUE ORDER BY id LIMIT 100)x) END
$f$;
ALTER FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_reconcile_page(text,bigint,bigint) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_job_settle(p_job sa_domain.outbox,p_result jsonb,p_error text DEFAULT NULL,p_retry boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE state_ text:=CASE WHEN p_error IS NULL THEN 'done' WHEN p_retry AND p_job.attempts<5 THEN 'pending' ELSE 'dead' END;
BEGIN
 UPDATE sa_domain.job_attempts SET state=CASE WHEN p_error IS NULL THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=p_error WHERE lease_token=p_job.lease_token;
 UPDATE sa_domain.outbox SET status=state_,result=p_result,last_error_code=p_error,lease_until=NULL,lease_token=CASE WHEN state_='pending' THEN NULL ELSE lease_token END,available_at=now()+make_interval(secs=>least(300,power(2,p_job.attempts)::integer*5)),completed_at=CASE WHEN state_<>'pending' THEN now() END,revision=revision+1 WHERE id=p_job.id;
 IF state_<>'pending' AND p_job.event_type<>'warehouse.reconcile' AND p_job.payload->>'reconciliation_id' IS NOT NULL THEN
  UPDATE sa_domain.warehouse_reconciliations SET processed=processed+1,changed=changed+CASE WHEN p_result->>'state'='applied' THEN 1 ELSE 0 END,errors=errors+CASE WHEN p_error IS NULL THEN 0 ELSE 1 END WHERE id=(p_job.payload->>'reconciliation_id')::uuid;
  IF NOT EXISTS(SELECT FROM sa_domain.outbox WHERE payload->>'reconciliation_id'=p_job.payload->>'reconciliation_id' AND event_type IN('warehouse.order_reconcile','warehouse.inventory','warehouse.reconcile') AND status IN('pending','leased')) THEN UPDATE sa_domain.warehouse_reconciliations SET state=CASE WHEN errors>0 THEN 'failed' ELSE 'completed' END,completed_at=now() WHERE id=(p_job.payload->>'reconciliation_id')::uuid AND enumeration_done;END IF;
 ELSIF state_='dead' AND p_job.event_type='warehouse.reconcile' THEN UPDATE sa_domain.warehouse_reconciliations SET state='failed',completed_at=now(),errors=errors+1 WHERE id=(p_job.payload->>'reconciliation_id')::uuid;
 END IF;
 RETURN jsonb_build_object('state',state_,'result',p_result,'error_code',p_error);
END $f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_job_settle(sa_domain.outbox,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_job_settle(sa_domain.outbox,jsonb,text,boolean) TO sa_worker;

CREATE FUNCTION sa_domain.warehouse_reconcile_enumerate(p_job sa_domain.outbox,p_cfg jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.warehouse_reconciliations;page_ jsonb;row_ jsonb;job_ uuid;facility_ text;phase_ text;next_ bigint;done_ boolean;
BEGIN
 SELECT * INTO r FROM sa_domain.warehouse_reconciliations WHERE id=(p_job.payload->>'reconciliation_id')::uuid FOR UPDATE;
 IF r.id IS NULL OR r.generation<>p_job.generation OR r.actor_id<>p_job.actor_id OR r.provider<>p_cfg->>'provider' THEN RAISE EXCEPTION 'Reconciliation unavailable' USING ERRCODE='40001';END IF;
 IF r.enumeration_done THEN RETURN sa_domain.warehouse_job_settle(p_job,jsonb_build_object('enumerated',true));END IF;
 phase_:=CASE WHEN r.scope='inventory' THEN 'inventory' ELSE r.phase END;page_:=sa_domain.warehouse_reconcile_page(phase_,r.cursor_id,r.ceiling_id);
 IF phase_='orders' THEN
  FOR row_ IN SELECT value FROM jsonb_array_elements(page_->'data') LOOP
   INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(p_job.actor_id,'warehouse.order_reconcile','order',(row_->>'id')::bigint,gen_random_uuid(),p_job.generation,jsonb_build_object('operation','reconcile','reconciliation_id',r.id));
  END LOOP;
 ELSE
  IF jsonb_array_length(page_->'data')>0 THEN
   FOR facility_ IN SELECT DISTINCT x FROM unnest(ARRAY[p_cfg->>'one_day_facility',p_cfg->>'three_day_facility']) x LOOP
    INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(p_job.actor_id,'warehouse.inventory','integration',r.sequence_id,gen_random_uuid(),p_job.generation,jsonb_build_object('operation','inventory','facility',facility_,'skus',page_->'data','reconciliation_id',r.id));
   END LOOP;
  END IF;
 END IF;
 SELECT max((value->>'id')::bigint) INTO next_ FROM jsonb_array_elements(page_->'data');
 done_:=jsonb_array_length(page_->'data')<CASE WHEN phase_='orders' THEN 50 ELSE 100 END;
 IF done_ AND phase_='orders' AND r.scope='all' THEN phase_:='inventory';next_:=0;page_:=jsonb_set(page_,'{ceiling}','null');done_:=false;END IF;
 UPDATE sa_domain.warehouse_reconciliations SET phase=phase_,cursor_id=coalesce(next_,cursor_id),ceiling_id=(page_->>'ceiling')::bigint,enumeration_done=done_,state='running' WHERE id=r.id;
 IF done_ THEN
  IF NOT EXISTS(SELECT FROM sa_domain.outbox WHERE payload->>'reconciliation_id'=r.id::text AND id<>p_job.id AND status IN('pending','leased')) THEN UPDATE sa_domain.warehouse_reconciliations SET state=CASE WHEN errors>0 THEN 'failed' ELSE 'completed' END,completed_at=now() WHERE id=r.id;END IF;
  RETURN sa_domain.warehouse_job_settle(p_job,jsonb_build_object('enumerated',true));
 END IF;
 UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=p_job.lease_token;
 UPDATE sa_domain.outbox SET status='pending',attempts=0,lease_until=NULL,lease_token=NULL,available_at=now(),revision=revision+1 WHERE id=p_job.id;
 RETURN jsonb_build_object('state','pending');
END $f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_reconcile_enumerate(sa_domain.outbox,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_reconcile_enumerate(sa_domain.outbox,jsonb) TO sa_worker;

CREATE FUNCTION sa_domain.squad_warehouse_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;op sa_domain.warehouse_operations;g bigint;cfg jsonb;ctx jsonb;info_ jsonb;operation_ text;payload_ jsonb;code_ text;facility_ text;attempted_ boolean;error_ text;result_ jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type NOT IN('warehouse.order','warehouse.order_reconcile','warehouse.inventory','warehouse.reconcile') THEN RAISE EXCEPTION 'Warehouse lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Warehouse lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  IF NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Warehouse ownership inactive' USING ERRCODE='55000';END IF;
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  ctx:=sa_domain.ops_context();
  IF j.event_type IN('warehouse.inventory','warehouse.reconcile','warehouse.order_reconcile') AND NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Current integration administrator required' USING ERRCODE='42501';END IF;
  IF j.event_type='warehouse.reconcile' THEN result_:=sa_domain.warehouse_reconcile_enumerate(j,cfg);DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN result_;END IF;
  IF j.aggregate_kind='order' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('order:'||j.aggregate_id,784139));
   info_:=sa_domain.warehouse_order_info(j.aggregate_id);
   IF j.payload->>'operation'='submit' AND ((info_->>'pending_change')::boolean OR info_->>'warehouse_status'='CANCELLED' OR info_->>'status'='1') THEN RAISE EXCEPTION 'Order changed before warehouse dispatch' USING ERRCODE='55000';END IF;
   IF info_ IS NULL THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002';END IF;
   IF info_->>'dealer_id' IS NOT NULL OR NOT(info_->>'has_rmp')::boolean THEN result_:=sa_domain.warehouse_job_settle(j,jsonb_build_object('state','ignored','reason','NOT_WAREHOUSE_FULFILLED'));DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();RETURN result_;END IF;
   IF info_->>'provider' IS DISTINCT FROM cfg->>'provider' THEN RAISE EXCEPTION 'Order provider is not selected' USING ERRCODE='55000';END IF;
  END IF;
  SELECT * INTO op FROM sa_domain.warehouse_operations WHERE job_id=j.id FOR UPDATE;
  IF op.id IS NULL THEN
   operation_:=j.payload->>'operation';facility_:=coalesce(j.payload->>'facility',cfg->>'one_day_facility');
   IF facility_ NOT IN(cfg->>'one_day_facility',cfg->>'three_day_facility') THEN RAISE EXCEPTION 'Facility not configured' USING ERRCODE='22023';END IF;
   code_:=CASE cfg->>'environment' WHEN 'staging' THEN 'S-' ELSE 'P-' END||j.aggregate_id;
   IF operation_='submit' AND info_->>'external_id' IS NOT NULL THEN operation_:='reconcile';END IF;
   IF operation_='submit' THEN payload_:=sa_domain.warehouse_order_payload(j.aggregate_id,cfg->>'provider',facility_);
   ELSIF operation_='reconcile' THEN IF info_->>'external_id' IS NULL THEN RAISE EXCEPTION 'External order reference missing' USING ERRCODE='55000';END IF;payload_:='{}';IF cfg->>'provider'='unicommerce' THEN code_:=info_->>'external_id';END IF;
   ELSIF operation_='inventory' THEN
    IF jsonb_array_length(j.payload->'skus') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid inventory batch' USING ERRCODE='22023';END IF;
    SELECT jsonb_build_object('skus',jsonb_agg(value->>'code' ORDER BY(value->>'id')::bigint)) INTO payload_ FROM jsonb_array_elements(j.payload->'skus');
   ELSE RAISE EXCEPTION 'Warehouse operation unavailable' USING ERRCODE='55000';END IF;
   INSERT INTO sa_domain.warehouse_operations(job_id,generation,provider,operation,order_id,reconciliation_id,request_key,facility_code,external_id,external_code,payload)
   VALUES(j.id,g,cfg->>'provider',operation_,CASE WHEN j.aggregate_kind='order' THEN j.aggregate_id END,(j.payload->>'reconciliation_id')::uuid,'squad_'||replace(j.id::text,'-',''),facility_,info_->>'external_id',CASE WHEN j.aggregate_kind='order' THEN code_ END,payload_) RETURNING * INTO op;
  END IF;
  IF op.provider<>cfg->>'provider' OR op.generation<>g OR op.state NOT IN('ready','reconciliation_required') THEN RAISE EXCEPTION 'Warehouse intent unavailable' USING ERRCODE='55000';END IF;
  attempted_:=op.attempted;UPDATE sa_domain.warehouse_operations SET attempted=true,last_prepare_prior_attempted=attempted_,prepared_lease_token=j.lease_token,state='ready',updated_at=now() WHERE id=op.id;
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  RETURN jsonb_build_object('state','prepared','intent_id',op.id,'provider',op.provider,'operation',op.operation,'request_key',op.request_key,'project_ref',cfg->>'project_ref','environment',cfg->>'environment','facility_code',op.facility_code,'provider_order_id',op.external_id,'order_code',op.external_code,'payload',op.payload,'attempted',attempted_);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;
 END;
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN sa_domain.warehouse_job_settle(j,'{}',error_,false);
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_prepare(uuid,uuid) TO service_role;
CREATE FUNCTION canto_api.squad_warehouse_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_warehouse_prepare(p_id,p_lease_token) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_warehouse_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_warehouse_prepare(uuid,uuid) TO service_role;

CREATE FUNCTION sa_domain.squad_warehouse_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;op sa_domain.warehouse_operations;cfg jsonb;g bigint;code_ text;status_ text;r jsonb;row_ jsonb;sku_ jsonb;value_ numeric;error_ text;retry_ boolean;changed_ bigint:=0;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();cfg:=sa_domain.warehouse_configuration();
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Warehouse lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('state',j.status,'replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Warehouse lease expired' USING ERRCODE='40001';END IF;
 SELECT * INTO op FROM sa_domain.warehouse_operations WHERE job_id=j.id AND generation=g FOR UPDATE;
 IF op.id IS NULL OR NOT op.attempted OR op.prepared_lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Warehouse intent unavailable' USING ERRCODE='55000';END IF;
 PERFORM sa_domain.check_fields(p_result,ARRAY['code','error_code','external_id','external_code','status','customer_code','proof','inventory','retry_after_seconds']);
 IF p_result?'proof' AND jsonb_typeof(p_result->'proof') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid provider proof' USING ERRCODE='22023';END IF;
 code_:=p_result->>'code';IF code_ IS NULL OR code_ NOT IN('CONFIRMED','OBSERVED','RETRY','RECONCILIATION_REQUIRED','REJECTED') OR octet_length(p_result::text)>2097152 THEN RAISE EXCEPTION 'Invalid warehouse result' USING ERRCODE='22023';END IF;
 IF p_result?'error_code' AND(p_result->>'error_code')!~'^[A-Z0-9_]{1,80}$' THEN RAISE EXCEPTION 'Invalid warehouse error' USING ERRCODE='22023';END IF;
 IF code_ IN('RETRY','RECONCILIATION_REQUIRED','REJECTED') THEN
  error_:=coalesce(p_result->>'error_code',code_);retry_:=code_='RETRY';
  UPDATE sa_domain.warehouse_operations SET attempted=CASE WHEN retry_ AND op.provider='unicommerce' AND NOT op.last_prepare_prior_attempted AND p_result->'proof'->'mutation_attempted'='false'::jsonb THEN false ELSE attempted END,proof=coalesce(p_result->'proof','{}'),state=CASE WHEN retry_ THEN 'ready' WHEN code_='REJECTED' THEN 'rejected' ELSE 'reconciliation_required' END,result=jsonb_build_object('code',code_,'error_code',error_),updated_at=now() WHERE id=op.id;
  r:=sa_domain.warehouse_job_settle(j,jsonb_build_object('code',code_),error_,retry_);
 ELSE
  BEGIN
   IF op.provider<>cfg->>'provider' OR NOT coalesce((cfg->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Warehouse configuration changed' USING ERRCODE='55000';END IF;
   IF op.operation='inventory' THEN
    IF code_<>'CONFIRMED' OR jsonb_typeof(p_result->'inventory') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'inventory')<>jsonb_array_length(op.payload->'skus') OR p_result->'proof'->>'facility_code' IS DISTINCT FROM op.facility_code THEN RAISE EXCEPTION 'Inventory result mismatch' USING ERRCODE='22023';END IF;
    IF(SELECT count(DISTINCT value->>'sku_code') FROM jsonb_array_elements(p_result->'inventory'))<>jsonb_array_length(op.payload->'skus') THEN RAISE EXCEPTION 'Duplicate inventory result' USING ERRCODE='22023';END IF;
    FOR row_ IN SELECT value FROM jsonb_array_elements(p_result->'inventory') LOOP
     PERFORM sa_domain.check_fields(row_,ARRAY['sku_code','known','available']);
     SELECT value INTO sku_ FROM jsonb_array_elements(j.payload->'skus') WHERE value->>'code'=row_->>'sku_code';
     IF sku_ IS NULL OR jsonb_typeof(row_->'known') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Unexpected inventory identity' USING ERRCODE='22023';END IF;
     IF(row_->>'known')::boolean THEN
      IF jsonb_typeof(row_->'available') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid warehouse availability' USING ERRCODE='22023';END IF;
      value_:=sa_domain.input_number(row_->'available',-1000000000000,1000000000000);IF value_*100<>trunc(value_*100) THEN RAISE EXCEPTION 'Invalid availability precision' USING ERRCODE='22023';END IF;
      INSERT INTO sa_domain.warehouse_inventory(generation,provider,facility_code,sku_id,available,as_of) VALUES(g,op.provider,op.facility_code,(sku_->>'id')::bigint,value_,now()) ON CONFLICT(generation,provider,facility_code,sku_id) DO UPDATE SET available=excluded.available,as_of=excluded.as_of,invalidated_at=NULL;
      changed_:=changed_+1;
     ELSE
      IF row_->'available' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unknown stock cannot have a quantity' USING ERRCODE='22023';END IF;
      UPDATE sa_domain.warehouse_inventory SET invalidated_at=now() WHERE generation=g AND provider=op.provider AND facility_code=op.facility_code AND sku_id=(sku_->>'id')::bigint;
     END IF;
    END LOOP;r:=jsonb_build_object('state','applied','inventory_rows',changed_);
   ELSE
    IF op.operation NOT IN('submit','reconcile') OR(op.operation='submit' AND code_<>'CONFIRMED') OR(op.operation='reconcile' AND code_<>'OBSERVED') OR p_result->>'external_code' IS DISTINCT FROM op.external_code OR(op.external_id IS NOT NULL AND p_result->>'external_id' IS DISTINCT FROM op.external_id) THEN RAISE EXCEPTION 'Provider acknowledgment identity mismatch' USING ERRCODE='22023';END IF;
    IF op.provider='dashboard' AND op.operation='submit' AND(p_result->'proof'->>'request_key' IS DISTINCT FROM op.request_key OR p_result->'proof'->>'source' IS NULL OR p_result->'proof'->>'source' NOT IN('durable_mutation_result','atomic_mutation_response')) THEN RAISE EXCEPTION 'Durable mutation proof required' USING ERRCODE='22023';END IF;
    status_:=CASE p_result->>'status' WHEN 'CREATED' THEN 'PENDING' WHEN 'PENDING_VERIFICATION' THEN 'PENDING' ELSE p_result->>'status' END;
    INSERT INTO sa_domain.integration_context VALUES(pg_backend_pid(),txid_current(),j.id,j.lease_token,op.order_id,g);
    r:=sa_domain.warehouse_status_apply(op.order_id,op.provider,p_result->>'external_id',op.external_code,status_,now(),'intent_'||op.id);
    DELETE FROM sa_domain.integration_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
    changed_:=CASE WHEN r->>'state'='applied' THEN 1 ELSE 0 END;
   END IF;
   UPDATE sa_domain.warehouse_operations SET state=CASE WHEN r->>'state'='quarantined' THEN 'reconciliation_required' ELSE 'confirmed' END,proof=coalesce(p_result->'proof','{}'),result=r,updated_at=now() WHERE id=op.id;
   IF r->>'state'='quarantined' THEN error_:=r->>'reason';END IF;
   INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation) VALUES(j.actor_id,NULL,'warehouse.result',j.aggregate_kind,j.aggregate_id,j.command_key,jsonb_build_object('provider',op.provider,'operation',op.operation,'result',r),g);
   IF changed_>0 AND op.operation<>'inventory' THEN UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;IF error_ IN('40P01','55P03','57014','53300') THEN RAISE;END IF;
   UPDATE sa_domain.warehouse_operations SET state='reconciliation_required',proof=coalesce(p_result->'proof','{}'),result=jsonb_build_object('code','RECONCILIATION_REQUIRED','error_code',error_,'external_id',p_result->>'external_id','external_code',p_result->>'external_code'),updated_at=now() WHERE id=op.id;
  END;
  DELETE FROM sa_domain.integration_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  r:=sa_domain.warehouse_job_settle(j,coalesce(r,'{}'),error_,false);
 END IF;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) TO service_role;
CREATE FUNCTION canto_api.squad_warehouse_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_warehouse_finish(p_id,p_lease_token,p_result) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_warehouse_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_warehouse_finish(uuid,uuid,jsonb) TO service_role;

DO $f$ DECLARE d text;s text;BEGIN
 SELECT pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure) INTO d;d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event IN('warehouse.order','warehouse.order_reconcile','warehouse.inventory','warehouse.reconcile') THEN 'warehouse' WHEN$s$);EXECUTE d;
 FOREACH s IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP SELECT pg_get_functiondef(s::regprocedure) INTO d;d:=replace(d,'''warehouse_webhook''','''warehouse_webhook'',''warehouse''');EXECUTE d;END LOOP;
END $f$;
-- Prepared external mutations hold their order shape until their result is
-- known. The transaction uses the same advisory lock as all order commands.
CREATE FUNCTION sa_domain.assert_warehouse_idle(p_order bigint) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF EXISTS(SELECT FROM sa_domain.warehouse_operations WHERE order_id=p_order AND generation=(SELECT generation FROM sa_domain.runtime_state) AND attempted AND operation IN('submit','amend','cancel') AND state IN('ready','reconciliation_required')) THEN RAISE EXCEPTION 'Resolve the pending warehouse operation before changing this order' USING ERRCODE='55000';END IF;
END $f$;
ALTER FUNCTION sa_domain.assert_warehouse_idle(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.assert_warehouse_idle(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.assert_warehouse_idle(bigint) TO sa_executor,sa_guard,sa_integrator;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.lock_order(bigint,boolean)'::regprocedure);
 d:=replace(d,' IF p_open AND (o.status=1', ' IF p_open THEN PERFORM sa_domain.assert_warehouse_idle(p_id);END IF;'||chr(10)||' IF p_open AND (o.status=1');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.assert_order_amendable(bigint)'::regprocedure);
 d:=replace(d,'BEGIN','BEGIN'||chr(10)||' PERFORM sa_domain.assert_warehouse_idle(p_id);');EXECUTE d;
END $f$;

-- Emit business notifications only when provider status actually changes.
-- The status core retains the only stock-receipt/progress implementation.
GRANT INSERT ON sa_domain.outbox TO sa_integrator;
GRANT EXECUTE ON FUNCTION sa_domain.job_handler(text,jsonb) TO sa_integrator;
CREATE POLICY integration_status_event ON sa_domain.outbox FOR INSERT TO sa_integrator WITH CHECK(event_type='warehouse.status_changed' AND aggregate_kind='order' AND aggregate_id=(SELECT sa_domain.integration_order_id()));
GRANT USAGE ON SEQUENCE sa_domain.outbox_sequence_id_seq TO sa_integrator;
GRANT SELECT ON sa_domain.integration_context,sa_domain.outbox TO sa_integrator;
CREATE POLICY integration_context_self ON sa_domain.integration_context FOR SELECT TO sa_integrator USING(backend_pid=pg_backend_pid() AND transaction_id=txid_current());
CREATE POLICY integration_job_self ON sa_domain.outbox FOR SELECT TO sa_integrator USING(id IN(SELECT job_id FROM sa_domain.integration_context));
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text)'::regprocedure);
 d:=replace(d,$s$ RETURN jsonb_build_object('state','applied','status',p_status,$s$,$s$
 IF old_ IS DISTINCT FROM p_status THEN
  INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  SELECT j.actor_id,'warehouse.status_changed','order',p_order,gen_random_uuid(),j.generation,jsonb_build_object('order_id',p_order::text,'previous_status',old_,'status',p_status,'provider',p_provider)
  FROM sa_domain.integration_context c JOIN sa_domain.outbox j ON j.id=c.job_id WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current();
 END IF;
 RETURN jsonb_build_object('state','applied','status',p_status,$s$);EXECUTE d;
END $f$;

CREATE FUNCTION sa_domain.warehouse_availability(p_ids bigint[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 WITH cfg AS MATERIALIZED(SELECT sa_domain.warehouse_configuration() v), rows AS(
 SELECT id,one_.available one_qty,three_.available three_qty,one_.as_of one_at,three_.as_of three_at,
 coalesce(one_.invalidated_at IS NULL AND one_.as_of>now()-interval '5 minutes',false) one_fresh,
 coalesce(three_.invalidated_at IS NULL AND three_.as_of>now()-interval '5 minutes',false) three_fresh
 FROM unnest(p_ids) id CROSS JOIN cfg
 LEFT JOIN sa_domain.warehouse_inventory one_ ON one_.generation=(cfg.v->>'generation')::bigint AND one_.provider=cfg.v->>'selected_provider' AND one_.facility_code=cfg.v->>'one_day_facility' AND one_.sku_id=id
 LEFT JOIN sa_domain.warehouse_inventory three_ ON three_.generation=(cfg.v->>'generation')::bigint AND three_.provider=cfg.v->>'selected_provider' AND three_.facility_code=cfg.v->>'three_day_facility' AND three_.sku_id=id)
 SELECT coalesce(jsonb_object_agg(id::text,jsonb_build_object('status',CASE WHEN one_at IS NULL AND three_at IS NULL THEN 'not_loaded' WHEN one_fresh AND three_fresh THEN 'ready' WHEN one_fresh OR three_fresh THEN 'partial' ELSE 'stale' END,'one_day',CASE WHEN one_fresh THEN one_qty END,'three_day',CASE WHEN three_fresh THEN three_qty END,'as_of',least(one_at,three_at))),'{}') FROM rows
$f$;
ALTER FUNCTION sa_domain.warehouse_availability(bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_availability(bigint[]) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_availability(bigint[]) TO sa_executor;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_rmp_variants(bigint,bigint,jsonb,text,integer)'::regprocedure);
 d:=replace(d,'prices_ jsonb;', 'prices_ jsonb;availability_ jsonb;');
 d:=replace(d,' prices_:=sa_domain.sku_prices_batch(', ' availability_:=sa_domain.warehouse_availability(ARRAY(SELECT (x->>''id'')::bigint FROM jsonb_array_elements(page_) x));'||chr(10)||' prices_:=sa_domain.sku_prices_batch(');
 d:=replace(d,$s$jsonb_build_object('status','not_loaded','one_day',NULL,'three_day',NULL,'as_of',NULL)$s$,$s$availability_->(p.value->>'id')$s$);EXECUTE d;
END $f$;
GRANT CREATE ON SCHEMA sa_domain TO sa_media_writer;
CREATE FUNCTION sa_domain.v1_integration_get(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();r sa_domain.warehouse_reconciliations;g bigint;counts_ jsonb;state_ text;
BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Integration administrator required' USING ERRCODE='42501';END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 SELECT * INTO r FROM sa_domain.warehouse_reconciliations WHERE id=p_id AND actor_id=(ctx->>'auth_id')::uuid;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Reconciliation unavailable' USING ERRCODE='P0002';END IF;
 counts_:=sa_domain.warehouse_reconcile_counts(r.id);
 state_:=CASE WHEN r.generation<>g THEN 'expired' WHEN r.state='failed' THEN 'failed' WHEN r.enumeration_done AND(counts_->>'pending')::bigint=0 THEN CASE WHEN(counts_->>'errors')::bigint>0 THEN 'failed' ELSE 'completed' END ELSE r.state END;
 RETURN jsonb_build_object('id',r.id,'job_id',r.job_id,'provider',r.provider,'scope',r.scope,'generation',r.generation::text,'state',state_,'enumeration_done',r.enumeration_done,'processed',counts_->'processed','total',counts_->'total','errors',counts_->'errors','pending',counts_->'pending','changed',r.changed,'created_at',r.created_at,'completed_at',r.completed_at);
END $f$;
CREATE FUNCTION sa_domain.warehouse_reconcile_counts(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('processed',count(*) FILTER(WHERE status IN('done','dead')),'pending',count(*) FILTER(WHERE status IN('pending','leased')),'errors',count(*) FILTER(WHERE status='dead'),'total',count(*)) FROM sa_domain.outbox WHERE payload->>'reconciliation_id'=p_id::text AND event_type IN('warehouse.order_reconcile','warehouse.inventory')
$f$;
ALTER FUNCTION sa_domain.warehouse_reconcile_counts(uuid) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_reconcile_counts(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_reconcile_counts(uuid) TO sa_media_writer;
ALTER FUNCTION sa_domain.v1_integration_get(uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_integration_get(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_integration_get(uuid) TO sa_app,authenticated;
CREATE FUNCTION canto_api.v1_integration_get(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_integration_get(p_id) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_integration_get(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_integration_get(uuid) TO sa_app,authenticated;
CREATE FUNCTION sa_domain.settle_warehouse_reconciliations() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.warehouse_reconciliations;stats_ jsonb;g bigint;parent_dead boolean;
BEGIN
 SELECT generation INTO g FROM sa_domain.runtime_state;
 FOR r IN SELECT * FROM sa_domain.warehouse_reconciliations WHERE state IN('queued','running') ORDER BY sequence_id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  IF r.generation<>g THEN UPDATE sa_domain.warehouse_reconciliations SET state='expired',completed_at=now() WHERE id=r.id;CONTINUE;END IF;
  SELECT status='dead' INTO parent_dead FROM sa_domain.outbox WHERE id=r.job_id;
  stats_:=sa_domain.warehouse_reconcile_counts(r.id);
  IF parent_dead OR(r.enumeration_done AND(stats_->>'pending')::bigint=0) THEN
   UPDATE sa_domain.warehouse_reconciliations SET processed=(stats_->>'processed')::bigint,errors=(stats_->>'errors')::bigint+CASE WHEN parent_dead THEN 1 ELSE 0 END,state=CASE WHEN parent_dead OR(stats_->>'errors')::bigint>0 THEN 'failed' ELSE 'completed' END,completed_at=now() WHERE id=r.id;
  END IF;
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.settle_warehouse_reconciliations() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.settle_warehouse_reconciliations(),sa_domain.warehouse_reconcile_counts(uuid) TO sa_worker;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 d:=replace(d,' PERFORM sa_domain.settle_account_failures();',' PERFORM sa_domain.settle_account_failures();'||chr(10)||' PERFORM sa_domain.settle_warehouse_reconciliations();');EXECUTE d;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_media_writer;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker,sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
