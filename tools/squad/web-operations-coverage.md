# Operations web implementation audit

Reviewed against `docs/squad-one-web/workflow-web-coverage.csv` and approved implementation plan; source baseline Flutter develop `5d55d9461af18b94a867dce07dee7c4b76f1e51f`, Rails `14277820c78e018e62be3da1a14cd8d716cdbf02`.

This is implementation/local verification evidence, **not deployed acceptance**. The plan's acceptance status must not be changed to accepted from these component tests alone.

| Workflow | Web implementation / dependency | Review outcome |
|---|---|---|
| PLAN.01 / JOB.02 | Production item → order-version-bound factory/job-worker assignment | Implemented; PC only, reason, person picker, worker due date |
| PLAN.02 | Bounded criteria editor | Implemented; PC/FM writes; other operational readers see checklist |
| PLAN.03 | Factory item cutter assignment | Implemented; FM, item version, scoped picker and reason |
| PLAN.04 | Factory phase queues; separate Admin read overview | Implemented; bounded 25 rows; new assignment_kind server filter retains ambiguous legacy rows |
| CUT.01–03 | Cutting queue/detail; partial size quantity/date command; order progress rollups | Implemented; CM writes, FM reads; explicit remaining limits and history |
| SEW.01 | Factory item tailor/subtailor allocation | Implemented; per-size cut availability, due/completion dates, item version |
| SEW.02 | WorkHistory assignment/completion tabs | Implemented; 25-row independent cursors; original timestamps, tailor, size, assigned/inspected/picked |
| SEW.03 | Inspection/pickup command | Implemented coupled legacy behavior; see source correction below |
| SEW.04 | Weekly earnings + PDF action | Implemented; Saturday validation, selected tailor/subtailor, optional team; Admin/PC/FM |
| DISPATCH.01–02 | Dispatch queue/detail and partial quantity/date command | Implemented; FM reads, DI/Dealer writes; missing/reconciliation balances fail closed |
| DISPATCH.03 | DI destination editor; Commerce Orders editor for Admin/SC/PC | Implemented across owners; actual command requires destination string enum and order version |
| DISPATCH.04 | Shared Deliveries component in Dealer stock and production/deliveries | Implemented; FM/DI/Dealer, paging/filter, captured vs unavailable historical destination, challan action |
| JOB.01 | Admin capability management | Root Administration ownership; not independently accepted by this lane |
| JOB.03–05 | Job item cost/stage and order due-date editor | Implemented; PC cost/correction, Worker next stage; ambiguity warning blocks writes when both factory and worker exist |
| BACK.01–02 | Dealer bounded demand selection → preview → place → created order | Implemented; exclusion reasons, shortages, no-reservation notice, preview version and atomic command |
| STOCK.01 | Dealer balances; Customer/SC availability in commerce | Dealer implemented; Commerce owns Customer/SC projected availability |
| STOCK.02–03 | Server receipt/consumption side effect visible in command result and refreshed balances | Implemented result evidence; no invented manual receiving command. Dedicated persistent dealer receipt ledger is not exposed by current SDK; Admin reconciliation exposes source receipts |
| STOCK.04 | StockReconciliationPanel in Administration | Implemented and handed to root for tab integration; exact evidence version, safe_action-only dialog/reason, actor scope, history, no arbitrary ledger edits |
| METRIC.01 | Persona home dashboard | Root/UI ownership |
| METRIC.02 | Period work/current backlog report + factory/subject scopes | Implemented; bounded scoped pickers; CM/Worker own scope; authorized operational roles |
| METRIC.03 | Tailor leaderboard + factory filter | Implemented; page cursor, rank and quantities, role-specific money columns |
| METRIC.04 | Nine Admin sales report modes + filters + full-filter CSV | Implemented; exact money, revision/generation-bound cursor walk, 100/page, 25k rows / 16MiB cap, cancellation, uncertain-read resume, no partial download |
| METRIC.05 | SC metrics | Implemented; SC self, Admin/PC chosen subject, commercial fields only when returned |
| DOC.01 | Catalogue selection/company/markup/bank/address/remarks/terms text | Implemented including purpose-bound terms upload; SQL/Edge/component tested, hosted acceptance pending |
| DOC.02 | Native/legacy catalogue history + status/download | Implemented; actor-owned, paged, poll queued/rendering only, strict active-project signed-storage origin/bucket check, missing source file explicit |
| DOC.03–04 | Delivery challan / weekly tailor PDF | Implemented; typed selectors, actor-owned asynchronous generation, status/download |
| DOC.05 | Expired document state | Implemented UI; retention worker remains backend/operator responsibility |

