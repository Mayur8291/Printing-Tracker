# Provider-confirmed order changes

Migration `20261108084246_squad_warehouse_amendments.sql` is frozen for integration review. **36 new amendment/cancellation tests and 146 combined amendment, customer, original order-amendment and job tests pass locally.** No provider HTTP, hosted write, production activation or ownership change was performed by this lane. Provider responses in these SQL tests are synthetic; the actual existing Edge adapters separately verify the external provider response.

The implementation uses the existing service-only `squad_warehouse_prepare` / `squad_warehouse_finish` endpoints and the original durable `order.edited` or `order.cancellation_requested` job. There is no new public endpoint or Edge function. It extends the existing operation ledger with a bounded saga record containing the frozen replacement, original identity, expected source SKU quantities and completed phase history.

## Source semantics and resulting workflow

The pinned Rails `UpdateOrderService`, `DeleteOrderService`, `CancelOrderService` and UniCommerce parameter services establish the original external cancel/recreate sequence, incremented `S-id-n` / `P-id-n` codes, per-piece Uniware items, dealer exclusion, item cancellation status and original order identity. The new implementation retains the existing shared `apply_order_amendment` for all local item, quantity, pricing, branding and receipt publication. It retains the original order, creator and history. It improves the old service's `rescue nil` behavior by making unknown provider outcomes explicit durable reconciliation states.

| Current order / requested change | Durable sequence | Local publication |
|---|---|---|
| Direct Dashboard RMP edit | Inspect exact provider identity and SKU quantities → CAS amendment using the provider's observed timestamp | After durable mutation acknowledgment |
| Direct Uniware RMP edit | Inspect → cancel every original piece → create deterministic versioned replacement | After replacement creation is confirmed; old local lines remain through the cancellation phase |
| Existing external RMP → custom-only edit | Inspect → confirmed external cancellation | Shared amendment, clear external reference/link, restore empty legacy warehouse status |
| External cancellation/deletion | Inspect → confirmed cancellation | Mark order and RMP items cancelled; deletion additionally soft-deletes the order |
| Direct order with no external reference, new RMP shape | Submit frozen replacement | After confirmation |
| Dealer-linked order with no external reference | Current-authority local execution, no provider operation | Shared amendment or cancellation, even if provider integration is disabled |
| No external reference, custom-only edit or cancellation | Local execution | No unnecessary provider dependency |

A Uniware amendment without an actual confirmed customer mapping creates the same durable customer dependency used by initial submission. It waits for that dependency; it never invents a provider customer ID. A provider ID on a dealer-linked order, unrecognized replacement code, reservation without a verified provider order ID, missing contact/delivery data, or ambiguous source SKU mapping remains a visible reconciliation issue.

## Custody and correctness

Each phase has its own stable request key, immutable HTTP payload, exact prepared lease, prior-attempt marker and persisted acknowledgment. Progression records the completed phase before releasing the next phase to the queue. A lost response reuses the frozen phase; the adapter reconciles the existing provider result before attempting another mutation. No HTTP occurs inside a database transaction.

Every preparation and final publication rechecks the original actor's current authority, role, customer/order scope, source generation and optimistic order version. Sales coordinators retain their existing edit scope; dealers can only cancel their linked customer fulfillment. A revoked actor after provider HTTP leaves the provider proof intact and the local order unchanged. The worker does not forge an Auth session to complete the business mutation.

The private request capability is bound to the current transaction, actual leased job, original actor and request ID. The separate integration capability can update only the confirmed order's provider reference/status. Browser callers cannot invoke either private publisher. Existing publication/refresh locks, generation fences, ownership requirements and environment selection remain in force.

Inspection compares the complete provider SKU quantity multiset to the current source order. Missing quantities, unknown item states, partial dispatch, completed/cancelled orders, wrong facilities, duplicate Uniware piece identities and mismatched provider identities fail before mutation. Dashboard amendment requires its observed update timestamp and durable request-key proof. Uniware cancellation requires every original piece to be confirmed cancelled before replacement becomes eligible.

The frozen replacement uses the accepted quote prices plus the shared per-unit tax calculation. Each RMP line must still equal the accepted total. The replacement is recomputed immediately before publication to detect tax, customer or delivery changes while HTTP was in flight. Divergence retains the external proof and requires reconciliation instead of publishing different money. Payload bounds remain 250 Dashboard lines / 2,000 Uniware pieces, within the original 50-line order contract. Uniware piece JSON uses set aggregation per variant.

Concurrent provider webhook/reconciliation status during an active change is durably quarantined as `ORDER_CHANGE_PENDING`. An old-order cancellation cannot publish into a pending replacement. Confirmed amendment emits the existing `order.amendment_applied`; confirmed cancellation emits the existing `order.provider_cancelled`. Those paths do not also emit `warehouse.status_changed`, avoiding duplicate cancellation notices. Original status/stock notification flows otherwise retain their shared implementation.

Uncertain outcomes retain the pending request and operation proof, holding overlapping order mutations closed. Existing operational job views expose the dead job/error and existing safe retry rules still apply. This is deliberately not an automatic waiver, actor reassignment, proof override or destructive resolution endpoint.

## Verification and remaining release work

The 36 new tests exercise both complete sagas, repeat replacement codes, direct/dealer exclusions, custom conversion, cancellation/deletion, item status, customer dependency, frozen retries, phase evidence after failure, exact identity, wrong lease/generation, disabled provider/actor, current-version changes, missing atomic proof, source quantity mismatch, partial dispatch, accepted tax totals before and after HTTP, and concurrent provider status quarantine.

`benchmark_warehouse_amendments.py` runs actual SQL publication in isolated rollback transactions with 50 replacement lines / 2,000 pieces, seven measured runs after one warm-up, and a 500 ms budget per database phase. Evidence is in `implementation-evidence/warehouse-amendments-local.json`, bound to the migration SHA-256. It excludes provider network latency and makes no hosted latency claim.

Final integration still needs the complete reviewed migration prefix, parent-owned notification/retry policy wrappers and full regression suite. Actual isolated provider acceptance is a separate release gate. Both production and staging remain under their existing ownership/provider enablement controls; this implementation does not activate either environment.
