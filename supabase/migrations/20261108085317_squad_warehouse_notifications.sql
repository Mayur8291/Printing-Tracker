BEGIN;
-- Provider completion is only one component of mixed-order completion. Capture
-- the order's prior state before the shared progress routine recomputes it.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamptz,text)'::regprocedure);
 IF position($s$'previous_status',old_,'status',p_status,'provider',p_provider$s$ IN d)=0 THEN RAISE EXCEPTION 'Warehouse event contract changed';END IF;
 d:=replace(d,$s$'previous_status',old_,'status',p_status,'provider',p_provider$s$,$s$'previous_status',old_,'status',p_status,'provider',p_provider,'previous_order_status',o.status$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.capture_notification_event()'::regprocedure);
 d:=replace(d,$s$IF NEW.event_type NOT IN('task.saved'$s$,$s$IF NEW.event_type NOT IN('warehouse.status_changed','task.saved'$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.notification_plan(text,text,bigint,uuid,jsonb)'::regprocedure);
 IF position($s$WHEN 'order.provider_processing' THEN$s$ IN d)=0 THEN RAISE EXCEPTION 'Notification event contract changed';END IF;
 d:=replace(d,$s$WHEN 'order.provider_processing' THEN$s$,$s$WHEN 'warehouse.status_changed' THEN
     IF p_changes->>'previous_status' IS DISTINCT FROM p_changes->>'status' THEN
      types_:=CASE p_changes->>'status'
       WHEN 'PROCESSING' THEN ARRAY[16,17]
       WHEN 'CANCELLED' THEN ARRAY[18,19]
       WHEN 'COMPLETE' THEN CASE WHEN o.status=1 AND p_changes->>'previous_order_status'='0' THEN ARRAY[22,23] ELSE '{}'::integer[] END
       ELSE '{}'::integer[] END;
     END IF;
    WHEN 'order.provider_processing' THEN$s$);EXECUTE d;
END $f$;
COMMIT;
