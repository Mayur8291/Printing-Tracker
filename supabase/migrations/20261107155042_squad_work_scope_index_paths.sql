BEGIN;
-- Keep generic cached plans from scanning every item for role-disjunction predicates.
CREATE OR REPLACE FUNCTION sa_domain.scope_order_ids() RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 IF a.role_id=0 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE true;
 ELSIF a.role_id=1 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.customer_sc_id=a.user_id;
 ELSIF a.role_id=2 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL;
 ELSIF a.role_id=3 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.customer_id=a.user_id;
 ELSIF a.role_id=10 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE (o.customer_id=a.user_id OR o.customer_dealer_id=a.user_id);
 ELSIF a.role_id=11 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.assigned_worker_id=a.user_id;
 ELSIF a.role_id IN(4,7,8) THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.assigned_to_id IN(SELECT sa_domain.factory_manager_ids());
 ELSIF a.role_id=9 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.id IN(SELECT sa_domain.cutter_order_ids());
 END IF;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.scope_item_ids() RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 IF a.role_id=0 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE true;
 ELSIF a.role_id=1 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.customer_sc_id=a.user_id;
 ELSIF a.role_id=2 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL;
 ELSIF a.role_id=3 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.customer_id=a.user_id;
 ELSIF a.role_id=10 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE (o.customer_id=a.user_id OR o.customer_dealer_id=a.user_id);
 ELSIF a.role_id=11 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.assigned_worker_id=a.user_id;
 ELSIF a.role_id IN(4,7,8) THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.assigned_to_id IN(SELECT sa_domain.factory_manager_ids());
 ELSIF a.role_id=9 THEN RETURN QUERY SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.cutting_master_id=a.user_id;
 END IF;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
