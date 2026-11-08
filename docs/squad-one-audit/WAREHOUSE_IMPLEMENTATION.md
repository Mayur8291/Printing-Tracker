# Warehouse worker implementation

Status: the new outbound adapters and worker pass isolated contract tests. The database workflow, shared worker routing, deployment configuration and provider acceptance are separate integration gates. No production or external warehouse writes were made while implementing this lane. Provider credentials and facility mapping must be verified before enabling writes. The user explicitly chose the existing legacy Uniware setup, including any existing tenant sharing.

## Source behavior and responsibility

The approved Flutter develop audit maps these workflows to INTEGRATE.01, INTEGRATE.02 and INTEGRATE.04. The implementation follows Rails main `14277820` plus the reviewed WMS branch `058ffb16`, specifically `WmsRouter` and the Dashboard/UniCommerce create, update, cancel, customer, order-info and inventory services. All financial calculations, actor checks, cutover rules and domain updates remain in Postgres. Edge code transports a frozen provider-native payload and returns evidence.

| Workflow | Dashboard | Uniware |
|---|---|---|
| Submit ready-made order | Existing atomic order API with durable idempotency receipt | One provider item per piece; deterministic order code; get/create/get verification |
| Amend order | Read current order, let SQL freeze CAS revision, then atomic edit | Persisted cancel-old/create-versioned-replacement phases; partial cancellation remains observable |
| Cancel | Atomic idempotent DELETE; exact reason belongs to request identity | Read bound order and target pieces; cancel once; read confirmation |
| Customer sync | Explicit inline customer data on order; original standalone service was a stub | Original create/edit customer payload and returned customer-code confirmation |
| Inventory | At most 100 SKUs for a configured facility; missing differs from zero | At most 100 SKUs, Facility header, same missing/zero distinction |
| Reconcile | Bound external ID/code/status and typed item evidence | Bound order code/facility/status and per-piece evidence |
| Reserve/release/fulfill | Existing warehouse atomic order/fulfillment APIs own stock movements | Provider owns physical stock; Squad does not create a second stock ledger |

Original dealer-direct and non-ready-made-order exclusions belong to SQL preparation. The original Dashboard reserve/release/fulfill helper classes do not justify new generic worker endpoints; the order workflow uses existing stock authority. The existing `uniware-bridge` supports the Printing Tracker's administrative import path; routing Squad business effects through that path would mix import side effects with command ownership. These typed adapters run inside existing `squad-jobs`, adding no Edge Function.

## Durable contract

`canto_api.squad_warehouse_prepare(p_id uuid, p_lease_token uuid)` returns a terminal job state or:

```ts
{
  state: 'prepared', provider: 'dashboard' | 'unicommerce',
  operation: 'submit' | 'inspect' | 'amend' | 'cancel' | 'customer' | 'inventory' | 'reconcile',
  purpose?: 'amend' | 'reconcile', intent_id, request_key,
  environment, project_ref, facility_code, provider_order_id?, order_code?,
  payload, attempted, customer_action?: 'create' | 'edit'
}
```

`attempted` is the previous persisted value. Preparation must persist attempted=true before returning, freeze the request identity, check the lease/current generation/current actor/current provider, and return only server-generated payloads. This conservative ordering means a process crash before its first HTTP call can require reconciliation for providers without durable request receipts.

`canto_api.squad_warehouse_finish(p_id uuid, p_lease_token uuid, p_result jsonb)` accepts a typed outcome: `CONFIRMED`, `OBSERVED`, `RETRY`, `RECONCILIATION_REQUIRED`, or `REJECTED`. Evidence fields are bounded external IDs/codes/status, customer code, typed order evidence, inventory entries, and an allowlisted error/retry delay. No raw provider error text, token or raw response is stored. A lost finish response is allowed to recover through the lease; the worker never sends a contradictory failure finish.

