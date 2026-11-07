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

Implemented slice; broader journey gates remain. Preserve actual source task states (pending/completed/deleted); no separate in-progress task state exists in the approved Rails enum. Archive responsibilities/targets without destroying history. Milestone overlap checks use complete half-open interval overlap, including containment, and serialize by coordinator.

Deployed eight task/responsibility contracts and four target contracts on staging. The suite now passes 83 local tests. Hosted rollback-only command tests verify admin assignment → assignee completion for tasks and goals, coordinator-scoped target progress, and containing-period rejection; test rows and temporary sessions are rolled back and all advanced sequence values restored while holding the refresh/write lock.

Responsibilities include Team role 12 with live feature gating. Removed task assignees lose access immediately; recipient change IDs are retained in the transactional event. Archives retain business rows and are bound to the source generation. Target totals are derived from current scoped orders, excluding canceled/archived orders; per-target periods use inclusive Kolkata calendar dates with an exclusive following-day boundary. Year-to-date totals use the actual business year rather than adding overlapping cached totals.

Review fixes added two regression cases: Admin edits preserve the original task creator's membership rule, and timestamp responses/command execution use explicit UTC. This is an API timestamp contract; final historical report comparison must still confirm legacy server/storage timezone behavior, since Rails specifies Kolkata and `default_timezone=:local`.

The shared JavaScript SDK and declarations now cover all 19 deployed RPC names; mobile TypeScript checking passes. Notification delivery, calendar/report parity against approved historical examples and a broader mixed-write load test remain later acceptance gates. These are not represented as complete by the local business-operation tests.

## Iteration 4 — catalogue contracts and authoritative pricing

Ten more RPC contracts deployed on staging (29 proposed names now implemented). Catalogue reads apply live capability flags, dealer brand assignments, per-user private colours, active compatibility links and scoped customer pricing. The approved legacy rule allowing dealers with no brand assignments to browse all brands is preserved; order fulfillment will separately enforce routing. Catalogue product/class/variant pages preserve sort positions with stable composite cursors. Large compatibility collections are separate paginated selectors.

Custom and ready-made quotes share one NUMERIC calculation engine. Fixtures cover the quantity 5/6 sample threshold, quantity-band boundaries, METER/KG and adult/kids consumption, add-on costs, overhead/profit, print/embroidery, per-unit tax rounding and the exact 999 legacy threshold. Ready-made prices use the SKU-price join table, live zone/direct/assigned price context and Regular fallback. Explicit SKU tax rates (including zero) are preserved. Branding enters the taxable base. Samples retain their separate sample/size-plan structure. Prices and tax policy are versioned compatibility behavior, not a claim of current tax compliance.

Quote previews persist only private, expiring operational quote records; they do not change the source-mirror edit revision. Customer/address scope and canonical configuration are checked on the server. Catalogue markups affect document display prices only. Order placement must still revalidate the saved quote against current masters and ownership; preview creation is not order acceptance.

142 local database integration tests pass. Hosted shared-SDK tests confirm actual Supabase login, catalogue pagination, configuration reads and cost redaction. Hosted custom/RMP/mixed quote checks roll back all temporary sessions and quote-cache rows. Mobile TypeScript checking passes. Security advisor re-scan found no additional domain findings beyond the reviewed `filtered_orders` warning from iteration 2.

Performance review initially failed: catalogue p95 was 245–409 ms. The follow-up migration batches media metadata and eligible SKU prices once per page, and computes projection capability once per request. The same warm staging benchmark now passes:

- [Catalogue evidence](squad-one-audit/implementation-evidence/staging-catalogue-performance.json): four personas, lists/configuration/variants, p95 18.10–56.11 ms (200 ms target).
- [Pricing evidence](squad-one-audit/implementation-evidence/staging-pricing-performance.json): RMP 56.77 ms, custom 77.12 ms, mixed 87.02 ms p95 (400 ms target).

