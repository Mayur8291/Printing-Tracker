BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Dynamic legacy dispatch was not visible to numeric-callsite extraction.
CREATE FUNCTION sa_domain.notification_edit_types(p_type integer,p_role integer,p_actor bigint,p_sc bigint,p_dealer bigint,p_customer_role integer) RETURNS integer[]
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN p_type IN(0,2) THEN CASE
 WHEN p_role=3 AND p_dealer IS NULL THEN ARRAY[78,79,80]
 WHEN p_role=10 AND p_dealer IS NULL THEN ARRAY[81,82,83]
 WHEN p_role=3 AND p_dealer IS NOT NULL THEN ARRAY[84,85]
 WHEN p_sc=p_actor AND p_customer_role=3 THEN ARRAY[86,87]
 WHEN p_sc=p_actor AND p_customer_role=10 THEN ARRAY[88] ELSE '{}'::integer[] END
 WHEN p_type=1 THEN CASE
 WHEN p_role IN(3,10) AND p_dealer IS NULL THEN ARRAY[89,90,91]
 WHEN p_role=10 AND p_dealer IS NOT NULL THEN ARRAY[92,93]
 WHEN p_sc=p_actor THEN ARRAY[94,95,96] ELSE '{}'::integer[] END ELSE '{}'::integer[] END
$f$;
ALTER FUNCTION sa_domain.notification_edit_types(integer,integer,bigint,bigint,bigint,integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.notification_edit_types(integer,integer,bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
-- Compare prices only for retained product/ready-made identities. Adding a new
-- product or changing quantity alone is not an edit to an old line's unit price.
CREATE FUNCTION sa_domain.amendment_prices_changed(p_before jsonb,p_order_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i WHERE i.order_id=p_order_id
 AND EXISTS(SELECT FROM jsonb_array_elements(p_before->'items') old WHERE(old->>'item_type')::integer=i.item_type
 AND(old->>'product_id')::bigint IS NOT DISTINCT FROM i.product_id AND(old->>'rmp_class_id')::bigint IS NOT DISTINCT FROM i.rmp_class_id
 AND(old->>'rmp_brand_id')::bigint IS NOT DISTINCT FROM i.rmp_brand_id AND(old->>'rmp_category_id')::bigint IS NOT DISTINCT FROM i.rmp_category_id)
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_before->'items') old WHERE(old->>'item_type')::integer=i.item_type
 AND(old->>'product_id')::bigint IS NOT DISTINCT FROM i.product_id AND(old->>'rmp_class_id')::bigint IS NOT DISTINCT FROM i.rmp_class_id
 AND(old->>'rmp_brand_id')::bigint IS NOT DISTINCT FROM i.rmp_brand_id AND(old->>'rmp_category_id')::bigint IS NOT DISTINCT FROM i.rmp_category_id
 AND(old->>'per_piece_amount')::numeric IS NOT DISTINCT FROM i.per_piece_amount))
