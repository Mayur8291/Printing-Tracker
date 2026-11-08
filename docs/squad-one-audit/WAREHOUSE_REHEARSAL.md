# Controlled Uniware provider acceptance

This is a provider-contract rehearsal, not proof of a committed business outbox lifecycle. The normal queue, cutover flag and warehouse ownership gates stay unchanged. The service-only Edge route and initial SQL capability were deployed to staging. The user has deferred further Uniware UI/provider acceptance; no further provider calls or mutation retries are authorized by this rehearsal until that work resumes.

The first controlled run, `255a278d-d61e-419d-8dc9-c36fcd771ee1`, verified both reserved order codes were absent, then received `REJECTED / PROVIDER_REJECTED` for customer `S-1954286882`. No order submission was attempted. The original response did not retain numeric provider diagnostics, so the customer's existence remains unconfirmed. The private checkpoint, immutable manifest and reserved identities remain retained. Before any continuation, reconcile this exact customer in the original tenant's UI; do not replay creation, change the immutable capture, reuse its identifiers, or claim cleanup or lifecycle success.

## Manifest and boundaries

A trusted capture uses the actual server DTO builders against a minimal synthetic source fixture, then rolls that source transaction back. Initial creation and replacement must come from their respective source builders; changing an initial payload's code is not an amendment capture. Customer/order IDs in the range 1,900,000,000–1,999,999,999 are permanently reserved during manifest registration, after the verified capture rollback and before any provider request, so an external test reference cannot later be reused. The immutable manifest contains one customer, an initial one-piece order and its one-piece replacement, source-capture hash, current generation, controlled Mailinator email, fixed tenant, staging project and timestamps. Source and provider fixture evidence are retained separately.

The initial code is `S-{order_id}`, replacement `S-{order_id}-1`, customer `S-{customer_id}`, and customer contact party `S-PC-{customer_id}`. Both order payloads use the same SKU, one piece each, positive equal selling/total prices no greater than INR 1,000 per piece, and `WH1`, matching the approved production/develop source creation route. `WH2` is already covered by separate read-only inventory acceptance. Every customer/order contact email must be the single configured fixture address. No P reference, real customer, shipment, stock adjustment or arbitrary HTTP destination is accepted.

Forward operations expire within 30 minutes and require the current generation. Cleanup expires within 24 hours and may survive a generation change, since external test orders still need to be cancelled. Cleanup remains bound to the original immutable manifest, tenant, staging project, item and customer. Generic business writes remain disabled.

## Durable contract

The service-only SQL contract is:

- `squad_warehouse_rehearsal_prepare(p_id uuid, p_step text)` returns a prepared lease or a scoped `busy`/`done` result.
- Prepared fields: `lease_token`, `manifest_json`, SHA-256 of those exact UTF-8 JSON bytes, prior `attempted`, actual `current_generation`, `completed_steps`, and currently uncertain/attempted `attempted_steps`.
- `squad_warehouse_rehearsal_finish(p_id uuid, p_step text, p_lease_token uuid, p_result jsonb)` validates and durably records the typed result before returning `done`, `retry` or `blocked`.
- There are no payload, tenant, credential, facility, actor or URL parameters on these service RPCs. Registration is a separate trusted operation over a server-captured envelope.

Prepare commits the exclusive lease and attempted marker before HTTP. Finish uses the exact lease and is never retried with a different result after a lost response. Normal and emergency cancellation share the same attempted lineage; changing step names cannot obtain a second uncertain cancellation.

| Step | Required durable predecessor | Effect |
| --- | --- | --- |
| `preflight` | None | Read both reserved order codes; both must be explicitly absent. |
| `customer` | `preflight` | Create the controlled customer once. |
| `submit` | `customer` | Create the initial order, then verify the actual adapter's complete identity and metadata proof. |
| `reconcile` | `submit` | Read and validate exact order/piece/SKU/facility/prices. |
| `cancel_initial` | `reconcile` | Cancel and confirm initial order. |
| `replace` | `cancel_initial` | Submit the frozen actual amendment payload using the replacement code. |
| `reconcile_replacement` | `replace` | Read and validate replacement. |
| `cancel_replacement` | `reconcile_replacement` | Cancel and confirm replacement. |
| `cleanup_initial` / `cleanup_replacement` | Preflight and corresponding attempted submit | Recover only the exact potentially-created test order. |
| `customer_disable` | Confirmed customer and cancellation of every attempted order | Edit that customer with `enabled:false`. |

