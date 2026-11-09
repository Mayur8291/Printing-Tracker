--134: The pinned completed-order cards permit Admin/SC/PC priority tags.
-- Only the priority command gains completed-state support. Cancellation,
-- provider uncertainty, ownership, write fencing and versions stay enforced.
DO $migration$
DECLARE definition_ text;anchor_ text:='o:=sa_domain.lock_order(p_id);v:=sa_domain.bump_version';
BEGIN
 definition_:=pg_get_functiondef('sa_domain.v1_order_priority_save(bigint,boolean,text,text,uuid)'::regprocedure);
 IF strpos(definition_,anchor_)=0 THEN RAISE EXCEPTION 'Expected priority lock anchor missing';END IF;
 definition_:=replace(definition_,anchor_,$replacement$o:=sa_domain.lock_order(p_id,false);
 PERFORM sa_domain.assert_warehouse_idle(p_id);
 IF o.uc_status='CANCELLED' THEN RAISE EXCEPTION 'Cancelled order priority cannot change' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT FROM sa_domain.order_requests WHERE order_id=p_id AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state)) THEN
  RAISE EXCEPTION 'Order has a pending external change; resolve it before further work' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version$replacement$);
 EXECUTE definition_;
END $migration$;
