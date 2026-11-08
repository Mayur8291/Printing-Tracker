BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;

-- "all" occupies both resources. Unlike UNIQUE(provider,scope), these two
-- indexes also prevent an all run racing an orders or inventory run, even if
-- a future internal writer omits the friendly admission check.
CREATE UNIQUE INDEX warehouse_one_active_orders
 ON sa_domain.warehouse_reconciliations(generation,provider)
 WHERE state IN('queued','running') AND scope IN('orders','all');
CREATE UNIQUE INDEX warehouse_one_active_inventory
 ON sa_domain.warehouse_reconciliations(generation,provider)
 WHERE state IN('queued','running') AND scope IN('inventory','all');
DROP INDEX sa_domain.warehouse_one_active_reconciliation;

-- Shared private admission sees conflicts belonging to every actor. The public
-- callers retain their existing authority/generation/cutover/idempotency gates.
-- Keep this VOLATILE: after waiting for a transaction lock the conflict read
-- must use a fresh READ COMMITTED snapshot, rather than the caller's old one.
CREATE FUNCTION sa_domain.warehouse_reconcile_blocker(p_generation bigint,p_provider text,p_scope text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE blocker_ uuid;
BEGIN
 IF p_generation IS NULL OR p_generation IS DISTINCT FROM(SELECT generation FROM sa_domain.runtime_state)
  OR p_provider IS NULL OR p_provider NOT IN('dashboard','unicommerce')
  OR p_scope IS NULL OR p_scope NOT IN('orders','inventory','all') THEN
  RAISE EXCEPTION 'Invalid reconciliation admission' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('warehouse-reconcile:'||p_provider,784146));
 SELECT id INTO blocker_ FROM sa_domain.warehouse_reconciliations
 WHERE generation=p_generation AND provider=p_provider AND state IN('queued','running')
 AND(p_scope='all' OR scope='all' OR scope=p_scope)
 ORDER BY sequence_id LIMIT 1;
 RETURN blocker_;
END $f$;
ALTER FUNCTION sa_domain.warehouse_reconcile_blocker(bigint,text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.warehouse_reconcile_blocker(bigint,text,text)
 FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.warehouse_reconcile_blocker(bigint,text,text) TO sa_media_writer,sa_worker;

DO $f$ DECLARE d text;old_ text;new_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_integration_reconcile(text,text,text,uuid)'::regprocedure);
 old_:=$s$ PERFORM pg_advisory_xact_lock(hashtextextended('warehouse-reconcile:'||p_provider,784146));
 IF EXISTS(SELECT FROM sa_domain.warehouse_reconciliations WHERE generation=g AND provider=p_provider AND state IN('queued','running')) THEN RAISE EXCEPTION 'Reconciliation already running' USING ERRCODE='55000';END IF;$s$;
 new_:=$s$ IF sa_domain.warehouse_reconcile_blocker(g,p_provider,p_scope) IS NOT NULL THEN RAISE EXCEPTION 'Reconciliation already running for this scope' USING ERRCODE='55000';END IF;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Manual reconciliation admission changed';END IF;
 EXECUTE replace(d,old_,new_);

 d:=pg_get_functiondef('sa_domain.squad_warehouse_heartbeat()'::regprocedure);
 old_:=$s$ SELECT id INTO active_ FROM sa_domain.warehouse_reconciliations WHERE generation=g AND provider=s.provider AND state IN('queued','running') LIMIT 1;
 IF active_ IS NOT NULL THEN RETURN jsonb_build_object('state','busy','id',active_);END IF;
$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Scheduled reconciliation admission changed';END IF;
 d:=replace(d,old_,'');
 old_:=$s$ ELSE RETURN jsonb_build_object('state','waiting');END IF;
 INSERT INTO sa_domain.warehouse_reconciliations$s$;
 new_:=$s$ ELSE RETURN jsonb_build_object('state','waiting');END IF;
 active_:=sa_domain.warehouse_reconcile_blocker(g,s.provider,scope_);
 IF active_ IS NOT NULL THEN
  -- A slow orders retry must not consume the inventory resource. Prefer the
  -- other scope only when its own deadline is due and admission is available.
  IF scope_='orders' AND s.next_inventory_at<=statement_timestamp()
   AND sa_domain.warehouse_reconcile_blocker(g,s.provider,'inventory') IS NULL THEN
   scope_:='inventory';active_:=NULL;
  ELSIF scope_='inventory' AND s.next_orders_at<=statement_timestamp()
   AND sa_domain.warehouse_reconcile_blocker(g,s.provider,'orders') IS NULL THEN
   scope_:='orders';active_:=NULL;
  END IF;
 END IF;
 IF active_ IS NOT NULL THEN RETURN jsonb_build_object('state','busy','id',active_);END IF;
 INSERT INTO sa_domain.warehouse_reconciliations$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Scheduled scope choice changed';END IF;
 EXECUTE replace(d,old_,new_);
END $f$;

REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