These are bounded representative DB calls, not a concurrent load/capacity guarantee. Warehouse availability remains explicitly `not_loaded`, never fabricated zero. Resource-authorized media delivery, SVG/preview asset contracts, preset persistence, quote override, order acceptance/revalidation, full historical sample-order comparison and maximum-size mixed-load tests remain pending. The catalogue workflow rows are not marked wholly accepted just because their RPC names exist.

Next: iteration 5 implements canonical presets and artwork ownership, then quote override and the transactional order lifecycle.

## Iteration 5 — canonical presets, private colours and quote overrides

Staging now has 33 of the original 115 proposed RPC names, plus `v1_color_save`. The extra contract implements the already-audited legacy `products#add_color` action under CONFIG.01; it is not a new feature or Edge deployment. Preset create/reuse/list/rename, private colour creation, SVG preview layer metadata and SC price overrides use the same role, revision, idempotency and refresh fences.

175 local integration tests pass, including simultaneous different-key requests for one owner/configuration producing exactly one preset. Canonical matching excludes names/comments/artwork and retains source colour-link distinctions. Deduplication is owner-scoped: it never shares another user's reference art or comments. Existing presets are found even without the operational fingerprint cache. Source `custom_products` contains an always-truthy Ruby role branch; the new explicit scope is owner or accessible order (Admin oversight), rather than reproducing that defect. SC renames additionally require visibility; customers cannot rename even their own preset.

Private colours use six-digit hex values and eligible fabric/part/add-on links, stay private in selectors, and reuse a matching accessible target colour. Preview metadata includes offsets and size ratios with media descriptors, not arbitrary source URLs. New artwork upload/attachment and authorized file delivery remain in the media orchestration gate.

SC quote overrides retain canonical prices, require a reason and exact version, recompute tax/order totals, and reject changed masters, expired quotes, foreign quotes or old source generations. Repeating the same command returns the original result and creates one audit event. Pricing requests now have an aggregate 500-selection work budget. Sample sizing and full historical financial acceptance still remain part of the later order journey review.

Hosted rollback-only checks passed for private colour → configure → reuse → rename → quote → override → exact retry. All temporary records/sessions were rolled back and all advanced sequences restored under the refresh/write lock. Staging fingerprints were updated through the checked deployment tool; Printing Tracker public structure remains unchanged. Shared mobile/web SDK declarations cover the added contracts and mobile typechecking passes.

Next: transactional order acceptance, quote/preset revalidation, dealer-brand splitting and lifecycle operations. The remaining stock/media/provider/notification gates still prevent calling the backend complete.

## Iteration 6 — transactional order acceptance and scoped artwork

Staging now has 35 of the original 115 RPC names, plus `v1_color_save`. `v1_order_place` revalidates the saved quote, customer/address eligibility, current commercial rules, exact visible preset configuration and selected artwork revisions. Quote acceptance is single-use even across different idempotency keys; exact retries return the original set of orders. Customer and design locks serialize acceptance against related commands. New design metadata has independent ownership, and order artwork copies reuse authorized media references in the same environment. File upload/delivery orchestration remains a later gate.

Pure ready-made orders split by eligible linked dealer/authorized brand and return every child. Custom/mixed routing remains one order. Server totals include branding; largest-remainder cent allocation reconciles child totals and partial payments without overpaying small children. Only SC can record payment. Ready-made size IDs are translated by trusted size name into the separate legacy size table. Sample quantities retain the bulk plan in extra quantities. Accepted pricing and delivery are retained as immutable operational receipts.

209 local tests pass, including 34 new order/design cases and simultaneous different-key acceptance of the same quote. The hosted configure → override → partial-payment order → exact retry → detail journey passes; all test records/sessions roll back and all advanced sequences are restored under the refresh/write lock. [Measured order acceptance](squad-one-audit/implementation-evidence/staging-order-acceptance-performance.json) records ten warm DB samples below the 500 ms command target. This representative single-line test is not maximum-size or concurrent-load acceptance. Mobile declarations/checks pass. Security advisors report no new domain finding beyond the previously reviewed `filtered_orders` warning.

