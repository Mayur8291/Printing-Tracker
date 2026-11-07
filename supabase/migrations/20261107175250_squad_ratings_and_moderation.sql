BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
GRANT SELECT(assigned_by_id) ON sa_snapshot_20261019.sa_orders TO sa_guard;
CREATE TABLE sa_domain.rating_moderation(rating_id bigint NOT NULL,generation bigint NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL,archived_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(rating_id,generation));
ALTER TABLE sa_domain.rating_moderation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.rating_moderation FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.rating_moderation TO sa_executor,sa_guard;
GRANT INSERT ON sa_domain.rating_moderation TO sa_executor;
CREATE POLICY squad_rating_moderation_read ON sa_domain.rating_moderation FOR SELECT TO sa_executor,sa_guard USING(true);
CREATE POLICY squad_rating_moderation_insert ON sa_domain.rating_moderation FOR INSERT TO sa_executor WITH CHECK((SELECT(sa_domain.actor()).role_id)=0 AND generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT auth.uid()));
GRANT SELECT,INSERT,UPDATE ON sa_snapshot_20261019.sa_ratings TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_ratings_id_seq TO sa_executor;
GRANT SELECT(id,rating,from_role,to_role,from_id,to_id,rating_on_type,rating_on_id) ON sa_snapshot_20261019.sa_ratings TO sa_guard;
CREATE POLICY squad_guard_ratings ON sa_snapshot_20261019.sa_ratings FOR SELECT TO sa_guard USING(true);
CREATE INDEX squad_rating_entity ON sa_snapshot_20261019.sa_ratings(rating_on_type,rating_on_id,id DESC);
CREATE INDEX squad_rating_parties ON sa_snapshot_20261019.sa_ratings(from_id,to_id,rating_on_type,rating_on_id);
CREATE INDEX squad_rating_recipient ON sa_snapshot_20261019.sa_ratings(to_id,id DESC);
CREATE FUNCTION sa_domain.rating_entity_visible(p_kind text,p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN p_kind='Order' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o WHERE o.id=p_id AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND sa_domain.can_order(o.id))
 WHEN p_kind='Item' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.id=p_id AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND sa_domain.can_item(i.id)) ELSE false END
$f$;
ALTER FUNCTION sa_domain.rating_entity_visible(text,bigint) OWNER TO sa_guard;
CREATE POLICY squad_rating_read ON sa_snapshot_20261019.sa_ratings FOR SELECT TO sa_executor
 USING(((SELECT(sa_domain.actor()).role_id)=0 OR from_id=(SELECT(sa_domain.actor()).user_id) OR to_id=(SELECT(sa_domain.actor()).user_id)) AND sa_domain.rating_entity_visible(rating_on_type,rating_on_id));
CREATE POLICY squad_rating_insert ON sa_snapshot_20261019.sa_ratings FOR INSERT TO sa_executor
 WITH CHECK(from_id=(SELECT(sa_domain.actor()).user_id) AND(SELECT(sa_domain.actor()).role_id) IN(1,2,3,4) AND sa_domain.rating_entity_visible(rating_on_type,rating_on_id));
CREATE POLICY squad_rating_update ON sa_snapshot_20261019.sa_ratings FOR UPDATE TO sa_executor
 USING(from_id=(SELECT(sa_domain.actor()).user_id) AND sa_domain.rating_entity_visible(rating_on_type,rating_on_id))
 WITH CHECK(from_id=(SELECT(sa_domain.actor()).user_id) AND sa_domain.rating_entity_visible(rating_on_type,rating_on_id));