Dashboard inspection returns current `updated_at`, items, due date and allowlisted shipping-address fields so SQL can validate unchanged state before freezing CAS. Inventory proof binds the configured facility. Uniware order proof contains status and per-piece code/SKU/facility/prices. SQL owns local status progression and notification fanout.

## Idempotency and uncertainty

Dashboard requires the source-backed capabilities `atomic_mutations_v1`, `order_edit_cas` and `durable_mutation_results`. Before **every** mutation, it reads `/api/v1/mutations/<request_key>`. An existing receipt must match action, target and the complete frozen request body. Only a confirmed missing receipt permits the same deterministic mutation key to be sent. A bare `ORDER_EXISTS` response is insufficient for adoption: Dashboard's normal order GET omits prices, customer and facility, so it cannot prove the create request.

Uniware has no verified equivalent durable mutation-result endpoint. Creation first reads the deterministic order code. An existing result must match customer, channel, displayed code, COD, requested timestamps and notification fields, addresses, individual item codes, SKU, facility and both prices. Only the explicit successful-HTTP `40005` missing-order result permits a first create attempt. After an uncertain prior attempt, a still-missing result goes to reconciliation rather than blindly creating again. Published request/response fields and status values were checked against [Get Sale Order](https://documentation.unicommerce.com/docs/saleorder-get.html) and [Create Sale Order](https://documentation.unicommerce.com/docs/saleorder-create.html).

Cancellation also reads first; already-cancelled target pieces confirm success. An uncertain cancellation whose target remains active stops for reconciliation. A first cancellation is followed by a confirming read, following the [Cancel Sale Order contract](https://documentation.unicommerce.com/docs/saleorder-cancel.html). There is no invented automatic undo after a confirmed cancellation; replacement failure must remain visible for resolution.

Customer create/edit accepts a successful response only when its customer code matches the frozen request. No verified customer GET or idempotency/adoption API was found in the audited source or the published [Create Customer](https://documentation.unicommerce.com/docs/customer-create.html) and [Update Customer](https://documentation.unicommerce.com/docs/customer-edit.html) contracts. An uncertain customer write therefore stops for reconciliation. A duplicate customer is not silently converted into an edit.

OAuth defaults to credentials in request headers for the password grant. Explicit `SQUAD_UNIWARE_AUTH_STYLE=legacy_query` uses the original Rails GET query grant for legacy tenants, matching [Authentication](https://documentation.unicommerce.com/docs/oauth.html); it is not an automatic fallback. Neither request URLs nor errors are logged or returned. Access/refresh tokens are cached in the isolate and concurrent refresh is serialized. A rejected read can retry once after refresh; a rejected mutation is never immediately repeated. This follows [Authentication2](https://documentation.unicommerce.com/docs/oauth2.html) and [Refresh Token](https://documentation.unicommerce.com/docs/oauth-refreshtoken.html). A first attempt that fails while obtaining a token or doing a read-only preflight can return trusted negative evidence `mutation_attempted: false`; SQL may clear its attempt marker only for that case. An already-attempted intent or a started mutating HTTP request never returns this proof. Provider codes are interpreted using the published [response codes](https://documentation.unicommerce.com/docs/response-codes.html); arbitrary error descriptions never become job errors.

## Bounds and configuration

The worker permits 35 seconds of provider work, including every HTTP call and streamed response read. Each HTTP operation has a 10-second ceiling. Deadline cancellation also stops stalled response reads; cancelling an unresponsive stream is not awaited. DB preparation and finish have their own service-RPC timeout. No database transaction spans HTTP.

Requests are restricted to fixed source paths. Dashboard host is the current known Supabase project. Uniware host is `https://<validated tenant>.unicommerce.com`; redirects are rejected. Client or DB payloads cannot supply URLs, credentials or provider-specific URL fields. Payloads/responses are capped at 2 MiB, Dashboard writes at 256 KiB, OAuth responses at 64 KiB, Dashboard order lines at 250, Uniware pieces at 2,000, inventory SKUs at 100. These are explicit operational limits, not silent truncation. Larger orders must be resolved before submission rather than partially sent.

| Deployment setting | Requirement |
|---|---|
| `SUPABASE_URL` | Exact known staging/production project URL |
| `SQUAD_WAREHOUSE_ENABLED` | Explicit `true`; otherwise no adapters |
| `SQUAD_WAREHOUSE_ENVIRONMENT` | Must match project reference |
| `SQUAD_WAREHOUSE_WRITES_ENABLED` | Explicit `true` for mutations; reads can remain enabled |
| `SQUAD_WAREHOUSE_FACILITIES` | Comma-separated, distinct configured facility codes, at most 10 |
| `SQUAD_DASHBOARD_API_KEY` | Secret for the current project's existing Dashboard API |
| `SQUAD_UNIWARE_TENANT`, `SQUAD_UNIWARE_USERNAME`, `SQUAD_UNIWARE_PASSWORD`, `SQUAD_UNIWARE_CLIENT_ID` | Deployment-only credentials; never returned to clients |
| `SQUAD_UNIWARE_AUTH_STYLE` | `headers` by default; explicit `legacy_query` matches the old Rails password grant |
| `SQUAD_UNIWARE_ENVIRONMENT` | Must match current project environment; this binds configuration without asserting a separate tenant |
| `SQUAD_UNIWARE_CONFIG_SOURCE` | `dedicated` (default) or explicit `legacy_bridge`; the latter reuses existing server-side `UNIWARE_BASE_URL`, `UNIWARE_USERNAME`, `UNIWARE_PASSWORD`, `UNIWARE_FACILITY` and the old bridge client ID |
| `SQUAD_WAREHOUSE_READ_CHECK_ENABLED` | Explicit `true` enables the service-authenticated inventory-only connectivity check |

The existing legacy Uniware setup is the intended destination, per the user's November 8 decision. A separate tenant is not a launch prerequisite. Configuration never falls back between Supabase projects. In `legacy_bridge` mode, explicitly configured facilities take precedence over the old single-facility secret; tenant URLs must be exact HTTPS `*.unicommerce.com` origins. Before copying the Rails facility mapping, compare it with the actual old server configuration. Existing Printing Tracker credentials alone do not prove Rails configuration parity.

`POST /squad-jobs/warehouse-check` accepts one to five SKU codes and optionally one known order code, under the existing worker secret. It authenticates and reads inventory at configured facilities and optionally inspects an order in the first configured facility, with writes forcibly disabled; it performs no business RPC, queue claim, cache update, or cutover. Results expose counts, facility status and custom-field names/presence only, never credentials, tokens, hosts, customer data, custom-field values or raw quantities. It works in mirror mode and reports unknown SKUs distinctly. A passing read proves credential/inventory connectivity, not submit/amend/cancel acceptance. Shared-tenant write acceptance requires controlled test records whose effects can be accounted for; real orders are never test fixtures.

## Validation and integration gates

The isolated Deno suite has **39 warehouse tests passing**, with **159 current squad-jobs tests passing** and the worker typecheck passing. It covers exact durable receipt replay, lost responses, conflicting receipts, CAS, cancellations, provider identity/adoption mismatch, timestamps/COD, unknown inventory, bounded bodies, stalled streams, OAuth single-flight and refresh, uncertain writes, tenant/environment gates, allowlisted payloads, and maximum supported order sizes. The 2,000-piece adoption fixture took **5.86 ms** locally in the recorded run (two mocked requests, zero hosted requests). All HTTP responses are synthetic fixtures; this proves adapter behavior, not provider availability or hosted latency.

Before declaring end-to-end completion, integrate and test the service-only SQL workflow, queue routing, actor/generation/lease revocation, durable amendment/customer phases, monotonic status application, notification preservation and partial-cancellation reporting. Then run a controlled staging provider flow against the intended existing setup for submit → inspect/amend → reconcile → cancel, inventory zero/missing, customer creation, a lost response, and a repeated job. Hosted production remains outside this lane. Uniware uncertainty gates remain explicit limitations even after live tests.
