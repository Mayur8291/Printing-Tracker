BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_media_writer;
CREATE TABLE sa_domain.document_attachments(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL,generation bigint NOT NULL,
 purpose text NOT NULL DEFAULT 'catalogue_terms' CHECK(purpose='catalogue_terms'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready','expired')),
 sha256 text REFERENCES sa_media.objects(sha256),created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '48 hours',claimed_at timestamptz,
 CHECK((state='ready')=(sha256 IS NOT NULL) OR state='expired')
);
CREATE INDEX document_attachment_unclaimed ON sa_domain.document_attachments(expires_at,id) WHERE claimed_at IS NULL AND state<>'expired';
ALTER TABLE sa_domain.document_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.document_attachments FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.document_attachments TO sa_media_writer;
GRANT SELECT ON sa_domain.document_attachments TO sa_guard,sa_executor;
GRANT UPDATE(claimed_at,expires_at) ON sa_domain.document_attachments TO sa_executor;
GRANT USAGE ON SEQUENCE sa_domain.document_attachments_id_seq TO sa_media_writer;
CREATE POLICY attachment_writer ON sa_domain.document_attachments TO sa_media_writer USING(true) WITH CHECK(true);
CREATE POLICY attachment_guard ON sa_domain.document_attachments FOR SELECT TO sa_guard USING(actor_id=(SELECT sa_domain.request_uid()));
CREATE POLICY attachment_executor ON sa_domain.document_attachments TO sa_executor USING(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state)) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state));
GRANT SELECT ON sa_domain.documents TO sa_guard,sa_media_writer;
CREATE POLICY attachment_guard_document ON sa_domain.documents FOR SELECT TO sa_guard USING(actor_id=(SELECT sa_domain.request_uid()));
CREATE POLICY attachment_cleanup_document ON sa_domain.documents FOR SELECT TO sa_media_writer USING(true);
GRANT EXECUTE ON FUNCTION sa_domain.catalog_actor(text),sa_domain.actor(),sa_domain.feature(jsonb,text) TO sa_guard,sa_media_writer;

