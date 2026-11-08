# Existing Uniware parity review

This review compares Rails main `14277820c78e018e62be3da1a14cd8d716cdbf02` and Rails develop `058ffb160c323ca329aea2228af8b92477275a3c`, alongside the approved Flutter develop contract. All seven files under Rails `app/services/uni_commerce/` are identical between these Rails revisions. Develop routes through `WmsRouter` and disables Uniware polling when Dashboard mode is selected. The user requires the existing Uniware setup and excludes Airtable from launch; a separate Uniware tenant is not a prerequisite.

The following changes are local implementation evidence. Hosted read connectivity, provider mutation acceptance, deployment and ownership activation are separate checks owned by the root execution lane. This review did not send provider requests or perform hosted writes.

## Source-backed corrections

| Behavior | Original source | Correction and evidence |
|---|---|---|
| Order custom metadata | `uni_commerce/create_order_service.rb:155–168`: `Customer_Details`, `PICKUPDATE`, ordered nonblank item comments | Migration `20261108100011` adds these to both initial orders and accepted amendment replacements. It uses the same company/name fallback and preserved comments, with the application's Kolkata date. |
| Piece comment | Same file `214–217`: ` : ` prefix, blank-to-empty, first 350 characters | Shared private formatter preserves Ruby character semantics, including Unicode. The order aggregate remains untruncated. |
| Failed create recovery | Same file `97–100` stores a linked `FAILED` even on a failed/uncertain create response. Develop `update_uc_order_status_service.rb:26–41` later polls linked non-COMPLETE orders | Migration `20261108100638` restores narrow Uniware legacy recovery by current leased read evidence. Automatic Uniware polling includes FAILED; Dashboard FAILED remains terminal. |
| Inventory case matching | `uni_commerce/fetch_inventory_service.rb:67–74` uses lowercase facility/SKU keys; `RmpSku` reads lowercase keys | Adapter maps unambiguous case-equivalent results back to the exact requested SKU. Ambiguous requested codes fail before HTTP; duplicate response aliases, unknown identities and malformed quantities cannot overwrite inventory. |
| Existing authentication grant | `uni_commerce/auth_token_service.rb` supplies credentials in the OAuth query | Parent-owned explicit `legacy_query` configuration reproduces the existing setup. The default header flow remains separate. Health evidence never contains credentials, request URLs or provider error bodies. |

New initial/replacement orders already use accepted UTC instants. `PICKUPDATE` renders these in `Asia/Kolkata`, matching `config/application.rb:32`. This does not assert or change the interpretation of historical naive database timestamps; that remains the previously documented source timestamp acceptance gate (`PERSONA_FINANCE_PARITY_REVIEW.md`).

The custom metadata is part of the immutable operation payload, so retrying an operation does not recompute it from subsequently changed source comments. Replacements use the accepted amendment's due date and line comments. The final local publication still rechecks the shared accepted specification. No pricing, quantity, owner, tax, customer identity or address formula was changed.

## Narrow FAILED recovery contract

Only an existing source order whose current status is FAILED and whose provider is Uniware can use this path. Its stored external ID must be the exact environment/order code (`S-id` or `P-id`, including the existing numeric replacement suffix). A previously confirmed FAILED warehouse link remains terminal.

The private helper can execute only under the existing integration capability backed by the same transaction, generation, order, prepared lease and `warehouse.order_reconcile` job. It requires an OBSERVED result from the adapter's `saleorder_get` path, exact provider ID/code, an eligible observed status, configured facility on every piece, unique nonblank piece codes, and an exact SKU quantity multiset derived from the current original item/quantity rows. Empty, unknown or mismatched source quantities do not authorize recovery. The normal shared status core still handles optimistic versioning, audit, notifications, progress and dealer receipt semantics. A replay never publishes twice. Browser and service API callers cannot invoke the private helper directly; the service-only finish RPC still requires the actual current prepared job lease.

Incoming observation proof is persisted inside the same finish transaction before the status helper evaluates it. A failed or quarantined observation retains evidence for diagnosis. This does not add a proof override, force-complete endpoint, generic terminal reopening, webhook bypass or automatic provider write.

## Route and payload comparison

| Legacy action | Current adapter route and semantics |
|---|---|
| Auth | `GET /oauth/token`; configured existing tenant, password grant, bounded token refresh. Read retries may refresh credentials; an uncertain mutation is never silently repeated. |
| Customer create/edit | `POST /services/rest/v1/oms/customer/create` or `/edit`; existing S/P customer and party codes, company/name fallback, primary contact, GST and primary billing/shipping address. |
| Create | `POST /services/rest/v1/oms/saleOrder/create`; Custom channel, COD/CASH, STD shipping, no gift wrap, zero prepaid/discount/shipping charges, one piece per quantity. Money comes from accepted receipts. |
| Cancel | `POST /services/rest/v1/oms/saleOrder/cancel`; bound order identity and verified original item codes. Complete confirmation is required before replacement/local cancellation. |
| Read | `POST /services/rest/v1/oms/saleorder/get`; exact bound order reference, status and per-piece evidence. |
| Inventory | `POST /services/rest/v1/inventory/inventorySnapshot/get`; Facility header and bounded SKU list, distinct unknown versus confirmed-zero availability. |
| Amend | Durable inspect → cancel original pieces → create incremented S/P replacement code. Original local lines survive until confirmed replacement publication. |

