BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_milestones TO sa_executor;
GRANT UPDATE(name,start_date,end_date,milestone_amount,updated_at) ON sa_snapshot_20261019.sa_milestones TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_milestones_id_seq TO sa_executor;
CREATE POLICY squad_milestone_read ON sa_snapshot_20261019.sa_milestones FOR SELECT TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id)=0 OR ((SELECT (sa_domain.actor()).role_id)=1 AND user_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_milestone_insert ON sa_snapshot_20261019.sa_milestones FOR INSERT TO sa_executor WITH CHECK((SELECT (sa_domain.actor()).role_id)=0);
CREATE POLICY squad_milestone_update ON sa_snapshot_20261019.sa_milestones FOR UPDATE TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id)=0) WITH CHECK((SELECT (sa_domain.actor()).role_id)=0);
CREATE INDEX squad_milestone_user_page ON sa_snapshot_20261019.sa_milestones(user_id,id DESC);
CREATE INDEX squad_orders_sc_created ON sa_snapshot_20261019.sa_orders(customer_sc_id,created_at) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;

-- The business calendar is Asia/Kolkata. API dates are inclusive calendar dates;
-- queries use [start, following-day-start), including fractional final seconds.
CREATE FUNCTION sa_domain.local_date(p_stored timestamp without time zone) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT (p_stored AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
$f$;
CREATE FUNCTION sa_domain.day_start(p_day date) RETURNS timestamp without time zone
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT p_day::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'
$f$;
CREATE FUNCTION sa_domain.v1_milestone_save(p_id bigint,p_subject_id bigint,p_start date,p_end date,p_amount numeric,p_name text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;id_ bigint;v text;old sa_snapshot_20261019.sa_milestones%ROWTYPE;
BEGIN
 IF p_subject_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
  OR p_end<p_start OR p_end-p_start>1826 OR p_amount IS NULL OR p_amount<=0 OR p_amount>1000000000000
  OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_name IS NULL OR length(p_name)>200
  OR (p_id IS NULL AND p_expected_version IS NOT NULL) THEN RAISE EXCEPTION 'Invalid target fields' USING ERRCODE='22023'; END IF;
 cached:=sa_domain.begin_command('milestone.saved',p_idempotency_key,jsonb_build_object('id',p_id,'subject',p_subject_id,'start',p_start,'end',p_end,'amount',p_amount,'name',p_name,'version',p_expected_version));
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_subject_id AND role=1 AND deleted_at IS NULL AND disabled IS NOT TRUE) THEN
  RAISE EXCEPTION 'Coordinator unavailable' USING ERRCODE='42501';END IF;
 -- Serialize all target interval changes for one coordinator, including creates.
 PERFORM pg_advisory_xact_lock(hashtextextended('milestone:'||p_subject_id,784139));
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM sa_snapshot_20261019.sa_milestones WHERE id=p_id FOR UPDATE;
  IF old.id IS NULL OR old.user_id<>p_subject_id OR EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='milestone' AND x.entity_id=p_id AND x.generation=(SELECT generation FROM sa_domain.runtime_state)) THEN
   RAISE EXCEPTION 'Target unavailable or coordinator changed' USING ERRCODE='42501';END IF;
 END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_milestones m WHERE m.user_id=p_subject_id AND (p_id IS NULL OR m.id<>p_id)
  AND sa_domain.local_date(m.start_date)<=p_end AND sa_domain.local_date(m.end_date)>=p_start
  AND NOT EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='milestone' AND x.entity_id=m.id AND x.generation=(SELECT generation FROM sa_domain.runtime_state))) THEN
  RAISE EXCEPTION 'Target period overlaps an existing target' USING ERRCODE='23P01';END IF;
 IF p_id IS NULL THEN
  INSERT INTO sa_snapshot_20261019.sa_milestones(user_id,name,start_date,end_date,milestone_amount,order_placed_amount,order_completed_amount,created_at,updated_at)
  VALUES(p_subject_id,btrim(p_name),sa_domain.day_start(p_start),sa_domain.day_start(p_end+1)-interval '1 microsecond',p_amount,0,0,now(),now()) RETURNING id INTO id_;
  v:=sa_domain.bump_version('milestone',id_,sa_domain.version('milestone',id_));
 ELSE
  id_:=p_id;v:=sa_domain.bump_version('milestone',id_,p_expected_version);
  UPDATE sa_snapshot_20261019.sa_milestones SET name=btrim(p_name),start_date=sa_domain.day_start(p_start),end_date=sa_domain.day_start(p_end+1)-interval '1 microsecond',milestone_amount=p_amount,updated_at=now() WHERE id=id_;
 END IF;
 RETURN sa_domain.finish_command('milestone.saved',p_idempotency_key,'milestone',id_,jsonb_build_object('id',id_::text,'version',v),jsonb_build_object('subject_id',p_subject_id::text,'start',p_start,'end',p_end));
