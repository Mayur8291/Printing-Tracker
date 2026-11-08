BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_media_writer;
GRANT SELECT(id,sync_time,sync_status,sync_errors,created_at,updated_at) ON sa_snapshot_20261019.sa_sync_airtables TO sa_media_writer;
GRANT SELECT(id,status,upload_type,total,inserted,updated,skipped,duplicates,failed_count,error_details,file,created_at,updated_at) ON sa_snapshot_20261019.sa_bulk_uploads TO sa_media_writer;
CREATE POLICY squad_import_history ON sa_snapshot_20261019.sa_sync_airtables FOR SELECT TO sa_media_writer USING(true);
CREATE POLICY squad_import_history ON sa_snapshot_20261019.sa_bulk_uploads FOR SELECT TO sa_media_writer USING(true);

-- Keep the current transfer engine intact. The facade adds explicitly selected,
-- read-only source history, never requeues imported jobs or returns raw errors.
DROP FUNCTION canto_api.v1_import_status(uuid,text,integer);
ALTER FUNCTION sa_domain.v1_import_status(uuid,text,integer) RENAME TO import_status_current;
REVOKE ALL ON FUNCTION sa_domain.import_status_current(uuid,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.v1_import_status(p_id uuid DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25,p_legacy_kind text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb;context_ jsonb;after_ bigint;n integer;result_ jsonb;g text;
BEGIN
 IF p_legacy_kind IS NULL THEN RETURN sa_domain.import_status_current(p_id,p_cursor,p_limit);END IF;
 ctx:=sa_domain.ops_context();n:=sa_domain.page_limit(p_limit);
 IF p_legacy_kind NOT IN('airtable','prices') OR p_id IS NOT NULL THEN RAISE EXCEPTION 'Select an imported history kind without a current transfer ID' USING ERRCODE='22023';END IF;
 IF NOT((ctx->>'platform')::boolean OR(p_legacy_kind='airtable' AND(ctx->>'admin')::boolean)) THEN RAISE EXCEPTION 'Import history administrator required' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh active' USING ERRCODE='55000';END IF;
 SELECT generation::text INTO g FROM sa_domain.runtime_state;
 context_:=jsonb_build_object('kind','legacy_import_history','source',p_legacy_kind,'actor',ctx->>'auth_id','generation',g);after_:=sa_domain.cursor_id(p_cursor,context_);
 IF p_legacy_kind='airtable' THEN
  WITH scan AS MATERIALIZED(SELECT id,sync_time,sync_status,sync_errors,created_at,updated_at FROM sa_snapshot_20261019.sa_sync_airtables WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'legacy',true,'kind','airtable',
   'source_state',CASE sync_status WHEN 0 THEN 'pending' WHEN 1 THEN 'completed' WHEN 2 THEN 'failed' ELSE 'unknown' END,
   'created_at',created_at,'updated_at',updated_at,'sync_time',sync_time,'has_errors',coalesce(sync_errors NOT IN('null'::jsonb,'[]'::jsonb,'{}'::jsonb,'""'::jsonb),false),
   'resumable',false) ORDER BY id DESC),'[]'),
   'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),context_) END) INTO result_ FROM page;
 ELSE
  WITH scan AS MATERIALIZED(SELECT id,status,total,inserted,updated,skipped,duplicates,failed_count,error_details,file,created_at,updated_at FROM sa_snapshot_20261019.sa_bulk_uploads WHERE upload_type=0 AND id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'legacy',true,'kind','prices',
   'source_state',CASE status WHEN 0 THEN 'pending' WHEN 1 THEN 'processing' WHEN 2 THEN 'completed' WHEN 3 THEN 'failed' ELSE 'unknown' END,
   'created_at',created_at,'updated_at',updated_at,'total_rows',total,'inserted_rows',inserted,'updated_rows',updated,'skipped_rows',skipped,'duplicate_rows',duplicates,'failed_rows',failed_count,
   'has_errors',coalesce(error_details NOT IN('null'::jsonb,'[]'::jsonb,'{}'::jsonb,'""'::jsonb),false),'source_file_present',coalesce(length(file)>0,false),'resumable',false) ORDER BY id DESC),'[]'),
   'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),context_) END) INTO result_ FROM page;
 END IF;
 RETURN result_||jsonb_build_object('generation',g,'as_of',now(),'origin','legacy_snapshot','timestamp_basis','legacy_naive');
END $f$;
ALTER FUNCTION sa_domain.v1_import_status(uuid,text,integer,text) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_import_status(uuid,text,integer,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_import_status(uuid,text,integer,text) TO sa_app,authenticated;
CREATE FUNCTION canto_api.v1_import_status(p_id uuid DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25,p_legacy_kind text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_import_status(p_id,p_cursor,p_limit,p_legacy_kind) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_import_status(uuid,text,integer,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_import_status(uuid,text,integer,text) TO sa_app,authenticated;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
