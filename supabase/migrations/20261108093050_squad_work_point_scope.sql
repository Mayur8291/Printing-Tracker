BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;

-- A single work command touches one locked item. Its descendant RLS policies
-- must not rebuild every item/history ID in a large factory for each statement.
-- Preserve the shared current order authority. The cutter shortcut is exactly
-- equivalent: an existing item assigned to this cutter proves that its existing
-- parent order belongs to cutter_order_ids(). No session/GUC cache is trusted.
CREATE OR REPLACE FUNCTION sa_domain.can_item(p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 WHERE i.id=p_id AND CASE WHEN a.role_id=9 THEN i.cutting_master_id=a.user_id ELSE sa_domain.can_order(o.id) END);
END $f$;
ALTER FUNCTION sa_domain.can_item(bigint) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.work_parent_visible(p_kind text,p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE item_ bigint;
BEGIN
 IF p_id IS NULL THEN RETURN false;END IF;
 CASE p_kind
 WHEN 'quantity' THEN SELECT item_id INTO item_ FROM sa_snapshot_20261019.sa_quantities WHERE id=p_id;
 WHEN 'cut' THEN SELECT item_id INTO item_ FROM sa_snapshot_20261019.sa_mark_cuttings WHERE id=p_id;
 WHEN 'assignment' THEN SELECT item_id INTO item_ FROM sa_snapshot_20261019.sa_job_sheet_assign_dates WHERE id=p_id;
 WHEN 'tailor' THEN SELECT item_id INTO item_ FROM sa_snapshot_20261019.sa_item_tailors WHERE id=p_id;
 WHEN 'inspection' THEN SELECT item_id INTO item_ FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates WHERE id=p_id;
 WHEN 'dispatch' THEN SELECT item_id INTO item_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE id=p_id;
 WHEN 'tailor_quantity' THEN SELECT t.item_id INTO item_ FROM sa_snapshot_20261019.sa_item_tailor_quantities q JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=q.item_tailor_id WHERE q.id=p_id;
 WHEN 'mark_tailor' THEN SELECT d.item_id INTO item_ FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors t JOIN sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d ON d.id=t.job_sheet_tailor_mark_date_id WHERE t.id=p_id;
 ELSE RAISE EXCEPTION 'Unsupported work scope' USING ERRCODE='22023';
 END CASE;
 RETURN coalesce(sa_domain.can_item(item_),false);
END $f$;
ALTER FUNCTION sa_domain.work_parent_visible(text,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_parent_visible(text,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.work_parent_visible(text,bigint) TO sa_executor;

ALTER POLICY squad_executor_quantities_read ON sa_snapshot_20261019.sa_quantities USING(sa_domain.can_item(item_id));
ALTER POLICY squad_quantities_update ON sa_snapshot_20261019.sa_quantities USING(sa_domain.can_item(item_id)) WITH CHECK(sa_domain.can_item(item_id));
DO $do$ DECLARE t text;predicate_ text;BEGIN
 FOREACH t IN ARRAY ARRAY['mark_cuttings','job_sheet_assign_dates','item_tailors','job_sheet_tailor_mark_dates','job_sheet_dispatched_dates','job_sheet_assign_quantities'] LOOP
  EXECUTE format('ALTER POLICY squad_work_read ON sa_snapshot_20261019.sa_%I USING(sa_domain.can_item(item_id))',t);
  EXECUTE format('ALTER POLICY squad_work_insert ON sa_snapshot_20261019.sa_%I WITH CHECK(sa_domain.can_item(item_id))',t);
 END LOOP;
 FOR t,predicate_ IN SELECT * FROM(VALUES
 ('mark_cutting_quantities',$p$sa_domain.work_parent_visible('cut',mark_cutting_id) AND sa_domain.work_parent_visible('quantity',quantity_id)$p$),
 ('item_tailor_quantities',$p$sa_domain.work_parent_visible('tailor',item_tailor_id) AND sa_domain.work_parent_visible('quantity',quantity_id)$p$),
 ('job_sheet_assign_tailors',$p$sa_domain.work_parent_visible('assignment',job_sheet_assign_date_id) AND sa_domain.work_parent_visible('tailor',item_tailor_id)$p$),
 ('job_sheet_mark_tailors',$p$sa_domain.work_parent_visible('inspection',job_sheet_tailor_mark_date_id) AND sa_domain.work_parent_visible('tailor',item_tailor_id)$p$),
 ('mark_tailor_quantities',$p$sa_domain.work_parent_visible('mark_tailor',job_sheet_mark_tailor_id) AND sa_domain.work_parent_visible('tailor_quantity',item_tailor_quantity_id)$p$),
 ('dispatched_quantities',$p$sa_domain.work_parent_visible('dispatch',job_sheet_dispatched_date_id) AND sa_domain.work_parent_visible('quantity',quantity_id)$p$))x(t,p) LOOP
  EXECUTE format('ALTER POLICY squad_work_read ON sa_snapshot_20261019.sa_%I USING(%s)',t,predicate_);
  EXECUTE format('ALTER POLICY squad_work_insert ON sa_snapshot_20261019.sa_%I WITH CHECK(%s)',t,predicate_);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['item_tailors','item_tailor_quantities','job_sheet_assign_quantities'] LOOP
  predicate_:=CASE WHEN t='item_tailor_quantities' THEN $p$sa_domain.work_parent_visible('tailor',item_tailor_id)$p$ ELSE 'sa_domain.can_item(item_id)' END;
  EXECUTE format('ALTER POLICY squad_work_update ON sa_snapshot_20261019.sa_%I USING(%s) WITH CHECK(%s)',t,predicate_,predicate_);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
