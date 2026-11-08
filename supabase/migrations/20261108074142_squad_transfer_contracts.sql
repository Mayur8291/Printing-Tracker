BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_media_writer,sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.page_limit(integer),sa_domain.cursor_id(text,jsonb),sa_domain.next_cursor(bigint,jsonb) TO sa_media_writer;
CREATE FUNCTION sa_domain.transfer_projection(t sa_domain.transfers) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',t.id,'direction',t.direction,'kind',t.kind,'resource',t.resource,'state',t.state,'job_id',t.job_id,
 'version',t.generation::text||':'||t.revision::text,'generation',t.generation::text,'total_rows',t.total_rows,'valid_rows',t.valid_rows,'invalid_rows',t.invalid_rows,'applied_rows',t.applied_rows,
 'error_code',t.error_code,'created_at',t.created_at,'completed_at',t.completed_at,'expires_at',t.expires_at,
 'download_ready',t.direction='export' AND t.state='completed' AND t.expires_at>now(),'result',t.result-ARRAY['path','bucket','snapshot','raw','sha256'])
$f$;
ALTER FUNCTION sa_domain.transfer_projection(sa_domain.transfers) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.transfer_projection(sa_domain.transfers) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.transfer_projection(sa_domain.transfers) TO sa_worker;

CREATE FUNCTION sa_domain.transfer_command_finish(p_operation text,p_key uuid,p_transfer uuid,p_event text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();t sa_domain.transfers;r jsonb;job_ uuid;
BEGIN
 SELECT * INTO t FROM sa_domain.transfers WHERE id=p_transfer FOR UPDATE;
 IF t.id IS NULL OR NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='P0002';END IF;
 IF p_event IS NOT NULL THEN
  INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(t.actor_id,p_event,t.direction,t.sequence_id,p_key,t.generation,jsonb_build_object('transfer_id',t.id)) RETURNING id INTO job_;
  UPDATE sa_domain.transfers SET job_id=job_ WHERE id=t.id RETURNING * INTO t;
 END IF;
 r:=sa_domain.transfer_projection(t);
 UPDATE sa_domain.commands SET result=r WHERE actor_id=t.actor_id AND key=p_key AND operation=p_operation AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfer command not reserved' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,generation)
 VALUES(t.actor_id,(ctx->>'legacy_user_id')::bigint,p_operation,t.direction,t.sequence_id,p_key,jsonb_build_object('transfer_id',t.id,'kind',t.kind,'resource',t.resource),t.generation);
 UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.transfer_command_finish(text,uuid,uuid,text) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.transfer_command_finish(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.v1_import_request(p_kind text,p_request jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb;u sa_domain.transfer_uploads;t sa_domain.transfers;action_ text:=coalesce(p_request->>'action','validate');cached_ jsonb;options_ jsonb;field_ text;value_ jsonb;
BEGIN
 IF action_ NOT IN('validate','apply','cancel') THEN RAISE EXCEPTION 'Unknown import action' USING ERRCODE='22023';END IF;
 IF action_='validate' THEN
  PERFORM sa_domain.check_fields(p_request,ARRAY['action','upload_id','options']);
  IF p_kind='airtable' THEN
   PERFORM sa_domain.transfer_context(p_kind,NULL);
   IF NOT(SELECT airtable_enabled FROM sa_domain.integration_preferences WHERE singleton) THEN RAISE EXCEPTION 'Airtable import is disabled' USING ERRCODE='55000';END IF;
   RAISE EXCEPTION 'Airtable provider configuration is not installed' USING ERRCODE='55000';
  END IF;
  IF pg_input_is_valid(p_request->>'upload_id','uuid') IS NOT TRUE THEN RAISE EXCEPTION 'CSV upload ID required' USING ERRCODE='22023';END IF;
  SELECT * INTO u FROM sa_domain.transfer_uploads WHERE id=(p_request->>'upload_id')::uuid FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='P0002';END IF;
  ctx:=sa_domain.transfer_context(p_kind,u.resource);
  IF u.actor_id<>(ctx->>'auth_id')::uuid OR u.kind<>p_kind OR u.generation<>(SELECT generation FROM sa_domain.runtime_state) OR u.expires_at<=now() OR u.state NOT IN('verified','used') THEN RAISE EXCEPTION 'Verified upload unavailable' USING ERRCODE='P0002';END IF;
  options_:=coalesce(p_request->'options','{}');PERFORM sa_domain.check_fields(options_,ARRAY['mapping','match_field','replace_all']);
  IF options_?'replace_all' AND(jsonb_typeof(options_->'replace_all')<>'boolean' OR p_kind<>'prices') THEN RAISE EXCEPTION 'Replacement is supported for price imports only' USING ERRCODE='22023';END IF;
  IF options_?'match_field' AND(jsonb_typeof(options_->'match_field')<>'string' OR length(options_->>'match_field')>100 OR p_kind<>'masters') THEN RAISE EXCEPTION 'Invalid import match field' USING ERRCODE='22023';END IF;
  IF options_?'mapping' THEN
   IF jsonb_typeof(options_->'mapping')<>'object' OR octet_length((options_->'mapping')::text)>8192 THEN RAISE EXCEPTION 'Invalid CSV mapping' USING ERRCODE='22023';END IF;
   FOR field_,value_ IN SELECT * FROM jsonb_each(options_->'mapping') LOOP
    IF field_!~'^[a-z][a-z0-9_]{0,99}$' OR jsonb_typeof(value_)<>'string' OR(value_#>>'{}')!~'^[a-z][a-z0-9_]{0,99}$' THEN RAISE EXCEPTION 'Invalid CSV mapping' USING ERRCODE='22023';END IF;
   END LOOP;
  END IF;
 ELSE
  PERFORM sa_domain.check_fields(p_request,ARRAY['action','id','version']);
  IF pg_input_is_valid(p_request->>'id','uuid') IS NOT TRUE THEN RAISE EXCEPTION 'Import ID required' USING ERRCODE='22023';END IF;
  SELECT * INTO t FROM sa_domain.transfers WHERE id=(p_request->>'id')::uuid FOR UPDATE;
  IF t.id IS NULL OR t.direction<>'import' OR t.kind IS DISTINCT FROM p_kind OR NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Import unavailable' USING ERRCODE='P0002';END IF;
  ctx:=sa_domain.ops_context();
 END IF;
 -- Background mutation remains explicitly disabled until new-system ownership.
 -- Existing interactive Printing Tracker Masters keep their existing mirror behavior.
 IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state) THEN RAISE EXCEPTION 'Bulk jobs require new-system ownership' USING ERRCODE='55000';END IF;
 cached_:=sa_domain.begin_media_command('import.'||action_,p_idempotency_key,jsonb_build_object('kind',p_kind,'request',p_request));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 IF action_='validate' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('transfer-owner:'||(ctx->>'auth_id'),784145));
  IF EXISTS(SELECT FROM sa_domain.transfers WHERE actor_id=(ctx->>'auth_id')::uuid AND direction='import' AND state IN('queued','validating','applying')) THEN RAISE EXCEPTION 'An import is already running' USING ERRCODE='55000';END IF;
  INSERT INTO sa_domain.transfers(actor_id,principal,generation,direction,kind,resource,options,upload_id)
  SELECT(ctx->>'auth_id')::uuid,CASE WHEN(ctx->>'platform')::boolean THEN 'platform' ELSE 'legacy_admin' END,generation,'import',p_kind,u.resource,options_,u.id FROM sa_domain.runtime_state RETURNING * INTO t;
  UPDATE sa_domain.transfer_uploads SET state='used' WHERE id=u.id;
  RETURN sa_domain.transfer_command_finish('import.validate',p_idempotency_key,t.id,'transfer.validate');
 END IF;
 IF p_request->>'version' IS DISTINCT FROM t.generation::text||':'||t.revision::text THEN RAISE EXCEPTION 'Import version changed' USING ERRCODE='40001';END IF;
 IF action_='apply' THEN
  IF t.state<>'validated' OR t.invalid_rows<>0 OR t.valid_rows=0 OR t.expires_at<=now() THEN RAISE EXCEPTION 'Validate a nonempty error-free import first' USING ERRCODE='55000';END IF;
  UPDATE sa_domain.transfers SET state='applying',revision=revision+1,error_code=NULL WHERE id=t.id;
  RETURN sa_domain.transfer_command_finish('import.apply',p_idempotency_key,t.id,'transfer.apply');
 ELSE
  IF t.state IN('completed','cancelled','expired') THEN RAISE EXCEPTION 'Import is already terminal' USING ERRCODE='55000';END IF;
  UPDATE sa_domain.transfers SET state='cancelled',revision=revision+1,completed_at=now() WHERE id=t.id;
  UPDATE sa_domain.outbox SET status='dead',lease_token=NULL,lease_until=NULL,last_error_code='TRANSFER_CANCELLED',completed_at=now(),revision=revision+1 WHERE id=t.job_id AND status IN('pending','leased');
  RETURN sa_domain.transfer_command_finish('import.cancel',p_idempotency_key,t.id,NULL);
 END IF;
END $f$;
ALTER FUNCTION sa_domain.v1_import_request(text,jsonb,uuid) OWNER TO sa_media_writer;
GRANT SELECT,UPDATE ON sa_domain.outbox TO sa_media_writer;
CREATE POLICY transfer_read_queue ON sa_domain.outbox FOR SELECT TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND event_type IN('transfer.validate','transfer.apply','transfer.export'));
CREATE POLICY transfer_cancel_queue ON sa_domain.outbox FOR UPDATE TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND event_type IN('transfer.validate','transfer.apply','transfer.export')) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND event_type IN('transfer.validate','transfer.apply','transfer.export'));

