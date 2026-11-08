# Warehouse webhook ingress — implementation and acceptance contract

Status: the Edge ingress, service-only receipt RPC, durable worker, order transitions, stock invalidation, and scheduled reconciliation are implemented and covered by local tests. Deployment configuration, isolated provider credentials, and hosted provider acceptance remain release gates; this document does **not** claim the complete warehouse workflow has passed real-provider acceptance.

## Scope and original behavior

The approved Rails `develop` source (`058ffb160c323ca329aea2228af8b92477275a3c`) receives Dashboard order and stock events. `app/controllers/webhooks/orders_controller.rb` verifies `X-Dashboard-Signature` as HMAC-SHA256 over the original request bytes. It ignores the initial `CREATED` event because it can race the synchronous external-order create response. Other statuses feed `Order.apply_status_change`; the rebuilt worker must preserve derived order completion, notifications, stock and milestone rules without allowing terminal-state regression.

`app/controllers/webhooks/stock_controller.rb` only logs stock events and contains an invalidation TODO. The rebuilt integration must implement actual availability invalidation/reconciliation; receiving a stock event is not permission to create another stock ledger or directly overwrite warehouse balances.

The existing producer is `supabase/functions/dashboard-stock-api/stockCore.ts`, plus the order trigger in `20260728110000_order_webhook_created_status.sql` and atomic mutation events in `20260912064513_atomic_dashboard_mutations_v1.sql`. Its durable `dashboard_webhook_outbox` retains `event_id` and `occurred_at` across retries and signs `JSON.stringify(payload)` on delivery. Existing IDs contain either 12 or 32 hexadecimal characters after `evt_`; duplicate IDs with different bodies must be treated as a conflict, not silently discarded.

Uniware uses status polling in the audited source. No verified inbound Uniware callback contract was found. `/warehouse/unicommerce` therefore returns 404; Uniware integration belongs in the existing adapter and reconciliation worker. Tally/payment webhooks are outside this rebuild's audited feature scope.

## One Edge deployment, fixed routes

All routes use the existing Dashboard payload and signature unchanged:

| Route after `squad-webhooks` | Accepted event |
|---|---|
| `/warehouse/dashboard` | Any of the three typed Dashboard events |
| `/warehouse/dashboard/webhooks/orders/status_changed` | `order.status_changed` |
| `/warehouse/dashboard/webhooks/stock/level_changed` | `stock.level_changed` |
| `/warehouse/dashboard/webhooks/stock/low_threshold` | `stock.low_threshold` |

The aliases allow the existing producer to append its current paths when its base URL is switched to `…/functions/v1/squad-webhooks/warehouse/dashboard` during an authorized cutover. This implementation does not alter the producer URL, shared secrets, DigitalOcean application, or production configuration.

Only POST is accepted. There is no browser CORS allowance, arbitrary URL relay, table endpoint, caller-supplied actor/generation, or generic provider selector.

## Authentication, environment and replay rules

The gateway verifies the exact bounded raw byte sequence with WebCrypto HMAC verification before parsing JSON. It accepts one current and, optionally, one previous rotation secret; both must be 32–512 characters. Deployment requires `SQUAD_WEBHOOK_ENABLED=true`, a known Supabase project URL, and `SQUAD_WEBHOOK_ENVIRONMENT` matching that URL. Unknown or incomplete configuration fails closed with 503. A browser JWT does not authorize intake.

**Environment-specific keys are required.** Staging and production must not share either the current or previous key. A single Edge runtime cannot prove that the other project's key differs; the installer/release verification must check this invariant before enabling intake. The trusted project reference passed to SQL comes from deployment configuration, never the event body or HTTP headers. SQL independently binds it to its environment, selected warehouse provider, and verified cutover ownership epoch.

The old producer does not sign a separate delivery timestamp. Applying a five-minute age check to `occurred_at` would permanently reject legitimate delayed outbox retries. This compatible protocol therefore uses the following durable replay controls instead:

1. Preserve receipts across all refresh generations, with a unique `(provider, event_id)` identity and original body SHA-256.
2. Identical retries return the original durable acknowledgment; the same ID with changed bytes returns 409 and never creates another job.
3. First-seen events older than the recorded cutover activation watermark are quarantined or durably ignored. They cannot update the new application's business state.
4. Worker ordering and terminal-state rules reject older/regressive order changes. Stock callbacks invalidate availability and request authoritative reconciliation rather than applying additive stock movements from webhook quantities.
5. Generation fences prevent a previously accepted event from executing against refreshed data. Reconciliation repairs missed events; old external side effects are never replayed automatically after refresh.

These controls are implemented in the durable receipt and worker RPCs (`20261108080718`, `20261108081450`, and subsequent hardening migrations), rather than an in-memory Edge cache. Provider ingress remains disabled until its environment-specific configuration and hosted replay acceptance pass. The event timestamp is additionally rejected if it is malformed or more than 60 seconds in the future. Delayed timestamps are deliberately passed to the durable watermark policy.

The distinction between event time and attempt time is described by [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md). This implementation preserves the existing Dashboard raw-body protocol; it does not claim Standard Webhooks signature compatibility.

## Typed payloads and limits

Common fields are `event`, `event_id`, and `occurred_at` (ISO timestamp with timezone, up to six fractional digits). Unknown fields are rejected. The original timestamp text is preserved for PostgreSQL microsecond ordering.

| Event | Additional payload fields |
|---|---|
| `order.status_changed` | `dashboard_order_id`, `order_code`, `previous_status`, `status`; optional `dispatched_at` only for `COMPLETE` |
| `stock.level_changed` | `facility_code`, `trigger`, `changed_skus: [{sku_code, previous_stock, current_stock}]` |
| `stock.low_threshold` | `facility_code`, `low_stock_items: [{sku_code, available, threshold}]` |

