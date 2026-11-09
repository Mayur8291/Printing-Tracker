# Squad One: complete persona web application

Prepared 8 November 2026. **This deliverable is a plan; it changes no application code or hosted configuration.** The user requested a detailed plan before building. Existing backend implementation and its separate release evidence remain valid within their stated scope.

## 1. Intended result

Build the complete Squad One application inside the existing Printing Tracker React/Vercel application and monorepo. A person signs in with their own account, reaches the appropriate persona workspace, sees the same authorized business information, and performs the retained workflows of the approved Flutter application. The web application becomes the first complete client for the Supabase backend and the primary surface for browser automation and human acceptance.

This is a functional application, not an administrator impersonating other roles, a collection of demo dashboards, or a thin read-only database browser. Its commercial, production, workforce, dealer, collaboration, reporting, file and account journeys must connect end to end. Existing Printing Tracker users and operations continue working.

The initial implementation remains web-only. Keep the Expo scaffold and framework-neutral shared SDK available for later mobile work, but do not spend this phase on React Native screens, app-store packaging, native push certification, or a new backend/schema redesign. Preserve the current visual language: navigation, typography, spacing, cards, forms, dialogs, tables, badges and light/dark treatment.

**Completion means:** every retained audited workflow and source-discovered variation has a web disposition and verified user-visible outcome; all eleven supported login personas work; managed Tailor/SubTailor workflows work; cross-persona journeys pass; the existing tracker is protected; remaining external dependencies are explicitly distinguished from accepted features. Full provider-dependent acceptance cannot be claimed while its required provider test is deferred.

## 2. Baseline and traceability

| Area | Evidence and decision |
|---|---|
| Flutter behavior | Approved local develop commit `5d55d9461af18b94a867dce07dee7c4b76f1e51f`. Read that commit through `git show` or a separate read-only worktree. The ordinary local checkout is older `eef6bffd`; do not use it accidentally. |
| Scope | 115 workflow rows in 28 shared capability families; 68 rows serve multiple personas. Source audit classified 1,458 files, including 317 Flutter view/view-model/tab files. These are not counts of independent screens. |
| Roles | 13 stored roles; 11 established login dashboards; Tailor and SubTailor are managed workforce subjects. No invented CustomerCoordinator role based on Flutter enum position. |
| Backend | Saved hosted parity evidence shows matching application artifacts through migration 113 (`20261108154028`). The managed `pg_net` patch difference is documented and tested; platform upgrade is not a prerequisite. |
| Monorepo | Existing npm workspaces: `apps/admin`, `apps/mobile`, `packages/shared`. React 18/Vite/Radix/shadcn/Tailwind already provides the web foundation. |
| Shared API | `packages/shared/squad.js` and `squad.d.ts`: framework-neutral RPC/Edge transport, typed contracts, errors, versions, cursors and command keys. |
| Existing web work | Retain Masters, media, Data Refresh and Customers/Reports work. Dashboard commit `34f2073` passed final staging acceptance (18 checks), including reports and the 13,201-row CSV export; cleanup is complete. The former timeout gate is resolved for the tested scope. Publication/live deployment verification remains separate; coordinate the baseline. |
| Existing evidence | Eleven real Auth persona login/read/session checks and 34-group/437-RPC business composition are reusable backend evidence. They do not replace browser acceptance. |
| Ownership | Both projects remain source mirrors with `cutover=false`; ordinary persona business writes are fenced. Define writable testing separately in section 6. |

The original matrix remains the business-scope authority. This plan adds presentation and acceptance mappings without inventing a second permission model:

- [All 115 workflow-to-web mappings](squad-one-web/workflow-web-coverage.csv): route/action family, shared component, persona reuse, conditional grants, backend contract, invariants, source references and web acceptance ID.
- [Persona coverage](squad-one-web/persona-web-coverage.csv): all stored roles, exact original workflow IDs, conditional IDs, managed-subject IDs and proposed landing.
- [Coverage validation](squad-one-web/coverage-validation.json): no missing workflow or capability mapping. All new web rows remain `planned_not_accepted`.
- [Source-discovered web variations](squad-one-web/source-discovered-web-gaps.csv): required additions or corrections to the original scope mapping, with separate evidence and acceptance. The current review found one customer account-closure variation; it is not counted as an already implemented workflow.
- [Original detailed functionality matrix](squad-one-audit/FUNCTIONALITY_MATRIX.md), [source view inventory](squad-one-audit/flutter-views.csv), [backend acceptance scenarios](squad-one-audit/ACCEPTANCE.md).

The web mapping has 102 browser-facing workflow rows, six background-result/status rows, four derived-state rows, one separately guarded ownership operation, and two explicit exclusions/retirements. **102 browser-facing rows do not mean 102 new pages.** Several share one screen, existing staff tools, or a common control.

