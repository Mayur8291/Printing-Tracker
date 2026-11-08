BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_worker,sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.check_fields(jsonb,text[]),sa_domain.input_number(jsonb,numeric,numeric) TO sa_worker;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('squad-documents','squad-documents',false,67108864,ARRAY['application/pdf','application/octet-stream']) ON CONFLICT(id) DO NOTHING;

CREATE FUNCTION sa_domain.squad_document_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;r jsonb;error_ text;d sa_domain.documents;n integer;chunk_ jsonb;path_ text;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'document.requested' THEN RAISE EXCEPTION 'Document lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Document lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  r:=sa_domain.document_capture((j.payload->>'document_id')::uuid);
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found OR invalid_parameter_value OR object_not_in_prerequisite_state OR program_limit_exceeded THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;
 END;
 IF error_ IS NOT NULL THEN
  UPDATE sa_domain.documents SET state='failed',error_code=error_ WHERE job_id=j.id;
  UPDATE sa_domain.outbox SET status='dead',last_error_code=error_,lease_until=NULL,completed_at=now(),revision=revision+1 WHERE id=j.id;
  UPDATE sa_domain.job_attempts SET state='failed',finished_at=now(),error_code=error_ WHERE lease_token=j.lease_token;
  RETURN jsonb_build_object('id',j.id,'state','dead','error_code',error_);
 END IF;
 UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '180 seconds' WHERE id=j.id;
 SELECT * INTO d FROM sa_domain.documents WHERE job_id=j.id;
 n:=greatest(1,ceil(jsonb_array_length(d.snapshot->'rows')/d.part_size::numeric)::integer);
 IF n=1 THEN RETURN jsonb_build_object('id',j.id,'state','prepared','phase','single')||r;END IF;
 path_:=r->>'object_path';
 IF d.next_part>=n THEN RETURN jsonb_build_object('id',j.id,'state','prepared','phase','merge','document_id',d.id,'snapshot',d.snapshot-'rows','parts',d.parts,'object_path',path_);END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO chunk_ FROM jsonb_array_elements(d.snapshot->'rows') WITH ORDINALITY WHERE ordinality>d.next_part*d.part_size AND ordinality<=(d.next_part+1)*d.part_size;
 chunk_:=(d.snapshot-'rows'-'terms_attachment')||jsonb_build_object('rows',chunk_,'part_index',d.next_part,'part_count',n,'total_rows',jsonb_array_length(d.snapshot->'rows'));
 IF d.next_part<n-1 THEN chunk_:=jsonb_set(chunk_,'{presentation}',coalesce(d.snapshot->'presentation','{}')-ARRAY['bank_details','display_address','remarks','terms']);END IF;
 RETURN jsonb_build_object('id',j.id,'state','prepared','phase','part','document_id',d.id,'snapshot',chunk_,'snapshot_hash',d.snapshot_hash,'part_index',d.next_part,'object_path',replace(path_,'document.pdf','part-'||lpad(d.next_part::text,4,'0')||'.pdf'));
