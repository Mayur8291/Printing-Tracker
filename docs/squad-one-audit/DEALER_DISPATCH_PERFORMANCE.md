# Dealer dispatch allocation review — iteration 32

The hosted shared-SDK journey reached the final dealer dispatch after a successful back-order receipt, then exceeded the statement timeout while consuming the two FIFO receipts (4 + 3 pieces). The same local journey passed against small fixtures. This review reproduces the scaling cost and verifies the narrow authorization fix in migration `20261108112012_squad_stock_allocation_scope.sql`.

## Cause and change

`squad_stock_used_insert` originally checked the dispatch reference with `dispatched_quantity_id IN (SELECT id FROM sa_dispatched_quantities)`. The referenced table enforces work visibility through RLS. Both custom and generic hosted plans inspected the whole dispatch-history table to authorize each new allocation. The two-receipt local regression counted 6,110 visibility checks with 3,051 unrelated dispatch rows.

The migration changes the two allocation policies to correlated `EXISTS` checks on the referenced receipt and dispatch primary keys. It retains the same executor role, command type, receipt-owner requirement and underlying RLS checks. It changes no actor authority, stock identity, FIFO rule, quantity, command signature or grants. The performance problem was a whole-table authorization scan; the evidence does not establish a generic-plan switch as its cause.

The new tests in `tools/squad/test_stock_allocation_scope.py` cover foreign receipts, foreign dispatches, scoped allocation reads and bounded authorization work during a real two-receipt dispatch. Existing stock, back-order and full shared-SDK compositions retain their quantity and retry assertions.

## Local reproduction and installed verification

`tools/squad/benchmark_dealer_dispatch.py` reuses the existing 18-group shared-SDK composition. Before the first dealer allocation, it adds structurally valid foreign fixtures approximating the observed source cardinalities: 46,231 orders, 93,544 items and quantities, 43,497 receipts and 3,051 dispatch histories. Owned customer/dealer records continue through actual SDK commands: purchase, completion, receipt, partial/final fulfillment, shortage, back-order purchase, receipt and final FIFO allocation.

| Measurement | Final 7-piece FIFO dispatch |
| --- | ---: |
| Original policy, one local sample | 1,838.650 ms |
| Candidate policy, rolled-back probe | 24.446 ms |
| Installed migration, automatic planning, 3 samples | 24.508–27.045 ms |
| Installed migration, forced custom planning, 3 samples | 37.416–39.543 ms |
| Installed migration, forced generic planning, 3 samples | 97.074–111.145 ms |

Every installed sample completed all 18 shared-SDK groups. Every successful dealer dispatch stayed below the plan's 500 ms ordinary-command budget. The final allocation remained exactly `[4, 3]`, total receipts and consumption both reached 13, available stock reached zero, and the existing retry, stale-version, insufficient-stock and cross-role denials passed.

A fresh isolated rebuild through `20261108112012` then passed the full Python discovery suite: **1,841 tests in 99.846 seconds**, including the new stock-scope and application-conflict regressions.

These timings include the local Python SQL bridge's catalogue lookup, savepoint and role setup as well as RPC execution. They exclude fixture loading and network/UI latency. Nine samples across three planner modes are a focused regression check, not a hosted p95 or concurrent-load claim. Root-owned hosted verification remains separate. The benchmark makes no provider requests, keeps cutover false, rolls back fixtures, and verifies runtime state and mirror revisions are restored.

Reproduce against an isolated database containing the reviewed migration:

```sh
SQUAD_TEST_DATABASE=squad_test_stock PYTHONPATH=tools/squad \
  tools/canto-sync/.venv/bin/python tools/squad/benchmark_dealer_dispatch.py \
  --mode auto --output /tmp/dealer-dispatch.json
```

Use `--mode force_custom_plan` or `--mode force_generic_plan` for the other cases. The runner checks the complete composition and fails if a successful dealer dispatch reaches 500 ms. [Recorded measurements](implementation-evidence/local-dealer-dispatch-allocation-performance.json) retain the individual samples and expected denials.
