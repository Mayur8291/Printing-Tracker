# Squad One web ↔ Flutter: dashboard, navigation and stats parity plan

Prepared 21 November 2026. **Plan only — no application code changed.**

Baseline compared:

| Side | Source |
|---|---|
| Flutter (reference behaviour) | `Canto/scott-flutter` approved commit `5d55d946` (`lib/ui/views/**`, `lib/ui/widgets/**`, `lib/app/global_constants.dart`). Not the checked-out `eef6bffd`. |
| Stats definitions | Rails `Canto/scott-international-backend/app/services/*_stats_service.rb` (what the Flutter counters actually displayed). |
| Web (current) | `Printing-Tracker/apps/admin/src/squad/**` — `navigation/registry.js`, `SquadShell.jsx`, `features/home/HomePage.jsx`, feature pages. |
| Backend (current) | `supabase/migrations/20261107132809_squad_scoped_reads.sql` → `sa_domain.v1_dashboard`; `v1_sales_coordinator_metrics`, `v1_work_metrics`. |

---

## 1. Diagnosis — why the web app feels different

The earlier web programme (`SQUAD_ONE_WEB_IMPLEMENTATION_PLAN.md`) audited **workflows** (115 rows, 317 view files) and deliberately **consolidated persona screens into shared generic pages** — the traceability index records it literally: *"Lists consolidated instead of duplicate persona pages."* Functionally most actions exist somewhere, but:

1. **Navigation model is different.** Flutter = per-persona *bottom tab bar* (2–5 tabs) + right-side *end drawer* for secondary items. Web = one grouped left sidebar of ~19 generic modules ("Overview", "Commerce", "Operations", "Insights"…) identical in shape for every persona.
2. **Persona-specific dashboards were dropped.** Admin's *Sales Co-ord.* and *Prod. Co-ord.* tabs, PC's *Factory* and *Sales Co-ord.* tabs, FM's *Tailors* / *Delivery* tabs, Dealer's *Placed Orders* vs *My Orders* split, etc., became filters inside People/Orders/Production.
3. **Stats were reduced.** Flutter shows up to 8 tappable counters on every order list and every person-detail screen; web shows 4 non-tappable cards (Orders / In progress / Completed / Pieces dispatched) only on Home. Overdue, Critical pending, Pending order criteria, Total order value, Amount earned, Efficiency, Active / Yet-to-begin are absent. The backend RPC (`v1_dashboard`) doesn't compute them.
4. **Mobile web is a desktop layout shrunk down** (hamburger → left sheet). Users of the Flutter app expect a bottom bar, an avatar/menu top-right, pull-to-refresh, FABs and per-tab state.

The fix is therefore mostly **information architecture + stats + mobile shell**, reusing the existing feature components and SDK — not rebuilding workflows.

---

## 2. Persona navigation: Flutter vs web

Flutter bottom tabs (exact labels/order from `*_dashboard_view.dart`) and end-drawer items (`drawer_view.dart`):

