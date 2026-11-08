BEGIN;
DO $f$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_media_writer') THEN CREATE ROLE sa_media_writer NOLOGIN NOINHERIT NOBYPASSRLS;END IF;END $f$;
GRANT sa_media_writer TO postgres;
GRANT USAGE ON SCHEMA sa_domain,sa_snapshot_20261019,sa_media,sa_admin,sa_sync TO sa_media_writer;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_media_writer;
ALTER TABLE sa_domain.audit ALTER COLUMN legacy_user_id DROP NOT NULL;
-- The media executor has no arbitrary business-row, password or Auth grants.
GRANT SELECT ON sa_domain.runtime_state,sa_domain.entity_versions,sa_domain.commands,sa_sync.environment_state TO sa_media_writer;
GRANT INSERT,UPDATE ON sa_domain.entity_versions,sa_domain.commands TO sa_media_writer;
GRANT UPDATE(edit_revision,updated_at) ON sa_sync.environment_state TO sa_media_writer;
GRANT INSERT ON sa_domain.audit,sa_domain.outbox TO sa_media_writer;
GRANT USAGE ON SEQUENCE sa_domain.audit_id_seq,sa_domain.outbox_sequence_id_seq TO sa_media_writer;
CREATE POLICY media_runtime ON sa_domain.runtime_state FOR SELECT TO sa_media_writer USING(true);
CREATE POLICY media_versions ON sa_domain.entity_versions TO sa_media_writer USING(true) WITH CHECK(true);
CREATE POLICY media_commands ON sa_domain.commands TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
CREATE POLICY media_environment ON sa_sync.environment_state TO sa_media_writer USING(singleton) WITH CHECK(singleton);
CREATE POLICY media_audit ON sa_domain.audit FOR INSERT TO sa_media_writer WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
CREATE POLICY media_events ON sa_domain.outbox FOR INSERT TO sa_media_writer WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
CREATE TABLE sa_domain.media_uploads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,generation bigint NOT NULL,
 resource text NOT NULL,record_id bigint NOT NULL,field text NOT NULL,expected_version text NOT NULL,
 filename text NOT NULL,bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=104857600),content_type text NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','verified','attached','expired','rejected')),
 sha256 text,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '2 hours'),
 verified_at timestamptz,attached_at timestamptz,result jsonb,
 CHECK(sha256 IS NULL OR sha256~'^[a-f0-9]{64}$')
);
CREATE INDEX squad_media_upload_actor_time ON sa_domain.media_uploads(actor_id,created_at DESC);
CREATE INDEX squad_media_upload_expiry ON sa_domain.media_uploads(expires_at,id) WHERE state IN('reserved','verified');
CREATE TABLE sa_domain.media_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL,generation bigint NOT NULL,
 resource text NOT NULL,record_id bigint NOT NULL,field text NOT NULL,operation text NOT NULL,
 previous_references jsonb NOT NULL,sha256 text,command_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sa_domain.media_uploads ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.media_uploads FORCE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.media_history ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.media_history FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.media_uploads TO sa_media_writer;
GRANT SELECT ON sa_domain.media_uploads TO sa_guard;
GRANT INSERT ON sa_domain.media_history TO sa_media_writer;
GRANT USAGE ON SEQUENCE sa_domain.media_history_id_seq TO sa_media_writer;
CREATE POLICY media_upload_writer ON sa_domain.media_uploads TO sa_media_writer USING(true) WITH CHECK(true);
CREATE POLICY media_upload_guard ON sa_domain.media_uploads FOR SELECT TO sa_guard USING(true);
CREATE POLICY media_history_insert ON sa_domain.media_history FOR INSERT TO sa_media_writer WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
GRANT SELECT,INSERT ON sa_media.objects TO sa_media_writer;
GRANT SELECT,INSERT,UPDATE,DELETE ON sa_media.references TO sa_media_writer;
CREATE POLICY media_writer_objects ON sa_media.objects TO sa_media_writer USING(true) WITH CHECK(true);
CREATE POLICY media_writer_references ON sa_media.references TO sa_media_writer USING(true) WITH CHECK(true);
GRANT SELECT,DELETE ON sa_admin.media TO sa_media_writer;
CREATE POLICY media_writer_overrides ON sa_admin.media TO sa_media_writer USING(true);