END $f$;
CREATE FUNCTION sa_domain.v1_milestone_archive(p_id bigint,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;m sa_snapshot_20261019.sa_milestones%ROWTYPE;v text;
BEGIN
 cached:=sa_domain.begin_command('milestone.archived',p_idempotency_key,jsonb_build_object('id',p_id,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO m FROM sa_snapshot_20261019.sa_milestones WHERE id=p_id;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Target unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('milestone:'||m.user_id,784139));
 v:=sa_domain.bump_version('milestone',p_id,p_expected_version);
 PERFORM sa_domain.archive_entity('milestone',p_id,p_reason);
 RETURN sa_domain.finish_command('milestone.archived',p_idempotency_key,'milestone',p_id,jsonb_build_object('id',p_id::text,'archived',true,'version',v));
END $f$;
CREATE FUNCTION sa_domain.v1_milestones_list(p_subject_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1]);n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('milestones',jsonb_build_object('subject',p_subject_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF a.role_id=1 AND p_subject_id IS NOT NULL AND p_subject_id<>a.user_id THEN RAISE EXCEPTION 'Coordinator unavailable' USING ERRCODE='42501';END IF;
 WITH scan AS MATERIALIZED(SELECT m.* FROM sa_snapshot_20261019.sa_milestones m WHERE m.id<after_ AND (p_subject_id IS NULL OR m.user_id=p_subject_id)
  AND NOT EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='milestone' AND x.entity_id=m.id AND x.generation=(ctx->>'generation')::bigint)
  ORDER BY m.id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT m.*,sa_domain.local_date(start_date) start_day,sa_domain.local_date(end_date) end_day,
   sa_domain.day_start(sa_domain.local_date(start_date)) start_at,sa_domain.day_start(sa_domain.local_date(end_date)+1) end_at FROM scan m ORDER BY id DESC LIMIT n),
 totals AS(SELECT p.id,count(o.id) order_count,coalesce(sum(o.total_amount),0) placed,
  coalesce(sum(o.total_amount) FILTER(WHERE o.status=1),0) completed FROM page p
  LEFT JOIN sa_snapshot_20261019.sa_orders o ON o.customer_sc_id=p.user_id AND o.created_at>=p.start_at AND o.created_at<p.end_at
   AND o.uc_status<>'CANCELLED' AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL GROUP BY p.id)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'subject_id',p.user_id::text,'name',p.name,'start',p.start_day,'end',p.end_day,
  'target_amount',p.milestone_amount::text,'placed_amount',t.placed::text,'completed_amount',t.completed::text,'order_count',t.order_count,
  'achieved',t.completed>=p.milestone_amount,'current',(now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.start_day AND p.end_day,
  'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
 INTO r FROM page p JOIN totals t ON t.id=p.id LEFT JOIN sa_domain.entity_versions v ON v.kind='milestone' AND v.entity_id=p.id;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_milestone_progress(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1]);m sa_snapshot_20261019.sa_milestones%ROWTYPE;
 from_ timestamp;until_ timestamp;year_from_ timestamp;year_until_ timestamp;r jsonb;
BEGIN
 SELECT * INTO m FROM sa_snapshot_20261019.sa_milestones t WHERE id=p_id AND NOT EXISTS(
  SELECT FROM sa_domain.archived_entities x WHERE x.kind='milestone' AND x.entity_id=t.id AND x.generation=(SELECT generation FROM sa_domain.runtime_state));
 IF m.id IS NULL THEN RAISE EXCEPTION 'Target not found or unavailable' USING ERRCODE='P0002';END IF;
 from_:=sa_domain.day_start(sa_domain.local_date(m.start_date));until_:=sa_domain.day_start(sa_domain.local_date(m.end_date)+1);
 year_from_:=sa_domain.day_start(date_trunc('year',now() AT TIME ZONE 'Asia/Kolkata')::date);
 year_until_:=(now() AT TIME ZONE 'UTC');
 SELECT jsonb_build_object('id',m.id::text,'subject_id',m.user_id::text,'target_amount',m.milestone_amount::text,
  'placed_amount',coalesce(sum(o.total_amount) FILTER(WHERE o.created_at>=from_ AND o.created_at<until_),0)::text,
  'completed_amount',coalesce(sum(o.total_amount) FILTER(WHERE o.created_at>=from_ AND o.created_at<until_ AND o.status=1),0)::text,
  'order_count',count(*) FILTER(WHERE o.created_at>=from_ AND o.created_at<until_),
  'year_to_date_placed',coalesce(sum(o.total_amount) FILTER(WHERE o.created_at>=year_from_ AND o.created_at<=year_until_),0)::text,
  'year_to_date_completed',coalesce(sum(o.total_amount) FILTER(WHERE o.created_at>=year_from_ AND o.created_at<=year_until_ AND o.status=1),0)::text,
  'period_start_utc',from_ AT TIME ZONE 'UTC','period_end_exclusive_utc',until_ AT TIME ZONE 'UTC','as_of',now())
 INTO r FROM sa_snapshot_20261019.sa_orders o WHERE o.customer_sc_id=m.user_id AND o.uc_status<>'CANCELLED'
  AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND o.created_at>=least(from_,year_from_) AND o.created_at<=greatest(until_,year_until_);
 RETURN r;
END $f$;

DO $do$ DECLARE f record;arguments_ text;body_ text; BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_milestone_save','v1_milestone_archive','v1_milestones_list','v1_milestone_progress']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
END $do$;
REVOKE ALL ON FUNCTION sa_domain.local_date(timestamp),sa_domain.day_start(date) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.local_date(timestamp),sa_domain.day_start(date) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