END $f$;
ALTER FUNCTION sa_domain.squad_document_prepare(uuid,uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.document_publish(p_id uuid,p_bytes bigint,p_sha256 text,p_pages integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;
BEGIN
 SELECT * INTO d FROM sa_domain.documents WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL OR NOT sa_domain.document_current(d) THEN RAISE EXCEPTION 'Document authority changed' USING ERRCODE='42501';END IF;
 IF d.snapshot IS NULL OR d.snapshot_hash IS NULL THEN RAISE EXCEPTION 'Document not captured' USING ERRCODE='55000';END IF;
 UPDATE sa_domain.documents SET state='ready',bytes=p_bytes,sha256=p_sha256,page_count=p_pages,error_code=NULL,completed_at=now(),
 object_path='g'||d.generation::text||'/'||d.actor_id::text||'/'||d.id::text||'/document.pdf',
 expires_at=CASE WHEN d.kind='catalogue' THEN now()+interval '3 days' END WHERE id=d.id;
END $f$;
ALTER FUNCTION sa_domain.document_publish(uuid,bigint,text,integer) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.document_publish(uuid,bigint,text,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.document_publish(uuid,bigint,text,integer) TO sa_worker;

CREATE FUNCTION sa_domain.squad_document_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;code_ text;error_ text;retry_ boolean:=false;d sa_domain.documents;n integer;
BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'document.requested' THEN RAISE EXCEPTION 'Document lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 SELECT * INTO d FROM sa_domain.documents WHERE job_id=j.id FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Document missing' USING ERRCODE='55000';END IF;
 IF j.status='pending' AND p_result->>'code'='PART_READY' AND (p_result->>'part_index')::integer=d.next_part-1 AND d.parts->(d.next_part-1)->>'sha256'=p_result->>'sha256' AND (d.parts->(d.next_part-1)->>'bytes')::bigint=(p_result->>'bytes')::bigint AND (d.parts->(d.next_part-1)->>'pages')::int=(p_result->>'pages')::int THEN RETURN jsonb_build_object('id',j.id,'state','pending','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Document lease expired' USING ERRCODE='40001';END IF;
 PERFORM sa_domain.check_fields(p_result,ARRAY['code','bytes','sha256','pages','part_index']);code_:=p_result->>'code';
 IF code_ IS NULL OR code_ NOT IN('READY','PART_READY','STORAGE_UNAVAILABLE','RENDER_FAILED','RENDER_LIMIT','UNSUPPORTED_MEDIA') THEN RAISE EXCEPTION 'Invalid render result' USING ERRCODE='22023';END IF;
 IF code_ IN('READY','PART_READY') THEN
  IF p_result->>'sha256' IS NULL OR p_result->>'sha256' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid document checksum' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.input_number(p_result->'bytes',10,67108864);PERFORM sa_domain.input_number(p_result->'pages',1,5000);
  IF (p_result->>'bytes')::numeric<>trunc((p_result->>'bytes')::numeric) OR (p_result->>'pages')::numeric<>trunc((p_result->>'pages')::numeric) THEN RAISE EXCEPTION 'Integer render metadata required' USING ERRCODE='22023';END IF;
  n:=greatest(1,ceil(jsonb_array_length(d.snapshot->'rows')/d.part_size::numeric)::integer);
  IF code_='PART_READY' THEN
   IF p_result->>'part_index' IS NULL OR NOT pg_input_is_valid(p_result->>'part_index','integer') OR(p_result->>'part_index')::integer<>d.next_part OR n=1 OR d.next_part>=n OR d.snapshot IS NULL THEN RAISE EXCEPTION 'Unexpected render part' USING ERRCODE='40001';END IF;
   UPDATE sa_domain.documents SET parts=parts||jsonb_build_array(jsonb_build_object('path','g'||d.generation::text||'/'||d.actor_id::text||'/'||d.id::text||'/part-'||lpad(d.next_part::text,4,'0')||'.pdf','bytes',(p_result->>'bytes')::bigint,'sha256',p_result->>'sha256','pages',(p_result->>'pages')::integer)),next_part=next_part+1 WHERE id=d.id;
   UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
   UPDATE sa_domain.outbox SET status='pending',attempts=0,lease_until=NULL,available_at=now(),last_error_code=NULL,revision=revision+1,result=jsonb_build_object('completed_parts',d.next_part+1,'total_parts',n) WHERE id=j.id;
   RETURN jsonb_build_object('id',j.id,'state','pending','completed_parts',d.next_part+1,'total_parts',n);
  END IF;
  IF n>1 AND d.next_part<n THEN RAISE EXCEPTION 'Render parts incomplete' USING ERRCODE='55000';END IF;
  BEGIN
   INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
   PERFORM sa_domain.document_publish((j.payload->>'document_id')::uuid,(p_result->>'bytes')::bigint,p_result->>'sha256',(p_result->>'pages')::integer);
   DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;
  END;
 ELSE error_:=code_;retry_:=code_='STORAGE_UNAVAILABLE' AND j.attempts<5;END IF;
 IF error_ IS NOT NULL THEN UPDATE sa_domain.documents SET state=CASE WHEN retry_ THEN 'rendering' ELSE 'failed' END,error_code=error_ WHERE job_id=j.id;END IF;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN error_ IS NULL THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=error_ WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status=CASE WHEN retry_ THEN 'pending' WHEN error_ IS NULL THEN 'done' ELSE 'dead' END,last_error_code=error_,lease_until=NULL,completed_at=CASE WHEN NOT retry_ THEN now() END,available_at=now()+interval '60 seconds',revision=revision+1,result=jsonb_build_object('document_id',j.payload->>'document_id') WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state',CASE WHEN retry_ THEN 'pending' WHEN error_ IS NULL THEN 'done' ELSE 'dead' END,'error_code',error_);
END $f$;
ALTER FUNCTION sa_domain.squad_document_finish(uuid,uuid,jsonb) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.account_document_grant(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;
BEGIN
 SELECT * INTO d FROM sa_domain.documents WHERE id=p_id;
 IF d.id IS NULL OR NOT sa_domain.document_current(d) THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P0002';END IF;
 IF d.state<>'ready' OR d.expires_at<=now() THEN RAISE EXCEPTION 'Document is not ready or has expired' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('id',d.id,'bucket','squad-documents','path',d.object_path,'expires_in',120,'bytes',d.bytes::text,'sha256',d.sha256,'generation',d.generation::text);
END $f$;
ALTER FUNCTION sa_domain.account_document_grant(uuid) OWNER TO sa_executor;

-- Preserve the reviewed existing routing and queue lease logic.
DO $f$ DECLARE d text;signature_ text;BEGIN
 SELECT pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'SELECT CASE WHEN', $$SELECT CASE WHEN p_event='document.requested' THEN 'document_render' WHEN$$);EXECUTE d;
 FOREACH signature_ IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP
  SELECT pg_get_functiondef(signature_::regprocedure) INTO d;
  d:=replace(d,'''notification_fanout'',''notification_delivery''','''notification_fanout'',''notification_delivery'',''document_render''');EXECUTE d;
 END LOOP;
END $f$;
CREATE INDEX squad_document_pending ON sa_domain.outbox(available_at,sequence_id) WHERE status IN('pending','leased') AND event_type='document.requested';
DO $f$ DECLARE f record;args_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['squad_document_prepare','squad_document_finish','account_document_grant']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,'SELECT sa_domain.'||f.proname||'('||args_||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO %I',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid),CASE WHEN f.proname='account_document_grant' THEN 'sa_app' ELSE 'service_role' END);
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