CREATE FUNCTION sa_domain.v1_export_request(p_resource text,p_request jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.transfer_context('export',p_resource);cached_ jsonb;t sa_domain.transfers;v jsonb;spec_ jsonb;field_ text;
BEGIN
 PERFORM sa_domain.check_fields(p_request,ARRAY['columns','include_inactive','search','filters']);
 IF p_request?'include_inactive' AND jsonb_typeof(p_request->'include_inactive')<>'boolean' OR p_request?'search' AND(jsonb_typeof(p_request->'search')<>'string' OR length(p_request->>'search')>200) THEN RAISE EXCEPTION 'Invalid export filter' USING ERRCODE='22023';END IF;
 SELECT spec INTO spec_ FROM sa_admin.master_contracts WHERE resource=p_resource;
 IF p_request?'columns' THEN
  IF jsonb_typeof(p_request->'columns')<>'array' OR jsonb_array_length(p_request->'columns') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose 1..100 export columns' USING ERRCODE='22023';END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p_request->'columns') LOOP
   IF jsonb_typeof(v)<>'string' OR NOT(coalesce(spec_->'fields','[]')?(v#>>'{}') OR coalesce(spec_->'relations','{}')?(v#>>'{}') OR (v#>>'{}') IN('id','created_at','updated_at')) THEN RAISE EXCEPTION 'Unknown export column' USING ERRCODE='22023';END IF;
  END LOOP;
  IF(SELECT count(DISTINCT value) FROM jsonb_array_elements(p_request->'columns'))<>jsonb_array_length(p_request->'columns') THEN RAISE EXCEPTION 'Duplicate export column' USING ERRCODE='22023';END IF;
 END IF;
 IF p_request?'filters' AND jsonb_typeof(p_request->'filters')<>'object' THEN RAISE EXCEPTION 'Invalid export filters' USING ERRCODE='22023';END IF;
 FOR field_,v IN SELECT * FROM jsonb_each(coalesce(p_request->'filters','{}')) LOOP
  IF NOT(coalesce(spec_->'references','{}')?field_) THEN RAISE EXCEPTION 'Unknown export filter' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.input_id(v);
 END LOOP;
 IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state) THEN RAISE EXCEPTION 'Bulk jobs require new-system ownership' USING ERRCODE='55000';END IF;
 cached_:=sa_domain.begin_media_command('export.requested',p_idempotency_key,jsonb_build_object('resource',p_resource,'request',p_request));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('transfer-owner:'||(ctx->>'auth_id'),784145));
 IF(SELECT count(*) FROM sa_domain.transfers WHERE actor_id=(ctx->>'auth_id')::uuid AND direction='export' AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Export quota exceeded' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.transfers(actor_id,principal,generation,direction,kind,resource,options)
 SELECT(ctx->>'auth_id')::uuid,'platform',generation,'export','masters',p_resource,p_request FROM sa_domain.runtime_state RETURNING * INTO t;
 RETURN sa_domain.transfer_command_finish('export.requested',p_idempotency_key,t.id,'transfer.export');
END $f$;
ALTER FUNCTION sa_domain.v1_export_request(text,jsonb,uuid) OWNER TO sa_media_writer;

CREATE FUNCTION sa_domain.v1_import_status(p_id uuid DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();t sa_domain.transfers;n integer:=sa_domain.page_limit(p_limit);context_ jsonb;after_ bigint;r jsonb;
BEGIN
 IF NOT((ctx->>'platform')::boolean OR(ctx->>'admin')::boolean) THEN RAISE EXCEPTION 'Transfer administrator required' USING ERRCODE='42501';END IF;
 context_:=jsonb_build_object('kind','transfers','id',p_id,'actor',ctx->>'auth_id','principal',ctx->>'platform','generation',(SELECT generation::text FROM sa_domain.runtime_state));after_:=sa_domain.cursor_id(p_cursor,context_);
 IF p_id IS NULL THEN
  WITH scan AS MATERIALIZED(SELECT x FROM sa_domain.transfers x WHERE sequence_id<after_
    AND actor_id=(ctx->>'auth_id')::uuid AND principal=CASE WHEN(ctx->>'platform')::boolean THEN 'platform' ELSE 'legacy_admin' END
    AND generation=(SELECT generation FROM sa_domain.runtime_state) ORDER BY sequence_id DESC LIMIT n+1),page AS(SELECT x FROM scan ORDER BY(x).sequence_id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.transfer_projection(x) ORDER BY(x).sequence_id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min((x).sequence_id),context_) END) INTO r FROM page;
 ELSE
  SELECT * INTO t FROM sa_domain.transfers WHERE id=p_id;
  IF t.id IS NULL OR NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='P0002';END IF;
  WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND row_number<after_ ORDER BY row_number DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY row_number DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('row',row_number,'state',state,'errors',errors,'result_id',result_id) ORDER BY row_number DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(row_number),context_) END) INTO r FROM page;
  r:=sa_domain.transfer_projection(t)||jsonb_build_object('rows',r);
 END IF;
 RETURN r||jsonb_build_object('generation',(SELECT generation::text FROM sa_domain.runtime_state),'as_of',now());
END $f$;
ALTER FUNCTION sa_domain.v1_import_status(uuid,text,integer) OWNER TO sa_media_writer;

DO $f$ DECLARE f record;args_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_import_request','v1_export_request','v1_import_status']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE '' END,'SELECT sa_domain.'||f.proname||'('||args_||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO sa_app,authenticated',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_media_writer,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
