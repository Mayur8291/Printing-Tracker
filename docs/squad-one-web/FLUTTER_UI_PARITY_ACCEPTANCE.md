# Flutter-parity acceptance checklist (Phase 8)

Companion to [FLUTTER_UI_PARITY_PLAN.md](FLUTTER_UI_PARITY_PLAN.md). Run on **staging** with `?persona=1` (e.g. `/squad/home?persona=1`). Record result, tester, date and a screenshot per row. A row passes only if the behaviour matches the Flutter reference (Flutter commit `5d55d946`, run side by side on the same account).

## A. Preflight (blocks everything else)

| # | Step | Pass criteria |
|---|---|---|
| A1 | Apply `20261121090000_squad_order_stats_parity.sql` and `20261121100000_squad_order_producer_filter.sql` to staging | Both apply without error; `NOTIFY pgrst` reload done |
| A2 | Regenerate `tools/canto-sync/baselines/staging-domain-access.json` (and production later) with the sync tool | New functions `v1_order_stats`, `v1_people_order_counts` appear, executable by `sa_app` only; no other drift |
| A3 | Confirm `v1_order_stats` / `v1_people_order_counts` reject anon/authenticated and non-listed roles | 42501 / permission denied |
| A4 | One test account per persona (roles 0,1,2,3,4,7,8,9,10,11, plus Team with all grants off and all on) | Logins work; Flutter app logs in with the same accounts |
| A5 | Build deployed with current branch; `?persona=0` still shows today's navigation | No regression for existing users |

## B. Counter reconciliation (numbers must match the legacy API)

For each persona account, read the Flutter stats response (legacy `GET` stats endpoint, same account) and the web tile values. Tolerance: exact match; refresh both within the same minute.

| Persona | Compare (legacy field -> web tile) |
|---|---|
| Admin | completed_orders_count, pending, critical, overdue, pending_criteria, total_order_value, total_order_units -> Completed*, Pending, Critical, Overdue, Pending Order Criteria, Total Order Value, Total Order |
| Sales Coordinator | same set, scope `customer_sc_id = SC` |
| Production Coordinator | same set (no value tile); scope `assigned_by_id`, custom-item orders |
| Customer / Dealer | same set, orders placed by me |
| Factory Manager | same set + criteria; scope `assigned_to_id` |
| Dispatch Incharge | uses `dispatched_status` (pending/completed/critical/overdue) |
| Cutting Master | item-based counts (`cutting_status`, `job_sheet_due_on`) |
| Job Worker | `worker_status` counts, total_amount_earned, worker_efficiency |

*Completed includes cancelled (decision D1). Record any difference with the order IDs that explain it before logging a defect: likely causes are timezone (UTC vs IST due dates), deleted orders, or the PC custom-items-only rule that the web order scope (RLS) may not apply the same way.

Per-person cards: pick 3 coordinators/customers/factories; compare Pending/Completed counts on the card with legacy `orders` counts for that person.

## C. Per-persona navigation and screens


### Admin (role 0) - lands on `customers`

| # | Check | Expected | Result |
|---|---|---|---|
| C0.1 | Bottom bar (phone, 390x844) | Tabs in order: **Customers**, **Sales Co-ord.**, **Prod. Co-ord.**, **Products**, **To Do's** (feature-flagged tabs hidden when grant is off) | |
| C0.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C0.3 | Tab **Customers** | sub-tabs Customers / Distributor; counters: pending_criteria, pending, critical, overdue, completed, total_value, total_orders; add button 'Customers Verification' | |
| C0.4 | Tab **Sales Co-ord.** | counters: pending, critical, overdue, completed, total_value, total_orders; add button 'Add SC' | |
| C0.5 | Tab **Prod. Co-ord.** | counters: pending, critical, overdue, completed, total_value, total_orders; add button 'Add PC' | |
| C0.6 | Tab **Products** | sub-tabs Custom / Ready Made | |
| C0.7 | Tab **To Do's** | sub-tabs Pending / Completed; chips All / Assign by me / Assign to me | |
| C0.8 | Right menu | Items: Personas, Tasks, Roles & Goals, Sync Products, Catalogues, Change SC, Customers Request, Force Complete Order, Promotional Assets; Logout at bottom | |
| C0.9 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Sales Coordinator (role 1) - lands on `orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C1.1 | Bottom bar (phone, 390x844) | Tabs in order: **Orders**, **Customers**, **Distributor**, **Products**, **To Do's** (feature-flagged tabs hidden when grant is off) | |
| C1.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C1.3 | Tab **Orders** | sub-tabs Pending / Completed; counters: pending_criteria, pending, critical, overdue, completed, total_value, total_orders | |
| C1.4 | Tab **Customers** | sub-tabs Approved / Requested; add button 'Train Customer' | |
| C1.5 | Tab **Distributor** | sub-tabs Approved / Requested | |
| C1.6 | Tab **Products** | opens and lists the same records as Flutter | |
| C1.7 | Tab **To Do's** | opens and lists the same records as Flutter | |
| C1.8 | Right menu | Items: Milestone, Tasks, Roles & Goals, Catalogues, Promotional Assets; Logout at bottom | |
| C1.9 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Production Coordinator (role 2) - lands on `orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C2.1 | Bottom bar (phone, 390x844) | Tabs in order: **Orders**, **Customers**, **Factory**, **Sales Co-ord.**, **To Do's** (feature-flagged tabs hidden when grant is off) | |
| C2.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C2.3 | Tab **Orders** | sub-tabs Pending / Assigned; counters: pending_criteria, pending, critical, overdue, completed, total_orders | |
| C2.4 | Tab **Customers** | opens and lists the same records as Flutter | |
| C2.5 | Tab **Factory** | counters: pending, critical, overdue, completed, total_orders | |
| C2.6 | Tab **Sales Co-ord.** | opens and lists the same records as Flutter | |
| C2.7 | Tab **To Do's** | opens and lists the same records as Flutter | |
| C2.8 | Right menu | Items: Tasks, Roles & Goals, Catalogues; Logout at bottom | |
| C2.9 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Customer (role 3) - lands on `products`

