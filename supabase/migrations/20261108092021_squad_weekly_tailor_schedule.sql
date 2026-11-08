BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor,sa_worker;
CREATE TABLE sa_domain.weekly_tailor_schedule(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,owner_auth_id uuid,owner_user_id bigint,generation bigint,next_week date,last_error_code text,updated_at timestamptz NOT NULL DEFAULT now(),CHECK(NOT enabled OR(owner_auth_id IS NOT NULL AND owner_user_id IS NOT NULL AND generation IS NOT NULL AND next_week IS NOT NULL)));
INSERT INTO sa_domain.weekly_tailor_schedule(singleton) VALUES(true);
CREATE TABLE sa_domain.weekly_tailor_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),generation bigint NOT NULL,week_start date NOT NULL CHECK(extract(dow FROM week_start)=6),ceiling_id bigint NOT NULL,cursor_id bigint NOT NULL DEFAULT 0,queued integer NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'running' CHECK(state IN('running','queued')),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(generation,week_start));
CREATE TABLE sa_domain.weekly_tailor_entries(run_id uuid NOT NULL REFERENCES sa_domain.weekly_tailor_runs,tailor_id bigint NOT NULL,document_id uuid NOT NULL UNIQUE REFERENCES sa_domain.documents,PRIMARY KEY(run_id,tailor_id));
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['weekly_tailor_schedule','weekly_tailor_runs','weekly_tailor_entries'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_guard,sa_executor',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE ON sa_domain.%I TO sa_worker',t);
  EXECUTE format('CREATE POLICY weekly_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
  EXECUTE format('CREATE POLICY weekly_worker ON sa_domain.%I TO sa_worker USING(true) WITH CHECK(true)',t);
  EXECUTE format('CREATE POLICY weekly_admin_read ON sa_domain.%I FOR SELECT TO sa_executor USING((sa_domain.actor()).role_id=0)',t);
 END LOOP;
END $f$;
GRANT UPDATE ON sa_domain.weekly_tailor_schedule TO sa_executor;
CREATE POLICY weekly_admin_write ON sa_domain.weekly_tailor_schedule FOR UPDATE TO sa_executor USING((sa_domain.actor()).role_id=0) WITH CHECK((sa_domain.actor()).role_id=0);
GRANT INSERT ON sa_domain.documents TO sa_worker;
GRANT USAGE ON SEQUENCE sa_domain.documents_sequence_id_seq TO sa_worker;
-- Explicit timezone; at Saturday00:00 the new week is not due until00:01.
CREATE FUNCTION sa_domain.weekly_tailor_latest_week(p_at timestamptz) RETURNS date LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 WITH local AS(SELECT p_at AT TIME ZONE 'Asia/Kolkata' AS t), boundary AS(SELECT t,t::date-((extract(dow FROM t)::integer+1)%7) AS saturday FROM local)
 SELECT saturday-CASE WHEN t<saturday::timestamp+interval '1 minute' THEN 14 ELSE 7 END FROM boundary
$f$;
REVOKE ALL ON FUNCTION sa_domain.weekly_tailor_latest_week(timestamptz) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_tailor_latest_week(timestamptz) TO sa_worker,sa_executor;
CREATE FUNCTION sa_domain.weekly_tailor_ceiling() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT coalesce(max(id),0) FROM sa_snapshot_20261019.sa_users WHERE role=5 AND deleted_at IS NULL
$f$;
ALTER FUNCTION sa_domain.weekly_tailor_ceiling() OWNER TO sa_guard;
CREATE FUNCTION sa_domain.weekly_tailor_page(p_after bigint,p_ceiling bigint,p_limit integer) RETURNS SETOF bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=5 AND deleted_at IS NULL AND id>p_after AND id<=p_ceiling ORDER BY id LIMIT least(greatest(p_limit,1),25)
$f$;
ALTER FUNCTION sa_domain.weekly_tailor_page(bigint,bigint,integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.weekly_tailor_ceiling(),sa_domain.weekly_tailor_page(bigint,bigint,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_tailor_ceiling(),sa_domain.weekly_tailor_page(bigint,bigint,integer) TO sa_worker;
CREATE INDEX squad_weekly_tailors_scan ON sa_snapshot_20261019.sa_users(id) WHERE role=5 AND deleted_at IS NULL;

CREATE FUNCTION sa_domain.weekly_document_allowed(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT NOT EXISTS(SELECT FROM sa_domain.weekly_tailor_entries e WHERE e.document_id=p_id) OR EXISTS(SELECT FROM sa_domain.weekly_tailor_entries e JOIN sa_domain.weekly_tailor_runs r ON r.id=e.run_id CROSS JOIN sa_domain.weekly_tailor_schedule s WHERE e.document_id=p_id AND s.enabled AND s.generation=r.generation AND r.generation=(SELECT generation FROM sa_domain.runtime_state))
$f$;
ALTER FUNCTION sa_domain.weekly_document_allowed(uuid) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.weekly_document_allowed(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_document_allowed(uuid) TO sa_executor,sa_worker,sa_guard;
-- Apply automation revocation in the existing document/recipient paths, while
-- preserving all original current actor, factory and item-scope checks.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.document_current(sa_domain.documents)'::regprocedure);
 IF position('IF d.actor_id<>a.auth_id' IN d)=0 THEN RAISE EXCEPTION 'Document authorization contract changed';END IF;
 d:=replace(d,'IF d.actor_id<>a.auth_id','IF NOT sa_domain.weekly_document_allowed(d.id) THEN RETURN false;END IF;'||chr(10)||' IF d.actor_id<>a.auth_id');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.business_mail_content(sa_domain.business_mail_deliveries)'::regprocedure);
 IF position('IF m.document_id IS NOT NULL THEN' IN d)=0 THEN RAISE EXCEPTION 'Document mail contract changed';END IF;
 d:=replace(d,'IF m.document_id IS NOT NULL THEN','IF m.document_id IS NOT NULL THEN IF NOT sa_domain.weekly_document_allowed(m.document_id) THEN RAISE EXCEPTION ''Scheduled report revoked'' USING ERRCODE=''42501'';END IF;');EXECUTE d;
END $f$;

CREATE FUNCTION sa_domain.v1_weekly_tailor_schedule_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);s sa_domain.weekly_tailor_schedule;r jsonb;BEGIN
 SELECT * INTO s FROM sa_domain.weekly_tailor_schedule;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'generation',generation::text,'week_start',week_start,'week_end',week_start+6,'state',state,'queued',queued,'created_at',created_at,'completed_at',completed_at) ORDER BY week_start DESC),'[]') INTO r FROM(SELECT * FROM sa_domain.weekly_tailor_runs ORDER BY generation DESC,week_start DESC LIMIT 10) x;
 RETURN jsonb_build_object('enabled',s.enabled,'owner_user_id',s.owner_user_id::text,'generation',s.generation::text,'current_generation',(SELECT generation::text FROM sa_domain.runtime_state),'next_week_start',s.next_week,'timezone','Asia/Kolkata','schedule','Saturday 00:01','error_code',s.last_error_code,'version',sa_domain.version('weekly_tailor_schedule',1),'runs',r);
END $f$;
ALTER FUNCTION sa_domain.v1_weekly_tailor_schedule_status() OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_weekly_tailor_schedule_configure(p_enabled boolean,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);s sa_domain.weekly_tailor_schedule;g bigint;cached_ jsonb;v text;r jsonb;BEGIN
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Enabled state required' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_command('weekly_tailor.configured',p_idempotency_key,jsonb_build_object('enabled',p_enabled,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;SELECT * INTO s FROM sa_domain.weekly_tailor_schedule FOR UPDATE;
 IF p_enabled AND NOT EXISTS(SELECT FROM sa_domain.business_mail_settings ms CROSS JOIN LATERAL sa_domain.mail_config_candidates(ms.kind,ms.recipient_ids) c WHERE ms.kind='tailor_weekly') THEN RAISE EXCEPTION 'Configure authorized report recipients first' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('weekly_tailor_schedule',1,p_expected_version);
 UPDATE sa_domain.weekly_tailor_schedule SET enabled=p_enabled,owner_auth_id=CASE WHEN p_enabled THEN a.auth_id ELSE owner_auth_id END,owner_user_id=CASE WHEN p_enabled THEN a.user_id ELSE owner_user_id END,generation=CASE WHEN p_enabled THEN g ELSE generation END,next_week=CASE WHEN p_enabled AND(s.generation IS DISTINCT FROM g OR s.next_week IS NULL) THEN sa_domain.weekly_tailor_latest_week(statement_timestamp()) ELSE s.next_week END,last_error_code=NULL,updated_at=now();
 r:=sa_domain.v1_weekly_tailor_schedule_status();
 RETURN sa_domain.finish_command('weekly_tailor.configured',p_idempotency_key,'weekly_tailor_schedule',1,r,jsonb_build_object('enabled',p_enabled,'owner_user_id',a.user_id));
END $f$;
ALTER FUNCTION sa_domain.v1_weekly_tailor_schedule_configure(boolean,text,uuid) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.squad_weekly_tailor_heartbeat(p_limit integer DEFAULT 25) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE s sa_domain.weekly_tailor_schedule;r sa_domain.weekly_tailor_runs;g bigint;latest_ date;tailor_ bigint;d sa_domain.documents;j uuid;n integer:=0;error_ text;BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Schedule limit must be1..25' USING ERRCODE='22023';END IF;
 IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state WHERE singleton) THEN RETURN jsonb_build_object('state','paused','error_code','MIRROR_OR_REFRESH','queued',0);END IF;
 g:=sa_domain.worker_write_fence();
 SELECT * INTO s FROM sa_domain.weekly_tailor_schedule FOR UPDATE SKIP LOCKED;
 IF s.singleton IS NULL THEN RETURN jsonb_build_object('state','busy','queued',0);END IF;
 IF NOT s.enabled THEN RETURN jsonb_build_object('state','disabled','queued',0);END IF;
 IF s.generation<>g THEN error_:='SOURCE_REFRESH_RECONFIGURE';
 ELSIF NOT EXISTS(SELECT FROM sa_domain.notification_candidates(jsonb_build_object('audience',jsonb_build_array(jsonb_build_object('id',s.owner_user_id))),0) c WHERE c.auth_id=s.owner_auth_id AND c.role_id=0) THEN error_:='SCHEDULE_OWNER_UNAVAILABLE';
 ELSIF NOT EXISTS(SELECT FROM sa_domain.business_mail_settings ms CROSS JOIN LATERAL sa_domain.mail_config_candidates(ms.kind,ms.recipient_ids) c WHERE ms.kind='tailor_weekly') THEN error_:='MAIL_RECIPIENTS_NOT_CONFIGURED';END IF;
 IF error_ IS NOT NULL THEN UPDATE sa_domain.weekly_tailor_schedule SET last_error_code=error_,updated_at=now();RETURN jsonb_build_object('state','paused','error_code',error_,'queued',0);END IF;
 latest_:=sa_domain.weekly_tailor_latest_week(statement_timestamp());
 IF s.next_week>latest_ THEN RETURN jsonb_build_object('state','waiting','next_week_start',s.next_week,'queued',0);END IF;
 INSERT INTO sa_domain.weekly_tailor_runs(generation,week_start,ceiling_id) VALUES(g,s.next_week,sa_domain.weekly_tailor_ceiling()) ON CONFLICT(generation,week_start) DO NOTHING;
 SELECT * INTO r FROM sa_domain.weekly_tailor_runs WHERE generation=g AND week_start=s.next_week FOR UPDATE;
 FOR tailor_ IN SELECT sa_domain.weekly_tailor_page(r.cursor_id,r.ceiling_id,p_limit) LOOP
  IF NOT EXISTS(SELECT FROM sa_domain.weekly_tailor_entries WHERE run_id=r.id AND tailor_id=tailor_) THEN
   INSERT INTO sa_domain.documents(actor_id,legacy_user_id,role_id,generation,kind,request,delivery_state) VALUES(s.owner_auth_id,s.owner_user_id,0,g,'tailor_weekly',jsonb_build_object('tailor_id',tailor_::text,'week_start',r.week_start,'include_team',false,'delivery','email'),'pending') RETURNING * INTO d;
   INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(s.owner_auth_id,'document.requested','document',d.sequence_id,d.id,g,jsonb_build_object('document_id',d.id,'schedule_run_id',r.id)) RETURNING id INTO j;
   UPDATE sa_domain.documents SET job_id=j WHERE id=d.id;
   INSERT INTO sa_domain.weekly_tailor_entries VALUES(r.id,tailor_,d.id);n:=n+1;
  END IF;
  r.cursor_id:=tailor_;
 END LOOP;
 IF NOT EXISTS(SELECT FROM sa_domain.weekly_tailor_page(r.cursor_id,r.ceiling_id,1)) THEN
  UPDATE sa_domain.weekly_tailor_runs SET state='queued',completed_at=now() WHERE id=r.id;r.state:='queued';
  UPDATE sa_domain.weekly_tailor_schedule SET next_week=r.week_start+7 WHERE singleton;
 END IF;
 UPDATE sa_domain.weekly_tailor_runs SET cursor_id=r.cursor_id,queued=queued+n WHERE id=r.id;
 UPDATE sa_domain.weekly_tailor_schedule SET last_error_code=NULL,updated_at=now();
 RETURN jsonb_build_object('state',r.state,'run_id',r.id,'week_start',r.week_start,'queued',n,'generation',g::text);
END $f$;
ALTER FUNCTION sa_domain.squad_weekly_tailor_heartbeat(integer) OWNER TO sa_worker;
DO $f$ DECLARE f record;args_ text;roles_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['squad_weekly_tailor_heartbeat','v1_weekly_tailor_schedule_status','v1_weekly_tailor_schedule_configure']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),'SELECT sa_domain.'||f.proname||'('||coalesce(args_,'')||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  roles_:=CASE WHEN f.proname LIKE 'squad_%' THEN 'service_role' ELSE 'sa_app' END;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO %s',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid),roles_);
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
