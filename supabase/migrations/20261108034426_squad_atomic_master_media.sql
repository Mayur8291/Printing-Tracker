BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_media_writer;
GRANT SELECT ON sa_admin.master_contracts TO sa_guard;
CREATE POLICY squad_master_contract_guard ON sa_admin.master_contracts FOR SELECT TO sa_guard USING(true);
-- Three existing Masters expose virtual image fields without source columns.
-- Keep using their established private overrides; never alter the legacy schema.
GRANT INSERT,UPDATE ON sa_admin.media TO sa_media_writer;
GRANT SELECT ON sa_admin.media TO sa_guard;
CREATE POLICY media_override_guard ON sa_admin.media FOR SELECT TO sa_guard USING(true);
CREATE POLICY media_writer_override_insert ON sa_admin.media FOR INSERT TO sa_media_writer WITH CHECK(true);
DO $f$ DECLARE n text;definition_ text;BEGIN
 FOREACH n IN ARRAY ARRAY['media_fields','media_upload_fields'] LOOP
  definition_:=pg_get_functiondef(('sa_domain.'||n||'()')::regprocedure);
  EXECUTE replace(definition_,$s$}'::jsonb$s$,$s$}'::jsonb || '{"rmp_brands":["image"],"rmp_sizes":["image"],"rmp_skus":["image"]}'::jsonb$s$);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['rmp_brands','rmp_sizes','rmp_skus'] LOOP
  EXECUTE format('GRANT SELECT(id,updated_at),UPDATE(updated_at) ON sa_snapshot_20261019.%I TO sa_media_writer','sa_'||n);
  EXECUTE format('GRANT SELECT(updated_at) ON sa_snapshot_20261019.%I TO sa_guard','sa_'||n);
  EXECUTE format('CREATE POLICY squad_media_write ON sa_snapshot_20261019.%I TO sa_media_writer USING(true) WITH CHECK(true)','sa_'||n);
 END LOOP;
 definition_:=pg_get_functiondef('sa_domain.media_allowed(text,bigint)'::regprocedure);
 definition_:=replace(definition_,$s$'rmp_categories','rmp_classes','bulk_uploads'$s$,$s$'rmp_categories','rmp_classes','rmp_brands','rmp_sizes','rmp_skus','bulk_uploads'$s$);
 definition_:=replace(definition_,$s$WHEN 'rmp_classes' THEN$s$,$s$WHEN 'rmp_brands' THEN RETURN browse_ AND p_id IN(SELECT sa_domain.catalog_brand_ids());
 WHEN 'rmp_skus' THEN RETURN browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=p_id AND is_deleted IS NOT TRUE AND rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids()));
 WHEN 'rmp_sizes' THEN RETURN browse_ AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_sizes WHERE id=p_id AND is_deleted IS NOT TRUE);
 WHEN 'rmp_classes' THEN$s$);EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.media_target(text,bigint,text,boolean)'::regprocedure);
 definition_:=replace(definition_,$s$ EXECUTE format('SELECT jsonb_build_object(''source'',%I,''updated_at'',updated_at) FROM sa_snapshot_20261019.%I WHERE id=$1',p_field,'sa_'||p_resource) INTO record_ USING p_id;$s$,$s$
 IF p_resource IN('rmp_brands','rmp_sizes','rmp_skus') AND p_field='image' THEN
  EXECUTE format('SELECT jsonb_build_object(''source'',(SELECT url FROM sa_admin.media WHERE resource=$2 AND record_id=$1 AND field=''image''),''updated_at'',updated_at) FROM sa_snapshot_20261019.%I WHERE id=$1','sa_'||p_resource) INTO record_ USING p_id,p_resource;
 ELSE
  EXECUTE format('SELECT jsonb_build_object(''source'',%I,''updated_at'',updated_at) FROM sa_snapshot_20261019.%I WHERE id=$1',p_field,'sa_'||p_resource) INTO record_ USING p_id;
 END IF;$s$);EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.account_media_resolve(jsonb)'::regprocedure);
 definition_:=replace(definition_,$s$  EXECUTE format('SELECT %I::text FROM sa_snapshot_20261019.%I WHERE id=$1',field_,'sa_'||resource_) INTO source_ USING id_;$s$,$s$
  IF resource_ IN('rmp_brands','rmp_sizes','rmp_skus') AND field_='image' THEN SELECT url INTO source_ FROM sa_admin.media WHERE resource=resource_ AND record_id=id_ AND field=field_;
  ELSE EXECUTE format('SELECT %I::text FROM sa_snapshot_20261019.%I WHERE id=$1',field_,'sa_'||resource_) INTO source_ USING id_;END IF;$s$);EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.write_media(text,bigint,text,text,text,uuid,text)'::regprocedure);
 definition_:=replace(definition_,$s$ ELSE
  EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %I=$1,updated_at=clock_timestamp() WHERE id=$2'$s$,$s$ ELSIF p_resource IN('rmp_brands','rmp_sizes','rmp_skus') AND p_field='image' THEN
  EXECUTE format('UPDATE sa_snapshot_20261019.%I SET updated_at=clock_timestamp() WHERE id=$1','sa_'||p_resource) USING p_id;
  DELETE FROM sa_media.references WHERE resource=p_resource AND record_id=p_id AND field=p_field;
  DELETE FROM sa_admin.media WHERE resource=p_resource AND record_id=p_id AND field=p_field;
  IF marker_ IS NOT NULL THEN INSERT INTO sa_admin.media(resource,record_id,field,url) VALUES(p_resource,p_id,p_field,marker_);END IF;
 ELSE
  EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %I=$1,updated_at=clock_timestamp() WHERE id=$2'$s$);EXECUTE definition_;
 -- Read virtual overrides through the same verified private reference as columns.
 definition_:=pg_get_functiondef('sa_admin.read_record(text,bigint,boolean)'::regprocedure);
 definition_:=replace(definition_,$s$FOR v_field IN SELECT jsonb_array_elements_text(spec->'media') LOOP$s$,$s$FOR v_field IN SELECT DISTINCT value FROM jsonb_array_elements_text((spec->'media')||CASE p_resource WHEN 'rmp_classes' THEN '["embeded_video"]'::jsonb WHEN 'promotions' THEN '["link"]'::jsonb ELSE '[]'::jsonb END) LOOP$s$);
 definition_:=replace(definition_,$s$    ELSIF coalesce(result->>v_field,'')<>'' THEN$s$,$s$    END IF;
    IF coalesce(result->>v_field,'')<>'' THEN$s$);
 definition_:=replace(definition_,$s$CASE WHEN media_.status='ready' THEN 'canto-media://canto-media/'||media_.object_path ELSE NULL END$s$,$s$CASE WHEN media_.status='ready' THEN 'canto-media://canto-media/'||media_.object_path WHEN v_field IN('embeded_video','link') AND result->>v_field ~* '^https://(www[.])?(youtube[.]com|youtu[.]be|drive[.]google[.]com|docs[.]google[.]com|vimeo[.]com)/[^[:space:]]*$' AND length(result->>v_field)<=4096 THEN result->>v_field ELSE NULL END$s$);EXECUTE definition_;
END $f$;

CREATE FUNCTION sa_domain.master_upload_draft(p_resource text,p_field text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT(sa_domain.ops_context()->>'platform')::boolean OR NOT coalesce(sa_domain.media_upload_fields()->p_resource?p_field,false)
 OR NOT EXISTS(SELECT FROM sa_admin.master_contracts WHERE resource=p_resource AND coalesce((spec->>'readOnly')::boolean,false)=false AND(spec->'fields'?p_field)) THEN RAISE EXCEPTION 'Master media unavailable' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('version','new');
END $f$;
ALTER FUNCTION sa_domain.master_upload_draft(text,text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.master_upload_draft(text,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.master_upload_draft(text,text) TO sa_guard,sa_media_writer;
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid)'::regprocedure);
 definition_:=replace(definition_,$s$id_:=sa_domain.input_id(p_target->'record_id');$s$,$s$id_:=CASE WHEN p_target->'record_id'='null'::jsonb THEN 0 ELSE sa_domain.input_id(p_target->'record_id') END;$s$);
 definition_:=replace(definition_,$s$target_:=sa_domain.media_target(resource_,id_,field_,true);$s$,$s$target_:=CASE WHEN id_=0 THEN sa_domain.master_upload_draft(resource_,field_) ELSE sa_domain.media_target(resource_,id_,field_,true) END;$s$);
 EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.account_upload_get(uuid)'::regprocedure);
 definition_:=replace(definition_,$s$target_:=sa_domain.media_target(u.resource,u.record_id,u.field,true);$s$,$s$target_:=CASE WHEN u.record_id=0 THEN sa_domain.master_upload_draft(u.resource,u.field) ELSE sa_domain.media_target(u.resource,u.record_id,u.field,true) END;$s$);EXECUTE definition_;
 -- Preserve the existing Printing Tracker Masters editing contract in mirror
 -- mode. Such edits still advance edit_revision and require explicit discard
 -- before refresh. This exception cannot write personal/application resources.
 definition_:=pg_get_functiondef('sa_domain.begin_media_command(text,uuid,jsonb)'::regprocedure);
 definition_:=replace(definition_,$s$NOT s.cutover AND NOT(s.environment='staging' AND allow_)$s$,$s$NOT s.cutover AND NOT(s.environment='staging' AND allow_) AND NOT(ctx->>'platform')::boolean$s$);EXECUTE definition_;
END $f$;

CREATE FUNCTION sa_domain.account_master_capabilities() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT(sa_domain.ops_context()->>'platform')::boolean THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('upload_pipeline','verified_private','atomic_master_save',true,'draft_version','new');
END $f$;
ALTER FUNCTION sa_domain.account_master_capabilities() OWNER TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_admin.master_request(text,text,jsonb),sa_admin.read_record(text,bigint,boolean) TO sa_media_writer;
GRANT SELECT ON sa_admin.master_contracts TO sa_media_writer;
GRANT UPDATE(link) ON sa_snapshot_20261019.sa_promotions TO sa_media_writer;
CREATE POLICY squad_master_contract_media ON sa_admin.master_contracts FOR SELECT TO sa_media_writer USING(true);
CREATE FUNCTION sa_domain.account_master_save(p_resource text,p_action text,p_payload jsonb,p_upload_ids uuid[],p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();cached_ jsonb;id_ bigint;record_ jsonb;uploads_ sa_domain.media_uploads[];u sa_domain.media_uploads%ROWTYPE;
 external_ jsonb:='{}';old_refs_ jsonb;fields_ text[]:='{}';detaches_ text[]:='{}';values_ jsonb:=coalesce(p_payload->'values','{}');spec_ jsonb;field_ text;value_ jsonb;target_ jsonb;result_ jsonb;version_ text;
BEGIN
 IF NOT(ctx->>'platform')::boolean THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.check_fields(p_payload,ARRAY['id','values','relations','expectedUpdatedAt']);
 IF p_action NOT IN('create','update') OR p_upload_ids IS NULL OR coalesce(cardinality(p_upload_ids),0)>10 OR cardinality(p_upload_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_upload_ids) x) THEN RAISE EXCEPTION 'Invalid master save' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(values_)<>'object' THEN RAISE EXCEPTION 'Invalid master fields' USING ERRCODE='22023';END IF;
 SELECT spec INTO spec_ FROM sa_admin.master_contracts WHERE resource=p_resource;
 IF spec_ IS NULL THEN RAISE EXCEPTION 'Unknown master' USING ERRCODE='22023';END IF;
 id_:=CASE WHEN p_action='create' THEN 0 ELSE sa_domain.input_id(p_payload->'id') END;
 IF p_action='create' AND nullif(p_payload->>'id','') IS NOT NULL OR p_action='update' AND nullif(p_payload->>'expectedUpdatedAt','') IS NULL THEN RAISE EXCEPTION 'Master identity/version required' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_media_command('master.saved',p_idempotency_key,jsonb_build_object('resource',p_resource,'action',p_action,'payload',p_payload,'uploads',p_upload_ids));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 -- Acquire the same global publication/write lock used by existing masters;
 -- every below write (record, relations, file references and history) is atomic.
 IF NOT pg_try_advisory_xact_lock(20261107,1) THEN RAISE EXCEPTION 'Concurrent edit or refresh; retry' USING ERRCODE='40001';END IF;
 FOR u IN SELECT * FROM sa_domain.media_uploads WHERE id=ANY(p_upload_ids) ORDER BY id FOR UPDATE LOOP
  IF u.actor_id<>(ctx->>'auth_id')::uuid OR u.generation<>(SELECT generation FROM sa_domain.runtime_state) OR u.resource<>p_resource OR u.record_id<>id_ THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='P0002';END IF;
  IF u.state<>'verified' OR u.expires_at<=now() THEN RAISE EXCEPTION 'Verify every file before saving' USING ERRCODE='55000';END IF;
  target_:=CASE WHEN id_=0 THEN sa_domain.master_upload_draft(u.resource,u.field) ELSE sa_domain.media_target(u.resource,u.record_id,u.field,true) END;
  IF target_->>'version'<>u.expected_version THEN RAISE EXCEPTION 'Master media changed' USING ERRCODE='40001';END IF;
  IF u.field=ANY(fields_) OR values_?u.field THEN RAISE EXCEPTION 'Duplicate media field' USING ERRCODE='22023';END IF;
  fields_:=array_append(fields_,u.field);uploads_:=array_append(uploads_,u);
 END LOOP;
 IF coalesce(cardinality(uploads_),0)<>cardinality(p_upload_ids) THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='P0002';END IF;
 FOR field_,value_ IN SELECT * FROM jsonb_each(values_) LOOP
  IF p_resource='rmp_classes' AND field_='embeded_video' OR p_resource='promotions' AND field_='link' THEN
   IF value_ NOT IN('null'::jsonb,'""'::jsonb) AND (jsonb_typeof(value_)<>'string' OR length(value_#>>'{}')>4096 OR value_#>>'{}' !~* '^https://(www[.])?(youtube[.]com|youtu[.]be|drive[.]google[.]com|docs[.]google[.]com|vimeo[.]com)/[^[:space:]]*$') THEN RAISE EXCEPTION 'Unsupported media link' USING ERRCODE='22023';END IF;
   external_:=external_||jsonb_build_object(field_,CASE WHEN value_='""'::jsonb THEN 'null'::jsonb ELSE value_ END);values_:=values_-field_;
  ELSIF spec_->'media'?field_ THEN
   IF value_<>'null'::jsonb AND value_<>'""'::jsonb THEN RAISE EXCEPTION 'Media must use a verified upload' USING ERRCODE='22023';END IF;
   IF id_<>0 THEN detaches_:=array_append(detaches_,field_);END IF;values_:=values_-field_;
  END IF;
 END LOOP;
 record_:=sa_admin.master_request(p_resource,p_action,p_payload||jsonb_build_object('values',values_));id_:=(record_->>'id')::bigint;
 FOR field_,value_ IN SELECT * FROM jsonb_each(external_) LOOP
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO old_refs_ FROM sa_media.references r WHERE resource=p_resource AND record_id=id_ AND field=field_;
  INSERT INTO sa_domain.media_history(actor_id,generation,resource,record_id,field,operation,previous_references,command_key)
   SELECT (ctx->>'auth_id')::uuid,generation,p_resource,id_,field_,'master_link',old_refs_,p_idempotency_key FROM sa_domain.runtime_state;
  EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %I=$1,updated_at=clock_timestamp() WHERE id=$2','sa_'||p_resource,field_) USING value_#>>'{}',id_;
  DELETE FROM sa_media.references WHERE resource=p_resource AND record_id=id_ AND field=field_;
  DELETE FROM sa_admin.media WHERE resource=p_resource AND record_id=id_ AND field=field_;
  IF value_<>'null'::jsonb THEN INSERT INTO sa_media.references(resource,record_id,field,source_value,source_url,status) VALUES(p_resource,id_,field_,value_#>>'{}',value_#>>'{}','external');END IF;
  PERFORM sa_domain.bump_version('media:'||p_resource,id_,sa_domain.version('media:'||p_resource,id_));
 END LOOP;
 FOREACH u IN ARRAY coalesce(uploads_,ARRAY[]::sa_domain.media_uploads[]) LOOP
  target_:=sa_domain.media_target(p_resource,id_,u.field,true);
  result_:=sa_domain.write_media(p_resource,id_,u.field,target_->>'version',u.sha256,p_idempotency_key,'master_attach');
  UPDATE sa_domain.media_uploads SET state='attached',record_id=id_,attached_at=now(),result=result_ WHERE id=u.id;
 END LOOP;
 FOREACH field_ IN ARRAY detaches_ LOOP
  target_:=sa_domain.media_target(p_resource,id_,field_,true);
  PERFORM sa_domain.write_media(p_resource,id_,field_,target_->>'version',NULL,p_idempotency_key,'master_detach');
 END LOOP;
 record_:=sa_admin.read_record(p_resource,id_,true);
 RETURN sa_domain.finish_media_command('master.saved',p_idempotency_key,p_resource,id_,record_,jsonb_build_object('action',p_action,'uploaded_fields',fields_,'detached_fields',detaches_,'external_fields',ARRAY(SELECT jsonb_object_keys(external_))));
END $f$;
ALTER FUNCTION sa_domain.account_master_save(text,text,jsonb,uuid[],uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.account_master_save(text,text,jsonb,uuid[],uuid),sa_domain.account_master_capabilities() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION canto_api.account_master_save(p_resource text,p_action text,p_payload jsonb,p_upload_ids uuid[],p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_master_save(p_resource,p_action,p_payload,p_upload_ids,p_idempotency_key) $f$;
CREATE FUNCTION canto_api.account_master_capabilities() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_master_capabilities() $f$;
REVOKE ALL ON FUNCTION canto_api.account_master_save(text,text,jsonb,uuid[],uuid),canto_api.account_master_capabilities() FROM PUBLIC,anon,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.account_master_save(text,text,jsonb,uuid[],uuid),canto_api.account_master_capabilities(),sa_domain.account_master_save(text,text,jsonb,uuid[],uuid),sa_domain.account_master_capabilities() TO authenticated;
-- Prevent bypassing scoped grants through the old blanket Storage policy.
CREATE INDEX IF NOT EXISTS squad_media_ready_hash ON sa_media.references(sha256) WHERE status='ready';
CREATE FUNCTION sa_domain.master_storage_path(p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r record;source_ text;BEGIN
 IF NOT sa_admin.is_admin() THEN RETURN false;END IF;
 FOR r IN SELECT ref.resource,ref.record_id,ref.field,ref.pointer,ref.source_value FROM sa_media.objects o JOIN sa_media.references ref USING(sha256)
 WHERE o.object_path=p_path AND ref.status='ready' AND ref.resource IN('add_ons','asset_infos','authorized_brands','base_product_types','base_products','fabrics','promotional_banners','promotions','rmp_categories','rmp_classes','rmp_brands','rmp_sizes','rmp_skus','bulk_uploads','catalogues') LOOP
  IF NOT coalesce(sa_domain.media_fields()->r.resource?r.field,false) THEN CONTINUE;END IF;
  IF r.resource='catalogues' AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_catalogues WHERE id=r.record_id AND is_expired IS NOT TRUE) THEN CONTINUE;END IF;
  IF r.resource IN('rmp_brands','rmp_sizes','rmp_skus') AND r.field='image' THEN SELECT url INTO source_ FROM sa_admin.media WHERE resource=r.resource AND record_id=r.record_id AND field=r.field;
  ELSE EXECUTE format('SELECT %I::text FROM sa_snapshot_20261019.%I WHERE id=$1',r.field,'sa_'||r.resource) INTO source_ USING r.record_id;END IF;
  IF sa_domain.media_leaf(source_,r.pointer)=r.source_value THEN RETURN true;END IF;
 END LOOP;
 RETURN false;
END $f$;
ALTER FUNCTION sa_domain.master_storage_path(text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.master_storage_path(text) FROM PUBLIC,anon,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.master_storage_path(text) TO authenticated;
DROP POLICY IF EXISTS canto_media_admin_read ON storage.objects;
CREATE POLICY canto_media_admin_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='canto-media' AND sa_domain.master_storage_path(name));
-- New files are staged privately and verified by the account service.
DROP POLICY IF EXISTS canto_masters_admin_upload ON storage.objects;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