CREATE FUNCTION sa_domain.legacy_role_name(p_role integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT (ARRAY['Admin','SalesCoordinator','ProductionCoordinator','Customer','FactoryManager','Tailor','SubTailor','DispatchIncharge','Inspector','CuttingMaster','Dealer','JobWorker','AssistantWorker'])[p_role+1]
$f$;
-- Resolve targets using actual relationship columns, never caller-supplied from_id/role.
CREATE FUNCTION sa_domain.rating_target(p_kind text,p_id bigint,p_to_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,2,3,4]);o record;target_ bigint;role_ integer;
BEGIN
 IF NOT sa_domain.rating_entity_visible(p_kind,p_id) THEN RAISE EXCEPTION 'Feedback entity unavailable' USING ERRCODE='42501';END IF;
 SELECT ord.id,ord.status,ord.uc_status,ord.order_item_type,ord.customer_id,ord.customer_sc_id,ord.assigned_by_id,ord.assigned_to_id INTO o FROM sa_snapshot_20261019.sa_orders ord
 WHERE ord.id=CASE WHEN p_kind='Order' THEN p_id ELSE(SELECT i.order_id FROM sa_snapshot_20261019.sa_items i WHERE i.id=p_id) END;
 IF o.status<>1 OR o.uc_status='CANCELLED' THEN RAISE EXCEPTION 'Only completed noncancelled work can be rated' USING ERRCODE='55000';END IF;
 IF a.role_id=3 THEN
  IF o.customer_id<>a.user_id OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_users u WHERE u.id=a.user_id AND u.is_direct_deal IS NOT TRUE AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.user_id=u.id)) THEN RAISE EXCEPTION 'Dealer-linked customer orders are not eligible for coordinator feedback' USING ERRCODE='42501';END IF;
  SELECT created_by_id INTO target_ FROM sa_snapshot_20261019.sa_users WHERE id=a.user_id;role_:=1;
 ELSIF a.role_id=1 THEN
  IF o.order_item_type<>1 OR o.customer_sc_id<>a.user_id THEN RAISE EXCEPTION 'Coordinator feedback requires an own custom order' USING ERRCODE='42501';END IF;target_:=o.assigned_by_id;role_:=2;
 ELSIF a.role_id=2 THEN target_:=o.assigned_to_id;role_:=4;
 ELSE
  role_:=9;target_:=p_to_id;
  IF o.assigned_to_id IS DISTINCT FROM a.user_id OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i WHERE i.order_id=o.id AND(p_kind='Order' OR i.id=p_id) AND i.cutting_master_id=target_) OR sa_domain.effective_factory(target_) IS DISTINCT FROM a.factory_id THEN RAISE EXCEPTION 'Choose the assigned cutter in your own managed work' USING ERRCODE='42501';END IF;
 END IF;
 IF target_ IS NULL OR target_=a.user_id OR(p_to_id IS NOT NULL AND p_to_id<>target_) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=target_ AND role=role_ AND deleted_at IS NULL AND disabled IS NOT TRUE) THEN RAISE EXCEPTION 'The related feedback recipient is unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('order_id',o.id::text,'target_id',target_::text,'target_role',role_);
