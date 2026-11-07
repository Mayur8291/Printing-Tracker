# Implementation acceptance contract

These are **required future tests**, not a report that the planned services exist or pass today. This audit's current checks cover source/matrix integrity only.

Each workflow ID in `functionality-matrix.csv` must receive a contract test with: valid actor/scope; wrong actor; right actor/wrong resource; conditional flag off/on where applicable; malformed input; stale version; and relevant state/quantity variation. Read-only/client-only workflows use read/interaction assertions instead of meaningless mutation retry tests. Every public RPC is called directly during authorization tests; hiding a button is not evidence.

Test cases reference master IDs to avoid repeating one policy test for every screen. The implementation suite must additionally bind each workflow ID to its actual contract tests. A green module-level smoke test does not close all workflow rows.

## Shared contract and isolation gates

| Test | Modules | Scenario and required result |
|---|---|---|
| SEC-01 | AUTH, APP | All 11 dashboard personas authenticate with a controlled legacy-compatible staging account and receive the correct live identity/capabilities. T/ST remain managed subjects; phantom CustomerCoordinator cannot self-enroll. |
| SEC-02 | AUTH | Wrong password, disabled/deleted/unapproved account, unmapped UUID, stale/revoked session and changed legacy role all fail appropriately. Null approval compatibility is tested separately. |
| SEC-03 | AUTH | Email case collision creates an explicit exception; does not merge identities or replace another user's password. Password reset is one-use and cannot bypass business eligibility. |
| SEC-04 | AUTH, PEOPLE | Registration/invitation saga crashes before and after Auth creation: retry leaves one linked identity, no usable orphan account and no lost reservation. Untrusted app/user metadata cannot grant Admin. |
| SEC-05 | AUTH, MASTER, REFRESH | Legacy Admin, ordinary Canto user, Printing Tracker staff/admin, guest and service worker remain separate. `sa_app` cannot call existing admin Masters/refresh or access `public`; staff is not automatically a legacy persona. |
| SEC-06 | ORDER, PEOPLE, LINK, TASK, GOAL | Replace customer/dealer/factory/worker/assignee IDs with another user's valid IDs: deny without leaking their existence/details. Scope filters run before pagination and aggregation. |
| SEC-07 | PRICE, ORDER, JOB, MEDIA | Price/fabric/factory/worker-cost/private-contact fields are absent for unauthorized readers in RPC, PDF, media and notification payloads, not merely hidden by UI. |
| SEC-08 | AUTH, APP | Capability change takes effect for an existing session; client-forged feature JSON does not. JW/AW child flag without parent product flag cannot bypass gating. |
| SEC-09 | OPS, INTEGRATE | User cannot invoke job consumer, pass arbitrary handler/URL/SQL, access worker secrets, or replay a provider payload across environments. Logs redact passwords/tokens/PII. |
| SEC-10 | All server modules | Default PUBLIC function execution revoked, private schema unexposed, definer owner not bypass-RLS, fixed search paths, direct API calls denied. Run database/security advisors and review expected exceptions explicitly. |

## Business behavior and concurrency gates

