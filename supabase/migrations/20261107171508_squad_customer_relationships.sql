BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
GRANT UPDATE(customer_sc_id,customer_dealer_id) ON sa_snapshot_20261019.sa_orders TO sa_executor;
-- Stale imported dealer links cannot grant access to a direct customer or to a
-- person who has since become a dealer/staff member.
CREATE OR REPLACE FUNCTION sa_domain.dealer_customer_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT d.user_id FROM sa_snapshot_20261019.sa_user_dealers d JOIN sa_snapshot_20261019.sa_users u ON u.id=d.user_id
 WHERE d.dealer_id=(SELECT (sa_domain.actor()).user_id) AND u.role=3 AND u.is_direct_deal IS NOT TRUE AND u.deleted_at IS NULL
$f$;
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.can_person(bigint)'::regprocedure);
 definition_:=replace(definition_,'a.role_id=10 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.user_id=target.id AND d.dealer_id=a.user_id)',
 'a.role_id=10 AND target.role=3 AND target.is_direct_deal IS NOT TRUE AND target.id IN(SELECT sa_domain.dealer_customer_ids())');
 EXECUTE definition_;
END $f$;
CREATE FUNCTION sa_domain.assert_customer_pending_scope(p_id bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1]);
BEGIN
 IF NOT sa_domain.can_manage_person(p_id) THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
 IF a.role_id=1 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_id=p_id AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL AND customer_sc_id IS DISTINCT FROM a.user_id) THEN
 RAISE EXCEPTION 'Pending-order attribution differs from this customer; Admin must reconcile the coordinator first' USING ERRCODE='55000';END IF;
END $f$;
ALTER FUNCTION sa_domain.assert_customer_pending_scope(bigint) OWNER TO sa_guard;

-- Imported parent counters can lag their quantity/history rows. A zero rollup
-- cannot authorize routing/cancellation when underlying work already exists.
CREATE OR REPLACE FUNCTION sa_domain.order_has_work(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 WITH items AS MATERIALIZED(SELECT id,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity,job_worker_status FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id)
 SELECT EXISTS(SELECT FROM items WHERE cutting_done<>0 OR assigned_to_tailor_quantity<>0 OR completed_by_tailor_quantity<>0 OR dispatched_quantity<>0 OR job_worker_status>0)
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_quantities WHERE item_id IN(SELECT id FROM items) AND(cutting_done<>0 OR assigned_to_tailor_quantity<>0 OR completed_by_tailor_quantity<>0 OR dispatched_quantity<>0))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id IN(SELECT id FROM items))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_assign_dates WHERE item_id IN(SELECT id FROM items))
 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id IN(SELECT id FROM items))
$f$;

-- Preserve the existing non-admin predicate; avoid a per-row actor lookup in
-- bounded Admin bulk reassignments. The executor remains subject to RLS.
ALTER POLICY squad_orders_update ON sa_snapshot_20261019.sa_orders USING(CASE WHEN(SELECT (sa_domain.actor()).role_id)=0 THEN true ELSE sa_domain.can_order(id) END)
 WITH CHECK(CASE WHEN(SELECT (sa_domain.actor()).role_id)=0 THEN true ELSE sa_domain.can_order(id) END);
ALTER POLICY squad_people_write ON sa_snapshot_20261019.sa_users USING(CASE WHEN(SELECT (sa_domain.actor()).role_id)=0 THEN true ELSE sa_domain.can_manage_person(id) END)
 WITH CHECK(CASE WHEN(SELECT (sa_domain.actor()).role_id)=0 THEN true ELSE sa_domain.can_manage_person(id) END);
GRANT SELECT,INSERT,UPDATE ON sa_snapshot_20261019.sa_customer_requests TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_customer_requests_id_seq,sa_snapshot_20261019.sa_assigned_brands_id_seq TO sa_executor;
CREATE POLICY squad_coordinator_read ON sa_snapshot_20261019.sa_customer_requests FOR SELECT TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id)=0 OR user_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_coordinator_insert ON sa_snapshot_20261019.sa_customer_requests FOR INSERT TO sa_executor
 WITH CHECK((SELECT (sa_domain.actor()).role_id)=3 AND user_id=(SELECT (sa_domain.actor()).user_id) AND status=0 AND request_type=0);
CREATE POLICY squad_coordinator_write ON sa_snapshot_20261019.sa_customer_requests FOR UPDATE TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id)=0) WITH CHECK((SELECT (sa_domain.actor()).role_id)=0);
CREATE INDEX squad_pending_coordinator_request ON sa_snapshot_20261019.sa_customer_requests(user_id,id) WHERE status=0;
CREATE TABLE sa_domain.coordinator_request_notes(
 request_id bigint NOT NULL,generation bigint NOT NULL,reason text NOT NULL,original_coordinator_id bigint,
 actor_id uuid NOT NULL,decision_reason text,decided_by uuid,PRIMARY KEY(request_id,generation));