| Persona (role id) | Flutter bottom tabs | Flutter drawer (besides Profile/Logout) | Web today (sidebar) | Gap |
|---|---|---|---|---|
| **Admin (0)** | Customers · Sales Co-ord. · Prod. Co-ord. · Products · To Do's | Personas (Team + Job Workers), Tasks Roles & Goals, Sync Products, Catalogues, Change SC, Customers Request, Force Complete Order, Promotional Assets | Overview, Products, Orders, Customers, Team, Production*, Job work*, Tasks, Goals, Targets, Reports, Documents, Promotions, Notifications, Administration, My account (*nav shows them but domain pages deny — known defect) | **No SC dashboard tab, no PC dashboard tab**, no per-coordinator stats/detail, no Personas screen, no Force-Complete search, no bulk Change SC screen, no Sync Products entry, no Customers/Distributor two-tab screen with stats |
| **Sales Coordinator (1)** | Orders · Customers · Distributor · Products · To Do's | Milestone, Tasks Roles & Goals, Catalogues, Promotional Assets | Overview, Products, Orders, Customers, Tasks, Goals, Targets, Reports, Documents, Promotions… | Orders tab stats header missing; Customers *Approved / Requested* tabs + "Train Customer" FAB not mirrored; Distributor is a hidden route, not a tab; Milestone lives under "Sales targets" |
| **Production Coordinator (2)** | Orders · Customers · Factory · Sales Co-ord. · To Do's | Tasks Roles & Goals, Catalogues | Overview, Orders, Team, Production, Job work, Tasks, Goals, Reports, Documents | **Customers tab missing** (registry excludes role 2), **Sales Co-ord. tab missing**, Factory list with per-factory stats → factory detail missing as a tab, Pending Order Criteria counter + screen missing |
| **Customer (3)** | Products · Orders | Promotional Assets, Catalogues, Change SC (request, only if no dealer), Delete Account | Overview, Products, Orders, Documents, Promotions, My account | Landing should be **Products**, not Overview; Orders stats header missing; Change-SC request entry placement |
| **Factory Manager (4)** | Orders · Tailors · Delivery · To Do's | Tasks Roles & Goals | Overview, Orders, Team, Production, Reports, Documents | Tailors tab (Tailors / Cutting Master sub-tabs + Preview Leaderboard) and Delivery tab (Dispatch In-charge / Inspector sub-tabs → their queues) are folded into Team/Production |
| **Dispatch Incharge (7)** | Orders · Tailors | — | Overview, Team, Production, Reports, Documents | Orders (pending/completed dispatch with counters) is a Production sub-view; Tailors tab missing |
| **Inspector (8)** | Job Sheets · Tailors | — | Overview, Team, Production, Reports | Job Sheets pending/completed tabs with counters folded into Production; Tailors tab via Team |
| **Cutting Master (9)** | single screen: Orders with Pending/Completed tabs | — | Overview, Production, Reports | Landing should be the cutting queue directly |
| **Dealer (10)** | Placed Orders · My Orders · Customers · Products | Promotional Assets, Catalogues | Overview, Products, Orders, Customers, Stock & deliveries, Documents, Promotions | **Placed Orders vs My Orders split** not reproduced as tabs; "Bulk Order" FAB on My Orders |
| **Job Worker (11)** | Orders · Products† · To Do's† | Your Efficiency (gauge), Promotional Assets†, Catalogues†, Tasks Roles & Goals† | Overview, Orders, Job work, Products†, Tasks†, Reports | Efficiency gauge + Amount Earned counter missing |
| **Assistant Worker / Team (12)** | Products† · To Do's† | Promotions†, Catalogues†, Roles & Goals† | Overview + granted modules | Close; landing should be first granted tab |

† feature-flag gated in Flutter (`features.toFeatureFlags()`); web already uses `identity.capabilities`.

---

## 3. Stats parity (the "stats missing across all dashboards" item)

### 3.1 Flutter counters (`widgets/orders_counter.dart`, `jobworker_orders_counter.dart`)

Each tile is **tappable** and opens `FilteredOrdersView` (list with search + *Custom Range* date filter) for that status:

| Tile | Shown to | Rails definition (per scope) | Tap → |
|---|---|---|---|
| Pending Order Criteria | when caller passes it (SC detail, PC, FM, Dispatch) | `criteria_status = 'pending'` | Pending Order Criteria screen |
| Pending Orders | all | `status = pending AND uc_status <> CANCELLED` | filtered list |
| Critical Pending Orders | all | pending AND `due_on < now + 3 days` (includes overdue) | filtered list |
| Overdue Orders | all | pending AND `due_on < now` | filtered list |
| Completed Orders | all | `status = completed OR uc_status = CANCELLED` (**Flutter counts cancelled as completed**) | filtered list |
| Total Order Value | `allowedToSeeTotalOrderValue` (Admin, SC, PC, …) | `sum(total_amount)` | — |
| Amount Earned | Job Worker, or `showEarnedAmount` on a JW detail | `total_amount_earned` | — |
| Total Order | all | **count of orders** (`total_order_units` is an order count, not pieces) | — |

