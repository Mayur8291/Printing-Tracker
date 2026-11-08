BEGIN;
-- The page contains at most 100 explicitly selected receipts. Its size/dealer
-- selectivity differs materially from an unknown parameter array. Hosted EXPLAIN
-- showed PostgreSQL switching after five calls to a generic plan (350+ ms versus
-- 110-125 ms custom). Scope replanning to this private bounded query; leave the
-- transaction/session defaults and every authorization/stock predicate unchanged.
ALTER FUNCTION sa_domain.stock_reconciliation_rows(bigint,bigint[])
 SET plan_cache_mode=force_custom_plan;
COMMIT;
