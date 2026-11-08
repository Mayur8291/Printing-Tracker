BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_media_writer;
-- This exact-call capability is checked only inside the shared Masters command.
-- It never changes is_admin(), Auth role, or any unrelated business permission.
CREATE FUNCTION sa_domain.airtable_context_info() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.airtable_master_context;t sa_domain.transfers;
BEGIN
 SELECT x.* INTO c FROM sa_domain.airtable_master_context x JOIN sa_domain.worker_context w ON w.backend_pid=x.backend_pid AND w.transaction_id=x.transaction_id AND w.job_id=x.job_id AND w.lease_token=x.lease_token
 JOIN sa_domain.outbox j ON j.id=x.job_id AND j.lease_token=x.lease_token AND j.status='leased' AND j.lease_until>statement_timestamp() AND j.event_type IN('airtable.validate','airtable.apply')
 WHERE x.backend_pid=pg_backend_pid() AND x.transaction_id=txid_current() AND j.actor_id=sa_domain.worker_actor_id();
 IF c.job_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO t FROM sa_domain.transfers WHERE id=c.transfer_id AND job_id=c.job_id;
 IF t.id IS NULL OR t.kind<>'airtable' OR t.state NOT IN('validating','applying') OR NOT sa_domain.transfer_current(t) THEN RETURN NULL;END IF;
 PERFORM sa_domain.airtable_ensure_enabled();RETURN to_jsonb(c);