| Test | Modules | Scenario and required result |
|---|---|---|
| CRM-01 | PEOPLE, LINK | Self-, SC- and dealer-created customers retain distinct approval/onboarding/link paths. Dealer can create linked customers but cannot call Admin/SC manual verification on arbitrary users. |
| CRM-02 | PEOPLE | Create/edit factory CM/IN/DI and tailor/sub-tailor; cross-factory assignment denied; archive preserves production history. No unnecessary synthetic workforce credentials. |
| CRM-03 | LINK | Primary address/city/zone changes, direct deal, multiple dealer links and authorized brands produce the correct future price/routing scope; completed order attribution is stable. |
| CRM-04 | LINK | Duplicate coordinator requests are blocked; approve request and bulk reassign in one transaction; pending-order scope updates consistently; concurrent approval cannot double-apply. |
| CAT-01 | CAT, MASTER | Browse all source category/type/brand/class/size variants, inactive/deleted masters and empty/search results. Results use scoped price types and authorized brands. |
| CFG-01 | CONFIG | Reject incompatible fabric/color/part/add-on IDs; normalize equivalent option order; simultaneous identical presets do not create divergent matches. Artwork differences remain attached correctly. |
| CFG-02 | CONFIG, PRICE | Custom/sample/bulk/extra-quantity paths, SVG preview inputs, print/embroidery side and dimension/unit conversion match golden fixtures. Invalid dimensions/quantities fail. |
| PRICE-01 | PRICE | Golden vectors cover quantity 1/5/6 and every margin boundary, METER adult/kids and other UOM/GSM, no/one/many add-ons, overhead, sample override and three-decimal unit rounding. |
| PRICE-02 | PRICE | Tax vectors cover threshold just below/at/above legacy 999, same/different state, optional SKU tax and rounding order. Validate business-approved tax schedule separately from historical formula parity. |
| PRICE-03 | PRICE, ORDER | Expired quote, changed master/price revision, forged totals, negative price, invalid override and unprivileged SC override spoof fail. Accepted order stores immutable calculation provenance. |
| ORD-01 | ORDER, LINK | Custom, RMP and mixed orders from C/D/SC; pure RMP brand split yields correct dealers and all child IDs; mixed/custom routing stays distinct. |
| ORD-02 | ORDER | Repeated same idempotency key returns same result; key with changed payload fails; simultaneous requests create one order set. Failure halfway through items/children rolls back all local writes. |
| ORD-03 | ORDER, PRICE | Only allowed edit/cancel actors; partially produced/reserved order edits reconcile safely. Payment is manual status/amount; no invented gateway side effects. |
| ORD-04 | ORDER, INTEGRATE | Cancel versus soft delete versus Admin force-close remain distinct; external COMPLETE cannot be silently deleted; release/cancel retry never double-applies. |
| ORD-05 | ORDER, METRIC | Filters: prime, criteria, type, assignment, worker stage, due dates, critical/overdue, search, date ranges, canceled/completed. Counts and pages agree without fetching all rows. |
| PROD-01 | PLAN | Assign factory, criteria and cutting master with same-factory eligibility; duplicate or active-work reassignment cannot strand quantity histories. |
| PROD-02 | CUT | Partial size cutting, sample quantity, duplicate retry, two concurrent cutters, negative and overcut attempts; totals never exceed allowed quantity. |
| PROD-03 | SEW | Allocate one item to multiple tailors/sub-tailors and dates; concurrent allocation bounded by available cut quantity; valid team membership enforced. |
| PROD-04 | SEW | Inspector completes/picks by assignment and size; wrong factory denied; completion/pick counts reconcile with history and cannot exceed assignment. |
| PROD-05 | DISPATCH | Partial dispatch over multiple dates, customer/HO/Makali destination, repeat retry and competing dispatchers; quantity conservation holds. |
| PROD-06 | ORDER, CUT, SEW, DISPATCH | Cutting/stitching/dispatch/criteria/worker status stay independent; mixed completion waits for dispatch AND provider; pure RMP and dealer-linked completion use correct branches. |
| JOB-01 | JOB | Six worker stages, assigned-worker scope, forbidden backward transitions, PC correction with reason, unit/total cost visibility and original/current due-date history. |
| STOCK-01 | STOCK | Available 3, required 10 consumes exactly 3 from first source; multiple sources allocate remainder; insufficient supply fails safely with no negative stock. |
| STOCK-02 | STOCK, DISPATCH | Double receipt/replayed dispatch events do not double-credit/consume. Custom equivalence and RMP SKU/size matching work; displayed percentage does not change physical stock. |
| BACK-01 | BACK | Multiple linked pending customer orders aggregate shortages correctly; already-linked orders excluded; stale preview revalidated; two back-order requests cannot duplicate demand. |
| TASK-01 | TASK | Creator/assignee/order-link scope, assign/unassign, deadline, state transition, archive and JW/AW toDos off/on. Notifications go only to intended recipients. |
| GOAL-01 | GOAL | Role/goal/task kinds share implementation; SC/PC/JW/AW subjects supported; self-completion differs from Admin assignment/archive; unrelated subject access denied. |
| TARGET-01 | TARGET | Adjacent/overlapping/fully-contained periods, concurrent milestone creation, placed/completed totals, cancellation reversal and coordinator changes; recalculation is idempotent. |
| RATE-01 | RATE | C→SC, SC→PC, PC→assigned FM and valid work-related ratings; spoofed from_id denied; duplicate actor/target/entity blocked; edit/withdraw updates averages correctly. |
| METRIC-01 | METRIC | Compare cards, graphs, leaderboard, SC milestones, customer/brand/class reports to one set of raw fixtures. Role scopes and period boundaries are identical across views. |
| METRIC-02 | SEW, METRIC, DOC | Saturday-Friday tailor work/earnings, OF/SN/add-on rates, partial work, team members and historical rate treatment match approved examples. No silent payroll formula changes. |

