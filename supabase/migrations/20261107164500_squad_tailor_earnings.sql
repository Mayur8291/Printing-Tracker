BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
GRANT SELECT(id,base_of,base_sn,name) ON sa_snapshot_20261019.sa_base_products TO sa_guard;
GRANT SELECT(id,add_on_id,base_product_id) ON sa_snapshot_20261019.sa_add_on_base_products TO sa_guard;
GRANT SELECT(id,add_on_of,add_on_sn) ON sa_snapshot_20261019.sa_add_ons TO sa_guard;
CREATE POLICY squad_guard_earnings ON sa_snapshot_20261019.sa_base_products FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_earnings ON sa_snapshot_20261019.sa_add_on_base_products FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_earnings ON sa_snapshot_20261019.sa_add_ons FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,item_id,tailor_id) ON sa_snapshot_20261019.sa_item_tailors TO sa_guard;
GRANT SELECT(id,product_id) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(item_tailor_id,assigned_quantity,completed_quantity,job_sheet_assign_date_id) ON sa_snapshot_20261019.sa_job_sheet_assign_quantities TO sa_guard;
CREATE POLICY squad_guard_earnings ON sa_snapshot_20261019.sa_job_sheet_assign_quantities FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,assign_at) ON sa_snapshot_20261019.sa_job_sheet_assign_dates TO sa_guard;
CREATE INDEX squad_earnings_assignment ON sa_snapshot_20261019.sa_job_sheet_assign_quantities(item_tailor_id,job_sheet_assign_date_id);
CREATE INDEX squad_earnings_date ON sa_snapshot_20261019.sa_job_sheet_assign_dates(assign_at,id);

-- Compatibility formula from TailorWeeklyStatsService: current base OF/SN plus
-- ALL linked base add-on OF/SN, multiplied by completed assignments whose
-- assignment date is in the week. It is not selected-add-on or inspection-date pay.
CREATE FUNCTION sa_domain.tailor_earnings_rows(p_tailor_id bigint,p_start timestamptz,p_end timestamptz,p_include_team boolean)
RETURNS TABLE(id bigint,item_id bigint,tailor_id bigint,base_product_id bigint,product_name text,assigned bigint,completed bigint,of_rate numeric,sn_rate numeric,amount numeric,needs_reconciliation boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4]);target_ record;subjects_ bigint[];items_ bigint[];
BEGIN
 SELECT u.id,u.role INTO target_ FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_tailor_id AND u.role IN(5,6) AND u.deleted_at IS NULL;
 IF target_.id IS NULL OR (a.role_id=4 AND (a.factory_id IS NULL OR sa_domain.effective_factory(p_tailor_id) IS DISTINCT FROM a.factory_id)) THEN RAISE EXCEPTION 'Tailor unavailable in your factory scope' USING ERRCODE='P0002';END IF;
 IF p_include_team IS NULL OR (p_include_team AND target_.role<>5) THEN RAISE EXCEPTION 'Only a parent tailor can include a team' USING ERRCODE='22023';END IF;
 SELECT array_agg(u.id) INTO subjects_ FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_tailor_id OR (p_include_team AND u.role=6 AND u.parent_tailor_id=p_tailor_id AND u.deleted_at IS NULL);
 IF a.role_id=4 THEN SELECT array_agg(x) INTO items_ FROM sa_domain.scope_item_ids() x;END IF;
 RETURN QUERY WITH work AS MATERIALIZED(SELECT it.id,it.item_id,it.tailor_id,sum(q.assigned_quantity)::bigint assigned,sum(q.completed_quantity)::bigint completed,
 bool_or(q.assigned_quantity<0 OR q.completed_quantity<0 OR q.completed_quantity>q.assigned_quantity) invalid
 FROM sa_snapshot_20261019.sa_item_tailors it JOIN sa_snapshot_20261019.sa_job_sheet_assign_quantities q ON q.item_tailor_id=it.id
 JOIN sa_snapshot_20261019.sa_job_sheet_assign_dates d ON d.id=q.job_sheet_assign_date_id
 WHERE it.tailor_id=ANY(subjects_) AND (a.role_id<>4 OR it.item_id=ANY(items_)) AND d.assign_at>=p_start AT TIME ZONE 'UTC' AND d.assign_at<p_end AT TIME ZONE 'UTC'
 GROUP BY it.id,it.item_id,it.tailor_id),
 products AS MATERIALIZED(SELECT w.*,p.base_product_id FROM work w LEFT JOIN sa_snapshot_20261019.sa_items i ON i.id=w.item_id LEFT JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id),
 rates AS(SELECT j.base_product_id,sum(coalesce(x.add_on_of,0)) of_,sum(coalesce(x.add_on_sn,0)) sn_,bool_or(x.id IS NULL OR x.add_on_of IS NULL OR x.add_on_sn IS NULL OR x.add_on_of<0 OR x.add_on_sn<0) invalid
 FROM sa_snapshot_20261019.sa_add_on_base_products j LEFT JOIN sa_snapshot_20261019.sa_add_ons x ON x.id=j.add_on_id
 WHERE j.base_product_id IN(SELECT p.base_product_id FROM products p) GROUP BY j.base_product_id),
 priced AS(SELECT p.*,b.name,coalesce(b.base_of,0)+coalesce(r.of_,0) of_,coalesce(b.base_sn,0)+coalesce(r.sn_,0) sn_,
 p.invalid OR b.id IS NULL OR b.base_of IS NULL OR b.base_sn IS NULL OR b.base_of<0 OR b.base_sn<0 OR coalesce(r.invalid,false) review
 FROM products p LEFT JOIN sa_snapshot_20261019.sa_base_products b ON b.id=p.base_product_id LEFT JOIN rates r ON r.base_product_id=p.base_product_id)
 SELECT p.id,p.item_id,p.tailor_id,p.base_product_id,p.name::text,p.assigned,p.completed,p.of_,p.sn_,CASE WHEN p.review THEN NULL ELSE round((p.of_+p.sn_)*p.completed,2) END,p.review FROM priced p WHERE p.completed>0 OR p.review;