CREATE FUNCTION sa_domain.media_upload_fields() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT '{"add_ons":["image"],"asset_infos":["asset"],"authorized_brands":["logo"],"base_product_types":["image"],"base_products":["image"],"brandings":["image","mockup_image","attachment"],"fabrics":["image"],"product_images":["image"],"products":["images"],"promotional_banners":["image"],"promotions":["thumbnail"],"rmp_categories":["image"],"rmp_classes":["image_1","image_2","image_3","image_4","image_5","image_1_thumb","image_2_thumb","image_3_thumb","image_4_thumb","image_5_thumb","embeded_video"],"users":["profile_image"]}'::jsonb
$f$;
DO $f$ DECLARE r text;fields_ jsonb;columns_ text;BEGIN
 FOR r,fields_ IN SELECT * FROM jsonb_each(sa_domain.media_upload_fields()) LOOP
  SELECT string_agg(quote_ident(value),',') INTO columns_ FROM jsonb_array_elements_text(fields_);
  EXECUTE format('GRANT SELECT(id,updated_at,%s),UPDATE(updated_at,%s) ON sa_snapshot_20261019.%I TO sa_media_writer',columns_,columns_,'sa_'||r);
  EXECUTE format('GRANT SELECT(updated_at) ON sa_snapshot_20261019.%I TO sa_guard','sa_'||r);
  EXECUTE format('CREATE POLICY squad_media_write ON sa_snapshot_20261019.%I TO sa_media_writer USING(true) WITH CHECK(true)','sa_'||r);
 END LOOP;
END $f$;
GRANT INSERT(id,product_id,image,created_at,updated_at),SELECT(product_id) ON sa_snapshot_20261019.sa_product_images TO sa_media_writer;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_product_images_id_seq TO sa_media_writer;

CREATE FUNCTION sa_domain.media_target(p_resource text,p_id bigint,p_field text,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE context_ jsonb:=sa_domain.ops_context();a sa_domain.actor;kind_ text;entity_ bigint:=p_id;record_ jsonb;owner_ bigint;valid_ boolean:=false;version_ text;
BEGIN
 IF NOT coalesce(sa_domain.media_upload_fields()->p_resource?p_field,false) OR NOT sa_domain.media_allowed(p_resource,p_id) THEN RAISE EXCEPTION 'Media target not found' USING ERRCODE='P0002';END IF;
 kind_:=CASE p_resource WHEN 'users' THEN 'person' WHEN 'brandings' THEN 'branding' WHEN 'products' THEN 'product' WHEN 'product_images' THEN 'product' ELSE 'media:'||p_resource END;
 IF p_resource='product_images' THEN SELECT product_id INTO entity_ FROM sa_snapshot_20261019.sa_product_images WHERE id=p_id;END IF;
 IF p_write THEN
  IF p_resource NOT IN('brandings','products','product_images','users') THEN
   valid_:=(context_->>'platform')::boolean OR(context_->>'admin')::boolean;
  ELSIF NOT(context_->>'platform')::boolean THEN
   a:=sa_domain.actor();
   IF p_resource='users' THEN valid_:=p_id=a.user_id;
   ELSIF p_resource IN('products','product_images') THEN
    valid_:=sa_domain.catalog_enabled() AND(sa_domain.effective_capabilities(a.role_id,a.features)->>'configure')::boolean
      AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_products WHERE id=entity_ AND created_by_id=a.user_id);
   ELSE
    valid_:=sa_domain.catalog_enabled() AND(sa_domain.effective_capabilities(a.role_id,a.features)->>'configure')::boolean
    AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_brandings b WHERE b.id=p_id AND b.item_id IS NULL
      AND NOT EXISTS(SELECT FROM sa_domain.archived_designs WHERE branding_id=b.id)
      AND(EXISTS(SELECT FROM sa_domain.design_owners d WHERE d.branding_id=b.id AND d.actor_id=a.auth_id AND d.generation=(SELECT generation FROM sa_domain.runtime_state))
       OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_products p WHERE p.id=b.product_id AND p.created_by_id=a.user_id)));
   END IF;
  END IF;
  IF valid_ IS NOT TRUE THEN RAISE EXCEPTION 'Media target not editable' USING ERRCODE='P0002';END IF;
 END IF;
 EXECUTE format('SELECT jsonb_build_object(''source'',%I,''updated_at'',updated_at) FROM sa_snapshot_20261019.%I WHERE id=$1',p_field,'sa_'||p_resource) INTO record_ USING p_id;
 version_:=sa_domain.version(kind_,entity_);
 RETURN jsonb_build_object('kind',kind_,'entity_id',entity_::text,'entity_version',version_,'version',version_||':'||encode(sha256(convert_to(record_::text,'UTF8')),'hex'),'source',record_->'source');