## Verified source correction

Flutter `lib/services/inspector_service.dart:164–211` posts only `completed_quantity` to `inspectors/job_sheet_tailor_mark_done`. Rails `app/controllers/api/v1/inspectors_controller.rb:194–227` records completed quantity and sets picked quantity from it. The old application does **not** offer independent pickup and completion commands. UI preserves this coupling while history displays both values. The plan phrase “independently” should not introduce unrequested inventory behavior.

## Resolved source gap: catalogue terms attachment

Pinned Flutter `lib/ui/views/create_catalogue/catalogue_details/catalogue_details_viewmodel.dart:42,88–91,228` accepts a picked terms file; `lib/services/catalogue_service.dart:93–96` uploads it. The new document request supports `terms_reference`, and document capture verifies ≤5MiB PDF/PNG/JPEG/text. However, media upload targets have no actor-owned document attachment target; shared MediaField requires an existing saved business entity. Reusing an unrelated branding/task/profile record would be incorrect. Migration119 and squad-account documents/attachments routes now supply a narrow owned attachment protocol. TermsAttachmentField reuses the existing write-once PUT/progress helper; server verification enforces MIME, bytes and ≤5MiB. New sa_domain.document_attachments references are actor/generation/capability scoped, immutable after finalization, expire only while unclaimed/unreferenced, and survive asynchronous capture. Text terms still work. Hosted acceptance remains pending.

## Scope and limitations

- CSV is a complete, revision-consistent export within the visible hard cap, not a durable background export. A cap violation rejects the entire download and requires narrower filters; it never silently truncates. Page must remain open. Existing transfer jobs are platform Masters exports and cannot be used to bypass persona report permissions.
- New generated documents retain their server-owned snapshot; provider `sent` is presented as provider acceptance, never proof of inbox delivery.
- Migration `20261108181329_squad_order_assignment_filters.sql` is additive to existing invoker/RLS-backed filtered_orders. Dual legacy assignments appear in both relevant queues and in `ambiguous`; they are not discarded. Existing RPC cursor binds the full filters object. No new grants or roles.
- Hosted staging acceptance across actual actors, negative resource tests, deployed UI review and production promotion remain parent integration work. No hosted mutations or deployments were performed by this lane.

## Local evidence

- `node --test tools/squad/web-operations-model.test.mjs tools/squad/web-operations-export.test.mjs`: 21 passed.
- `node tools/squad/web-operations-browser.mjs`: 15 real React component/browser cases passed, zero browser exceptions; fixture SDK, not hosted acceptance.
- `SQUAD_TEST_DATABASE=squad_test_web_operations tools/canto-sync/.venv/bin/python tools/squad/local_db.py rebuild`: migrations through 116 applied to independent synthetic local DB.
- `SQUAD_TEST_DATABASE=squad_test_web_operations tools/canto-sync/.venv/bin/python tools/squad/web-operations-assignment.test.py`: 5 passed; actual SQL/RLS, role scope, invalid enum, cursor binding, ambiguous legacy membership.
- UI agent reviewed Documents catalogue form at desktop/mobile/dark: no overflow/errors; empty-option treatment corrected after review.

- Attachment119: 16 SQL authority/lifecycle cases + 56 existing document SQL regressions passed. 40 Edge tests passed (attachment route, media verification, account handler, download guards). Local rebuild through119 passed.

## Hosted navigation finding and local correction (121)

The first real Inspector navigation call to `v1_jobsheets_list` returned HTTP500 after about8.2s. The UI called the correct role-scoped contract. Source inspection and synthetic EXPLAIN showed that the global descending history scan called `can_item` for every unrelated factory row; an empty factory exceeded30s on100,000 rows. Merely adding a relational `IN` did not change that expensive RLS-before-join plan.