Plus list-level counts: tab labels `Pending (n)` / `Completed (n)` (PC sees `Assigned (n)`), section titles `Orders (n)`, `Sales Co-ordinator (n)`, `Production Co-ordinator (n)`; **person cards** (`sc_widget`, `customer_widget`) each show *PENDING ORDERS* / *COMPLETED ORDERS* counts.

### 3.2 Scope per role (Rails services)

| Scope | Orders counted |
|---|---|
| Admin | all orders |
| Sales Coordinator | `customer_sc_id = SC` |
| Production Coordinator | `assigned_by_id = PC`, custom-item orders only |
| Customer / Dealer | orders placed by me |
| Factory Manager | `assigned_to_id = factory` |
| Dispatch Incharge | factory orders, status from `dispatched_status` |
| Cutting Master | items where `cutting_master_id = me`, status from `cutting_status`, due = `job_sheet_due_on` |
| Inspector / Tailor | `item_tailors`; Tailor adds Active and Yet-to-begin |
| Job Worker | `assigned_orders`, `worker_status`, + `worker_efficiency` (on-time %) and amount earned |

### 3.3 Web today

`v1_dashboard` returns only `orders, pending, completed, cancelled, quantity, dispatched, total_amount (0,1,3,10)`. Home renders four non-clickable cards. Orders page *does* have `overdue` / `critical` filter values (`orderModel.js`) but no counts. No per-person stats anywhere except Reports.

### 3.4 Required backend work

- **New RPC `v1_order_stats(p_subject_id bigint default null, p_scope text default null, p_filters jsonb)`** returning `pending, critical, overdue, completed, cancelled, pending_criteria, total_orders, total_value (role-gated), amount_earned (JW), efficiency (JW), active, yet_to_begin (tailor), as_of`. Implements the Rails per-role scope above. `p_subject_id` lets Admin/PC ask for a specific SC/PC/factory/customer/job worker (authorization: Admin any; PC → SCs/factories/customers in scope; FM → own tailors/staff). Keep `v1_dashboard` untouched for compatibility.
- **Batch variant `v1_people_order_counts(p_ids bigint[])`** → `{id: {pending, completed}}` for list cards (one call per page, ≤ 50 ids).
- **Decision needed (D1):** Flutter counts cancelled inside *Completed*. Web separates them. Recommend: show *Completed* = Flutter definition for familiarity, and add a small "incl. n cancelled" sub-label.
- `filtered_orders` filter keys `state=critical|overdue|pending_criteria` must match the same predicates (verify `validate_order_filters`).
- SDK: add `orderStats`, `peopleOrderCounts` to `packages/shared/squad.js` + `.d.ts`; add to `CANCELLABLE_READS`.

---

## 4. Screen-level gaps by persona

Legend: **NEW** = screen doesn't exist on web; **RESHAPE** = functionality exists but must be presented Flutter-style; **STATS** = needs counters.