| # | Check | Expected | Result |
|---|---|---|---|
| C3.1 | Bottom bar (phone, 390x844) | Tabs in order: **Products**, **Orders** | |
| C3.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C3.3 | Tab **Products** | opens and lists the same records as Flutter | |
| C3.4 | Tab **Orders** | sub-tabs Pending / Completed; counters: pending, critical, overdue, completed, total_value, total_orders | |
| C3.5 | Right menu | Items: Promotional Assets, Catalogues, Change SC, Delete Account; Logout at bottom | |
| C3.6 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Factory Manager (role 4) - lands on `orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C4.1 | Bottom bar (phone, 390x844) | Tabs in order: **Orders**, **Tailors**, **Delivery**, **To Do's** (feature-flagged tabs hidden when grant is off) | |
| C4.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C4.3 | Tab **Orders** | counters: pending_criteria, pending, critical, overdue, completed, total_orders | |
| C4.4 | Tab **Tailors** | sub-tabs Tailors / Cutting Master; add button 'Add tailor / cutting master' | |
| C4.5 | Tab **Delivery** | sub-tabs Dispatch In Charge / Inspector | |
| C4.6 | Tab **To Do's** | opens and lists the same records as Flutter | |
| C4.7 | Right menu | Items: Tasks, Roles & Goals; Logout at bottom | |
| C4.8 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Dispatch Incharge (role 7) - lands on `orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C7.1 | Bottom bar (phone, 390x844) | Tabs in order: **Orders**, **Tailors** | |
| C7.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C7.3 | Tab **Orders** | sub-tabs Pending / Completed; counters: pending_criteria, pending, critical, overdue, completed, total_orders | |
| C7.4 | Tab **Tailors** | opens and lists the same records as Flutter | |
| C7.5 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Inspector (role 8) - lands on `jobsheets`

| # | Check | Expected | Result |
|---|---|---|---|
| C8.1 | Bottom bar (phone, 390x844) | Tabs in order: **Job Sheets**, **Tailors** | |
| C8.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C8.3 | Tab **Job Sheets** | sub-tabs Pending / Completed | |
| C8.4 | Tab **Tailors** | opens and lists the same records as Flutter | |
| C8.5 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Cutting Master (role 9) - lands on `orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C9.1 | Bottom bar (phone, 390x844) | Tabs in order: **Orders** | |
| C9.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C9.3 | Tab **Orders** | sub-tabs Pending / Completed; counters: pending, critical, overdue, completed, total_orders | |
| C9.4 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Dealer (role 10) - lands on `placed-orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C10.1 | Bottom bar (phone, 390x844) | Tabs in order: **Placed Orders**, **My Orders**, **Customers**, **Products** | |
| C10.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C10.3 | Tab **Placed Orders** | counters: pending, critical, overdue, completed, total_value, total_orders | |
| C10.4 | Tab **My Orders** | sub-tabs Pending / Completed; add button 'Bulk Order' | |
| C10.5 | Tab **Customers** | opens and lists the same records as Flutter | |
| C10.6 | Tab **Products** | opens and lists the same records as Flutter | |
| C10.7 | Right menu | Items: Promotional Assets, Catalogues; Logout at bottom | |
| C10.8 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Job Worker (role 11) - lands on `orders`

