# Dealer stock reconciliation

Status: original reconciliation migration deployed to staging; 101 isolated stock tests passed. The follow-up planner setting is also deployed and passed the installed-state staging benchmark. No DigitalOcean or production changes were made.

## Contract and authority

`canto_api.v1_stock_reconciliation(p_dealer_id bigint, p_action text = 'review', p_request jsonb = '{}', p_cursor text = null, p_limit integer = 25)` is a narrow facade for three related operations:

| Action | Request | Result |
|---|---|---|
| `review` | Optional `receipt_id`, `order_id`, `item_id`, `size_id` | Receipt evidence, explicit issue codes, source quantity, ledger consumption, stored counter, current group availability, evidence version and safe action; descending receipt-ID cursor |
| `rebuild` | `receipts: [{id, expected_version}]`, `reason`, `idempotency_key` | One atomic correction of 1–100 explicitly selected derived counters; correction IDs and before/after values |
| `history` | Optional `receipt_id` | Immutable correction history for the selected dealer, descending correction-ID cursor |

Only a current eligible legacy Admin or current Printing Tracker administrator can use these operations. Staff keep their own Auth identity; no legacy role is fabricated. Other personas, clients using service-role claims without a live worker context, and anonymous callers are denied. Role/session/ban changes take effect through the existing live authority checks. Clients cannot execute the private evidence helper or read/write stock tables directly.

Read limits are 1–100, default 25. Review summary counts describe **the current page**, not an inferred global count. Cursors bind the actor, environment generation, dealer and filters. History intentionally preserves old-generation corrections with their original generation. A shared refresh lock keeps cursor/generation/evidence reads in one publication epoch.

## Source semantics and deliberate limits

The authoritative input is the existing `sa_stocks` receipt and `sa_stock_useds` consumption ledger. `UpdateUserStockService` explicitly computes `stock.dispatched_quantity = StockUsed.where(stock: stock).sum(:qty)`. The new repair performs only that derivation, after stronger validation. `UpdateUserStockInfoService` maintained a legacy summary table; current app reads already use the shared `stock_balances` projection, so reconciliation creates no second stock ledger or redundant `stock_infos` cache.

Source evidence: `app/services/update_user_stock_service.rb`, `update_used_stock_service.rb`, and `update_user_stock_info_service.rb` in the pinned Rails main commit `14277820c78e018e62be3da1a14cd8d716cdbf02`; STOCK.02–STOCK.04 in the audited functionality matrix. Custom variants use the existing canonical product fingerprint; ready-made variants use class/brand/optional category plus size.

The review reports these issues independently:

- `invalid_origin`: missing/mismatched order, item, or dealer owner.
- `missing_source_size`: receipt has no corresponding original size quantity.
- `duplicate_origin`: multiple receipts share dealer/item/size; different SKU IDs do not make a duplicate safe.
- `invalid_receipt_quantity`, `source_quantity_mismatch`: invalid receipt or a changed/invalid original size quantity.
- `source_variant_mismatch`, `source_not_completed`: wrong product identity, incomplete purchase, or cancellation.
- `invalid_consumption_ledger`: missing/invalid dispatch, duplicate receipt/dispatch allocation, nonpositive usage, unequal allocation/dispatch totals, wrong dealer/customer/size/variant, or dispatch before receipt creation.
- `overconsumed`: consumption exceeds the receipt.
- `counter_mismatch`: the mutable consumed counter differs from the authoritative consumption sum.

`safe_action = rebuild_counter` is returned only when **counter mismatch is the sole issue** and the derived value fits the legacy integer column. Review reuses `stock_balances` for group availability and its existing fail-closed status. Additional source/provenance checks are prerequisites for repair; this change does not weaken or bypass ordinary stock allocation checks.

The recorded staging baseline contains 195 duplicate receipt-origin groups and one overconsumed receipt. None is auto-repaired by this API. Choosing which receipt to retain or which physical dispatch quantity was correct requires source evidence and an explicit business correction policy. No receipt is deleted, merged, reduced or invented; no consumption allocation is rewritten. Existing anomalies remain visible and affected availability remains blocked. This is an intentional reconciliation exception, not a successful repair claim.

## Atomicity and audit

