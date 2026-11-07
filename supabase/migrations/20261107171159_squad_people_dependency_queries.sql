BEGIN;
-- An archive eligibility check needs outstanding obligations, not a priced,
-- canonical stock projection. Separate indexed branches by the target's role.
CREATE OR REPLACE FUNCTION sa_domain.person_dependencies(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE reasons jsonb:='[]';role_ int;orders_ boolean:=false;
BEGIN
 IF NOT sa_domain.can_manage_person(p_id) THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='P0002';END IF;
 SELECT role INTO role_ FROM sa_snapshot_20261019.sa_users WHERE id=p_id;
 CASE role_
 WHEN 1 THEN SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_sc_id=p_id AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL) INTO orders_;
 WHEN 3 THEN SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_id=p_id AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL) INTO orders_;
 WHEN 10 THEN SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE (customer_id=p_id OR customer_dealer_id=p_id) AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL) INTO orders_;
 WHEN 4 THEN SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE assigned_to_id=p_id AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL) INTO orders_;
 WHEN 11 THEN SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE assigned_worker_id=p_id AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL) INTO orders_;
 ELSE NULL;END CASE;
 IF orders_ THEN reasons:=reasons||'"active_orders"'::jsonb;END IF;
 IF (role_=1 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE created_by_id=p_id AND role IN(3,10) AND deleted_at IS NULL))
 OR (role_=4 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE factory_manager_id=p_id AND deleted_at IS NULL))
 OR (role_=5 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE parent_tailor_id=p_id AND deleted_at IS NULL))
 OR (role_=10 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers l JOIN sa_snapshot_20261019.sa_users u ON u.id=l.user_id WHERE l.dealer_id=p_id AND u.role=3 AND u.is_direct_deal IS NOT TRUE AND u.deleted_at IS NULL))
 THEN reasons:=reasons||'"dependent_people"'::jsonb;END IF;
 IF role_=9 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.cutting_master_id=p_id AND o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL) THEN reasons:=reasons||'"assigned_cutting"'::jsonb;END IF;
 IF role_ IN(5,6) AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_tailors t JOIN sa_snapshot_20261019.sa_job_sheet_assign_quantities q ON q.item_tailor_id=t.id
 JOIN sa_snapshot_20261019.sa_items i ON i.id=t.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 WHERE t.tailor_id=p_id AND coalesce(q.completed_quantity,0)<q.assigned_quantity AND o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL) THEN reasons:=reasons||'"unfinished_tailoring"'::jsonb;END IF;
 IF role_=10 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_stocks s CROSS JOIN LATERAL(
 SELECT coalesce(sum(qty),0) used,bool_or(qty IS NULL OR qty<0) invalid FROM sa_snapshot_20261019.sa_stock_useds WHERE stock_id=s.id) c
 WHERE s.user_id=p_id AND (s.quantity IS NULL OR s.quantity<0 OR c.invalid IS TRUE OR s.quantity IS DISTINCT FROM c.used OR coalesce(s.dispatched_quantity,0) IS DISTINCT FROM c.used)) THEN reasons:=reasons||'"dealer_stock"'::jsonb;END IF;
 RETURN reasons;
END $f$;
COMMIT;