Order integration is truthfully returned as `queued`; this iteration does not claim successful warehouse reservation, notifications or provider delivery. Order editing/cancellation, production execution, detailed item/history projections, private-colour historical reorder compatibility, and full journey/load review remain open.

## Iteration 7 — lifecycle commands and measured authorization performance

Staging now has 40 of the original RPC names, plus `v1_color_save`. Added scoped priority/due changes, SC payment settlement, Admin force-completion and cancellation/soft-delete requests. Cancellation preserves item/history records and cannot be reclassified as completion by the legacy force flag. Force completion records an explicit exception without fabricating production quantities. Closed/partially dispatched orders, cross-scope callers and invalid payment amounts are rejected. Mixed-order completion requires both custom dispatch and external completion; aggregate progress reads all relevant items even for a narrower cutting-master view.

External cancellation is durably queued and shown in order detail; the order is held against new work until reconciliation. It is not reported as canceled before provider acknowledgment. The provider consumer remains an open implementation gate. Refresh publication retires discarded-generation requests along with their outbox events.

236 local integration tests pass. Hosted rollback-only checks pass for order placement, priority/due changes, final payment with exact retry, cancellation and retained item visibility. Actual GoTrue login and the shared SDK's read/denial checks also pass. Mobile typing passes. No new domain security-advisor findings beyond the previously reviewed query helper.

Review caught a performance regression at 512 ms p95 against the 500 ms command budget. The live actor lookup joined a SETOF Auth bridge with a default estimate of 1,000 rows despite a maximum of one, repeatedly scanning identity/user rows. The follow-up migration states that cardinality and performs an explicit indexed identity lookup. It retains live session, mapping, email, role and approval validation on every call. The same representative command now measures **218.323 ms p95**; profiling before/after is in `implementation-evidence/staging-command-profile*.json`. Rechecked hosted order-list p95 is 10.91–46.41 ms and dashboards 29.91–37.36 ms across ten personas. Maximum-size orders and concurrent capacity remain pending; these measurements do not close the overall performance gate.

Next: production allocation/checklists and job-worker controls, followed by cutting, sewing and dispatch histories. Order editing/provider reconciliation, richer detail/media contracts and the remaining matrix modules are still outstanding.

## Iteration 8 — allocation, factory relationships and production queues

Staging now implements 49 of the original 115 RPC names, plus `v1_color_save`. Added factory/job-worker assignment, cutter assignment, checklist updates, worker cost/stage/due controls, factory queues and production progress. Reassignments reject existing work or agreed costs; they clear obsolete cutter authority. Worker due changes preserve the assignment baseline rather than accumulating differences. Completion through job-worker stages does not fabricate factory quantity history.

The hosted role journey revealed an important legacy relationship: factory staff normally inherit their factory through `factory_manager_id`, not their own `factory_id`. Fixed live actor/scope resolution and realistic fixtures, including revoked manager links, stale direct factory fields and sub-tailor parent validation. Source inspection found two historical dual factory/worker assignments and zero active dual assignments; new commands enforce a single production owner.

274 local integration tests pass. Hosted rollback-only checks pass through SC order placement → PC factory assignment → FM cutter/checklist → CM progress → PC worker assignment/cost → JW due change and all stages. Test records/sessions roll back and advanced sequences are restored. Refresh transformation tests and existing admin/refresh isolation checks also pass. Mobile typing passes. No new domain security-advisor findings beyond the previously reviewed inlinable order helper.

