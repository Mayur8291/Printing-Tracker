BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_worker;
-- A watermark exists even when the availability cache has no row yet. Both
-- callbacks and HTTP snapshots lock this key before touching the cache row.
CREATE TABLE sa_domain.warehouse_inventory_watermarks(
 generation bigint NOT NULL,provider text NOT NULL CHECK(provider IN('dashboard','unicommerce')),facility_code text NOT NULL,sku_id bigint NOT NULL,
 received_at timestamptz NOT NULL DEFAULT '-infinity',PRIMARY KEY(generation,provider,facility_code,sku_id)
);
ALTER TABLE sa_domain.warehouse_inventory_watermarks ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.warehouse_inventory_watermarks FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.warehouse_inventory_watermarks TO sa_worker;
CREATE POLICY inventory_watermark_worker ON sa_domain.warehouse_inventory_watermarks TO sa_worker USING(true) WITH CHECK(true);
-- Use the database receipt clock, not the producer clock or transaction start.
-- Duplicate deliveries reuse their original immutable receipt and timestamp.
ALTER TABLE sa_domain.warehouse_receipts ALTER COLUMN received_at SET DEFAULT clock_timestamp();
ALTER TABLE sa_domain.warehouse_operations ADD COLUMN request_started_at timestamptz;
UPDATE sa_domain.warehouse_operations SET request_started_at=updated_at WHERE operation='inventory' AND attempted;
CREATE FUNCTION sa_domain.warehouse_inventory_request_start() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN IF NEW.operation='inventory' AND NEW.prepared_lease_token IS NOT NULL AND(OLD.prepared_lease_token IS DISTINCT FROM NEW.prepared_lease_token OR OLD.request_started_at IS NULL) THEN NEW.request_started_at:=statement_timestamp();END IF;RETURN NEW;END $f$;
REVOKE ALL ON FUNCTION sa_domain.warehouse_inventory_request_start() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER warehouse_inventory_request_start BEFORE UPDATE OF prepared_lease_token ON sa_domain.warehouse_operations FOR EACH ROW EXECUTE FUNCTION sa_domain.warehouse_inventory_request_start();

