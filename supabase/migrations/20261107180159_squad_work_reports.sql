BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
CREATE FUNCTION sa_domain.report_period(p_from date,p_before date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE end_ date:=coalesce(p_before,(now() AT TIME ZONE 'Asia/Kolkata')::date+1);start_ date:=coalesce(p_from,end_-30);
BEGIN
 IF start_<'2000-01-01'::date OR end_> (now() AT TIME ZONE 'Asia/Kolkata')::date+1 OR end_<=start_ OR end_-start_>366 THEN RAISE EXCEPTION 'Choose a past period of 1..366 days; before is exclusive' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('from',start_,'before',end_,'start_utc',start_::timestamp AT TIME ZONE 'Asia/Kolkata','end_exclusive_utc',end_::timestamp AT TIME ZONE 'Asia/Kolkata','timezone','Asia/Kolkata');
END $f$;
CREATE FUNCTION sa_domain.report_context(p_resource text,p_filters jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT sa_domain.page_context(p_resource,p_filters)||jsonb_build_object('edit_revision',edit_revision::text) FROM sa_sync.environment_state WHERE singleton
$f$;
-- One batched formula serves weekly earnings and the leaderboard. Callers pass
-- authorized subjects/items; this helper is private to reviewed SQL functions.
CREATE FUNCTION sa_domain.tailor_work_rows(p_subject_ids bigint[],p_start timestamptz,p_end timestamptz,p_item_ids bigint[] DEFAULT NULL)
RETURNS TABLE(id bigint,item_id bigint,tailor_id bigint,base_product_id bigint,product_name text,assigned bigint,completed bigint,of_rate numeric,sn_rate numeric,amount numeric,needs_reconciliation boolean,quantity_invalid boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 RETURN QUERY WITH work AS MATERIALIZED(SELECT it.id,it.item_id,it.tailor_id,sum(q.assigned_quantity)::bigint assigned,sum(q.completed_quantity)::bigint completed,
 bool_or(q.assigned_quantity<0 OR q.completed_quantity<0 OR q.completed_quantity>q.assigned_quantity) invalid
 FROM sa_snapshot_20261019.sa_item_tailors it JOIN sa_snapshot_20261019.sa_job_sheet_assign_quantities q ON q.item_tailor_id=it.id
 JOIN sa_snapshot_20261019.sa_job_sheet_assign_dates d ON d.id=q.job_sheet_assign_date_id
 WHERE it.tailor_id=ANY(p_subject_ids) AND (p_item_ids IS NULL OR it.item_id=ANY(p_item_ids)) AND d.assign_at>=p_start AT TIME ZONE 'UTC' AND d.assign_at<p_end AT TIME ZONE 'UTC'
 GROUP BY it.id,it.item_id,it.tailor_id),
 products AS MATERIALIZED(SELECT w.*,p.base_product_id FROM work w LEFT JOIN sa_snapshot_20261019.sa_items i ON i.id=w.item_id LEFT JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id),
 rates AS(SELECT j.base_product_id,sum(coalesce(x.add_on_of,0)) of_,sum(coalesce(x.add_on_sn,0)) sn_,bool_or(x.id IS NULL OR x.add_on_of IS NULL OR x.add_on_sn IS NULL OR x.add_on_of<0 OR x.add_on_sn<0) invalid
 FROM sa_snapshot_20261019.sa_add_on_base_products j LEFT JOIN sa_snapshot_20261019.sa_add_ons x ON x.id=j.add_on_id
 WHERE j.base_product_id IN(SELECT p.base_product_id FROM products p) GROUP BY j.base_product_id),
 priced AS(SELECT p.*,b.name,coalesce(b.base_of,0)+coalesce(r.of_,0) of_,coalesce(b.base_sn,0)+coalesce(r.sn_,0) sn_,
 p.invalid OR b.id IS NULL OR b.base_of IS NULL OR b.base_sn IS NULL OR b.base_of<0 OR b.base_sn<0 OR coalesce(r.invalid,false) review
 FROM products p LEFT JOIN sa_snapshot_20261019.sa_base_products b ON b.id=p.base_product_id LEFT JOIN rates r ON r.base_product_id=p.base_product_id)
 SELECT p.id,p.item_id,p.tailor_id,p.base_product_id,p.name::text,p.assigned,p.completed,p.of_,p.sn_,CASE WHEN p.review THEN NULL ELSE round((p.of_+p.sn_)*p.completed,2) END,p.review,p.invalid FROM priced p;
END $f$;
ALTER FUNCTION sa_domain.tailor_work_rows(bigint[],timestamptz,timestamptz,bigint[]) OWNER TO sa_guard;
CREATE OR REPLACE FUNCTION sa_domain.tailor_earnings_rows(p_tailor_id bigint,p_start timestamptz,p_end timestamptz,p_include_team boolean)
RETURNS TABLE(id bigint,item_id bigint,tailor_id bigint,base_product_id bigint,product_name text,assigned bigint,completed bigint,of_rate numeric,sn_rate numeric,amount numeric,needs_reconciliation boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4]);target_ record;subjects_ bigint[];items_ bigint[];
BEGIN
 SELECT u.id,u.role INTO target_ FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_tailor_id AND u.role IN(5,6) AND u.deleted_at IS NULL;
 IF target_.id IS NULL OR (a.role_id=4 AND (a.factory_id IS NULL OR sa_domain.effective_factory(p_tailor_id) IS DISTINCT FROM a.factory_id)) THEN RAISE EXCEPTION 'Tailor unavailable in your factory scope' USING ERRCODE='P0002';END IF;
 IF p_include_team IS NULL OR (p_include_team AND target_.role<>5) THEN RAISE EXCEPTION 'Only a parent tailor can include a team' USING ERRCODE='22023';END IF;
 SELECT array_agg(u.id) INTO subjects_ FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_tailor_id OR (p_include_team AND u.role=6 AND u.parent_tailor_id=p_tailor_id AND u.deleted_at IS NULL);
 IF a.role_id=4 THEN SELECT array_agg(x) INTO items_ FROM sa_domain.scope_item_ids() x;END IF;
 RETURN QUERY SELECT w.id,w.item_id,w.tailor_id,w.base_product_id,w.product_name,w.assigned,w.completed,w.of_rate,w.sn_rate,w.amount,w.needs_reconciliation FROM sa_domain.tailor_work_rows(subjects_,p_start,p_end,items_) w WHERE w.completed>0 OR w.needs_reconciliation;
END $f$;

GRANT EXECUTE ON FUNCTION sa_domain.people_factory_ids(bigint) TO sa_guard;
CREATE FUNCTION sa_domain.v1_tailor_leaderboard(p_factory_id bigint DEFAULT NULL,p_from date DEFAULT NULL,p_before date DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4,7,8]);period_ jsonb:=sa_domain.report_period(p_from,p_before);n int:=sa_domain.page_limit(p_limit);factory_ bigint:=p_factory_id;subjects_ bigint[];items_ bigint[];ctx jsonb;cur jsonb;r jsonb;
BEGIN
 IF a.role_id IN(4,7,8) THEN
  IF a.factory_id IS NULL OR(p_factory_id IS NOT NULL AND p_factory_id IS DISTINCT FROM a.factory_id) THEN RAISE EXCEPTION 'Factory outside your scope' USING ERRCODE='42501';END IF;factory_:=a.factory_id;
 END IF;
 IF factory_ IS NOT NULL AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_factories WHERE id=factory_ AND nullif(deleted_at,'') IS NULL) THEN RAISE EXCEPTION 'Factory unavailable' USING ERRCODE='P0002';END IF;
 SELECT coalesce(array_agg(u.id),'{}') INTO subjects_ FROM sa_snapshot_20261019.sa_users u WHERE u.role IN(5,6) AND u.deleted_at IS NULL AND(factory_ IS NULL OR u.id IN(SELECT sa_domain.people_factory_ids(factory_)));
 SELECT coalesce(array_agg(x),'{}') INTO items_ FROM sa_domain.scope_item_ids() x;
 ctx:=sa_domain.report_context('tailor_leaderboard',jsonb_build_object('factory_id',factory_,'period',period_));cur:=sa_domain.catalog_cursor(p_cursor,ctx);
 IF cur IS NOT NULL AND(cur->>'sort' !~ '^[1-9][0-9]{0,9}$') THEN RAISE EXCEPTION 'Invalid report cursor' USING ERRCODE='22023';END IF;
 WITH work AS MATERIALIZED(SELECT * FROM sa_domain.tailor_work_rows(subjects_,(period_->>'start_utc')::timestamptz,(period_->>'end_exclusive_utc')::timestamptz,items_)),
 totals AS(SELECT w.tailor_id,sum(w.assigned) assigned,sum(w.completed) completed,sum(w.amount) amount,bool_or(w.needs_reconciliation) review,bool_or(w.quantity_invalid) quantity_review FROM work w GROUP BY w.tailor_id),
 subjects AS(SELECT u.id,u.name,u.role,u.parent_tailor_id,coalesce(t.assigned,0) assigned,CASE WHEN t.quantity_review THEN NULL ELSE coalesce(t.completed,0) END completed,CASE WHEN t.review THEN NULL ELSE coalesce(t.amount,0) END amount,coalesce(t.review,false) review,coalesce(t.quantity_review,false) quantity_review FROM sa_snapshot_20261019.sa_users u LEFT JOIN totals t ON t.tailor_id=u.id WHERE u.id=ANY(subjects_)),
 ranked AS MATERIALIZED(SELECT s.*,row_number() OVER(ORDER BY completed DESC NULLS LAST,id) position,rank() OVER(ORDER BY completed DESC NULLS LAST) rank FROM subjects s),
 scan AS MATERIALIZED(SELECT * FROM ranked WHERE cur IS NULL OR position>(cur->>'sort')::bigint ORDER BY position LIMIT n+1),page AS(SELECT * FROM scan ORDER BY position LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'name',p.name,'role',p.role,'parent_tailor_id',p.parent_tailor_id::text,'position',p.position,'rank',p.rank,'assigned',p.assigned,'completed',p.completed,'needs_reconciliation',CASE WHEN a.role_id IN(0,2,4) THEN p.review ELSE p.quantity_review END)||CASE WHEN a.role_id IN(0,2,4) THEN jsonb_build_object('amount',p.amount::text) ELSE '{}'::jsonb END ORDER BY position),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN(SELECT sa_domain.catalog_next_cursor(id,position::text,ctx) FROM page ORDER BY position DESC LIMIT 1) END,
 'summary',(SELECT jsonb_build_object('subjects',count(*),'completed',coalesce(sum(completed),0),'needs_reconciliation',coalesce(bool_or(CASE WHEN a.role_id IN(0,2,4) THEN review ELSE quantity_review END),false)) FROM ranked),'period',period_,'as_of',now(),
 'basis',jsonb_build_object('formula','legacy-tailor-v1','rates','current_master','addons','all_linked_base_addons','period','assignment_date','completion','current_at_read','subjects','tailors_and_subtailors_separate','ranking','completed_quantity_descending','cursor','restart_after_business_change')) INTO r FROM page p;RETURN r;