END $f$;
ALTER FUNCTION sa_domain.airtable_context_info() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.airtable_master_authority(p_resource text,p_action text,p_payload jsonb,p_dry boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c jsonb:=sa_domain.airtable_context_info();
BEGIN
 IF c IS NULL OR c->>'resource' IS DISTINCT FROM p_resource OR c->>'action' IS DISTINCT FROM p_action OR(c->>'dry_run')::boolean IS DISTINCT FROM p_dry
 OR(c->>'payload_sha256')::bytea IS DISTINCT FROM sha256(convert_to(p_payload::text,'UTF8')) THEN RETURN NULL;END IF;
 RETURN c;
END $f$;
ALTER FUNCTION sa_domain.airtable_master_authority(text,text,jsonb,boolean) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.airtable_virtual_reference(p_resource text,p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT p_id<0 AND EXISTS(SELECT FROM sa_domain.airtable_rows r WHERE r.id=-p_id AND r.resource=p_resource AND r.transfer_id=(sa_domain.airtable_context_info()->>'transfer_id')::uuid AND r.state IN('matched','valid') AND r.target_id IS NULL)
$f$;
ALTER FUNCTION sa_domain.airtable_virtual_reference(text,bigint) OWNER TO sa_guard;
DO $f$ DECLARE t record;BEGIN
 FOR t IN SELECT resource FROM sa_domain.airtable_resources UNION SELECT 'categories' LOOP
  EXECUTE format('GRANT SELECT ON sa_snapshot_20261019.%I TO sa_worker','sa_'||t.resource);
  EXECUTE format('CREATE POLICY airtable_worker_catalog ON sa_snapshot_20261019.%I FOR SELECT TO sa_worker USING(true)','sa_'||t.resource);
  IF t.resource NOT IN('categories','base_product_asset_infos') THEN EXECUTE format('CREATE INDEX squad_airtable_identity_%I ON sa_snapshot_20261019.%I(airtable_id) WHERE airtable_id IS NOT NULL',t.resource,'sa_'||t.resource);END IF;
 END LOOP;
END $f$;
GRANT SELECT ON sa_snapshot_20261019.sa_sizes TO sa_worker;
CREATE POLICY airtable_worker_sizes ON sa_snapshot_20261019.sa_sizes FOR SELECT TO sa_worker USING(true);
-- Source fields are inserted by the trusted capability after ordinary field,
-- reference, uniqueness and optimistic-version validation has succeeded.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_admin.master_request(text,text,jsonb)'::regprocedure);
 d:=replace(d,'DECLARE spec jsonb;', 'DECLARE airtable_ jsonb; spec jsonb;');
 d:=replace(d,'  IF NOT sa_admin.is_admin() THEN', $s$  airtable_:=sa_domain.airtable_master_authority(p_resource,p_action,p_data,dry_run_);
  IF NOT sa_admin.is_admin() AND airtable_ IS NULL THEN$s$);
 d:=replace(d,$s$  IF spec IS NULL THEN RAISE EXCEPTION 'Unknown master'$s$,$s$  IF airtable_ IS NOT NULL AND p_resource='categories' THEN spec:=spec||'{"readOnly":false,"fields":["name"],"required":["name"],"unique":{"name":true}}'::jsonb;END IF;
  IF spec IS NULL THEN RAISE EXCEPTION 'Unknown master'$s$);
 d:=replace(d,$s$    IF before_ IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;$s$,$s$    IF before_ IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;
    IF airtable_ IS NOT NULL AND spec->'columns'?'source' AND(before_->>'source')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Airtable cannot overwrite dashboard records' USING ERRCODE='42501';END IF;$s$);
 d:=replace(d,$s$        IF NOT exists_ THEN RAISE EXCEPTION 'Related % record does not exist',target$s$,$s$        IF NOT exists_ AND NOT(dry_run_ AND airtable_ IS NOT NULL AND sa_domain.airtable_virtual_reference(target,(row_->>field)::bigint)) THEN RAISE EXCEPTION 'Related % record does not exist',target$s$);
 d:=replace(d,$s$  -- Snapshot columns retain their original names/types.$s$,$s$  IF airtable_ IS NOT NULL AND p_action<>'delete' AND spec->'columns'?'airtable_id' THEN payload:=payload||jsonb_build_object('airtable_id',airtable_->>'airtable_id');END IF;
  -- Snapshot columns retain their original names/types.$s$);
 d:=replace(d,$s$    EXECUTE format('INSERT INTO sa_snapshot_20261019.%I (%s%screated_at,updated_at,source) SELECT %s%snow(),now(),1 RETURNING id','sa_'||p_resource,coalesce(cols,''),CASE WHEN cols IS NULL THEN '' ELSE ',' END,coalesce(vals,''),CASE WHEN vals IS NULL THEN '' ELSE ',' END)$s$,
 $s$    EXECUTE format('INSERT INTO sa_snapshot_20261019.%I (%s%screated_at,updated_at%s) SELECT %s%snow(),now()%s RETURNING id','sa_'||p_resource,coalesce(cols,''),CASE WHEN cols IS NULL THEN '' ELSE ',' END,CASE WHEN spec->'columns'?'source' THEN ',source' ELSE '' END,coalesce(vals,''),CASE WHEN vals IS NULL THEN '' ELSE ',' END,CASE WHEN spec->'columns'?'source' THEN CASE WHEN airtable_ IS NOT NULL THEN ',0' ELSE ',1' END ELSE '' END)$s$);
 d:=replace(d,$s$    EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %s%supdated_at=now(),source=1 WHERE id=$2','sa_'||p_resource,coalesce(assignments,''),CASE WHEN assignments IS NULL THEN '' ELSE ',' END)$s$,
 $s$    EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %s%supdated_at=clock_timestamp()%s WHERE id=$2','sa_'||p_resource,coalesce(assignments,''),CASE WHEN assignments IS NULL THEN '' ELSE ',' END,CASE WHEN spec->'columns'?'source' THEN CASE WHEN airtable_ IS NOT NULL THEN ',source=0' ELSE ',source=1' END ELSE '' END)$s$);
 d:=replace(d,'SET is_deleted=false,updated_at=now(),source=1 WHERE rmp_price_id=record_id','SET is_deleted=false,updated_at=now(),source=CASE WHEN airtable_ IS NOT NULL THEN 0 ELSE 1 END WHERE rmp_price_id=record_id');
 d:=replace(d,$s$false,now(),now(),1); END IF;$s$,$s$false,now(),now(),CASE WHEN airtable_ IS NOT NULL THEN 0 ELSE 1 END); END IF;$s$);
 d:=replace(d,'after_:=sa_admin.read_record(p_resource,record_id);','after_:=sa_admin.read_record(p_resource,record_id,airtable_ IS NULL);');
 IF position('airtable_master_authority' IN d)=0 OR position('Airtable cannot overwrite' IN d)=0 OR position('updated_at,source) SELECT' IN d)>0 THEN RAISE EXCEPTION 'Airtable Masters patch failed';END IF;EXECUTE d;
END $f$;
-- Defer expensive per-class minimum-price refreshes to one bounded final phase.
-- Ordinary UI/CSV commands keep their current synchronous calculation behavior.
ALTER FUNCTION sa_admin.refresh_min_stats(bigint[]) RENAME TO refresh_min_stats_base;
CREATE FUNCTION sa_admin.refresh_min_stats(p_classes bigint[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c jsonb:=sa_domain.airtable_context_info();BEGIN
 IF c IS NOT NULL AND NOT(c->>'dry_run')::boolean THEN
  INSERT INTO sa_domain.airtable_statistics(transfer_id,class_id) SELECT(c->>'transfer_id')::uuid,x FROM(SELECT DISTINCT unnest(p_classes)x)s WHERE x IS NOT NULL ON CONFLICT DO NOTHING;
 ELSE PERFORM sa_admin.refresh_min_stats_base(p_classes);END IF;
END $f$;
REVOKE ALL ON FUNCTION sa_admin.refresh_min_stats(bigint[]) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_admin.refresh_min_stats(bigint[]) TO sa_worker;
-- Existing private media writer owns object registration and attachment. It is
-- reachable here only for a leased Airtable row and its captured attachment.
GRANT SELECT ON sa_domain.airtable_assets,sa_domain.airtable_runs TO sa_media_writer;
CREATE POLICY airtable_assets_owner ON sa_domain.airtable_assets FOR SELECT TO sa_media_writer USING(row_id IN(SELECT id FROM sa_domain.airtable_rows));
CREATE POLICY airtable_runs_owner ON sa_domain.airtable_runs FOR SELECT TO sa_media_writer USING(transfer_id IN(SELECT id FROM sa_domain.transfers));
CREATE FUNCTION sa_domain.airtable_media_register(p_asset uuid,p_manifest jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.airtable_assets;r sa_domain.airtable_rows;t sa_domain.transfers;o sa_media.objects;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 SELECT * INTO a FROM sa_domain.airtable_assets WHERE id=p_asset;SELECT * INTO r FROM sa_domain.airtable_rows WHERE id=a.row_id;SELECT * INTO t FROM sa_domain.transfers WHERE id=r.transfer_id;
 IF a.id IS NULL OR sa_domain.worker_actor_id() IS DISTINCT FROM t.actor_id OR NOT sa_domain.transfer_current(t) OR NOT EXISTS(SELECT FROM sa_domain.airtable_runs WHERE transfer_id=t.id AND phase='media') THEN RAISE EXCEPTION 'Captured media unavailable' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.check_fields(p_manifest,ARRAY['bucket','path','sha256','bytes','mime']);
 IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' OR jsonb_typeof(p_manifest->'bucket') IS DISTINCT FROM 'string' OR jsonb_typeof(p_manifest->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(p_manifest->'sha256') IS DISTINCT FROM 'string' OR jsonb_typeof(p_manifest->'mime') IS DISTINCT FROM 'string' OR jsonb_typeof(p_manifest->'bytes') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid verified media' USING ERRCODE='22023';END IF;
 IF (p_manifest->>'bucket'='canto-media' AND p_manifest->>'sha256'~'^[a-f0-9]{64}$' AND p_manifest->>'path'='sha256/'||left(p_manifest->>'sha256',2)||'/'||(p_manifest->>'sha256') AND p_manifest->>'bytes'~'^[0-9]+$' AND(p_manifest->>'bytes')::numeric BETWEEN 1 AND 26214400 AND p_manifest->>'mime' IN('image/png','image/jpeg','image/gif','image/webp','image/svg+xml','application/pdf','video/mp4','video/webm')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid verified media' USING ERRCODE='22023';END IF;
 IF (a.attachment->>'variant'='original' AND((p_manifest->>'bytes')::bigint IS DISTINCT FROM(a.attachment->>'bytes')::bigint OR p_manifest->>'mime' IS DISTINCT FROM a.attachment->>'mime')) OR(a.attachment->>'variant'='large' AND p_manifest->>'mime' NOT IN('image/png','image/jpeg','image/webp')) THEN RAISE EXCEPTION 'Original attachment metadata changed' USING ERRCODE='22023';END IF;
 INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(p_manifest->>'sha256',p_manifest->>'path',(p_manifest->>'bytes')::bigint,p_manifest->>'mime') ON CONFLICT DO NOTHING;
 SELECT * INTO o FROM sa_media.objects WHERE sha256=p_manifest->>'sha256';
 IF o.bytes IS DISTINCT FROM (p_manifest->>'bytes')::bigint OR o.object_path IS DISTINCT FROM p_manifest->>'path' OR o.content_type IS DISTINCT FROM p_manifest->>'mime' THEN RAISE EXCEPTION 'Stored object conflict' USING ERRCODE='40001';END IF;
END $f$;
ALTER FUNCTION sa_domain.airtable_media_register(uuid,jsonb) OWNER TO sa_media_writer;
CREATE FUNCTION sa_domain.airtable_media_apply(p_row bigint,p_record bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c jsonb:=sa_domain.airtable_context_info();r sa_domain.airtable_rows;field_ text;attachment_ jsonb;sha_ text;target_ jsonb;
BEGIN
 IF c IS NULL OR(c->>'row_id')::bigint IS DISTINCT FROM p_row OR(c->>'dry_run')::boolean OR c->>'action' NOT IN('create','update') THEN RAISE EXCEPTION 'Captured row unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM sa_domain.airtable_rows WHERE id=p_row AND transfer_id=(c->>'transfer_id')::uuid;
 IF r.id IS NULL OR r.target_id IS DISTINCT FROM p_record THEN RAISE EXCEPTION 'Captured row unavailable' USING ERRCODE='42501';END IF;
 FOR field_,attachment_ IN SELECT * FROM jsonb_each(r.media) LOOP
  sha_:=NULL;
  IF attachment_<>'null'::jsonb THEN SELECT manifest->>'sha256' INTO sha_ FROM sa_domain.airtable_assets WHERE row_id=r.id AND field=field_ AND state='ready';IF sha_ IS NULL THEN RAISE EXCEPTION 'Media not verified' USING ERRCODE='55000';END IF;END IF;
  target_:=sa_domain.media_target(r.resource,p_record,field_,true);
  -- An unchanged object needs no history/version churn.
  IF target_->>'source' IS NOT DISTINCT FROM (CASE WHEN sha_ IS NOT NULL THEN 'squad:'||sha_ END) THEN CONTINUE;END IF;
  PERFORM sa_domain.write_media(r.resource,p_record,field_,target_->>'version',sha_,r.transfer_id,'airtable');
 END LOOP;
END $f$;
ALTER FUNCTION sa_domain.airtable_media_apply(bigint,bigint) OWNER TO sa_media_writer;
-- Canonical sizes are an explicit existing Airtable side effect, scoped to the
-- captured size and only its original case-insensitive name match.
CREATE FUNCTION sa_domain.airtable_size_position(p_row bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c jsonb:=sa_domain.airtable_context_info();r sa_domain.airtable_rows;v jsonb;actual_ text;BEGIN
 IF c IS NULL OR(c->>'row_id')::bigint IS DISTINCT FROM p_row OR c->>'resource'<>'rmp_sizes' OR(c->>'dry_run')::boolean THEN RAISE EXCEPTION 'Captured size unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM sa_domain.airtable_rows WHERE id=p_row AND transfer_id=(c->>'transfer_id')::uuid;
 FOR v IN SELECT value FROM jsonb_array_elements(coalesce(r.side_effects->'sizes','[]')) LOOP
  SELECT updated_at::text INTO actual_ FROM sa_snapshot_20261019.sa_sizes WHERE id=(v->>'id')::bigint FOR UPDATE;
  IF actual_ IS DISTINCT FROM v->>'version' THEN RAISE EXCEPTION 'Canonical size changed' USING ERRCODE='40001';END IF;
  UPDATE sa_snapshot_20261019.sa_sizes SET position=(r.values_->>'position')::integer,updated_at=clock_timestamp() WHERE id=(v->>'id')::bigint;
 END LOOP;
END $f$;
ALTER FUNCTION sa_domain.airtable_size_position(bigint) OWNER TO sa_worker;
GRANT UPDATE(position,updated_at) ON sa_snapshot_20261019.sa_sizes TO sa_worker;
CREATE POLICY airtable_size_position_worker ON sa_snapshot_20261019.sa_sizes FOR UPDATE TO sa_worker USING(sa_domain.airtable_context_info()->>'resource'='rmp_sizes') WITH CHECK(sa_domain.airtable_context_info()->>'resource'='rmp_sizes');
-- All bridge functions are private and have no browser grant.
DO $f$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['airtable_context_info','airtable_master_authority','airtable_virtual_reference','airtable_media_register','airtable_media_apply','airtable_size_position']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_worker,sa_media_writer',f.sig);
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.assert_service_worker(),sa_domain.worker_actor_id() TO sa_media_writer;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_media_writer;
COMMIT;