## Files, jobs and provider gates

| Test | Modules | Scenario and required result |
|---|---|---|
| DOC-01 | DOC, PRICE | Catalogue category/brand/class selection/exclusions, fixed/% markup, address/company/bank/terms/stock option and direct/email output. Validate PDF contents visually and compare totals to quote fixtures. |
| DOC-02 | DOC, DISPATCH, SEW | Delivery challan and weekly tailor report include exactly authorized records/quantities; repeated requests return the same job/output when appropriate. |
| DOC-03 | DOC, OPS | Worker crash, timeout, malformed source asset, empty catalogue, huge selection and expired result: truthful status, bounded retry, no broken ready links or source-media deletion. |
| MEDIA-01 | MEDIA | Images/PDF/video/other supported files: authorized upload, finalize, download, replace and detach. Foreign resource/object IDs, path traversal, oversize/type mismatch denied. |
| MEDIA-02 | MEDIA, REFRESH | Existing migrated private objects readable only through correct resource grants; missing staging source remains explicit missing; no production fallback; external URL stays external. |
| MEDIA-03 | MEDIA | Upload succeeds but attachment fails, retry, orphan cleanup, shared object referenced twice and revoked role: no premature deletion or unauthorized new grant. Existing signed URL TTL exposure is documented. |
| PROMO-01 | PROMO, APP | Category/banner pagination, feature-gated JW/AW, image/PDF preview, external YouTube/Drive share and missing/expired asset fallback. |
| NOTIFY-01 | NOTIFY | Build fixtures for all 115 legacy strategy types plus task/rating/job-sheet alerts. Validate resolved recipient sets and deep-link target, not only matching message text. |
| NOTIFY-02 | NOTIFY, OPS | Duplicate event, multiple devices, expired device token, provider success then worker crash, retry/backoff and dead letter. No unrelated user_id notification listing; no duplicate in-app record. |
| INT-01 | INTEGRATE | Staging dashboard and production-configured provider paths use the same interface but independent configuration. Missing provider config fails visibly; never silently redirects environments. |
| INT-02 | INTEGRATE | Provider order submit timeout with unknown outcome: reconcile by idempotency/external reference before retry; reserve/release/fulfill and customer sync have stable references. |
| INT-03 | INTEGRATE | Valid/invalid raw-body HMAC, old timestamp, duplicate event ID, out-of-order status and initial CREATED race. Acknowledge only after durable acceptance; reconciliation repairs missed events. |
| INT-04 | INTEGRATE, MASTER | CSV price/zone imports and optional Airtable sync: dry run, row errors, cancellation, partial batch crash, retries and no conflicting master writers. Disabled Airtable remains disabled. |
| MASTER-01 | MASTER | Existing 22-resource registry, relational edits, min-price recalculation, bulk archive and media keep existing admin authorization. New mobile read projections do not broaden admin write access. |
| OPS-01 | OPS | Queue claim/lease expiry, lost heartbeat, bounded batch, retries, dead-letter, operator retry and redacted progress; job success only when durable result is present. |