### Admin
| # | Flutter screen | Web status | Work |
|---|---|---|---|
| A1 | Customers tab = `AdminCustomerDealerView`: two tabs *Customers / Distributor*, stats header, search, customer cards with pending/completed counts, FAB → *Customers Verification* (pending approvals) | CustomersPage (single list, status filter) | RESHAPE + STATS |
| A2 | **Sales Co-ord. tab** = `AdminSCView`: global stats header (tappable), "Sales Co-ordinator (n)" + search, SC cards (avatar, name, pending/completed, Edit / View Details), FAB *Add SC* | not present (SCs only via People role filter) | **NEW** |
| A3 | **SC detail** = `ScDetailView`: profile header, that SC's counters (incl. Pending Criteria), Target/Milestone shortcut, "Orders (n)" search, *Pending (n) / Completed (n)* tabs | partial (person detail + "View orders" link) | **NEW** |
| A4 | **Prod. Co-ord. tab** = `AdminPCView`: same as A2 for PCs, FAB *Add PC* | not present | **NEW** |
| A5 | PC detail (reuses `ScDetailView`) | partial | **NEW** (same component as A3) |
| A6 | Products tab = `ProductCategoriesView` (Custom / Ready Made) | CataloguePage | RESHAPE (tabbed entry) |
| A7 | To Do's = `NotesView`: Pending/Completed tabs, chips *All / Assign by me / Assign to me*, search, FAB | WorkPage (tasks) | RESHAPE (labels + tab layout) |
| A8 | Drawer → **Personas**: chip tabs *Team* / *Job Worker* lists with add FAB → detail | Team/People filter | **NEW** screen (thin wrapper over People) |
| A9 | Drawer → **Force Complete Order**: search by order no / customer → close | only inside order detail | **NEW** search screen |
| A10 | Drawer → **Change SC**: filter by SC, multi-select customers, *Select All*, *Select SC to update* | `reassignCustomers` exists in Customers/People | RESHAPE into dedicated screen |
| A11 | Drawer → **Customers Request** (SC update requests) | "Coordinator requests" panel | RESHAPE (drawer entry) |
| A12 | Drawer → **Sync Products** | Administration → Integrations | Entry point only |
| A13 | Drawer → Catalogues, Tasks Roles & Goals, Promotional Assets | Documents, Goals, Promotions | Entry point / labels |
| A14 | Admin nav shows Production / Job work but pages deny | defect | Fix registry to match backend |

### Sales Coordinator
| # | Flutter | Web | Work |
|---|---|---|---|
| S1 | Orders tab = `CoordinatorOrdersView`: counters (tappable), milestone progress bar if `currentMilestone`, "Orders (n)" search with refresh, *Pending (n) / Completed (n)* swipeable tabs, order cards (`order_widget`: Order No, customer, due date, total qty, value, payment status, order/job-sheet status, SAMPLE badge, factory assigned/unassigned) | OrdersPage (table, filters) | RESHAPE + STATS |
| S2 | Customers tab: *Approved / Requested* tabs, stats, FAB **Train Customer** → onboarding | CustomersPage | RESHAPE + STATS |
| S3 | Distributor tab: *Approved / Requested*, stats | hidden `distributors` route | **Promote to tab** |
| S4 | Products, To Do's | as Admin | RESHAPE |
| S5 | Drawer → Milestone (`MilestoneDetailsView`: *Ongoing / Past*) | TargetsPage | Entry + labels |

### Production Coordinator
| # | Flutter | Web | Work |
|---|---|---|---|
| P1 | Orders tab with *Pending / Assigned* labels and **Pending Order Criteria** counter → `PendingCriteriaOrdersView` | Orders + criteria filter | RESHAPE + STATS + **NEW** criteria screen |
| P2 | **Customers tab** | not allowed for role 2 in registry | **NEW for PC** (verify backend read scope) |
| P3 | **Factory tab** = `FactoriesView`: counters, factory list, → `FactoryDetailsView` (orders, search, tabs) | People → Factories | **NEW tab** + detail with stats |
| P4 | **Sales Co-ord. tab** (`AdminSCView` without add FAB) | missing | **NEW** (reuse A2) |
| P5 | Job worker selection/status/due-date flows | JobWorkPage | keep; entry from order detail |

### Customer
| C1 | Land on **Products** tab; Orders tab with counters + Pending/Completed | Overview landing | Change landing; RESHAPE |
| C2 | Drawer: Promotional Assets, Catalogues, Change SC request (only if no dealer), Delete Account | spread over Profile/Documents | Drawer entries |

### Factory Manager
| F1 | Orders tab (counters incl. Pending Criteria) | Orders | STATS |
| F2 | **Tailors tab**: *Tailors / Cutting Master* sub-tabs, *Preview Leaderboard*, add FAB; tailor detail with *Jobs* pending/completed, **Download Weekly Report** | Team + Reports | **NEW tab** composed from existing pieces |
| F3 | **Delivery tab**: *Dispatch In Charge / Inspector* sub-tabs → each person's queue (`FactoryDispatchOrdersView`, `FactoryInspectorJobSheetView`) with counters | Team + Production | **NEW tab** |
| F4 | To Do's | WorkPage | RESHAPE |