ALTER TABLE sa_domain.coordinator_request_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.coordinator_request_notes FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.coordinator_request_notes TO sa_executor;
CREATE POLICY squad_coordinator_note_read ON sa_domain.coordinator_request_notes FOR SELECT TO sa_executor
 USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND ((SELECT (sa_domain.actor()).role_id)=0 OR actor_id=(SELECT auth.uid())));
CREATE POLICY squad_coordinator_note_insert ON sa_domain.coordinator_request_notes FOR INSERT TO sa_executor
 WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT auth.uid()));
CREATE POLICY squad_coordinator_note_write ON sa_domain.coordinator_request_notes FOR UPDATE TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id)=0 AND generation=(SELECT generation FROM sa_domain.runtime_state))
 WITH CHECK((SELECT (sa_domain.actor()).role_id)=0 AND generation=(SELECT generation FROM sa_domain.runtime_state));
GRANT SELECT,INSERT,DELETE ON sa_snapshot_20261019.sa_assigned_brands TO sa_executor;
CREATE POLICY squad_assigned_brand_read ON sa_snapshot_20261019.sa_assigned_brands FOR SELECT TO sa_executor USING(sa_domain.can_person(user_id));
CREATE POLICY squad_assigned_brand_insert ON sa_snapshot_20261019.sa_assigned_brands FOR INSERT TO sa_executor
 WITH CHECK((SELECT (sa_domain.actor()).role_id) IN(0,1) AND sa_domain.can_manage_person(user_id));
CREATE POLICY squad_assigned_brand_delete ON sa_snapshot_20261019.sa_assigned_brands FOR DELETE TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id) IN(0,1) AND sa_domain.can_manage_person(user_id));

CREATE FUNCTION sa_domain.customer_record(p_id bigint,p_roles integer[] DEFAULT ARRAY[0,1]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(p_roles);r jsonb;
BEGIN
 IF NOT sa_domain.can_manage_person(p_id) AND NOT(a.role_id=10 AND p_id=a.user_id) THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('id',id::text,'role',role,'coordinator_id',created_by_id::text,'approved',approved,'onboarded',onboarded,'direct',is_direct_deal,'price_type_id',rmp_price_type_id::text)
 INTO r FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role IN(3,10) AND deleted_at IS NULL;
 IF r IS NULL THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0002';END IF;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_customer_review(p_id bigint,p_fields jsonb,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached jsonb;old_ jsonb;v text;k text;val jsonb;rules_ jsonb;
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0,1]);PERFORM sa_domain.command_reason(p_reason);PERFORM sa_domain.check_fields(p_fields,ARRAY['approved','onboarded']);
 IF p_fields='{}'::jsonb THEN RAISE EXCEPTION 'Specify approval or onboarding' USING ERRCODE='22023';END IF;
 FOR k,val IN SELECT * FROM jsonb_each(p_fields) LOOP IF jsonb_typeof(val)<>'boolean' THEN RAISE EXCEPTION 'Review states must be boolean' USING ERRCODE='22023';END IF;END LOOP;
 cached:=sa_domain.begin_command('customer.reviewed',p_idempotency_key,jsonb_build_object('id',p_id,'fields',p_fields,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));old_:=sa_domain.customer_record(p_id);v:=sa_domain.bump_version('person',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET
 approved=coalesce((p_fields->>'approved')::boolean,approved),approved_at=CASE WHEN p_fields?'approved' THEN CASE WHEN(p_fields->>'approved')::boolean THEN coalesce(approved_at,now() AT TIME ZONE 'UTC') END ELSE approved_at END,
 onboarded=coalesce((p_fields->>'onboarded')::boolean,onboarded),onboarded_at=CASE WHEN p_fields?'onboarded' THEN CASE WHEN(p_fields->>'onboarded')::boolean THEN coalesce(onboarded_at,now() AT TIME ZONE 'UTC') END ELSE onboarded_at END,
 updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 rules_:=sa_domain.recalculate_address_rules(p_id);
 RETURN sa_domain.finish_command('customer.reviewed',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',v,'approved',coalesce(p_fields->'approved',old_->'approved'),'onboarded',coalesce(p_fields->'onboarded',old_->'onboarded'),'account_reconciliation','queued','commercial_rules',rules_),
 jsonb_build_object('before',old_,'after',p_fields,'reason',p_reason,'password_changed',false));
END $f$;

CREATE FUNCTION sa_domain.reassign_customers(p_customers jsonb,p_coordinator_id bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);x jsonb;ids_ bigint[]:='{}';orders_ bigint[];r jsonb;people_ jsonb:='[]';id_ bigint;v text;
BEGIN
 IF p_customers IS NULL OR jsonb_typeof(p_customers)<>'array' OR jsonb_array_length(p_customers) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose 1..100 customers' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.person_structure_fence();PERFORM sa_domain.work_person(p_coordinator_id,ARRAY[1]);
 FOR x IN SELECT * FROM jsonb_array_elements(p_customers) LOOP
  PERFORM sa_domain.check_fields(x,ARRAY['id','version']);id_:=sa_domain.input_id(x->'id');
  IF id_=ANY(ids_) OR x->>'version' IS NULL THEN RAISE EXCEPTION 'Distinct customers and exact versions are required' USING ERRCODE='22023';END IF;ids_:=array_append(ids_,id_);
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_customers) ORDER BY(value->>'id')::bigint LOOP
  id_:=(x->>'id')::bigint;r:=sa_domain.customer_record(id_);v:=sa_domain.bump_version('person',id_,x->>'version');
  people_:=people_||jsonb_build_array(jsonb_build_object('id',id_::text,'version',v,'previous_coordinator_id',r->>'coordinator_id','coordinator_id',p_coordinator_id::text));
 END LOOP;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO orders_ FROM(SELECT id FROM sa_snapshot_20261019.sa_orders
 WHERE customer_id=ANY(ids_) AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL AND customer_sc_id IS DISTINCT FROM p_coordinator_id ORDER BY id LIMIT 1001) s;
 IF cardinality(orders_)>1000 THEN RAISE EXCEPTION 'More than 1000 pending orders; split the customer selection or use the reconciliation job' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) SELECT 'order',unnest(orders_),1 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=sa_domain.entity_versions.revision+1;
 UPDATE sa_snapshot_20261019.sa_orders SET customer_sc_id=p_coordinator_id,updated_at=now() AT TIME ZONE 'UTC' WHERE id=ANY(orders_);
 UPDATE sa_snapshot_20261019.sa_users SET created_by_id=p_coordinator_id,updated_at=now() AT TIME ZONE 'UTC' WHERE id=ANY(ids_);
 RETURN jsonb_build_object('people',people_,'updated_pending_orders',cardinality(orders_),'completed_history_preserved',true);
