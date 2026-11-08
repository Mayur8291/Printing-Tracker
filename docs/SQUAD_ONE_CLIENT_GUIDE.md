# Squad One client integration

Use `@canto/shared/squad` from both the Expo app and the web app. Its implementation is [packages/shared/squad.js](../packages/shared/squad.js); request and response types are in [squad.d.ts](../packages/shared/squad.d.ts). This guide concerns the rebuilt Squad One services, not the older Dashboard Stock API.

The shared client uses authenticated RPCs in `canto_api` and the client routes of `squad-account`. The three shared Edge Functions are `squad-account` (account and file operations), `squad-jobs` (private background consumers), and `squad-webhooks` (verified provider events). Client apps never receive worker, service-role, database or Uniware credentials, and never call the worker endpoints.

## Environment and identity

Staging is `scvojtvgnkmbupvyslmb`; production is `levwrmvqdntngeasrtnb`. Use the selected environment's URL, publishable/anon key and session together. The rebuild is deployed and tested on staging; this guide is not evidence of a production release. Staging remains a source mirror outside explicitly controlled tests.

Initialize the usual platform-specific Supabase client with persistent session storage appropriate for that platform, then authenticate through Supabase Auth. An enrolled, eligible legacy account uses its existing password and mapped identity; do not create a replacement account merely to migrate it. After login, use `me()` for current role, capabilities and profile. A successful token exchange does not by itself establish business eligibility: live backend checks reject disabled, deleted or unavailable identities and customers whose approval is explicitly false. Preserve the returned nullable approval value; do not reinterpret legacy null values as false.

```js
import { createSquadClient, SquadError } from '@canto/shared/squad';

// supabase is this environment's authenticated platform client.
const squad = createSquadClient(supabase);
const me = await squad.me();
const first = await squad.orders({ state: 'pending' }, { limit: 30 });
const next = first.next_cursor
  ? await squad.orders({ state: 'pending' }, { limit: 30, cursor: first.next_cursor })
  : null;
```

The login roles are Admin, Sales Coordinator, Production Coordinator, Customer, Factory Manager, Dispatch Incharge, Inspector, Cutting Master, Dealer, Job Worker and Team. Tailor and SubTailor are managed workforce records, not standalone login accounts. Printing Tracker staff/admin is a separate principal; it cannot be treated as a Squad persona.

Render controls using current capabilities and authorized projections. Missing financial/contact fields mean the actor cannot read that field; do not substitute zero or fetch the raw row. Roles and feature grants can change during a session. Refresh current context after permission errors, and clear cached data on logout or environment/account changes. Namespace cached queries by environment and authenticated user; reset cursors when filters or context change.

## Reads, commands and errors

Entity IDs, versions and decimal money values are strings. Keep them as strings across navigation, JSON, forms and cache keys. Do not coerce bigint IDs or money to JavaScript floating-point numbers. Use the returned opaque `next_cursor` with unchanged filters. Lists and item child sections are independently bounded; the preview on an order is not a complete list of every child record.

For methods accepting a command or idempotency key, give each logical mutation one UUID key. Retain its complete payload, expected version and key until the outcome is known. An uncertain network response can be retried with the identical command. A new key after an uncertain response can duplicate the user's intent. A conflict requires reloading and reconciling the current record before creating a revised command. Use each method's declared arguments: creation methods may omit an expected version, and some verification methods use the reserved upload ID instead of accepting a new command.

```js
const me = await squad.me();
const command = { expectedVersion: me.version, idempotencyKey: newUuid() };
// Keep this command and payload together if the network response is uncertain.
const updated = await squad.saveProfile({ name: 'Example name' }, command);
```

`newUuid()` above represents the application's UUID generator; it is not an SDK method. The server validates authority and every transition even if the UI already checked it.

| `SquadError.kind` | Client behavior |
|---|---|
| `session` | Refresh/re-establish the session and recheck `me()`; clear unauthorized cached data. |
| `forbidden`, `not_found` | Show unavailable access/resource; do not infer that a foreign record exists. |
| `validation` | Correct the request or form fields. |
| `conflict` | Reload the record/version, reconcile user intent and submit a new logical command. |
| `unavailable` | Show the returned business state; mirror mode, unavailable provider and unfinished prerequisites are not success. |
| `unexpected` | Record a sanitized diagnostic and offer a bounded retry where appropriate. |

Prices and tax come from server quotes. Place orders using the returned quote/version; do not recalculate authoritative totals in the UI. Cutting, stitching, inspection, dispatch, criteria and worker stages are separate state dimensions. A force-closed order does not imply all physical pieces were dispatched.

## Files and background work

Render migrated media through returned resource references and `mediaGrants()`. Ready, missing, pending, external and empty are distinct reference states; grants may also return `unavailable` or `external_unavailable`. Use a URL only when the authorized result supplies one. Refresh expired grants when needed; do not persist signed URLs as permanent asset identities or construct public Storage URLs. Staging missing files remain reported; there is no production-file fallback.

Media uploads use `reserveMediaUpload()` → upload bytes to the returned signed destination → `finalizeMediaUpload()`. Finalization verifies the file before attaching it. `verifyMediaUpload()` is an optional separate verification step; a `verified` upload is not yet attached. Keep the reservation's expected version for verification/finalization, use a distinct command key for finalization, and preserve that finalization command on retries. Replacing/detaching also requires the current version and a command key. CSV transfers use their separate `reserveTransferUpload()` and `verifyTransferUpload()` contracts.

Documents and imports use request/status/download contracts; queued or processing is not ready. Poll bounded status endpoints with backoff and stop when terminal. Open/download only a ready result through the authorized download route. A retained job error is a visible failure, not an invitation to call a private worker from the app.

The existing Uniware adapter is the warehouse path required for launch. Airtable is excluded and should not appear as a required setup step. Refresh and real source-of-truth cutover remain operator features; ordinary mobile flows must not toggle them.

## Implementation and acceptance references

- [Execution record](SQUAD_ONE_EXECUTION.md): deployed iterations, measured results and remaining gates.
- [Release coverage](squad-one-audit/RELEASE_COVERAGE.md): workflow/persona bindings and explicit acceptance limits.
- [API catalogue](squad-one-audit/api-catalog.csv) and [functionality matrix](squad-one-audit/FUNCTIONALITY_MATRIX.md): shared service ownership and persona variations.
- [Hosted persona evidence](squad-one-audit/implementation-evidence/staging-personas-sdk.json): actual Auth, role, read and session checks.
- `tools/squad/business_journey_*.mjs`: composed shared-SDK call examples for commercial, factory and dealer/team workflows. Their execution status is recorded separately; a source example alone is not acceptance evidence.
