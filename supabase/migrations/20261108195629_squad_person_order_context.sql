BEGIN;
-- Pinned Flutter5d55d946 customer_details/factory_details share order workflows.
-- These filters only narrow existing order RLS, never grant the selected person's
-- complete visibility. All existing cursor context binds the added fields.
DO $f$ DECLARE definition_ text;needle_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.validate_order_filters(jsonb)'::regprocedure);
 needle_:=$n$'worker_status','assignment_kind','sort'$n$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected order sort contract missing';END IF;
 definition_:=replace(definition_,needle_,$n$'worker_status','assignment_kind','sort','manager_id','coordinator_id'$n$);
 needle_:=$n$field_='customer_id'$n$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected person filter validation missing';END IF;
 definition_:=replace(definition_,needle_,$n$field_ IN('customer_id','manager_id','coordinator_id')$n$);EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.filtered_orders(jsonb)'::regprocedure);
 needle_:=$n$((NOT (filtered_orders.p_filters ? 'customer_id'::text)) OR (o.customer_id = ((filtered_orders.p_filters ->> 'customer_id'::text))::bigint))$n$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected normalized customer order filter missing';END IF;
 definition_:=replace(definition_,needle_,needle_||$n$
 AND (NOT p_filters?'manager_id' OR o.assigned_to_id=(p_filters->>'manager_id')::bigint)
 AND (NOT p_filters?'coordinator_id' OR o.customer_sc_id=(p_filters->>'coordinator_id')::bigint)$n$);
 EXECUTE definition_;
 -- Existing profile write authority is expanded only for source-backed managed
 -- Customer/Dealer/FactoryManager/staff/workforce forms all expose photo pickers.
 -- This grants no new person management authority.
 definition_:=pg_get_functiondef('sa_domain.media_target(text,bigint,text,boolean)'::regprocedure);
 needle_:='IF p_resource=''users'' THEN valid_:=p_id=a.user_id;';
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected profile media self guard missing';END IF;
 definition_:=replace(definition_,needle_,$n$IF p_resource='users' THEN valid_:=p_id=a.user_id OR
  (EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role BETWEEN 1 AND 12 AND deleted_at IS NULL) AND sa_domain.can_manage_person(p_id));$n$);
 EXECUTE definition_;
 -- Expose exact existing-row edit authority, not merely a broad role guess.
 definition_:=pg_get_functiondef('sa_domain.v1_person_get(bigint)'::regprocedure);
 needle_:='RETURN r;';
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected person response missing';END IF;
 definition_:=replace(definition_,needle_,$n$r:=r||jsonb_build_object('can_manage',sa_domain.can_manage_person(p_id),
  'can_edit_photo',p_id=a.user_id OR(u.role BETWEEN 1 AND 12 AND sa_domain.can_manage_person(p_id)));
 RETURN r;$n$);EXECUTE definition_;
 -- Reachable CustomAppbar and ViewDealersDialog provide scoped call/chat.
 -- Reuse existing relationship DTO, exposing phone only for the same linked
 -- active dealers already visible here. No broad manager directory or service.
 definition_:=pg_get_functiondef('sa_domain.person_relationship_labels(bigint)'::regprocedure);
 needle_:=$n$jsonb_build_object('id',d.id::text,'name',d.name) ORDER BY d.id$n$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected scoped dealer labels missing';END IF;
 definition_:=replace(definition_,needle_,$n$jsonb_build_object('id',d.id::text,'name',d.name,'phone',d.phone) ORDER BY l.id$n$);EXECUTE definition_;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