| # | Check | Expected | Result |
|---|---|---|---|
| C11.1 | Bottom bar (phone, 390x844) | Tabs in order: **Orders**, **Products**, **To Do's** (feature-flagged tabs hidden when grant is off) | |
| C11.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C11.3 | Tab **Orders** | counters: pending_criteria, pending, critical, overdue, completed, total_value, amount_earned, total_orders | |
| C11.4 | Tab **Products** | opens and lists the same records as Flutter | |
| C11.5 | Tab **To Do's** | opens and lists the same records as Flutter | |
| C11.6 | Right menu | Items: Your Efficiency, Promotional Assets, Catalogues, Tasks, Roles & Goals; Logout at bottom | |
| C11.7 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

### Assistant Worker / Team (role 12) - lands on `first-granted-tab`

| # | Check | Expected | Result |
|---|---|---|---|
| C12.1 | Bottom bar (phone, 390x844) | Tabs in order: **Products**, **To Do's** (feature-flagged tabs hidden when grant is off) | |
| C12.2 | Desktop sidebar (1440x900) | Same tabs, same order, then menu items | |
| C12.3 | Tab **Products** | opens and lists the same records as Flutter | |
| C12.4 | Tab **To Do's** | opens and lists the same records as Flutter | |
| C12.5 | Right menu | Items: Promotional Assets, Catalogues, Tasks, Roles & Goals; Logout at bottom | |
| C12.6 | Back button / browser back | From a tab root returns to first tab; from detail returns to previous screen | |

## D. Counter drill-down and list behaviour (all roles that have counters)

| # | Check | Expected |
|---|---|---|
| D1 | Tap Pending / Critical / Overdue / Completed tile | Opens filtered list; header counts match tile; Back returns to the same tab with state kept |
| D2 | Tap Pending Order Criteria (PC, FM, dispatch, SC detail) | Lists orders with criteria pending |
| D3 | Total value / Amount earned / Total Order tiles | Not tappable |
| D4 | Value tile hidden for roles without price access | Server omits it; no empty tile |
| D5 | Search, custom date range, status chips, infinite scroll, pull to refresh | Work; empty state text "No Order Found." |
| D6 | Tab labels `Pending (n)` / `Completed (n)` (`Assigned (n)` for PC) | n matches list length after full scroll |
| D7 | Dealer: Placed Orders vs My Orders | Placed = customers' orders only; My Orders = own purchases only; no overlap |
| D8 | Admin: SC / PC / Factory lists | Card counts match B; Edit and View Details work; add button Admin only (PC also adds factory) |

## E. Mobile experience (every persona, 390x844 and 768x1024, light and dark)

- Bottom bar never covers content or the add button; safe-area padding on notched devices.
- No horizontal page scroll; counter row scrolls sideways; dialogs fit with keyboard open.
- Tab state kept when switching tabs (search text, sub-tab). **Known gap:** scroll position and per-tab cache are not preserved yet; log as defect if the team considers it blocking.
- Right menu opens/closes, focus returns, Logout works.
- Touch targets >= 44 px; text readable at 200% font scale.

## F. Authorization regression (must not change)

| # | Check | Expected |
|---|---|---|
| F1 | Direct URL to a page the role may not see (e.g. Customer -> `/squad/coordinators/sales`) | Denied state, safe destination |
| F2 | Team user with all grants off | Only profile/account/logout and the access message |
| F3 | Revoke a Team grant mid-session | Tab disappears without reload |
| F4 | Customer cannot see value of other customers' orders; Job Worker cannot see order value | Confirmed in API response, not only UI |
| F5 | Scoped stats cannot widen access: Sales Coordinator A requests subject = coordinator B | Counts only A's visible orders (0 for B) |
| F6 | Existing suites: `node --test` under `apps/admin/src/squad`, hosted persona harness, Tracker regression | All green |

## G. "No relearning" user acceptance

One real user per persona team (Admin, SC, PC, Customer, Factory Manager, Dispatch, Inspector, Cutting Master, Dealer, Job Worker). Without guidance, on a phone, each completes their three most frequent Flutter tasks. Record time, hesitation points and anything they could not find.

| Persona | Suggested tasks |
|---|---|
| Admin | Approve a pending customer; open an SC's pending orders; force-complete an order; change a customer's SC |
| Sales Coordinator | Check overdue orders; open a customer's orders; train/onboard a customer |
| Production Coordinator | Open orders pending criteria; assign a job worker/factory; open a factory's orders |
| Customer | Find a product; place/quote an order; check an order's status |
| Factory Manager | See pending orders; add a tailor; open Delivery staff |
| Dispatch Incharge | Open dispatch queue; record a partial dispatch |
| Inspector | Open a job sheet; record inspection |
| Cutting Master | Open pending cutting; record cut quantity |
| Dealer | Open Placed Orders; place a bulk order; view a customer |
| Job Worker | See overdue orders; update progress; read efficiency |