Repair holds the existing refresh/relationship fences, then ordered order/item advisory locks, the same dealer stock lock used by fulfillment, and receipt row locks. It rechecks the complete generation-bound evidence fingerprint immediately before changing any counter. One stale or unsafe row aborts the whole batch. No partial batch success is reported.

The command requires a reason and actor-scoped idempotency UUID. Identical retries return the committed result; changed payloads and pre-refresh command replays fail. Mirror mode rejects repairs except the existing explicit disposable staging-test override. New-system cutover permits ordinary writes; active refresh rejects them.

Every change appends `sa_domain.stock_reconciliations` with actor, legacy actor if applicable, generation, dealer, receipt, before/after counter, evidence version, reason and command key. App execution roles have no update/delete permission on these correction rows. The standard audit is also written, and edit revision advances once per batch. No notification/provider events are emitted for this derived repair. There is deliberately no button to restore a known-wrong counter; a future authoritative ledger correction must be reviewed and followed by another audited rebuild.

This bounded operation completes directly in one transaction instead of allocating a queue job. The measured 100-receipt batch is below the 500 ms database target; a queue would add state without reducing the required atomic work. Larger reconciliations page through explicit batches.

## Verification

`tools/squad/test_stock_reconciliation.py` covers 46 new synthetic scenarios: legacy/staff authority, bans/revocation/demotion, raw access denial, exact replay/conflict, generation and dependency changes, mirror/cutover/refresh fences, same-dealer lock contention, atomic batch rollback, append-only history, audit visibility, source anomalies, valid RMP/custom consumption and all blocked ambiguity classes. Together with the existing stock read and dispatch/concurrency suites, **101 tests passed on the final migration**.

`tools/squad/benchmark_stock_reconciliation.py` creates 13,170 synthetic receipts, matching the largest observed staging dealer, and rolls back all fixtures. Recorded warm local database p95: review 25 **34.511 ms**, review 100 **36.063 ms**, atomic rebuild 100 **84.132 ms**. These are local database measurements, not a hosted network or mixed-load SLA. Evidence: [local performance JSON](implementation-evidence/local-stock-reconciliation-performance.json).

Run in the independent test database:

```sh
SQUAD_TEST_DATABASE=squad_test_stock tools/canto-sync/.venv/bin/python tools/squad/local_db.py rebuild
SQUAD_TEST_DATABASE=squad_test_stock tools/canto-sync/.venv/bin/python -m unittest discover -s tools/squad -p 'test_stock*.py'
SQUAD_TEST_DATABASE=squad_test_stock tools/canto-sync/.venv/bin/python tools/squad/benchmark_stock_reconciliation.py
```

The first hosted run exposed a performance gap hidden by the synthetic fixture: after PostgreSQL selected a generic cached plan, review of 100 receipts increased from about 121 ms to 356 ms, above the 200 ms target. Repeated helper profiling isolated the generic-plan switch on invocation six. Migration `20261108081816_squad_stock_reconciliation_plans.sql` fixes this only for `stock_reconciliation_rows` using `plan_cache_mode=force_custom_plan`; it changes no predicates, access rules, indexes or business data.

The full staging RPC benchmark with that setting, on the actual dealer with 13,170 receipts, passed: review 25 p95 **120.855 ms**, review 100 **128.496 ms**, and atomic synthetic counter rebuild 100 **328.146 ms** (targets 200/200/500 ms). Each case has ten measured samples after warm-up. The pre-deployment experiment rolled back its helper alteration and all fixtures. The final installed-state benchmark used the deployed setting and rolled back its temporary authenticated staff session, synthetic receipts and sequence changes. Evidence: [hosted performance](implementation-evidence/staging-stock-reconciliation-performance.json) and [custom/generic plan investigation](implementation-evidence/staging-stock-reconciliation-plan-review.json). This is database execution latency, not a mobile network SLA or a mixed-load claim.

Reviewed current [Supabase database function guidance](https://supabase.com/docs/guides/database/functions), [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), and the November 2026 changelog index. The PostgreSQL 17.11 minor-release notice concerns extensions/operators not introduced by this migration. All new function search paths are fixed; the existing constrained executor roles retain `NOLOGIN`/`NOBYPASSRLS`. No new postgres-owned domain bridge or public-table grant was added.
