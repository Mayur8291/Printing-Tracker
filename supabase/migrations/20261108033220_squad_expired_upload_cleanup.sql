BEGIN;
ALTER TABLE sa_domain.media_uploads ADD COLUMN temp_deleted_at timestamptz;
CREATE INDEX squad_media_temp_cleanup ON sa_domain.media_uploads(expires_at,id) WHERE temp_deleted_at IS NULL;
-- A grant resolver has already checked the same resource. Avoid repeating live
-- Auth/scope queries solely to calculate its opaque optimistic version. This
-- helper is private and executable only by the guard and media writer roles.
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.media_target(text,bigint,text,boolean)'::regprocedure);
 definition_:=replace(definition_,'context_ jsonb:=sa_domain.ops_context();','context_ jsonb;');
 definition_:=replace(definition_,'OR NOT sa_domain.media_allowed(p_resource,p_id)', 'OR(p_write AND NOT sa_domain.media_allowed(p_resource,p_id))');
 definition_:=replace(definition_,'IF p_write THEN','IF p_write THEN context_:=sa_domain.ops_context();');
 EXECUTE definition_;
END $f$;
-- Reference attachments can include bounded video as well as images/PDFs.
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid)'::regprocedure);
 definition_:=replace(definition_,$s$(field_<>'embeded_video' AND mime_ IN('video/mp4','video/webm'))$s$,$s$(field_<>'embeded_video' AND NOT(resource_='brandings' AND field_='attachment') AND mime_ IN('video/mp4','video/webm'))$s$);
 EXECUTE definition_;
END $f$;
GRANT CREATE ON SCHEMA sa_domain TO sa_media_writer;
CREATE FUNCTION sa_domain.account_upload_cleanup(p_completed uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF current_setting('role',true)<>'service_role' OR coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Service required' USING ERRCODE='42501';END IF;
 IF p_completed IS NULL OR coalesce(cardinality(p_completed),0)>100 THEN RAISE EXCEPTION 'Cleanup batch must contain at most 100 IDs' USING ERRCODE='22023';END IF;
 -- Supabase signed uploads live for two hours. Even a grant reissued just
 -- before the application lease expired must be dead before deleting its path.
 UPDATE sa_domain.media_uploads SET temp_deleted_at=now(),state=CASE WHEN state IN('reserved','verified') THEN 'expired' ELSE state END
 WHERE id=ANY(p_completed) AND expires_at<now()-interval '2 hours 10 minutes' AND temp_deleted_at IS NULL;
 RETURN(SELECT jsonb_build_object('uploads',coalesce(jsonb_agg(jsonb_build_object('id',id,'path','pending/'||id) ORDER BY expires_at,id),'[]'))
 FROM(SELECT id,expires_at FROM sa_domain.media_uploads WHERE temp_deleted_at IS NULL AND expires_at<now()-interval '2 hours 10 minutes' ORDER BY expires_at,id LIMIT 100) q);
END $f$;
ALTER FUNCTION sa_domain.account_upload_cleanup(uuid[]) OWNER TO sa_media_writer;
CREATE FUNCTION canto_api.account_upload_cleanup(p_completed uuid[] DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_upload_cleanup(p_completed) $f$;
REVOKE ALL ON FUNCTION sa_domain.account_upload_cleanup(uuid[]),canto_api.account_upload_cleanup(uuid[]) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.account_upload_cleanup(uuid[]),canto_api.account_upload_cleanup(uuid[]) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