END $f$;
ALTER FUNCTION sa_domain.rating_target(text,bigint,bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.rating_duplicate(p_kind text,p_id bigint,p_to_id bigint,p_except bigint DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_ratings WHERE rating_on_type=p_kind AND rating_on_id=p_id AND from_id=(SELECT(sa_domain.actor()).user_id) AND to_id=p_to_id AND id IS DISTINCT FROM p_except)
$f$;
ALTER FUNCTION sa_domain.rating_duplicate(text,bigint,bigint,bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.rating_party_names(p_from_id bigint,p_to_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('from_name',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=p_from_id),'to_name',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=p_to_id))
$f$;
ALTER FUNCTION sa_domain.rating_party_names(bigint,bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.rating_projection(p_rating jsonb,p_archived boolean,p_version text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_rating->>'id','version',p_version,'score',p_rating->>'rating','from_id',p_rating->>'from_id','to_id',p_rating->>'to_id','from_role',p_rating->>'from_role','to_role',p_rating->>'to_role',
 'entity_kind',p_rating->>'rating_on_type','entity_id',p_rating->>'rating_on_id','positive_comments',p_rating->>'positive_comments','negative_comments',p_rating->>'negative_comments','archived',p_archived,'created_at',(p_rating->>'created_at')::timestamp AT TIME ZONE 'UTC','updated_at',(p_rating->>'updated_at')::timestamp AT TIME ZONE 'UTC')||sa_domain.rating_party_names((p_rating->>'from_id')::bigint,(p_rating->>'to_id')::bigint)
$f$;
CREATE FUNCTION sa_domain.v1_ratings_list(p_entity_kind text,p_entity_id bigint,p_from_id bigint DEFAULT NULL,p_to_id bigint DEFAULT NULL,p_include_archived boolean DEFAULT false,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,10,11]);n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('ratings',jsonb_build_object('kind',p_entity_kind,'id',p_entity_id,'from',p_from_id,'to',p_to_id,'archived',p_include_archived));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_entity_kind IS NULL OR p_entity_kind NOT IN('Order','Item') OR p_entity_id IS NULL OR p_entity_id<1 OR p_include_archived IS NULL THEN RAISE EXCEPTION 'Invalid feedback filters' USING ERRCODE='22023';END IF;
 IF(p_include_archived AND a.role_id<>0) OR NOT sa_domain.rating_entity_visible(p_entity_kind,p_entity_id) THEN RAISE EXCEPTION 'Feedback entity unavailable' USING ERRCODE='42501';END IF;
 WITH rows AS MATERIALIZED(SELECT q.*,m.archived_at,m.reason FROM sa_snapshot_20261019.sa_ratings q LEFT JOIN sa_domain.rating_moderation m ON m.rating_id=q.id AND m.generation=(SELECT generation FROM sa_domain.runtime_state)
 WHERE q.rating_on_type=p_entity_kind AND q.rating_on_id=p_entity_id AND(p_from_id IS NULL OR q.from_id=p_from_id) AND(p_to_id IS NULL OR q.to_id=p_to_id)),
 scan AS MATERIALIZED(SELECT * FROM rows WHERE id<after_ AND(p_include_archived OR archived_at IS NULL) ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.rating_projection(to_jsonb(p),p.archived_at IS NOT NULL,sa_domain.version('rating',p.id))||CASE WHEN a.role_id=0 THEN jsonb_build_object('moderation_reason',p.reason) ELSE '{}'::jsonb END ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END,
 'summary',(SELECT jsonb_build_object('count',count(*),'valid_count',count(*) FILTER(WHERE rating BETWEEN 1 AND 5),'average',round(avg(rating) FILTER(WHERE rating BETWEEN 1 AND 5),2)::text,'invalid_source_count',count(*) FILTER(WHERE rating IS NULL OR NOT rating BETWEEN 1 AND 5),'scope','visible_feedback_on_entity') FROM rows WHERE archived_at IS NULL)) INTO r FROM page p;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_rating_save(p_id bigint,p_entity_kind text,p_entity_id bigint,p_to_id bigint,p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[1,2,3,4]);cached jsonb;target_ jsonb;id_ bigint:=p_id;recipient_ bigint;o bigint;v text;score_ numeric;k text;val jsonb;old_ sa_snapshot_20261019.sa_ratings;r sa_snapshot_20261019.sa_ratings;projection_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_fields,ARRAY['score','positive_comments','negative_comments']);
 IF p_entity_kind IS NULL OR p_entity_kind NOT IN('Order','Item') OR p_entity_id IS NULL OR p_entity_id<1 OR jsonb_typeof(p_fields->'score') IS DISTINCT FROM 'string' OR p_fields->>'score' !~ '^[1-5]([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Choose a valid entity and score from 1 to 5 as a decimal string' USING ERRCODE='22023';END IF;
 score_:=(p_fields->>'score')::numeric;IF score_>5 THEN RAISE EXCEPTION 'Score cannot exceed 5' USING ERRCODE='22023';END IF;
 FOR k,val IN SELECT * FROM jsonb_each(p_fields) WHERE key<>'score' LOOP IF jsonb_typeof(val) NOT IN('string','null') OR length(val#>>'{}')>2000 THEN RAISE EXCEPTION 'Comments must be text of at most 2000 characters' USING ERRCODE='22023';END IF;END LOOP;
 cached:=sa_domain.begin_command('rating.saved',p_idempotency_key,jsonb_build_object('id',p_id,'kind',p_entity_kind,'entity_id',p_entity_id,'to_id',p_to_id,'fields',p_fields,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT CASE WHEN p_entity_kind='Order' THEN p_entity_id ELSE(SELECT order_id FROM sa_snapshot_20261019.sa_items WHERE id=p_entity_id) END INTO o;
 PERFORM sa_domain.lock_order(o,false);target_:=sa_domain.rating_target(p_entity_kind,p_entity_id,p_to_id);recipient_:=(target_->>'target_id')::bigint;
 PERFORM pg_advisory_xact_lock(hashtextextended('rating:'||a.user_id||':'||recipient_||':'||p_entity_kind||':'||p_entity_id,784139));
 IF p_id IS NULL THEN
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'New feedback must not supply a version' USING ERRCODE='22023';END IF;
  IF sa_domain.rating_duplicate(p_entity_kind,p_entity_id,recipient_) THEN RAISE EXCEPTION 'Feedback already exists, including moderated history' USING ERRCODE='23505';END IF;
  INSERT INTO sa_snapshot_20261019.sa_ratings(rating,from_role,to_role,from_id,to_id,rating_on_type,rating_on_id,positive_comments,negative_comments,created_at,updated_at)
  VALUES(score_,sa_domain.legacy_role_name(a.role_id),sa_domain.legacy_role_name((target_->>'target_role')::int),a.user_id,recipient_,p_entity_kind,p_entity_id,p_fields->>'positive_comments',p_fields->>'negative_comments',now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC') RETURNING * INTO r;
  id_:=r.id;v:=sa_domain.bump_version('rating',id_,sa_domain.version('rating',id_));
 ELSE
  SELECT * INTO old_ FROM sa_snapshot_20261019.sa_ratings WHERE id=p_id;
  IF old_.id IS NULL OR old_.from_id<>a.user_id OR old_.to_id<>recipient_ OR old_.from_role IS DISTINCT FROM sa_domain.legacy_role_name(a.role_id) OR old_.rating_on_type<>p_entity_kind OR old_.rating_on_id<>p_entity_id THEN RAISE EXCEPTION 'Only your own feedback on the same relationship can be edited' USING ERRCODE='42501';END IF;
  v:=sa_domain.bump_version('rating',id_,p_expected_version);
  IF EXISTS(SELECT FROM sa_domain.rating_moderation WHERE rating_id=id_ AND generation=(SELECT generation FROM sa_domain.runtime_state)) THEN RAISE EXCEPTION 'Moderated feedback cannot be rewritten' USING ERRCODE='55000';END IF;
  UPDATE sa_snapshot_20261019.sa_ratings SET rating=score_,positive_comments=CASE WHEN p_fields?'positive_comments' THEN p_fields->>'positive_comments' ELSE positive_comments END,negative_comments=CASE WHEN p_fields?'negative_comments' THEN p_fields->>'negative_comments' ELSE negative_comments END,updated_at=now() AT TIME ZONE 'UTC' WHERE id=id_ RETURNING * INTO r;
 END IF;
 projection_:=sa_domain.rating_projection(to_jsonb(r),false,v);
 RETURN sa_domain.finish_command('rating.saved',p_idempotency_key,'rating',id_,projection_||jsonb_build_object('summary',sa_domain.v1_ratings_list(p_entity_kind,p_entity_id,NULL,recipient_)->'summary'),
 jsonb_build_object('before_score',old_.rating::text,'after_score',score_::text,'recipient_id',recipient_::text,'score_changed',old_.id IS NULL OR old_.rating IS DISTINCT FROM score_,'entity_kind',p_entity_kind,'entity_id',p_entity_id::text,'before_positive',old_.positive_comments,'before_negative',old_.negative_comments,'positive',r.positive_comments,'negative',r.negative_comments));
END $f$;
CREATE FUNCTION sa_domain.v1_rating_archive(p_id bigint,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;r sa_snapshot_20261019.sa_ratings;v text;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);cached:=sa_domain.begin_command('rating.archived',p_idempotency_key,jsonb_build_object('id',p_id,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 v:=sa_domain.bump_version('rating',p_id,p_expected_version);SELECT * INTO r FROM sa_snapshot_20261019.sa_ratings WHERE id=p_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Feedback unavailable' USING ERRCODE='P0002';END IF;
 IF EXISTS(SELECT FROM sa_domain.rating_moderation WHERE rating_id=p_id AND generation=(SELECT generation FROM sa_domain.runtime_state)) THEN RAISE EXCEPTION 'Feedback is already archived' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.rating_moderation(rating_id,generation,reason,actor_id) SELECT p_id,generation,p_reason,a.auth_id FROM sa_domain.runtime_state;
 RETURN sa_domain.finish_command('rating.archived',p_idempotency_key,'rating',p_id,jsonb_build_object('id',p_id::text,'version',v,'archived',true,'summary',sa_domain.v1_ratings_list(r.rating_on_type,r.rating_on_id,NULL,r.to_id)->'summary'),jsonb_build_object('reason',p_reason,'recipient_id',r.to_id::text,'before_score',r.rating::text,'entity_kind',r.rating_on_type,'entity_id',r.rating_on_id::text));
END $f$;
DO $f$ DECLARE p record;call_ text;BEGIN
 FOR p IN SELECT pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args,pr.provolatile FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY[
 'rating_party_names','rating_entity_visible','legacy_role_name','rating_target','rating_duplicate','rating_projection','v1_ratings_list','v1_rating_save','v1_rating_archive']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor',p.proname,p.args);
  IF p.proname LIKE 'v1_%' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s),' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,CASE WHEN p.provolatile='s' THEN 'STABLE' ELSE '' END,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.rating_entity_visible(text,bigint) TO sa_guard;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
