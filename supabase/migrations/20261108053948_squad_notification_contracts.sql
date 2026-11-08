BEGIN;
-- Imported device tokens are deliberately not subscribed to the rebuilt app.
-- New bindings are private, current-account owned and invalidated by refresh.
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor,sa_worker,sa_account_writer;
ALTER TABLE sa_domain.outbox ADD COLUMN parent_id uuid REFERENCES sa_domain.outbox(id) ON DELETE CASCADE;
CREATE INDEX squad_outbox_parent ON sa_domain.outbox(parent_id) WHERE parent_id IS NOT NULL;
CREATE TABLE sa_domain.devices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),installation_id uuid NOT NULL UNIQUE,
 auth_id uuid NOT NULL,legacy_user_id bigint NOT NULL,platform text NOT NULL CHECK(platform IN('android','ios','web')),
 token text NOT NULL CHECK(length(token) BETWEEN 32 AND 4096),token_hash bytea NOT NULL,
 generation bigint NOT NULL,revision bigint NOT NULL DEFAULT 1,active boolean NOT NULL DEFAULT true,
 refreshed_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '45 days',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX squad_device_active_token ON sa_domain.devices(token_hash) WHERE active;
CREATE INDEX squad_device_actor ON sa_domain.devices(auth_id,generation) WHERE active;
ALTER TABLE sa_domain.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.devices FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.devices TO sa_account_writer;
CREATE POLICY device_writer ON sa_domain.devices TO sa_account_writer USING(true) WITH CHECK(true);

CREATE FUNCTION sa_domain.device_projection(d sa_domain.devices) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',d.id,'installation_id',d.installation_id,'platform',d.platform,'active',d.active,
 'version',d.generation::text||':'||d.revision::text,'expires_at',d.expires_at)
