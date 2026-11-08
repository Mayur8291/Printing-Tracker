# Squad One implementation and verification

Source contract: `docs/SQUAD_ONE_BACKEND_PLAN.md` and `docs/squad-one-audit/ACCEPTANCE.md`.
Progress: `docs/SQUAD_ONE_EXECUTION.md`. This is an incremental implementation, not a declaration that the full audit matrix is complete.

The local harness uses the installed PostgreSQL 17 binaries, only on localhost port 55441, with source **structure** and synthetic records. It never downloads a customer-data dump. Its files are ignored under `tools/squad/private/`. Rebuilding destroys only the hard-coded local `squad_test` database.

```sh
tools/canto-sync/.venv/bin/python tools/squad/local_db.py rebuild
tools/canto-sync/.venv/bin/python -m unittest discover -s tools/squad -p 'test_*.py' -v
```

The staging deployment script uses the existing Keychain/Management connection helper. By default it executes all new Squad migrations in a transaction and rolls them back. `--apply` records immutable migration text and updates reviewed staging refresh fingerprints, after checking Printing Tracker isolation. Production is not a supported target.

```sh
tools/canto-sync/.venv/bin/python tools/squad/deploy.py
tools/canto-sync/.venv/bin/python tools/squad/deploy.py --apply
```

API contract conventions:

- Supabase Auth issues `sa_app` sessions. Ordinary staff sessions do not authorize Canto RPCs.
- Call `canto_api.v1_*` through `@canto/shared/squad`. Private schemas and imported tables remain inaccessible to clients.
- Bigint entity IDs are decimal strings in JSON responses. Versions are opaque `generation:revision` strings.
- Commands require an immutable UUID idempotency key. Reuse it with exactly the same payload after an uncertain response. A different operation/payload with the same key is rejected.
- Lists use a bounded cursor and return at most 100 records. Filters and actor scopes must be applied before the page boundary.
- `40001` means reload the entity; `42501` means forbidden; `28000` means the live session/account is no longer eligible; `55000` means temporarily unavailable/read-only; `22023` means invalid input.
- A source mirror is read-only. Disposable staging writes require an explicit operator setting; their revisions prevent unconfirmed refresh replacement. Cutover ownership enables normal writes and disables old-source refresh.
- A successful refresh increments the generation atomically and discards undelivered events from replaced mirror writes. It does not replay imported business side effects.

Local SQL tests do not substitute for hosted GoTrue/Data API tests, provider contract tests, or measured staging performance. Report each separately.

Hosted verification tools (staging only):

- `test_hosted_relationships.py`: rolled-back approval/link/coordinator journey and maximum bounded 100-customer/1000-order reassignment benchmark.
- `test_hosted_people.py`: rolled-back scoped people/workforce/address journey, enrollment intents and DB timing checks.
- `test_sdk.mjs`: actual GoTrue login and shared JS client read/denial checks.
- `test_hosted_dealer_stock.py`: rolled-back purchase → factory receipt → historical reorder/back-order → dealer delivery journey.
- `benchmark_stock.py`: first-page reads for the five largest eligible staging dealer ledgers.
- `test_hosted_factory_execution.py`: rolled-back order-to-factory-dispatch journey with real staging roles and per-contract DB timings.
- `test_hosted_production.py`: rolled-back factory-to-job-worker reassignment and worker-stage journey.
- `benchmark_hosted.py`: ten-persona order list, dashboard and detail latency checks; `--production-only` checks factory queues.

Mutation journeys hold the refresh/write lock, roll back business rows and temporary sessions, and restore all advanced sequences. They send no provider email, push or warehouse request. Work history rows are append-only; mutable completion counters are derived balances. Imported balance/history discrepancies return a reconciliation error rather than inventing missing work.

### Account proof contracts

The shared SDK provides `requestRegistration`/`completeRegistration`, `requestConfirmation`/`completeConfirmation`, `requestRecovery`/`completeRecovery`, and `invitePerson`/`acceptInvitation`. Use a random request UUID and retain it unchanged for completion and uncertain-response retries. Completion accepts `{requestId,email,code,password}`. Codes and passwords must not enter application logs, analytics or persistent client storage. Passwords require at least 12 characters and at most 72 UTF-8 bytes. A successful response distinguishes `sign_in` from `await_approval`; it does not return a session. Ordinary sign-in uses Supabase Auth.

Requests queue email; generic acceptance does not disclose whether an account exists or guarantee delivery. Mail jobs expose sanitized failures through the existing operator job contracts. Delivery is at least once with a stable Message-ID and the same code on retry. SQL credential commits are fenced/idempotent; SMTP does not offer exactly-once delivery. Registration, invitations, confirmation and recovery require cutover ownership. Refresh expires their outstanding proofs. The existing hourly cleanup route also removes expired proof secrets/profile payloads.

Dedicated Edge secrets: `SQUAD_ACCOUNT_SECRET` (preserve across deployments while proofs are outstanding), `SQUAD_SMTP_HOST/PORT/USERNAME/PASSWORD/SENDER`, and optional `SQUAD_MAIL_ALLOWLIST`. SMTP uses certificate-verified TLS on 2525 or 465. Staging currently permits only the controlled legacy test Mailinator recipient. Shared project Auth SMTP/signup settings are not modified. Production deployment must explicitly configure its own secrets/provider destinations and complete release acceptance.

`test_hosted_recovery.py` and `test_hosted_registration.py` perform real staging SDK/Auth/email acceptance. Run only against an idle mirror with no pending jobs. They pause the queue schedule for a bounded ownership rehearsal and persist restoration checkpoints under ignored `private/`; if interrupted, recover the checkpoint before rerunning. Codes are entered on hidden stdin after reading the test mailbox. Registration retains a blocked immutable reservation in the reserved test range after removing its source/Auth fixtures; it never disables the identity reservation guard. Benchmarks use rollback transactions, including transactional sequence restarts. See committed redacted evidence; no test credential belongs in source control.