$f$;
ALTER FUNCTION sa_domain.amendment_prices_changed(jsonb,bigint) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.amendment_prices_changed(jsonb,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE OR REPLACE FUNCTION sa_domain.notification_plan(p_event text, p_kind text, p_id bigint, p_actor uuid, p_changes jsonb)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor_ sa_snapshot_20261019.sa_users;o sa_snapshot_20261019.sa_orders;i sa_snapshot_20261019.sa_items;t sa_snapshot_20261019.sa_tasks;
 ids bigint[];id_ bigint;types_ integer[];topic_ text;audience_ jsonb;r record;recipient_ bigint;role_ integer;kind_ text;removed_ boolean;members_ jsonb;coordinator_ bigint;
BEGIN
 SELECT u.id,u.role INTO actor_.id,actor_.role FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id WHERE m.auth_user_id=p_actor;
 IF p_event='task.saved' OR p_event='task.transitioned' THEN
  SELECT id,created_by_id INTO t.id,t.created_by_id FROM sa_snapshot_20261019.sa_tasks WHERE id=p_id;IF t.id IS NULL THEN RETURN;END IF;
  SELECT coalesce(jsonb_agg(user_id),'[]') INTO members_ FROM sa_snapshot_20261019.sa_task_users WHERE task_id=t.id;
  IF jsonb_array_length(members_)>50 THEN RAISE EXCEPTION 'Task recipient bound exceeded' USING ERRCODE='54000';END IF;
  FOR topic_,members_,removed_ IN SELECT 'task.assigned',coalesce(p_changes->'assignees_added','[]'),false
    UNION ALL SELECT 'task.removed',coalesce(p_changes->'assignees_removed','[]'),true
    UNION ALL SELECT 'task.changed',members_||jsonb_build_array(t.created_by_id),false
     WHERE p_event='task.transitioned' OR p_changes->>'content_changed'='true'
  LOOP
   IF jsonb_array_length(members_)=0 THEN CONTINUE;END IF;
   SELECT jsonb_build_array(jsonb_build_object('role',0))||coalesce(jsonb_agg(jsonb_build_object('id',x::bigint)),'[]') INTO audience_ FROM jsonb_array_elements_text(members_) x WHERE x::bigint<>coalesce(actor_.id,0);
   RETURN NEXT jsonb_build_object('topic',topic_,'kind','task','id',t.id::text,'audience',audience_,'exclude_actor',CASE WHEN topic_='task.changed' THEN actor_.id END,'removed',removed_,'types','[]'::jsonb);
  END LOOP;RETURN;
 ELSIF p_event='rating.saved' THEN
  IF p_changes->>'score_changed' IS DISTINCT FROM 'true' THEN RETURN;END IF;
  RETURN NEXT jsonb_build_object('topic','rating.changed','kind','rating','id',p_id::text,'types','[]'::jsonb,
    'audience',jsonb_build_array(jsonb_build_object('role',0),jsonb_build_object('id',p_changes->>'recipient_id')));RETURN;
 ELSIF p_event='account.registration_completed' THEN ids:=ARRAY[p_id];
 ELSIF p_event='person.saved' AND p_changes->>'created'='true' THEN ids:=ARRAY[p_id];
 ELSIF p_event='customer.links_saved' THEN ids:=ARRAY[p_id];
 ELSIF p_event='customers.coordinator_changed' THEN SELECT array_agg((x->>'id')::bigint) INTO ids FROM jsonb_array_elements(coalesce(p_changes->'people','[]')) x;
 ELSIF p_event='customer.coordinator_decided' AND p_changes->>'decision'='approved' THEN ids:=ARRAY[(p_changes->>'customer_id')::bigint];
 ELSIF p_event IN('orders.placed','backorder.placed') THEN SELECT array_agg(x::bigint) INTO ids FROM jsonb_array_elements_text(coalesce(p_changes->'order_ids',jsonb_build_array(p_id::text))) x;
 ELSIF p_kind='item' THEN
  SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;ids:=ARRAY[i.order_id];
 ELSIF p_kind='order' THEN ids:=ARRAY[p_id];
 ELSE RETURN;END IF;
 IF cardinality(ids)>100 THEN RAISE EXCEPTION 'Notification event bound exceeded' USING ERRCODE='54000';END IF;
 FOREACH id_ IN ARRAY coalesce(ids,'{}') LOOP
  types_:='{}';kind_:='order';
  IF p_event IN('account.registration_completed','person.saved','customer.links_saved','customers.coordinator_changed','customer.coordinator_decided') THEN
   kind_:='person';SELECT created_by_id INTO coordinator_ FROM sa_snapshot_20261019.sa_users WHERE id=id_ AND role=3;
   types_:=CASE WHEN p_event='account.registration_completed' THEN ARRAY[1] WHEN coordinator_ IS NOT NULL THEN ARRAY[2] ELSE '{}'::integer[] END;
  ELSE
   SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=id_;IF o.id IS NULL THEN CONTINUE;END IF;
   CASE p_event
    WHEN 'orders.placed','backorder.placed' THEN
     -- Mixed orders use the custom route; newly accepted orders split families.
     types_:=CASE WHEN o.order_item_type=0 THEN CASE actor_.role WHEN 3 THEN CASE WHEN o.customer_dealer_id IS NULL THEN ARRAY[3,4] ELSE ARRAY[3,106] END WHEN 10 THEN ARRAY[5,6] WHEN 1 THEN CASE WHEN o.customer_dealer_id IS NULL THEN ARRAY[9,10] ELSE ARRAY[11,12] END ELSE '{}'::integer[] END
      ELSE CASE actor_.role WHEN 3 THEN CASE WHEN o.customer_dealer_id IS NULL THEN ARRAY[14,15,107,108] ELSE ARRAY[116,117] END WHEN 10 THEN CASE WHEN o.customer_dealer_id IS NULL THEN ARRAY[7,8] ELSE ARRAY[113,114] END WHEN 1 THEN CASE WHEN o.customer_dealer_id IS NULL THEN ARRAY[109,110,111,112] ELSE ARRAY[11,12] END ELSE '{}'::integer[] END END;
    WHEN 'order.due_changed' THEN types_:=ARRAY[26,27,28];
    WHEN 'order.factory_assigned' THEN types_:=ARRAY[29,30,31,32];
    WHEN 'item.cutter_assigned' THEN types_:=ARRAY[33,34,35,36];
    WHEN 'item.cut' THEN types_:=CASE WHEN o.cutting_status=1 THEN ARRAY[41,42,43,44] ELSE ARRAY[37,38,39,40] END;
    WHEN 'item.work_assigned' THEN types_:=ARRAY[45,46,47,48];
    WHEN 'item.inspected' THEN types_:=CASE WHEN i.completed_by_tailor_quantity_status=1 THEN ARRAY[53,54,55,56,57] ELSE ARRAY[49,50,51,52] END;
    WHEN 'item.dispatched' THEN types_:=ARRAY[58,59,60];
    WHEN 'order.worker_assigned' THEN types_:=ARRAY[61,62,63,64];
    WHEN 'item.worker_cost_changed' THEN types_:=ARRAY[65,66];
    WHEN 'item.worker_stage_changed' THEN types_:=CASE (p_changes->>'after')::integer WHEN 0 THEN ARRAY[67,68] WHEN 1 THEN ARRAY[69,70] WHEN 3 THEN ARRAY[71,72,73] ELSE '{}'::integer[] END;
    WHEN 'order.amendment_applied','order.edited' THEN IF p_event='order.amendment_applied' OR p_changes->>'request_id' IS NULL THEN types_:=sa_domain.notification_edit_types(o.order_item_type,actor_.role,actor_.id,o.customer_sc_id,o.customer_dealer_id,(SELECT role FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_id));END IF;
    WHEN 'order.cancellation_requested' THEN IF p_changes->>'provider_confirmation_required'='false' THEN types_:=CASE WHEN actor_.role=10 THEN ARRAY[104,105] WHEN o.order_item_type=0 THEN ARRAY[18,19] ELSE ARRAY[100,101,102,103] END;END IF;
    WHEN 'order.provider_processing' THEN types_:=ARRAY[16,17];
    WHEN 'order.provider_cancelled' THEN types_:=CASE WHEN o.order_item_type=0 THEN ARRAY[18,19] ELSE ARRAY[100,101,102,103] END;
    WHEN 'order.pickup_partial' THEN types_:=ARRAY[20,21];
    WHEN 'order.dealer_ready' THEN types_:=ARRAY[24];
    WHEN 'order.completed','order.force_completed' THEN types_:=ARRAY[22,23];
    WHEN 'order.price_changed' THEN types_:=CASE WHEN o.order_item_type=0 THEN ARRAY[97,98,99] ELSE ARRAY[74,75,76,77] END;
    ELSE NULL;
   END CASE;
   IF p_event IN('item.dispatched','item.worker_stage_changed') AND o.status=1 THEN types_:=types_||ARRAY[22,23];END IF;
   IF p_event IN('orders.placed','backorder.placed','order.amendment_applied') OR(p_event='order.edited' AND p_changes->>'request_id' IS NULL) THEN
    IF p_changes->>'price_changed'='true' OR(p_event IN('orders.placed','backorder.placed') AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE order_id=o.id AND calculated_per_piece_amount>0 AND per_piece_amount<>calculated_per_piece_amount)) THEN
     types_:=types_||CASE WHEN o.order_item_type=0 THEN ARRAY[97,99] ELSE ARRAY[74,75,76,77] END;
    END IF;
   END IF;
  END IF;
  FOR topic_ IN SELECT DISTINCT topic FROM sa_domain.notification_rules WHERE legacy_type=ANY(types_) LOOP
   audience_:='[]';
   FOR r IN SELECT legacy_type,unnest(recipients) resolver FROM sa_domain.notification_rules WHERE legacy_type=ANY(types_) AND topic=topic_ LOOP
    recipient_:=NULL;role_:=NULL;
    CASE r.resolver WHEN 'admin' THEN role_:=0;WHEN 'production_coordinator' THEN role_:=2;
     WHEN 'customer' THEN recipient_:=o.customer_id;WHEN 'dealer' THEN recipient_:=o.customer_dealer_id;
     WHEN 'sales_coordinator' THEN recipient_:=CASE WHEN kind_='person' THEN coordinator_ ELSE o.customer_sc_id END;role_:=1;
     WHEN 'factory_manager' THEN recipient_:=o.assigned_to_id;role_:=4;
     WHEN 'cutting_master' THEN recipient_:=i.cutting_master_id;role_:=9;
     WHEN 'jobworker' THEN recipient_:=o.assigned_worker_id;role_:=11;
     WHEN 'inspectors' THEN role_:=8;
     WHEN 'actor' THEN recipient_:=actor_.id;
     WHEN 'customer_when_actor_customer' THEN IF actor_.role=3 THEN recipient_:=o.customer_id;END IF;
     WHEN 'dealer_when_actor_dealer' THEN IF actor_.role=10 THEN recipient_:=o.customer_dealer_id;END IF;
     ELSE RAISE EXCEPTION 'Unknown notification resolver' USING ERRCODE='55000';
    END CASE;
    IF recipient_ IS NOT NULL OR r.resolver IN('admin','production_coordinator') OR(r.resolver='inspectors' AND o.assigned_to_id IS NOT NULL) THEN
     audience_:=audience_||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('type',r.legacy_type,'id',recipient_,'role',role_,'manager',CASE WHEN r.resolver='inspectors' THEN o.assigned_to_id END)));
    END IF;
   END LOOP;
   IF jsonb_array_length(audience_)>0 THEN RETURN NEXT jsonb_build_object('topic',topic_,'kind',kind_,'id',id_::text,'types',to_jsonb(types_),'audience',audience_);END IF;
  END LOOP;
 END LOOP;
