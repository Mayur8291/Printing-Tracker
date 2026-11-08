BEGIN;
-- Skip events without legacy notification behavior before any relationship read.
-- Source-refresh imports never insert domain outbox events.
CREATE OR REPLACE FUNCTION sa_domain.capture_notification_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE plan_ jsonb;
BEGIN
 IF NEW.event_type NOT IN('task.saved','task.transitioned','rating.saved','account.registration_completed','person.saved','customer.links_saved','customers.coordinator_changed','customer.coordinator_decided','orders.placed','backorder.placed','order.due_changed','order.factory_assigned','item.cutter_assigned','item.cut','item.work_assigned','item.inspected','item.dispatched','order.worker_assigned','item.worker_cost_changed','item.worker_stage_changed','order.amendment_applied','order.edited','order.cancellation_requested','order.provider_processing','order.provider_cancelled','order.pickup_partial','order.dealer_ready','order.completed','order.force_completed','order.price_changed') THEN RETURN NEW;END IF;
 FOR plan_ IN SELECT * FROM sa_domain.notification_plan(NEW.event_type,NEW.aggregate_kind,NEW.aggregate_id,NEW.actor_id,NEW.payload) LOOP
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(NEW.id,NEW.actor_id,'notification.fanout','notification',(plan_->>'id')::bigint,gen_random_uuid(),NEW.generation,plan_||jsonb_build_object('source_event',NEW.id,'after_recipient','0'));
 END LOOP;
 RETURN NEW;
END $function$
;
COMMIT;
