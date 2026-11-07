BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
-- Compute the authorized item set once per statement. Descendant policies must
-- not recursively expand orders -> items -> quantities -> every history parent.
CREATE FUNCTION sa_domain.scope_item_ids() RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 WHERE a.role_id=0 OR (a.role_id=1 AND o.customer_sc_id=a.user_id)
 OR (a.role_id=2 AND o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL)
 OR (a.role_id IN(3,10) AND o.customer_id=a.user_id)
 OR (a.role_id=10 AND o.customer_dealer_id=a.user_id)
 OR (a.role_id=11 AND o.assigned_worker_id=a.user_id)
 OR (a.role_id IN(4,7,8) AND o.assigned_to_id IN(SELECT sa_domain.factory_manager_ids()))
 OR (a.role_id=9 AND i.cutting_master_id=a.user_id);
END $f$;
ALTER FUNCTION sa_domain.scope_item_ids() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.scope_item_ids() FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.scope_item_ids() TO sa_executor,sa_guard;
CREATE FUNCTION sa_domain.scope_order_ids() RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o
 WHERE a.role_id=0 OR (a.role_id=1 AND o.customer_sc_id=a.user_id)
 OR (a.role_id=2 AND o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL)
 OR (a.role_id IN(3,10) AND o.customer_id=a.user_id)
 OR (a.role_id=10 AND o.customer_dealer_id=a.user_id)
 OR (a.role_id=11 AND o.assigned_worker_id=a.user_id)
 OR (a.role_id IN(4,7,8) AND o.assigned_to_id IN(SELECT sa_domain.factory_manager_ids()))
 OR (a.role_id=9 AND o.id IN(SELECT sa_domain.cutter_order_ids()));
END $f$;
ALTER FUNCTION sa_domain.scope_order_ids() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.scope_order_ids() FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.scope_order_ids() TO sa_executor;
-- Select policies also apply to INSERT RETURNING: scope the parent order, not
-- membership in a snapshot of item IDs taken before insertion.
ALTER POLICY squad_executor_items_read ON sa_snapshot_20261019.sa_items USING(order_id IN(SELECT sa_domain.scope_order_ids()) AND ((SELECT (sa_domain.actor()).role_id)<>9 OR cutting_master_id=(SELECT (sa_domain.actor()).user_id)));
ALTER POLICY squad_items_update ON sa_snapshot_20261019.sa_items USING(order_id IN(SELECT sa_domain.scope_order_ids()) AND ((SELECT (sa_domain.actor()).role_id)<>9 OR cutting_master_id=(SELECT (sa_domain.actor()).user_id)))
 WITH CHECK(order_id IN(SELECT sa_domain.scope_order_ids()) AND ((SELECT (sa_domain.actor()).role_id)<>9 OR cutting_master_id=(SELECT (sa_domain.actor()).user_id)));
