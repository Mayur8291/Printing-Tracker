BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_worker;
-- UPDATE RETURNING has no inherent row order. Return the actual queue order,
-- and lease only one potentially slow provider/render/import per batch. Short
-- SQL fanout/amendment jobs can still share that batch without starving.
DO $f$ DECLARE d text;start_ integer;end_ integer;old_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 old_:=$s$'lease_until',lease_until)),'[]') INTO result_ FROM claimed;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Queue return contract changed';END IF;
 d:=replace(d,old_,$s$'lease_until',lease_until) ORDER BY available_at,sequence_id),'[]') INTO result_ FROM claimed;$s$);
 start_:=position(' AND(event_type NOT IN(' IN d);end_:=position(' ORDER BY available_at,sequence_id FOR UPDATE SKIP LOCKED LIMIT p_limit)' IN d);
 IF start_=0 OR end_<=start_ THEN RAISE EXCEPTION 'Queue heavy-job contract changed';END IF;
 d:=left(d,start_-1)||$s$ AND(sa_domain.job_handler(event_type,payload) NOT IN('document_render','transfer','airtable','warehouse','business_mail','airtable_report')
 OR id=(SELECT x.id FROM sa_domain.outbox x WHERE x.generation=g AND x.attempts<5 AND x.status='pending' AND x.available_at<=now()
 AND sa_domain.job_handler(x.event_type,x.payload) IN('document_render','transfer','airtable','warehouse','business_mail','airtable_report') ORDER BY x.available_at,x.sequence_id LIMIT 1))
$s$||substring(d FROM end_);EXECUTE d;
END $f$;
-- The adapter's provider cooldown is a minimum, not a substitute for queue
-- backoff. Enforce it once around every customer/order/amendment finish path.
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) RENAME TO warehouse_finish_dispatch;
REVOKE ALL ON FUNCTION sa_domain.warehouse_finish_dispatch(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_finish_dispatch(uuid,uuid,jsonb) TO sa_worker;
CREATE FUNCTION sa_domain.squad_warehouse_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE result_ jsonb;delay_ integer;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_result?'retry_after_seconds' THEN
  IF p_result->>'code' IS DISTINCT FROM 'RETRY' OR jsonb_typeof(p_result->'retry_after_seconds') IS DISTINCT FROM 'number'
   OR p_result->>'retry_after_seconds' !~ '^[0-9]{1,4}$' OR (p_result->>'retry_after_seconds')::integer NOT BETWEEN 1 AND 3600 THEN
   RAISE EXCEPTION 'Invalid provider retry delay' USING ERRCODE='22023';
  END IF;
  delay_:=(p_result->>'retry_after_seconds')::integer;
 END IF;
 result_:=sa_domain.warehouse_finish_dispatch(p_id,p_lease_token,p_result);
 IF result_->>'state'='pending' AND p_result->>'code'='RETRY' AND delay_ IS NOT NULL THEN
  UPDATE sa_domain.outbox j SET available_at=greatest(j.available_at,clock_timestamp()+make_interval(secs=>delay_))
  WHERE j.id=p_id AND j.status='pending' AND j.lease_token IS NULL
   AND EXISTS(SELECT FROM sa_domain.warehouse_operations op WHERE op.job_id=j.id AND op.prepared_lease_token=p_lease_token);
 END IF;
 RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_warehouse_finish(uuid,uuid,jsonb) TO service_role;

-- A dealer backorder delegates actual placement to v1_order_place, which already
-- emits the authoritative placed event. The parent event records demand links,
-- not a second order. Bind that relationship explicitly before skipping fanout.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_backorder_place(uuid,text,text,uuid)'::regprocedure);
 IF position($s$p.calculation->'line_settings'),gen_random_uuid())$s$ IN d)=0 THEN RAISE EXCEPTION 'Backorder placement contract changed';END IF;
 d:=replace(d,'linked_ jsonb:=''{}'';v text;','linked_ jsonb:=''{}'';v text;placement_key_ uuid:=gen_random_uuid();');
 d:=replace(d,$s$p.calculation->'line_settings'),gen_random_uuid())$s$,$s$p.calculation->'line_settings'),placement_key_)$s$);
 d:=replace(d,$s$'source_ids',p.calculation->'eligible_order_ids','back_order_id',back_::text$s$,$s$'source_ids',p.calculation->'eligible_order_ids','back_order_id',back_::text,'placement_command_key',placement_key_$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.notification_plan(text,text,bigint,uuid,jsonb)'::regprocedure);
 d:=replace(d,'BEGIN', $s$BEGIN
 IF p_event='backorder.placed' AND p_changes->>'placement_command_key' IS NOT NULL THEN RETURN;END IF;$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.capture_business_mail()'::regprocedure);
 d:=replace(d,'BEGIN', $s$BEGIN
 IF NEW.event_type='backorder.placed' AND NEW.payload->>'placement_command_key' IS NOT NULL THEN RETURN NEW;END IF;$s$);EXECUTE d;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker;
COMMIT;