### Dispatch Incharge / Inspector / Cutting Master
| D1 | Dispatch: *Orders* tab (pending/completed dispatch, counters) + *Tailors* tab | Production → Dispatch queue | **NEW tabs** wrapping ProductionPage sub-views |
| I1 | Inspector: *Job Sheets* (pending/completed, size-wise completed counter) + *Tailors* | Production → Inspection | **NEW tabs** |
| X1 | Cutting master: single *Orders* screen, *Pending / Completed* tabs, cut-quantity counter | Production → Work queue | Land directly on queue |

### Dealer
| L1 | **Placed Orders** (customers' orders) vs **My Orders** (own purchases, FAB *Bulk Order*) as separate tabs | Orders + Stock "My purchases" | **NEW tab split** |
| L2 | Customers tab (dealer's customers, add FAB) | Customers | RESHAPE |
| L3 | Products | Catalogue | RESHAPE |

### Job Worker / Team
| J1 | Orders tab with JW counters incl. **Amount Earned**; drawer **Your Efficiency** gauge | missing | STATS + drawer widget |
| J2 | Products / To Do's only when flags on | capability-driven | keep; tab bar must hide disabled tabs |

### Shared detail screens to align (visual + field order)
- `ScOrderDetailsView` (order detail): header, status, *EDIT ORDER* / *CANCEL ORDER* / *EDIT DUE DATE* actions per role, items, criteria, branding, fabric, tailors progress. Web `OrdersPage` detail has the data; reorder sections and action placement to match.
- `CustomerDetailsView`: profile + Orders (with counters) tabs, edit for Admin.
- `FilteredOrdersView`: list + search + *Custom Range* date picker — needed as the drill-down for every counter.

---

## 5. Web-only features (keep, but relocate)

Reports, Documents, Notifications, Administration (settings, transfers, integrations), Stock reconciliation, Sales targets analytics. Recommendation **(D2)**: keep them, move into the drawer/"More" menu (desktop: lower sidebar section) so the primary tabs match Flutter exactly. Remove the generic *Overview* page as the landing for personas that didn't have one; keep it reachable as "Insights" for Admin.

---

## 6. Mobile UX specification (< 768 px)

Target: a Flutter user opens the web app on a phone and finds everything where it was.

1. **Bottom tab bar** per persona — same labels, order, icons (port the SVGs from `scott-flutter/assets/*_icon.svg`), active colour, max 5 tabs, hidden tabs when feature flags are off. Safe-area padding.
2. **Top app bar** = `CustomAppbar`: logo/greeting left, avatar/menu right that opens a **right-side drawer** (Flutter `endDrawer`) with the persona's drawer items in Flutter order, Profile at top, Logout at bottom; Job Worker efficiency gauge at the top.
3. **Tab state preservation** like `IndexedStack`: switching tabs keeps scroll position, search text and sub-tab. Implement with route-per-tab (`/squad/t/:tab`) + keep-alive cache of tab elements.
4. **Pending/Completed sub-tabs** with counts in the label, swipe-to-switch.
5. **Counters header** as a horizontally scrollable row of tiles (Flutter layout), collapsing on scroll (`NestedScrollView` behaviour).
6. **Search bar with count title** ("Orders (124)") + refresh icon; pull-to-refresh on lists.
7. **Cards, not tables** on mobile for orders, people, job sheets — field order from `order_widget.dart`, `sc_widget.dart`, `customer_widget.dart`, `tailor_item_widget.dart`, `inspector_item_widget.dart`.
8. **FAB** bottom-right for the primary create action on each tab (Add SC, Add PC, Train Customer, Bulk Order, Add tailor, Add task…), same visibility rules (e.g. Add SC only for Admin).
9. **Back behaviour**: browser/Android back from a tab root goes to the first tab, then prompts exit (mirrors `Utils.onDashboardExit`); detail screens are full-screen pages with a back arrow, not dialogs.
10. **Infinite scroll** (Flutter paginates on scroll) instead of numbered pagination on mobile.

Desktop (≥ 1024 px) keeps the sidebar, but its **top section lists the same tabs in the same order**, then a "More" section with drawer items, then web-only extras. Tablet uses the bottom bar.

---

## 7. Implementation phases

### Phase 0 — Lock the reference (2–3 days)
- Write `persona-ia.json`: for each persona, tabs (label, icon, Flutter view, web component), drawer items, visibility rule, FAB rules, counters shown. This becomes the single navigation source replacing `MODULES` in `registry.js`.
- Control-level pass on the ~60 views reachable from the tabs above (cards, field order, actions, empty-state copy). The existing `source-view-web-traceability.csv` gives file coverage; add a `ui_parity_state` column.
- Capture reference screenshots of each Flutter dashboard (run the Flutter app on web/simulator against staging) for visual acceptance.
- Get decisions D1–D5 (section 9).

### Phase 1 — Stats backend (3–4 days)
- Migration: `v1_order_stats`, `v1_people_order_counts`, criteria/overdue/critical filter parity, JW earned/efficiency, tailor active/yet-to-begin.
- pgTAP/SQL tests per role scope against the Rails definitions; compare numbers against the legacy API on the staging snapshot for 1 account per role.
- SDK + types.

### Phase 2 — Persona shell & navigation (4–5 days)
- `PersonaShell`: bottom bar (mobile/tablet), right drawer, app bar, desktop sidebar driven by `persona-ia.json`.
- Per-persona landing tab (Customer → Products, Cutting Master → queue, etc.).
- Tab keep-alive, deep links (`/squad/t/sales-coordinators/123`), back handling, `canVisit` derived from the same registry.
- Fix Admin Production/Job-work mismatch.

### Phase 3 — Shared parity components (4–5 days)
- `OrderCounters` (tappable tiles, role-gated, horizontal scroll), `FilteredOrdersPage` (status + custom range + search), `PendingCompletedTabs` with counts, `SearchHeader` with count + refresh, `PersonCard` with pending/completed counts and Edit/View Details, `OrderCard` (Flutter field order), `Fab`, pull-to-refresh, infinite list.

### Phase 4 — Admin dashboard (4–5 days)
- A1–A14: Customers/Distributor tabs, **Sales Co-ord.** tab + detail, **Prod. Co-ord.** tab + detail, Products tabs, To Do's, drawer screens (Personas, Force Complete search, Change SC bulk, Customers Request, Sync Products, Catalogues, Roles & Goals, Promotions).

### Phase 5 — SC, PC, Customer, Dealer (5–6 days)
- S1–S5, P1–P5 (incl. PC Customers tab after confirming backend read scope, Factory tab + detail, Pending Criteria screen), C1–C2, L1–L3.

### Phase 6 — Factory-side personas (5–6 days)
- F1–F4, D1, I1, X1, J1–J2 (Tailors/Delivery tabs, staff queues, leaderboard preview, weekly report button, efficiency gauge).

### Phase 7 — Detail-screen alignment (3–4 days)
- Order detail, customer detail, factory detail, tailor detail, job-sheet/inspection detail: section order, labels, action placement per role.

### Phase 8 — Acceptance (3–4 days)
- For each of the 11 personas, on 390×844 and 1440×900: tab labels/order, drawer items, counters (numbers equal to legacy API on the same snapshot), each counter drill-down, FAB visibility, back behaviour.
- Side-by-side screenshot review against Phase 0 references; sign-off by one real user per persona team ("no relearning" check: can they complete their top 3 daily tasks without guidance).
- Regression: existing Printing Tracker and current Squad workflow suites.

**Rough total: 6–8 weeks for one engineer; ~4 weeks with two (backend+shell in parallel with components).**

---

## 8. Acceptance criteria (definition of done)

1. Every persona's primary navigation matches section 2's Flutter column exactly (labels, order, visibility, feature flags).
2. Every Flutter counter in section 3 is present for the same roles, numbers match the legacy definition on the same data, and tapping drills into the right filtered list.
3. Admin can open *Sales Co-ord.* and *Prod. Co-ord.* tabs, see per-coordinator pending/completed counts, open a coordinator and see their counters and orders.
4. Every drawer item from `drawer_view.dart` is reachable from the right-side menu for the same roles.
5. On a phone, no persona's main daily task needs the hamburger sidebar; bottom bar + FAB + drawer cover it.
6. No regression in existing workflows or authorization (backend remains the authority; UI only hides/shows).

---

## 9. Decisions needed

| ID | Question | Recommendation |
|---|---|---|
| D1 | "Completed" includes cancelled (Flutter) or not (web)? | Flutter definition, with "incl. n cancelled" hint |
| D2 | Where do web-only modules go (Reports, Documents, Notifications, Administration)? | Drawer "More" section; Admin keeps an Insights page |
| D3 | Should PC get the Customers tab (Flutter had it; web registry excludes role 2)? | Yes — confirm backend read scope |
| D4 | Desktop: switch to Flutter's tab layout too, or keep sidebar with Flutter ordering? | Sidebar with identical ordering on desktop; bottom bar on mobile/tablet |
| D5 | Replace web Overview landing for all personas with Flutter's first tab? | Yes, except Admin (optional Insights) |

## 10. Risks
- Stats from Supabase may differ from Rails where data was migrated with different status semantics — Phase 1 reconciliation against the legacy API is mandatory before UI work is signed off.
- Keep-alive tabs increase memory on low-end phones; cap cached tabs to the persona's bottom-bar set.
- Shared pages (OrdersPage, PeoplePage) are used by many personas; wrap them in persona tab components rather than forking, to avoid regressions.

---

## 11. Implementation status (21 Nov 2026)

All UI work is behind `?persona=1` (remembered in the browser; `?persona=0` turns it off). Nothing has been verified in a browser or against staging data; 40 unit tests and the production build pass.

| Phase | Status | Where |
|---|---|---|
| 0 Reference spec | Done | `apps/admin/src/squad/navigation/persona-ia.json` |
| 1 Stats backend | Written, tested on stub DB only; **not applied** | `20261121090000_squad_order_stats_parity.sql`, `20261121100000_squad_order_producer_filter.sql`, SDK `orderStats` / `peopleOrderCounts` |
| 2 Shell/navigation | Done | `navigation/personaNav.js`, `PersonaChrome.jsx`, `SquadApp.jsx` |
| 3 Shared components | Done | `components/parity/*`, `features/filteredOrders` |
| 4 Admin | Mostly done | `features/coordinators`, `customers/ChangeScPage` |
| 5 SC / PC / Customer / Dealer | Mostly done | `orders/OrderBoard`, customer tabs, Factory tab |
| 6 Factory personas | Done (see gaps) | `features/factory` |
| 7 Detail screens | Order detail header/actions + customer counters | `orders/orderDetailModel.js`, `CustomersPage` |
| 8 Acceptance | **Not started** (needs staging logins per persona) | — |

### Known gaps carried to acceptance
- Apply both migrations to staging; regenerate `tools/canto-sync/baselines/*-domain-access.json`; reconcile counter numbers against Rails per role.
- Production Coordinator Customers tab (D3): PC cannot read customer records today.
- Admin sidebar shows Production / Job work that deny Admin (default navigation, unchanged).
- Sync Products own screen; To Do's Pending/Completed + All/Assign by me/Assign to me layout; Pending Order Criteria dedicated screen; Sales Coordinator milestone progress bar.
- Order list lacks customer name (cards omit it); Job Worker / dispatch / cutting counters are informational (status models not filterable); Delivery shortcuts open the factory-wide queue, not a per-person queue; Inspector size-wise counter.
- Order detail: only the header block and action buttons are aligned; items / criteria / branding / fabric / tailor-progress sections keep the web layout. Tailor, factory and job-sheet detail screens not yet reviewed control by control.