END $f$;
ALTER FUNCTION sa_domain.media_target(text,bigint,text,boolean) OWNER TO sa_guard;
GRANT SELECT ON sa_domain.archived_designs,sa_domain.entity_versions TO sa_guard;
CREATE POLICY media_versions_guard ON sa_domain.entity_versions FOR SELECT TO sa_guard USING(true);
CREATE POLICY media_archived_guard ON sa_domain.archived_designs FOR SELECT TO sa_guard USING(true);

-- Reuse command deduplication/audit with explicit platform identity; no synthetic legacy role.
CREATE FUNCTION sa_domain.begin_media_command(p_operation text,p_key uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();s sa_sync.environment_state%ROWTYPE;old sa_domain.commands%ROWTYPE;
 actor_ uuid:=(ctx->>'auth_id')::uuid;generation_ bigint;allow_ boolean;hash_ bytea:=sha256(convert_to(p_payload::text,'UTF8'));
BEGIN
 IF p_key IS NULL OR p_payload IS NULL OR octet_length(p_payload::text)>32768 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,2) THEN RAISE EXCEPTION 'Relationships changing' USING ERRCODE='40001';END IF;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;SELECT generation,allow_test_writes INTO generation_,allow_ FROM sa_domain.runtime_state;
 IF s.active_job IS NOT NULL OR(NOT s.cutover AND NOT(s.environment='staging' AND allow_)) THEN RAISE EXCEPTION 'Environment is read only' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.commands(actor_id,key,operation,payload_hash,generation) VALUES(actor_,p_key,p_operation,hash_,generation_) ON CONFLICT DO NOTHING;
 SELECT * INTO old FROM sa_domain.commands WHERE actor_id=actor_ AND key=p_key FOR UPDATE;
 IF old.generation<>generation_ THEN RAISE EXCEPTION 'Command predates refresh' USING ERRCODE='40001';END IF;
 IF old.operation<>p_operation OR old.payload_hash<>hash_ THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='22023';END IF;
 RETURN old.result;