END $function$
;
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
 RETURN jsonb_build_object('price_changed',sa_domain.amendment_prices_changed(before_,p_id),'id',p_id::text,'version',p_spec->>'version','state','applied','amendment_id',amendment_,'items',items_,'total_amount',group_->>'total','paid_amount',paid_::text,'original_identity_and_dates_preserved',true);
END $function$
;
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
 RETURN sa_domain.finish_command('order.edited',p_idempotency_key,'order',p_id,result_,jsonb_build_object('reason',reason_,'request_id',request_,'old_total',o.total_amount::text,'new_total',group_->>'total','provider_confirmation_required',provider_,'price_changed',result_->'price_changed'));
END $function$
;
CREATE OR REPLACE FUNCTION sa_domain.execute_local_amendment(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1]);r sa_domain.order_requests%ROWTYPE;cached jsonb;result_ jsonb;v text;
BEGIN
 cached:=sa_domain.begin_command('order.amendment_applied',p_request_id,jsonb_build_object('request_id',p_request_id));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO r FROM sa_domain.order_requests WHERE id=p_request_id FOR UPDATE;
 IF r.id IS NULL OR r.actor_id<>a.auth_id OR r.generation<>(SELECT generation FROM sa_domain.runtime_state) THEN RAISE EXCEPTION 'Amendment request not available' USING ERRCODE='P0002';END IF;
 IF r.kind<>'edit' OR r.state NOT IN('queued','running') OR coalesce((r.spec->>'provider_confirmation_required')::boolean,true) THEN RAISE EXCEPTION 'Amendment is not ready for local execution' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('order',r.order_id,r.spec->>'version');
 result_:=sa_domain.apply_order_amendment(r.order_id,r.spec||jsonb_build_object('version',v),r.command_key);
 UPDATE sa_domain.order_requests SET state='succeeded',result=result_,updated_at=now() WHERE id=p_request_id;
 RETURN sa_domain.finish_command('order.amendment_applied',p_request_id,'order',r.order_id,result_,jsonb_build_object('request_id',p_request_id,'reason',r.spec->>'reason','price_changed',result_->'price_changed'));
END $function$
;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
COMMIT;