For each workflow, preserve source evidence and track: designed → built → contract-tested → hosted-browser-passed → human-UAT-passed, plus provider-verified where applicable. Record failures and explicit exclusions separately. A green total test count must never hide an unmapped workflow or an untested role variation.

The frontend review must inspect the visible actions, dialogs, drawer entries and client behavior of the 317 pinned view-related files, not only the backend-oriented 115-row matrix. Validate every reachable control against a retained workflow or an explicit delta/retirement. Do this once as the baseline frontend audit and keep the ledger updated when a concrete omission is discovered; do not restart the entire audit each iteration.

**Required gap WEB-GAP-01 — customer self-service account closure:** Flutter develop exposes a Customer-only Delete Account action in `drawer_view.dart`, calls `DeleteAccountWidget`, then `CustomerService.deleteCustomer(self)` and returns to login. The current backend administrator account-status and person-archive operations reject self-targeting. Wave 1 must review the exact legacy `delete_account` semantics and provide a narrowly scoped self-account closure flow, including appropriate reauthentication/confirmation, preservation of historical business references, session revocation, retry behavior and ownership fencing. Add browser and API tests for self versus foreign accounts and post-closure login denial. Do not expose administrator deletion to customers or silently remove the old customer action from scope.

## 3. Persona experiences

Every supported persona lands at `/squad/home`; server-resolved identity and capabilities select its dashboard composition. Routes such as orders and people are shared. There is no user-selectable privilege-changing persona dropdown.

| Persona / stored ID | Landing focus | Main available workspaces and distinguishing behavior |
|---|---|---|
| Admin / 0 | Approvals, organizational overview and exceptions | Customers/dealers, SC/PC/staff management, feature grants, catalogue, orders, responsibilities, targets, reports, promotions and permitted operations. Customer approval and force-completion require explicit reasons/state checks. This is not automatically Printing Tracker administration. |
| Sales Coordinator / 1 | Assigned orders, customers and sales progress | Assigned customers/distributors, products/configurator, quotes, custom/RMP/mixed ordering, permitted order edits, price overrides, manual payment records, tasks/goals/milestones, documents and feedback. Cannot operate another SC's scope. |
| Production Coordinator / 2 | Orders awaiting allocation/criteria and active production | Factories, workers, operational contacts, factory or worker allocation, criteria, costs/due dates, progress, work reports, tasks and goals. Preserve allowed selling amounts while withholding payment details; money is not one universal permission. |
| Customer / 3 | Product discovery and own order progress | Catalogue/configuration, quotes/orders, own history, addresses/profile, catalogue PDFs, promotions, feedback and eligible coordinator-change request. Pending confirmation, approval and onboarding are separate states. |
| Factory Manager / 4 | Own-factory workload and outstanding stages | Factory orders, cutter assignment, tailor/team management, job-sheet allocation, criteria, inspection visibility, dispatch/deliveries, tasks, work/earnings reports. All records remain factory-scoped. |
| Dispatch Incharge / 7 | Own-factory dispatchable work | Dispatch queue, destination selection, repeated partial dispatch, deliveries/challans, permitted tailor/work visibility. Display remaining quantities and reject over-dispatch. |
| Inspector / 8 | Job sheets awaiting inspection/pickup | Own-factory job sheets, tailor views, inspection/completion and picked quantities, work history and relevant metrics. The original completion command records pieces picked from the tailor; preserve that coupled behavior. |
| Cutting Master / 9 | Assigned cutting work | In-progress/completed queues, size/sample cutting, partial runs, remaining balances and history. No unauthorized pricing or other cutter's work. |
| Dealer / 10 | Customer demand, purchase orders and stock | Keep customer “Placed Orders” separate from dealer “My Orders”; linked customer management, own purchases, stock, shortage/backorders, receipt/dispatch, catalogue, documents and promotions. Display quantity rules must not alter physical stock accounting. |
| Job Worker / 11 | Assigned external work and deadlines | Assigned orders and six-stage progress, due-date reason/history, authorized worker cost; optional products, catalogue, tasks, goals and promotions according to independent live grants. Product access does not imply order-placement rights. |
| Assistant Worker / Team / 12 | Granted tasks, goals or product work | Compose only granted modules. An all-grants-off state still offers profile/account/logout and a clear access message. Do not invent order/stock administration or global order KPIs. |
| Tailor / 5 | Managed workforce detail | Parent/team assignments, partial work, earnings and rankings appear through authorized managers/inspectors. No new standalone login is implied by preserving the old app. |
| SubTailor / 6 | Managed team-member detail | Parent membership, quantities, historical attribution and archive behavior. No fabricated credentials. |
| Printing Tracker staff/admin | Existing tracker workspace | Preserve current staff membership, operational pages, Masters and Data Refresh. A shared appearance does not confer access to Squad or vice versa. |