END $f$;

CREATE FUNCTION sa_domain.metrics_item_ids(p_subject_id bigint,p_factory_id bigint) RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4,7,8,9,11]);subject_ bigint:=p_subject_id;factory_ bigint:=p_factory_id;role_ integer;subject_factory bigint;
BEGIN
 IF a.role_id IN(9,11) THEN
  IF p_subject_id IS NOT NULL AND p_subject_id<>a.user_id THEN RAISE EXCEPTION 'Only your own work metrics are available' USING ERRCODE='42501';END IF;subject_:=a.user_id;
 END IF;
 IF a.role_id IN(4,7,8,9) THEN
  IF a.factory_id IS NULL OR(p_factory_id IS NOT NULL AND p_factory_id IS DISTINCT FROM a.factory_id) THEN RAISE EXCEPTION 'Factory outside your scope' USING ERRCODE='42501';END IF;factory_:=a.factory_id;
 END IF;
 IF a.role_id=11 AND p_factory_id IS NOT NULL THEN RAISE EXCEPTION 'Job-worker metrics are not factory metrics' USING ERRCODE='22023';END IF;
 IF factory_ IS NOT NULL AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_factories WHERE id=factory_ AND nullif(deleted_at,'') IS NULL) THEN RAISE EXCEPTION 'Factory unavailable' USING ERRCODE='P0002';END IF;
 IF subject_ IS NOT NULL THEN
  SELECT role INTO role_ FROM sa_snapshot_20261019.sa_users WHERE id=subject_ AND role IN(4,7,8,9,11) AND deleted_at IS NULL AND disabled IS NOT TRUE;
  IF role_ IS NULL THEN RAISE EXCEPTION 'Work subject unavailable' USING ERRCODE='42501';END IF;
  subject_factory:=sa_domain.effective_factory(subject_);
  IF a.role_id IN(4,7,8,9) AND subject_factory IS DISTINCT FROM a.factory_id THEN RAISE EXCEPTION 'Subject outside your factory' USING ERRCODE='42501';END IF;
 END IF;
 RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 WHERE i.id IN(SELECT sa_domain.scope_item_ids()) AND i.item_type=0 AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL
 AND(factory_ IS NULL OR o.assigned_to_id IN(SELECT u.id FROM sa_snapshot_20261019.sa_users u WHERE u.role=4 AND u.factory_id=factory_))
 AND(subject_ IS NULL OR CASE role_ WHEN 4 THEN o.assigned_to_id=subject_ WHEN 9 THEN i.cutting_master_id=subject_ WHEN 11 THEN o.assigned_worker_id=subject_
 ELSE o.assigned_to_id IN(SELECT u.id FROM sa_snapshot_20261019.sa_users u WHERE u.role=4 AND u.factory_id=subject_factory) END);