END $f$;
CREATE FUNCTION sa_domain.finish_media_command(p_operation text,p_key uuid,p_resource text,p_id bigint,p_result jsonb,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();BEGIN
 UPDATE sa_domain.commands SET result=p_result WHERE actor_id=(ctx->>'auth_id')::uuid AND key=p_key AND operation=p_operation AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Command not reserved' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes)
 VALUES((ctx->>'auth_id')::uuid,(ctx->>'legacy_user_id')::bigint,p_operation,'media',p_id,p_key,p_changes||jsonb_build_object('resource',p_resource));
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 SELECT(ctx->>'auth_id')::uuid,p_operation,'media',p_id,p_key,generation,p_changes||jsonb_build_object('resource',p_resource) FROM sa_domain.runtime_state;
 UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 RETURN p_result;
END $f$;

CREATE FUNCTION sa_domain.account_upload_reserve(p_target jsonb,p_file jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached_ jsonb;target_ jsonb;ctx jsonb:=sa_domain.ops_context();u sa_domain.media_uploads%ROWTYPE;id_ bigint;resource_ text;field_ text;max_ bigint;bytes_ bigint;mime_ text;name_ text;count_ bigint;sum_ bigint;result_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_target,ARRAY['resource','record_id','field']);PERFORM sa_domain.check_fields(p_file,ARRAY['filename','bytes','content_type']);
 resource_:=p_target->>'resource';field_:=p_target->>'field';id_:=sa_domain.input_id(p_target->'record_id');
 target_:=sa_domain.media_target(resource_,id_,field_,true);
 name_:=p_file->>'filename';mime_:=p_file->>'content_type';
 IF coalesce(p_file->>'bytes','')!~'^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'Invalid file size' USING ERRCODE='22023';END IF;bytes_:=(p_file->>'bytes')::bigint;
 IF name_ IS NULL OR length(name_) NOT BETWEEN 1 AND 180 OR name_~'[/\\[:cntrl:]]' OR jsonb_typeof(p_file->'filename')<>'string' THEN RAISE EXCEPTION 'Invalid filename' USING ERRCODE='22023';END IF;
 max_:=CASE mime_ WHEN 'image/png' THEN 10485760 WHEN 'image/jpeg' THEN 10485760 WHEN 'image/webp' THEN 10485760 WHEN 'image/gif' THEN 10485760 WHEN 'image/svg+xml' THEN 5242880 WHEN 'application/pdf' THEN 26214400 WHEN 'video/mp4' THEN 104857600 WHEN 'video/webm' THEN 104857600 END;
 IF max_ IS NULL OR bytes_>max_ OR
  (field_='embeded_video' AND mime_ NOT IN('video/mp4','video/webm')) OR
  (field_<>'embeded_video' AND mime_ IN('video/mp4','video/webm')) OR
  (mime_='application/pdf' AND NOT(resource_='brandings' AND field_='attachment' OR resource_='asset_infos')) OR
  (mime_='image/svg+xml' AND NOT(resource_ IN('asset_infos','add_ons','brandings'))) THEN RAISE EXCEPTION 'Unsupported file type or size' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_media_command('media.reserved',p_idempotency_key,jsonb_build_object('target',p_target,'file',p_file,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 IF target_->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Media changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('media-quota:'||(ctx->>'auth_id'),784139));
 SELECT count(*) FILTER(WHERE state IN('reserved','verified') AND expires_at>now()),coalesce(sum(bytes),0) INTO count_,sum_ FROM sa_domain.media_uploads WHERE actor_id=(ctx->>'auth_id')::uuid AND created_at>now()-interval '24 hours';
 IF count_>=20 OR sum_+bytes_>2147483648 THEN RAISE EXCEPTION 'Upload quota exceeded' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.media_uploads(actor_id,generation,resource,record_id,field,expected_version,filename,bytes,content_type)
 SELECT(ctx->>'auth_id')::uuid,generation,resource_,id_,field_,p_expected_version,name_,bytes_,mime_ FROM sa_domain.runtime_state RETURNING * INTO u;
 result_:=jsonb_build_object('upload_id',u.id,'path','pending/'||u.id,'bucket','squad-uploads','expires_at',u.expires_at,'bytes',u.bytes::text,'content_type',u.content_type,'filename',u.filename,'state',u.state);
 UPDATE sa_domain.commands SET result=result_ WHERE actor_id=u.actor_id AND key=p_idempotency_key;RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid) OWNER TO sa_media_writer;

CREATE FUNCTION sa_domain.account_upload_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();u sa_domain.media_uploads%ROWTYPE;target_ jsonb;BEGIN
 SELECT * INTO u FROM sa_domain.media_uploads WHERE id=p_id AND actor_id=(ctx->>'auth_id')::uuid AND generation=(SELECT generation FROM sa_domain.runtime_state);
 IF u.id IS NULL THEN RAISE EXCEPTION 'Upload not found' USING ERRCODE='P0002';END IF;
 target_:=sa_domain.media_target(u.resource,u.record_id,u.field,true);
 IF u.state NOT IN('verified','attached') AND u.expires_at<=now() THEN RAISE EXCEPTION 'Upload expired' USING ERRCODE='55000';END IF;
 IF u.state NOT IN('reserved','verified','attached') THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('upload_id',u.id,'path','pending/'||u.id,'bucket','squad-uploads','bytes',u.bytes::text,'content_type',u.content_type,'filename',u.filename,'state',u.state,'sha256',u.sha256,'result',u.result,'expected_version',u.expected_version,'current_version',target_->>'version');
END $f$;
ALTER FUNCTION sa_domain.account_upload_get(uuid) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.account_upload_verified(p_id uuid,p_sha256 text,p_bytes bigint,p_content_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE u sa_domain.media_uploads%ROWTYPE;object_ sa_media.objects%ROWTYPE;BEGIN
 IF current_setting('role',true)<>'service_role' OR coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Service required' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 SELECT * INTO u FROM sa_domain.media_uploads WHERE id=p_id FOR UPDATE;
 IF u.id IS NULL OR u.generation<>(SELECT generation FROM sa_domain.runtime_state) OR u.state NOT IN('reserved','verified','attached') THEN RAISE EXCEPTION 'Upload not found' USING ERRCODE='P0002';END IF;
 IF p_sha256 IS NULL OR p_sha256!~'^[a-f0-9]{64}$' OR p_bytes IS DISTINCT FROM u.bytes OR p_content_type IS DISTINCT FROM u.content_type THEN RAISE EXCEPTION 'Verification does not match upload' USING ERRCODE='22023';END IF;
 IF u.state IN('verified','attached') THEN
  IF u.sha256<>p_sha256 THEN RAISE EXCEPTION 'Upload hash conflict' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('upload_id',u.id,'state',u.state);
 END IF;
 IF u.expires_at<=now() THEN RAISE EXCEPTION 'Upload expired' USING ERRCODE='55000';END IF;
 INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(p_sha256,'sha256/'||left(p_sha256,2)||'/'||p_sha256,p_bytes,p_content_type) ON CONFLICT DO NOTHING;
 SELECT * INTO object_ FROM sa_media.objects WHERE sha256=p_sha256;
 IF object_.bytes<>p_bytes OR object_.content_type<>p_content_type OR object_.object_path<>'sha256/'||left(p_sha256,2)||'/'||p_sha256 THEN RAISE EXCEPTION 'Stored object conflict' USING ERRCODE='40001';END IF;
 UPDATE sa_domain.media_uploads SET state='verified',sha256=p_sha256,verified_at=now() WHERE id=p_id;
 RETURN jsonb_build_object('upload_id',u.id,'state','verified');
END $f$;
ALTER FUNCTION sa_domain.account_upload_verified(uuid,text,bigint,text) OWNER TO sa_media_writer;

CREATE FUNCTION sa_domain.write_media(p_resource text,p_id bigint,p_field text,p_expected_version text,p_sha256 text,p_key uuid,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE target_ jsonb;result_ jsonb;old_ jsonb;marker_ text;version_ text;resource_ text:=p_resource;id_ bigint:=p_id;field_ text:=p_field;BEGIN
 target_:=sa_domain.media_target(p_resource,p_id,p_field,true);
 -- Same entity lock order as ordinary business edits; then lock the concrete row.
 PERFORM pg_advisory_xact_lock(hashtextextended((target_->>'kind')||':'||(target_->>'entity_id'),784139));
 EXECUTE format('SELECT id FROM sa_snapshot_20261019.%I WHERE id=$1 FOR UPDATE','sa_'||p_resource) USING p_id;
 target_:=sa_domain.media_target(p_resource,p_id,p_field,true);
 IF target_->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Media changed; reload' USING ERRCODE='40001';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO old_ FROM sa_media.references r WHERE resource=p_resource AND record_id=p_id AND field=p_field;
 INSERT INTO sa_domain.media_history(actor_id,generation,resource,record_id,field,operation,previous_references,sha256,command_key)
 SELECT sa_domain.request_uid(),generation,p_resource,p_id,p_field,p_operation,old_,p_sha256,p_key FROM sa_domain.runtime_state;
 marker_:=CASE WHEN p_sha256 IS NOT NULL THEN 'squad:'||p_sha256 END;
 IF p_resource='products' AND p_field='images' THEN
  IF p_sha256 IS NULL THEN RAISE EXCEPTION 'Detach the individual product image' USING ERRCODE='22023';END IF;
  resource_:='product_images';field_:='image';
  INSERT INTO sa_snapshot_20261019.sa_product_images(product_id,image,created_at,updated_at) VALUES(p_id,marker_,now(),now()) RETURNING id INTO id_;
  UPDATE sa_snapshot_20261019.sa_products SET updated_at=now() WHERE id=p_id;
 ELSE
  EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %I=$1,updated_at=clock_timestamp() WHERE id=$2','sa_'||p_resource,p_field) USING marker_,p_id;
  DELETE FROM sa_media.references WHERE resource=p_resource AND record_id=p_id AND field=p_field;
  DELETE FROM sa_admin.media WHERE resource=p_resource AND record_id=p_id AND field=p_field;
 END IF;
 IF p_sha256 IS NOT NULL THEN INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES(resource_,id_,field_,'',marker_,'ready',p_sha256);END IF;
 version_:=sa_domain.bump_version(target_->>'kind',(target_->>'entity_id')::bigint,target_->>'entity_version');
 result_:=jsonb_build_object('resource',resource_,'record_id',id_::text,'field',field_,'status',CASE WHEN p_sha256 IS NULL THEN 'empty' ELSE 'ready' END,'entity_version',version_,'version',sa_domain.media_target(resource_,id_,field_,false)->>'version');
 RETURN result_;
END $f$;
CREATE FUNCTION sa_domain.v1_media_attach(p_upload_id uuid,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();u sa_domain.media_uploads%ROWTYPE;cached_ jsonb;result_ jsonb;BEGIN
 cached_:=sa_domain.begin_media_command('media.attached',p_idempotency_key,jsonb_build_object('upload_id',p_upload_id,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 SELECT * INTO u FROM sa_domain.media_uploads WHERE id=p_upload_id AND actor_id=(ctx->>'auth_id')::uuid AND generation=(SELECT generation FROM sa_domain.runtime_state) FOR UPDATE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'Upload not found' USING ERRCODE='P0002';END IF;
 IF u.state<>'verified' OR u.expires_at<=now() THEN RAISE EXCEPTION 'Upload is not verified or has expired' USING ERRCODE='55000';END IF;
 IF u.expected_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Media version mismatch' USING ERRCODE='40001';END IF;
 result_:=sa_domain.write_media(u.resource,u.record_id,u.field,p_expected_version,u.sha256,p_idempotency_key,'attach');
 UPDATE sa_domain.media_uploads SET state='attached',attached_at=now(),result=result_ WHERE id=u.id;
 RETURN sa_domain.finish_media_command('media.attached',p_idempotency_key,u.resource,u.record_id,result_,jsonb_build_object('field',u.field,'upload_id',u.id));
END $f$;
ALTER FUNCTION sa_domain.v1_media_attach(uuid,text,uuid) OWNER TO sa_media_writer;
CREATE FUNCTION sa_domain.v1_media_detach(p_target jsonb,p_expected_version text,p_reason text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached_ jsonb;id_ bigint;result_ jsonb;BEGIN
 PERFORM sa_domain.check_fields(p_target,ARRAY['resource','record_id','field']);id_:=sa_domain.input_id(p_target->'record_id');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_media_command('media.detached',p_idempotency_key,jsonb_build_object('target',p_target,'version',p_expected_version,'reason',p_reason));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 result_:=sa_domain.write_media(p_target->>'resource',id_,p_target->>'field',p_expected_version,NULL,p_idempotency_key,'detach');
 RETURN sa_domain.finish_media_command('media.detached',p_idempotency_key,p_target->>'resource',id_,result_,jsonb_build_object('field',p_target->>'field','reason',p_reason));
END $f$;
ALTER FUNCTION sa_domain.v1_media_detach(jsonb,text,text,uuid) OWNER TO sa_media_writer;

-- Include a field-specific version in descriptors without granting write access.
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.account_media_resolve(jsonb)'::regprocedure);
 definition_:=replace(definition_,'result_:=result_||jsonb_build_array(descriptor_);',
 'IF sa_domain.media_upload_fields()->resource_?field_ THEN descriptor_:=descriptor_||jsonb_build_object(''version'',sa_domain.media_target(resource_,id_,field_,false)->>''version'');END IF;result_:=result_||jsonb_build_array(descriptor_);');
 EXECUTE definition_;
END $f$;
DO $f$ DECLARE r record;name_ text;BEGIN
 FOR r IN SELECT p.oid::regprocedure sig,p.proname,pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['media_upload_fields','media_target','begin_media_command','finish_media_command','write_media','account_upload_reserve','account_upload_get','account_upload_verified','v1_media_attach','v1_media_detach']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',r.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_media_writer',r.sig);
  IF r.proname IN('media_upload_fields','media_target') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_guard',r.sig);END IF;
  IF r.proname LIKE 'account_upload_%' OR r.proname LIKE 'v1_media_%' THEN
   SELECT string_agg('$'||i,',') INTO name_ FROM generate_series(1,(SELECT pronargs FROM pg_proc WHERE oid=r.sig)) i;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',r.proname,r.args,'SELECT sa_domain.'||r.proname||'('||name_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',r.proname,r.identity);
   IF r.proname='account_upload_verified' THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),%s TO service_role',r.proname,r.identity,r.sig);
   ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),%s TO sa_app,authenticated',r.proname,r.identity,r.sig);END IF;
  END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.job_handler(text,jsonb),sa_domain.worker_actor_id(),sa_domain.request_uid(),sa_domain.ops_context(),sa_domain.version(text,bigint),sa_domain.bump_version(text,bigint,text),sa_domain.check_fields(jsonb,text[]),sa_domain.input_id(jsonb) TO sa_media_writer;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
