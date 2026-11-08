BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
-- Child inserts check the exact parent by its primary key. Enumerating all of
-- an SC's orders on each size/checklist insert made large amendments quadratic.
CREATE FUNCTION sa_domain.can_write_order_lines(p_order_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();o record;
BEGIN
 SELECT customer_id,customer_sc_id,customer_dealer_id,created_by_id,is_deleted,deleted_at INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_order_id;
 IF NOT FOUND OR o.is_deleted IS TRUE OR o.deleted_at IS NOT NULL THEN RETURN false;END IF;
 RETURN CASE a.role_id WHEN 1 THEN o.customer_sc_id=a.user_id
 WHEN 3 THEN o.customer_id=a.user_id AND o.created_by_id=a.user_id
 WHEN 10 THEN (o.customer_id=a.user_id OR o.customer_dealer_id=a.user_id) AND o.created_by_id=a.user_id
 ELSE false END;
END $f$;
ALTER FUNCTION sa_domain.can_write_order_lines(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.can_write_item_lines(p_item_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT coalesce((SELECT sa_domain.can_write_order_lines(order_id) FROM sa_snapshot_20261019.sa_items WHERE id=p_item_id),false)
$f$;
ALTER FUNCTION sa_domain.can_write_item_lines(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.can_write_order_lines(bigint),sa_domain.can_write_item_lines(bigint) FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON FUNCTION sa_domain.can_write_order_lines(bigint),sa_domain.can_write_item_lines(bigint) TO sa_executor;
ALTER POLICY squad_items_insert ON sa_snapshot_20261019.sa_items WITH CHECK(sa_domain.can_write_order_lines(order_id));
ALTER POLICY squad_quantities_insert ON sa_snapshot_20261019.sa_quantities WITH CHECK(sa_domain.can_write_item_lines(item_id));
ALTER POLICY squad_extras_insert ON sa_snapshot_20261019.sa_extra_quantities WITH CHECK(sa_domain.can_write_item_lines(item_id));
ALTER POLICY squad_brandings_insert ON sa_snapshot_20261019.sa_brandings WITH CHECK(sa_domain.can_write_item_lines(item_id));
ALTER POLICY squad_criteria_insert ON sa_snapshot_20261019.sa_item_criteria WITH CHECK(sa_domain.can_write_item_lines(item_id));
ALTER POLICY squad_line_receipts_insert ON sa_domain.line_receipts WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND sa_domain.can_write_order_lines(order_id) AND item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=sa_domain.line_receipts.order_id));
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
