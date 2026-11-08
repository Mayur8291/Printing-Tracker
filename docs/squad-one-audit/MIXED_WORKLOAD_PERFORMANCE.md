# Concurrent workload performance and work-policy correction

The local integrated test passes the planned database budgets with **four independent PostgreSQL connections and 400 measured RPC calls**. It also verifies committed competing commands and exact cleanup. This is local synthetic database evidence; hosted API/network capacity, external providers and production cutover are separate acceptance gates.

## Workload and measurement

`tools/squad/benchmark_mixed.py` is restricted to the isolated `squad_test_stock` database. It creates 100,000 invented historical orders, 110,000 items and their size rows. The declared distribution is 70% custom, 20% ready-made and 10% mixed, with two items on each mixed order; 10% belongs to the exercised customer/SC/factory scope. Dates span two years, statuses vary, and actual RPC-created fixtures supply valid current production work. These proportions are a reproducible stress fixture, not a claim about the measured production distribution.

Four connections each warm ten operations, then execute 100 measured calls in overlapping, offset cycles. The mix contains order list/detail/dashboard, quote/place/payment, cutting, job-sheet assignment, inspection and dispatch. Each RPC is evaluated once inside a materialized start/end-clock query. The reported server interval includes execution and lock waits, but excludes statement parsing/planning and network. A separate client timer includes execute/fetch/JSON transport. It is not an HTTP/mobile latency measurement. Separate `EXPLAIN (ANALYZE, BUFFERS)` evidence validates the expensive paths including planning/execution reporting.

Measured command transactions roll back immediately. Untimed assertions check scope, accepted money, quantities, exact idempotent responses and one command/audit/outbox effect. Those assertion calls remain part of connection occupancy but are not counted as the 400 measured RPCs. The final measured phase took **6.053 seconds including these assertions and transaction overhead**; this is not advertised as sustainable transactions-per-second capacity. Shared local host activity was not isolated as a production capacity test.

## First iteration found an actual bottleneck

The first integrated run passed correctness but failed three command budgets. Factory RLS repeatedly materialized all 11,007 accessible item/quantity/history IDs for single-row statements. A one-row child lookup took 44.482 ms and 12,963 shared-buffer hits; a one-row quantity update took 41.644 ms and 11,262 hits, building the scope twice. Single-thread inspection still took 760.026 ms, confirming that concurrent host noise alone did not explain the failure.

Before evidence: [mixed workload](implementation-evidence/local-mixed-workload-before.json), [targeted query plans](implementation-evidence/local-mixed-work-plan-before.json). The before run used the frozen integrated `90719` prefix. Fixture setup initially retained tiny-parent foreign-key query plans after large inserts; the runner now analyzes each parent before inserting its children. That change affects fixture construction only and neither disables constraints nor changes runtime SQL.

## Focused correction

Migration `20261108093050_squad_work_point_scope.sql` changes only private authority evaluation and the existing executor work/quantity policies:

- Existing `can_item` still uses the current shared `can_order` policy. The cutter case checks assignment on the exact item and existence of its parent order. This is equivalent to enumerating every order containing that cutter's assigned items and then rechecking the selected item.
- Private guard-owned `work_parent_visible` resolves one allowlisted history/quantity ID to its existing item and calls that shared item authority. It accepts no table name, SQL, actor ID or cached authority token.
- Existing work parent/child SELECT, INSERT and UPDATE policies use point checks. All previous parent predicates remain present, including both parent and quantity checks on child inserts. No client table grant, business role, write capability, RLS bypass, session cache or command-state rule was added.

The old whole-set helpers remain for appropriately batched reports. Guard-owned report aggregation and domain rules are unchanged. All command locks, expected versions, scope checks, work histories, amount calculations and quantity invariants still run.

## Final results

Warm server elapsed p95 in milliseconds, 40 samples per RPC:

| Actual public RPC | Before | After | Target |
|---|---:|---:|---:|
| `v1_orders_list` | 4.225 | 3.300 | 200 |
| `v1_order_get` | 74.409 | 24.409 | 200 |
| `v1_dashboard` | 29.170 | 25.182 | 200 |
| `v1_quote` | 4.774 | 3.907 | 500 |
| `v1_order_place` | 19.455 | 162.521 | 500 |
| `v1_order_payment_record` | 3.695 | 3.493 | 500 |
| `v1_cutting_record` | 314.839 | 127.906 | 500 |
| `v1_jobsheet_assign` | 805.253 | 76.801 | 500 |
| `v1_jobsheet_inspect` | 1045.336 | 91.525 | 500 |
| `v1_dispatch_record` | 638.232 | 112.139 | 500 |

Every result is retained, including the increased placement latency in the changed concurrent workload. Passing the threshold does not establish why every individual latency moved. The before/after prefixes also include the separately reviewed weekly-schedule and Airtable-recovery additions. The targeted RLS query plans isolate the intended correction: child lookup **1.730 ms / 101 hits**, quantity update **1.626 ms / 96 hits**. Full inspection `EXPLAIN ANALYZE` execution was **80.363 ms**.

Final evidence includes raw samples, separate client percentiles, function/migration fingerprints, retry accounting and cleanup: [mixed workload](implementation-evidence/local-mixed-workload.json), [targeted plans](implementation-evidence/local-mixed-work-plan-after.json). There were **zero deadlocks and zero unplanned serialization retries** in the measured mixed run. Zero observed failures is not a proof that a larger or different deployment can never deadlock.

## Committed contention and correctness

Separate four-client trials make real commits against exact-owned synthetic rows:

1. Four identical cutting requests return the same result and create one effect. Four distinct commands at one version produce one success and three expected stale-version failures. Reloading and retrying one failed request reaches the six-piece limit; overcutting remains denied.
2. The same dispatch trial preserves `6/6/6/6/6` required/cut/assigned/inspected/dispatched quantities and blocks additional dispatch after completion.
3. Four simultaneous same-key placements produce one order set with the accepted monetary total.
4. Four separate dealer-customer orders compete for ten pieces of the same stock. One seven-piece dispatch succeeds and three fail for insufficient stock. Receipt consumption, usage ledger and summed customer dispatches all equal seven, leaving three available.

Expected conflict timings and error codes are recorded separately. No provider or worker was called. Cleanup deletes only keys absent from the exclusive synthetic baseline, in foreign-key dependency order; it restores modified fixture settings and exact environment revisions. All **157 baseline table fingerprints** matched afterward. Sequence gaps are deliberately retained.

## Regression evidence and reproduction

Twelve new policy tests compare the new predicates with the original authorized sets for all eleven login personas in both factory groups, across all eight work-parent kinds. They also test foreign parents/quantities, cutter sibling isolation, factory reassignment, demotion, disablement and private-helper denial. Combined affected suites passed **519 tests**: order creation/amendment/detail, production allocation/execution, full multi-persona financial journey, dealer stock/backorders/reconciliation, deliveries, earnings/work/sales reports, documents and media grants.

Run only in the assigned synthetic database, after reviewing the complete migration prefix:

```sh
SQUAD_TEST_DATABASE=squad_test_stock SQUAD_TEST_MIGRATION_THROUGH=20261108093050 PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python tools/squad/local_db.py rebuild
SQUAD_TEST_DATABASE=squad_test_stock SQUAD_TEST_MIGRATION_THROUGH=20261108093050 PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python tools/squad/benchmark_mixed.py
```

The runner must not overlap other users of this same synthetic database; other agent databases are independent. Its default call mix exercises representative one-size commands. Existing maximum-batch benchmarks and the full regression suite remain required; this test does not substitute for them or authorize enabling real production writes.