ALTER POLICY squad_executor_quantities_read ON sa_snapshot_20261019.sa_quantities USING(item_id IN(SELECT sa_domain.scope_item_ids()));
ALTER POLICY squad_quantities_update ON sa_snapshot_20261019.sa_quantities USING(item_id IN(SELECT sa_domain.scope_item_ids())) WITH CHECK(item_id IN(SELECT sa_domain.scope_item_ids()));
GRANT SELECT(id) ON sa_snapshot_20261019.sa_quantities TO sa_guard;
DO $do$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mark_cuttings','job_sheet_assign_dates','item_tailors','job_sheet_tailor_mark_dates','job_sheet_dispatched_dates'] LOOP
  EXECUTE format('GRANT SELECT(id,item_id) ON sa_snapshot_20261019.sa_%I TO sa_guard',t);
  EXECUTE format('CREATE POLICY squad_guard_work_parent ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $do$;
GRANT SELECT(id,item_tailor_id) ON sa_snapshot_20261019.sa_item_tailor_quantities TO sa_guard;
GRANT SELECT(id,job_sheet_tailor_mark_date_id) ON sa_snapshot_20261019.sa_job_sheet_mark_tailors TO sa_guard;
CREATE POLICY squad_guard_work_parent ON sa_snapshot_20261019.sa_item_tailor_quantities FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_guard_work_parent ON sa_snapshot_20261019.sa_job_sheet_mark_tailors FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.work_scope_ids(p_kind text) RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ids_ bigint[];query_ text;
BEGIN
 query_:=CASE p_kind
 WHEN 'quantity' THEN 'SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY($1)'
 WHEN 'cut' THEN 'SELECT id FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id=ANY($1)'
 WHEN 'assignment' THEN 'SELECT id FROM sa_snapshot_20261019.sa_job_sheet_assign_dates WHERE item_id=ANY($1)'
 WHEN 'tailor' THEN 'SELECT id FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=ANY($1)'
 WHEN 'inspection' THEN 'SELECT id FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates WHERE item_id=ANY($1)'
 WHEN 'dispatch' THEN 'SELECT id FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id=ANY($1)'
 WHEN 'tailor_quantity' THEN 'SELECT q.id FROM sa_snapshot_20261019.sa_item_tailor_quantities q JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=q.item_tailor_id WHERE t.item_id=ANY($1)'
 WHEN 'mark_tailor' THEN 'SELECT t.id FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors t JOIN sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d ON d.id=t.job_sheet_tailor_mark_date_id WHERE d.item_id=ANY($1)'
 ELSE NULL END;
 IF query_ IS NULL THEN RAISE EXCEPTION 'Unsupported work scope' USING ERRCODE='22023';END IF;
 SELECT array_agg(id) INTO ids_ FROM sa_domain.scope_item_ids() id;
 RETURN QUERY EXECUTE query_ USING coalesce(ids_,'{}'::bigint[]);
END $f$;
ALTER FUNCTION sa_domain.work_scope_ids(text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_scope_ids(text) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.work_scope_ids(text) TO sa_executor;
DO $do$ DECLARE t text;predicate_ text;BEGIN
 FOREACH t IN ARRAY ARRAY['mark_cuttings','job_sheet_assign_dates','item_tailors','job_sheet_tailor_mark_dates','job_sheet_dispatched_dates','job_sheet_assign_quantities'] LOOP
  EXECUTE format('ALTER POLICY squad_work_read ON sa_snapshot_20261019.sa_%I USING(item_id IN(SELECT sa_domain.scope_item_ids()))',t);
  EXECUTE format('ALTER POLICY squad_work_insert ON sa_snapshot_20261019.sa_%I WITH CHECK(item_id IN(SELECT sa_domain.scope_item_ids()))',t);
 END LOOP;
 FOR t,predicate_ IN SELECT * FROM (VALUES
 ('mark_cutting_quantities',$p$mark_cutting_id IN(SELECT sa_domain.work_scope_ids('cut')) AND quantity_id IN(SELECT sa_domain.work_scope_ids('quantity'))$p$),
 ('item_tailor_quantities',$p$item_tailor_id IN(SELECT sa_domain.work_scope_ids('tailor')) AND quantity_id IN(SELECT sa_domain.work_scope_ids('quantity'))$p$),
 ('job_sheet_assign_tailors',$p$job_sheet_assign_date_id IN(SELECT sa_domain.work_scope_ids('assignment')) AND item_tailor_id IN(SELECT sa_domain.work_scope_ids('tailor'))$p$),
 ('job_sheet_mark_tailors',$p$job_sheet_tailor_mark_date_id IN(SELECT sa_domain.work_scope_ids('inspection')) AND item_tailor_id IN(SELECT sa_domain.work_scope_ids('tailor'))$p$),
 ('mark_tailor_quantities',$p$job_sheet_mark_tailor_id IN(SELECT sa_domain.work_scope_ids('mark_tailor')) AND item_tailor_quantity_id IN(SELECT sa_domain.work_scope_ids('tailor_quantity'))$p$),
 ('dispatched_quantities',$p$job_sheet_dispatched_date_id IN(SELECT sa_domain.work_scope_ids('dispatch')) AND quantity_id IN(SELECT sa_domain.work_scope_ids('quantity'))$p$)) x(t,p) LOOP
  EXECUTE format('ALTER POLICY squad_work_read ON sa_snapshot_20261019.sa_%I USING(%s)',t,predicate_);
  EXECUTE format('ALTER POLICY squad_work_insert ON sa_snapshot_20261019.sa_%I WITH CHECK(%s)',t,predicate_);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['item_tailors','item_tailor_quantities','job_sheet_assign_quantities'] LOOP
  predicate_:=CASE WHEN t='item_tailor_quantities' THEN $p$item_tailor_id IN(SELECT sa_domain.work_scope_ids('tailor'))$p$ ELSE 'item_id IN(SELECT sa_domain.scope_item_ids())' END;
  EXECUTE format('ALTER POLICY squad_work_update ON sa_snapshot_20261019.sa_%I USING(%s) WITH CHECK(%s)',t,predicate_,predicate_);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
