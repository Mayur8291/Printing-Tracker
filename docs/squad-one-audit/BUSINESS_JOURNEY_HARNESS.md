# Controlled business-journey acceptance

Iteration30 adds a prepared staging-only harness for real GoTrue sessions and shared-SDK business commands. It composes three modules: commercial/Admin/SC/PC/Customer, factory operations including managed Tailor/SubTailor, and Dealer/Job Worker/Team collaboration. The local composition executes the same SDK modules against actual PostgreSQL RPCs in a rollback transaction; that result does not claim hosted HTTP or provider acceptance.

The factory module tests partial and balance cutting, exact retries, overrun rejection, paginated cutting history, Tailor/SubTailor allocation, inspection/pick attribution, partial dispatch twice and final quantity/status rollups. The commercial phase preserves the accepted selling total and deposit across amendment, assignment and completion. The collaboration phase exercises real dealer receipts, partial FIFO consumption, shortage purchase and residual balances without inserting fabricated stock receipts.

`tools/squad/test_hosted_business_journeys.py` defaults to read-only preflight. Committed `--execute` remains the release integrator's reviewed action. It never sets cutover. It temporarily enables the existing staging rehearsal switch for exactly11 synthetic Auth UUIDs with a15-minute expiry; other users remain read-only. It captures and pauses the exact Squad Cron states in one atomic transaction, and restores them atomically. The exclusive setup fence is downgraded to a shared session fence while SDK requests run, excluding refresh/deployment while allowing normal command locks.

Before each command, the JavaScript runner fsyncs its deterministic key to an ignored private journal. Passwords and tokens are supplied through stdin and never persisted. A mode0600 checkpoint records planned source rows, baseline content digests, environment/generation/revisions, original schedules, and setup row transaction IDs. The runner invokes no Edge workers, providers or mail transports.

Cleanup first disables the rehearsal scope. It verifies every intervening audited command belongs to the fixture and a pre-journaled key. The internal backorder placement key is accepted only when proved by its journaled parent's immutable audit. Additional source roots come from these durable audits, so a lost HTTP response is recoverable; a client-reported entity ID never authorizes deletion.

The source graph is bounded to5000 rows and40 dependency rounds. Each derived row must be newer than the baseline ID/time, and every deleted row's PostgreSQL `xmin` must belong to a verified setup transaction or an owned command audit transaction. This rejects foreign children and later foreign edits to seeded rows. After removal, per-table counts and four SHA256 digest sums must exactly match the prefixture source snapshot before the transaction can commit. Foreign changes preserve the checkpoint and are never silently discarded.

Auth sessions/users and synthetic source rows are removed. Immutable audit/commands/receipts and blocked identity reservations remain. Exact queued fixture jobs are terminalized with `REHEARSAL_CLEANUP`; queued account requests fail without enrollment. The edit revision never moves backwards. Only the proved net-zero fixture delta advances the synced watermark, and a retained cleanup audit records that acknowledgment. Repeated recovery rechecks source, revisions, Auth state, queue state and public/staff invariance.

The HTTP runner also requires a stale order version to return HTTP409/`PT409`, and bounds each observed application-conflict response to five seconds. This catches transport behavior that a direct PostgreSQL test cannot establish. No SMTP, rendered document, live Uniware lifecycle, physical-device notification, production deployment or cutover is asserted by this harness. Hosted evidence is written only after all SDK phases and cleanup succeed, with the actual deployed migration prefix.

```sh
# Read-only staging preflight
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_business_journeys.py

# Integrator-reviewed committed staging execution
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_business_journeys.py --execute

# Exact-owned recovery, retaining checkpoint on any mismatch
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_business_journeys.py --recover
```

`tools/squad/profile_hosted_business_journeys.py` is a separate rollback-only SQL profiler for the same SDK modules. Its default is read-only preflight; the release integrator may run `--execute` on staging after review. It uses synthetic sessions inside one transaction and holds the exclusive environment fence throughout. It never commits fixtures, rehearsal flags, Cron changes or source edits, and it does not call Auth HTTP, mail or providers.

The profiler locks each source/domain/identity/sync sequence with a no-op cache alteration, then transactionally restarts it at its existing next value. Rollback restores both `last_value` and `is_called`, including on connection loss. It requires cache size one, ascending increments and no cycling. This briefly blocks concurrent sequence consumers, including a Cron task that needs such a sequence; it does not disable or reconfigure Cron. The script verifies source content, runtime state, sequence state, public structure, staff Auth and Cron after rollback, including ordinary runner failures. A disconnected session relies on PostgreSQL's transactional rollback; local tests explicitly exercise this case.

Mode0600 private JSONL records contain RPC names, workflow phases, known command labels, argument names, SQL duration and SQLSTATE. Error context retains only function names and line numbers. No argument values, SQL query text, email addresses, tokens, raw error messages or Node stacks are persisted. SQL timings measure the direct database call, with adapter overhead reported separately; they do not establish PostgREST, mobile-network or GoTrue latency. The default per-RPC timeout is10 seconds and the workflow budget is240 seconds.


Iteration 33 adds three composed modules after the original commercial/factory/rating flow: mixed-order/customer relationships, managed workforce/reporting, and shared Job Worker/Team product/PDF capabilities. The expanded real-Auth run passed 34 distinct groups and 437 RPC calls. The `commercialFinish` projection repeats the commercial checks and is not counted twice. The rollback profiler and scale benchmark retain the original 18-group FIFO diagnostic; the ordinary composition and hosted runner execute all additions.

Queued download-only documents are removed only when their entire actor-owned set matches the immutable `document.requested` audits, sequence IDs, generation, owning transaction IDs and exact pending outbox records. Captured snapshots, parts, output metadata, delivery state or any FK-dependent work refuse cleanup. Client-recorded document IDs do not authorize deletion. All six focused recovery checks pass, and the hosted cleanup removed exactly four unprocessed documents. This harness proves request/permission/selection behavior, not weekly/challan PDF rendering or email delivery.
