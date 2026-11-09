--131: Original multi-target setup and achievement filters on shared target commands.
BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
CREATE FUNCTION sa_domain.v1_milestones_list(p_subject_id bigint,p_cursor text,p_limit integer,p_state text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1]);n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('milestones',jsonb_build_object('subject',p_subject_id,'state',p_state,'day',(now() AT TIME ZONE 'Asia/Kolkata')::date));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_state IS NULL OR p_state NOT IN('all','pending','achieved','current') THEN RAISE EXCEPTION 'Invalid target state' USING ERRCODE='22023';END IF;
 IF a.role_id=1 AND p_subject_id IS NOT NULL AND p_subject_id<>a.user_id THEN RAISE EXCEPTION 'Coordinator unavailable' USING ERRCODE='42501';END IF;
 WITH scan AS MATERIALIZED(SELECT m.* FROM sa_snapshot_20261019.sa_milestones m WHERE m.id<after_ AND (p_subject_id IS NULL OR m.user_id=p_subject_id)
  AND NOT EXISTS(SELECT FROM sa_domain.archived_entities x WHERE x.kind='milestone' AND x.entity_id=m.id AND x.generation=(ctx->>'generation')::bigint)
  AND (p_state='all' OR (p_state='current' AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN sa_domain.local_date(m.start_date) AND sa_domain.local_date(m.end_date))
   OR (p_state IN('pending','achieved') AND (SELECT coalesce(sum(o.total_amount),0)>=m.milestone_amount FROM sa_snapshot_20261019.sa_orders o
     WHERE o.customer_sc_id=m.user_id AND o.status=1 AND o.uc_status<>'CANCELLED' AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL
      AND o.created_at>=sa_domain.day_start(sa_domain.local_date(m.start_date)) AND o.created_at<sa_domain.day_start(sa_domain.local_date(m.end_date)+1))=(p_state='achieved')))
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

CREATE FUNCTION sa_domain.v1_milestones_create(p_subject_id bigint,p_targets jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached_ jsonb;row_ jsonb;ordinal_ bigint;result_ jsonb;items_ jsonb:='[]';
BEGIN
 IF jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets) NOT BETWEEN 1 AND 24 THEN
  RAISE EXCEPTION 'Choose between1 and24 targets' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_command('milestones.created',p_idempotency_key,jsonb_build_object('subject_id',p_subject_id,'targets',p_targets));
 IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 FOR row_,ordinal_ IN SELECT value,ordinality FROM jsonb_array_elements(p_targets) WITH ORDINALITY LOOP
  IF jsonb_typeof(row_) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid target' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.check_fields(row_,ARRAY['name','start','end','amount']);
  IF jsonb_typeof(row_->'name') IS DISTINCT FROM 'string' OR length(btrim(row_->>'name'))=0 THEN RAISE EXCEPTION 'Target name required' USING ERRCODE='22023';END IF;
  result_:=sa_domain.v1_milestone_save(NULL,p_subject_id,(row_->>'start')::date,(row_->>'end')::date,(row_->>'amount')::numeric,row_->>'name',NULL,md5(p_idempotency_key::text||':milestone:'||ordinal_)::uuid);
  items_:=items_||jsonb_build_array(result_);
 END LOOP;
 RETURN sa_domain.finish_command('milestones.created',p_idempotency_key,'milestone',(items_->0->>'id')::bigint,
  jsonb_build_object('data',items_,'created',jsonb_array_length(items_)),jsonb_build_object('subject_id',p_subject_id::text,'ids',(SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(items_) x)));
END $f$;
ALTER FUNCTION sa_domain.v1_milestones_list(bigint,text,integer,text) OWNER TO sa_executor;
ALTER FUNCTION sa_domain.v1_milestones_create(bigint,jsonb,uuid) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_milestones_list(bigint,text,integer,text),sa_domain.v1_milestones_create(bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_milestones_list(bigint,text,integer,text),sa_domain.v1_milestones_create(bigint,jsonb,uuid) TO sa_app;
CREATE FUNCTION canto_api.v1_milestones_list(p_subject_id bigint,p_cursor text,p_limit integer,p_state text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_milestones_list(p_subject_id,p_cursor,p_limit,p_state) $f$;
CREATE FUNCTION canto_api.v1_milestones_create(p_subject_id bigint,p_targets jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_milestones_create(p_subject_id,p_targets,p_idempotency_key) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_milestones_list(bigint,text,integer,text),canto_api.v1_milestones_create(bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_milestones_list(bigint,text,integer,text),canto_api.v1_milestones_create(bigint,jsonb,uuid) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
