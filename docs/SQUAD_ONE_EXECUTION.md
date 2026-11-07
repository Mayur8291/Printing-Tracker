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

## Iteration 2 — shared scoped directory and order reads

Deployed `v1_people_list`, `v1_person_get`, `v1_orders_list`, `v1_order_get` and `v1_dashboard` on staging. Cursor context binds actor, role, factory, filters and source generation. Scope is applied before pagination; order details page their item collection; size quantities are aggregated in a batch. Commercial/factory/worker-cost projections are tested per role. One order-filter implementation feeds lists and summary counts. Customer-name search cannot broaden order scope.

52 local integration tests pass. A real Supabase login through the shared JavaScript client verifies identity, scoped orders, summary totals, directory denial and mirror-write denial. The hosted benchmark uses temporary, rolled-back sessions to test database role policies; it does not substitute for password-login tests for every persona.

- [Staging measured DB execution](squad-one-audit/implementation-evidence/staging-read-performance.json): ten roles; list p95 17.14–75.83 ms, dashboard p95 34.45–57.85 ms, ten warm measured samples per query/role. Below the original 200 ms read target.
- [Synthetic scale check](squad-one-audit/implementation-evidence/synthetic-read-performance.json): 100,012 orders; seven roles; list p95 1.81–21.00 ms, dashboard p95 19.73–21.38 ms. Local PostgreSQL, not a hosted capacity guarantee.
- Security advisors: one new `function_search_path_mutable` warning is reviewed for `filtered_orders`. It is SECURITY INVOKER, private, uses a SQL-standard body parsed/bound at creation, and has no dynamic object lookup. Keeping it inlinable lets cursor/limit and aggregates reach indexed tables. Tests inspect the actual plan for inlining. All definers retain fixed search paths. See [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html).

Source correction: Rails type IDs are ready-made 0/custom 1/mixed 2. PC access includes custom and mixed orders with no dealer-fulfillment owner; including mixed custom work is a deliberate completion of the production scope, while pure ready-made/dealer fulfillment remains excluded. This should be included in the later PC journey review.

This slice is not yet the complete ORDER.01/METRIC.01 workflow: later iterations still add production-specific queues, graph/report projections and domain mutations. Catalogue discovery is also still pending. Seven of the 115 proposed RPC names now have deployed implementations; count alone is not the acceptance gate.

## Iteration 3 — tasks, responsibilities and targets

In progress. Preserve actual source task states (pending/completed/deleted); no separate in-progress task state exists in the approved Rails enum. Archive responsibilities/targets without destroying history. Milestone overlap checks use complete half-open interval overlap, including containment, and serialize by coordinator.

## Remaining gates

1. Foundation: live actor/session authorization, private executor, idempotency, revisions/audit/outbox, write ownership/refresh fence, shared contracts.
2. People, catalogue, relationship and media reads with correct scopes and cursor pagination.
3. Pricing/configuration/order lifecycle and quantity/concurrency invariants.
4. Production, job work, dealer stock/back orders, tasks/goals/targets/ratings/reports.
5. Auth/media orchestration, provider webhook ingestion, durable jobs/documents/imports/notifications.
6. Full matrix review, per-persona journeys, real staging integration, measured load/latency and regression/isolation checks.

Foundation infrastructure is verified; broader Auth enrollment/recovery, media changes and cutover rehearsal still have their own workflow gates. Update this journal with evidence as work proceeds.