END $f$;
ALTER FUNCTION sa_domain.metrics_item_ids(bigint,bigint) OWNER TO sa_guard;
GRANT SELECT(id,order_id,item_type,total_quantity,job_worker_status,job_sheet_due_on) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(id,status,uc_status,created_at,created_on,due_on,delivered_on,assigned_worker_id,worker_status) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT(id,item_id,quantity,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity) ON sa_snapshot_20261019.sa_quantities TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_mark_cuttings,sa_snapshot_20261019.sa_mark_cutting_quantities,sa_snapshot_20261019.sa_job_sheet_assign_dates,sa_snapshot_20261019.sa_job_sheet_assign_quantities,
 sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates,sa_snapshot_20261019.sa_job_sheet_mark_tailors,sa_snapshot_20261019.sa_mark_tailor_quantities,sa_snapshot_20261019.sa_job_sheet_dispatched_dates,sa_snapshot_20261019.sa_dispatched_quantities TO sa_guard;
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['quantities','mark_cuttings','mark_cutting_quantities','job_sheet_assign_dates','job_sheet_assign_quantities','job_sheet_tailor_mark_dates','job_sheet_mark_tailors','mark_tailor_quantities','job_sheet_dispatched_dates','dispatched_quantities'] LOOP
  EXECUTE format('CREATE POLICY squad_metric_guard ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $f$;
GRANT SELECT(created_at) ON sa_snapshot_20261019.sa_ratings TO sa_guard;
GRANT SELECT ON sa_domain.worker_due_baselines TO sa_guard;
CREATE POLICY squad_metric_baselines ON sa_domain.worker_due_baselines FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.work_metric_data(p_subject_id bigint,p_factory_id bigint,p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;a sa_domain.actor:=sa_domain.actor();
BEGIN
 WITH scoped AS MATERIALIZED(SELECT i.id,i.order_id,i.job_sheet_due_on,i.job_worker_status FROM sa_snapshot_20261019.sa_items i WHERE i.id IN(SELECT sa_domain.metrics_item_ids(p_subject_id,p_factory_id))),
 orders_ AS MATERIALIZED(SELECT o.id,o.status,o.uc_status,o.created_at,o.created_on,o.due_on,o.delivered_on,o.assigned_worker_id,o.worker_status FROM sa_snapshot_20261019.sa_orders o WHERE o.id IN(SELECT s.order_id FROM scoped s)),
 cohort AS MATERIALIZED(SELECT * FROM orders_ WHERE coalesce(created_on,created_at)>=p_start AT TIME ZONE 'UTC' AND coalesce(created_on,created_at)<p_end AT TIME ZONE 'UTC'),
 baselines AS(SELECT DISTINCT ON(b.order_id) b.order_id,b.original_due_at,b.basis FROM sa_domain.worker_due_baselines b JOIN orders_ o ON o.id=b.order_id AND o.assigned_worker_id=b.worker_id WHERE b.generation=(SELECT generation FROM sa_domain.runtime_state) ORDER BY b.order_id,b.assignment_revision DESC),
 balances AS MATERIALIZED(SELECT s.id,count(q.id) rows_,sum(q.quantity)::bigint ordered,sum(q.cutting_done)::bigint cut,sum(q.assigned_to_tailor_quantity)::bigint assigned,sum(q.completed_by_tailor_quantity)::bigint inspected,sum(q.dispatched_quantity)::bigint dispatched,
 count(q.id)=0 OR coalesce(bool_or(q.quantity IS NULL OR q.quantity<0 OR q.cutting_done>q.quantity OR q.cutting_done<q.assigned_to_tailor_quantity OR q.assigned_to_tailor_quantity<q.completed_by_tailor_quantity OR q.completed_by_tailor_quantity<q.dispatched_quantity OR q.dispatched_quantity<0),false) invalid
 FROM scoped s JOIN orders_ o ON o.id=s.order_id LEFT JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=s.id WHERE o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.assigned_worker_id IS NULL GROUP BY s.id),
 event_items AS MATERIALIZED(SELECT s.id FROM scoped s JOIN orders_ o ON o.id=s.order_id WHERE o.uc_status IS DISTINCT FROM 'CANCELLED')
 SELECT jsonb_build_object('cohort', (SELECT jsonb_build_object('orders',count(*),'completed',count(*) FILTER(WHERE status=1 AND uc_status IS DISTINCT FROM 'CANCELLED'),'cancelled',count(*) FILTER(WHERE uc_status='CANCELLED'),'pending',count(*) FILTER(WHERE status=0 AND uc_status IS DISTINCT FROM 'CANCELLED'),
 'completed_on_time',count(*) FILTER(WHERE status=1 AND uc_status IS DISTINCT FROM 'CANCELLED' AND (c.delivered_on AT TIME ZONE 'UTC')<=CASE WHEN c.assigned_worker_id IS NULL THEN c.due_on AT TIME ZONE 'UTC' ELSE b.original_due_at END),'completed_with_dates',count(*) FILTER(WHERE status=1 AND uc_status IS DISTINCT FROM 'CANCELLED' AND c.delivered_on IS NOT NULL AND CASE WHEN c.assigned_worker_id IS NULL THEN c.due_on IS NOT NULL ELSE b.original_due_at IS NOT NULL END),
 'on_time_percent',round(100.0*count(*) FILTER(WHERE status=1 AND uc_status IS DISTINCT FROM 'CANCELLED' AND (c.delivered_on AT TIME ZONE 'UTC')<=CASE WHEN c.assigned_worker_id IS NULL THEN c.due_on AT TIME ZONE 'UTC' ELSE b.original_due_at END)/nullif(count(*) FILTER(WHERE status=1 AND uc_status IS DISTINCT FROM 'CANCELLED' AND c.delivered_on IS NOT NULL AND CASE WHEN c.assigned_worker_id IS NULL THEN c.due_on IS NOT NULL ELSE b.original_due_at IS NOT NULL END),0),2)::text) FROM cohort c LEFT JOIN baselines b ON b.order_id=c.id),
 'backlog',(SELECT jsonb_build_object('pending_orders',count(*) FILTER(WHERE o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED'),'overdue_orders',count(*) FILTER(WHERE o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.due_on<now() AT TIME ZONE 'UTC'),
 'critical_orders',count(*) FILTER(WHERE o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.due_on>=now() AT TIME ZONE 'UTC' AND o.due_on<(now()+interval '3 days') AT TIME ZONE 'UTC'),
 'worker_original_due_overdue',count(*) FILTER(WHERE o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.assigned_worker_id IS NOT NULL AND b.original_due_at<now()),
 'worker_original_due_unknown',count(*) FILTER(WHERE o.assigned_worker_id IS NOT NULL AND b.order_id IS NULL),
 'worker_original_due_basis','recorded_assignment_or_first_observed_change') FROM orders_ o LEFT JOIN baselines b ON b.order_id=o.id),
 'factory_balances',(SELECT jsonb_build_object('items',count(*),'needs_reconciliation',coalesce(bool_or(invalid),false),'invalid_items',count(*) FILTER(WHERE invalid),
 'remaining_cut',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(ordered-cut),0) END,'remaining_assignment',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(cut-assigned),0) END,'remaining_inspection',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(assigned-inspected),0) END,'remaining_dispatch',CASE WHEN bool_or(invalid) THEN NULL ELSE coalesce(sum(inspected-dispatched),0) END) FROM balances),
 'work_in_period',jsonb_build_object(
 'cut',(SELECT coalesce(sum(q.cutting_done),0) FROM sa_snapshot_20261019.sa_mark_cuttings d JOIN sa_snapshot_20261019.sa_mark_cutting_quantities q ON q.mark_cutting_id=d.id WHERE d.item_id IN(SELECT id FROM event_items) AND d.cutting_date>=p_start AT TIME ZONE 'UTC' AND d.cutting_date<p_end AT TIME ZONE 'UTC'),
 'assigned',(SELECT coalesce(sum(q.assigned_quantity),0) FROM sa_snapshot_20261019.sa_job_sheet_assign_dates d JOIN sa_snapshot_20261019.sa_job_sheet_assign_quantities q ON q.job_sheet_assign_date_id=d.id WHERE d.item_id IN(SELECT id FROM event_items) AND d.assign_at>=p_start AT TIME ZONE 'UTC' AND d.assign_at<p_end AT TIME ZONE 'UTC'),
 'inspected',(SELECT coalesce(sum(q.completed_quantity),0) FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d JOIN sa_snapshot_20261019.sa_job_sheet_mark_tailors t ON t.job_sheet_tailor_mark_date_id=d.id JOIN sa_snapshot_20261019.sa_mark_tailor_quantities q ON q.job_sheet_mark_tailor_id=t.id WHERE d.item_id IN(SELECT id FROM event_items) AND d.marked_at>=p_start AT TIME ZONE 'UTC' AND d.marked_at<p_end AT TIME ZONE 'UTC'),
 'dispatched',(SELECT coalesce(sum(q.dispatched_quantity),0) FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates d JOIN sa_snapshot_20261019.sa_dispatched_quantities q ON q.job_sheet_dispatched_date_id=d.id WHERE d.item_id IN(SELECT id FROM event_items) AND d.dispatched_at>=p_start AT TIME ZONE 'UTC' AND d.dispatched_at<p_end AT TIME ZONE 'UTC')),
 'worker_stages',(SELECT jsonb_build_object('not_started',count(*) FILTER(WHERE s.job_worker_status=0),'in_progress',count(*) FILTER(WHERE s.job_worker_status BETWEEN 1 AND 4),'completed',count(*) FILTER(WHERE s.job_worker_status=5),'unknown',count(*) FILTER(WHERE s.job_worker_status IS NULL OR s.job_worker_status NOT BETWEEN 0 AND 5)) FROM scoped s JOIN cohort c ON c.id=s.order_id WHERE c.assigned_worker_id IS NOT NULL AND c.uc_status IS DISTINCT FROM 'CANCELLED'),
 'feedback',(SELECT jsonb_build_object('count',count(*),'average',round(avg(q.rating) FILTER(WHERE q.rating BETWEEN 1 AND 5),2)::text,'invalid_source_count',count(*) FILTER(WHERE q.rating IS NULL OR NOT q.rating BETWEEN 1 AND 5),'scope','visible_received_feedback') FROM sa_snapshot_20261019.sa_ratings q
 WHERE q.to_id=coalesce(p_subject_id,a.user_id) AND(a.role_id=0 OR q.from_id=a.user_id OR q.to_id=a.user_id) AND q.created_at>=p_start AT TIME ZONE 'UTC' AND q.created_at<p_end AT TIME ZONE 'UTC'
 AND((q.rating_on_type='Order' AND q.rating_on_id IN(SELECT id FROM orders_)) OR(q.rating_on_type='Item' AND q.rating_on_id IN(SELECT id FROM scoped)))
 AND NOT EXISTS(SELECT FROM sa_domain.rating_moderation m WHERE m.rating_id=q.id AND m.generation=(SELECT generation FROM sa_domain.runtime_state))),
 'basis',jsonb_build_object('efficiency_due','original_worker_due_or_current_factory_due','worker_stages','item_stage_in_order_creation_cohort','feedback','feedback_created_at','cohort','order_created_on_fallback_created_at','backlog','current_all_dates','work_in_period','actual_history_event_date','critical','upcoming_3_days_excludes_overdue','factory_balances','current_quantity_counters','completion_dates','unknown_excluded_from_efficiency','money','not_in_operational_metrics')) INTO r;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.work_metric_data(bigint,bigint,timestamptz,timestamptz) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.v1_work_metrics(p_from date DEFAULT NULL,p_before date DEFAULT NULL,p_subject_id bigint DEFAULT NULL,p_factory_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4,7,8,9,11]);period_ jsonb:=sa_domain.report_period(p_from,p_before);
BEGIN
 RETURN sa_domain.work_metric_data(p_subject_id,p_factory_id,(period_->>'start_utc')::timestamptz,(period_->>'end_exclusive_utc')::timestamptz)||jsonb_build_object('period',period_,'as_of',now());
END $f$;
DO $f$ DECLARE p record;call_ text;BEGIN
 FOR p IN SELECT pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args,pr.provolatile FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY[
 'report_period','report_context','tailor_work_rows','metrics_item_ids','work_metric_data','v1_tailor_leaderboard','v1_work_metrics']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor',p.proname,p.args);
  IF p.proname LIKE 'v1_%' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s),' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.report_period(date,date) TO sa_guard;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