Queue performance initially failed at PC 520.10 ms p95 and FM 166.05 ms. The reviewed bounded private projection removes repeated permission scans and excludes commercial fields. The same measured queue now records **13.25 ms PC / 5.19 ms FM p95**. Imported tables had no recorded ANALYZE statistics; analyzed all 86 snapshot tables (18.82 seconds, no business DML) and added statistics maintenance to future refresh publication. Rechecked ten-role orders measured 10.81–51.17 ms and dashboards 30.99–41.10 ms p95, with result counts recorded. These remain warm DB measurements, not end-to-end or concurrency capacity guarantees.

Provider consumers, cutting/sewing/dispatch history, detailed media contracts, the full refresh rehearsal and remaining workflow matrix gates are still open. Next: quantity execution and append-only production histories.

## Iteration 9 — factory execution and conserved histories

Staging now implements 59 of the original 115 RPC names, plus `v1_color_save`. Added cutting records/queue/detail, job-sheet allocation and inspection, tailor work/history, and factory dispatch records/queue/detail. Commands lock the order before the item and its quantities, require exact versions, retain immutable work history and return exact idempotent retries. Size-level capacity is conserved: ordered ≥ cut ≥ assigned ≥ inspected/picked ≥ dispatched. Imported history/counter discrepancies require explicit reconciliation; they are not silently repaired while recording new work. FIFO inspection attribution updates derived completion balances without rewriting original allocations. Sample execution uses actual sample quantities and preserves the bulk plan.

Source review clarified that inspector completion and picked-up quantity are the same stored legacy measure, not two independent counters. Both API labels refer to that measure. Assignment coverage is separately exposed from completed tailoring. The original plan's wording about independently validating picked and completed counts is superseded by this verified source behavior.

318 local integration tests pass, including racing cut commands, atomic rejection of a bad second size, wrong-factory/revoked-manager denial, duplicate retries, negative/over-capacity values, capped inputs, FIFO history, pagination and full/sample completion. The real staging journey passes SC placement → PC assignment → FM cutter/checklist → CM cutting → FM tailor allocation → Inspector pickup → DI dispatch. Every business row/session is rolled back and every advanced sequence restored. Shared SDK typing passes.

Performance review required two targeted corrections. The original history-policy graph repeatedly expanded parent RLS sets and cutting measured 1,971.322 ms p95. Private read-only helpers now compute permitted record sets once per statement. An insert-returning regression was caught locally and corrected by scoping new items through their parent order. Explicit role-specific query branches then removed broad generic-plan scans. Final representative staging DB p95: cutting **107.676 ms**, allocation **86.125 ms**, inspection **175.303 ms**, dispatch **159.282 ms**; six list/detail projections **7.297–22.415 ms**. Evidence and the initial profile are retained under `implementation-evidence`. These are warm bounded DB calls, not concurrent capacity or maximum-batch guarantees.

Final regression checks: hosted order lists, dashboards and order details pass across ten personas; the largest measured p95 is 110.75 ms for Admin order detail. Actual GoTrue login and shared SDK checks pass. The security advisor has no new domain finding beyond the reviewed `filtered_orders` helper.

This slice does not yet complete every SEW/DISPATCH workflow: dealer stock consumption, destinations/delivery lists, payroll, documents and external consumers remain separate implementation gates. No production changes were made. Next: dealer stock/back orders and the remaining delivery contracts.

## Remaining gates

1. Foundation: live actor/session authorization, private executor, idempotency, revisions/audit/outbox, write ownership/refresh fence, shared contracts.
2. People, catalogue, relationship and media reads with correct scopes and cursor pagination.
3. Pricing/configuration/order lifecycle and quantity/concurrency invariants.
4. Production, job work, dealer stock/back orders, tasks/goals/targets/ratings/reports.
5. Auth/media orchestration, provider webhook ingestion, durable jobs/documents/imports/notifications.
6. Full matrix review, per-persona journeys, real staging integration, measured load/latency and regression/isolation checks.

Foundation infrastructure is verified; broader Auth enrollment/recovery, media changes and cutover rehearsal still have their own workflow gates. Update this journal with evidence as work proceeds.