END $f$;
CREATE FUNCTION sa_domain.v1_customers_reassign(p_customers jsonb,p_coordinator_id bigint,p_reason text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;r jsonb;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);
 cached:=sa_domain.begin_command('customers.coordinator_changed',p_idempotency_key,jsonb_build_object('customers',p_customers,'coordinator_id',p_coordinator_id,'reason',p_reason));IF cached IS NOT NULL THEN RETURN cached;END IF;
 r:=sa_domain.reassign_customers(p_customers,p_coordinator_id);
 RETURN sa_domain.finish_command('customers.coordinator_changed',p_idempotency_key,'coordinator',p_coordinator_id,r,r||jsonb_build_object('reason',p_reason));
END $f$;

CREATE FUNCTION sa_domain.v1_coordinator_change_request(p_coordinator_id bigint,p_reason text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[3]);cached jsonb;old_ bigint;id_ bigint;v text;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);
 IF p_coordinator_id IS NULL OR p_coordinator_id>2147483647 THEN RAISE EXCEPTION 'Supported coordinator required' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('customer.coordinator_requested',p_idempotency_key,jsonb_build_object('coordinator_id',p_coordinator_id,'reason',p_reason));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||a.user_id,784139));
 SELECT created_by_id INTO old_ FROM sa_snapshot_20261019.sa_users WHERE id=a.user_id AND is_direct_deal IS TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Coordinator requests are for direct customers' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.work_person(p_coordinator_id,ARRAY[1]);
 IF p_coordinator_id IS NOT DISTINCT FROM old_ THEN RAISE EXCEPTION 'Already assigned to this coordinator' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_customer_requests WHERE user_id=a.user_id AND status=0) THEN RAISE EXCEPTION 'A coordinator request is already pending' USING ERRCODE='55000';END IF;
 INSERT INTO sa_snapshot_20261019.sa_customer_requests(user_id,requested_sc_id,status,request_type,created_at,updated_at) VALUES(a.user_id,p_coordinator_id,0,0,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC') RETURNING id INTO id_;
 INSERT INTO sa_domain.coordinator_request_notes(request_id,generation,reason,original_coordinator_id,actor_id) SELECT id_,generation,p_reason,old_,a.auth_id FROM sa_domain.runtime_state;
 v:=sa_domain.bump_version('coordinator_request',id_,sa_domain.version('coordinator_request',id_));
 RETURN sa_domain.finish_command('customer.coordinator_requested',p_idempotency_key,'coordinator_request',id_,jsonb_build_object('id',id_::text,'version',v,'state','pending','customer_id',a.user_id::text,'requested_coordinator_id',p_coordinator_id::text),jsonb_build_object('reason',p_reason,'customer_id',a.user_id::text,'previous_coordinator_id',old_::text,'requested_coordinator_id',p_coordinator_id::text));
END $f$;
CREATE FUNCTION sa_domain.v1_coordinator_requests(p_state text DEFAULT 'pending',p_customer_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,3]);n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('coordinator_requests',jsonb_build_object('state',p_state,'customer_id',p_customer_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;status_ int;
BEGIN
 IF p_state IS NULL OR p_state NOT IN('pending','approved','rejected','all') OR (a.role_id=3 AND p_customer_id IS NOT NULL AND p_customer_id<>a.user_id) THEN RAISE EXCEPTION 'Invalid request filters' USING ERRCODE='22023';END IF;
 status_:=CASE p_state WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 END;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_customer_requests WHERE request_type=0 AND (status_ IS NULL OR status=status_) AND (p_customer_id IS NULL OR user_id=p_customer_id) AND id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'version',sa_domain.version('coordinator_request',p.id),'customer_id',p.user_id::text,'customer_version',sa_domain.version('person',p.user_id),'requested_coordinator_id',p.requested_sc_id::text,
 'state',CASE p.status WHEN 0 THEN 'pending' WHEN 1 THEN 'approved' WHEN 2 THEN 'rejected' END,'created_at',p.created_at AT TIME ZONE 'UTC','reason',notes.reason,'decision_reason',notes.decision_reason) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO r FROM page p LEFT JOIN sa_domain.coordinator_request_notes notes ON notes.request_id=p.id AND notes.generation=(SELECT generation FROM sa_domain.runtime_state);RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_coordinator_change_decide(p_id bigint,p_decision text,p_reason text,p_expected_version text,p_customer_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;r sa_snapshot_20261019.sa_customer_requests;v text;assignment_ jsonb;
BEGIN
 IF p_decision IS NULL OR p_decision NOT IN('approved','rejected') THEN RAISE EXCEPTION 'Choose approved or rejected' USING ERRCODE='22023';END IF;PERFORM sa_domain.command_reason(p_reason);
 cached:=sa_domain.begin_command('customer.coordinator_decided',p_idempotency_key,jsonb_build_object('id',p_id,'decision',p_decision,'reason',p_reason,'version',p_expected_version,'customer_version',p_customer_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM sa_domain.person_structure_fence();v:=sa_domain.bump_version('coordinator_request',p_id,p_expected_version);
 SELECT * INTO r FROM sa_snapshot_20261019.sa_customer_requests WHERE id=p_id AND request_type=0 FOR UPDATE;
 IF r.id IS NULL OR r.status<>0 THEN RAISE EXCEPTION 'Pending request unavailable' USING ERRCODE='55000';END IF;
 IF p_customer_expected_version IS NULL OR p_customer_expected_version IS DISTINCT FROM sa_domain.version('person',r.user_id) THEN RAISE EXCEPTION 'Customer changed; review the current relationship first' USING ERRCODE='40001';END IF;
 IF p_decision='approved' THEN
  IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=r.user_id AND role=3 AND deleted_at IS NULL AND disabled IS NOT TRUE AND is_direct_deal IS TRUE) THEN RAISE EXCEPTION 'Customer is no longer eligible for a coordinator request' USING ERRCODE='55000';END IF;
  assignment_:=sa_domain.reassign_customers(jsonb_build_array(jsonb_build_object('id',r.user_id::text,'version',p_customer_expected_version)),r.requested_sc_id);
 END IF;
 UPDATE sa_snapshot_20261019.sa_customer_requests SET status=CASE p_decision WHEN 'approved' THEN 1 ELSE 2 END,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 UPDATE sa_domain.coordinator_request_notes SET decision_reason=p_reason,decided_by=a.auth_id WHERE request_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state);
 RETURN sa_domain.finish_command('customer.coordinator_decided',p_idempotency_key,'coordinator_request',p_id,jsonb_build_object('id',p_id::text,'version',v,'state',p_decision,'assignment',assignment_),jsonb_build_object('reason',p_reason,'customer_id',r.user_id::text,'requested_coordinator_id',r.requested_sc_id::text,'decision',p_decision,'assignment',assignment_));
END $f$;

CREATE FUNCTION sa_domain.validate_dealer_links(p_customer_id bigint,p_dealer_ids bigint[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1]);candidates_ jsonb;
BEGIN
 IF NOT sa_domain.can_manage_person(p_customer_id) THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
 candidates_:=sa_domain.address_commercial_rules(p_customer_id)->'candidate_dealer_ids';
 IF EXISTS(SELECT FROM unnest(p_dealer_ids) chosen(id) LEFT JOIN sa_snapshot_20261019.sa_users d ON d.id=chosen.id AND d.role=10 AND d.deleted_at IS NULL AND d.disabled IS NOT TRUE AND d.approved IS NOT FALSE
 WHERE d.id IS NULL OR NOT(a.role_id=0 OR d.created_by_id=a.user_id OR candidates_ ? chosen.id::text OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers l WHERE l.user_id=p_customer_id AND l.dealer_id=d.id))) THEN RAISE EXCEPTION 'Dealer is not eligible for this customer relationship' USING ERRCODE='42501';END IF;
END $f$;
ALTER FUNCTION sa_domain.validate_dealer_links(bigint,bigint[]) OWNER TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.address_commercial_rules(bigint) TO sa_guard;
CREATE FUNCTION sa_domain.v1_customer_links_save(p_id bigint,p_coordinator_id bigint,p_dealer_ids bigint[],p_direct boolean,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1]);cached jsonb;old_ jsonb;v text;dealer_ bigint;o sa_snapshot_20261019.sa_orders;order_ids_ bigint[];routing_ bigint[]:='{}';rules_ jsonb;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);
 IF p_direct IS NULL OR p_dealer_ids IS NULL OR cardinality(p_dealer_ids)>100 OR array_position(p_dealer_ids,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_dealer_ids) x)<>cardinality(p_dealer_ids) OR (p_direct AND cardinality(p_dealer_ids)>0) THEN RAISE EXCEPTION 'Use distinct dealer IDs, or an empty list for direct dealing' USING ERRCODE='22023';END IF;
 IF a.role_id=1 AND p_coordinator_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Admin must transfer customers between coordinators' USING ERRCODE='42501';END IF;
 cached:=sa_domain.begin_command('customer.links_saved',p_idempotency_key,jsonb_build_object('id',p_id,'coordinator_id',p_coordinator_id,'dealer_ids',p_dealer_ids,'direct',p_direct,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM sa_domain.person_structure_fence();PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));old_:=sa_domain.customer_record(p_id);
 IF (old_->>'role')::int<>3 THEN RAISE EXCEPTION 'Dealer links apply to customers' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.work_person(p_coordinator_id,ARRAY[1]);PERFORM sa_domain.validate_dealer_links(p_id,p_dealer_ids);
 PERFORM sa_domain.assert_customer_pending_scope(p_id);v:=sa_domain.bump_version('person',p_id,p_expected_version);
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO order_ids_ FROM(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE customer_id=p_id AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL ORDER BY id LIMIT 1001) s;
 IF cardinality(order_ids_)>1000 THEN RAISE EXCEPTION 'Customer has more than 1000 pending orders; use a bounded reconciliation job' USING ERRCODE='54000';END IF;
 FOR o IN SELECT * FROM sa_snapshot_20261019.sa_orders WHERE id=ANY(order_ids_) ORDER BY id LOOP
  IF o.customer_dealer_id IS NOT NULL AND NOT(o.customer_dealer_id=ANY(p_dealer_ids)) THEN
   IF NOT p_direct THEN RAISE EXCEPTION 'A removed dealer still owns pending fulfillment; resolve those orders first' USING ERRCODE='55000';END IF;
   IF sa_domain.order_has_work(o.id) OR o.assigned_to_id IS NOT NULL OR o.assigned_worker_id IS NOT NULL OR nullif(o.uc_order_id,'') IS NOT NULL
   OR EXISTS(SELECT FROM sa_domain.order_requests WHERE order_id=o.id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state))
   OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_back_order_links WHERE order_id=o.id) THEN RAISE EXCEPTION 'Pending dealer fulfillment has work, procurement or external state; reconcile it before direct conversion' USING ERRCODE='55000';END IF;
   routing_:=array_append(routing_,o.id);
  END IF;
 END LOOP;
 INSERT INTO sa_domain.entity_versions(kind,entity_id,revision)
 SELECT 'order',id,1 FROM sa_snapshot_20261019.sa_orders WHERE id=ANY(order_ids_) AND(customer_sc_id IS DISTINCT FROM p_coordinator_id OR id=ANY(routing_))
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=sa_domain.entity_versions.revision+1;
 UPDATE sa_snapshot_20261019.sa_orders SET customer_sc_id=p_coordinator_id,customer_dealer_id=CASE WHEN id=ANY(routing_) THEN NULL ELSE customer_dealer_id END,updated_at=now() AT TIME ZONE 'UTC'
 WHERE id=ANY(order_ids_) AND(customer_sc_id IS DISTINCT FROM p_coordinator_id OR id=ANY(routing_));
 DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_id;
 FOREACH dealer_ IN ARRAY p_dealer_ids LOOP INSERT INTO sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id,created_at,updated_at) VALUES(p_id,dealer_,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');END LOOP;
 UPDATE sa_snapshot_20261019.sa_users SET created_by_id=p_coordinator_id,is_direct_deal=p_direct,dealers_count=cardinality(p_dealer_ids),
 rmp_price_type_id=CASE WHEN p_direct AND (old_->>'direct')::boolean IS NOT TRUE THEN NULL ELSE rmp_price_type_id END,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 rules_:=sa_domain.address_commercial_rules(p_id)||jsonb_build_object('dealer_link_mode','explicit');
 UPDATE sa_snapshot_20261019.sa_users SET zone_id=(rules_->>'zone_id')::bigint,rmp_price_type_id=(rules_->>'price_type_id')::bigint WHERE id=p_id;
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 SELECT a.auth_id,'order.routing_changed','order',o_id,p_idempotency_key,generation,jsonb_build_object('customer_id',p_id::text,'reason',p_reason,'previous_route','dealer','new_route','direct') FROM sa_domain.runtime_state CROSS JOIN unnest(routing_) o_id;
 RETURN sa_domain.finish_command('customer.links_saved',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',v,'coordinator_id',p_coordinator_id::text,'dealer_ids',to_jsonb(p_dealer_ids::text[]),'direct',p_direct,'rerouted_pending_orders',cardinality(routing_),'integration',CASE WHEN cardinality(routing_)>0 THEN 'queued' ELSE 'unchanged' END,'commercial_rules',rules_),
 jsonb_build_object('reason',p_reason,'before',old_,'coordinator_id',p_coordinator_id::text,'dealer_ids',to_jsonb(p_dealer_ids::text[]),'direct',p_direct,'rerouted_order_ids',to_jsonb(routing_::text[])));
END $f$;

GRANT SELECT(auto_approve_customers) ON sa_snapshot_20261019.sa_users TO sa_guard;
CREATE FUNCTION sa_domain.active_master_ids(p_kind text,p_ids bigint[]) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF p_kind='brand' THEN RETURN NOT EXISTS(SELECT FROM unnest(p_ids) x LEFT JOIN sa_snapshot_20261019.sa_authorized_brands b ON b.id=x AND b.is_deleted IS NOT TRUE WHERE b.id IS NULL);
 ELSIF p_kind='price_type' THEN RETURN NOT EXISTS(SELECT FROM unnest(p_ids) x LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types b ON b.id=x AND b.is_deleted IS NOT TRUE WHERE b.id IS NULL);
 ELSIF p_kind='zone' THEN RETURN NOT EXISTS(SELECT FROM unnest(p_ids) x LEFT JOIN sa_snapshot_20261019.sa_zones b ON b.id=x WHERE b.id IS NULL);
 ELSE RAISE EXCEPTION 'Invalid master kind' USING ERRCODE='22023';END IF;
END $f$;
ALTER FUNCTION sa_domain.active_master_ids(text,bigint[]) OWNER TO sa_guard;
GRANT SELECT(id,name,is_deleted) ON sa_snapshot_20261019.sa_authorized_brands TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_zones TO sa_guard;
CREATE POLICY squad_guard_commercial_brands ON sa_snapshot_20261019.sa_authorized_brands FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_commercial_zones ON sa_snapshot_20261019.sa_zones FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.v1_dealer_rules_save(p_id bigint,p_fields jsonb,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,10]);cached jsonb;u jsonb;v text;zone_ bigint;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);PERFORM sa_domain.check_fields(p_fields,ARRAY['auto_approve_customers','zone_id']);
 IF p_fields='{}'::jsonb OR (p_fields?'auto_approve_customers' AND jsonb_typeof(p_fields->'auto_approve_customers')<>'boolean') THEN RAISE EXCEPTION 'Specify valid dealer rules' USING ERRCODE='22023';END IF;
 IF a.role_id=10 AND(p_id<>a.user_id OR p_fields?'zone_id') THEN RAISE EXCEPTION 'Dealer can change only own automatic approval rule; zone overrides require Admin' USING ERRCODE='42501';END IF;
 IF p_fields?'zone_id' AND p_fields->'zone_id'<>'null' THEN zone_:=sa_domain.input_id(p_fields->'zone_id');IF NOT sa_domain.active_master_ids('zone',ARRAY[zone_]) THEN RAISE EXCEPTION 'Zone unavailable' USING ERRCODE='22023';END IF;END IF;
 cached:=sa_domain.begin_command('dealer.rules_saved',p_idempotency_key,jsonb_build_object('id',p_id,'fields',p_fields,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));u:=sa_domain.customer_record(p_id,ARRAY[0,10]);IF(u->>'role')::int<>10 THEN RAISE EXCEPTION 'Dealer required' USING ERRCODE='22023';END IF;
 v:=sa_domain.bump_version('person',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET auto_approve_customers=coalesce((p_fields->>'auto_approve_customers')::boolean,auto_approve_customers),zone_id=CASE WHEN p_fields?'zone_id' THEN zone_ ELSE zone_id END,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 RETURN sa_domain.finish_command('dealer.rules_saved',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',v,'rules',p_fields,'applies_to','future_onboarding'),jsonb_build_object('fields',p_fields,'reason',p_reason));
END $f$;
CREATE FUNCTION sa_domain.v1_customer_commercial_rules_save(p_id bigint,p_fields jsonb,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,10]);cached jsonb;u jsonb;v text;brand_ids_ bigint[]:='{}';id_ bigint;entry_ jsonb;price_ bigint;percentage_ numeric;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);PERFORM sa_domain.check_fields(p_fields,ARRAY['price_type_id','stock_visibility_percentage','brand_ids']);
 IF p_fields='{}'::jsonb THEN RAISE EXCEPTION 'Specify commercial rules' USING ERRCODE='22023';END IF;
 IF a.role_id=10 AND(p_id=a.user_id OR p_fields ?| ARRAY['price_type_id','brand_ids']) THEN RAISE EXCEPTION 'Dealer may adjust only linked customer stock visibility, never grant brands or prices' USING ERRCODE='42501';END IF;
 IF p_fields?'stock_visibility_percentage' THEN percentage_:=sa_domain.input_number(p_fields->'stock_visibility_percentage',0,100);END IF;
 IF p_fields?'price_type_id' AND p_fields->'price_type_id'<>'null' THEN price_:=sa_domain.input_id(p_fields->'price_type_id');IF NOT sa_domain.active_master_ids('price_type',ARRAY[price_]) THEN RAISE EXCEPTION 'Price type unavailable' USING ERRCODE='22023';END IF;END IF;
 IF p_fields?'brand_ids' THEN
  IF jsonb_typeof(p_fields->'brand_ids')<>'array' OR jsonb_array_length(p_fields->'brand_ids')>100 THEN RAISE EXCEPTION 'Choose at most 100 brands' USING ERRCODE='22023';END IF;
  FOR entry_ IN SELECT * FROM jsonb_array_elements(p_fields->'brand_ids') LOOP id_:=sa_domain.input_id(entry_);IF id_=ANY(brand_ids_) THEN RAISE EXCEPTION 'Duplicate brand' USING ERRCODE='22023';END IF;brand_ids_:=array_append(brand_ids_,id_);END LOOP;
  IF NOT sa_domain.active_master_ids('brand',brand_ids_) THEN RAISE EXCEPTION 'Brand unavailable' USING ERRCODE='22023';END IF;
 END IF;
 cached:=sa_domain.begin_command('customer.commercial_rules_saved',p_idempotency_key,jsonb_build_object('id',p_id,'fields',p_fields,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));u:=sa_domain.customer_record(p_id,ARRAY[0,1,10]);
 IF p_fields?'brand_ids' AND(u->>'role')::int<>10 THEN RAISE EXCEPTION 'Brand grants belong to dealers' USING ERRCODE='22023';END IF;
 v:=sa_domain.bump_version('person',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET rmp_price_type_id=CASE WHEN p_fields?'price_type_id' THEN price_ ELSE rmp_price_type_id END,
 stock_visibility_percentage=coalesce(percentage_,stock_visibility_percentage),updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 IF p_fields?'brand_ids' THEN
  DELETE FROM sa_snapshot_20261019.sa_assigned_brands WHERE user_id=p_id;
  FOREACH id_ IN ARRAY brand_ids_ LOOP INSERT INTO sa_snapshot_20261019.sa_assigned_brands(user_id,authorized_brand_id,created_at,updated_at) VALUES(p_id,id_,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');END LOOP;
 END IF;
 RETURN sa_domain.finish_command('customer.commercial_rules_saved',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',v,'rules',p_fields,'pricing_applies_to','future_quotes'),jsonb_build_object('fields',p_fields,'reason',p_reason));
END $f$;

CREATE FUNCTION sa_domain.relationship_options(p_kind text,p_customer_id bigint,p_search text,p_after bigint,p_limit integer) RETURNS TABLE(id bigint,name text,parent_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();candidates_ jsonb:='[]';
BEGIN
 IF p_kind='coordinators' THEN
  IF a.role_id NOT IN(0,1,3) OR(a.role_id=3 AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users me WHERE me.id=a.user_id AND me.is_direct_deal IS TRUE)) THEN RAISE EXCEPTION 'Coordinator selector unavailable' USING ERRCODE='42501';END IF;
  RETURN QUERY SELECT u.id,u.name::text,NULL::bigint FROM sa_snapshot_20261019.sa_users u WHERE u.role=1 AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.id<p_after AND(p_search='' OR strpos(lower(u.name),lower(p_search))>0) ORDER BY u.id DESC LIMIT p_limit;
 ELSIF p_kind='dealers' THEN
  PERFORM sa_domain.require_roles(ARRAY[0,1]);
  IF p_customer_id IS NOT NULL THEN
   IF NOT sa_domain.can_manage_person(p_customer_id) THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
   candidates_:=sa_domain.address_commercial_rules(p_customer_id)->'candidate_dealer_ids';
  END IF;
  RETURN QUERY SELECT u.id,u.name::text,NULL::bigint FROM sa_snapshot_20261019.sa_users u WHERE u.role=10 AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE AND u.id<p_after
  AND(a.role_id=0 OR u.created_by_id=a.user_id OR candidates_ ? u.id::text OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.user_id=p_customer_id AND d.dealer_id=u.id))
  AND(p_search='' OR strpos(lower(concat_ws(' ',u.name,u.customer_company_name)),lower(p_search))>0) ORDER BY u.id DESC LIMIT p_limit;
 ELSIF p_kind='cities' THEN
  PERFORM sa_domain.require_roles(ARRAY[0,1,2,3,4,10,11]);
  RETURN QUERY SELECT c.id,c.name::text,c.zone_id FROM sa_snapshot_20261019.sa_cities c WHERE c.id<p_after AND(p_search='' OR strpos(lower(c.name),lower(p_search))>0) ORDER BY c.id DESC LIMIT p_limit;
 ELSE
  PERFORM sa_domain.require_roles(ARRAY[0,1]);
  IF p_kind='zones' THEN RETURN QUERY SELECT z.id,z.name::text,NULL::bigint FROM sa_snapshot_20261019.sa_zones z WHERE z.id<p_after AND(p_search='' OR strpos(lower(z.name),lower(p_search))>0) ORDER BY z.id DESC LIMIT p_limit;
  ELSIF p_kind='price_types' THEN RETURN QUERY SELECT z.id,z.name::text,z.zone_id FROM sa_snapshot_20261019.sa_rmp_price_types z WHERE z.is_deleted IS NOT TRUE AND z.id<p_after AND(p_search='' OR strpos(lower(z.name),lower(p_search))>0) ORDER BY z.id DESC LIMIT p_limit;
  ELSIF p_kind='brands' THEN RETURN QUERY SELECT z.id,z.name::text,NULL::bigint FROM sa_snapshot_20261019.sa_authorized_brands z WHERE z.is_deleted IS NOT TRUE AND z.id<p_after AND(p_search='' OR strpos(lower(z.name),lower(p_search))>0) ORDER BY z.id DESC LIMIT p_limit;
  ELSE RAISE EXCEPTION 'Unknown relationship selector' USING ERRCODE='22023';END IF;
 END IF;
END $f$;
ALTER FUNCTION sa_domain.relationship_options(text,bigint,text,bigint,integer) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.v1_relationship_options(p_kind text,p_customer_id bigint DEFAULT NULL,p_search text DEFAULT '',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('relationship_options',jsonb_build_object('kind',p_kind,'customer_id',p_customer_id,'search',p_search));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_search IS NULL OR length(p_search)>100 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.relationship_options(p_kind,p_customer_id,p_search,after_,n+1)),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name,'parent_id',parent_id::text) ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;

DO $f$ DECLARE p record;call_ text;BEGIN
 FOR p IN SELECT pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args,pr.provolatile FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY[
 'customer_record','reassign_customers','validate_dealer_links','active_master_ids','relationship_options','assert_customer_pending_scope',
 'v1_customer_review','v1_customers_reassign','v1_coordinator_change_request','v1_coordinator_requests','v1_coordinator_change_decide','v1_customer_links_save','v1_dealer_rules_save','v1_customer_commercial_rules_save','v1_relationship_options']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor',p.proname,p.args);
  IF p.proname LIKE 'v1_%' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s),' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,CASE WHEN p.provolatile='s' THEN 'STABLE' ELSE '' END,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