Universal account/profile/media/in-app-notification behavior is shared where supported. Job Worker/Team grants preserve the old parent/child rules: notes `1`, responsibilities/goals `2`, product parent `3`, catalogue/markup `3.2`, custom configuration/cost breakdown `3.3`, promotional assets `3.4`. The backend remains authoritative for actual eligibility.

Tailor/SubTailor standalone logins would be a new product requirement. They are not included by silently turning managed records into accounts.

## 4. Minimal frontend architecture

### One deployment, two correctly authorized application branches

The existing `apps/admin/src/App.jsx` is approximately 8,500 lines and assumes every authenticated account belongs to Printing Tracker. Its profile path reads and can create `public.profiles` entries. Migrated Squad identities use Auth role `sa_app` and intentionally cannot access those tracker tables.

Introduce the application gateway **before mounting that existing App**:

```text
Shared sign-in / account routes
             ↓
Session resolution + live identity/capabilities
             ↓
       Explicit principal branch
       ├─ Tracker membership → existing TrackerApp
       └─ Squad identity     → SquadShell → persona-composed home and shared features
```

1. Resolve the environment once for the active deployment/session.
2. Establish the normal Supabase session. Authenticate real credentials; never guess persona from email or trust editable user metadata.
3. Squad session calls `v1_me`; use its live identity, business state and capabilities for navigation and presentation. Revalidate on token refresh, foreground/focus and relevant authorization failures. On identity/capability changes, unmount newly forbidden routes and invalidate actor-scoped queries, drafts and media state. Disabled, deleted, unmapped, pending or revoked users receive the corresponding authorized state.
4. Tracker sessions follow the existing explicit staff-membership path. Do not auto-create a tracker viewer profile for a Squad user.
5. Preserve authorized requested deep links; otherwise route to the correct home. Unauthorized URLs produce a clear denial with a safe destination.
6. Route each principal to its existing authority lane. A single session cannot be assumed to hold both the Squad `sa_app` and Tracker `authenticated` authority. Do not add a cross-workspace privilege switch in this phase; genuinely dual membership would require an explicit backend design. Local storage or a persona dropdown must never exchange roles.

Proposed structure:

```text
apps/admin/src/
  application/           AppRoot, SessionBoundary, identity resolution, account routing
  components/ui/         existing design-system primitives
  components/layout/     shared visual shell
  squad/
    session/             live identity, capabilities, environment and write state
    navigation/          route and capability registry, persona home composition
    data/                shared SDK hooks, query keys, commands, error mapping
    components/          list/detail patterns, quantity grid, files, jobs, conflicts
    features/
      people/ catalogue/ orders/ production/ jobWork/ stock/
      work/ reports/ documents/ promotions/ notifications/ administration/
  [existing tracker features, retained]
packages/shared/         pure SDK, types, validation/format contracts usable by future mobile
```

Keep web components in the web application. Share business transport/contracts with future mobile; do not attempt to share DOM components with React Native now. Add only missing SDK operations or contract types; do not duplicate working RPCs or build another service per persona.

### Routing, server state and component reuse