The module uses the unchanged Uniware adapter and its existing read observer. During cancellation the observer checks every adapter GET, including its second read immediately before POST, against the sole expected piece, customer, contact/address, SKU, facility and prices. It refuses completed, dispatched and unknown item states. This does not invent a provider-side compare-and-swap guarantee; no such cancellation contract is exposed.

An uncertain customer create/edit cannot be automatically replayed because no customer lookup/adoption contract is available. The adapter now requires the returned customer code and `enabled` value to match the request. A response that omits `enabled` remains explicitly incompatible/unconfirmed. This behavior matches the existing Rails customer service's `enabled = !user.disabled` input and the official [Update Customer endpoint and enabled response field](https://documentation.unicommerce.com/docs/customer-edit.html).

An uncertain order create that is not yet visible remains unresolved. A single NOT_FOUND read during cleanup does not prove that a timed-out provider request cannot commit later. It returns `REHEARSAL_CLEANUP_NOT_FOUND`, retains the checkpoint, and permits bounded subsequent reads during the cleanup window. Only confirmed cancellation closes an attempted order. A trusted first-attempt `RETRY` with `proof.mutation_attempted:false` can clear the attempted marker because no mutating HTTP request started; a prior uncertain attempt can never be cleared this way.

## Verification and remaining acceptance

The isolated module has 24 focused tests, including the actual adapter with mocked HTTP for metadata rejection followed by cancellation, identity drift on the adapter's second GET, deadline aborts, disabled/production gates, generation/expiry boundaries, durable sequencing, uncertain customer/cancel behavior and sanitized replies. The ordinary adapter has 49 tests, including returned customer-enabled verification and sanitized rejection diagnostics. The combined `squad-jobs` suite, including the separate weekly-mail capability and route boundary tests, passes 283 tests; index/module typechecks pass. No provider requests were made by these tests.

Provider rejection evidence is limited to HTTP status and at most ten unique integer error codes. It excludes response messages, field names, parameters and contact data. This evidence requires the additive SQL error-proof validator before deployment. It never clears an attempted mutation or authorizes replay. The original hosted customer rejection retained only `PROVIDER_REJECTED`, so its discarded numeric codes cannot be reconstructed. Exact customer reconciliation uses the provider UI until a documented customer read API is available; the official support workflow is [Orders → Add/Edit Customer](https://support.unicommerce.com/index.php/knowledge-base/q-what-is-a-customer-how-do-we-add-one/). Numeric meanings can be checked against the official [response code list](https://documentation.unicommerce.com/docs/response-codes.html), without treating a general error code as proof that no customer was created.

The SQL capability, actual DTO capture and permanent ID reservation were exercised by the first run. Remaining acceptance is deferred: reconcile the exact rejected customer, release the reviewed diagnostics, and, when the user resumes this work, complete a controlled provider lifecycle with confirmed cancellation/customer-disable evidence. Any unresolved external outcome must remain recorded. Do not describe the partial rehearsal as production cutover, provider lifecycle success or committed outbox acceptance.

The route is `POST /functions/v1/squad-jobs/warehouse-rehearsal`, authenticated with the existing worker secret and JSON `{ "run_id": "<uuid>", "step": "<fixed-step>" }`. The request is limited to 4 KB. It accepts no payload, recipient or configuration. A validated prepare grant creates a request-local Uniware adapter whose enable and write flags apply only to the exact manifest; the normal adapter and both deployment flags remain unchanged. The rehearsal therefore works while the generic warehouse worker remains disabled. Staging project/environment binding and SQL capability validation still precede adapter construction or provider HTTP. The controlled email comes from trusted registration, and generation comes from the prepare RPC, so no new per-run environment configuration is required.
