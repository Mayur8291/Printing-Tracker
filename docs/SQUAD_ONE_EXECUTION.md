# Squad One implementation journal

Status: IN PROGRESS. Source plan: `SQUAD_ONE_BACKEND_PLAN.md`, audit commit `3a5830d`.
Authorization: implement and test the full backend on staging; production release is separate.

## Execution rules

- Number each iteration, record its exit evidence, and report progress to the user.
- A function name or passing smoke test is not workflow completion. Track contracts, persona policies, state/quantity invariants, provider behavior and performance.
- Use the existing snapshot, identities, admin Masters, warehouse interfaces and refresh pipeline.
- Preserve unrelated local changes; commit and push task files to develop.
- No changes to DigitalOcean application code. No new production writes.
- The user's latest requirement is all business backend execution on Supabase. Replace the proposed external PDF container with measured, bounded/resumable Supabase jobs if runtime limits permit. Do not claim heavy-job acceptance until tested.

## Iteration 1 — access, contracts and write/refresh protection

Foundation slice deployed to staging. Verified staging has 86 imported tables, 6,860 ready identity mappings, no active refresh, and equal edit/sync revision 167 before implementation. Existing Auth execution role is `sa_app`; Printing Tracker staff authorization remains separate.

Implementation begins in an isolated local PostgreSQL test database containing only structural fixtures and synthetic data; deploy verified slices to staging for real Supabase Auth/Data API tests. No live user data is copied into test fixtures.

Evidence: 35 local database integration tests pass, including two simultaneous connections testing duplicate commands and conflicting edits; live Auth/session eligibility, capability parent/child checks, mirror/cutover fences, source generation invalidation, password changes and refresh/Auth deadlock prevention. Hosted staging login with the preserved legacy-created test account succeeds; `v1_me` returns the mapped identity; anonymous, staff-admin API, raw-table, profile promotion and mirror-write attempts are denied. First measured end-to-end `v1_me` request: 864.5 ms from this Mac, including network/TLS; this is not a database p95 claim.

Existing staging admin/refresh regression: 10 checks pass in rollback-only transactions, including environment isolation, exact discard revision, concurrent refresh rejection, commit-journal recovery and revoked sessions. Initial security advisor scan found no findings attributed to new domain functions/tables; pre-existing warnings remain outside this slice. Re-scan after subsequent migrations.

Two implementation corrections were made before closing this slice: hosted role ownership transfer requires temporary schema CREATE privilege (revoked before commit), and managed Auth schema USAGE cannot be delegated to custom roles. The latter uses one explicitly reviewed private `sa_domain.auth_context()` bridge, owned by postgres, returning only the current eligible subject/email after checking its exact live session. It accepts no arbitrary user ID and is executable only by the lookup role. Business definers remain NOLOGIN/NOBYPASSRLS, with table policies. This narrow Auth-read exception updates the original blanket ownership rule; it follows [Supabase's hosted Auth guidance](https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema-9e32e7).

Shared mobile/web transport and profile types are in `@canto/shared/squad`. Source publication now atomically advances a domain generation and retires queued events from discarded mirror writes. New policy/column privilege/function fingerprints are checked in addition to the existing snapshot catalog fingerprint. No full refresh or production deployment is claimed by this iteration.

Iteration 2 next: scoped people/order/catalogue reads, reusable cursor contracts, source-specific projections and measured query plans. Foundation coverage is not completion of the remaining 113 proposed RPCs or the full AUTH workflow suite.

## Remaining gates

1. Foundation: live actor/session authorization, private executor, idempotency, revisions/audit/outbox, write ownership/refresh fence, shared contracts.
2. People, catalogue, relationship and media reads with correct scopes and cursor pagination.
3. Pricing/configuration/order lifecycle and quantity/concurrency invariants.
4. Production, job work, dealer stock/back orders, tasks/goals/targets/ratings/reports.
5. Auth/media orchestration, provider webhook ingestion, durable jobs/documents/imports/notifications.
6. Full matrix review, per-persona journeys, real staging integration, measured load/latency and regression/isolation checks.

Foundation infrastructure is verified; broader Auth enrollment/recovery, media changes and cutover rehearsal still have their own workflow gates. Update this journal with evidence as work proceeds.