$f$;
ALTER FUNCTION sa_domain.device_projection(sa_domain.devices) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.v1_device_save(p_installation_id uuid,p_platform text,p_token text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();d sa_domain.devices;other_ sa_domain.devices;h bytea;g bigint;cached jsonb;result_ jsonb;key_ bigint;
BEGIN
 IF p_installation_id IS NULL OR p_platform NOT IN('android','ios','web') OR p_platform IS NULL
 OR p_token IS NULL OR length(p_token) NOT BETWEEN 32 AND 4096 OR p_token !~ '^[A-Za-z0-9:_-]+$'
 OR p_token LIKE 'ExponentPushToken%' OR p_token LIKE 'ExpoPushToken%' THEN RAISE EXCEPTION 'Native FCM registration token required' USING ERRCODE='22023';END IF;
 h:=sha256(convert_to(p_token,'UTF8'));
 cached:=sa_domain.begin_command('device.saved',p_idempotency_key,jsonb_build_object('installation',p_installation_id,'platform',p_platform,'token_digest',encode(h,'hex'),'version',p_expected_version));
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 PERFORM pg_advisory_xact_lock(hashtextextended('device-owner:'||a.auth_id::text,784142));
 FOR key_ IN SELECT DISTINCT x FROM unnest(ARRAY[hashtextextended('device-installation:'||p_installation_id::text,784142),hashtextextended('device-token:'||encode(h,'hex'),784142)]) x ORDER BY x LOOP PERFORM pg_advisory_xact_lock(key_);END LOOP;
 IF (SELECT count(*) FROM sa_domain.commands WHERE actor_id=a.auth_id AND operation IN('device.saved','device.removed') AND created_at>now()-interval '1 hour')>60 THEN RAISE EXCEPTION 'Device change limit reached' USING ERRCODE='54000';END IF;
 SELECT * INTO d FROM sa_domain.devices WHERE installation_id=p_installation_id FOR UPDATE;
 IF d.id IS NOT NULL AND d.auth_id=a.auth_id AND d.generation=g THEN
  IF p_expected_version IS DISTINCT FROM g::text||':'||d.revision::text AND NOT(p_expected_version IS NULL AND d.token=p_token AND d.platform=p_platform AND d.active) THEN RAISE EXCEPTION 'Device changed; reload registration' USING ERRCODE='40001';END IF;
 ELSIF d.id IS NOT NULL AND d.auth_id<>a.auth_id AND (d.token_hash<>h OR d.token<>p_token) THEN
  RAISE EXCEPTION 'Installation belongs to another account' USING ERRCODE='42501';
 ELSIF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'Device generation changed' USING ERRCODE='40001';END IF;
 -- Possession of the exact opaque token permits account switching on one device.
 -- Retiring its old binding prevents a delayed delivery from following the switch.
 SELECT * INTO other_ FROM sa_domain.devices WHERE token_hash=h AND active AND id IS DISTINCT FROM d.id FOR UPDATE;
 IF other_.id IS NOT NULL THEN
  IF other_.token<>p_token THEN RAISE EXCEPTION 'Token digest conflict' USING ERRCODE='23505';END IF;
  UPDATE sa_domain.devices SET active=false,revision=revision+1 WHERE id=other_.id;
 END IF;
 IF (d.id IS NULL OR d.auth_id<>a.auth_id OR NOT d.active OR d.generation<>g OR d.expires_at<=now())
 AND (SELECT count(*) FROM sa_domain.devices WHERE auth_id=a.auth_id AND generation=g AND active AND expires_at>now())>=10 THEN RAISE EXCEPTION 'Ten active devices maximum' USING ERRCODE='54000';END IF;
 IF d.id IS NULL THEN
  INSERT INTO sa_domain.devices(installation_id,auth_id,legacy_user_id,platform,token,token_hash,generation)
  VALUES(p_installation_id,a.auth_id,a.user_id,p_platform,p_token,h,g) RETURNING * INTO d;
 ELSE
  UPDATE sa_domain.devices SET auth_id=a.auth_id,legacy_user_id=a.user_id,platform=p_platform,token=p_token,token_hash=h,generation=g,
   active=true,revision=revision+1,refreshed_at=now(),expires_at=now()+interval '45 days' WHERE id=d.id RETURNING * INTO d;
 END IF;
 result_:=sa_domain.device_projection(d);
 RETURN sa_domain.finish_command('device.saved',p_idempotency_key,'device',a.user_id,result_,jsonb_build_object('device_id',d.id,'platform',p_platform));
END $f$;
ALTER FUNCTION sa_domain.v1_device_save(uuid,text,text,text,uuid) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.v1_device_remove(p_id uuid,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();d sa_domain.devices;g bigint;cached jsonb;
BEGIN
 cached:=sa_domain.begin_command('device.removed',p_idempotency_key,jsonb_build_object('id',p_id,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 PERFORM pg_advisory_xact_lock(hashtextextended('device-owner:'||a.auth_id::text,784142));
 IF (SELECT count(*) FROM sa_domain.commands WHERE actor_id=a.auth_id AND operation IN('device.saved','device.removed') AND created_at>now()-interval '1 hour')>60 THEN RAISE EXCEPTION 'Device change limit reached' USING ERRCODE='54000';END IF;
 SELECT * INTO d FROM sa_domain.devices WHERE id=p_id AND auth_id=a.auth_id FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Device unavailable' USING ERRCODE='P0002';END IF;
 IF d.generation<>g OR p_expected_version IS DISTINCT FROM d.generation::text||':'||d.revision::text THEN RAISE EXCEPTION 'Device changed' USING ERRCODE='40001';END IF;
 UPDATE sa_domain.devices SET active=false,revision=revision+1 WHERE id=d.id RETURNING * INTO d;
 RETURN sa_domain.finish_command('device.removed',p_idempotency_key,'device',a.user_id,sa_domain.device_projection(d),jsonb_build_object('device_id',d.id));
END $f$;
ALTER FUNCTION sa_domain.v1_device_remove(uuid,text,uuid) OWNER TO sa_account_writer;

CREATE TABLE sa_domain.notification_rules(legacy_type integer PRIMARY KEY,topic text NOT NULL,recipients text[] NOT NULL,title text NOT NULL);
ALTER TABLE sa_domain.notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.notification_rules FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.notification_rules TO sa_guard,sa_executor;
CREATE POLICY notification_rules_read ON sa_domain.notification_rules FOR SELECT TO sa_guard,sa_executor USING(true);
CREATE TABLE sa_domain.notification_records(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox,notification_id bigint NOT NULL,generation bigint NOT NULL,
 recipient_id bigint NOT NULL,recipient_role integer NOT NULL,kind text NOT NULL,entity_id bigint NOT NULL,
 topic text NOT NULL,legacy_types integer[] NOT NULL DEFAULT '{}',removed boolean NOT NULL DEFAULT false,
 UNIQUE(generation,notification_id)
);
ALTER TABLE sa_domain.notification_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.notification_records FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.notification_records TO sa_executor;
CREATE POLICY notification_record_executor ON sa_domain.notification_records TO sa_executor
 USING(recipient_id=(SELECT (sa_domain.actor()).user_id)) WITH CHECK(recipient_id=(SELECT (sa_domain.actor()).user_id));
GRANT SELECT ON sa_domain.notification_records TO sa_worker;
CREATE POLICY notification_record_worker ON sa_domain.notification_records FOR SELECT TO sa_worker USING(true);
CREATE INDEX squad_notification_recipient_page ON sa_snapshot_20261019.sa_notifications(recipient_id,id DESC);
GRANT SELECT,INSERT,UPDATE(status,updated_at) ON sa_snapshot_20261019.sa_notifications TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_notifications_id_seq TO sa_executor;
CREATE POLICY squad_notification_own ON sa_snapshot_20261019.sa_notifications TO sa_executor
 USING(recipient_id=(SELECT (sa_domain.actor()).user_id)) WITH CHECK(recipient_id=(SELECT (sa_domain.actor()).user_id));

-- Resource visibility is reused under the recipient's verified actor context.
CREATE FUNCTION sa_domain.notification_can_open(p_kind text,p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
BEGIN
 RETURN CASE p_kind WHEN 'order' THEN sa_domain.can_order(p_id) WHEN 'person' THEN sa_domain.can_person(p_id)
 WHEN 'task' THEN sa_domain.has_capability('notes') AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_tasks WHERE id=p_id)
 WHEN 'rating' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_ratings WHERE id=p_id) ELSE false END;
END $f$;
ALTER FUNCTION sa_domain.notification_can_open(text,bigint) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.notification_title(p_topic text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE p_topic
 WHEN 'customer.registered' THEN 'New customer registered' WHEN 'customer.coordinator_assigned' THEN 'Customer assigned'
 WHEN 'order.placed' THEN 'Order placed' WHEN 'order.processing' THEN 'Order processing' WHEN 'order.cancelled' THEN 'Order cancelled'
 WHEN 'order.pickup_partial' THEN 'Partial pickup completed' WHEN 'order.completed' THEN 'Order completed' WHEN 'order.dealer_ready' THEN 'Order ready'
 WHEN 'order.due_changed' THEN 'Order due date changed' WHEN 'order.factory_assigned' THEN 'Factory assigned'
 WHEN 'item.cutter_assigned' THEN 'Cutting master assigned' WHEN 'item.cut_partial' THEN 'Partial cutting completed' WHEN 'item.cut_complete' THEN 'Cutting completed'
 WHEN 'item.work_assigned' THEN 'Production work assigned' WHEN 'item.inspected_partial' THEN 'Partial inspection completed' WHEN 'item.inspected_complete' THEN 'Inspection completed'
 WHEN 'item.dispatched' THEN 'Items dispatched' WHEN 'order.worker_assigned' THEN 'Jobworker assigned' WHEN 'item.worker_cost_changed' THEN 'Worker price changed'
 WHEN 'item.fabric_ordered' THEN 'Fabric ordered' WHEN 'item.cutting_started' THEN 'Cutting started' WHEN 'item.stitching_started' THEN 'Stitching started'
 WHEN 'order.price_changed' THEN 'Order price changed' WHEN 'order.rmp_price_changed' THEN 'Readymade price changed' WHEN 'order.edited' THEN 'Order updated'
 WHEN 'task.assigned' THEN 'Task assigned' WHEN 'task.removed' THEN 'Task assignment removed' WHEN 'task.changed' THEN 'Task updated' WHEN 'rating.changed' THEN 'Rating updated'
 ELSE 'Account activity' END
$f$;
ALTER FUNCTION sa_domain.notification_title(text) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.v1_notifications_list(p_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('notifications',jsonb_build_object('id',p_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);result_ jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_notifications WHERE recipient_id=a.user_id AND id<after_ AND(p_id IS NULL OR id=p_id) ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 projected AS(SELECT s.id,s.created_at,CASE WHEN j.id IS NULL THEN s.status WHEN j.status='done' THEN 1 WHEN j.status='dead' THEN 2 ELSE 0 END status,j.result->>'push_state' push_state,coalesce(r.topic,t.topic,'legacy.activity') topic,
 CASE WHEN r.job_id IS NOT NULL THEN NOT r.removed AND r.recipient_role=a.role_id AND sa_domain.notification_can_open(r.kind,r.entity_id)
 ELSE s.order_id IS NOT NULL AND sa_domain.can_order(s.order_id) END can_open,
 CASE WHEN r.job_id IS NOT NULL THEN r.kind ELSE 'order' END kind,coalesce(r.entity_id,s.order_id) entity_id
 FROM page s LEFT JOIN sa_domain.notification_records r ON r.notification_id=s.id AND r.generation=(ctx->>'generation')::bigint
 LEFT JOIN sa_domain.outbox j ON j.id=r.job_id
 LEFT JOIN sa_domain.notification_rules t ON t.legacy_type=s.notification_type)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'title',sa_domain.notification_title(topic),
 'body',CASE WHEN can_open THEN 'Open the record to view its current details.' ELSE 'This activity is no longer available to your account.' END,
 'topic',topic,'created_at',created_at AT TIME ZONE 'UTC','delivery_status',status,'push_state',push_state,
 'target',CASE WHEN can_open THEN jsonb_build_object('kind',kind,'id',entity_id::text) END) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO result_ FROM projected;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.v1_notifications_list(bigint,text,integer) OWNER TO sa_executor;

-- Capture relationship IDs at command commit. No imported-table trigger, provider
-- call, money, free-text note, password or device token enters the fanout plan.
CREATE FUNCTION sa_domain.notification_plan(p_event text,p_kind text,p_id bigint,p_actor uuid,p_changes jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
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
    WHEN 'order.amendment_applied' THEN types_:=CASE WHEN o.order_item_type=0 THEN CASE WHEN o.customer_dealer_id IS NULL THEN ARRAY[86,87] ELSE ARRAY[88,87] END ELSE ARRAY[95,96] END;
    WHEN 'order.edited' THEN IF p_changes->>'request_id' IS NULL THEN types_:=CASE WHEN o.order_item_type=0 THEN ARRAY[86,87] ELSE ARRAY[95,96] END;END IF;
    WHEN 'order.cancellation_requested' THEN IF p_changes->>'provider_confirmation_required'='false' THEN types_:=CASE WHEN actor_.role=10 THEN ARRAY[104,105] WHEN o.order_item_type=0 THEN ARRAY[18,19] ELSE ARRAY[100,101,102,103] END;END IF;
    WHEN 'order.provider_processing' THEN types_:=ARRAY[16,17];
    WHEN 'order.provider_cancelled' THEN types_:=CASE WHEN o.order_item_type=0 THEN ARRAY[18,19] ELSE ARRAY[100,101,102,103] END;
    WHEN 'order.pickup_partial' THEN types_:=ARRAY[20,21];
    WHEN 'order.dealer_ready' THEN types_:=ARRAY[24];
    WHEN 'order.completed','order.force_completed' THEN types_:=ARRAY[22,23];
    WHEN 'order.price_changed' THEN types_:=CASE WHEN o.order_item_type=0 THEN ARRAY[97,98,99] ELSE ARRAY[74,75,76,77] END;
    ELSE NULL;
   END CASE;
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
END $f$;
ALTER FUNCTION sa_domain.notification_plan(text,text,bigint,uuid,jsonb) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.capture_notification_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE plan_ jsonb;
BEGIN
 IF NEW.event_type LIKE 'notification.%' THEN RETURN NEW;END IF;
 FOR plan_ IN SELECT * FROM sa_domain.notification_plan(NEW.event_type,NEW.aggregate_kind,NEW.aggregate_id,NEW.actor_id,NEW.payload) LOOP
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(NEW.id,NEW.actor_id,'notification.fanout','notification',(plan_->>'id')::bigint,gen_random_uuid(),NEW.generation,plan_||jsonb_build_object('source_event',NEW.id,'after_recipient','0'));
 END LOOP;
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.capture_notification_event() OWNER TO sa_worker;
GRANT INSERT ON sa_domain.outbox TO sa_worker;
CREATE TRIGGER squad_capture_notification_event AFTER INSERT ON sa_domain.outbox FOR EACH ROW EXECUTE FUNCTION sa_domain.capture_notification_event();

CREATE FUNCTION sa_domain.notification_candidates(p_plan jsonb,p_after bigint) RETURNS TABLE(user_id bigint,auth_id uuid,role_id integer,legacy_types integer[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.id,m.auth_user_id,u.role,coalesce(array_agg(DISTINCT (x->>'type')::integer) FILTER(WHERE x?'type'),'{}')
 FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id
 CROSS JOIN jsonb_array_elements(p_plan->'audience') x
 WHERE u.id>p_after AND m.enrollment_state='ready' AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE
 AND NOT(u.role=3 AND u.approved IS FALSE) AND u.role IN(0,1,2,3,4,7,8,9,10,11,12)
 AND ((x?'id' AND u.id=(x->>'id')::bigint) OR (NOT x?'id' AND x?'role'))
 AND (NOT x?'role' OR u.role=(x->>'role')::integer) AND(NOT x?'manager' OR u.factory_manager_id=(x->>'manager')::bigint)
 AND (p_plan->>'exclude_actor' IS NULL OR u.id<>(p_plan->>'exclude_actor')::bigint)
 GROUP BY u.id,m.auth_user_id,u.role ORDER BY u.id LIMIT 101
$f$;
ALTER FUNCTION sa_domain.notification_candidates(jsonb,bigint) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.squad_notification_fanout(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;r record;n integer:=0;last_ bigint:=0;more_ boolean:=false;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'notification.fanout' THEN RAISE EXCEPTION 'Fanout lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Fanout lease expired' USING ERRCODE='40001';END IF;
 FOR r IN SELECT * FROM sa_domain.notification_candidates(j.payload,(j.payload->>'after_recipient')::bigint) LOOP
  IF n=100 THEN more_:=true;EXIT;END IF;n:=n+1;last_:=r.user_id;
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(j.id,r.auth_id,'notification.delivery','notification',(j.payload->>'id')::bigint,j.id,g,
   (j.payload-'audience'-'exclude_actor'-'after_recipient')||jsonb_build_object('recipient_id',r.user_id::text,'recipient_role',r.role_id,'types',to_jsonb(r.legacy_types))) ON CONFLICT DO NOTHING;
 END LOOP;
 UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status=CASE WHEN more_ THEN 'pending' ELSE 'done' END,payload=jsonb_set(payload,'{after_recipient}',to_jsonb(last_::text)),
  attempts=CASE WHEN more_ THEN 0 ELSE attempts END,lease_until=NULL,completed_at=CASE WHEN NOT more_ THEN now() END,revision=revision+1,
  result=jsonb_build_object('recipients',coalesce((result->>'recipients')::bigint,0)+n) WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state',CASE WHEN more_ THEN 'pending' ELSE 'done' END,'recipients',n);
END $f$;
ALTER FUNCTION sa_domain.squad_notification_fanout(uuid,uuid) OWNER TO sa_worker;

CREATE TABLE sa_domain.notification_deliveries(
 job_id uuid NOT NULL REFERENCES sa_domain.outbox,device_id uuid NOT NULL REFERENCES sa_domain.devices,
 device_revision bigint NOT NULL,token_hash bytea NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sent','validated','skipped','failed')),
 error_code text,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,device_id,device_revision)
);
ALTER TABLE sa_domain.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.notification_deliveries FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.notification_deliveries TO sa_account_writer;
CREATE POLICY notification_delivery_writer ON sa_domain.notification_deliveries TO sa_account_writer USING(true) WITH CHECK(true);

CREATE FUNCTION sa_domain.materialize_notification(p_job sa_domain.outbox) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();record_ sa_domain.notification_records;id_ bigint;types_ integer[];
BEGIN
 IF a.auth_id<>p_job.actor_id OR a.user_id<>(p_job.payload->>'recipient_id')::bigint OR a.role_id<>(p_job.payload->>'recipient_role')::integer THEN RAISE EXCEPTION 'Recipient changed' USING ERRCODE='42501';END IF;
 IF NOT (CASE WHEN p_job.payload->>'removed'='true' THEN sa_domain.has_capability('notes') ELSE sa_domain.notification_can_open(p_job.payload->>'kind',(p_job.payload->>'id')::bigint) END) THEN RAISE EXCEPTION 'Notification resource unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO record_ FROM sa_domain.notification_records WHERE job_id=p_job.id;
 IF record_.job_id IS NOT NULL THEN RETURN record_.notification_id;END IF;
 SELECT coalesce(array_agg(x::integer),'{}') INTO types_ FROM jsonb_array_elements_text(p_job.payload->'types') x;
 INSERT INTO sa_snapshot_20261019.sa_notifications(notification_type,status,recipient_id,order_id,user_id,title,body,created_at,updated_at)
 VALUES(coalesce(types_[1],0),0,a.user_id,CASE WHEN p_job.payload->>'kind'='order' THEN(p_job.payload->>'id')::bigint END,
  CASE WHEN p_job.payload->>'kind'='person' THEN(p_job.payload->>'id')::bigint END,sa_domain.notification_title(p_job.payload->>'topic'),'Open the app to view current details.',now(),now()) RETURNING id INTO id_;
 INSERT INTO sa_domain.notification_records(job_id,notification_id,generation,recipient_id,recipient_role,kind,entity_id,topic,legacy_types,removed)
 VALUES(p_job.id,id_,p_job.generation,a.user_id,a.role_id,p_job.payload->>'kind',(p_job.payload->>'id')::bigint,p_job.payload->>'topic',types_,coalesce((p_job.payload->>'removed')::boolean,false));
 RETURN id_;
END $f$;
ALTER FUNCTION sa_domain.materialize_notification(sa_domain.outbox) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.notification_device_batch(p_job sa_domain.outbox) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();result_ jsonb;
BEGIN
 IF a.auth_id<>p_job.actor_id THEN RAISE EXCEPTION 'Recipient mismatch' USING ERRCODE='42501';END IF;
 INSERT INTO sa_domain.notification_deliveries(job_id,device_id,device_revision,token_hash)
 SELECT p_job.id,d.id,d.revision,d.token_hash FROM sa_domain.devices d WHERE d.auth_id=a.auth_id AND d.generation=p_job.generation AND d.active AND d.expires_at>now()
 ORDER BY d.id LIMIT 10 ON CONFLICT DO NOTHING;
 UPDATE sa_domain.notification_deliveries x SET state='skipped',error_code='DEVICE_CHANGED',updated_at=now()
 FROM sa_domain.devices d WHERE x.job_id=p_job.id AND x.device_id=d.id AND x.state IN('pending','failed')
 AND (d.auth_id<>a.auth_id OR d.generation<>p_job.generation OR NOT d.active OR d.expires_at<=now() OR d.revision<>x.device_revision OR d.token_hash<>x.token_hash);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revision',d.revision::text,'token',d.token,'platform',d.platform) ORDER BY d.id),'[]') INTO result_
 FROM sa_domain.notification_deliveries x JOIN sa_domain.devices d ON d.id=x.device_id AND d.revision=x.device_revision AND d.token_hash=x.token_hash
 WHERE x.job_id=p_job.id AND x.state IN('pending','failed') AND d.auth_id=a.auth_id AND d.generation=p_job.generation AND d.active AND d.expires_at>now();
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.notification_device_batch(sa_domain.outbox) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.squad_notification_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;id_ bigint;devices_ jsonb;error_ text;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'notification.delivery' THEN RAISE EXCEPTION 'Delivery lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Delivery lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  id_:=sa_domain.materialize_notification(j);devices_:=sa_domain.notification_device_batch(j);
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;
 END;
 IF error_ IS NOT NULL THEN
  UPDATE sa_domain.outbox SET status='dead',last_error_code=error_,lease_until=NULL,completed_at=now(),revision=revision+1 WHERE id=j.id;
  UPDATE sa_domain.job_attempts SET state='failed',finished_at=now(),error_code=error_ WHERE lease_token=j.lease_token;
  RETURN jsonb_build_object('id',j.id,'state','dead','error_code',error_);
 END IF;
 UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state','prepared','notification_id',id_::text,'generation',g::text,'devices',devices_);
END $f$;
ALTER FUNCTION sa_domain.squad_notification_prepare(uuid,uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.settle_notification_devices(p_job sa_domain.outbox,p_results jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;d sa_domain.devices;code_ text;retry_ boolean:=false;row_ sa_domain.notification_deliveries;
BEGIN
 IF jsonb_typeof(p_results)<>'array' OR jsonb_array_length(p_results)>10 THEN RAISE EXCEPTION 'Invalid delivery results' USING ERRCODE='22023';END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_results) LOOP
  code_:=r->>'code';
  IF code_ IS NULL OR code_ NOT IN('SENT','VALIDATED','UNREGISTERED','PROVIDER_UNAVAILABLE','PROVIDER_CONFIGURATION','RATE_LIMITED','STAGING_SUPPRESSED') THEN RAISE EXCEPTION 'Invalid provider disposition' USING ERRCODE='22023';END IF;
  SELECT * INTO row_ FROM sa_domain.notification_deliveries WHERE job_id=p_job.id AND device_id=(r->>'id')::uuid AND device_revision=(r->>'revision')::bigint FOR UPDATE;
  IF row_.job_id IS NULL THEN RAISE EXCEPTION 'Delivery attempt unavailable' USING ERRCODE='40001';END IF;
  IF row_.state IN('sent','validated','skipped') THEN CONTINUE;END IF;
  SELECT * INTO d FROM sa_domain.devices WHERE id=row_.device_id FOR UPDATE;
  IF d.auth_id<>p_job.actor_id OR d.generation<>p_job.generation OR d.revision<>row_.device_revision OR NOT d.active OR d.token_hash<>row_.token_hash THEN code_:='STAGING_SUPPRESSED';END IF;
  UPDATE sa_domain.notification_deliveries SET state=CASE code_ WHEN 'SENT' THEN 'sent' WHEN 'VALIDATED' THEN 'validated' WHEN 'UNREGISTERED' THEN 'skipped' WHEN 'STAGING_SUPPRESSED' THEN 'skipped' ELSE 'failed' END,
   error_code=CASE WHEN code_ IN('SENT','VALIDATED') THEN NULL ELSE code_ END,updated_at=now() WHERE job_id=row_.job_id AND device_id=row_.device_id AND device_revision=row_.device_revision;
  IF code_='UNREGISTERED' THEN UPDATE sa_domain.devices SET active=false,revision=revision+1 WHERE id=d.id AND revision=row_.device_revision AND token_hash=row_.token_hash;END IF;
 END LOOP;
 RETURN(SELECT jsonb_build_object('failed',coalesce(bool_or(state IN('pending','failed')),false),'push_state',CASE WHEN count(*)=0 THEN 'inbox_only' WHEN bool_or(state IN('pending','failed')) THEN 'pending' WHEN bool_or(state='sent') THEN 'accepted' WHEN bool_or(state='validated') THEN 'validated' ELSE 'skipped' END,'devices',count(*)) FROM sa_domain.notification_deliveries WHERE job_id=p_job.id);
END $f$;
ALTER FUNCTION sa_domain.settle_notification_devices(sa_domain.outbox,jsonb) OWNER TO sa_account_writer;

CREATE FUNCTION sa_domain.squad_notification_finish(p_id uuid,p_lease_token uuid,p_results jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;retry_ boolean;failed_ boolean;delay_ integer;summary_ jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'notification.delivery' THEN RAISE EXCEPTION 'Delivery lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Delivery lease expired' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT FROM sa_domain.notification_records WHERE job_id=j.id AND generation=g) THEN RAISE EXCEPTION 'Delivery not prepared' USING ERRCODE='55000';END IF;
 summary_:=sa_domain.settle_notification_devices(j,p_results);failed_:=(summary_->>'failed')::boolean;retry_:=failed_ AND j.attempts<5;
 SELECT greatest(60,least(86400,coalesce(max((x->>'retry_after')::integer),0)),least(3600,power(2,j.attempts)::integer*30)) INTO delay_ FROM jsonb_array_elements(p_results) x;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN failed_ THEN 'failed' ELSE 'done' END,finished_at=now(),error_code=CASE WHEN failed_ THEN 'PROVIDER_UNAVAILABLE' END WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status=CASE WHEN retry_ THEN 'pending' WHEN failed_ THEN 'dead' ELSE 'done' END,
  last_error_code=CASE WHEN failed_ THEN 'PROVIDER_UNAVAILABLE' END,lease_until=NULL,completed_at=CASE WHEN NOT retry_ THEN now() END,
  available_at=now()+make_interval(secs=>delay_),result=summary_- 'failed',revision=revision+1 WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state',CASE WHEN retry_ THEN 'pending' WHEN failed_ THEN 'dead' ELSE 'done' END);
END $f$;
ALTER FUNCTION sa_domain.squad_notification_finish(uuid,uuid,jsonb) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.v1_delivery_failures(p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a jsonb:=sa_domain.ops_context();n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;result_ jsonb;
BEGIN
 IF NOT((a->>'admin')::boolean OR(a->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 ctx:=jsonb_build_object('resource','delivery-failures','actor',a->>'auth_id','generation',(SELECT generation FROM sa_domain.runtime_state));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.outbox WHERE aggregate_kind='notification' AND sequence_id<after_ AND(status='dead' OR last_error_code IS NOT NULL) ORDER BY sequence_id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY sequence_id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.job_projection(page) ORDER BY sequence_id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(sequence_id),ctx) END) INTO result_ FROM page;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.v1_delivery_failures(text,integer) OWNER TO sa_worker;
CREATE INDEX squad_notification_failure_page ON sa_domain.outbox(sequence_id DESC) WHERE aggregate_kind='notification' AND(status='dead' OR last_error_code IS NOT NULL);

INSERT INTO sa_domain.notification_rules VALUES (1,'customer.registered',ARRAY['admin'],'New Customer Alert!'),(2,'customer.coordinator_assigned',ARRAY['sales_coordinator'],'New Customer Alert!'),(3,'order.placed',ARRAY['customer'],'Order Placed Successfully'),(4,'order.placed',ARRAY['admin','sales_coordinator'],'New Order Received!'),(5,'order.placed',ARRAY['customer'],'Order Placed Successfully'),(6,'order.placed',ARRAY['admin','sales_coordinator'],'New Order Received!'),(7,'order.placed',ARRAY['dealer'],'Order Placed Successfully'),(8,'order.placed',ARRAY['sales_coordinator'],'New Custom Order from {{Dealer Name}}'),(9,'order.placed',ARRAY['customer'],'Order Placed Successfully'),(10,'order.placed',ARRAY['admin'],'New Order Received!'),(11,'order.placed',ARRAY['dealer'],'Order Placed Successfully'),(12,'order.placed',ARRAY['admin'],'New Order Received!'),(14,'order.placed',ARRAY['customer_when_actor_customer','dealer_when_actor_dealer'],'Custom Order Placed Successfully!'),(15,'order.placed',ARRAY['admin','sales_coordinator'],'New Custom Order Received!'),(16,'order.processing',ARRAY['customer'],'Your Order {{Order Number}} is Now Being Processed'),(17,'order.processing',ARRAY['sales_coordinator'],'Order Processed for Your Customer'),(18,'order.cancelled',ARRAY['customer'],'❌ Your Order Has Been Cancelled'),(19,'order.cancelled',ARRAY['sales_coordinator'],'❌ Order Cancellation Update'),(20,'order.pickup_partial',ARRAY['dealer'],'📦 Your Order is Partially Ready'),(21,'order.pickup_partial',ARRAY['sales_coordinator'],'Partial Completion: Order {{Order Number}}'),(22,'order.completed',ARRAY['customer'],'✅ Order {{Order Number}} Completed – How Did We Do?'),(23,'order.completed',ARRAY['sales_coordinator'],'🎯 Order Completed & Milestone Updated'),(24,'order.dealer_ready',ARRAY['customer'],'📦 Your Order is Partially Ready'),(26,'order.due_changed',ARRAY['customer'],'Due Date Changed for Your Order {{Order Number}}'),(27,'order.due_changed',ARRAY['sales_coordinator'],'Due Date Updated for Order {{Order Number}}'),(28,'order.due_changed',ARRAY['production_coordinator'],'📅 Due Date Changed for Order {{Order Number}}'),(29,'order.factory_assigned',ARRAY['customer'],'Your Custom Order is Now in Production'),(30,'order.factory_assigned',ARRAY['sales_coordinator'],'Factory Assigned for Customer Order {{Order Number}}'),(31,'order.factory_assigned',ARRAY['production_coordinator'],'Factory Assignment Confirmed for Order {{Order Number}}'),(32,'order.factory_assigned',ARRAY['factory_manager'],'New Custom Order Assigned: {{Order Number}}'),(33,'item.cutter_assigned',ARRAY['factory_manager'],'Cutting Master Assigned Successfully for Order {{Order Number}}'),(34,'item.cutter_assigned',ARRAY['sales_coordinator'],'Cutting Master Assigned for Order {{Order Number}}'),(35,'item.cutter_assigned',ARRAY['production_coordinator'],'Cutting Master Assigned for Order {{Order Number}}'),(36,'item.cutter_assigned',ARRAY['cutting_master'],'You Have Been Assigned to Cutting for Order {{Order Number}}'),(37,'item.cut_partial',ARRAY['cutting_master'],'Partial Cutting Completed for Order {{Order Number}}'),(38,'item.cut_partial',ARRAY['factory_manager'],'Partial Cutting Completed for Order {{Order Number}}'),(39,'item.cut_partial',ARRAY['sales_coordinator'],'Partial Cutting Completed for Order {{Order Number}}'),(40,'item.cut_partial',ARRAY['production_coordinator'],'Partial Cutting Completed for Order {{Order Number}}'),(41,'item.cut_complete',ARRAY['cutting_master'],'Cutting Completed for Order {{Order Number}}'),(42,'item.cut_complete',ARRAY['factory_manager'],'Cutting Completed for Order {{Order Number}}'),(43,'item.cut_complete',ARRAY['sales_coordinator'],'Cutting Completed for Order {{Order Number}}'),(44,'item.cut_complete',ARRAY['production_coordinator'],'Cutting Completed for Order {{Order Number}}'),(45,'item.work_assigned',ARRAY['factory_manager'],'Tailors Assigned for Order {{Order Number}}'),(46,'item.work_assigned',ARRAY['sales_coordinator'],'Tailors Assigned for Your Customer’s Order {{Order Number}}'),(47,'item.work_assigned',ARRAY['production_coordinator'],'Stitching Stage Started for Order {{Order Number}}'),(48,'item.work_assigned',ARRAY['inspectors'],'Stitching Started - Be Ready for Pickup: Order {{Order Number}}'),(49,'item.inspected_partial',ARRAY['inspectors'],'Partial Pickup Completed for Order {{Order Number}}'),(50,'item.inspected_partial',ARRAY['factory_manager'],'Partial Pickup Done for Order {{Order Number}}'),(51,'item.inspected_partial',ARRAY['sales_coordinator'],'Stitching completed of {{Picked Quantity}} pcs for Order {{Order Number}}'),(52,'item.inspected_partial',ARRAY['production_coordinator'],'Partial Stitching Completed for Order {{Order Number}}'),(53,'item.inspected_complete',ARRAY['customer'],'Stitching Completed for Your Order {{Order Number}}'),(54,'item.inspected_complete',ARRAY['inspectors'],'All Pieces Picked for Order {{Order Number}}'),(55,'item.inspected_complete',ARRAY['factory_manager'],'Full Pickup Completed for Order {{Order Number}}'),(56,'item.inspected_complete',ARRAY['sales_coordinator'],'Full Stitching Completed for Order {{Order Number}}'),(57,'item.inspected_complete',ARRAY['production_coordinator'],'Full Stitching Completed for Order {{Order Number}}'),(58,'item.dispatched',ARRAY['factory_manager'],'Partial Dispatch Completed - Order {{Order Number}}'),(59,'item.dispatched',ARRAY['sales_coordinator'],'Partial Dispatch for Your Customer’s Order {{Order Number}}'),(60,'item.dispatched',ARRAY['production_coordinator'],'Partial Dispatch Completed for Order {{Order Number}}'),(61,'order.worker_assigned',ARRAY['production_coordinator'],'Jobworker Assigned for Order {{Order Number}}'),(62,'order.worker_assigned',ARRAY['sales_coordinator'],'Jobworker Assigned for Your Customer’s Order {{Order Number}}'),(63,'order.worker_assigned',ARRAY['jobworker'],'New Production Order Assigned: {{Order Number}}'),(64,'order.worker_assigned',ARRAY['customer'],'Your Custom Order is Now in Production'),(65,'item.worker_cost_changed',ARRAY['production_coordinator'],'Price successfully Assigned for Order {{Order Number}}'),(66,'item.worker_cost_changed',ARRAY['jobworker'],'Price updated for Order {{Order Number}}'),(67,'item.fabric_ordered',ARRAY['sales_coordinator'],'Fabric Ordered for Your Customer’s Order {{Order Number}}'),(68,'item.fabric_ordered',ARRAY['production_coordinator'],'Fabric Ordered for Order {{Order Number}}'),(69,'item.cutting_started',ARRAY['sales_coordinator'],'Cutting Started for Your Customer’s Order {{Order Number}}'),(70,'item.cutting_started',ARRAY['production_coordinator'],'Cutting Started by Jobworker for Order {{Order Number}}'),(71,'item.stitching_started',ARRAY['customer'],'Stitching Started for Your Order {{Order Number}}'),(72,'item.stitching_started',ARRAY['sales_coordinator'],'Stitching Started for Your Customer’s Order {{Order Number}}'),(73,'item.stitching_started',ARRAY['production_coordinator'],'Stitching Started for Order {{Order Number}}'),(74,'order.price_changed',ARRAY['customer','dealer'],'Price Updated for Your Order {{Order Number}}'),(75,'order.price_changed',ARRAY['sales_coordinator'],'Price Updated Successfully for Order {{Order Number}}'),(76,'order.price_changed',ARRAY['production_coordinator'],'Price Changed for Custom Order {{Order Number}}'),(77,'order.price_changed',ARRAY['admin'],'Price Change Alert: Order {{Order Number}}'),(78,'order.edited',ARRAY['customer'],'Your Order Has Been Updated!'),(79,'order.edited',ARRAY['sales_coordinator'],'Customer Edited Their Order!'),(80,'order.edited',ARRAY['admin'],'Customer Edited Their Order!'),(81,'order.edited',ARRAY['dealer'],'Your Order Has Been Updated!'),(82,'order.edited',ARRAY['sales_coordinator'],'Dealer Edited Their Order!'),(83,'order.edited',ARRAY['admin'],'Dealer Edited Their Order!'),(84,'order.edited',ARRAY['dealer'],'Customer Edited Their Order!'),(85,'order.edited',ARRAY['customer'],'Your Order Has Been Updated!'),(86,'order.edited',ARRAY['customer'],'Your Order Has Been Updated!'),(87,'order.edited',ARRAY['admin'],'Customer Edited Their Order!'),(88,'order.edited',ARRAY['customer'],'Your Order Has Been Updated!'),(89,'order.edited',ARRAY['customer'],'Your Custom Order {{Order Number}} Has Been Updated'),(90,'order.edited',ARRAY['sales_coordinator'],'Custom Order {{Order Number}} Updated by {{Customer/Dealer Name}}'),(91,'order.edited',ARRAY['production_coordinator'],'Custom Order {{Order Number}} Updated – Review Changes'),(92,'order.edited',ARRAY['customer'],'Your Custom Order {{Order Number}} Has Been Updated'),(93,'order.edited',ARRAY['dealer'],'Custom Order {{Order Number}} Updated Successfully'),(94,'order.edited',ARRAY['sales_coordinator'],'Custom Order {{Order Number}} Updated Successfully'),(95,'order.edited',ARRAY['customer'],'Your Custom Order {{Order Number}} Has Been Updated'),(96,'order.edited',ARRAY['production_coordinator'],'Custom Order {{Order Number}} Updated by Sales Coordinator'),(97,'order.rmp_price_changed',ARRAY['customer'],'Price Update in Your Order {{Order Number}}'),(98,'order.rmp_price_changed',ARRAY['dealer'],'Price Update in Your Order {{Order Number}}'),(99,'order.rmp_price_changed',ARRAY['admin'],'Price Updated by SC'),(100,'order.cancelled',ARRAY['customer'],'❌ Your Order {{Order Number}} Has Been Cancelled'),(101,'order.cancelled',ARRAY['sales_coordinator'],'Order {{Order Number}} Cancelled Successfully'),(102,'order.cancelled',ARRAY['production_coordinator'],'Custom Order {{Order Number}} Cancelled by Sales Coordinator'),(103,'order.cancelled',ARRAY['admin'],'❌ Order {{Order Number}} Cancelled by Sales Coordinator'),(104,'order.cancelled',ARRAY['customer'],'Your Order {{Order Number}} Has Been Cancelled'),(105,'order.cancelled',ARRAY['actor'],'Custom Order {{Order Number}} Cancelled Successfully'),(106,'order.placed',ARRAY['dealer'],'New Order Received!'),(107,'order.placed',ARRAY['production_coordinator'],'New Custom Order from {{Customer Name}}'),(108,'order.placed',ARRAY['admin'],'New Custom Order from {{Customer Name}}'),(109,'order.placed',ARRAY['customer'],'Custom Order Placed on Your Behalf'),(110,'order.placed',ARRAY['production_coordinator'],'New Custom Order from {{Customer Name}}'),(111,'order.placed',ARRAY['admin'],'New Custom Order from {{Customer Name}}'),(112,'order.placed',ARRAY['sales_coordinator'],'Custom Order {{Order Number}} Placed Successfully'),(113,'order.placed',ARRAY['dealer'],'Custom Order Placed Successfully!'),(114,'order.placed',ARRAY['customer'],'Custom Order Placed on Your Behalf'),(115,'order.placed',ARRAY['dealer'],'Custom Order Placed Successfully!'),(116,'order.placed',ARRAY['customer'],'Custom Order Placed Successfully!'),(117,'order.placed',ARRAY['dealer'],'New Custom Order from {{Customer Name}}');

CREATE OR REPLACE FUNCTION sa_domain.job_handler(p_event text, p_payload jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN p_event='notification.fanout' THEN 'notification_fanout' WHEN p_event='notification.delivery' THEN 'notification_delivery' WHEN p_event='account.challenge_mail' THEN 'account_mail' WHEN p_event='order.edited' AND nullif(p_payload->>'request_id','') IS NOT NULL THEN
 CASE WHEN p_payload->>'provider_confirmation_required'='false' THEN 'local_amendment' ELSE 'provider_order' END
 WHEN p_event IN('account.status_changed','person.archived','customer.reviewed') OR p_event IN('person.saved','person.team_saved') AND(p_payload->>'created'='true' OR p_payload->>'role_changed'='true') THEN 'account_reconciliation'
 ELSE 'notification_dispatch' END
$function$
;

CREATE OR REPLACE FUNCTION sa_domain.squad_job_claim(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE g bigint;result_ jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Claim limit must be 1..10' USING ERRCODE='22023';END IF;
 -- Mirror mode is a quiet no-op: imported/test events never dispatch.
 IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state WHERE singleton) THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'paused',true);END IF;
 g:=sa_domain.worker_write_fence();
 -- Bound crash recovery as well as normal claims. Five abandoned leases reach
 -- a visible dead-letter state rather than becoming permanently unclaimable.
 WITH expired AS(SELECT id FROM sa_domain.outbox WHERE generation=g AND status='leased' AND lease_until<now()
 ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100),
 settled AS(UPDATE sa_domain.outbox j SET status=CASE WHEN attempts>=5 THEN 'dead' ELSE 'pending' END,
 last_error_code=CASE WHEN attempts>=5 THEN 'LEASE_EXHAUSTED' ELSE 'LEASE_EXPIRED' END,lease_until=NULL,
 completed_at=CASE WHEN attempts>=5 THEN now() END,revision=revision+1 FROM expired e WHERE j.id=e.id RETURNING j.lease_token)
 UPDATE sa_domain.job_attempts a SET state='expired',finished_at=now(),error_code='LEASE_EXPIRED' FROM settled s WHERE a.lease_token=s.lease_token AND a.state='leased';
 PERFORM sa_domain.settle_account_failures();
 WITH candidates AS(SELECT id FROM sa_domain.outbox WHERE generation=g AND attempts<5 AND available_at<=now()
 AND(status='pending' OR(status='leased' AND lease_until<now()))
 AND sa_domain.job_handler(event_type,payload) IN('local_amendment','account_reconciliation','account_mail','notification_fanout','notification_delivery')
 ORDER BY available_at,sequence_id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 claimed AS(UPDATE sa_domain.outbox j SET status='leased',attempts=attempts+1,revision=revision+1,lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid()
 FROM candidates c WHERE j.id=c.id RETURNING j.*),
 attempts_log AS(INSERT INTO sa_domain.job_attempts(lease_token,job_id,attempt) SELECT lease_token,id,attempts FROM claimed RETURNING lease_token)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'lease_token',lease_token,'handler',sa_domain.job_handler(event_type,payload),'attempt',attempts,'lease_until',lease_until)),'[]') INTO result_ FROM claimed;
 RETURN jsonb_build_object('jobs',result_,'paused',false);
END $function$
;

CREATE OR REPLACE FUNCTION sa_domain.job_projection(p_job sa_domain.outbox)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',p_job.id,'event',p_job.event_type,'kind',p_job.aggregate_kind,'entity_id',p_job.aggregate_id::text,
 'state',p_job.status,'attempts',p_job.attempts,'available_at',p_job.available_at,'created_at',p_job.created_at,'completed_at',p_job.completed_at,
 'error_code',p_job.last_error_code,'generation',p_job.generation::text,'version',p_job.generation::text||':'||p_job.revision::text,
 'handler',sa_domain.job_handler(p_job.event_type,p_job.payload),'handler_available',sa_domain.job_handler(p_job.event_type,p_job.payload) IN('local_amendment','account_reconciliation','account_mail','notification_fanout','notification_delivery'),
 'progress',CASE WHEN p_job.status='done' THEN 100 ELSE 0 END)
$function$
;

CREATE OR REPLACE FUNCTION sa_domain.v1_job_retry(p_id uuid, p_reason text, p_expected_version text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a jsonb:=sa_domain.ops_context();j sa_domain.outbox;g bigint;payload_ jsonb;old_ sa_domain.job_retries;result_ jsonb;reason_ text:=sa_domain.command_reason(p_reason);
BEGIN
 IF NOT((a->>'admin')::boolean OR(a->>'platform')::boolean) THEN RAISE EXCEPTION 'Retry requires administrator' USING ERRCODE='42501';END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required' USING ERRCODE='22023';END IF;
 g:=sa_domain.worker_write_fence();payload_:=jsonb_build_object('id',p_id,'reason',reason_,'version',p_expected_version);
 PERFORM pg_advisory_xact_lock(hashtextextended(a->>'auth_id'||':'||p_idempotency_key::text,784140));
 SELECT * INTO old_ FROM sa_domain.job_retries WHERE actor_id=(a->>'auth_id')::uuid AND command_key=p_idempotency_key;
 IF old_.command_key IS NOT NULL THEN
  IF (old_.result->>'generation')::bigint<>g THEN RAISE EXCEPTION 'Retry predates refresh' USING ERRCODE='40001';END IF;
  IF old_.payload<>payload_ THEN RAISE EXCEPTION 'Idempotency key already used' USING ERRCODE='22023';END IF;RETURN old_.result;
 END IF;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR((a->>'platform')::boolean AND j.aggregate_kind NOT IN('integration','import','export','document','media','maintenance','notification') AND sa_domain.job_handler(j.event_type,j.payload)<>'account_reconciliation') THEN RAISE EXCEPTION 'Job not found' USING ERRCODE='P0002';END IF;
 IF j.generation<>g OR p_expected_version IS DISTINCT FROM j.generation::text||':'||j.revision::text THEN RAISE EXCEPTION 'Job version changed' USING ERRCODE='40001';END IF;
 IF j.status<>'dead' OR j.last_error_code NOT IN('40P01','55P03','55000','57014','53300','PROVIDER_UNAVAILABLE','LEASE_EXHAUSTED') THEN RAISE EXCEPTION 'Job needs reconciliation rather than retry' USING ERRCODE='55000';END IF;
 UPDATE sa_domain.outbox SET status='pending',attempts=0,available_at=now(),lease_until=NULL,lease_token=NULL,last_error_code=NULL,completed_at=NULL,revision=revision+1 WHERE id=p_id RETURNING * INTO j;
 result_:=sa_domain.job_projection(j);
 INSERT INTO sa_domain.job_retries VALUES((a->>'auth_id')::uuid,p_idempotency_key,p_id,payload_,result_,now());
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation)
 VALUES((a->>'auth_id')::uuid,(a->>'legacy_user_id')::bigint,'job.retried','job',j.sequence_id,p_idempotency_key,jsonb_build_object('job_id',j.id,'reason',reason_),g);
 RETURN result_;
END $function$
;

CREATE OR REPLACE FUNCTION sa_domain.v1_task_save(p_id bigint, p_note text, p_deadline timestamp with time zone, p_order_id bigint, p_assignee_ids bigint[], p_expected_version text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.require_capability('notes');cached jsonb;t sa_snapshot_20261019.sa_tasks%ROWTYPE;
 id_ bigint; version_ text; old_ids bigint[];new_ids bigint[];changes_ jsonb;
BEGIN
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 10000 OR p_deadline IS NULL OR NOT isfinite(p_deadline)
  OR p_assignee_ids IS NULL OR cardinality(p_assignee_ids)>50 OR array_position(p_assignee_ids,NULL) IS NOT NULL
  OR (p_id IS NULL AND p_expected_version IS NOT NULL) THEN RAISE EXCEPTION 'Invalid task fields' USING ERRCODE='22023'; END IF;
 cached:=sa_domain.begin_command('task.saved',p_idempotency_key,jsonb_build_object('id',p_id,'note',p_note,'deadline',p_deadline,'order',p_order_id,'assignees',p_assignee_ids,'version',p_expected_version));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_order_id IS NOT NULL AND NOT sa_domain.can_order(p_order_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM unnest(p_assignee_ids) x WHERE x NOT IN(SELECT id FROM sa_domain.task_assignees())) THEN RAISE EXCEPTION 'Assignee unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO new_ids FROM unnest(p_assignee_ids) x WHERE x<>a.user_id;
 IF p_id IS NULL THEN
  INSERT INTO sa_snapshot_20261019.sa_tasks(note,status,deadline,created_by_id,updated_by_id,order_id,created_at,updated_at)
  VALUES(btrim(p_note),0,p_deadline AT TIME ZONE 'UTC',a.user_id,a.user_id,p_order_id,now(),now()) RETURNING id INTO id_;
  version_:=sa_domain.bump_version('task',id_,sa_domain.version('task',id_));old_ids:='{}';
 ELSE
  SELECT id,created_by_id INTO t.id,t.created_by_id FROM sa_snapshot_20261019.sa_tasks WHERE id=p_id FOR UPDATE;
  IF t.id IS NULL OR (t.created_by_id<>a.user_id AND a.role_id<>0) OR t.status=2 THEN RAISE EXCEPTION 'Task cannot be edited' USING ERRCODE='42501'; END IF;
  id_:=p_id;version_:=sa_domain.bump_version('task',id_,p_expected_version);
  SELECT coalesce(array_agg(DISTINCT user_id),'{}') INTO old_ids FROM sa_snapshot_20261019.sa_task_users WHERE task_id=id_;
  UPDATE sa_snapshot_20261019.sa_tasks SET note=btrim(p_note),deadline=p_deadline AT TIME ZONE 'UTC',order_id=p_order_id,updated_by_id=a.user_id,updated_at=now() WHERE id=id_;
 END IF;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO new_ids FROM unnest(p_assignee_ids) x WHERE x<>coalesce(t.created_by_id,a.user_id);
 DELETE FROM sa_snapshot_20261019.sa_task_users WHERE task_id=id_ AND NOT user_id=ANY(new_ids);
 INSERT INTO sa_snapshot_20261019.sa_task_users(task_id,user_id,created_at,updated_at)
 SELECT id_,x,now(),now() FROM unnest(new_ids) x WHERE NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_task_users m WHERE m.task_id=id_ AND m.user_id=x);
 changes_:=jsonb_build_object('created',p_id IS NULL,'content_changed',p_id IS NOT NULL AND (t.note IS DISTINCT FROM btrim(p_note) OR t.deadline IS DISTINCT FROM p_deadline AT TIME ZONE 'UTC' OR t.order_id IS DISTINCT FROM p_order_id),'assignees_added',(SELECT coalesce(jsonb_agg(x::text),'[]') FROM unnest(new_ids) x WHERE NOT x=ANY(old_ids)),
  'assignees_removed',(SELECT coalesce(jsonb_agg(x::text),'[]') FROM unnest(old_ids) x WHERE NOT x=ANY(new_ids)));
 RETURN sa_domain.finish_command('task.saved',p_idempotency_key,'task',id_,jsonb_build_object('id',id_::text,'version',version_),changes_);
END $function$
;
ALTER POLICY squad_job_read ON sa_domain.outbox USING (((actor_id = ((( SELECT sa_domain.ops_context() AS ops_context) ->> 'auth_id'::text))::uuid) OR ((( SELECT sa_domain.ops_context() AS ops_context) ->> 'admin'::text))::boolean OR (((( SELECT sa_domain.ops_context() AS ops_context) ->> 'platform'::text))::boolean AND ((aggregate_kind = ANY (ARRAY['integration'::text, 'import'::text, 'export'::text, 'document'::text, 'media'::text, 'maintenance'::text, 'notification'::text])) OR (sa_domain.job_handler(event_type, payload) = 'account_reconciliation'::text)))));

CREATE INDEX squad_notification_queue ON sa_domain.outbox(available_at,sequence_id) WHERE status IN('pending','leased') AND event_type IN('notification.fanout','notification.delivery');
CREATE FUNCTION canto_api.v1_device_save(p_installation_id uuid,p_platform text,p_token text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_device_save(p_installation_id,p_platform,p_token,p_expected_version,p_idempotency_key) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_device_save(uuid,text,text,text,uuid),sa_domain.v1_device_save(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_device_save(uuid,text,text,text,uuid),sa_domain.v1_device_save(uuid,text,text,text,uuid) TO sa_app;
CREATE FUNCTION canto_api.v1_device_remove(p_id uuid,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_device_remove(p_id,p_expected_version,p_idempotency_key) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_device_remove(uuid,text,uuid),sa_domain.v1_device_remove(uuid,text,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_device_remove(uuid,text,uuid),sa_domain.v1_device_remove(uuid,text,uuid) TO sa_app;
CREATE FUNCTION canto_api.v1_notifications_list(p_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_notifications_list(p_id,p_cursor,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_notifications_list(bigint,text,integer),sa_domain.v1_notifications_list(bigint,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_notifications_list(bigint,text,integer),sa_domain.v1_notifications_list(bigint,text,integer) TO sa_app;
CREATE FUNCTION canto_api.v1_delivery_failures(p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_delivery_failures(p_cursor,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_delivery_failures(text,integer),sa_domain.v1_delivery_failures(text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_delivery_failures(text,integer),sa_domain.v1_delivery_failures(text,integer) TO sa_app,authenticated;
CREATE FUNCTION canto_api.squad_notification_fanout(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_notification_fanout(p_id,p_lease_token) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_notification_fanout(uuid,uuid),sa_domain.squad_notification_fanout(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_notification_fanout(uuid,uuid),sa_domain.squad_notification_fanout(uuid,uuid) TO service_role;
CREATE FUNCTION canto_api.squad_notification_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_notification_prepare(p_id,p_lease_token) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_notification_prepare(uuid,uuid),sa_domain.squad_notification_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_notification_prepare(uuid,uuid),sa_domain.squad_notification_prepare(uuid,uuid) TO service_role;
CREATE FUNCTION canto_api.squad_notification_finish(p_id uuid,p_lease_token uuid,p_results jsonb) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_notification_finish(p_id,p_lease_token,p_results) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_notification_finish(uuid,uuid,jsonb),sa_domain.squad_notification_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_notification_finish(uuid,uuid,jsonb),sa_domain.squad_notification_finish(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION sa_domain.device_projection(sa_domain.devices) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.device_projection(sa_domain.devices) TO sa_account_writer;
REVOKE ALL ON FUNCTION sa_domain.notification_can_open(text,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.notification_can_open(text,bigint) TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.notification_title(text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.notification_title(text) TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.notification_plan(text,text,bigint,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.notification_plan(text,text,bigint,uuid,jsonb) TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.capture_notification_event() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.capture_notification_event() TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.notification_candidates(jsonb,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.notification_candidates(jsonb,bigint) TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.materialize_notification(sa_domain.outbox) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.materialize_notification(sa_domain.outbox) TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.notification_device_batch(sa_domain.outbox) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.notification_device_batch(sa_domain.outbox) TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.settle_notification_devices(sa_domain.outbox,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.settle_notification_devices(sa_domain.outbox,jsonb) TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.page_limit(integer),sa_domain.cursor_id(text,jsonb),sa_domain.next_cursor(bigint,jsonb) TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.actor() TO sa_account_writer;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor,sa_worker,sa_account_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