`20261108184439_squad_scoped_jobsheet_queue.sql` introduces a private, actor-checked candidate-ID helper using existing `sa_guard` grants. It verifies assignment, tailor-parent, and date-parent item scope, returns at most page size+1 IDs, then uses the original executor projection and unchanged RLS. No table policy, client grant, response shape, or cursor contract changes. The item/keyset composite index supports sparse scopes.

`web-operations-queue.test.py JobsheetQueue`:9 tests passed (all permitted roles, foreign filters, actor/filter-bound cursor, malformed parents, private helper denial and scale).43 existing production execution tests also passed. Isolated synthetic benchmark,1,000 items /100,000 history rows: dense first68ms, next67ms, item+tailor125ms, empty factory7ms, sparse older history16ms, broad PC28ms. These are local observations, not hosted latency guarantees. Hosted release/retest remains parent-owned.

## Browser document output harness

`test_web_document_outputs_hosted.py` now composes the real commerce, operations and reporting browser journeys, then binds the requested weekly/challan IDs to their immutable browser-command audits. Its second phase uses the existing exact two-job rehearsal capability, tests queued-to-ready polling, private download grants and original PDF bytes, extracts content, and prepares private Poppler rasters for visual review. It preserves private reports before cleanup and uses the existing lease/provenance-aware recovery; it does not run account closure, a generic worker, email or external providers.

Local verification: 12 original output recovery regressions, 2 actual SQL browser binding/worker/cleanup cases, 4 harness report/credential-redaction boundary cases and 6 download-grant cases passed. This harness has **not** been run hosted by this lane. Catalogue terms output has a separate reviewed-design prerequisite, documented in `web-catalogue-terms-acceptance-design.md`; the current two-job capability intentionally excludes catalogue.

## Current item views and source control review (129)

Pinned Flutter develop `5d55d9461af18b94a867dce07dee7c4b76f1e51f` retains two distinct current work views: `tailor_details_viewmodel.dart:78–188` filters the selected tailor's assignment completion, while `factory_inspector_jobsheet_viewmodel.dart` filters the whole item's inspected completion. Pinned Rails `14277820c78e018e62be3da1a14cd8d716cdbf02` `factory_managers_controller.rb:353–380` confirms distinct items and selected tailor link status. Assignment and completion event ledgers remain independent and unchanged.

Migration129 adds a bounded current-item RPC with exact existing item/person visibility, positive identifier filters, optional item/order search, stable item-ID seek and actor/filter/generation cursor binding. Its private helper is unavailable to client, authenticated, anonymous and service roles. Duplicate legacy tailor links are visibly marked for reconciliation. `TailorWorkPanel` and the Inspector equivalent share this component, retaining Pending/Completed and item search. **Currently offgraph while the parent completes prefix126 hosted acceptance; mounting and hosted129 acceptance remain pending.**

Eight local SQL cases pass: source status distinctions, unique items across repeated assignment events, all allowed-role scopes, foreign and malformed relationships, private helper denial, filters/cursor/generation, duplicate legacy links and realistic scale. Synthetic25k orders/50k items measured12–21ms for dense Inspector/tailor, exact item, foreign empty and sparse factory pages. Three offline SDK checks and16 fixture-backed browser interactions pass, including status/search changes resetting pagination. These are local measurements, not hosted latency guarantees.

The leaderboard now defaults to Today in Asia/Kolkata, matching the pinned source; explicit date ranges remain available. India midnight/leap/year-boundary tests pass.

## Prepared PDF sharing control

Pinned Flutter `delivery_challan_viewmodel.dart:57` and `tailor_details_viewmodel.dart:250` open `PdfView(allowToShare:true)`. `PdfShareDialog` now prepares actual PDF bytes using a fresh authorized document/media grant from the current environment, pins the private storage origin/path, rejects redirects/oversize/non-PDF responses and supports native file sharing from a separate user gesture. Desktop receives a file download fallback. There is no shared temporary URL payload. The25MB limit is explicit, requests cancel on context changes, and object URLs are revoked on close. Five offline model cases pass. **The dialog is currently offgraph during the hosted acceptance freeze; integration and real browser share/download acceptance remain pending.**