END $f$;
ALTER FUNCTION sa_domain.tailor_earnings_rows(bigint,timestamptz,timestamptz,boolean) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.tailor_earnings_rows(bigint,timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.tailor_earnings_rows(bigint,timestamptz,timestamptz,boolean) TO sa_executor;

CREATE FUNCTION sa_domain.v1_tailor_earnings(p_tailor_id bigint,p_week_start date DEFAULT NULL,p_include_team boolean DEFAULT false,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4]);n int:=sa_domain.page_limit(p_limit);today_ date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
 week_ date:=coalesce(p_week_start,today_-((extract(dow FROM today_)::int+1)%7)-7);start_ timestamptz;end_ timestamptz;ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF extract(dow FROM week_)<>6 OR week_<'2000-01-01'::date OR week_>today_ THEN RAISE EXCEPTION 'Choose a Saturday week start that is not in the future' USING ERRCODE='22023';END IF;
 start_:=week_::timestamp AT TIME ZONE 'Asia/Kolkata';end_:=(week_+7)::timestamp AT TIME ZONE 'Asia/Kolkata';
 ctx:=sa_domain.page_context('tailor_earnings',jsonb_build_object('tailor_id',p_tailor_id::text,'week_start',week_,'include_team',p_include_team));after_:=sa_domain.cursor_id(p_cursor,ctx);
 WITH rows AS MATERIALIZED(SELECT * FROM sa_domain.tailor_earnings_rows(p_tailor_id,start_,end_,p_include_team)),
 scan AS MATERIALIZED(SELECT * FROM rows WHERE id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'item_id',item_id::text,'tailor_id',tailor_id::text,'base_product_id',base_product_id::text,'product_name',product_name,
 'assigned',assigned,'completed',completed,'pending',greatest(0,assigned-completed),'of_rate',of_rate::text,'sn_rate',sn_rate::text,'unit_rate',(of_rate+sn_rate)::text,'amount',amount::text,'status',CASE WHEN needs_reconciliation THEN 'needs_reconciliation' ELSE 'calculated' END) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END,
 'summary',(SELECT jsonb_build_object('rows',count(*),'assigned',coalesce(sum(assigned),0),'completed',coalesce(sum(completed),0),'pending',coalesce(sum(greatest(0,assigned-completed)),0),
 'amount',CASE WHEN bool_or(needs_reconciliation) THEN NULL ELSE coalesce(sum(amount),0)::text END,'calculated_subtotal',coalesce(sum(amount),0)::text,'needs_reconciliation',coalesce(bool_or(needs_reconciliation),false)) FROM rows),
 'period',jsonb_build_object('week_start',week_,'week_end',week_+6,'start_utc',start_,'end_exclusive_utc',end_,'timezone','Asia/Kolkata'),
 'basis',jsonb_build_object('formula','legacy-tailor-v1','rates','current_master','addons','all_linked_base_addons','period','assignment_date','completion','current_at_read'),'as_of',now()) INTO r FROM page;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.v1_tailor_earnings(bigint,date,boolean,text,integer) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_tailor_earnings(bigint,date,boolean,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION sa_domain.v1_tailor_earnings(bigint,date,boolean,text,integer) TO sa_app;
CREATE FUNCTION canto_api.v1_tailor_earnings(p_tailor_id bigint,p_week_start date DEFAULT NULL,p_include_team boolean DEFAULT false,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_tailor_earnings(p_tailor_id,p_week_start,p_include_team,p_cursor,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_tailor_earnings(bigint,date,boolean,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.v1_tailor_earnings(bigint,date,boolean,text,integer) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
