-- Bound stock-allocation authorization to the two referenced records.
-- The previous IN subqueries materialized every visible stock/dispatch row on
-- each receipt allocation. With 3,051 unrelated dispatch rows, a two-receipt
-- FIFO dispatch performed 6,110 visibility checks (1.84s in the scaled local
-- full journey), versus exact PK probes (24ms). Hosted authenticator has an
-- eight-second statement limit. This preserves the existing RLS conditions.
DO $migration$
DECLARE executor_ oid:='sa_executor'::regrole;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='sa_snapshot_20261019.sa_stock_useds'::regclass
  AND polname='squad_stock_used_read' AND polcmd='r' AND polpermissive AND polroles=ARRAY[executor_])
 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='sa_snapshot_20261019.sa_stock_useds'::regclass
  AND polname='squad_stock_used_insert' AND polcmd='a' AND polpermissive AND polroles=ARRAY[executor_]) THEN
  RAISE EXCEPTION 'Stock allocation policy contract changed';
 END IF;
END
$migration$;

ALTER POLICY squad_stock_used_read ON sa_snapshot_20261019.sa_stock_useds
 USING (EXISTS (
  SELECT 1 FROM sa_snapshot_20261019.sa_stocks s
  WHERE s.id=sa_stock_useds.stock_id
 ));

ALTER POLICY squad_stock_used_insert ON sa_snapshot_20261019.sa_stock_useds
 WITH CHECK (
  EXISTS (
   SELECT 1 FROM sa_snapshot_20261019.sa_stocks s
   WHERE s.id=sa_stock_useds.stock_id AND s.user_id=(SELECT (sa_domain.actor()).user_id)
  ) AND EXISTS (
   SELECT 1 FROM sa_snapshot_20261019.sa_dispatched_quantities d
   WHERE d.id=sa_stock_useds.dispatched_quantity_id
  )
 );
-- Both referenced tables continue to enforce their existing RLS. No grants,
-- actor/role rules, command signatures, FIFO rules or receipt quantities change.
