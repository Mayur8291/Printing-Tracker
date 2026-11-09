BEGIN;

-- Worker authorization includes historical orders. The existing live-only
-- paging index cannot serve scope_order_ids(), whose exact predicate is only
-- assigned_worker_id = actor.user_id. Cover that lookup without changing any
-- function, RLS policy, grant, or historical visibility.
CREATE INDEX squad_orders_worker_scope
ON sa_snapshot_20261019.sa_orders (assigned_worker_id, id);

COMMENT ON INDEX sa_snapshot_20261019.squad_orders_worker_scope IS
'Full Worker authorization lookup, including historical orders; complements the live-only paging index.';

COMMIT;