Pass: >= 90% of tasks completed unaided; every blocker triaged.

## H. Known gaps to triage (do not mark as pass)

From the status ledger: Production Coordinator Customers tab (D3), Admin sidebar mismatch, Sync Products screen, To Do's layout, Pending Order Criteria dedicated screen, milestone progress bar, customer name on order cards, informational Job Worker / dispatch / cutting counters, per-person Delivery queues, Inspector size counter, unaligned order-detail sections, tailor/factory/job-sheet detail review.

## I. Exit criteria

1. A and B fully passed. 2. C, D, F passed for all ten personas. 3. E passed on at least one iOS and one Android phone browser. 4. G >= 90% per persona. 5. H items each either fixed or explicitly accepted by the business. 6. Flag default can then be switched on (`persona` default `1`) and old navigation kept for one release behind `?persona=0`.

## J. Run log

### 21 Nov 2026 - fixture-based visual review (no staging access)
Staging could not be reached: the Supabase CLI session on this machine is logged in to an unrelated account and the repository's linked staging project is not visible to it, and no persona logins were available. Sections A, B, F, G and the real-data parts of C/D are therefore **not run**.

What was run instead: a temporary in-browser harness (deleted afterwards) rendering the real `SquadApp` with a canned SDK, at 375x812 (phone) and 1024 wide (desktop), roles 0, 1, 10 and 11.
- Passed: bottom bar with Flutter tab labels/order and icons (Admin: Customers / Sales Co-ord. / Prod. Co-ord. / Products / To Do's; Sales Coordinator: Orders / Customers / Distributor / Products / To Do's; Dealer: Placed Orders / My Orders / Customers / Products); counter tiles (Flutter order, padded counts, "incl. n cancelled", sideways scroll on phone); orders board (Orders (n), Pending/Completed with counts, Flutter order-card fields incl. FACTORY MANAGER state); Admin Sales Co-ord. list with per-person pending/completed and add button; right menu with Job Worker efficiency gauge, Menu / More grouping and Logout; dealer scope query (`?scope=placed`) keeps the right tab highlighted; desktop sidebar lists the same tabs then Menu / More.
- Defects found and fixed: bottom bar also showed on desktop (CSS order overrode `md:hidden`); two-word tab labels truncated on phone; floating add button covered the last card; Customers search box collapsed to a few pixels on phone.
- Not covered by this review: real data, counters vs Rails, authorization, other roles' screens visually, tablet width, dark mode, Android/iOS devices, the Production Coordinator / Factory Manager / dispatch / inspector / cutting screens.

### 21 Nov 2026 - staging migration applied (A1, A3 partly)
- Read-only preflight on staging and production: both reach the database; the worker-filter rewrite anchors and all required columns exist in both.
- Staging (`scvojtvgnkmbupvyslmb`): dry run (rolled back), then applied `20261121090000` and `20261121100000` atomically and recorded both in `supabase_migrations.schema_migrations`. Verified: 2 `sa_domain` + 2 `canto_api` functions exist; `sa_app` can execute; `anon` and `authenticated` cannot; owners `sa_executor` / `postgres`; `producer_id` and `placed_for_me` accepted by `validate_order_filters` and applied by `filtered_orders`.
- Reference numbers from the staging snapshot using the Rails definitions, all orders (admin scope): total 45,221; pending 2,764; completed incl. cancelled 42,457; overdue 2,762; critical 2,762; pending criteria 44,969; total value 897,549,222.30. Use these to check the Admin tiles once a persona session exists.
- **Not done:** executing `v1_order_stats` as each persona. `actor()` requires a live `auth.sessions` row; borrowing real users' sessions was refused, correctly. Needs a test session per persona. Production is untouched.

### 21 Nov 2026 - production migration applied (A1)
At the owner's explicit request (persona logins not supplied; production counter test deferred), the same two migrations were applied to production (`levwrmvqdntngeasrtnb`): dry run rolled back clean, then applied atomically and recorded. Verified identical to staging: 4 functions, `sa_app` execute only, same owners, filters present. Production has 52,883 orders. **Still open:** per-persona counter execution and reconciliation on either project; regenerate `tools/canto-sync/baselines/*-domain-access.json`; deploy the web build (Vercel) - the new UI stays behind `?persona=1`.