## Refresh, cutover and performance gates

| Test | Modules | Scenario and required result |
|---|---|---|
| REF-01 | REFRESH | Fresh same-environment capture gives table/content/sequence/Auth/media reconciliation. Repeating identical input produces no duplicate business effects. Existing public/staff guards pass. |
| REF-02 | REFRESH, AUTH, MEDIA | New order, password change or attachment after comparison advances revision; concurrent refresh fails safely. Owned write epoch rejects destructive old-source refresh. |
| REF-03 | REFRESH, OPS | New policies/indexes/roles are included in reviewed fingerprints. Initial restore/refresh does not remove required private executor grants; drift is detected rather than bypassed. |
| REF-04 | REFRESH, NOTIFY, INTEGRATE | Import historical rows with production-like orders/users: zero welcome emails, old notifications, new external orders/reservations or duplicate stock receipts. |
| REF-05 | REFRESH | Failed publication rolls back local data/Auth; lost connection reconciles durable commit journal. Cutover rehearsal includes final source watermark, sequence high-water marks and explicit rollback with new writes. |
| APP-01 | APP | Minimum version, login routing, offline/error/loading/empty states, expiry and logout cache clearing; cached price/scope from one environment/persona never appears in another. |
| PERF-01 | CAT, ORDER, PEOPLE, METRIC | Production-shaped staging data; bounded list/detail query count and payload; inspect plans/buffers and warm p95 DB latency against the plan targets. No client full-table fetch or N+1 loop. |
| PERF-02 | ORDER, CUT, SEW, DISPATCH, STOCK | Concurrent mixed workload and deadlock retries preserve invariants; measure contention and tail latency separately from external providers. |
| PERF-03 | DOC, OPS, INTEGRATE | Long PDF/import/reconciliation batches make progress without Edge CPU timeout, unbounded memory, starvation or exhausting DB connections. |

## Required persona journeys

| Persona | End-to-end journey to demonstrate on staging |
|---|---|
| Admin | Review signup → approve/link customer → create staff/Team grants → create milestone/responsibility → inspect scoped reports → force-close exception with reason |
| Sales Coordinator | Open assigned customer → configure mixed products → server quote/override → place order → edit allowed fields/payment → follow production → rate PC |
| Production Coordinator | Find pending criteria order → assign factory or worker → set criteria/cost/due date → inspect progress → rate assigned factory |
| Customer | Signup/legacy login → approved identity and existing data → product/configurator → own order → history/feedback → catalogue and coordinator request |
| Factory Manager | Receive order → assign cutter → create tailor/sub-tailor → allocate job sheet → see inspection/dispatch → weekly report |
| Tailor | As a managed subject: assignment, partial completion, team attribution, leaderboard and earnings report are consistent; no fabricated standalone login test |
| SubTailor | As a managed subject: parent team membership and allocated/completed work remain correctly attributable after edits/archive |
| Dispatch Incharge | Own-factory queue → choose allowed destination → partial dispatch twice → challan → remaining/completed state |
| Inspector | Own-factory job sheet → inspect/complete/pick by size/tailor → see rollup; deny another factory |
| Cutting Master | Assigned item → cut partial sizes → finish balance → see history; reject duplicate/overcut/unassigned item |
| Dealer | Create linked customer → inspect customer demand → check own stock → back-order shortage → receive → partial customer dispatch → correct residual stock |
| Job Worker | Assigned order → stage update → due-date reason → optional products/PDF/notes/goals according to grants; deny unrelated worker orders |
| Team | Notes/goals/products according to independent feature grants; forbidden order/stock administration remains denied |
| Printing Tracker admin (separate) | Existing Masters CRUD → revision-protected same-environment refresh → progress/media exception report; Canto role does not substitute for this admin principal |

Release evidence must include fixture IDs (no passwords), commit/artifact versions, test results, provider sandbox configuration, measured latency and known exceptions. Production release remains a separate gated action; these tests do not authorize production writes by themselves.