Introduce a small, version-pinned browser router compatible with the current React installation. Use React Router in the existing Vite application rather than changing frameworks. No router version is assumed from this plan; resolve compatibility and pin the selected version during the foundation slice. Its declarative integration supports the existing application model. [Official routing integration](https://reactrouter.com/start/declarative/installation).

Use one TanStack Query adapter for new Squad server state; migrate existing tracker hooks only where necessary. Keys must include environment, principal, capability/scope revision where available, resource, normalized filters, pagination and relevant data generation. Use explicit invalidation on commands and generation changes. [Query-key dependency guidance](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys).

Keep the current tracker URLs and special `#/picklist-preview` entry working. Add and test Vercel SPA deep-link handling for `/squad/*` and account routes without intercepting `/api/*`, static assets, auth callbacks or the existing picklist path. Verify direct navigation, refresh, browser back/forward and links from notifications.

Reuse `DashboardShell`, sidebar presentation, UI primitives, field/error patterns, tables/filters, toasts, media controls and the visual parts of `ScottListPage`. Reuse existing report/customer presentation where suitable. Their staff-specific data adapters and authorization assumptions are **not** persona permissions; persona reports call their scoped Squad contracts.

Build a small set of shared screen patterns:

- `ResourceList`: server search/filter/sort/pagination, loading/empty/error and selection.
- `ResourceDetail`: summary, authorized tabs, history, files and related records.
- `CommandDialog`: validation, expected version, stable idempotency key, submit/error/conflict/result.
- `QuantityGrid`: size/tailor/team quantities with remaining/allocated/completed/picked/dispatch balances.
- `OrderWorkspace`: common detail and timeline with authorized commercial/production actions.
- `DocumentJob`: queued/running/failed/ready/expired status, retry and secure result access.
- `MediaField/Viewer`: upload/finalize/attach, replace/detach, preview/download and missing-file states.
- `MetricCard/ReportWorkspace`: scoped summaries, dates, charts, tables and bounded exports.

Keep domain forms explicit. A configurator, stock reconciliation and a partial dispatch should not be forced into a generic editable-table engine.

## 5. Shared functionality and required screens

Exact role names and reuse counts are generated in the coverage CSVs and retained in the original master-capability registry. The table below defines composition, not broader authority.

| Shared family | Web deliverable and important variations | Personas using it* | Wave |
|---|---|---:|---:|
| AUTH | One login/session/account flow; signup, confirmation, recovery, invitation, profile and status handling | 11 | 1 |
| PEOPLE | Scoped directories/details, person forms, addresses, factories/team and managed tailors | 9 | 2 |
| LINK | Customer approval, dealer/SC assignment, direct-deal changes, coordinator requests and commercial rules | 4 | 2 |
| CAT | Custom/RMP catalogue, search, variants, authorized prices and availability | 7 | 3 |
| CONFIG | Fabric/color/parts/add-ons, SVG/artwork preview, branding, presets, sizes/samples/bulk quantities | 6 | 3 |
| PRICE | Server quotes/breakdowns, permitted overrides and document markup | 6 | 3 |
| ORDER | Common list/detail/history, custom/RMP/mixed placement, edits, cancel, due date, prime, payment and exception close | 7 | 3 |
| PLAN | Factory/worker selection, readiness criteria, cutter allocation and production queues | 2 | 4 |
| CUT | Assigned work, partial size recording, completion/history and rollups | 3 | 4 |
| SEW | Tailor/team allocation, job sheets, inspection/pickup and earnings | 5 | 4 |
| DISPATCH | Queue, destination, partial quantities, delivery history and challans | 6 | 4 |
| JOB | Worker assignment/costs, six stages, due-date requests and configurable worker access | 3 | 4 |
| STOCK | Authorized stock, receipt/consumption visibility and reconciliation | 4 | 5 |
| BACK | Shortage preview, aggregation, back-order placement and linked demand | 1 | 5 |
| TASK | Tasks/notes, assignees, deadlines, order context and state transitions | 6 | 6 |
| GOAL | Responsibilities, goals, assignment/completion/archive with subject-specific authority | 5 | 6 |
| TARGET | SC milestones, current/past/YTD progress and recalculation outcome | 2 | 6 |
| RATE | Scoped feedback, actor/target rules, edit/withdraw/moderation and averages | 7 | 6 |
| METRIC | Persona homes, work metrics, tailor leaderboard, sales/coordinator reporting | 10 | 1+7 |
| DOC | Catalogue builder/history; delivery and weekly work PDFs; progress/secure downloads | 9 | 7 |
| PROMO | Categories, banners, media preview, download and browser share | 7 | 7 |
| MEDIA | One authorized file lifecycle across forms, products, orders, profiles and documents | 11 | 1+7 |
| NOTIFY | In-app inbox, live authorized destination, read/history/device behavior supported by backend | 11 | 1+7 |
| MASTER | Reuse existing staff Masters; expose Squad settings only through granted contracts | 1 plus staff lane | 8 |
| INTEGRATE | Warehouse/transfer status, reconciliation, CSV imports and visible provider problems | 1 plus workers | 8 |
| REFRESH | Existing platform-admin refresh/reconciliation; separate guarded ownership operation | Platform lane | 8 |
| APP | Shell, capability navigation, preferences, route recovery, loading/offline states, payment instructions | 11 | 1 |
| OPS | Job progress/audit/retry and schedule results; execution stays backend-side | 1 plus workers | 8 |

\* Counts include conditional grants from the original audited plan, not a blanket entitlement or accepted-screen count.

Every list/detail/form must include validation, pending state, no-data state, error/retry, server-denied state and stale-data behavior as relevant. Do not hide failed server requests behind an empty table or show success before a durable response.

Specific domain requirements that generic CRUD would miss:

- **Configurator:** reproduce compatible selection rules, units, sample and size matrices, canonical preset reuse and branding/artwork behavior. Sanitize legacy SVG and uploaded previews. Server quotes decide price; UI preview arithmetic never becomes accounting authority. Quote preview must work outside order creation for Admin and conditionally entitled Job Worker/Team users; show checkout only when the actor has separate order-placement authority.
- **Orders:** preserve custom/RMP/mixed behavior and server-defined grouping/child-order results. Show accepted quote provenance, separate production stages, amendment/provider state, payment evidence and immutable history. Opening a QR/instruction does not mark payment paid; no new payment gateway is introduced.
- **Production:** cutting, stitching, dispatch and external-worker stages have distinct transitions; the original inspector completion command also records pickup. Partial work and remaining balance must survive refresh/reload; field visibility differs between selling prices, payments and worker cost.
- **Dealer flow:** distinguish customer demand from own procurement, stock visibility from physical availability, and back-order preview from a committed purchase. Preserve provenance and surface ambiguous source stock rather than inventing balances.
- **Reports:** cards/totals and customer-type summaries use the whole filtered result, not the current page. Search/sort/date changes apply consistently to tables, cards and CSV. Preserve null/unknown amounts; do not turn them into zero. Use explicit IST boundaries and visible current-period cutoff.
- **Files/jobs:** never show a document as ready until the authorized output exists. Expired links can be re-authorized; missing old-source assets remain explicit, environment-specific exceptions.

## 6. Real users, real roles and writable UAT

The frontend and data ownership are different release concerns. Both current projects remain refreshable source mirrors; deploying a button does not authorize native business writes.

Use three clearly separated acceptance levels:

1. **Existing-user continuity:** actual migrated staging accounts log in with their existing credentials and verify persona, own historical data, relationships and field visibility. Production continuity can be checked read-only with designated accounts. Do not collect passwords in source/logs or create a universal testing password.
2. **Controlled end-to-end sessions on existing staging:** use actual Supabase Auth login for dedicated scenario accounts in all eleven roles and a known disposable customer/factory/dealer/worker graph. Humans can operate those real accounts, and browser automation uses independent sessions. The operator enables only the exact actor UUIDs for a bounded window, keeps refresh fenced, records mutations/jobs, controls outbound destinations, and verifies cleanup. The current limit is 32 actor UUIDs, enough for an initial small cohort.
3. **Persistent, unrestricted human UAT if needed:** the expiring allowlist is not a resource sandbox. An allowed Admin still has broad Admin scope. For unattended or multi-day full-role testing, use an isolated disposable acceptance project populated only from the staging source, or explicitly transfer staging to native ownership and stop its mirror refresh. Prefer the isolated option if regular staging refresh must continue. This would be new provisioning, not an environment that already exists: validate environment-bound SDK/project allowlists, credentials, source mappings, backup/reset procedures and disabled provider writes. Decide this before inviting such testers; do not create a third environment merely for automated tests.

The default delivery uses levels 1 and 2 without another infrastructure project. Level 3 is the explicit expansion path if the desired human testing cannot fit controlled sessions. Do not market level 2 as safe arbitrary Admin testing on all imported records.

A staging session needs a durable operator checkpoint: actor allowlist and expiry, scenario IDs/relationships, original schedules, source/data hashes, generation/revisions, uploads/documents/outbox jobs and exact permitted recipients. Guided Admin steps operate on known scenario IDs; the actor allowlist alone does not enforce that resource boundary. Refuse cleanup if unrelated edits are detected. Preserve audit records and monotonic revisions; never rewind identity sequences or broadly truncate tables as a shortcut.

Refresh is allowed only after test work is reconciled/cleaned and all existing guards pass. There is no automatic two-way merge of web-created data back into DigitalOcean. A true native ownership activation permanently changes that lifecycle; old-source refresh must remain fenced after native writes. No production cutover is included merely to demonstrate the UI.

The UI must display a truthful environment and write state: mirror/read-only, authorized test session with expiry, or native ownership. Regular customers do not receive source/environment selectors or a test-mode toggle. Trusted operator controls remain in the existing separate administration lane.

## 7. Delivery sequence and exit criteria

Build vertical workflows that another persona can act on, rather than completing every list before the first order works. Number every iteration in progress updates. The waves below are dependency groups, not promises that each takes one turn or one day.

| Wave | Work delivered | Concrete exit criterion |
|---|---|---|
| 0 — Baseline and acceptance setup | Integrate accepted dashboard commit `34f2073` and verify its deployment; pin exact frontend/backend/source revisions; preserve report/CSV acceptance; validate all 115 mappings; verify UAT lifecycle and current Vercel target | Stable baseline builds; original tracker regression passes; contracts/flags and test identities/cleanup procedure are ready; no unowned competing changes |
| 1 — Identity and shared shell | Gateway before tracker profile code; login/recovery/signup/invite states; scoped customer closure gap; all 11 persona homes/navigation; router/deep links; environment/cache/error primitives; baseline media/inbox components | All11 genuine logins reach correct homes, forbidden direct URLs/API calls fail, logout/role change clears protected state, customer closure passes its scoped tests, Tracker still works |
| 2 — People and onboarding | Scoped customer/staff/workforce directories, addresses, factories/team, approval, dealer/SC relationships, coordinator requests and grants | Self-signup, SC-created and dealer-created customers follow correct distinct states; factory/tailor management and cross-scope denial pass |
| 3 — Catalogue to accepted order | Catalogue/RMP variants, configurator/artwork/presets, quotes, order placement, detail/edit/cancel, due dates/priority, manual payment and allowed overrides | Customer/SC/dealer creates valid custom/RMP/mixed orders through browser; server totals match; retries do not duplicate; PC sees the resulting work |
| 4 — Production and job work | PC allocation/criteria; FM/cutter/tailor/team/inspector/dispatch workspaces; worker assignment/costs/stages/dates | One order traverses PC→FM→CM→Inspector→DI using distinct sessions, partial quantities conserve balances, worker variant passes, history survives reload |
| 5 — Dealer stock and fulfillment | Separate demand/purchases, stock availability, shortage/back-order workflow, receipt and customer dispatch | Demand→shortage→purchase→receipt→partial delivery produces correct residual stock, no duplicate receipt/consumption and clear source-data exceptions |
| 6 — Collaboration and accountability | Tasks/notes, responsibilities/goals, milestones, feedback and live JW/Team feature changes | Admin assignment→persona action→updated metrics/notifications passes; grants off/on take effect without widening order/data authority |
| 7 — Reports, documents and content | Complete persona reports, full-filter summaries/CSV, catalogue/weekly/challan wizards, promotions, files and notification destinations | Reports reconcile to source fixtures; request→progress→PDF preview/download works; no timeout on supported interactive paths; browser file/error states pass |
| 8 — Administration and integration visibility | Reuse Masters/refresh; settings, controlled imports, job/audit/failure views, provider pending/reconcile/retry UX | Staff and Squad Admin boundaries pass; import validation/progress works; current tracker survives; unavailable providers are visibly unavailable |
| 9 — Whole-app acceptance and release | Full workflow/role ledger, multi-browser journeys, human scenarios, performance/accessibility/security, deployed preview and production read-only smoke | All retained web acceptance gates pass or a specific external gate is visibly outstanding; exact build/evidence published; no accidental cutover |

Thin versions of dashboard cards, documents and notifications needed by earlier journeys ship with that journey; wave 7 completes their broader variants. Wave 0 need not halt independent layout/foundation work while the accepted dashboard release is being verified on Vercel.

Parallel execution after the foundation contract is stable:

- One integrator owns identity/session/environment, shared shell/SDK conventions, manifests and integration.
- One lane owns people/catalogue/commercial orders.
- One lane owns production/job work/dealer operations, receiving stabilized order contracts.
- One lane owns collaboration/reports/documents and browser acceptance, using the same primitives.

With four active agents, keep files and domain ownership explicit; no two lanes edit central auth/routing or applied migrations independently. Review shared contracts before implementation, then integrate tested slices. Do not duplicate modules to avoid coordination.

Progress update format: **Iteration N — delivered flow; verification passed; remaining failure/blocker; next bounded step.** Fix targeted failures, rerun affected tests and relevant regressions, then integrate. After the same mechanism fails twice, inspect the root cause/contract rather than rerunning unchanged. Run the complete regression at integrated release boundaries. Track counts by accepted workflow/role variants, not files, lines, endpoints or screenshots.

A trustworthy elapsed-time estimate requires the first two slices' measured throughput. The known scope is nine implementation/release waves plus baseline setup, not a small dashboard edit. Reforecast after wave 1 with implemented versus remaining workflow coverage and actual bottlenecks; avoid an unsupported calendar promise.

## 8. Browser acceptance plan

### Per-workflow evidence

Each retained workflow binds its `WEB-<original ID>` to: source witnesses; route/control; shared component and actual SDK/RPC; persona/capability variant; test scenario IDs; allowed and foreign resource IDs; expected result/state; tested environment/build SHA/backend prefix; browser result; provider output if applicable; cleanup evidence. Store no passwords, full bearer tokens or private customer exports in the repository.

Required dimensions depend on the workflow: reads need pagination/filter/order/scope tests; mutations also need invalid inputs, expected-version conflicts, duplicate submits, lost-response replay and correct durable results. Check forbidden API calls directly, not only hidden menu entries. Test live revocation and capability changes while a page is open.

### Fourteen actor journeys

| Actor | Browser journey that must be demonstrable |
|---|---|
| Admin | Review pending customer → approve/link → create staff/Team grants → assign responsibility/milestone → inspect report → force-close eligible exception with reason |
| SC | Assigned customer → configure/quote/override → place mixed order → allowed edit/payment → follow production → rate PC |
| PC | Pending order → factory or worker assignment → criteria/cost/due date → inspect progress → rate assigned factory |
| Customer | Existing login and own data; separately signup→confirmation→business approval → configure/order → history/feedback/catalogue → eligible coordinator request; dedicated disposable account closes itself and cannot sign in again |
| FM | Receive order → cutter → tailor/subtailor → job-sheet allocation → inspection/dispatch rollups → weekly report |
| CM | Assigned item → partial sizes/sample → remaining balance → complete/history; overcut/unassigned action rejected |
| Inspector | Own-factory job sheet → record completed/picked quantities using the verified original coupled command → correct rollup; other-factory record rejected |
| DI | Dispatch queue → allowed destination → partial dispatch twice → challan → remaining/completed status |
| Dealer | Linked customer → demand → own stock → shortage/backorder → receipt → partial customer dispatch → correct residual |
| JW | Assigned work → six stages → due-date reason → optional products/PDF/tasks/goals according to grants; unrelated work denied |
| Team | Independently granted tasks/goals/products/promotions; live revoke/grant; usable no-grants state; no invented order rights |
| Tailor subject | Allocation, partial completion, team attribution, leaderboard and earnings stay consistent through authorized operators |
| SubTailor subject | Parent membership, allocation/completion and historical attribution survive edits/archive |
| Tracker staff/admin | Existing login/navigation/operational smoke → Masters CRUD → same-environment refresh progress/exceptions; persona credentials cannot substitute |

The manufacturing journey on staging must use separate real sessions, not a single Admin repeatedly changing a client role. The same record should appear correctly for each subsequent authorized actor, including timestamps, quantities, money visibility and history. Add direct-customer versus dealer-linked, factory versus job-worker, and custom versus RMP versus mixed variants.

### Failure, concurrency and environment scenarios

- Wrong password, expired/revoked session, disabled/deleted/unmapped account, unapproved signup and email confirmation failure.
- Forged role/user ID, foreign factory/customer/order/media ID, deep-link bypass, altered capability claims, and stale cached navigation.
- Reload/back button while editing, cancelled requests, late search responses, network disconnect, uncertain command result, double click and repeated callback.
- Two inspectors/dispatchers competing for the final available quantities; stale quote/order/stock preview; changes while paging/exporting.
- Session/environment/source switch during CSV/PDF preparation: stop safely, never produce a mixed-context export.
- Empty lists, unknown money, no variants, missing source file, expired signed URL, rejected upload, background job failure/dead letter and provider unknown outcome.
- Preview builds cannot call legacy mutation APIs or production by accident. Block those destinations in automated tests; new Squad persona routes have no legacy fallback transport.
- Reconcile all test artifacts and restore schedules; interrupted-run recovery must be executable before broad human sessions.

## 9. Performance, correctness and usability standards

These are proposed acceptance targets, not claims already achieved by the new UI.

| Area | Target / enforcement |
|---|---|
| Common reads | Warm production-shaped SQL p95 under 200 ms for bounded normal list/detail paths; capture plans for misses |
| Ordinary commands | Warm SQL p95 under 500 ms, with contention/retry results recorded separately |
| Interactive browser calls | Representative deployed browser→API warm p95 at most 2 s; cold cache and network location reported separately |
| Heavy search/report | No statement-timeout failures in supported paths; profile/index or use honest asynchronous jobs where necessary, rather than merely increasing every role's timeout |
| Large export/PDF | Bounded pages and memory; durable progress; resumable/expired/failed states; exact row count/no duplicates; filters and authorization match the view |
| Initial useful rendering | Proposed p75 LCP at most 2.5 s, INP at most 200 ms and CLS at most 0.1 on defined representative devices/network; measure, do not infer from SQL |
| Requests | No per-row API loops, all-data frontend fetches, poll storms, or duplicate domain clients. Cancel/suppress stale search results and batch only supported operations |
| Payload/render | Server pagination; lazy feature chunks; image dimensions/thumbnails/lazy loading; virtualization only where measured list size warrants it |
| Accessibility | WCAG 2.2 AA target; keyboard workflow, labels, focus/error handling, semantic tables, async status, contrast and responsive reflow; automated checks plus manual keyboard/screen-reader review |
| Responsive web | Desktop 1366 px, tablet and phone-width 360 px browser layouts; horizontal quantity grids remain usable; no React Native work implied |
| Browser support | Current stable Chrome, Safari and Firefox for core journeys; verify file downloads, clipboard/share fallbacks, date controls and auth redirects separately |

Accessibility criteria are based on the [W3C WCAG 2.2 reference](https://www.w3.org/WAI/WCAG22/quickref/); automated scans alone do not establish conformance. Route/query library choices are implementation aids, not a substitute for measured behavior.

Keep entity IDs as strings where required and money as canonical server decimal strings. Do not round-trip business amounts through imprecise browser arithmetic. Preserve null versus zero. Store only safe preferences/drafts with principal/environment scope and expiry; clear protected caches/drafts/blob URLs on logout and relevant identity changes. Do not implement offline business-command replay in this phase; show an honest offline state and a safe retry/reconciliation path.

No service-role secret in browser code, builds, source maps or exported settings. Use current Auth sessions, server authorization, RPCs and scoped file grants. Direct database-table access is not the default Squad integration path. Native Supabase Auth/Storage operations remain appropriate where explicitly authorized by the existing upload/download design; do not wrap them in unnecessary new Edge functions.

## 10. External and data gates carried forward

| Gate | What can be built now | What remains necessary for the stronger completion claim |
|---|---|---|
| Uniware | Existing-setup availability/status/reconciliation, order/customer pending/error UI and authorized retry | Access is user-deferred. Actual controlled customer/order/amend/cancel/inventory journey must pass against the same legacy setup; no substituted provider or invented success |
| Email/weekly schedule | Account/document progress, recipient validation, message status and operator diagnostics | Actual controlled attachment-capable inbox receipt and automatic weekly execution evidence where still outstanding; SMTP acceptance is not inbox delivery |
| Notifications | Fully functional in-app inbox and authorized web destinations | Native phone delivery belongs to mobile. Browser OS push requires a separate explicit supported-browser scope; it is not silently promised as equivalent to native push |
| Stock/history | Honest reconciliation UI and blocked ambiguous operations | Source duplicate/overconsumed stock and historical timestamp/financial conventions need their existing data acceptance; do not repair by masking unknowns |
| Media | Correct Storage authorization, preview/upload/download and missing-file treatment | Keep environments separate; report missing staging source files with no production fallback, as explicitly requested. A new Storage regression is a defect, not a source exception |
| Airtable | No new UI or activation | Explicitly excluded by user |
| Support impersonation | Scoped administrative inspection | Universal-password/login-as behavior remains retired; no implementation without a separate support-access policy |
| Production ownership | Deploy/read-only verification and operator preview where allowed | Separate fresh data/Auth/media reconciliation, source freeze and guarded ownership release before real native production writes |

The former dashboard reporting timeout gate is resolved by commit `34f2073`: all 18 final staging acceptance checks passed, including the 13,201-row export, with warm default HTTP p95 of 1,042 ms and verified cleanup. Cold requests and full-history searches can still take several seconds; this sample is not a production SLA. See [verification evidence](squad-one-audit/implementation-evidence/staging-dashboard-verification.json) and [browser evidence](squad-one-audit/implementation-evidence/staging-dashboard-browser.json). Live deployment verification remains separate, and the new persona-scoped report routes still require their own acceptance.

## 11. Deployment, rollback and final review

1. Freeze the coordinated frontend baseline; preserve current dashboard work and record exact backend prefix/Edge hashes.
2. Build and test on a feature branch/preview wired explicitly to staging. GitHub `develop` has previously deployed as Vercel Production, so never assume branch name means environment.
3. Verify the actual Vercel deployment URL and commit, route refresh/deep links, runtime project selection and auth redirects. Test preview against staging with production/legacy mutation destinations blocked.
4. Run required workflow/role/browser/security/accessibility/performance checks and existing Tracker regression. Review ledger gaps against the original Flutter source and the approved 115-row matrix.
5. Deploy the accepted frontend to the verified live project. Keep runtime data ownership unchanged; shipping a screen does not activate production writes.
6. Smoke-test existing tracker and designated persona read paths on the live build, inspect errors, and retain the prior working frontend release for rollback.
7. If backend corrections are needed, deploy reviewed compatible migrations to both environments and publish new refresh catalog/access baselines and a frozen refresh ref before future refreshes. Never edit applied migrations or reuse stale 112/113 baselines after changing the catalog.
8. UI rollback reverts assets, not business writes. Preserve compatible backend behavior and separately reconcile any native test/production writes; never restore an old snapshot automatically.

Final report must state: accepted workflow rows and role variants; all 11 login results and 14 actor journeys; exact source/build/backend revisions; deployed URLs; functional, isolation, performance and accessibility results; test-data cleanup; existing Tracker regression; unresolved provider/data gates; and the actual ownership mode. If a required web workflow fails, fix it and rerun its relevant acceptance before marking it complete.

The final review uses the original scope, source-discovered variation ledger and this plan, not a reduced list of whatever happened to be implemented. New discoveries receive an explicit disposition and test, with scope changes visible to the user. External deferrals remain visible rather than trapping the team in endless internal retries.

## 12. First implementation iteration

The first bounded iteration should deliver the common entry point and all eleven persona landing shells backed by real `v1_me` identity, while preserving the existing tracker. Include one real order list/detail read for each entitled persona, denied-route/API tests, shared-session logout/refresh, correct no-access/pending states, and Vercel deep-link proof. This validates the riskiest architectural boundary before expanding the configurator and business commands.

Then deliver the first complete customer→SC→PC order slice, followed by factory execution and dealer/job-worker variants. That is the shortest reliable path to a usable full application while retaining one shared implementation per business capability.

Implementation source correction (iteration 1): pinned Flutter `inspector_service.dart:164–211` sends `completed_quantity` to `job_sheet_tailor_mark_done`; Rails `inspectors_controller.rb:194–227` persists completion and reports the same picked quantity. Separate pickup was a planning error, not an additional feature to invent.