CREATE FUNCTION sa_domain.warehouse_inventory_invalidate(p_generation bigint,p_provider text,p_facility text,p_received_at timestamptz,p_rows jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE sku_ bigint;watermark_ timestamptz;n bigint:=0;changed_ bigint;BEGIN
 FOR sku_ IN SELECT id FROM sa_snapshot_20261019.sa_rmp_skus WHERE lower(btrim(name)) IN(SELECT lower(btrim(value->>'sku_code')) FROM jsonb_array_elements(p_rows)) ORDER BY id LOOP
  INSERT INTO sa_domain.warehouse_inventory_watermarks(generation,provider,facility_code,sku_id,received_at) VALUES(p_generation,p_provider,p_facility,sku_,p_received_at)
  ON CONFLICT(generation,provider,facility_code,sku_id) DO UPDATE SET received_at=greatest(sa_domain.warehouse_inventory_watermarks.received_at,excluded.received_at) RETURNING received_at INTO watermark_;
  UPDATE sa_domain.warehouse_inventory SET invalidated_at=greatest(coalesce(invalidated_at,watermark_),watermark_)
   WHERE generation=p_generation AND provider=p_provider AND facility_code=p_facility AND sku_id=sku_ AND watermark_>=as_of;
  GET DIAGNOSTICS changed_=ROW_COUNT;n:=n+changed_;
 END LOOP;
 RETURN n;
END $f$;
ALTER FUNCTION sa_domain.warehouse_inventory_invalidate(bigint,text,text,timestamptz,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_inventory_invalidate(bigint,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.warehouse_inventory_receipt_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.warehouse_inventory_invalidate(NEW.generation,NEW.provider,NEW.payload->>'facility_code',NEW.received_at,coalesce(NEW.payload->'changed_skus',NEW.payload->'low_stock_items'));
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.warehouse_inventory_receipt_capture() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_inventory_receipt_capture() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER warehouse_inventory_receipt_capture AFTER INSERT ON sa_domain.warehouse_receipts FOR EACH ROW WHEN(NEW.state='accepted' AND NEW.event_type IN('stock.level_changed','stock.low_threshold')) EXECUTE FUNCTION sa_domain.warehouse_inventory_receipt_capture();

CREATE FUNCTION sa_domain.warehouse_inventory_store(p_operation uuid,p_lease_token uuid,p_sku bigint,p_available numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE op sa_domain.warehouse_operations;j sa_domain.outbox;watermark_ timestamptz;BEGIN
 SELECT * INTO op FROM sa_domain.warehouse_operations WHERE id=p_operation FOR UPDATE;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=op.job_id;
 IF op.id IS NULL OR op.operation<>'inventory' OR op.request_started_at IS NULL OR op.prepared_lease_token IS DISTINCT FROM p_lease_token OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.status<>'leased' OR j.lease_until<=statement_timestamp() OR op.generation<>(SELECT generation FROM sa_domain.runtime_state)
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(j.payload->'skus') WHERE(value->>'id')::bigint=p_sku) THEN RAISE EXCEPTION 'Inventory snapshot lease unavailable' USING ERRCODE='40001';END IF;
 INSERT INTO sa_domain.warehouse_inventory_watermarks(generation,provider,facility_code,sku_id) VALUES(op.generation,op.provider,op.facility_code,p_sku) ON CONFLICT DO NOTHING;
 SELECT received_at INTO watermark_ FROM sa_domain.warehouse_inventory_watermarks WHERE generation=op.generation AND provider=op.provider AND facility_code=op.facility_code AND sku_id=p_sku FOR UPDATE;
 INSERT INTO sa_domain.warehouse_inventory(generation,provider,facility_code,sku_id,available,as_of,invalidated_at)
 VALUES(op.generation,op.provider,op.facility_code,p_sku,p_available,op.request_started_at,CASE WHEN watermark_>=op.request_started_at THEN watermark_ END)
 ON CONFLICT(generation,provider,facility_code,sku_id) DO UPDATE SET available=excluded.available,as_of=excluded.as_of,invalidated_at=excluded.invalidated_at
 WHERE sa_domain.warehouse_inventory.as_of<=excluded.as_of;
END $f$;
ALTER FUNCTION sa_domain.warehouse_inventory_store(uuid,uuid,bigint,numeric) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.warehouse_inventory_store(uuid,uuid,bigint,numeric) FROM PUBLIC,anon,authenticated,sa_app,service_role;
-- Extend the private base implementation, preserving later customer/amendment
-- dispatch wrappers and their current-authority checks.
DO $f$ DECLARE d text;old_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.warehouse_finish_base(uuid,uuid,jsonb)'::regprocedure);
 old_:=$s$INSERT INTO sa_domain.warehouse_inventory(generation,provider,facility_code,sku_id,available,as_of) VALUES(g,op.provider,op.facility_code,(sku_->>'id')::bigint,value_,now()) ON CONFLICT(generation,provider,facility_code,sku_id) DO UPDATE SET available=excluded.available,as_of=excluded.as_of,invalidated_at=NULL;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Inventory finish contract changed';END IF;
 d:=replace(d,old_,$s$PERFORM sa_domain.warehouse_inventory_store(op.id,j.lease_token,(sku_->>'id')::bigint,value_);$s$);
 old_:=$s$FOR row_ IN SELECT value FROM jsonb_array_elements(p_result->'inventory') LOOP$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Inventory lock order contract changed';END IF;
 d:=replace(d,old_,$s$FOR row_ IN SELECT r.value FROM jsonb_array_elements(p_result->'inventory') r ORDER BY(SELECT(s.value->>'id')::bigint FROM jsonb_array_elements(j.payload->'skus') s WHERE s.value->>'code'=r.value->>'sku_code') LOOP$s$);
 old_:=$s$UPDATE sa_domain.warehouse_inventory SET invalidated_at=now() WHERE generation=g AND provider=op.provider AND facility_code=op.facility_code AND sku_id=(sku_->>'id')::bigint;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Unknown inventory finish contract changed';END IF;
 d:=replace(d,old_,$s$UPDATE sa_domain.warehouse_inventory SET invalidated_at=greatest(coalesce(invalidated_at,op.request_started_at),op.request_started_at) WHERE generation=g AND provider=op.provider AND facility_code=op.facility_code AND sku_id=(sku_->>'id')::bigint AND as_of<=op.request_started_at;$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.squad_warehouse_webhook(uuid,uuid)'::regprocedure);
 old_:=$s$UPDATE sa_domain.warehouse_inventory i SET invalidated_at=greatest(coalesce(invalidated_at,event_.occurred_at),event_.occurred_at)
   WHERE generation=g AND provider=event_.provider AND facility_code=event_.payload->>'facility_code'
   AND sku_id IN(SELECT s.id FROM sa_snapshot_20261019.sa_rmp_skus s WHERE lower(btrim(s.name)) IN(SELECT lower(btrim(value->>'sku_code')) FROM jsonb_array_elements(coalesce(event_.payload->'changed_skus',event_.payload->'low_stock_items'))));
   GET DIAGNOSTICS count_=ROW_COUNT;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Inventory callback contract changed';END IF;
 d:=replace(d,old_,$s$count_:=sa_domain.warehouse_inventory_invalidate(g,event_.provider,event_.payload->>'facility_code',event_.received_at,coalesce(event_.payload->'changed_skus',event_.payload->'low_stock_items'));$s$);EXECUTE d;
END $f$;
-- One-time set-based backfill preserves accepted invalidations on upgrade.
-- Aggregate to one row per cache key before writing, including cold cache keys.
INSERT INTO sa_domain.warehouse_inventory_watermarks(generation,provider,facility_code,sku_id,received_at)
 SELECT r.generation,r.provider,r.payload->>'facility_code',s.id,max(r.received_at)
 FROM sa_domain.warehouse_receipts r
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.payload->'changed_skus',r.payload->'low_stock_items')) v
 JOIN sa_snapshot_20261019.sa_rmp_skus s ON lower(btrim(s.name))=lower(btrim(v.value->>'sku_code'))
 WHERE r.event_type IN('stock.level_changed','stock.low_threshold') AND r.state IN('accepted','applied') AND r.generation=(SELECT generation FROM sa_domain.runtime_state)
 GROUP BY r.generation,r.provider,r.payload->>'facility_code',s.id ORDER BY r.generation,r.provider,r.payload->>'facility_code',s.id
 ON CONFLICT(generation,provider,facility_code,sku_id) DO UPDATE SET received_at=greatest(sa_domain.warehouse_inventory_watermarks.received_at,excluded.received_at);
UPDATE sa_domain.warehouse_inventory i SET invalidated_at=greatest(coalesce(i.invalidated_at,w.received_at),w.received_at)
 FROM sa_domain.warehouse_inventory_watermarks w WHERE(i.generation,i.provider,i.facility_code,i.sku_id)=(w.generation,w.provider,w.facility_code,w.sku_id) AND w.received_at>=i.as_of;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