Current authority, generation, cutover, configured provider, disabled/archive/approval checks and accepted money remain intentional improvements over legacy permissive `rescue nil` and live price recomputation. They are not duplicated persona services. Existing SQL/worker contracts are reused; no Edge Function or public endpoint was added by these corrections.

## Conditional facility gap and evidence needed

Legacy `OrderInfoService:61` asks for **both** configured one-day and three-day facilities. Current legacy create code at `CreateOrderService:198` uses one-day; lines 199–200 contain older, commented dealer/split allocation rules. The new adapter reads and verifies the operation's exact bound facility. It must not blindly adopt an order from another facility.

The migrated order/item schema does not store provider piece facilities. Therefore a SQL count cannot prove how many linked orders are actually in the three-day facility. The following read-only query identifies the bounded candidate population by environment prefix/status; it does **not** establish facility distribution:

```sql
SELECT order_source, uc_status,
       CASE WHEN uc_order_id ~ '^S-[0-9]+(-[0-9]+)?$' THEN 'staging'
            WHEN uc_order_id ~ '^P-[0-9]+(-[0-9]+)?$' THEN 'production'
            ELSE 'unclassified' END AS reference_environment,
       count(*) AS linked_orders
FROM sa_snapshot_20261019.sa_orders
WHERE deleted_at IS NULL AND is_deleted IS NOT TRUE
  AND nullif(uc_order_id, '') IS NOT NULL
  AND coalesce(order_source, 'unicommerce') = 'unicommerce'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

The parent-owned staging source read on 2026-11-08 found **no S-prefixed Uniware references**. Its P-prefixed status counts were COMPLETE 39000, CANCELLED 3202, PROCESSING 1629, FAILED 123, empty 106 and CREATED 1. These are source facts reported by the read-only integration lane, consistent with a historical production copy; this review does not infer why or when they were copied. Existing P-prefixed history does not authorize staging to mutate a production-named provider order. The FAILED recovery environment fence deliberately remains in force. Read-only DTO diagnostics may inspect an explicitly bound existing source reference, but must not turn that inspection into a create/amend/cancel operation or weaken the ownership boundary.

Actual facility parity requires reading the original configured one-/three-day facility values and then bounded provider reads of those exact linked references, verifying every piece's identity/facility. Neither dealer role nor a commented old allocation rule is sufficient evidence to remap an order. The current path remains closed on mismatched facilities. Parent owns this read-only configuration/provider check.

## Verification

A clean isolated PostgreSQL rebuild through `20261108100638` passed **220 affected warehouse/inventory/schedule tests** before the final aggregate-bound test, plus **9 custom-field workflow tests** and **16 FAILED-recovery tests**. Coverage includes actual placement, durable amendment cancellation/replacement/local publication, frozen retries, accepted money, timezone independence, Unicode limits, helper permissions, exact recovery/replay/audit, provider/facility/reference/quantity/SKU mismatches, duplicate piece codes, missing read marker, confirmed terminal links, stale leases and scheduled eligibility.

The combined adapter/read-check run passed **60 Edge tests**, including **5 new inventory case tests**. A subsequent metadata/bounds regression run passed **60 adapter tests**: 46 existing, those 5 inventory tests and 9 new custom-field tests. The final complete `squad-jobs` suite then passed **223 tests** using its explicit Deno configuration and only environment/read permissions. These use mocked HTTP only. The parent separately reported successful real read-only legacy authentication/inventory connectivity; that result does not prove customer/create/amend/cancel behavior.

[Unicommerce Get Sale Order documentation](https://documentation.unicommerce.com/docs/saleorder-get.html) lists customFieldValues at order and item level (5.23 and 5.21.52). The adapter now requires every expected custom field exactly once with an identical value during existing-order adoption and post-create proof; provider extras and field ordering are permitted. Missing expected fields produce `PROVIDER_CUSTOM_FIELDS_MISSING`; duplicate or different values produce `PROVIDER_CUSTOM_FIELDS_MISMATCH`. Both remain visible reconciliation outcomes and do not authorize another uncertain mutation. The order Comment limit is 200098 Unicode codepoints (50×4000 plus separators), piece Comment 350, with the shared 2 MiB payload ceiling. SQL command envelopes independently remain capped at 262144 bytes. The documented Get Sale Order request supports only `code`, optional `facilityCodes` and optional `paymentDetailRequired`; it specifies no custom-field include flag. Custom fields are part of the documented response shape. The parent-owned real read probe authenticated and read inventory, but a source-linked P-prefixed COMPLETE order returned explicit 40005 at the configured facility, leaving no DTO metadata shape to inspect. Actual Rails facility configuration and a matching provider order are still needed for a live parity claim; the documented proof requirement remains strict. Mocked proof alone is not evidence that the live provider persisted metadata. Whole-provider acceptance remains the WAREHOUSE gate in `RELEASE_COVERAGE.md`.