Order statuses are `CREATED`, `PENDING`, `PROCESSING`, `COMPLETE`, `CANCELLED`, `FAILED`; `CREATED` requires null previous status. Stock triggers are `RESERVATION`, `RELEASE`, `FULFILLMENT`, `ADJUST`. Stock arrays contain 1–250 distinct SKU codes. Quantities must be finite numbers with at most two decimal places and absolute value at most 10¹²; negative availability is preserved as a source anomaly, while thresholds cannot be negative.

The body cap is 262,144 bytes, enforced against both Content-Length and actual streamed bytes. Body reading has a five-second deadline. Content type must be JSON; compressed input is rejected. The fixed SQL acceptance request has a ten-second timeout. No business transaction remains open during external provider HTTP operations.

## Durable SQL contract

The gateway makes exactly one service-role RPC call after authentication and validation:

```sql
canto_api.squad_webhook_accept(
  p_provider text,          -- fixed 'dashboard'
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb,          -- complete validated source payload
  p_body_sha256 text,       -- original signed bytes, not reserialized JSON
  p_project_ref text        -- trusted deployment project
) returns jsonb
```

Successful shape: `{receipt_id: UUID, state: 'accepted' | 'duplicate' | 'ignored' | 'quarantined'}`. The RPC is service-only, enforces current provider/cutover/environment policy, persists the permanent dedupe receipt, and enqueues its durable worker job atomically. Acknowledgment means durable receipt, not successful order processing. `canto_api.squad_warehouse_webhook(id,lease_token)` applies accepted receipts under the current generation and lease; its narrowly scoped integration capability permits only the linked order. Terminal/regressive order transitions are quarantined, completion reuses existing dealer-stock receipt logic, and actual status changes emit the shared notification event.

The Edge returns 202 only for newly accepted queued work; duplicate, ignored, and quarantined durable receipts return 200. A DB outage or uncertain timeout returns 503 so the original producer retries. SQLSTATE `23505` maps to `EVENT_ID_CONFLICT`/409, `42501` to `PROVIDER_DISABLED`/403, `55000` to `ACCEPTANCE_PAUSED`/503, and input-class errors to 400. Internal DB/provider details are never returned.

## Configuration and remaining acceptance

Required Edge secrets/configuration: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SQUAD_WEBHOOK_ENABLED`, `SQUAD_WEBHOOK_ENVIRONMENT`, `SQUAD_DASHBOARD_WEBHOOK_SECRET`; optional `SQUAD_DASHBOARD_WEBHOOK_PREVIOUS_SECRET`. No new dependency is installed. The function deployment must set `verify_jwt=false`, because provider signatures authenticate these requests; [Supabase's external webhook guidance](https://supabase.com/docs/guides/functions/auth#external-webhooks) documents this pattern.

Local verification:

```sh
deno check --config supabase/functions/squad-webhooks/deno.json supabase/functions/squad-webhooks/index.ts
deno test --config supabase/functions/squad-webhooks/deno.json supabase/functions/squad-webhooks/
```

The 26 tests cover exact-byte HMAC and whitespace changes; absent/wrong/cross-environment keys; rotation; disabled configuration; fixed routes and alias/event matching; stream size/deadline/content encoding; UTF-8/JSON validation; event/quantity/schema bounds; old-event quarantine handoff; future timestamps; duplicate/conflict acknowledgment; uncertain durability; and fixed project-bound RPC transport.

The local SQL suites additionally verify receipt permissions, same-body duplicate persistence, changed-body conflict, dedupe across refresh generations, verified cutover gating, old-event and unknown-order quarantine, `CREATED` no-op handling, reordered/terminal order statuses, facility isolation, current job leases, derived completion, and notification fanout. The public SDK never calls the receipt or worker functions.

## Inventory race protection

`20261108094123_squad_inventory_watermarks.sql` records one persistent watermark for each generation, provider, facility and SKU, even before a cache row exists. The watermark uses the database's immutable receipt timestamp, not the provider's `occurred_at`. A first-seen delayed callback therefore conservatively invalidates current inventory even when the provider clock is behind. Duplicate delivery and delayed worker processing reuse the original receipt timestamp; they do not advance the watermark.

Each inventory HTTP attempt is bound to its earliest database preparation time for the current lease. The cache `as_of` is that request-start time. Both receipt acceptance and snapshot finish lock watermark keys in ascending SKU order before updating cache rows. A callback received at or after request start keeps the result stale; a later successful poll clears it. Older responses cannot overwrite a newer cached observation, and unknown older responses cannot invalidate a newer known value. No callback quantity is treated as a ledger movement.

The 20 focused inventory tests cover cold/warm caches, delayed provider clocks, repeated preparation, equal timestamps, duplicate delivery, late worker processing, next-poll recovery, cache identity isolation, unknown results, lease expiry, private-helper permissions, and real two-connection lock serialization. A combined 480-test SQL regression passed through the subsequent scope-isolation migration. A 100-SKU snapshot finish measured 7.86 ms median and 9.07 ms maximum across 12 local synthetic samples; this measures database work, not provider HTTP latency. All fixtures are synthetic; no provider call or customer message is sent.

Still required before claiming provider acceptance: concurrent hosted signed deliveries and changed-body conflict, real environment-specific configuration, representative provider latency/throttling measurements, isolated read/write lifecycle acceptance where authorized, and controlled fixture cleanup without deleting permanent real receipt tombstones. The SQL and Edge implementations are complete artifacts; provider enablement is a separate verified operational step.