-- Request references hold an unclaimed upload until the asynchronous renderer
-- captures it. Captured attachments remain immutable after the upload lease.
CREATE FUNCTION sa_domain.document_attachment_target(p_id bigint,p_pending boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('documents');r sa_domain.document_attachments;
BEGIN
 SELECT * INTO r FROM sa_domain.document_attachments WHERE id=p_id AND actor_id=a.auth_id AND generation=(SELECT generation FROM sa_domain.runtime_state);
 IF r.id IS NULL OR r.state='expired' OR(NOT p_pending AND r.state<>'ready') OR
 (r.claimed_at IS NULL AND r.expires_at<=now() AND NOT EXISTS(SELECT FROM sa_domain.documents d WHERE d.actor_id=a.auth_id AND d.generation=r.generation AND d.kind='catalogue' AND d.state IN('queued','rendering','ready') AND(d.expires_at IS NULL OR d.expires_at>now()) AND d.request->'terms_reference'->>'resource'='document_attachments' AND d.request->'terms_reference'->>'record_id'=r.id::text)) THEN
  RAISE EXCEPTION 'Document attachment not found' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('version',r.generation::text||':'||r.id::text,'source',CASE WHEN r.sha256 IS NOT NULL THEN 'squad:'||r.sha256 END,'state',r.state);
END $f$;
ALTER FUNCTION sa_domain.document_attachment_target(bigint,boolean) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.document_attachment_target(bigint,boolean) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_attachment_target(bigint,boolean) TO sa_guard,sa_media_writer,sa_executor;

CREATE FUNCTION sa_domain.account_document_attachment_reserve(p_file jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('documents');cached_ jsonb;r sa_domain.document_attachments;u sa_domain.media_uploads;name_ text;mime_ text;bytes_ bigint;result_ jsonb;count_ int;total_ bigint;
BEGIN
 PERFORM sa_domain.check_fields(p_file,ARRAY['filename','bytes','content_type']);name_:=p_file->>'filename';mime_:=p_file->>'content_type';
 IF jsonb_typeof(p_file->'filename') IS DISTINCT FROM 'string' OR name_ IS NULL OR length(name_) NOT BETWEEN 1 AND 180 OR name_~'[/\\[:cntrl:]]' OR coalesce(p_file->>'bytes','')!~'^[1-9][0-9]{0,6}$' THEN RAISE EXCEPTION 'Invalid attachment file' USING ERRCODE='22023';END IF;
 bytes_:=(p_file->>'bytes')::bigint;
 IF mime_ IS NULL OR mime_ NOT IN('application/pdf','image/png','image/jpeg','text/plain') OR bytes_>5242880 THEN RAISE EXCEPTION 'Terms must be PDF, PNG, JPEG or plain text within 5 MB' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_media_command('document.attachment_reserved',p_idempotency_key,p_file);IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('media-quota:'||a.auth_id::text,784139));
 SELECT count(*) FILTER(WHERE state IN('reserved','verified') AND expires_at>now()),coalesce(sum(bytes),0) INTO count_,total_ FROM sa_domain.media_uploads WHERE actor_id=a.auth_id AND created_at>now()-interval '24 hours';
 IF count_>=20 OR total_+bytes_>2147483648 THEN RAISE EXCEPTION 'Upload quota exceeded' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.document_attachments(actor_id,generation) SELECT a.auth_id,generation FROM sa_domain.runtime_state RETURNING * INTO r;
 INSERT INTO sa_domain.media_uploads(actor_id,generation,resource,record_id,field,expected_version,filename,bytes,content_type)
 VALUES(a.auth_id,r.generation,'document_attachments',r.id,'terms',r.generation::text||':'||r.id::text,name_,bytes_,mime_) RETURNING * INTO u;
 result_:=jsonb_build_object('upload_id',u.id,'path','pending/'||u.id,'bucket','squad-uploads','expires_at',u.expires_at,'bytes',u.bytes::text,'content_type',u.content_type,'filename',u.filename,'state',u.state,'expected_version',u.expected_version,'resource','document_attachments');
 UPDATE sa_domain.commands SET result=result_ WHERE actor_id=a.auth_id AND key=p_idempotency_key;RETURN result_;
END $f$;
ALTER FUNCTION sa_domain.account_document_attachment_reserve(jsonb,uuid) OWNER TO sa_media_writer;

CREATE FUNCTION sa_domain.v1_document_attachment_attach(p_upload_id uuid,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('documents');u sa_domain.media_uploads;cached_ jsonb;result_ jsonb;
BEGIN
 cached_:=sa_domain.begin_media_command('document.attachment_attached',p_idempotency_key,jsonb_build_object('upload_id',p_upload_id));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 SELECT * INTO u FROM sa_domain.media_uploads WHERE id=p_upload_id AND actor_id=a.auth_id AND generation=(SELECT generation FROM sa_domain.runtime_state) FOR UPDATE;
 IF u.id IS NULL OR u.resource<>'document_attachments' OR u.field<>'terms' THEN RAISE EXCEPTION 'Document upload not found' USING ERRCODE='P0002';END IF;
 PERFORM sa_domain.document_attachment_target(u.record_id,true);
 IF u.state<>'verified' OR u.expires_at<=now() THEN RAISE EXCEPTION 'Upload is not verified or has expired' USING ERRCODE='55000';END IF;
 UPDATE sa_domain.document_attachments SET state='ready',sha256=u.sha256 WHERE id=u.record_id AND state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Attachment already finalized' USING ERRCODE='PT409';END IF;
 INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('document_attachments',u.record_id,'terms','','squad:'||u.sha256,'ready',u.sha256);
 result_:=jsonb_build_object('resource','document_attachments','record_id',u.record_id::text,'field','terms','pointer','','status','ready');
 UPDATE sa_domain.media_uploads SET state='attached',attached_at=now(),result=result_ WHERE id=u.id;
 RETURN sa_domain.finish_media_command('document.attachment_attached',p_idempotency_key,'document_attachments',u.record_id,result_,jsonb_build_object('upload_id',u.id,'purpose','catalogue_terms'));
END $f$;
ALTER FUNCTION sa_domain.v1_document_attachment_attach(uuid,uuid) OWNER TO sa_media_writer;

-- Preserve existing master special cases and privileges. Assert anchors so a
-- future incompatible upstream definition fails migration rather than drifting.
DO $f$ DECLARE d text;anchor_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.media_fields()'::regprocedure);
 d:=replace(d,'SELECT ', 'SELECT jsonb_build_object(''document_attachments'',jsonb_build_array(''terms'')) || ');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.media_allowed(text,bigint)'::regprocedure);anchor_:='BEGIN'||chr(10);
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing media_allowed anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$ IF p_resource='document_attachments' THEN PERFORM sa_domain.document_attachment_target(p_id,false);RETURN true;END IF;
$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.media_target(text,bigint,text,boolean)'::regprocedure);
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing media_target anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$ IF p_resource='document_attachments' THEN
 IF p_field<>'terms' THEN RAISE EXCEPTION 'Unsupported attachment field' USING ERRCODE='22023';END IF;
 RETURN sa_domain.document_attachment_target(p_id,true);END IF;
$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.account_media_resolve(jsonb)'::regprocedure);
 anchor_:=$s$EXECUTE format('SELECT %I::text FROM sa_snapshot_20261019.%I WHERE id=$1',field_,'sa_'||resource_) INTO source_ USING id_;$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing media resolve anchor';END IF;
 d:=replace(d,anchor_,$s$IF resource_='document_attachments' THEN source_:=sa_domain.document_attachment_target(id_,false)->>'source';ELSE $s$||anchor_||'END IF;');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid)'::regprocedure);
 anchor_:=$s$target_:=CASE WHEN id_=0 THEN sa_domain.master_upload_draft(resource_,field_) ELSE sa_domain.media_target(resource_,id_,field_,true) END;$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing reserve anchor';END IF;
 d:=replace(d,anchor_,$s$IF resource_='document_attachments' THEN RAISE EXCEPTION 'Use document attachment reservation' USING ERRCODE='22023';END IF;$s$||anchor_);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.account_upload_get(uuid)'::regprocedure);
 anchor_:=$s$'current_version',target_->>'version'$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing upload get anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$,'resource',u.resource$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.v1_document_request(text,jsonb,uuid)'::regprocedure);
 anchor_:=$s$spec_:=sa_domain.document_spec(p_kind,p_request);$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing document request anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$
 IF spec_->'terms_reference'->>'resource'='document_attachments' THEN
  UPDATE sa_domain.document_attachments SET expires_at=greatest(expires_at,now()+interval '48 hours')
  WHERE id=(spec_->'terms_reference'->>'record_id')::bigint AND actor_id=a.auth_id AND generation=(SELECT generation FROM sa_domain.runtime_state) AND state='ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'Document attachment unavailable' USING ERRCODE='P0002';END IF;
 END IF;
$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.document_capture(uuid)'::regprocedure);
 anchor_:=$s$terms_:=(sa_domain.account_media_resolve(jsonb_build_array(d.request->'terms_reference'))->'references')->0;$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing capture anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$
  IF d.request->'terms_reference'->>'resource'='document_attachments' THEN
   UPDATE sa_domain.document_attachments SET claimed_at=coalesce(claimed_at,now()) WHERE id=(d.request->'terms_reference'->>'record_id')::bigint AND actor_id=d.actor_id AND generation=d.generation AND state='ready';
   IF NOT FOUND THEN RAISE EXCEPTION 'Document attachment unavailable' USING ERRCODE='P0002';END IF;
  END IF;
$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.account_upload_cleanup(uuid[])'::regprocedure);
 anchor_:=' -- Supabase signed uploads';
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing cleanup anchor';END IF;
 d:=replace(d,anchor_,$s$
 WITH expired AS(SELECT a.id FROM sa_domain.document_attachments a WHERE a.claimed_at IS NULL AND a.state<>'expired' AND a.expires_at<now()
 AND NOT EXISTS(SELECT FROM sa_domain.documents d WHERE d.actor_id=a.actor_id AND d.generation=a.generation AND d.kind='catalogue' AND d.state IN('queued','rendering','ready') AND(d.expires_at IS NULL OR d.expires_at>now()) AND d.request->'terms_reference'->>'resource'='document_attachments' AND d.request->'terms_reference'->>'record_id'=a.id::text)
 ORDER BY a.expires_at,a.id LIMIT 100 FOR UPDATE), changed AS(UPDATE sa_domain.document_attachments a SET state='expired' FROM expired e WHERE a.id=e.id RETURNING a.id)
 DELETE FROM sa_media.references WHERE resource='document_attachments' AND record_id IN(SELECT id FROM changed);
$s$||anchor_);EXECUTE d;
END $f$;

CREATE FUNCTION canto_api.account_document_attachment_reserve(p_file jsonb,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_document_attachment_reserve(p_file,p_idempotency_key) $f$;
CREATE FUNCTION canto_api.v1_document_attachment_attach(p_upload_id uuid,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_document_attachment_attach(p_upload_id,p_idempotency_key) $f$;
REVOKE ALL ON FUNCTION sa_domain.account_document_attachment_reserve(jsonb,uuid),sa_domain.v1_document_attachment_attach(uuid,uuid),canto_api.account_document_attachment_reserve(jsonb,uuid),canto_api.v1_document_attachment_attach(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_document_attachment_reserve(jsonb,uuid),sa_domain.v1_document_attachment_attach(uuid,uuid),canto_api.account_document_attachment_reserve(jsonb,uuid),canto_api.v1_document_attachment_attach(uuid,uuid) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
