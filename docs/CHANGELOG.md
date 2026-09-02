# Changelog

## 2026-09-02 — Inventory Adjust looked stuck + Step 5 Uniware bridge

- **Bug fix:** Inventory Adjust wrote facility stock, but the list kept the old qty. List reads `inventory_sku_availability`, not `inventory_skus.stock_qty`. Silent refresh after Adjust never reloaded that map, and OUT/ADJUST ignored the warehouse you picked (wrote the SKU home bin). Fix: `refresh()` awaits `loadAvailability()`; Adjust uses the chosen warehouse; realtime also watches `inventory_facility_stock`.
- **Feature:** One Source of Truth Step 5 Uniware bridge. Read-only `uni_inventory_mirror` / `uni_sale_order`. Cross-boundary stock only via `uni_transfer` + Uniware `inventory/adjust`. Mirror qty never enter Stock Ledger or Inventory on-hand. Admin tab **Uniware Bridge** (`ops_uniware`). Edge `uniware-bridge` (admin JWT). Secrets stay on the function, not in the SPA.
- **Files:** `src/inventory/InventoryDataContext.jsx`, `src/inventory/InventoryDashboard.jsx`, `src/realtimeUtils.js`, `supabase/migrations/20260902180000_step5_uniware_bridge.sql`, `supabase/functions/uniware-bridge/index.ts`, `src/UniwareBridgePanel.jsx`, `src/uniwareUtils.js`, `src/dashboardSidebarConfig.js`, `src/App.jsx`
- **Migration:** applied on **staging** (`scvojtvgnkmbupvyslmb`) only. Seeds marker location `UNIWARE-ECOM` (`owner_system=uniware`). Production untouched.
- **Deferred:** live Uniware pull needs edge secrets `UNIWARE_BASE_URL` / `UNIWARE_USERNAME` / `UNIWARE_PASSWORD` / `UNIWARE_FACILITY`. Marketplace labels/manifests stay in Uniware. Ecom orders stay in `uni_sale_order` (not mixed into `so_order`).
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, API.md, SECURITY.md, UNIWARE_BOUNDARY.md, ENVIRONMENTS.md.

## 2026-09-02 — Step 4 billing & receivables: invoice from dispatch, credit notes, ageing

- **Feature:** One Source of Truth Step 4 money path. `bill_invoice` / `bill_invoice_line` generated from a dispatch (one invoice per dispatch); gapless `INV/<FY>/nnnn` per entity × GSTIN × FY; HSN from SKU, GST from the order line, IGST vs CGST+SGST from place of supply vs GSTIN state. Invoice immutable once numbered — corrections are `bill_credit_note`. `ar_receipt` + `ar_allocation` all-or-nothing; allocation cannot exceed invoice outstanding or receipt amount. Ageing view `ar_invoice_outstanding_view` (NOT DUE / 0–30 / 31–60 / 61–90 / 90+ / PAID); due date = invoice date + party credit days. `ar_customer_ledger_view`. `ar_followup` collections trail. Soft credit warning on Sales Order confirm (`ar_credit_check`); hard block deferred until department roles.
- **UI:** new admin-only tab **Billing & AR** (`ops_ar`): generate invoice, invoice detail + credit note, receipts with allocations, ageing buckets + customer balances, follow-ups. Existing Billing tab untouched.
- **Files:** `supabase/migrations/20260902170000_step4_billing_receivables.sql`, `src/billingArUtils.js`, `src/BillingArPanel.jsx`, `src/SalesOrdersPanel.jsx`, `src/dashboardSidebarConfig.js`, `src/App.jsx`
- **Migration:** applied on **staging** (`scvojtvgnkmbupvyslmb`) only. Smoke (rolled back): intra-state CGST split, inter-state IGST, order → invoiced, duplicate invoice blocked, invoice edit blocked, credit over-outstanding blocked, over-allocation blocked.
- **Deferred:** GSP e-invoice IRN/QR, e-way bill API, Tally XML daily batch + recon screen, distributor incentive engine, `bill_quote`/proforma — need vendor/CA picks (see DECISIONS).
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Step 3 sales orders: order → reserve → dispatch, job work, SLA

- **Feature:** One Source of Truth Step 3. `so_order`/`so_line` with a DB status machine (draft → confirmed → in_production → ready → partially_dispatched → dispatched → invoiced → closed, + cancelled); confirming assigns a gapless `SO/<FY>/nnnn` and reserves available stock (`so_allocate`, partial allowed, re-runnable); **ready requires full reservation** and **dispatch can never exceed reserved qty** (roadmap laws, enforced in the DB). `so_dispatch`/`so_dispatch_line` are append-only, written only by `so_post_dispatch` (consumes reservations, posts `dispatch` movements, rolls the order status). `jw_job` job work (printing/embroidery/sublimation/stitching): issue = challan out (transfer to worker location), receive = outputs in (`production_out`) + consumed inputs burned (`consumption`); leftover input at the worker location is the visible loss. `sla_policy` stage targets measured in business hours (Mon–Sat 09:30–18:30 IST, `ops_business_hours_between`) via `so_sla_view`. Views `so_open_view`, `so_sla_view`. Counter sales = `channel='counter'` on the same table.
- **UI:** new admin-only tab **Sales Orders** (`ops_sales`, Ops Platform group): Orders (create draft, confirm & reserve, allocate, start production, mark ready, dispatch dialog capped at reserved, cancel with reason), Dispatches list, Job work (create/issue/receive/close), SLA (target editor + breach table).
- **Files:** `supabase/migrations/20260902150000_step3_sales_orders.sql`, `src/salesOrdersUtils.js`, `src/SalesOrdersPanel.jsx`, `src/dashboardSidebarConfig.js`, `src/App.jsx`
- **Migration:** applied on **staging** (`scvojtvgnkmbupvyslmb`) only. Smoke test (rolled back): partial allocation, ready-block, over-dispatch block, append-only dispatches, job-work round trip, SLA hours, drift 0.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Support desk tables readable in Dark Mode

- **Issue:** Support Enquiry / Complaints table values vanished in Dark Mode.
- **Fix:** Priority row tints and status/priority badges use dark backgrounds and `text-foreground` so light inherited panel text is not on pale `*-50` rows.
- **Files:** `SupportTicketDesk.jsx`, `EnquiryDetailDialog.jsx`, `SupportDelayAlertCard.jsx`
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Issue column after Status, View Issue on the same line

- **Issue:** Issue sat before Status. View Issue sat under the type/floor line.
- **Fix:** Columns Name | Status | Issue | Date. Issue cell is one line: `Power Cut - 2nd Floor → View Issue`.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Open Tickets Issue column shows type and floor

- **Issue:** Issue column was only **View Issue**, and it sat before Name, away from Status.
- **Fix:** Columns are Name | Issue | Status | Date. Issue cell shows `Power Cut - 2nd Floor` from their picks; **View Issue** sits under that line. Same on Resolved. No floor → type only.
- **Files:** `InternalSupportPlatformPanel.jsx`, `internalSupportIssueUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Open Tickets tab; Raise an Issue is a button

- **Issue:** Raise an Issue was its own tab. History name did not match tickets.
- **Fix:** Tabs are **Open Tickets** and **Resolved**. **Raise an Issue** is a button on Open Tickets. The button opens a Dialog with issue types, Floor, Comment, Submit, and thank-you.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-02 — Internal Support link says View Issue

- **Issue:** History and Resolved Issue column said **View order**.
- **Fix:** Link text is **View Issue**. Dialog title stays View Issue.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DECISIONS.md.

## 2026-09-02 — Internal Support Resolved tab

- **Issue:** Resolved tickets stayed in History. Admin could still change Status after Resolved.
- **Fix:** Third tab **Resolved** (admin and non-admin). History keeps Open / In Progress / Closed. Marking Resolved moves the row. Resolved tab is read-only status. Filters: From, To, Search, View / page. Name filter admin only. Staging RLS: update only when current status is not Resolved.
- **Files:** `InternalSupportPlatformPanel.jsx`, `internalSupportIssueUtils.js`, `supabase/migrations/20260902054226_internal_support_issues_lock_resolved_status.sql`
- **Migration:** staging `scvojtvgnkmbupvyslmb` only. Not production.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md, SECURITY.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-02 — Internal Support History scoped by role

- **Issue:** Every signed-in staff could see all History rows, change Status, and use the Name filter.
- **Fix:** Admin sees every issue, can change Status, and gets the Name filter. Non-admin sees only own `raised_by` rows, Status as a read-only mark (admin’s current value), no Name filter. Staging RLS matches: select own or admin; update admin only.
- **Files:** `InternalSupportPlatformPanel.jsx`, `InternalSupportHistoryFilters.jsx`, `internalSupportIssueUtils.js`, `App.jsx`, `supabase/migrations/20260902051939_internal_support_issues_rls_own_and_admin.sql`
- **Migration:** staging `scvojtvgnkmbupvyslmb` only. Not production.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md, SECURITY.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-02 — Internal Support Status dropdown matches tracker icons

- **Issue:** Status Select showed names only in the closed box. List icons were Lucide lines, not colorful symbols like Production Tracker.
- **Fix:** Same Select pattern as `OrderListStatusCell`: `SelectValue` children = emoji + name. List items match. Open 📂, In Progress ⏳, Resolved ✅, Closed 🔒. Names unchanged.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Internal Support Status is one dropdown

- **Issue:** Status showed a Badge box and a Select box for the same value.
- **Fix:** One shadcn Select. Trigger and list show icon + Open / In Progress / Resolved / Closed in that box.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Internal Support History filters, status marks, View order

- **Issue:** History had no From/To/Search filters. Status was plain text. View Issue was an outline Button.
- **Fix:** Filters above the table: From, To, Clear, Search, Name, View / page. Status Badge + icon (Open gray, In Progress primary, Resolved outline check, Closed red). Issue cell is underlined **View order**.
- **Files:** `InternalSupportPlatformPanel.jsx`, `InternalSupportHistoryFilters.jsx`, `internalSupportIssueUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-02 — Internal Support History records each Submit

- **Issue:** Submit did not save. No History of who raised what.
- **Fix:** Staging table `internal_support_issues`. **History** tab: View Issue, Name, Status (Open / In Progress / Resolved / Closed), Date. Submit writes the row. Status Select updates it.
- **Files:** `InternalSupportPlatformPanel.jsx`, `internalSupportIssueUtils.js`, `App.jsx`, `supabase/migrations/20260902044605_internal_support_issues.sql`
- **Migration:** staging `scvojtvgnkmbupvyslmb` only. Not production.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md, DATABASE.md, SECURITY.md.

## 2026-09-02 — Internal Support Raise an Issue tab

- **Issue:** Issue form sat on the panel with no tab.
- **Fix:** shadcn Tabs. **Raise an Issue** holds the heading, issue Buttons, Floor, Comment, Submit, and thank-you Alert. Same rules as before.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.
## 2026-09-02 — Step 2 procurement: PO → GRN → QC → bill (three-way match) → payment

- **Decisions (user):** QC gate ON by default (vendor-item `qc_exempt` skips it, fallback `crm_party.default_qc_required`); PO/bill approval = CEO / admin access; tolerances editable (`po_settings` singleton + `crm_vendor_item.over_receipt_pct` override).
- **DB (staging):** migration `20260902120000_step2_procurement.sql` — `po_settings`, `po_purchase_order`/`po_line` (state machine draft→approved→partially_received→fulfilled→closed, short_closed/cancelled; status flips only via functions, enforced by trigger + transaction-local flag), `po_grn`/`po_grn_line` (posted GRNs immutable except QC counters), `ap_bill`/`ap_bill_line` (unique vendor+bill_no; one bill line per GRN line — double billing structurally impossible), `ap_debit_note`, `ap_payment`/`ap_payment_allocation` (append-only, function-only writes). Functions: `po_approve` (gapless `PO/<FY>/0001` via auto-provisioned `core_sequence`), `po_cancel`, `po_short_close`, `po_close`, `po_post_grn` (over-receipt tolerance, QC routing to qc_hold/good, PO counters — over-receipt on one line cannot mask a short line), `po_record_qc`, `ap_approve_bill` (three-way match: billed ≤ received hard stop, rate variance needs override reason; MSME micro/small due-date cap), `ap_cancel_bill`, `ap_record_payment` (allocation ≤ outstanding). Views: `po_active_view`, `ap_bill_outstanding_view`, `ap_vendor_ledger_view`, `po_vendor_performance_view` (all `security_invoker`). Smoke-tested via rolled-back transaction — all 7 guards held, drift 0.
- **Ledger upgrade:** `inv_movement` gains `to_state` so QC can flip state at the same location (qc_hold → good/damaged); `inv_post_movement` takes optional `p_to_state`; drift recompute credits destination state. Stock Ledger tab shows `state → to_state`.
- **UI:** new admin-only **Procurement** tab (`ops_procurement`, Ops Platform group): PO list/create/detail (approve, receive GRN, QC queue, short close, cancel, close), Bills (record against unbilled GRN lines, approve with variance-override path, MSME badge), Payments & ledger (vendor ledger, ageing, record payment with allocations), Settings (editable tolerances). `check:ui` passed.
- **Fixes during build:** `ap_approve_bill` referenced `cat_sku.code` (column is `sku_code`); PO fulfilment originally summed raw pending so over-receipt could mask short lines.
- **Untouched:** Scott API section, existing Purchase Order voucher tab (`purchase_order`) — the new tab is `ops_procurement`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DECISIONS.md, DEBUGGING.md.

## 2026-09-01 — Step 1 stock ledger: append-only movements + Stock Ledger tab

- **DB (staging):** migration `20260901191500_step1_stock_ledger.sql` — `inv_movement` (append-only, trigger-enforced), `inv_balance` (locked upserts, never negative), `inv_reservation`, cycle-count tables, `inv_drift_alert`; functions `inv_post_movement`, `inv_reserve`/`inv_release_reservation`, `inv_kit_build`/`inv_kit_break`, `inv_count_post`, `inv_recompute_drift` (pg_cron nightly 02:30 IST). All stock mutations in SECURITY DEFINER functions with `FOR UPDATE`. Smoke-tested via rolled-back transaction — all guards held, drift 0.
- **UI:** new admin-only **Stock Ledger** tab (`ops_stock`, Ops Platform group): stock by location (on-hand/reserved/available), movement history, post-movement dialog (GRN/transfer/issue/return/adjustment±), drift banner. `check:ui` passed.
- **Untouched:** Scott API section, existing Inventory tab, Scott stock integration.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DECISIONS.md, DEBUGGING.md.

## 2026-09-01 — Platform Masters tab: screens + CSV import with dedupe report

- **What:** New admin-only sidebar tab **Platform Masters** (`ops_masters`, group "Ops Platform") over the Step 0 tables: Parties, SKUs, Entities & GSTINs, Locations — list/search/create/edit dialogs, plus CSV import for Parties and SKUs with a dedupe report (New / Already in masters / Duplicate in file / Invalid; only New rows import). Templates downloadable.
- **Files:** `MastersPanel.jsx`, `MastersImportDialog.jsx`, `mastersUtils.js` (standalone CSV parser — no dependency on frozen Scott code), `dashboardSidebarConfig.js`, `App.jsx`.
- **Guard:** distinct from the Scott API "Masters" tab, which is untouched. `check:ui` passed.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DATABASE.md, DEBUGGING.md.

## 2026-09-01 — Step 0 masters schema on staging (One Source of Truth)

- **What:** Migration `20260901180000_step0_masters_and_entities.sql` — 19 tables: `core_entity`/`core_gstin`/`core_sequence`/`core_location`, `cat_*` catalog (brand→style→colour→sku, kits, channel listings, GST slabs), `crm_*` party master (+GSTIN, address, contact, bank, vendor-item), `hr_employee`, `audit_log` with triggers on every master. `core_next_sequence()` gapless numbering (locked, smoke-tested TST/0001→0002). RLS: read authenticated, write admin; bank + audit admin-only.
- **Where:** STAGING only (`scvojtvgnkmbupvyslmb`). No UI, no data except 8 seeded brands. Scott API untouched.
- **Docs:** DATABASE.md (table reference + rollback), DECISIONS.md (6 schema decisions), FLOWCHARTS.md (ERD), CHANGELOG.md.

## 2026-09-01 — One Source of Truth roadmap + laws + Cursor rule (docs only)

- **What:** Captured the full Scott Ops Platform build roadmap in [ONE_SOURCE_OF_TRUTH_ROADMAP.md](./ONE_SOURCE_OF_TRUTH_ROADMAP.md); the nine binding laws + six-question gate in [laws.md](./laws.md); new always-apply rule `.cursor/rules/single-source-of-truth.mdc`.
- **Scott API freeze:** the rule and laws hard-guard `src/scott/**`, `scott_customers`/`scott_reports`/`scott_masters` tabs, `scott-*` edge functions, and the existing inventory-fetch integration — never modified by roadmap work.
- **No code / schema change** in this pass. Step 0 (masters) starts only after scope confirmation.
- **Documentation updated:** CHANGELOG.md, OVERVIEW.md, laws.md, ONE_SOURCE_OF_TRUTH_ROADMAP.md.

## 2026-09-01 — Hide Floor for Food, Asset, Biometric, Lost belongings

- **Issue:** Floor still showed for Food / Issue with Asset / Issue with Biometric / Lost Personnal Belongings.
- **Fix:** Those four hide **Select your Floor**. Only Comment. If they also pick Internet (or any other issue), Floor shows again and is required.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-01 — Internal Support thank-you after Submit

- **Issue:** Submit showed a check, **Submitted**, and “ticket save comes next.”
- **Fix:** After Submit, shadcn Alert only shows: **Thank you. Your issue has been submitted and the concerned team will look into it shortly.** No check icon, no Submitted heading.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-09-01 — Internal Support floor required except four issue types

- **Issue:** Comment showed after any issue. Floor was always required, even for Food / Asset / Biometric / Lost belongings.
- **Fix:** Comment + Submit wait for a floor when any picked issue needs a floor. Floor not required for **Food**, **Issue with Asset**, **Issue with Biometric**, **Lost Personnal Belongings**. Mix with Internet (etc.) still needs a floor.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-01 — Internal Support Select your Floor

- **Issue:** After issue Buttons, no floor pick.
- **Fix:** Heading **Select your Floor**. shadcn Buttons: Ground Floor, 1st–5th Floor. One floor at a time. Submit needs a floor.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-01 — Internal Support Comment shows after one issue pick

- **Issue:** Comment box showed before anyone picked an issue.
- **Fix:** Comment (and Submit under it) only render after at least one issue Button is selected. Clear all picks → Comment hides again. Typed comment stays in memory if they pick again.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-01 — Internal Support comment box and Submit

- **Issue:** After issue Buttons, no place to explain the problem, and no Submit.
- **Fix:** shadcn Textarea **Comment** under the Buttons (`Explain the issue in detail`). **Submit** under that. Need at least one issue and a comment. Local only; form clears; Alert says ticket save comes next.
- **Files:** `InternalSupportPlatformPanel.jsx`, `src/components/ui/field.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md, SECURITY.md.

## 2026-09-01 — Internal Support issue buttons are multi-select

- **Issue:** Issue Buttons only kept one pick. Click a second option, first one dropped.
- **Fix:** Click toggles. Many Buttons can stay filled at once. Click again to clear that one. Still local only; no ticket save.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-01 — Internal Support Platform issue buttons

- **Issue:** Internal Support Platform was an empty Card. Need a heading plus clickable issue types.
- **Fix:** Heading **Facing an issue? Select the option below that best describes your problem.** Under it, shadcn outline Buttons: Internet, Power Cut, Water Issue, Machinery, Food, Issue with Asset, Lift not working, Issue with Biometric, Floor Hygeine, Lost Personnal Belongings. Click highlights the pick. No ticket save yet.
- **Files:** `InternalSupportPlatformPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-09-01 — Tools Internal Support Platform panel

- **Issue:** Tools had no Internal Support Platform. Need a panel with a support symbol.
- **Fix:** Tools item **Internal Support Platform** with LifeBuoy icon. Opens a shadcn Card workspace. Separate from Support (Enquiry). Grantable like other Tools tabs.
- **Files:** `dashboardSidebarConfig.js`, `DashboardAppSidebar.jsx`, `dashboardSidebarIcons.jsx`, `InternalSupportPlatformPanel.jsx`, `App.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md, SECURITY.md.

## 2026-08-31 — Job sheet Delivery required on is today or later

- **Issue:** Create Job sheet and Create Sample Jobsheet let people pick past days for Delivery required on.
- **Fix:** Calendar only today and future. Save also blocks a past date. Same rule on both forms.
- **Files:** `CreateJobSheetForm.jsx`, `jobSheetUtils.js`, `App.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-31 — Production / Sampling tabs match All / Complete pill

- **Issue:** Production Tracker and Sampling Tracker buttons used apart green / orange. User wants the same look as All orders / Complete orders, no extra colour.
- **Fix:** Both rows use the default muted shadcn TabsList pill. Green / orange and bold-apart styling removed.
- **Files:** `ProductionTrackerPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-31 — Hide Due In on Sampling Complete orders

- **Issue:** Sampling Complete still showed Due In. Finished jobs do not need a clock.
- **Fix:** Due In column only on Sampling **All orders**. Complete orders table has no Due In.
- **Files:** `App.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, FLOWCHARTS.md.

## 2026-08-31 — Sample SLA follows Delivery Required On, else 2 days

- **Issue:** Due In always used 2 days from save. User wants the filled **Delivery required on** date when present.
- **Fix:** If `due_date` is set, deadline is end of that day. If blank, keep 2 days from save. Create Sample Jobsheet does not require Delivery required on. Production job sheet still requires it.
- **Files:** `sampleJobSheetSlaUtils.js`, `CreateJobSheetForm.jsx`, `App.jsx`, `orderPendingUtils.js`, `OrderDetailPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-31 — Sampling Tracker Due In column after Order date

- **Issue:** Due In only showed in View Sample Order. List after Order date had no timeline.
- **Fix:** Sampling Tracker table adds **Due In** after Order date. Same 2-day clock: live `HH:MM Hrs Left` or red **SLA Breached**. Closed samples show —. Production Tracker still has Handover, no Due In.
- **Files:** `SampleJobSheetDueIn.jsx`, `App.jsx`, `LinkedOrdersTabPanel.jsx` (existing extraColumn)
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, OVERVIEW.md.

## 2026-08-31 — Sampling Tracker 2-day SLA in View Sample Order

- **Issue:** Sample jobs had no due clock after save. Need 2 days to reach Dispatched Successfully, with a live countdown and a red SLA Breached mark if late.
- **Fix:** View Sample Order **Due In** starts at save (`created_at` + 48h). Open jobs show `HH:MM Hrs Left` (Badge colours by time left). Past the deadline and not Dispatched Successfully → red **SLA Breached**, timer gone. Dispatched Successfully / complete hides Due In. No new DB column. Production Tracker unchanged.
- **Files:** `sampleJobSheetSlaUtils.js`, `SampleJobSheetDueIn.jsx`, `OrderDetailPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-31 — Production / Sampling tab colours

- **Issue:** Production Tracker and Sampling Tracker tab buttons looked the same.
- **Fix:** Production = very light green. Sampling = very light orange. Selected tab text is bold. All / Complete pill unchanged.
- **Files:** `ProductionTrackerPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-31 — Sampling Complete locks Dispatched Successfully

- **Issue:** Sampling Complete only followed Mark as complete. Dispatched Successfully stayed on All. Complete still let users change Status.
- **Fix:** Status **Dispatched Successfully** or **Mark as complete** moves the sample to Complete, shows Dispatched Successfully, and Status becomes a badge (not a dropdown). Viewers write status only (RLS blocks `is_complete`); admin Mark as complete writes both.
- **Files:** `sampleJobSheetStages.js`, `orderTabUtils.js`, `App.jsx`, `OrderListStatusCell.jsx`, `OrderDetailPanel.jsx`, `globalSearchUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md, FLOWCHARTS.md.

## 2026-08-31 — Production and Sampling All / Complete orders tabs

- **Issue:** Production Tracker and Sampling Tracker had no Complete list. Finished jobs stayed mixed with open ones, or vanished.
- **Fix:** Same All orders / Complete orders pill (Printing style) under both trackers. Production / Sampling switch sits apart so it does not look like that pill. Complete Production and Complete Sampling stay separate lists. Mark as complete on a tracker job opens that tracker’s Complete tab.
- **Files:** `ProductionTrackerPanel.jsx`, `App.jsx`, `orderTabUtils.js`, `globalSearchUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-31 — Sampling Tracker status pipeline

- **Issue:** Sampling Tracker Status used printing/production dropdown options.
- **Fix:** Sampling-only stages with the same Select UI and symbols: Pattern Making, Sample Cutting, Sample Stitching, Trim + Iron, Branding, QC, Packaging, Ready to Dispatch, Dispatched Successfully. New sample jobs start at Pattern Making. Staging constraint updated.
- **Files:** `sampleJobSheetStages.js`, `OrderListStatusCell.jsx`, `OrderDetailPanel.jsx`, `OrderStatusBadge.jsx`, `stickerOrderUtils.js`, `App.jsx`, `orderPendingUtils.js`, `notificationsUtils.js`, `supabase/migrations/20260831065000_sample_job_sheet_statuses.sql`
- **Migration:** staging `20260831065000_sample_job_sheet_statuses.sql`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md.

## 2026-08-31 — Sampling Tracker history list after Create Sample Jobsheet

- **Issue:** Saved sample job sheets had no list. Sampling Tracker was only a filter bar.
- **Fix:** Same `LinkedOrdersTabPanel` table as Production Tracker. Sampling-only words: **View Sample Order**, **Sample Order** badge, **Order date** from job-sheet `order_date`. No Production jobs count, no Qty, no Handover to printing. After save, stay on Sampling Tracker.
- **Files:** `LinkedOrdersTabPanel.jsx`, `ProductionTrackerPanel.jsx`, `App.jsx`, `orderTabUtils.js`, `orderPendingUtils.js`, `OrderViewActionCell.jsx`, `SampleJobSheetOrderIdBadge.jsx`, `globalSearchUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md, DATABASE.md.

## 2026-08-31 — Create Sample Jobsheet (SA-0001 sequential, no Total quantity)

- **Issue:** Create Sample Jobsheet had no form. Need the Production job-sheet layout, without Total quantity, with sequential SA-#### IDs.
- **Fix:** Same `CreateJobSheetForm` layout and Cancel / Save. Hide Total quantity. Allocate `SA-0001` then `SA-0002` from existing sample rows. Staging kind `sample_job_sheet` + unique `order_id`.
- **Files:** `CreateJobSheetForm.jsx`, `App.jsx`, `ProductionTrackerPanel.jsx`, `sampleJobSheetUtils.js`, `orderTabUtils.js`, `jobSheetUtils.js`, `sidebarTabActivity.js`, `supabase/migrations/20260831060510_add_order_kind_sample_job_sheet.sql`
- **Migration:** staging `20260831060510_add_order_kind_sample_job_sheet.sql`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md, DECISIONS.md, SECURITY.md, OVERVIEW.md, FLOWCHARTS.md.

## 2026-08-31 — Sampling Tracker filter bar (From, To, Clear, Create Sample Jobsheet, View)

- **Issue:** Sampling Tracker was blank. User wants the same top controls as Production Tracker.
- **Fix:** Reuse `OrdersListFilters` + outline **Create Sample Jobsheet**. No job-sheet form or prefill. View N / page works locally.
- **Files:** `ProductionTrackerPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-31 — Production Tracker has Production / Sampling tabs

- **Issue:** Production Tracker was one list. User wants Production Tracker and Sampling Tracker tabs.
- **Fix:** Same Printing-orders `Tabs` / `TabsList` / `TabsTrigger` format. Current job-sheet list stays under **Production Tracker**. **Sampling Tracker** is empty. List UI and `cn()` row classes unchanged.
- **Files:** `ProductionTrackerPanel.jsx`, `App.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-24 — All PO Orders status dropdown includes Completed

- **Issue:** Admin status dropdown on All PO Orders had no Completed.
- **Fix:** Add Completed. Admin pick it → row leaves All PO Orders and shows in PO History. History still has no picker.
- **Files:** `PurchaseOrderHistoryTable.jsx`, `purchaseOrderHistoryUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md, SECURITY.md, FLOWCHARTS.md.

## 2026-08-24 — PO status change is admin-only; none on History

- **Issue:** Status change must be admin-only. History must never offer a status pick.
- **Fix:** All PO Orders: admin gets Pending / PO sent / PO Approved dropdown. Non-admin see a badge. Update checks `profiles.role`. PO History always shows Completed badge only.
- **Files:** `App.jsx`, `PurchaseOrderPanel.jsx`, `PurchaseOrderHistoryTable.jsx`, `purchaseOrderHistoryUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md, SECURITY.md.

## 2026-08-29 — Redeploy develop so Vercel picks up Kundan Scott API

- **Why:** Kundan already merged Scott API + edit-prefill fix into `develop` (`ea91dcc`, `e316dd2`). A later push was a no-op (`Everything up-to-date`), so Vercel may not have rebuilt.
- **This commit:** New SHA on `develop` to trigger Git-connected Vercel. No app behavior change.
- **Documentation updated:** CHANGELOG.md, ENVIRONMENTS.md.

## 2026-08-22 — Purchase Order tab label All PO Orders; tabs sit apart

- **Issue:** First tab said Open POs. The three tabs sat in one attached pill.
- **Fix:** Label is **All PO Orders**. TabsList is transparent with gap so each name is its own button.
- **Files:** `PurchaseOrderPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-22 — Generate is PO sent; History is Completed only; open panel shows open POs

- **Issue:** Generate wrote Pending. History showed every PO. Panel opened on History. Create sheet was too easy to hit first.
- **Fix:** Generate writes **PO sent**. Open panel on **Open POs** (Pending / PO sent / PO Approved). **Create new PO** mounts the heading + table. **PO History** lists only **Completed** after the backend updates status.
- **Files:** `PurchaseOrderPanel.jsx`, `PurchaseOrderHistoryTable.jsx`, `purchaseOrderHistoryUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-22 — Purchase Order opens on History; status is Completed only

- **Issue:** Opening Purchase Order landed on Create. History hid four statuses. User wants History first and Status = Completed only.
- **Fix:** Default sub-tab is **PO History** with all History details. Status column shows only **Completed**. **Create new PO** still shows the PURCHASE ORDER heading and table.
- **Files:** `PurchaseOrderPanel.jsx`, `PurchaseOrderHistoryTable.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-22 — PO History From/To, search, coordinator, View N / page

- **Issue:** PO History listed every generated PO. No date range, search, coordinator pick, or page size.
- **Fix:** Filter bar on History: **From** / **To** (PO date, inclusive), **Clear** (dates only), **Search** (exact match on voucher seq after last `/`, full PO number, supplier, or coordinator), **Coordinator** dropdown (or All coordinators), **View N / page** (default 10). Table paginates the filtered list.
- **Files:** `PurchaseOrderHistoryTable.jsx`, `PurchaseOrderHistoryFilters.jsx`, `purchaseOrderHistoryUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-22 — View PO Print matches Create Print

- **Issue:** View PO Print did not follow Create new PO Print. Sheet stayed trapped in the dialog. C23 easy to miss.
- **Fix:** View PO Print uses the same A4 rules: print the open sheet, fill the page, show C23. Dialog transform/overflow flatten on print.
- **Files:** `PurchaseOrderHistoryTable.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Print fills the A4 page again; C13 stays complete

- **Issue:** Packed print made the table look small. User wants the old full-page fill, with C13 fully visible.
- **Fix:** Print again uses the 210mm × 297mm sheet (`@page` A4, margin 0). C table stretches like the screen. C13 keeps full R2 height. C23 overlays C13 bottom-right so it does not clip the words row.
- **Files:** `styles.css`, `PurchaseOrderLayoutGrid.jsx`, `PurchaseOrderPrintSheet.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Print shows full table and C23

- **Issue:** Create Print preview clipped the sheet. C23 missing. Big empty goods band.
- **Fix:** Print packs the C table (`height: auto`). C23 sits after C13 in flow. Hide C23 only on `@media screen`. `@page` A4 with 8mm margin.
- **Files:** `styles.css`, `PurchaseOrderLayoutGrid.jsx`, `PurchaseOrderPrintSheet.jsx`, `PurchaseOrderC23Signature.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Print-only C23 signature cell

- **Issue:** Print had no signature box at the bottom-right of C13.
- **Fix:** Print-only **C23** (hidden on screen). Width C42–C82, height R22. Top-right **for SCOTT INTERNATIONAL**. Bottom-right **Authorised Signatory**. Shows only after Print.
- **Files:** `PurchaseOrderC23Signature.jsx`, `PurchaseOrderLayoutGrid.jsx`, `PurchaseOrderPrintSheet.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — View PO shows the printed sheet

- **Issue:** View PO was a field summary, not the PO print.
- **Fix:** View PO opens the saved A4 print: **PURCHASE ORDER** heading plus the R/C table (same face as Create / Print).
- **Files:** `PurchaseOrderHistoryTable.jsx`, `PurchaseOrderPrintSheet.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-22 — Quantity unit mandatory; Dated is always today

- **Issue:** Generate allowed empty Quantity unit. R12 Dated stayed on voucher reserve day.
- **Fix:** Unit is mandatory (same error + red). R12 Dated is today's IST date and flips when the day changes. Generate stores that today as PO date.
- **Files:** `purchaseOrderHistoryUtils.js`, `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md.

## 2026-08-22 — Generate PO error is one line only

- **Issue:** Generate error also listed which fields to fill.
- **Fix:** Show only **Mandatory details are Missing**.
- **Files:** `PurchaseOrderPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DECISIONS.md.

## 2026-08-22 — Generate PO mandatory fields

- **Issue:** Generate PO saved empty Supplier / Description / Due on / Quantity / Rate.
- **Fix:** Generate blocks until those are filled. Error **Mandatory details are Missing**. Empty cells turn red. Fill them, then Generate saves to PO History.
- **Files:** `PurchaseOrderPanel.jsx`, `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderHistoryUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — PO History after Generate PO

- **Issue:** PO History was empty. Generate PO did not save a row.
- **Fix:** Generate PO writes history fields on the reserved voucher (`generated_at`, bold supplier name, coordinator, R12 date, C42 qty, status `pending`, sheet snapshot). History table columns: PO (print + View PO), PO Number (voucher only), Supplier (bold name), Status (Pending / PO sent / PO Approved / Completed with color + icon), Coordinator, PO date, Quantity. Staging migration `20260822104145_dashboard_purchase_order_history.sql`.
- **Files:** `PurchaseOrderPanel.jsx`, `PurchaseOrderLayoutGrid.jsx`, `PurchaseOrderHistoryTable.jsx`, `purchaseOrderHistoryUtils.js`, `purchaseOrderVoucherUtils.js`, `supabase/migrations/20260822104145_dashboard_purchase_order_history.sql`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, DATABASE.md, OVERVIEW.md, ARCHITECTURE.md, SECURITY.md.

## 2026-08-22 — Create PO title plus Generate / Print

- **Issue:** Create new PO had no sheet title and no Generate/Print under the table.
- **Fix:** **PURCHASE ORDER** sits on top of the A4 sheet (prints with it). **Generate PO** and **Print** sit in a separate row under the table (not printed). Print hides chrome and the Plus control.
- **Files:** `PurchaseOrderPanel.jsx`, `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Purchase Order Create / History tabs

- **Issue:** Purchase Order was one sheet with no Create vs History split. Tabs need to sit opposite the heading.
- **Fix:** Header row: **Purchase Order** left, shadcn Tabs right (**Create new PO** / **PO History**). Create shows the A4 sheet. History is an empty card until save-list exists.
- **Files:** `PurchaseOrderPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-22 — C13 heading and height match R2

- **Issue:** C13 said "Amount in words" and was shorter than Consignee (R2).
- **Fix:** Heading is **Amount Chargable (in words):**. C13 height copies R2. C11–C81 rows can shrink (`minmax(1.25rem)`) so the A4 sheet still fits.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — C42 qty total bold; C82 one-line bold

- **Issue:** C42 empty. C82 wrapped and was not bold.
- **Fix:** C42 shows the sum of Quantity numbers in bold. C82 stays ` ₹ 1000.00` on one line and bold. Amount column a bit wider so the rupee total fits.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — C82 is the Amount column total

- **Issue:** C82 empty. Need the sum of every goods-line Amount as ` ₹ 1000.00`.
- **Fix:** `sumPurchaseOrderLineAmounts` adds each row’s qty × rate. C82 shows ` ₹ ` + 2 decimals. C13 words now read that same total.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderAmountWords.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Quantity is whole numbers only

- **Issue:** Quantity still took decimals (`3.5`).
- **Fix:** `sanitizePurchaseOrderQty` keeps digits only. No `.`. Rate still allows 2 decimals. Amount is still qty × rate.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — Amount is Quantity × Rate, 2 decimals

- **Issue:** Amount (C81) empty. Need qty × rate on every goods line, 2 decimals.
- **Fix:** C81 / `C81:L*` show `formatPurchaseOrderLineAmount` as normal top text (no box). Blank until both Quantity and Rate have numbers. Extra rows each compute their own.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Rate same open number as Quantity, 450.00

- **Issue:** Rate (C51) empty. Need the same no-box number input as Quantity, money face `450.00`, 2 decimals, every goods line.
- **Fix:** C51 / `C51:L*` use the same open Input. Digits only, max 2 decimals while typing. Blur formats to `450.00`. Plus / delete-row clears that line’s rate.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Quantity drop the ___ lines

- **Issue:** Extra underscore lines sat under Quantity after the number/unit layout was right.
- **Fix:** Removed the `___` row. Number + unit box stay the same.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, FLOWCHARTS.md.

## 2026-08-22 — Quantity number visible, no box, full cell width

- **Issue:** Typed qty (e.g. 3) sat in a tiny black box and looked missing. Number + unit bunched top-left; empty space beside the unit.
- **Fix:** Number uses a 1.25rem open field (no border/outline) so the digit is readable. `___` runs under that field. Number area grows; unit stays on the right of the same top row.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — Quantity ___ always shown; unit normal and visible

- **Issue:** After pick, unit looked bold / clipped. `___` under the number was gone.
- **Fix:** `___` sits under the number (grows if more digits). Unit is shown as `font-normal` text in a small box that is wide enough to read. per stays normal text.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — Quantity __ stays visible; smaller unit box

- **Issue:** Dash hid after typing. Unit box too big. Unit text not plain.
- **Fix:** `__` sits under the number and stays. Unit Select is a small box, `font-normal`. Same on every goods line.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Quantity dash and unit same size, no number box

- **Issue:** Quantity number looked boxed or bigger than PCS/Kg. New rows must match.
- **Fix:** Number is dash `---` only (no box, no stretch). Number + unit + per share the same 11px face. Same control on every extra goods line.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-22 — Quantity ___ plus unit box; per copies unit

- **Issue:** Quantity (C41) empty. Need a number blank and a unit pick. per (C61) must show that unit, not the number.
- **Fix:** Each goods line: `___` numeric Input (digits / one decimal) at the top, then a boxed Select (PCS, Kg, Mtr, Nos, Roll, Set). per shows the same unit as normal top text, no box. Plus / delete-row clears that line’s qty and unit.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-22 — Due on date stays one line

- **Issue:** `14-Aug -26` wrapped in the skinny Due on column.
- **Fix:** Date is `whitespace-nowrap`. C table cols: Due on min `5.5rem`, Description still wide, other cols share the rest.
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-22 — Due on calendar icon, today-or-later

- **Issue:** Due on (C31) empty. Need a calendar, not an inner box.
- **Fix:** Calendar icon in each goods-line Due on cell. Pick date → **14-Aug -26** at the top. Past IST days disabled. Plus / delete-row clears that line’s date.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `purchaseOrderVoucherUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md.

## 2026-08-22 — Description cell is the type area

- **Issue:** Description looked like a small box inside C21.
- **Fix:** Textarea fills the whole cell. No inner box, no grow-to-content leftover.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — Description of Goods typeable on every line

- **Issue:** C21 (Description of Goods body) was empty.
- **Fix:** Each goods line has a normal-text type box in C21 / C21:L*. Plus clears them. Extra-row delete drops that line’s text.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md.

## 2026-08-22 — Sl No. sits at top of cell

- **Issue:** 1. 2. were vertically centered in C11.
- **Fix:** Align serials to the top of the cell (`items-start`).
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-22 — Sl No. auto 1. 2. 3.

- **Issue:** Sl No. column empty. Need 1. on one row, then 2. 3. when lines are added, and renumber if a line is inserted in the middle.
- **Fix:** C11 (and extra C11:L* cells) show `lineIndex + 1` plus a dot. Add/delete/insert recounts.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md.

## 2026-08-22 — Extra-line − pinned; same table borders

- **Issue:** − followed the mouse. New row split was a blue double line.
- **Fix:** − only at the left end of that extra row’s join. Split uses the same cell border as the rest of the sheet.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — C11–C81 + follows the full left outline

- **Issue:** + only sat at the bottom of a row, so inserting between lines was hard.
- **Fix:** One full-height left rail. **+** follows the mouse on that outline. Click inserts after the row under the cursor. Rows still split the band equally. **−** when the pointer is near an extra-row join.
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — C11–C81 hover + / − sub-rows

- **Issue:** User wants extra goods lines only when needed, with a blue circle + / − on the left outline like the sheet sketch.
- **Fix:** C11–C81 stays one tall row. Hover the left edge → **+** on the bottom line; click inserts a row under it (blue double line). Extra rows: hover left edge → **−** on the top connector to delete. First row cannot be deleted. Plus on the card resets extra rows. Max 8 extra lines. Ids stay in `data-po-cell` only.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — C22 Total

- **Issue:** C22 empty.
- **Fix:** Bold **Total** in C22. No C-code on screen.
- **Files:** `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md.

## 2026-08-22 — Restore C12–C82; add C13 words row under it

- **Issue:** C12–C82 row was removed. User wanted that row kept, plus a new long row under it.
- **Fix:** Put C12–C82 back (8 empty tiles). New row **C13** under them: **Amount in words** from C82. Do not print C13 on screen.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `purchaseOrderAmountWords.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-22 — C12–C82 one long amount-in-words row

## 2026-08-22 — R32 R41 R42 type fields; no cell gaps

- **Issue:** R32/R41/R42 empty. User wants type space, bold typed words, no scroll, no holes between cells.
- **Fix:** Headings **Other References**, **Dispatched through**, **Destination** (normal). Auto-grow shadcn Textarea, typed text bold. Sheet gaps `0`, cells `rounded-none`. Plus clears the three fields.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — C1–C8 goods-table headings

- **Issue:** Top C row was empty.
- **Fix:** C1 **Sl No.**, C2 **Description of Goods**, C3 **Due on**, C4 **Quantity**, C5 **Rate**, C6 **per**, C7 **Disc %**, C8 **Amount**. Still no C-codes on screen.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-22 — No hole after R3 supplier pick

- **Issue:** After picking a supplier in R3, empty space opened between cells.
- **Fix:** Left stack (R1/R2/R3) no longer shares CSS rows with the right 4×2. Voucher tiles stay short. R21B only fills leftover beside R2/R3.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md, FLOWCHARTS.md.

## 2026-08-22 — Close the gap between R1 and R2

- **Issue:** Empty band between Invoice To (R1) and Consignee (R2).
- **Fix:** Stack R1, R2, R3 in one left column with the same `gap-1` as other cells. No leftover grid hole under R1.
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — R1 R2 R3 hug content, no R2 scrollbar

- **Issue:** R2 had a scrollbar. R2/R3 sat in a rigid split and felt too low.
- **Fix:** Only R1/R2/R3: height follows the text, align top, `overflow-visible`. Other cells unchanged.
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — Restore C-table row sizes

- **Issue:** After shrinking C11 and growing C1/C12, the C-table looked worse.
- **Fix:** Put C rows back: short C1/C12, tall middle C11 (`1fr`) like the previous A4 sheet.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-22 — PO R1–R3 wider, A4 sheet shorter

- **Issue:** R1/R2/R3 looked short. Whole sheet too tall.
- **Fix:** Those cells stretch farther right (~3.2fr vs the small right tiles). Text `11px`, tight padding. Terms box and C-rows shorter. Card is fixed A4 `210mm × 297mm`.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-22 — Purchase Order C-table under the R sheet, A4 page

- **Issue:** Need a second unlabeled table under the current PO sheet, same as the C1–C82 sketch, whole page A4 size.
- **Fix:** A4 card (`210mm × 297mm`). C-grid attached under R-grid. Col 2 wide, middle row tall. Ids in `data-po-cell` / `purchaseOrderLayout.js`. No C-labels on screen. Cells stay empty for later fill.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md.

## 2026-08-21 — Terms of Delivery is a tall box, not one line

- **Issue:** Down R21 type field still looked like a one-line Input.
- **Fix:** Sit that cell beside Consignee/Supplier in its own row. Textarea uses `rows={12}` and `min-height: 18rem` so it cannot collapse to one line. Fills the leftover height of that cell.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `styles.css`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-21 — Terms of Delivery box fills down R21

- **Issue:** Text box in down R21 still looked small inside the large cell.
- **Fix:** R21B uses a min height. Textarea is in a `1fr` row so it fills the leftover cell (full width and remaining height) under **Terms of Delivery**.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-08-21 — Purchase Order delivery box fills the cell

- **Issue:** Terms of Delivery type box was a short line. Rest of the large cell looked empty.
- **Fix:** Use a shadcn **Textarea** that stretches to fill the remaining R21B cell (full width and leftover height). Heading stays on the first line.
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-21 — Purchase Order R21B terms of delivery

- **Issue:** Large cell opposite Consignee (R2) empty. User asked R21 there: **Terms of Delivery** plus a typable second line.
- **Fix:** That sketch cell is **R21B** (small top R21 stays empty). First line **Terms of Delivery**. Second line shadcn **Input**. Plus clears the text.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-21 — Purchase Order R22 payment terms

- **Issue:** R22 empty. Needed **Mode/terms of Payment** plus **30 days**.
- **Fix:** First line that heading (normal). Second line **30 days** bold.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md.

## 2026-08-21 — Purchase Order R31 reference

- **Issue:** R31 empty. Needed **Reference No. & date.** plus the same voucher as R11.
- **Fix:** First line that heading (normal). Second line copies R11 voucher, bold (`PO/26-27/393`). Plus updates both together.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderVoucherUtils.js`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md.

## 2026-08-21 — Purchase Order R11 R12 value bold

- **Issue:** R11 and R12 text all same weight. User wants everything bold except first lines.
- **Fix:** Labels **Voucher No.** and **Dated** stay normal. Voucher code and date use `font-bold`.
- **Files:** `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-21 — Purchase Order R12 dated

- **Issue:** R12 empty. Needed **Dated** plus PO create day like `17-Aug-26`.
- **Fix:** R12 first line **Dated**. Second line is create day in IST `DD-Mmm-YY` (today → `21-Aug-26`). Same `created_at` as the R11 voucher. Plus makes a new PO so Dated becomes today.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderVoucherUtils.js`, `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DATABASE.md, DECISIONS.md.

## 2026-08-21 — Purchase Order R11 voucher number

- **Issue:** R11 empty. Needed Voucher No. plus `PO/26-27/392`, +1 each new PO, Indian FY Apr–Mar.
- **Fix:** R11 first line **Voucher No.** Second line `PO/{yy}-{yy+1}/{seq}`. FY from 1 Apr IST. FY 26-27 first seq is 392; later years start at 1. Plus allocates the next number and clears supplier. Numbers stored in `dashboard_purchase_orders` on staging.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderVoucherUtils.js`, `purchaseOrderLayout.js`, `supabase/migrations/20260821064834_dashboard_purchase_order_vouchers.sql`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DATABASE.md, DEBUGGING.md, DECISIONS.md, SECURITY.md, ARCHITECTURE.md, OVERVIEW.md.
- **Migration:** staging only (`scvojtvgnkmbupvyslmb`). Not production.

## 2026-08-21 — Purchase Order R3 supplier picker

- **Issue:** R3 needed Supplier (Bill form) plus Inventory suppliers.
- **Fix:** First line is that heading. Dropdown lists supplier **name** only (the bold name from Inventory). After pick, R3 shows stored name/address/contact/GSTIN/city/country/payment terms. No extra labels. List comes from `inventory_suppliers`.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `inventoryDbUtils.js`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, SECURITY.md, DATABASE.md.

## 2026-08-21 — Purchase Order R2 Consignee block

- **Issue:** R2 was empty. User asked for Consignee (Ship to) copy there.
- **Fix:** R2 shows Consignee (Ship to), bold **SCOTT INTERNATIONAL**, then address / contact / email / GST / state as normal text.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-21 — Fix Nagappa Street spelling in PO R1

- **Issue:** Invoice address said Nagappa Steet.
- **Fix:** Correct to Nagappa Street.
- **Files:** `purchaseOrderLayout.js`
- **Documentation updated:** CHANGELOG.md.

## 2026-08-21 — Purchase Order R1 Invoice To block

- **Issue:** R1 was empty. User asked for Scott invoice-to copy there.
- **Fix:** R1 shows Invoice To, bold **SCOTT INTERNATIONAL**, then address / contact / GST / state as normal text. Other cells stay blank. Grid rows can grow so the block fits.
- **Files:** `purchaseOrderLayout.js`, `PurchaseOrderLayoutGrid.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-21 — Purchase Order sheet is a compact card

- **Issue:** Sheet filled the page like a giant empty table.
- **Fix:** Same cell placing, smaller card like other panels (`max-w-2xl`, short rows, muted rounded tiles, gap). Not full-bleed. Still no R-labels.
- **Files:** `PurchaseOrderLayoutGrid.jsx`, `PurchaseOrderPanel.jsx`, `App.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DECISIONS.md, DEBUGGING.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-21 — Purchase Order sheet layout (blank cells)

- **Issue:** Purchase Order tab needed the sketched sheet layout, without showing cell names.
- **Fix:** CSS grid matching R1 + 4×2 top-right + R2/R3 + large bottom-right. Cells stay empty. Ids live in `purchaseOrderLayout.js` (`data-po-cell`). Large bottom-right is `R21B` because the sketch reused R21. Plus button is outline icon only. Sheet fills the panel (full-bleed).
- **Files:** `PurchaseOrderPanel.jsx`, `PurchaseOrderLayoutGrid.jsx`, `purchaseOrderLayout.js`, `App.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, OVERVIEW.md, ARCHITECTURE.md, DECISIONS.md, DEBUGGING.md.

## 2026-08-20 — Purchase Order as main sidebar tab

- **Issue:** Purchase Order was a sub-tab inside Support. User wants a main Scott Dashboard tab with an icon.
- **Fix:** Remove it from Support. Add sidebar **Purchase Order** (`purchase_order`) after Inventory with Lucide `FileSpreadsheet` icon. Placeholder panel until PO workflow is defined. Grantable like other workspace tabs.
- **Files:** `dashboardSidebarConfig.js`, `DashboardAppSidebar.jsx`, `dashboardSidebarIcons.jsx`, `PurchaseOrderPanel.jsx`, `App.jsx`, `EnquiryPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, OVERVIEW.md, ARCHITECTURE.md, DECISIONS.md, DEBUGGING.md, SECURITY.md.

## 2026-08-19 — Fix Vercel EBADPLATFORM on Windows Rollup

- **Issue:** Vercel `develop` build failed at `npm install` with `EBADPLATFORM` for `@rollup/rollup-win32-x64-msvc`.
- **Fix:** Remove that Windows-only package from `dependencies`. Vite/Rollup already install the matching OS binary as an optional dependency.
- **Files:** `package.json`, `package-lock.json`
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-19 — Merge Scott API into Support develop

- **Issue:** `git push origin develop` rejected (`fetch first`). Remote had Scott API tabs plus vulnerability audit docs.
- **Fix:** Merge `origin/develop`. Sidebar keeps **Support** plus Customers / Reports / Masters. Keep Support Close/CS/ENQ work.
- **Files:** `dashboardSidebarConfig.js`, `CHANGELOG.md`, `DEBUGGING.md`
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-08-19 — Close Enquiry and Complaints without waiting for SQL push

- **Issue:** Closed status failed on Enquiry and Complaints with ON CONFLICT / feedback-queue error.
- **Fix:** If the staging close trigger still errors, Close saves with phone cleared for one update (trigger skips), then restores the phone and queues the survey from the app. Same dialog for both desks.
- **Files:** `enquiryUtils.js`, `enquiryConciergeUtils.js`
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, FLOWS.md, DECISIONS.md.

## 2026-08-19 — Close enquiry no longer fails on ON CONFLICT

- **Issue:** Updating an enquiry to Closed showed `there is no unique or exclusion constraint matching the ON CONFLICT specification`. Status stayed In progress.
- **Fix:** Close-survey trigger no longer uses `ON CONFLICT (enquiry_id)`. It skips if a message already exists, and never aborts the status update. Partial unique index for non-null `enquiry_id` stays for delay/status rows.
- **Files:** `supabase/migrations/20260819062942_fix_close_survey_conflict.sql`, `enquiryUtils.js`, `EnquiryDetailDialog.jsx`
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, DATABASE.md, FLOWS.md.

## 2026-08-19 — Complaints CS- codes, Enquiries ENQ- codes

- **Issue:** Complaints and Enquiries both used `ENQ-#####`, which would collide as two desks.
- **Fix:** New complaints get `CS-#####`. New enquiries get `ENQ-#####`. Existing complaint `ENQ-` rows relabel to `CS-` when Support loads. Staging trigger migration `20260819100000_enquiry_complaint_code_prefixes.sql` still required for DB-side sequences.
- **Files:** `enquiryUtils.js`, `20260819100000_enquiry_complaint_code_prefixes.sql`
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, DATABASE.md, FLOWS.md, DECISIONS.md.

## 2026-08-19 — Simulator Done no longer shows coerce error

- **Issue:** WhatsApp simulator after photo **Done** showed `Cannot coerce the result to a single JSON object`.
- **Fix:** Photos upload first, then insert (no staff UPDATE). Customer chat files the ticket on Done and does not ask for an account manager. Raw PostgREST coerce text is mapped to a short retry line.
- **Files:** `enquiryUtils.js`, `EnquiryWhatsAppSimulator.jsx`, `EnquiryPanel.jsx`, migration `20260819120000_enquiries_creator_update.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DATABASE.md, SECURITY.md, DECISIONS.md, FLOWCHARTS.md.

## 2026-08-19 — Delay alert and Order status as Support tabs

- **Issue:** Delay alert and production status cards sat on top of Enquiry/Complaints and cluttered those desks.
- **Fix:** They are their own shadcn tabs after Complaints and before Report: **Delay alert**, **Order status**.
- **Files:** `EnquiryPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, OVERVIEW.md, FLOWCHARTS.md, ARCHITECTURE.md.

## 2026-08-19 — Hide production status texts on Support Report

- **Issue:** **Production status texts** still showed on Support → Report.
- **Fix:** Card only renders on Enquiry and Complaints, same as delay alert. Report stays blank.
- **Files:** `EnquiryPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, OVERVIEW.md, FLOWCHARTS.md, ARCHITECTURE.md.

## 2026-08-19 — Hide delay alert on Support Report

- **Issue:** **Send production delay alert** showed on Support → Report even though Report is blank.
- **Fix:** Card only renders on Enquiry and Complaints.
- **Files:** `EnquiryPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, OVERVIEW.md, FLOWCHARTS.md.

## 2026-08-19 — Auto WhatsApp on production status; remove Track Order from simulator

- **Issue:** Simulator had a manual Track Order path. Production status changes did not text the customer.
- **Fix:** Home menu is Customer Access + Help with order only. Backend trigger on `orders.status` queues Concierge copy into `enquiry_outbound_messages`. Phone from matching enquiry, contact book, or Ready Stock order. Support shows **Production status texts**.
- **Files:** `enquiryWhatsAppSimulatorFlow.js`, `EnquiryWhatsAppSimulator.jsx`, `supportDelayAlertUtils.js`, `SupportProductionStatusCard.jsx`, `supportProductionStatusUtils.js`, `EnquiryPanel.jsx`, `sidebarTabActivity.js`, migration `20260819113000_production_status_whatsapp.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, SECURITY.md, ARCHITECTURE.md, OVERVIEW.md.

## 2026-08-19 — Support desks: whole row color by priority

- **Issue:** Enquiry and Complaints rows looked the same except a small Priority badge.
- **Fix:** Whole table row tint + left edge by priority (urgent red, high amber, normal sky, low zinc) for admin and staff. Shared `SupportTicketDesk`.
- **Files:** `SupportTicketDesk.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md

## 2026-08-19 — Fix enquiry assign/status when ticket_kind column missing

- **Issue:** Assign and status update failed: `column enquiries.ticket_kind does not exist`.
- **Fix:** `updateEnquiryFields` (assign + status + pick) retries without `ticket_kind`. Apply `20260819100000_enquiry_complaint_code_prefixes.sql` on staging so the column exists (`enquiry` / `complaint`).
- **Files:** `enquiryUtils.js`, `enquiryConciergeUtils.js`
- **Documentation updated:** DEBUGGING.md, CHANGELOG.md

## 2026-08-19 — Support Enquiry tab (ENQ-) and Complaints codes (CS-)

- **Issue:** Enquiry tab was blank. Customized → Enquiries tickets sat in Complaints with `ENQ-` codes.
- **Fix:** Same desk UI for Enquiry and Complaints (`SupportTicketDesk`). Enquiries `ENQ-#####`, complaints `CS-#####`. Simulator collects name, phone, optional order ID, details, then confirms the ENQ code. Staging migration `20260819100000_enquiry_complaint_code_prefixes.sql` (`ticket_kind` + relabel).
- **Files:** `SupportTicketDesk.jsx`, `EnquiryPanel.jsx`, `enquiryUtils.js`, `enquiryConciergeUtils.js`, `EnquiryWhatsAppSimulator.jsx`, `enquiryWhatsAppSimulatorFlow.js`, `EnquiryDetailDialog.jsx`, migration above.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md, OVERVIEW.md, ARCHITECTURE.md.

## 2026-08-18 — Support: production delay alert for admin and staff

- **Issue:** Support had no Concierge delay-alert sender. Earlier copy skipped it.
- **Fix:** **Send production delay alert** card on Support (admin and non-admin). Same Concierge copy. Queues text + next-step buttons for the WhatsApp simulator. Staging table `support_delay_alerts`.
- **Files:** `SupportDelayAlertCard.jsx`, `supportDelayAlertUtils.js`, `EnquiryPanel.jsx`, `enquiryConciergeUtils.js`, `sidebarTabActivity.js`, migration `20260818180000_support_delay_alerts.sql` (staging).
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, FLOWCHARTS.md, DEBUGGING.md, SECURITY.md, DECISIONS.md, ARCHITECTURE.md, OVERVIEW.md.

## 2026-08-18 — Complaints: lock Concerns and customer feedback

- **Issue:** Admin and staff could edit Concerns and customer feedback after the customer sent them.
- **Fix:** Detail view shows both as read-only for everyone. Notes and priority still save. Feedback still arrives from the WhatsApp simulator.
- **Files:** `EnquiryDetailDialog.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, SECURITY.md, DECISIONS.md.

## 2026-08-18 — Simulator: New member has no welcome or home menu

- **Issue:** New member tap showed placeholder signup copy plus home options.
- **Fix:** New member tap logs the customer choice only. No welcome text. No home buttons.
- **Files:** `EnquiryWhatsAppSimulator.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-08-18 — Complaints: Order ID + Concerns; Help-with-order paths only

- **Issue:** Complaints table had no Order ID, column said Product, and listed tickets from other paths.
- **Fix:** Order ID sits beside Customer. Product column is **Concerns** (customer issue text). List only Help with order → Regular Order and Help with order → Customized order (Enquiries / Concerns). Track/Access/Delay stay out.
- **Files:** `EnquiryPanel.jsx`, `EnquiryDetailDialog.jsx`, `enquiryConciergeUtils.js`, `enquiryUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, DECISIONS.md.

## 2026-08-18 — Support sub-tabs: Enquiry / Complaints / Report

- **Issue:** Support was one page. User wants three sub-tabs.
- **Fix:** Support now has **Enquiry**, **Complaints**, **Report**. Current desk is **Complaints** (default). Enquiry and Report are blank placeholders.
- **Files:** `EnquiryPanel.jsx`
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, OVERVIEW.md, DECISIONS.md, DEBUGGING.md.

## 2026-08-18 — Sidebar tab Enquiry renamed Support

- **Issue:** Side panel still said Enquiry.
- **Fix:** Tab label is **Support**. Icon is headphones (support). Permission id stays `enquiry`.
- **Files:** `dashboardSidebarConfig.js`, `DashboardAppSidebar.jsx`, `dashboardSidebarIcons.jsx`, `EnquiryPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, OVERVIEW.md, ARCHITECTURE.md, SECURITY.md, DECISIONS.md, DEBUGGING.md.

## 2026-08-18 — Close case auto feedback text

- **Issue:** Account manager Close did not send the Concierge customer text.
- **Reason:** Dashboard Close only set `status=closed`. No outbound queue and simulator never listened.
- **Fix:** Staging trigger queues close-survey copy into `enquiry_outbound_messages`. Simulator shows it for the same phone (Feedback → stars → Skip/comment). Detail shows queued text. Still no Meta WhatsApp keys in the SPA.
- **Files:** `enquiryCloseNotify.js`, `enquiryConciergeUtils.js`, `enquiryUtils.js`, `EnquiryWhatsAppSimulator.jsx`, `EnquiryDetailDialog.jsx`, `EnquiryPanel.jsx`, `sidebarTabActivity.js`, migration `20260818113000_enquiry_close_survey_message.sql` (staging).
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, SECURITY.md, DECISIONS.md, ARCHITECTURE.md.

## 2026-08-18 — Enquiry: admin-only assign; staff actions visible to admin

- **Issue:** Non-admin could assign (WhatsApp simulator / insert assignee). Admin had no action history.
- **Fix:** Assign is admin-only (UI + RLS + trigger). Non-admin tickets stay New until admin assigns. Staff pick/status/notes/close write `enquiry_activity_log`; admin detail shows Activity; realtime refreshes the admin list.
- **Files:** `EnquiryDetailDialog.jsx`, `EnquiryPanel.jsx`, `EnquiryWhatsAppSimulator.jsx`, `enquiryUtils.js`, `enquiryConciergeUtils.js`, `enquiryActivityUtils.js`, migration `20260818100000_enquiry_admin_assign_activity.sql` (staging).
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, DEBUGGING.md, SECURITY.md.

## 2026-08-18 — Temporary WhatsApp simulator on Enquiry tab

- **Feature:** Enquiry → **WhatsApp simulator** (temporary fake Concierge chat). Files real tickets onto the Enquiry list. Test bypass on by default so unmatched phone/order still creates a row.
- **Files:** `EnquiryWhatsAppSimulator.jsx`, `enquiryWhatsAppSimulatorFlow.js`, `EnquiryPanel.jsx`, `enquiryUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md.

## 2026-08-18 — Enquiry tab: Scott Concierge desk functions

- **Feature:** Enquiry tab keeps **New / Assigned / In progress / Resolved / Closed** cards and table. Concierge desk functions added: order ID + ownership check, help topic, photos, Mark verified / contacted / Close, 1h ops wait + 2h Gargi SLA, unknown-AM → Gargi, in-app close feedback.
- **Database (staging):** `20260818082754_enquiry_concierge_desk.sql` — extra `enquiries` columns, `enquiry_sla_escalations`, bucket `enquiry-attachments`.
- **Files:** `EnquiryPanel.jsx`, `EnquiryDetailDialog.jsx`, `enquiryUtils.js`, `enquiryConciergeUtils.js`, `enquiryAttachmentUtils.js`, `sidebarTabActivity.js`.
- **Cursor:** shadcn MCP at `.cursor/mcp.json` (enable in Cursor Settings → MCP).
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, FLOWCHARTS.md, DEBUGGING.md, ARCHITECTURE.md, OVERVIEW.md, SECURITY.md, DECISIONS.md.

## 2026-08-17 — Vulnerability audit document

- **Docs:** New [VULNERABILITIES.md](./VULNERABILITIES.md) — whole-build security review (edge functions, RLS, stock RPCs, password reset, advisors). Linked from SECURITY.md.
- **No code patch** in this pass; High items: Ready Stock status/picklist JWT-only auth, authenticated stock-adjust RPCs.

## 2026-08-17 — Enquiry dashboard (monitor + assign)

- **Feature:** **Enquiry** tab — list customer enquiries, status filters, admin assignee picker, create enquiry, detail dialog (status, notes, product).
- **Database:** `enquiries`, `enquiry_assignment_notifications`, RLS (admin all; assignee/creator scoped), realtime. Migration `20260817130922_add_enquiries_dashboard.sql` (applied staging).
- **Files:** `EnquiryPanel.jsx`, `EnquiryDetailDialog.jsx`, `enquiryUtils.js`, `enquiryNotificationUtils.js`, `App.jsx`, `sidebarTabActivity.js`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md.

## 2026-08-17 — Sidebar: Enquiry tab under Inventory

- **UI:** New **Enquiry** sidebar item below Distributor (Inventory section) with mail-question icon; placeholder panel until feature is wired.

## 2026-08-06 — Ready Stock: update order status in UI (app sync)

- **Feature:** Ready Stock Order detail → **Update status (syncs to app)** — warehouse can set `PROCESSING`, `COMPLETE`, `FAILED`, or `CANCELLED` after picklist; fires `order.status_changed` webhook.
- **Edge function:** `scott-order-update-status` (authenticated JWT wrapper around order status/cancel handlers).
- **Files:** `ReadyStockOrderDetailDialog.jsx`, `readyStockOrderStatusUtils.js`, `scott-order-update-status/index.ts`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DASHBOARD_ORDER_API.md, DEBUGGING.md.

## 2026-08-06 — Stock API snapshot: remove DEFAULT facility keys

- **Issue:** `GET /stock/snapshot` returned `DEFAULT:SKU` (often `0`) instead of `SCOTT_1DAY_01:SKU` — legacy backfill rows when SKUs had no warehouse.
- **Fix:** Migration `20260806120436_cleanup_default_facility_stock.sql` removes idle DEFAULT rows; sync trigger no longer writes DEFAULT. Snapshot API skips DEFAULT keys; with `facility` param, missing SKUs return explicit `0` at that facility.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, DEBUGGING.md, DASHBOARD_STOCK_API.md.

## 2026-08-06 — Apparel stock-by-size sync with bulk upload

- **Issue:** After bulk warehouse upload, **Stock by size** showed 0 while **On hand** showed correct total (e.g. `NF-BSHM-BL-XXXL`: sizes `{XXXL:0}` vs `stock_qty` 200).
- **Fix:** Migration `20260806110948_sync_apparel_sizes_with_stock.sql` — trigger keeps `extra.sizes` aligned with `stock_qty` on insert/update; backfill for existing SKUs; bulk facility adjust also sets `warehouse_id` when null.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, DEBUGGING.md.

## 2026-07-31 — Print calculator: non-admin rate display

- **UI:** Non-admin users see only **Rate per square inch is ₹X.XX** (value bold); no input or helper text. Admins keep edit + save. Modal subtitle (workflow/formula/DPI blurb) removed.

## 2026-07-31 — Print calculator: size from PNG after background removal

- **Fix:** After **Remove background**, crop to opaque pixels and auto-update width/height inches from result PNG dimensions at 150 DPI (cost uses trimmed artwork size).

## 2026-07-31 — Print calculator: background removal

- **Feature:** **Remove background** on each artwork (same flow as DTF Calculator — imgly segmentation, mask refine, alpha smooth, download PNG).
- **Deps:** `@imgly/background-removal`, `onnxruntime-web` (dynamic import; ~40MB model on first use).
- **Files:** `printCalculatorBackgroundRemoval.js`, `PrintCalculatorModal.jsx`, `vite.config.js`, `package.json`.

## 2026-07-31 — Print calculator on Printing orders tab

- **Feature:** **Print calculator** button next to All orders / Complete orders / Print Queue — upload artwork, set W×H inches, compute DTF cost.
- **Formula:** `(Height + 1) × (Width + 1) × rate per sq in` (₹). Auto size from image at 150 DPI.
- **Admin:** Edit and save base **rate per square inch** in `print_calculator_settings` (RLS admin-only write).
- **Files:** `PrintCalculatorModal.jsx`, `printCalculatorDb.js`, `printCalculatorUtils.js`, `App.jsx`, migration `20260731140000_print_calculator_settings.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-30 — Bulk pricing & reorder Excel upload (separate from Import SKUs)

- **Feature:** Inventory → **Import metrics and pricings** — bulk update unit cost, sale price, reorder point, and DOC for existing SKUs without re-importing master data or stock.
- **Template columns:** SKU Code (required), Unit Cost (₹), Sale Price (₹), Reorder Point, DOC — fill only columns to change.
- **RPC:** `bulk_update_sku_metrics` (batches of 100). DRR stays auto from orders.
- **Files:** `inventorySkuMetricsImportUtils.js`, `ImportSkuMetricsModal.jsx`, `InventoryDataContext.jsx`, migration `20260730220000_bulk_update_sku_metrics.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md.

## 2026-07-30 — Inventory list: SKU column single line

- **Issue:** Long SKU codes (e.g. `2024-AWG-DN-BG-L`) wrapped onto multiple lines in apparel/fabrics/trims tables.
- **Fix:** `whitespace-nowrap` on SKU cells; table scrolls horizontally when needed. Colorway column also nowrap.
- **Files:** `InventoryListPage.jsx`.

## 2026-07-30 — Fix apparel SKU import preview showing [object Object]

- **Issue:** Import apparel SKUs preview showed `[object Object]` for Size, Brand, Color, Category even when Excel cells had proper text.
- **Root cause:** Parser read `cell.value` only; ExcelJS returns rich text, formulas, and hyperlinks as objects. `String(object)` → `[object Object]`.
- **Fix:** Shared `excelCellUtils.js` — use ExcelJS `cell.text` first, then parse rich text / formula result / hyperlink shapes.
- **Files:** `excelCellUtils.js`, `inventorySkuImportUtils.js`, `inventoryStockAdjustImportUtils.js`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-28 — Fix delivery date save failing (owner_name NOT NULL)

- **Issue:** Saving order changes (e.g. delivery date only) failed in production with `null value in column "owner_name" of relation "orders" violates not-null constraint`; list did not update.
- **Root cause:** Admin saves always merged full `buildAdminOrderFieldsPayload`, which sent `owner_name: null` when empty; partial saves (due date only) still touched admin fields.
- **Fix:** Admin payload merged only when admin draft was edited; `owner_name` / `customer_name` / `product_name` fall back to existing row values instead of null.
- **Files:** `orderAdminEditUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-28 — Order webhook status CREATED on insert

- **Issue:** Partners expect webhook `status` values `CREATED`, `PENDING`, `PROCESSING`, `COMPLETE`, `CANCELLED`, `FAILED`; create previously emitted no webhook (trigger was UPDATE-only) and never sent `CREATED`.
- **Fix:** `notify_scott_order_status_changed` now fires on INSERT with `status: CREATED`, `previous_status: null`; UPDATE continues to emit the row status. API create response still returns `PENDING`.
- **Migration:** `20260728110000_order_webhook_created_status.sql`.
- **Documentation updated:** DASHBOARD_ORDER_API.md, SCOTT_INTEGRATION_REFERENCE.md, FLOWS.md, DATABASE.md, CHANGELOG.md.

## 2026-07-28 — Fix double stock hold on order place / over-release on cancel

- **Issue:** Placing an order could reserve stock twice (legacy `POST /stock/reserve` plus `POST /api/v1/orders`), making inventory look multiplied; cancel only released the order-linked hold, leaving orphan holds or releasing twice when both paths were used.
- **Fix:** `reserveStockIdempotent` reuses an existing `RESERVED` row for the same `order_code` + `facility_code`; duplicate SKU lines in one request are consolidated; cancel/FAILED release **all** open holds for that order; fulfill/adjust recompute `stock_qty` as sum of all facilities; partial unique index blocks a second open hold at DB level.
- **Migration:** `20260728100000_reservation_idempotent_index.sql`.
- **Deploy:** `dashboard-stock-api` edge function (staging).
- **Files:** `stockCore.ts`, `orders.ts`, `index.ts`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, FLOWS.md, MOBILE_API_INTEGRATION.md.

## 2026-07-25 — Import SKUs: download Excel template

- **Feature:** **Import apparel SKUs** modal now has **Download template** → `inventory-apparel-sku-import-template.xlsx` with columns SKU, Size, Class Name, Color, Brand, Category and example rows.
- **Files:** `inventorySkuImportUtils.js`, `ImportSkusModal.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-25 — Bulk stock upload: batch RPC, full SKU match, skip report

- **Issue:** Large warehouse Excel uploads (4000+ rows) showed far fewer rows processing than in the file; many SKUs stayed at 0 because duplicate rows were silently dropped, SKU matching used only the first 1000 loaded SKUs, and stock updates ran one RPC per row (slow / partial failure).
- **Fix:** Bulk upload now loads **all** SKUs from DB for validation; duplicate SKU rows are **merged** (last row wins); preview shows breakdown (stock vs DOC/storage only vs skipped) and **Download skipped rows** CSV; stock applies via batched RPC `bulk_adjust_sku_facility_stock` (100 rows per transaction); confirm dialog when no stock qty changes; Apply button shows stock count.
- **Migration:** `20260725180000_bulk_adjust_facility_stock.sql` — `bulk_adjust_sku_facility_stock`.
- **Files:** `inventoryStockAdjustImportUtils.js`, `ImportStockAdjustModal.jsx`, `InventoryDataContext.jsx`, `inventoryDbUtils.js`, `InventoryDashboard.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-24 — Dev: npm run dev starts picklist API automatically

- **Issue:** `npm run dev` (Vite only) caused `[vite] http proxy error: /api/picklist/pdf` / `ECONNREFUSED` when generating Ready Stock picklists — picklist server on port 3001 was not started.
- **Fix:** `npm run dev` now runs Vite + picklist API via `dev-with-picklist-api.mjs`. Vite-only dev moved to `npm run dev:vite`. Picklist client shows clear hint when API is down.
- **Files:** `package.json`, `scripts/dev-with-picklist-api.mjs`, `picklistApiClient.js`, `PicklistPreviewPage.jsx`, `DEBUGGING.md`.

## 2026-07-23 — Overview warehouse filter scopes all widgets

- **Issue:** Overview warehouse dropdown only filtered Inventory Value KPI; movements, alerts, fabric chart, and shipments still showed all warehouses combined.
- **Fix:** Same dropdown now filters KPIs, recent movements, critical reorder alerts, fabric stock chart, and incoming POs. **All warehouses** shows everything with warehouse name on movement/PO rows; single warehouse shows scoped data and empty states when none.
- **Files:** `InventoryOverview.jsx`, `inventoryFacilityUtils.js`, `inventoryKpiUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-23 — Storage location on new SKU + bulk upload

- **Feature:** **Create SKU** form shows **Storage location** beside **Warehouse** for all kinds (including apparel). Value saves to `inventory_skus.bin_location`.
- **Bulk upload:** Excel template adds **Storage Location** column; import updates bin when provided (optional alongside Stock Qty / DOC).
- **Files:** `NewSkuModal.jsx`, `inventoryStockAdjustImportUtils.js`, `ImportStockAdjustModal.jsx`, `InventoryDataContext.jsx`, `inventoryDbUtils.js`, `inventorySkuExportUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-23 — Warehouse capacity label: units not pallets

- **Fix:** Warehouses page cards, detail panel, and create/edit warehouse forms now say **units** for stock capacity (was incorrectly labeled pallets).
- **Files:** `InventoryWarehousesPage.jsx`, `NewWarehouseModal.jsx`, `EditWarehouseModal.jsx`.

## 2026-07-22 — Remove parent SKU grouping from dashboard

- **Issue:** Parent style / sub-SKU grouping was dashboard-only complexity; Scott API uses flat `sku_code` only — parent rows never affected integrations.
- **Change:** Apparel list is flat (no expandable parent groups). Removed **SKU management** modal, **Add sub SKU** flow, parent fields in **New SKU** form, parent display in SKU drawer / adjust stock / CSV export. New SKUs write `parent_style_id = null`. Legacy `inventory_style_parents` table and nullable FK kept in DB (no migration).
- **Files:** `inventorySkuGrouping.js`, `inventoryQueryFields.js`, `inventoryDbUtils.js`, `InventoryDataContext.jsx`, `InventoryListPage.jsx`, `InventoryDashboard.jsx`, `NewSkuModal.jsx`; deleted `SkuManagementModal.jsx`, `AddSubSkuDialog.jsx`; `SkuDrawer.jsx`, `AdjustStockModal.jsx`, `inventorySkuExportUtils.js`, `sidebarTabActivity.js`, `realtimeUtils.js`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md.

## 2026-07-22 — Warehouse-scoped bulk upload + facility-wise inventory

- **Issue:** Upload Bulk lived on Inventory list and updated global `stock_qty` — stock adjusted at one warehouse could appear everywhere; inventory did not show which warehouses hold each SKU; Overview inventory value had no per-warehouse filter.
- **Feature:** **Upload Bulk** moved to **Warehouses** page (per selected warehouse). Bulk upload sets on-hand only at that warehouse’s `facility_code` via RPC `adjust_sku_facility_stock`; other facilities unchanged. Manual Adjust stock (IN/OUT) also targets selected warehouse facility when warehouse is chosen.
- **Inventory list:** New **Warehouses** column (apparel + fabrics/trims) shows warehouse name(s), facility code, and on-hand per location; warehouse filter matches SKUs with stock at that facility.
- **Overview:** Warehouse dropdown filters **Inventory Value** KPI; when filtered, also shows **Total all warehouses** sum.
- **Migration:** `20260722180000_warehouse_facility_stock_adjust.sql` — RPC + sync trigger skip flag for total recompute.
- **Files:** `inventoryFacilityUtils.js`, `ImportStockAdjustModal.jsx`, `InventoryWarehousesPage.jsx`, `InventoryListPage.jsx`, `InventoryOverview.jsx`, `InventoryDataContext.jsx`, `inventoryDbUtils.js`, `inventoryStockAdjustImportUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-22 — Inventory unit cost inline edit

- **Feature:** Unit cost column on Inventory list (apparel, fabrics, trims) is now editable inline — same blur-to-save pattern as Reorder and DOC. SKU drawer pricing section unchanged.

## 2026-07-22 — Inventory DRR auto-calculated from orders (read-only)

- **Issue:** DRR (daily run rate) was manually editable in inventory list, SKU drawer, new SKU form, and bulk upload — should reflect actual order demand.
- **Feature:** `inventoryDrrUtils.js` computes DRR per SKU from `scott_order_items` on active orders (PENDING/PROCESSING/COMPLETE) in the last 30 days: `DRR = total ordered qty ÷ 30`. Refreshes on inventory load and on `scott_orders` / `scott_order_items` realtime events.
- **UI:** DRR columns use read-only `SkuMetricReadonly`; SKU drawer shows computed DRR with helper text; manual DRR input removed from New SKU form; `saveSkuFields` ignores DRR patches.
- **Bulk upload:** template and import no longer include DRR column (Stock Qty + DOC only).
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-22 — Inventory bulk Excel upload (stock + DOC)

- **Feature:** Inventory list page → **Upload Bulk** opens `ImportStockAdjustModal` — download template (`.xlsx`) with columns SKU Code, Stock Qty, DOC, Reason; upload filled file to bulk-apply stock adjustments and DOC updates. DRR is not in the template (auto-calculated from orders).
- **Stock Qty** sets absolute on-hand (delta computed vs current); movements logged as IN/OUT with reference `BULK-EXCEL`. **DOC** / **DRR** update via `updateSkuFields`.
- **Files:** `inventoryStockAdjustImportUtils.js`, `ImportStockAdjustModal.jsx`, `InventoryDataContext.bulkImportStockAdjust`, `InventoryDashboard.jsx`, `InventoryListPage.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-22 — Pixel-faithful picklist PDF (Puppeteer + bwip-js)

- **Issue:** First picklist used browser print HTML (`scottOrderPicklistPrint.js`) — layout did not match UniCommerce reference PDF (`index.pdf`).
- **Feature:** New picklist module under `src/picklist/`:
  - `PicklistTemplate.jsx` + `picklist.css` — exact layout spec (title, 3-col header with Code128 barcode via data URI, sign-off ruled lines, bordered items table with grey `PICK THESE ITEMS` banner, Powered By + Unicommerce logo row, separate sale-order table).
  - `picklistTypes.js` — `PicklistData` / `PicklistItem` / `PicklistOrder` JSDoc contract + `SAMPLE_PICKLIST_DATA` (matches reference PDF).
  - `buildPicklistHtml.js` — shared HTML document for preview + PDF.
  - `picklistApiClient.js` — `POST /api/picklist/pdf`, open/download PDF blob.
- **Server:** `server/index.js` (Express, port 3001) — `POST /api/picklist/pdf` (validated body → `application/pdf`), `GET /api/picklist/preview` (HTML), `GET /api/picklist/pdf/sample`, `GET /api/picklist/preview-assets`. `generatePicklistPdf()` uses Puppeteer headless Chromium + `bwip-js` Code128 PNG (not font barcode). `@page A4 12mm`, `thead { display: table-header-group }`, `tr { page-break-inside: avoid }`.
- **Dev:** `npm run dev:picklist-api`, `npm run dev:all` (Vite + picklist API); Vite proxies `/api/picklist/*` → `:3001`. Preview page: `/#/picklist-preview`.
- **Ready Stock:** Generate Picklist still calls `scott-order-generate-picklist` then maps to `PicklistData` and requests PDF from picklist API.
- **Assets:** Scott dashboard logo (`public/brand-logo.png`) + **Scott ERP System** footer row (replaces Unicommerce placeholder).
- **Fix:** shelf/bin now from `inventory_skus.bin_location` only; partner `item_code` no longer shown in Comment column. Client `normalizePicklistLineFields` recovers legacy rows where shelf was wrongly sent as comment.
- **Removed:** `src/scottOrderPicklistPrint.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEPENDENCIES.md, DEBUGGING.md, API.md.

## 2026-07-22 — Ready Stock order detail + warehouse picklist

- **Issue:** Ready Stock Order list showed orders but order code was not clickable; warehouse had no way to generate a picklist or move PENDING orders to PROCESSING from the dashboard.
- **Feature:** Click order code → `ReadyStockOrderDetailDialog` (UniCommerce-style ORDER ITEMS tab with line items, facility, qty, in-process/unfulfillable columns). **Generate Picklist** / **Reprint Picklist** button calls edge function `scott-order-generate-picklist`.
- **Picklist:** Now uses Puppeteer PDF pipeline (`src/picklist/`, `server/index.js`) — see changelog entry "Pixel-faithful picklist PDF" above for current behaviour.
- **Status:** First picklist generation sets `picklist_no`, `picklist_generated_at`, and moves `PENDING` → `PROCESSING` (fires `order.status_changed` webhook via existing DB trigger).
- **Migration:** `20260722120000_scott_order_picklist.sql` — `picklist_no` (unique when set), `picklist_generated_at` on `scott_orders`.
- **Files:** `ReadyStockOrderDetailDialog.jsx`, `src/picklist/*`, `server/index.js`, `ReadyStockOrdersPanel.jsx`, `edgeFunctionUtils.js` (`invokeAuthenticatedEdgeFunction`), `supabase/functions/scott-order-generate-picklist/`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-20 — Warehouse Edit + Layout editor (facility code stays in sync with APIs)

- **Issue:** Warehouses page had no Edit action, and the Layout button did nothing — facility code could only be set on create (or via Admin → Integrations → Facilities).
- **Feature:** Inventory → Warehouses now has **Edit** and **Layout** on the detail card.
  - **Edit warehouse** (`EditWarehouseModal`): name, city, type, capacity, external facility code. Internal warehouse id (`WH-*`) stays read-only (SKU FK). Renaming facility code shows an amber notice.
  - **Layout** (`WarehouseLayoutModal`): edit zones (name / rows / cols) stored in `inventory_warehouses.layout`; bin map on the page renders from the saved layout (default zone A 8×10 when unset).
- **Propagation (no API contract change):** migration `20260720150000_warehouse_edit_layout.sql` (already on staging) — trigger `inventory_warehouses_propagate_facility_code` rewrites `inventory_facility_stock`, open `inventory_stock_reservations`, open `scott_orders` (PENDING/PROCESSING), and `dashboard_channels.default_facility_code` when the warehouse facility code changes. Stock snapshot / reserve / order create keep using the same `facility_code` field — partners just see the new code.
- **Files:** `EditWarehouseModal.jsx`, `WarehouseLayoutModal.jsx` (new), `InventoryWarehousesPage.jsx`, `InventoryDashboard.jsx`, `InventoryDataContext.jsx` (`editWarehouse` / `editWarehouseLayout` exported), `inventoryDbUtils.js`, `inventoryQueryFields.js`, migration.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-20 — Postman collection + single integration reference (APIs, webhooks, realtime)

- **Docs:** new `docs/SCOTT_INTEGRATION_REFERENCE.md` — one readable handoff document covering all 10 REST endpoints (5 stock + 5 order) with request/response/error examples, all 3 outbound webhooks with payloads + Node HMAC verification snippet, and the realtime/websocket story (Supabase Realtime channels; subscription example for external clients). Clears the earlier "Postman covers stock only" gap.
- **Postman:** `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json` renamed to "Stock & Order API" and extended with an **Orders** folder (create auto-saves `dashboard_order_id`), an **Order happy path flow** folder, and a **Webhooks (dashboard → your server)** folder containing the exact payloads the dashboard sends (targeting `scott_webhook_base_url` for mock-receiver testing). JSON validated.
- **HTML version:** `docs/SCOTT_INTEGRATION_REFERENCE.html` — self-contained single-file HTML (same visual style as Scott's `order-api-requirements.html`) for sharing with the partner team; identical content to the markdown reference.
- **Files:** `docs/SCOTT_INTEGRATION_REFERENCE.md` + `.html` (new), `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json`, `docs/postman/README.md`, `docs/API.md`.

## 2026-07-20 — Admin Panel → Integrations: API keys, Channels, Facilities

- **Feature:** new "Integrations" tab in Admin Panel (`src/AdminIntegrationsPanel.jsx`, admin-only via existing `masterListView` gating + RLS):
  - **API keys** — generate per-client keys (label + optional username) for the Stock & Order API. Key generated client-side (`scott_` + 48 hex), shown **once** with copy button; only the SHA-256 hash + display prefix are stored (`dashboard_api_keys`). Disable/enable and delete per key; table shows status, created, last-used.
  - **Channels** — registry of order sources (`dashboard_channels`): code, display name, type (CUSTOM/MOBILE_APP/SHOPIFY/AMAZON/FLIPKART/MYNTRA/JIOMART/OTHER), linked API key, default facility, enabled switch. Connector status derived: Connected / No API key / Key disabled / Disabled.
  - **Facilities** — inline edit of `inventory_warehouses.facility_code` (uppercase A-Z0-9_ sanitizer, duplicate-code error surfaced, "Not mapped" badge) without going through the warehouse modal.
- **Edge function:** `requireApiKey` in `stockCore.ts` now accepts the legacy `DASHBOARD_API_KEY` secret **or** any active `dashboard_api_keys` row (SHA-256 lookup, bumps `last_used_at`); disabled keys get `401 KEY_DISABLED`. Deployed to staging.
- **Migration:** `20260720140000_admin_integrations.sql` — `dashboard_api_keys` + `dashboard_channels`, RLS `jwt_user_is_admin()` for all ops, service_role read (+ key update for last_used_at). Applied on **staging**.
- **Verified on staging:** legacy key still authenticates; inserted test DB key → snapshot OK + `last_used_at` bumped; disabled → `KEY_DISABLED`; bad key → 401; test row cleaned up.
- **Security:** plaintext keys never stored or logged; screenshots' UniCommerce credentials not used anywhere.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, SECURITY.md, API.md, DASHBOARD_STOCK_API.md, FLOWS.md.

## 2026-07-20 — Ready Stock Order tab shows live app orders

- **Feature:** the "Ready Stock Order" sidebar tab (previously a "coming soon" placeholder) now lists Scott International RMP orders created through the Order API. New `src/ReadyStockOrdersPanel.jsx` (shadcn Card/Table/Tabs/Badge): order code + `ord_*` id, placed time, facility, customer (name/email/phone), status badge (color per lifecycle state + cancel reason), payment (method / computed INR amount / COD), per-item breakdown (SKU display name from `inventory_skus`, SKU code, quantity + dispatched), due/dispatched column. Status filter tabs with counts, free-text search (order/customer/SKU), manual refresh.
- **Realtime:** migration `20260720130000_scott_orders_realtime.sql` adds `scott_orders` + `scott_order_items` to `supabase_realtime` (staging applied); panel subscribes and silently refetches, so app orders appear instantly.
- **Read-only:** panel reads via authenticated SELECT policies from `20260720120000`; mutations stay with the edge function.
- **Files:** `ReadyStockOrdersPanel.jsx` (new), `App.jsx` (mount, placeholder removed), `supabase/migrations/20260720130000_scott_orders_realtime.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DASHBOARD_ORDER_API.md.

## 2026-07-20 — Order Management API (Scott International order lifecycle)

- **Feature:** implements `order-api-requirements.html` — the dashboard now manages the RMP order lifecycle (UniCommerce replacement role). New routes on edge function `dashboard-stock-api` (same base URL + `DASHBOARD_API_KEY` as stock): `POST /api/v1/orders` (create + stock hold, `409 INSUFFICIENT_STOCK` / `ORDER_EXISTS`), `PATCH /api/v1/orders/:id` (full item/address/due_on replace, `409 ORDER_NOT_EDITABLE` when terminal), `DELETE /api/v1/orders/:id` (idempotent cancel + stock release), `GET /api/v1/orders/:id`, plus dashboard-internal `POST /api/v1/orders/:id/status` (PROCESSING / COMPLETE fulfills the hold / FAILED releases it).
- **Webhook:** `order.status_changed` → `{SCOTT_WEBHOOK_BASE_URL}/webhooks/orders/status_changed`, enqueued by DB trigger `scott_orders_status_changed` on every transition (any code path), delivered via existing `dashboard_webhook_outbox` with the same HMAC scheme. Delivery waits for `SCOTT_WEBHOOK_BASE_URL` / `SCOTT_WEBHOOK_SECRET` secrets.
- **Migration:** `20260720120000_scott_orders.sql` — `scott_orders` + `scott_order_items` (service-role mutations, authenticated read, partial unique open `order_code`), trigger + `notify_scott_order_status_changed()`. Applied on **staging**.
- **Refactor:** reserve/release/fulfill primitives extracted from `index.ts` into `stockCore.ts` and reused by both stock and order routes (no drift between `/stock/reserve` and order holds); `orders.ts` holds the order handlers. Stock endpoints regression-tested after deploy.
- **Verified on staging (SKU BYB-JAQPN-BL-WH-S, facility DEFAULT):** create 50 → avail 450; edit → 30 → 470; PROCESSING → COMPLETE deducted 30 + `dispatched_quantity` set; second order cancel idempotent → 470; 409/404 error paths correct; test stock restored via adjust (+30 → 500).
- **Not updated:** Postman collection still covers stock endpoints only.
- **Documentation updated:** DASHBOARD_ORDER_API.md (new), API.md, DATABASE.md, FLOWS.md, DEBUGGING.md, CHANGELOG.md.

## 2026-07-20 — Policy: all changes staging-only (git, deploys, Supabase)

- **Rule:** new `.cursor/rules/staging-only-all-changes.mdc` (always applied) — every change goes to `develop` branch / Netlify branch deploy / staging Supabase only. Production (`main`, live Netlify site, `levwrmvqdntngeasrtnb`) requires an explicit release request; generic "commit/push/deploy/fix" means staging. Extends the existing Supabase-only staging-first rules to git and web deploys.
- **Files:** `.cursor/rules/staging-only-all-changes.mdc`, `docs/CHANGELOG.md`.

## 2026-07-18 — Env toggle: confirm-to-production instead of dev block; neutral placeholder

- **Issue:** production side of the header toggle was disabled in local dev (looked broken), and the Scott REST URL input used a real backend IP as placeholder (looked like a wrongly saved value).
- **Fix:** toggle now always works — switching to production shows an inline amber confirm ("live production data") before applying; explicit admin override is allowed in dev with a console warning. The hard dev block remains only for the real hazard: `.env` files whose **build default** points at production. Placeholder replaced with a neutral example URL.
- **Files:** `runtimeEnv.js`, `supabaseClient.js`, `components/EnvironmentSwitcherPopover.jsx`.

## 2026-07-18 — Admin header: Staging/Production toggle + Scott REST base URL

- **Feature:** admin-only header popover (`EnvironmentSwitcherPopover`) with a Staging ↔ Production switch — choice saved in this browser (`scott-dashboard-env-override` in localStorage), app reloads on switch; sessions are per-project so first switch may require login. Production override is ignored in local dev unless `VITE_ALLOW_PROD_IN_DEV=true` (staging-first), silently falling back instead of blanking the app.
- **Feature:** "Scott REST base URL" field (localStorage `scott-rest-base-url`) + **Send test webhook** button → new admin edge function `admin-test-scott-webhook` sends an HMAC-signed test `stock.level_changed` to `{base_url}/webhooks/stock/level_changed` using `SCOTT_WEBHOOK_SECRET` (10s timeout), returns delivery status. Deployed to staging.
- **Refactor:** new `src/runtimeEnv.js` is the single source for the active Supabase URL/anon key; `supabaseClient`, `edgeFunctionUtils`, `passwordResetUtils`, `DevEnvironmentIndicator` read from it. Anon keys for both environments ship in the bundle (public by design); service keys/webhook secret stay server-side.
- **Files:** `runtimeEnv.js`, `supabaseClient.js`, `edgeFunctionUtils.js`, `passwordResetUtils.js`, `components/EnvironmentSwitcherPopover.jsx`, `components/DevEnvironmentIndicator.jsx`, `App.jsx`, `supabase/functions/admin-test-scott-webhook/`, `supabase/config.toml`.
- **Documentation updated:** CHANGELOG.md, API.md, SECURITY.md.

## 2026-07-16 — Sync UI stock changes into facility stock (snapshot showed 0)

- **Issue:** stock added via dashboard UI (PO receive, adjust, new SKU) only writes `inventory_skus.stock_qty`; the Stock API reads `inventory_facility_stock`, which was backfilled once and then drifted — snapshot returned 0 for SKUs with real on-hand stock.
- **Fix:** migration `20260716140000_sync_sku_stock_to_facility.sql` — trigger `inventory_skus_sync_facility_stock` mirrors `stock_qty` deltas into `inventory_facility_stock` (upsert into the SKU's warehouse facility, `DEFAULT` fallback). Service-role writes are skipped so `dashboard-stock-api` fulfill/adjust (which maintain facility stock directly and write back `stock_qty`) do not double-count. One-time resync for single-facility SKUs, clamped to `reserved_qty`.
- **Verified on staging:** snapshot 0 → 500 after resync; reserve 10 → 490; release → 500.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, DEBUGGING.md.

## 2026-07-16 — Inventory list shows Reserved / Available (oversell fix)

- **Issue:** inventory list showed `inventory_skus.stock_qty` as sellable stock, but Stock API reservations only mutate `inventory_facility_stock.reserved_qty` — reserved units looked fully available (oversell risk). Only fulfill/adjust write back `stock_qty`.
- **Fix:** `InventoryDataContext` fetches `inventory_sku_availability` (paged), exposes `availabilityBySku` (per-SKU aggregate + per-facility breakdown), subscribes to `inventory_facility_stock` realtime, fails soft to `stock_qty` on error. List page adds **Reserved** (amber + tooltip "Held for open orders — not available to sell") and **Available** columns (sortable) for fabric/trim/apparel incl. group rows; status/low-stock and stock bar now compare reorder point against **available**. KPIs (inventory value, units on hand, alert series) and context `alerts` use available qty.
- **Migration:** `20260716130000_facility_stock_realtime.sql` — adds `inventory_facility_stock` to `supabase_realtime` publication (staging applied).
- **Files:** `InventoryDataContext.jsx`, `pages/InventoryListPage.jsx`, `inventoryKpiUtils.js`, `pages/InventoryOverview.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-16 — Facility stock read access + availability view

- **Migration:** `20260716120000_facility_stock_read_access.sql` (applied on **staging**; production pending explicit release).
- **Access:** read-only SELECT policies + grants for `authenticated` on `inventory_facility_stock`, `inventory_stock_reservations`, `inventory_stock_reservation_items` — frontend previously got `[]` because `20260710120000` granted `service_role` only. Mutations remain edge-function only.
- **View:** `inventory_sku_availability` (`security_invoker`) — per-SKU/per-facility `available_qty = greatest(0, on_hand − reserved)`.
- **Backfill fix:** `inventory_facility_stock.facility_code` rows holding a warehouse id (old fallback, e.g. `WH-01`) rewritten to the warehouse's real `facility_code`; idempotent, merges quantities when the target row already exists.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-16 — Warehouses: external facility code editable in UI

- **Feature:** `inventory_warehouses.facility_code` (added by `20260710120000_dashboard_stock_api.sql`, used by the Dashboard Stock API for `FACILITY:SKU` snapshot keys) is now surfaced in the frontend: optional "Facility code (external)" input in the Add warehouse modal (uppercase, `A-Z 0-9 _` only, mono) and shown on each warehouse card in the Warehouses page (muted "Not mapped" badge when empty).
- **Files:** `src/inventory/inventoryQueryFields.js`, `src/inventory/inventoryDbUtils.js`, `src/inventory/modals/NewWarehouseModal.jsx`, `src/inventory/pages/InventoryWarehousesPage.jsx`.
- **Documentation updated:** CHANGELOG.md, DASHBOARD_STOCK_API.md.

## 2026-07-13 — Mobile app integration guide for Dashboard Stock API

- **Docs:** New [MOBILE_API_INTEGRATION.md](./MOBILE_API_INTEGRATION.md) — staging base URL + API key, all 5 stock endpoints with request/response samples, error-handling table, Flutter/Dart and React Native client code, webhook HMAC verification, staging testing checklist, production go-live steps.
- **Verified:** All endpoints smoke-tested on staging (`scvojtvgnkmbupvyslmb`): 401 without key, snapshot 200, reserve 409 `INSUFFICIENT_STOCK` for unavailable SKU, release/fulfill 404 for unknown reservation, adjust 200. Production function **not deployed** (staging-first policy; deploy on explicit release request).
- **Files:** `docs/MOBILE_API_INTEGRATION.md`, `docs/API.md`, `docs/CHANGELOG.md`.

## 2026-07-10 — Admin Roles & goals: minimal left-aligned user cards

- **UI:** User grid cards are full-width left column — name, one role line, one goals summary line, progress bar. Removed avatar/icons and extra task lines from overview cards; goal cards show title + one status line only.
- **Files:** `AdminRolesGoalsPanel.jsx`.

## 2026-07-10 — Admin Roles & goals: left-align user cards

- **UI:** User grid cards and goal cards in **Roles & goals** stack name, role, goals, progress bar, and tasks left-aligned (no split left/right rows).
- **Files:** `AdminRolesGoalsPanel.jsx`.

## 2026-07-10 — Policy: staging-first Supabase (migrations & edge functions)

- **Rule:** All `supabase db push`, migrations, and `functions deploy` default to **staging** (`scvojtvgnkmbupvyslmb`) only. Production (`levwrmvqdntngeasrtnb`) changes require explicit user request for production release.
- **Files:** `.cursor/rules/staging-first-supabase.mdc`, `.cursor/rules/staging-only-dev.mdc`, `docs/ENVIRONMENTS.md`.

## 2026-07-10 — Admin-approved password reset (login forgot password)

- **Feature:** Login **Forgot password?** → user submits reset request → admin approves in **Admin panel → Password resets** → user sets new password on login screen only (7-day approval window).
- **Routing:** Viewer requests → any admin; **admin** user requests → **main admin only** (`admin@scott.com`).
- **Migration:** `20260710160000_add_password_reset_requests.sql`.
- **Edge functions:** `request-password-reset`, `check-password-reset-status`, `complete-password-reset`, `admin-review-password-reset`.
- **Files:** `LoginPage.jsx`, `AdminPasswordResetRequestsPanel.jsx`, `passwordResetUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md, API.md.

## 2026-07-10 — Manage User Goals: show all user goals (incl. completed)

- **Issue:** Admin **Manage User Goals** tab looked empty when selected user only had completed goals — tab filtered to active goals only.
- **Fix:** Show all goals for the selected user (active + completed) with tasks; user picker merges team directory + admin viewer list; tab renamed from **Manage users** to **Manage User Goals**.
- **Files:** `GoalTrackerPanel.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-10 — Goals: ownership card grid, detail view, goal priority

- **UI:** My goals / Manage / Completed use ownership **card grid**; click card → full-page goals + tasks with **Back** button (not nested in-card list).
## 2026-07-10 — Goals: task priority colors visible in dark theme

- **Issue:** Task P0/P1/P2 badges washed out or invisible in dark mode (`theme-dark`).
- **Fix:** Dedicated `.task-priority-*` CSS for light + dark; badges on task title row; colored priority in assign/create selects.
- **Files:** `TaskPriorityBadge.jsx`, `index.css`, `GoalTrackerPanel.jsx`.
- **Feature:** Goal **priority** P0 / P1 / P2 (same as tasks); set on create; change in detail view dropdown.
- **Migration:** `20260710150000_add_goal_priority.sql` (staging + production applied).
- **Files:** `GoalTrackerPanel.jsx`, `goalTrackerUtils.js`, `AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** DATABASE.md, CHANGELOG.md.

## 2026-07-10 — Goals: ownership grouping (Ownership → Goal → Tasks)

- **Feature:** Annual goals have an **Ownership** field; My goals / Completed / Manage users tabs group goals under ownership headings. Legacy goals without ownership show under **Uncategorized** with **Set ownership** on each card.
- **Migration:** `20260710140000_add_goal_ownership.sql` — nullable `user_annual_goals.ownership`; updated `get_goals_for_task_assignment` RPC.
- **Files:** `goalTrackerUtils.js`, `GoalTrackerPanel.jsx`, `AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, DEBUGGING.md.

## 2026-07-10 — View order: order history modal visible again

- **Issue:** Order history not visible when opened from View order dialog.
- **Reason:** Modal rendered in app tree below Radix Dialog portal; focus trap blocked interaction.
- **Fix:** `OrderHistoryModal` portaled to `document.body`; View order `modal={false}` while history open; history button always in footer.
- **Files (new):** `src/components/OrderHistoryModal.jsx`.
- **Files:** `App.jsx`, `OrderDetailPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-10 — Postman collection for Dashboard Stock API

- **Feature:** Exportable Postman collection + staging/production environments for all stock endpoints and happy-path flow.
- **Files (new):** `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json`, staging/production environment JSON, `docs/postman/README.md`.
- **Documentation updated:** DASHBOARD_STOCK_API.md, CHANGELOG.md.

## 2026-07-10 — Dashboard Stock API (Scott International)

- **Feature:** Machine-to-machine stock API per `dashboard-api-requirements.pdf` — snapshot, reserve, release, fulfill, adjust + outbound webhooks.
- **Implementation:** Edge function `dashboard-stock-api` (Bearer `DASHBOARD_API_KEY`); migration `20260710120000_dashboard_stock_api.sql` for facility stock, reservations, adjustments, webhook outbox.
- **Files (new):** `supabase/functions/dashboard-stock-api/index.ts`, `docs/DASHBOARD_STOCK_API.md`, `docs/openapi/dashboard-stock-api.yaml`.
- **Files:** `supabase/config.toml` (`verify_jwt = false` for stock API).
- **Documentation updated:** API.md, ARCHITECTURE.md, DATABASE.md, CHANGELOG.md, FLOWS.md, DEBUGGING.md, SECURITY.md.

## 2026-07-09 — Inventory: Export SKU CSV

- **Issue:** Overview and SKU list **Export** buttons had no handler — click did nothing.
- **Fix:** CSV export utility downloads all SKU fields; overview fetches full SKU list from Supabase; list page exports filtered rows (or selected rows).
- **Files (new):** `src/inventory/inventorySkuExportUtils.js`.
- **Files:** `InventoryOverview.jsx`, `InventoryListPage.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-09 — Inventory overview: live KPI sparklines

- **Issue:** Overview KPI cards used hardcoded sparkline arrays and fake deltas; charts did not change when stock or SKUs updated.
- **Fix:** `buildInventoryOverviewKpis()` derives 14-day series from SKU stock, movements, alerts, and POs; realtime refresh reloads KPI movement window; deltas computed from actual trend.
- **Files (new):** `src/inventory/inventoryKpiUtils.js`.
- **Files:** `InventoryOverview.jsx`, `InventoryDataContext.jsx`, `inventoryDbUtils.js`, `inventoryQueryFields.js`, `Sparkline.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — View order: mockups preserved when approved images uploaded

- **Issue:** Uploading approved design images made mockup thumbnails vanish in View order.
- **Reason:** Recent-image patch merge returned `{ ...listRow, ...patch }` without re-merging mockup fields from the prior hydrated row; patch payload only contained `approved_design_images`.
- **Fix:** After applying image patch, run `mergeOrderDetailAssets()` again to keep `approved_design_url`; stash mockups in patch ref; re-hydrate order detail after successful upload.
- **Files:** `src/orderViewUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-09 — View order: mockup images no longer vanish on live refresh

- **Issue:** Mockup thumbnails in View order sometimes disappeared while the dialog stayed open.
- **Reason:** Silent order list refetch uses `ORDERS_LIST_SELECT` (no `approved_design_url`). Merge logic only preserved `approved_design_images`, and `viewOrderTarget` was replaced with the stripped list row on each realtime refresh.
- **Fix:** `mergeOrderDetailAssets()` keeps mockups, approved designs, archive, payment proof, and notes when list refetch omits them; View order syncs from merged row; opening an order always hydrates full detail row.
- **Files:** `src/orderViewUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, FLOWS.md.

## 2026-07-09 — Sidebar activity dots: correct tab only

- **Issue:** Saving a printing order showed activity dot on **Home** instead of only Printing Orders.
- **Reason:** `orders` (and goals tables) mapped to both their domain tab and `home`.
- **Fix:** Remove `home` from activity mappings; route `orders` by `order_kind` to Printing Orders, Production tracker, or Ready Stock Order.
- **Files:** `src/sidebarTabActivity.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — Printing order: SKU color auto-sync on product pick

- **Issue:** Picking inventory SKU (e.g. `6D-BL-S · 6 DEGREE · BLACK`) left Colors field showing wrong swatch (placeholder gray, wrong hex, or another variant).
- **Reason:** `colorsFromInventoryProduct()` preferred inventory `hex_color` (often default `#cccccc` or stale). Product picker also re-matched by **product name only**, so multiple SKUs named `6 DEGREE` could fight over selection.
- **Fix:**
  - Resolve order colors from SKU **color name**, **SKU code segments** (e.g. `BL` → black), then label text; use stored hex only when it is a real non-placeholder value.
  - Keep picker selection pinned by SKU `_uuid` when name matches; re-sync colors whenever selected SKU changes.
  - Color trigger dots use `swatchBackgroundForColor()` so named colors (e.g. `BLACK`) render correctly.
- **Files:** `src/inventory/inventoryProductPickerUtils.js`, `src/components/orders/PrintingOrderProductField.jsx`, `src/orderColorUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — Sidebar tab activity markers

- **Feature:** Blue dot on sidebar tab when data changes elsewhere (new printing order, task status update, dispatch entry, inventory, etc.).
- **Behavior:** Dot shows on tabs user is **not** viewing; clears when they open that tab. Chat keeps numeric unread badge.
- **Files (new):** `src/sidebarTabActivity.js`.
- **Files:** `App.jsx`, `DashboardAppSidebar.jsx`, `DashboardShell.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Dashboard-wide realtime sync

- **Issue:** Users and admins had to refresh to see updates from others (orders, dispatch, goals, inventory, contacts, etc.).
- **Reason:** Only some tables were on `supabase_realtime` and only a few panels subscribed to `postgres_changes`; most data loaded once on mount.
- **Fix:**
  - Migration `20260709200000_dashboard_realtime_publication.sql` — adds dispatch, masters, profiles, contacts, shared links, dealers, full inventory, printing dept tables to realtime publication.
  - Shared helper `src/realtimeUtils.js` — debounced multi-table subscriptions.
  - **App.jsx:** live masters, team profiles, admin permissions, global search; orders poll fallback 60s → 120s.
  - **Panels:** dispatch, contact book, shared links, goals (home + tab + admin), inventory bundle, printing dept inventory/utilization, dealer report.
- **Files (new):** `src/realtimeUtils.js`, `supabase/migrations/20260709200000_dashboard_realtime_publication.sql`.
- **Documentation updated:** CHANGELOG.md, ARCHITECTURE.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-09 — View order: mockup preview, status sync, customer assets

- **Issue 1 — Mockup preview behind dialog:** Click mockup in View order → image card hidden under order dialog.
- **Reason:** Preview rendered inside app shell; Radix Dialog portals to `document.body` at `z-50` and paints above in-app fixed layers.
- **Fix:** `ImagePreviewModal` portaled to `document.body` (`z-index: 2000`). Toolbar **Close** only (no hint, no backdrop/Esc dismiss). View order `Dialog` uses `modal={false}` while preview open so Radix does not block pointer events on the preview layer.
- **Issue 2 — Status not syncing across users:** One user changes status; others see stale value until manual refresh.
- **Reason:** App subscribed to `postgres_changes` on `orders`, but `orders` was never added to `supabase_realtime` publication.
- **Fix:** Migration `20260709190000_orders_realtime.sql` adds `orders` + `order_customer_assets` to realtime. `fetchOrders` also refreshes `viewOrderTarget` on silent refetch.
- **Issue 3 — Customer assets not view/download:** Some uploaded files fail to open or download.
- **Reason:** UI used `getPublicUrl()` without auth; bucket storage policy is `authenticated` only, so public URLs 403 for many files.
- **Fix:** Signed URLs via `createSignedUrl` (1h TTL); **View** for images/PDFs; **Download** with filename; realtime refetch when assets change on open order.
- **Files (new):** `src/components/ImagePreviewModal.jsx`, `supabase/migrations/20260709190000_orders_realtime.sql`.
- **Files:** `src/App.jsx`, `src/OrderDetailPanel.jsx`, `src/orderCustomerAssets.js`.
- **Bug fix:** Restored missing `ImagePreviewModal` import in `App.jsx` (blank screen after realtime work).
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, FLOWS.md, DATABASE.md.

## 2026-07-08 — Platform overview documentation (API, mobile, Uniware roadmap)

- **Added:** `docs/PLATFORM_OVERVIEW.md` — full stack brief (React + Supabase, not Flutter), API/mobile strategy, Uniware replacement phases, scaling, improvements.
- **Added:** `docs/OVERVIEW.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, Word export `docs/export/Scott_Dashboard_Platform_Overview.html` + `.doc`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-09 — Profile settings moved to sidebar (not Notifications tab)

- **Issue:** Avatar + notification tone lived on Notifications page — wrong place for user.
- **Fix:** Click sidebar **name/avatar** → **Profile settings** dialog: profile photo on top, notification tone below. Notifications tab = alert list only.
- **Files (new):** `src/components/profile/UserProfileSettingsDialog.jsx`.
- **Files:** `DashboardAppSidebar.jsx`, `DashboardShell.jsx`, `App.jsx`, `NotificationsPanel.jsx`.
- **Documentation updated:** FLOWS.md, CHANGELOG.md.

## 2026-07-09 — Preset profile avatars (50 characters)

- **Feature:** 50 built-in character avatars in `public/avatars/presets/`. Users pick from grid or upload photo.
- **Self-service:** Sidebar footer — click **name/avatar** → **Profile settings** dialog (avatar + notification tone).
- **Not in Notifications tab:** Alert list only on that page.
- **Admin:** **Create user** and **Edit user** include same picker (preset + upload).
- **Storage:** Presets stored as `profiles.avatar_path = preset:avatar-XX` (no bucket upload). Uploaded photos still use `profile-avatars` bucket.
- **Files (new):** `src/presetAvatars.js`, `src/components/profile/ProfileAvatarPicker.jsx`, `src/components/profile/ProfileAvatarSettings.jsx`.
- **Files:** `src/avatarUtils.js`, `src/App.jsx`, `src/ViewerUserEditModal.jsx`, `src/NotificationsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Production blank screen after removing .env from git

- **Issue:** Live site blank; console `Missing Supabase env vars`.
- **Cause:** Vite needs `VITE_SUPABASE_ANON_KEY` at Netlify build time; was previously supplied by committed `.env`.
- **Fix:** Set `VITE_SUPABASE_ANON_KEY` in Netlify production env; `VITE_SUPABASE_URL` in `netlify.toml` for production context.
- **Documentation updated:** DEBUGGING.md, RELEASE_AUTOMATION.md, CHANGELOG.md.

## 2026-07-09 — Fix Netlify production deploy blocked by secret scanning

- **Issue:** Production deploys on `main` failed with **Exposed secrets detected** (build exit code 2) after chat/goals release.
- **Cause:** `.env` (Supabase anon JWT) and `dist/` (Vite build with inlined env) were tracked in git; Netlify secret scan blocked publish.
- **Fix:** Add `dist/` to `.gitignore`; untrack `.env` and `dist/` from git. Document Netlify env setup (do not mark `VITE_*` as "Contains secret values").
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, RELEASE_AUTOMATION.md.

## 2026-07-09 — Chat: no ghost DM until first message

- **Issue:** Picking a user in **New chat** (without sending) created a conversation — other user saw empty chat in inbox.
- **Fix:** Direct chat opens compose-only until first message; `get_or_create_direct_conversation` runs on send. Inbox hides empty direct conversations (no messages).
- **Files:** `src/TeamChatPanel.jsx`, `src/teamChatService.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Chat unread clear, highlight, message tone

- **Issue:** Unread badge stay after open chat; unread row hard to see; no sound on new chat message.
- **Fix:** Mark read clears badge immediately (optimistic + RPC). Unread rows get primary left border + bold text. New message play notification tone (respects `status_tones_enabled` + custom MP3); skip tone when user already viewing that thread.
- **Sidebar:** Chat tab shows total unread badge.
- **Files (new):** `src/teamChatNotificationUtils.js`.
- **Files:** `src/TeamChatPanel.jsx`, `src/teamChatService.js`, `src/App.jsx`, `DashboardAppSidebar.jsx`, `DashboardShell.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — Chat GIF search: Giphy (replaces Tenor)

- **Issue:** Tenor API discontinued / invalid keys — GIF Search tab empty.
- **Fix:** Switched to **Giphy** search + trending (`src/giphyGifApi.js`). Key via `VITE_GIPHY_API_KEY` in `.env`. Giphy allows browser CORS — no proxy needed.
- **Removed:** `src/tenorGifApi.js`, Vite Tenor proxy.
- **Files:** `src/components/chat/GifPicker.jsx`, `.env`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DATABASE.md.

## 2026-07-09 — Fix Tenor GIF search (CORS + v2 API)

- **Issue:** GIF Search tab empty — browser blocked direct Tenor calls (no CORS); old v1 endpoint discontinued; v2 requires `client_key` + Google Cloud API key (not old tenor.com demo key).
- **Fix:** `tenor-gif-search` Supabase Edge Function proxies Tenor v2; dev uses Vite proxy. Search tab shows errors when API fails; trending GIFs on empty query.
- **Files (new):** `src/tenorGifApi.js`, `supabase/functions/tenor-gif-search/index.ts`.
- **Files:** `src/components/chat/GifPicker.jsx`, `vite.config.js`.
- **Deploy:** `supabase functions deploy tenor-gif-search` + `supabase secrets set TENOR_API_KEY=<Google Cloud Tenor key>`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DEPLOYMENT.md.

## 2026-07-09 — Chat Enter to send + Tenor GIF key

- **Change:** Chat composer sends on **Enter**; **Shift+Enter** adds new line (WhatsApp-style).
- **Env:** `VITE_TENOR_API_KEY` enables GIF **Search** tab in chat picker.
- **Files:** `src/TeamChatPanel.jsx`, `.env`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Team chat v2 (DMs, groups, GIFs)

- **Issue:** Chat was one shared team wall — no private messages, no groups, no GIF send.
- **Fix:** WhatsApp-style inbox: conversation list, direct messages (any user → any user), group chats, GIF picker (presets + optional Tenor search via `VITE_TENOR_API_KEY`), file attachments kept. Legacy messages migrate into **General** group.
- **Database:** `20260709180000_team_chat_conversations.sql` — `team_chat_conversations`, `team_chat_conversation_members`, `conversation_id` + `gif_url` on messages, member-scoped RLS, RPCs `get_or_create_direct_conversation`, `create_group_conversation`, `mark_conversation_read`.
- **Files (new):** `src/teamChatService.js`, `src/components/chat/*`.
- **Files:** `src/TeamChatPanel.jsx`, `src/teamChatUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-09 — Custom notification tone (MP3 upload)

- **Feature:** Every user can upload a personal MP3 notification tone on **Notifications** page. Custom tone plays for assignments, task alerts, order status, inward tags, and inventory alerts. **Preview**, **Replace**, or **Use default** (built-in sound).
- **Database:** `20260709170000_add_profile_notification_tones.sql` — `profiles.notification_tone_path`, `notification-tones` storage bucket + RLS.
- **Files (new):** `src/notificationToneUtils.js`, `src/notificationTonePlayer.js`, `src/components/notifications/NotificationToneSettings.jsx`.
- **Files:** `src/NotificationsPanel.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Remove P3 task priority

- **Change:** Priorities are **P0**, **P1**, **P2** only. Existing P3 tasks migrated to P2. Default on assign is P2.
- **Database:** `20260709160000_remove_task_priority_p3.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Task list priority filter

- **Feature:** **My tasks**, **Assigned by me**, and **All team tasks** tabs have a **Priority** dropdown — All, P0, P1, or P2. List stays sorted P0 → P2 within selection.
- **Files:** `src/goalTrackerUtils.js` (`filterTasksByPriority`), `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Task priority (P0–P2) on assign

- **Feature:** Assign task dialog adds **Priority** dropdown — P0 Top (red), P1 Medium (beige), P2 Less (green, default). Badge visible on goal tasks and task lists. **My tasks** sorted P0 → P2.
- **Database:** `20260709150000_add_task_priority.sql` — `user_goal_tasks.priority`, index on assignee + priority.
- **Files (new):** `src/components/goals/TaskPriorityBadge.jsx`.
- **Files:** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Task verification by assigner (not assignee)

- **Issue:** Assignee could verify own completed task — wrong flow.
- **Fix:** When assignee marks task complete, **assigner** (`assigned_by`) gets verify controls + notification. RLS policy `goal tasks assigner verify completion`. Goals still verified by goal owner.
- **Files:** `src/goalTrackerUtils.js`, `src/AdminRolesGoalsPanel.jsx`.
- **Database:** `20260709140000_task_verification_by_assigner.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DATABASE.md.

## 2026-07-09 — Tasks stay on goal card; verification UI on card

- **Change:** Completed **tasks** no longer move to **Completed** tab — they stay on the goal card (and task list tabs). Only **goals** move to **Completed** when marked done.
- **UI:** Completed unverified tasks show **Pending verification** badge; verified tasks get strikethrough. Assignee remarks (e.g. “Not complete”) show below the task until verified.
- **Files:** `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Assign task: show assignee goals (RLS fix)

- **Issue:** **Link to goal** empty when assignee has goals (e.g. Test 2) — goals created by admin for that user not visible to assigner.
- **Reason:** RLS on `user_annual_goals` only allows owner, admin, or users with existing tasks on that goal. Task assigners could not read assignee goals before first link. Task insert also blocked linking to assignee-owned goals unless assigner owned the goal.
- **Fix:** Migration `20260709120000_goal_assign_link_visibility.sql` — `get_goals_for_task_assignment()` security-definer RPC for assign-task dropdown; task insert allows assignee-owned goals via `jwt_user_owns_goal(goal_id, assignee_id)` (`20260709130000_fix_goal_task_insert_rls.sql` — replaces RLS-blocked EXISTS subquery).
- **Files:** `src/goalTrackerUtils.js` (`fetchGoalsForTaskAssignment`), `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-07 — Assign task: link goal filtered by selected user

- **Fix:** **Link to goal** dropdown in Assign task shows only the selected **Assign to** user's goals for the current year (not everyone's goals).
- **Files:** `src/GoalTrackerPanel.jsx`.

## 2026-07-07 — Goals: assignee confirms completion (not admin)

- **Change:** Admin no longer verifies. Assignee marks complete → **Completed** tab → assignee **Verify complete** or **Not complete** with required remark (what still needs work). Goal owner same for goals. Notification on submit. Reject sends task/goal back to active with remark in history.
- **Database:** `20260707150000_goal_assigner_verification_rls.sql` — assignee/owner verify RLS; nullable `task_id` on goal notifications.
- **Files:** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`, `src/AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-07 — Admin completed tasks: labeled goal/task/user fields

- **Change:** Completed task rows (Goals **Completed** tab + Admin **Roles & goals**) now show labeled **Goal title**, **Task title**, **Task description**, and **User name** in a clear grid. Admin panel lists all completed tasks at top for review.
- **Files (new):** `src/components/goals/GoalTaskDetailGrid.jsx`.
- **Files:** `src/GoalTrackerPanel.jsx`, `src/AdminRolesGoalsPanel.jsx`.

## 2026-07-07 — Goals: checkbox complete + Completed tab + admin verification

- **Feature:** Users check box on task (assignee) or goal (owner) to mark complete — item moves out of active tabs into new **Completed** tab. Admin sees **Verify complete** / **Not complete** on completed items; verified badge when approved. Uncheck or admin reject moves back to active.
- **Database:** Migration `20260707140000_goal_task_completion_verification.sql` — `completed_at`, `admin_verified_at`, `admin_verified_by` on goals and tasks. Applied on staging.
- **Files:** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-07 — Admin delete any goal or task

- **Feature:** Admin can delete any user's goal or task — **Goals & Tasks** (Manage users, All team tasks, goal cards) and **Admin panel → Roles & goals** (per-user goals, tasks assigned to/by them). Confirm dialog + error alert on failure. DB RLS already allowed admin delete.
- **Files:** `src/GoalTrackerPanel.jsx`, `src/AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-07 — Home: hide order status counts from normal users

- **Change:** **Order counts by status** grid on Home is admin-only. Normal users see Goals widget and their allowed tabs; no pipeline status overview.
- **Files:** `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-07 — Dispatch tab: shadcn UI migration

- **Change:** Dispatch section UI aligned with Printing Orders / LinkedOrdersTabPanel — shadcn `Tabs`, `Table`, `Button`, `Card`, `Skeleton`, `OrdersListSummary`, shared order badges/cells. App wrapper uses `space-y-4` instead of `dashboard-card`.
- **Files:** `src/DispatchTabPanel.jsx`, `src/OutwardChallanList.jsx`, `src/InwardEntryList.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-07 — Goals panel: My tasks tab first

- **Change:** Goals & Tasks tab order — **My tasks** first (default), then **My goals**.
- **Files:** `src/GoalTrackerPanel.jsx`.

## 2026-07-07 — Notifications: task assignments + order status updates

- **Feature:** Bell + Notifications page now include **task assigned to you** (goal tracker) and **order status updated** (coordinator + order creator). Realtime toasts for both; click opens Goals & Tasks or the order.
- **Database:** Migration `20260707130000_add_goal_task_and_order_status_notifications.sql` — `user_goal_task_notifications`, `order_status_notifications`, trigger `orders_status_notify`. Applied on staging.
- **Files (new):** `src/goalTaskNotificationUtils.js`.
- **Files:** `src/notificationsUtils.js`, `src/NotificationsPanel.jsx`, `src/App.jsx`, `src/goalTrackerUtils.js`, `src/components/notifications/AssignmentToastStack.jsx`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, DEBUGGING.md.

## 2026-07-06 — Goals: user self-create + admin Roles & goals cards

- **Feature:** Users get **Create my goal** on Goals & Tasks → My goals. Admin **Roles & goals** tab (Admin panel) shows user cards with job role + progress; click card for goals, tasks, status, remarks. Admin **All team tasks** tab sees every task anyone created.
- **Database:** `20260706200000_goal_tracker_user_self_create.sql` — users can insert own annual goals. Applied on staging.
- **Files (new):** `src/AdminRolesGoalsPanel.jsx`.
- **Files:** `src/GoalTrackerPanel.jsx`, `src/goalTrackerUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-06 — Sidebar: Goals & Tasks below Home

- **Change:** Moved **Goals & Tasks** from footer to Workspace section — order: Home → Goals & Tasks → Printing Orders.
- **Files:** `src/dashboardSidebarConfig.js`.

## 2026-07-06 — Fix dialog footer buttons (Assign task)

- **Issue:** Dialog buttons (e.g. Assign task) looked broken — no padding, misaligned Cancel vs primary action.
- **Reason:** Radix Themes `Button` adapter conflicted with shadcn `DialogFooter` / Tailwind design tokens.
- **Fix:** Restore native shadcn `Button` in `components/ui/button.jsx`; improve `DialogFooter` flex alignment with `gap-2` + `items-center`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Fix goal tracker RLS infinite recursion (staging)

- **Issue:** Home/Goals panel error: `infinite recursion detected in policy for relation user_annual_goals`.
- **Fix:** Migration `20260706190000_fix_goal_tracker_rls_recursion.sql` — security definer helpers break goals ↔ tasks policy cycle. Applied on staging `scvojtvgnkmbupvyslmb`.
- **Documentation updated:** DEBUGGING.md, CHANGELOG.md.

## 2026-07-06 — Goal tracker (annual goals, tasks, remarks)

- **Feature:** Annual goal tracker per user. Admin sets yearly goals + todo tasks with deadlines in sidebar **Goals & Tasks**. Any user can assign tasks to anyone. Non-admin status updates require timestamped remarks. Home page shows goal/task summary widget.
- **Database:** Migration `20260706180000_add_goal_tracker.sql` — `user_annual_goals`, `user_goal_tasks`, `user_goal_status_remarks` with RLS + realtime.
- **Files (new):** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`, `src/components/goals/HomeGoalTrackerPanel.jsx`.
- **Files:** `src/App.jsx`, `src/dashboardSidebarConfig.js`, `src/components/layout/DashboardAppSidebar.jsx`, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md.

## 2026-07-06 — Inventory list pagination

- **Issue:** Apparel/Fabrics/Trims inventory showed all rows on one page (e.g. 3,894 apparel SKUs — disabled Prev/Next stub).
- **Fix:** Client-side pagination via shared `usePagination` (default 25/page, per-tab localStorage). Apparel paginates top-level style groups + standalone SKUs; fabrics/trims paginate SKU rows. Footer: per-page control + Prev/Next.
- **Files:** `src/inventory/pages/InventoryListPage.jsx`, `src/inventory/inventorySkuGrouping.js`, `src/orderPagination.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Radix Themes Button (via shadcn `Button` adapter)

- **Feature:** `src/components/ui/button.jsx` now renders `@radix-ui/themes` `Button` while keeping the same shadcn API (`variant`, `size`, `asChild`). All existing imports keep working. `buttonVariants` kept for calendar nav class names.
- **Theme:** `accentColor="gray"` + `radius="medium"` on root `<Theme>` to match zinc dashboard.
- **Files:** `src/components/ui/button.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Radix UI Themes provider

- **Feature:** Added `@radix-ui/themes` — global styles import in `main.jsx`, app wrapped in `<Theme>` (syncs with light/dark toggle; `hasBackground={false}` so shadcn/Tailwind layout stays in control).
- **Files:** `package.json`, `package-lock.json`, `src/main.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-04 — Production tracker list: inline status edit

- **Issue:** Production tracker list showed status as read-only badge only; users had to open View order to change status.
- **Fix:** New `OrderListStatusCell` — dropdown in list when user has **Status** edit permission on Production tracker tab (admin always). Uses same pipeline options and `persistOrderStatus` as View order.
- **Files (new):** `src/components/orders/OrderListStatusCell.jsx`.
- **Files:** `src/LinkedOrdersTabPanel.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Fix blank screen on View order (job sheet)

- **Issue:** Production tracker **View order** → blank screen again.
- **Reason:** (1) Duplicate `useState`/`useEffect` in `OrderDetailPanel` after partial edit — React hooks count mismatch crash. (2) Job sheet payment `Select` used `value={undefined}` when payment mode / delivery city empty — shadcn Select controlled/uncontrolled crash.
- **Fix:** Remove duplicate hooks; stable `Select` sentinel values in `JobSheetOrderPaymentSection`; status dropdown always includes current status option.
- **Files:** `OrderDetailPanel.jsx`, `JobSheetOrderPaymentSection.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Production tracker: job sheet garment pipeline statuses

- **Feature:** Job sheets in Production tracker use a dedicated production pipeline status: Quotation approval → Sampling → Sourcing → Sourcing in transit → Inward → Cutting → Stitching → Trimming → Ironing → QC → Packing → Ready to Dispatch. Production users with **Status** edit permission update status in View order or list badges.
- **Database:** Migration `20260703183000_job_sheet_production_stages.sql` extends `orders.status` check + `status_label()`; backfills `order_kind = job_sheet` rows from `new` → `quotation_approval`. New job sheets save with `status: quotation_approval`.
- **Files (new):** `src/jobSheetProductionStages.js`.
- **Files:** `src/OrderDetailPanel.jsx`, `src/LinkedOrdersTabPanel.jsx`, `src/stickerOrderUtils.js`, `src/components/orders/OrderStatusBadge.jsx`, `src/App.jsx`, `src/orderPendingUtils.js`, `src/globalSearchUtils.js`, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-03 — Job sheet view order: payment & transactions + admin edit

- **Issue:** View order for production job sheets did not show advance payments, transaction proofs, dates, delivery, or approval details. Admin could not edit payment fields after create.
- **Fix:** New **Payment & transactions** and **Delivery & approval** sections in order detail (`JobSheetOrderPaymentSection.jsx`). Admin can edit payment mode, advance amount/date, full paid, delivery city, transport, approval fields, and rate per piece; **Save changes** persists via `jobSheetAdminEditUtils.js`. Admin can upload advance proof, full payment proof, and approval image. Order queries now select all `job_sheet_*` payment columns.
- **Files (new):** `src/JobSheetOrderPaymentSection.jsx`, `src/jobSheetAdminEditUtils.js`.
- **Files:** `src/OrderDetailPanel.jsx`, `src/orderAdminEditUtils.js`, `src/orderQueryFields.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Fix blank screen on View order (production tracker)

- **Issue:** Clicking **View order** in Production tracker → blank screen.
- **Reason:** `OrderDetailPanel` referenced `jobSheet` before it was declared (`ReferenceError`).
- **Fix:** Reorder declarations in `OrderDetailPanel.jsx`; safe fallback for `OrderColorsCell` prop.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Blank screen gate rule + check:ui script

- **Issue:** Repeated blank screens after UI changes (missing imports, stale vars like `effectiveQty`, bad merges in `App.jsx`).
- **Fix:** Added `.cursor/rules/blank-screen-gate.mdc` (always apply), `npm run check:ui` (`scripts/check-ui-gate.mjs`) — build + JSX import heuristic before marking work done.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Job sheets: production tracker only (not printing list)

- **Issue:** Job sheets saved with default `order_kind: printing` — showed in Printing orders list with printing UI.
- **Fix:** New job sheets save as `order_kind: job_sheet`. Printing tab excludes job sheets; global search routes them to Production tracker only. Detail panel shows job sheet fields (gender, size type, rate, etc.) not printing payment/designs.
- **Follow-up:** Stronger `isJobSheetOrder()` for legacy rows; history modal stacks above create form and closes with view/create; **Production order** badge on billing + production tracker (like sticker); billing payment column uses job sheet payment mode.
- **Migration:** `20260703200000_add_order_kind_job_sheet.sql` — adds `job_sheet` to `order_kind` check + backfill existing rows.
- **Files:** `jobSheetUtils.js`, `orderTabUtils.js`, `App.jsx`, `OrderDetailPanel.jsx`, `orderPendingUtils.js`, `globalSearchUtils.js`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, DEBUGGING.md.

## 2026-07-03 — Job sheet: total quantity read-only from sizes

- **Fix:** **Total quantity** is read-only, computed from size grid sum — not mandatory, no manual entry. Fixes browser “Please fill out this field” when qty showed as placeholder only. Fixed blank screen on open (stale `effectiveQty` reference).
- **Files:** `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Job sheet: auto total amount (rate × quantity)

- **Fix:** **Total amount** on create job sheet form now auto-calculates as rate per piece × total quantity (read-only). Advance % and balance/pending use same computed total.
- **Files:** `jobSheetPaymentUtils.js` (`calcJobSheetTotalAmount`), `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Job sheet history (same as printing order history)

- **Feature:** Production tracker job sheets now log changes to `order_activity_log` and show **Job sheet history** in order detail (same modal as printing orders).
- **Events:** Create, status, qty, sales incharge, product/gender/size type, rate, size breakdown, brand/fabric/GSM, branding, atta, handover, payment, proofs, delivery, approval, regular stock.
- **Migration:** `20260703190000_job_sheet_activity_log.sql` — extends `log_order_activity()` trigger; applied to linked Supabase project.
- **Files:** `orderHistoryUtils.js` (new), `App.jsx`, `OrderDetailPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, DEBUGGING.md.

## 2026-07-03 — Job sheet: regular stock from inventory

- **Feature:** **Regular stock** Yes/No radio beside Atta. When Yes, pick inventory SKUs from searchable dropdown; each selection adds to a list with qty input.
- **Migration:** `20260703180000_add_job_sheet_regular_stock.sql` — `job_sheet_regular_stock`, `job_sheet_regular_stock_items` on `orders`; applied to staging.
- **Files:** `CreateJobSheetForm.jsx`, `JobSheetRegularStockField.jsx` (new), `jobSheetUtils.js`, `App.jsx`, `inventoryProductPickerUtils.js`, `orderQueryFields.js`, `schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-03 — Job sheet: merged balance/pending + mandatory full-paid proof

- **UI:** Single read-only field **Balance / Pending amount** (replaces separate balance and pending fields).
- **Validation:** Full paid = Yes requires payment proof on save; production jobs marked full paid without proof cannot be updated until proof is uploaded via order detail.
- **Files:** `CreateJobSheetForm.jsx`, `App.jsx`, `OrderDetailPanel.jsx`, `jobSheetPaymentUtils.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Job sheet: payment, delivery, and approval fields

- **Feature:** Create Job sheet form now includes payment block (mode, total, advance + %, advance date, transaction proof), computed balance/pending amounts, full-paid radio with auto closure date/time, payment proof upload, delivery city (India cities), transport charges, and approval date/image/approver.
- **Migration:** `20260703160000_add_job_sheet_payment_delivery_approval.sql` — new `orders.job_sheet_*` columns; applied to **staging** (`scvojtvgnkmbupvyslmb`) only.
- **Files:** `CreateJobSheetForm.jsx`, `jobSheetUtils.js`, `jobSheetPaymentUtils.js` (new), `indianCities.js` (new), `App.jsx`, `schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-03 — Inventory tabs: Apparel first

- **Fix:** Reordered inventory kind tabs to **Apparel → Fabrics → Trims** in list view and sidebar; default list tab is Apparel.
- **Files:** `InventoryListPage.jsx`, `InventorySubNav.jsx`, `InventoryDashboard.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Faster inventory load (staged SKUs + deferred movements)

- **Issue:** Inventory tab slow to open — long skeleton with thousands of SKUs.
- **Reason:** `fetchInventoryBundle` loaded all SKU pages, 100 stock movements, and full supplier/warehouse rows before first paint.
- **Fix:** Initial load uses first 1000 SKUs (`INVENTORY_SKU_LIST_SELECT`), background fetch for remaining SKUs, movements deferred (2.5s or when Movements tab opens). SKU drawer hydrates full row + last 6 movements on open. Slim supplier/warehouse selects.
- **Files:** `src/inventory/inventoryQueryFields.js` (new), `inventoryDbUtils.js`, `InventoryDataContext.jsx`, `InventoryDashboard.jsx`, `SkuDrawer.jsx`, `InventoryMovementsPage.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Faster initial load (orders list query + deferred extras)

- **Issue:** Dashboard felt slow after login — long loading skeleton before orders appeared.
- **Reason:** `fetchOrders` downloaded every order with heavy design image URL JSON for all rows. Global search extras (400 challans + contacts) ran immediately on login. Orders also polled every 25s on top of realtime.
- **Fix:** Split order queries — lightweight `ORDERS_LIST_SELECT` for list/tabs; full `ORDERS_FULL_SELECT` loaded when opening order detail (`hydrateOrderDetail`). Deferred global search extras by 2.5s. Poll interval 25s → 60s and only when tab visible.
- **Files:** `src/orderQueryFields.js` (new), `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Enforce staging-only local dev + environment health docs

- **Issue:** Risk of local dev or agents touching production Supabase during development.
- **Fix:** `supabaseClient.js` blocks dev server when production URL is loaded (escape: `VITE_ALLOW_PROD_IN_DEV=true`). Compact green pulse dot before global search shows staging (tooltip on hover); amber dot if prod. `npm run check:env` verifies dev commands. `VITE_APP_ENV=staging` on `.env.development` / `.env.staging`. Documented prod vs staging health and MCP rules in `docs/ENVIRONMENTS.md`. Cursor rule `.cursor/rules/staging-only-dev.mdc`.
- **Files:** `src/supabaseClient.js`, `src/components/DevEnvironmentIndicator.jsx`, `src/App.jsx`, `scripts/check-dev-env.mjs`, `package.json`, env examples, `docs/ENVIRONMENTS.md`, `.cursor/rules/staging-only-dev.mdc`.
- **Documentation updated:** CHANGELOG.md, ENVIRONMENTS.md.

## 2026-07-03 — Fix orders table empty after save (missing DB columns)

- **Issue:** Orders vanished after saving jobs — loading skeleton, then empty table. Saves could succeed in DB but UI could not reload rows.
- **Reason:** `fetchOrders` selects `gender` and `product_type`, but migration `20260709120000_add_job_sheet_gender_product_type.sql` was not applied to production or staging Supabase projects. PostgREST failed the entire select; errors were console-only.
- **Fix:** Applied `add_job_sheet_gender_product_type` migration to production (`levwrmvqdntngeasrtnb`) and staging (`scvojtvgnkmbupvyslmb`). Added `ordersLoadError` alert in Printing tab when order fetch fails.
- **Files:** `src/App.jsx`, `docs/DEBUGGING.md`, `docs/CHANGELOG.md`.
- **Migration applied remotely:** `add_job_sheet_gender_product_type`.

## 2026-06-25 — Production tracker: Pets uses standard size grid

- **Issue:** Pets gender lost normal XXS–8XL quantity inputs.
- **Fix:** When gender is **Pets**, size grid uses standard alpha columns (XXS–8XL) with qty inputs like before; product type and size type dropdowns hidden. Additional sizes still available.
- **Files:** `jobSheetUtils.js`, `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Production tracker: fixed product type list

- **Fix:** Product type dropdown now uses fixed list: Denim Pant, Hoodies, Jacket, Polo, Round Neck, Shirt, Shorts, Skirts, Trackpant, V Neck (filtered by gender). Kids Polos maps to Polo; trackpants normalize to Trackpant. Pets gender skips product type.
- **Files:** `jobSheetSizeTypeConfig.js`, `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, README.md.

## 2026-06-25 — Production tracker: gender + product type dropdowns

- **Issue:** Job sheet only had size type; no separate gender or product type fields.
- **Fix:** Added **Gender** (Kids / Women / Men / Pets) and **Product type** (Shorts, Polo, Hoodies, etc.) dropdowns before size type. Options filter by selection; size type list narrows to matching style from size set helper. Saved on `orders.gender` and `orders.product_type`.
- **Migration:** `20260709120000_add_job_sheet_gender_product_type.sql`
- **Files:** `CreateJobSheetForm.jsx`, `jobSheetSizeTypeConfig.js`, `jobSheetUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, README.md, schema.sql.

## 2026-06-25 — Production tracker: size types from size set helper sheet

- **Issue:** Job sheet size type dropdown used generic options (Alpha/Numeric/Free/Custom) with no per-style size templates.
- **Reason:** `JOB_SHEET_SIZE_TYPES` was hard-coded placeholders; Excel **size set helper** defines 25 product styles with template numbers/labels beside each size (not quantities).
- **Fix:** New `jobSheetSizeTypeConfig.js` with all styles from the sheet (Kids Shorts, Men Polo, Kids Polos age ranges, etc.). Selecting size type loads the correct column set; headers show **size · template** (e.g. `M · 32`, `XXS · 0-2 Yrs`). Quantity inputs stay separate below each header.
- **Files:** `jobSheetSizeTypeConfig.js` (new), `jobSheetUtils.js`, `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, README.md.

## 2026-06-25 — SKU management: parent/sub SKUs save to inventory

- **Issue:** Adding parent or sub SKU in SKU management did not show up in the main inventory list.
- **Reason:** Parent-only rows live in `inventory_style_parents` (not stock records). Sub SKU flow opened a separate modal without calling `createSku` inline, and empty parents were omitted from the apparel grouped table.
- **Fix:** **Add sub SKU** now opens `AddSubSkuDialog` that calls `createSku` and writes to `inventory_skus`. After **Add parent SKU**, first sub SKU dialog opens automatically. Apparel list merges empty parent styles so new groups appear before variants exist.
- **Files:** `AddSubSkuDialog.jsx` (new), `SkuManagementModal.jsx`, `InventoryListPage.jsx`, `InventoryDashboard.jsx`, `inventorySkuGrouping.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory: SKU management panel

- **Issue:** No dedicated UI to browse parent styles, view sub SKUs, or add parent/sub SKUs outside the create-style flow.
- **Fix:** **SKU management** button on inventory list toolbar opens a dialog with parent SKU list (left), sub SKU table on parent click (right), **Add parent SKU** inline form, and **Add sub SKU** opens create modal locked to selected parent.
- **Files:** `SkuManagementModal.jsx` (new), `InventoryListPage.jsx`, `InventoryDashboard.jsx`, `InventoryDataContext.jsx` (`createStyleParent`), `NewSkuModal.jsx` (`initialParent`), `inventorySkuGrouping.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory tables: true shadcn styling + inline DOC/DRR

- **Issue:** Inventory list still looked legacy — blue gradient table headers, blue cell borders, static DOC/DRR numbers.
- **Reason:** Global `styles.css` rules targeted all `th`/`td` (blue gradient headers). Shadcn `Table` had no isolation marker.
- **Fix:** `data-shadcn-table` on shadcn Table + CSS isolation in `index.css` and scoped legacy rules in `styles.css`. Reorder/DOC/DRR columns use shadcn `Input` (`SkuMetricInput`) with save on blur. Toolbar/card use shadcn tokens.
- **Files:** `table.jsx`, `index.css`, `styles.css`, `InventoryListPage.jsx`, `SkuMetricInput.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory UI: remove Lucide icons

- **Issue:** Inventory module still used Lucide icons in nav, tables, modals — not aligned with shadcn-only UI policy.
- **Fix:** Removed all `lucide-react` imports under `src/inventory/`; buttons use text labels, shadcn `Alert`/`Badge`/`MovementTypeBadge`, and text sort/expand indicators.
- **Files:** All inventory pages, modals, `InventorySubNav.jsx`, `inventoryUiUtils.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory: parent SKU groups, pricing, DOC & DRR

- **Issue:** SKUs were flat list only; no parent/sub style grouping; pricing limited to apparel retail; no DOC/DRR fields.
- **Fix:** New `inventory_style_parents` table; SKUs link via `parent_style_id`. Create apparel style: choose **new parent** or **existing parent** + sub SKU code. Per-SKU **unit cost + sale price** for all kinds. **Reorder**, **DOC** (days of cover), **DRR** (daily run rate) on create and in SKU drawer. Apparel list groups variants under expandable parent rows.
- **Migration:** `20260708120000_inventory_sku_parent_pricing_doc_drr.sql`
- **Files:** `inventoryDbUtils.js`, `InventoryDataContext.jsx`, `NewSkuModal.jsx`, `InventoryListPage.jsx`, `SkuDrawer.jsx`, `inventorySkuGrouping.js`, migration.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-06-25 — Live sync: printing product picker ↔ inventory SKUs

- **Issue:** New inventory SKUs did not appear in Create printing order product list until page reload.
- **Fix:** Supabase Realtime on `inventory_skus`; debounced silent refetch updates printing product picker and inventory tab when SKUs are added/updated/deleted.
- **Migration:** `20260707120000_inventory_skus_realtime.sql` (add table to `supabase_realtime` publication).
- **Files:** `App.jsx`, `InventoryDataContext.jsx`, migration.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix printing product picker missing SKUs

- **Issue:** Product name dropdown did not show all inventory SKUs.
- **Reason:** Single Supabase query capped at default row limit; shadcn `Select` viewport height matched trigger (one row visible, poor scroll).
- **Fix:** Paginated fetch for all SKUs; searchable scrollable Popover combobox with SKU code + name + color; global Select viewport scroll fix.
- **Files:** `PrintingOrderProductField.jsx`, `inventoryProductPickerUtils.js`, `select.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Printing order product picker from inventory

- **Issue:** Create printing order used free-text product name; colors picked manually.
- **Fix:** Product name is shadcn select from inventory SKUs (Apparel, Fabrics, Trims groups) plus **Custom** for manual entry. Picking inventory product auto-fills Colors from SKU hex/name.
- **Files:** `PrintingOrderProductField.jsx`, `inventoryProductPickerUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Keep production block after job sheet save

- **Issue:** After saving job sheet from create printing order form, production section reset (Production = No, handover cleared) — no confirmation.
- **Reason:** `handleCreateJobSheet` cleared `is_production_order` and handover on success.
- **Fix:** Keep Production order Yes/No and handover date visible; show green shadcn **Job sheet created** alert with order #; hide Create job sheet button after success; final printing order still saves as printing-only when job sheet already created.
- **Files:** `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Admin empty dropdown: add & use inline

- **Issue:** Master-list dropdowns (owners, coordinators, sales incharges, inventory suppliers/warehouses) were empty with no way to add an entry in place.
- **Reason:** Admin had to leave the form and use Admin Panel master toolbar separately.
- **Fix:** New shadcn `MasterListSelectField` — when options are empty and user is admin, shows name input + **Add & use**; saves to DB, refreshes list, auto-selects. Wired to create order (owner/coordinator), job sheet (sales incharge), order detail, repeat template, inventory SKU/PO modals.
- **Files:** `MasterListSelectField.jsx`, `App.jsx`, `OrderDetailPanel.jsx`, `CreateJobSheetForm.jsx`, `InventoryDataContext.jsx`, `inventoryMasterQuickAdd.js`, `NewSkuModal.jsx`, `CreatePOModal.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Create job sheet from printing order form (handover row)

- **Issue:** User wanted **Create job sheet** beside the handover date in Create New Order (Production order = Yes), not in the order list rows.
- **Reason:** Prior change put the button on each list row; correct UX is inline on the production handover field while creating a printing order.
- **Fix:** shadcn **Create job sheet** button next to handover `DatePicker`. Opens job sheet form pre-filled from current printing form. On save: job sheet → Production Tracker; printing form resets to **Production order: No** so saved printing order is regular only. Row-level list buttons removed.
- **Files:** `App.jsx`, `jobSheetUtils.js`, `OrderViewActionCell.jsx`, `styles.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — shadcn-only UI standard + blank-screen gate

- **Policy:** All new and migrated UI must use shadcn components only (no legacy buttons/inputs/modals).
- **Pre-build gate:** Before finalizing UI work — run `npm run build`, verify imports in changed files, check dev terminal for HMR/JSX errors, confirm app loads (no blank screen).
- **Files:** `.cursor/rules/shadcn-ui-only.mdc`, `docs/DEBUGGING.md`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-06-25 — Fix blank screen after View Order Dialog change

- **Issue:** App showed blank white screen on load.
- **Reason:** `CreateOrderModal` import was accidentally removed from `App.jsx` when adding shadcn `Dialog` for View Order; React crashed with `ReferenceError: CreateOrderModal is not defined`.
- **Fix:** Restored `import CreateOrderModal from "./components/orders/CreateOrderModal"`.
- **Files:** `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — View order modal shadcn UI

- **Issue:** View order modal had mismatched legacy buttons (purple Mark complete, red Delete, plain Save) and form controls that did not match shadcn dark theme.
- **Reason:** `OrderDetailPanel` still used legacy CSS classes (`btn-mark-complete`, `danger-btn`, `order-detail-control`, `status-pill`) inside old modal shell.
- **Fix:** Migrated panel to shadcn `Button`, `Input`, `Select`, `Textarea`, `Checkbox`, `Badge`, `OrderStatusBadge`, and `DatePicker`. Wrapped modal in shadcn `Dialog`. Footer actions use proper variants: outline / default / secondary / destructive.
- **Files:** `OrderDetailPanel.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Prevent duplicate order saves + pending row loader

- **Issue:** Orders sometimes saved multiple times on double-submit; form stayed open during long uploads; no in-list feedback while saving.
- **Reason:** Regular create-order handler had no submit lock or `saving` state; async upload+insert allowed repeated clicks. Other forms closed only after save finished.
- **Fix:** Global `orderSubmitLockRef` blocks concurrent submits across all order forms. After validation, form closes immediately, optimistic pending row appears at top of Printing / Production Tracker lists with shadcn `Loader2` spinner instead of “View order”; pending clears after insert + refresh. Added `savingOrder` on main create form submit button.
- **Files:** `App.jsx`, `OrderViewActionCell.jsx`, `orderPendingUtils.js`, `LinkedOrdersTabPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Global search dropdown scroll

- **Issue:** Global search results list would not scroll; wheel moved the dashboard behind the dropdown instead.
- **Reason:** `ScrollArea` with only `max-h-72` never got a fixed height (Radix viewport stayed full content height). Dropdown also lived inside `overflow-hidden` shell without portal, so wheel events bubbled to `[data-dashboard-scroll]`.
- **Fix:** Render results in shadcn `PopoverContent` (portals to body). Replaced `ScrollArea` with native `overflow-y-auto max-h-72` and `overscroll-contain`; stop wheel propagation at list edges. Header set `overflow-visible`.
- **Files:** `GlobalSearchBox.jsx`, `DashboardShell.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Printing, Billing, Production Tracker shadcn UI

- **Issue:** Printing, Billing, and Production Tracker still showed legacy blue summary bar, bordered tables, status pills, and native tab buttons.
- **Reason:** Those panels used old CSS classes (`orders-processed-summary`, `orders-table-compact`, `status-pill`, `orders-tab`) inside `.legacy-ui`; global `table`/`th`/`td` rules overrode shadcn styling.
- **Fix:** Migrated all three areas to shadcn `Card` summary, `Table`, `Badge`, `Tabs`, `Button`, `Skeleton`. Shared components: `OrdersListSummary`, `OrderStatusBadge`, `OrderIdBadges`, `orderTableUtils`. Added `data-orders-table` CSS isolation from legacy global table rules.
- **Files:** `BillingTabPanel.jsx`, `LinkedOrdersTabPanel.jsx`, `PrintingDepartmentPanel.jsx`, `App.jsx`, new order components under `components/orders/`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Admin edit user modal shadcn UI

- **Issue:** Edit user access modal had broken layout — huge misaligned checkboxes and floating labels in Order & sidebar access.
- **Reason:** Modal lived inside `.legacy-ui`; global rule styled all `input` as full-width `h-9` text fields, including native checkboxes. Legacy CSS grid fought shadcn components.
- **Fix:** Rebuilt `ViewerUserEditModal` with shadcn `Dialog`, `Input`, `Label`, `Select`, `Switch`, `Button`. Extracted `OrderFieldPermissionFields` with shadcn `Checkbox` grid. Refreshed `SidebarTabPermissionFields` with Tailwind table layout. Create-user permissions in `App.jsx` use same component. Legacy input rule excludes checkbox/radio/file types.
- **Files:** `ViewerUserEditModal.jsx`, `OrderFieldPermissionFields.jsx`, `SidebarTabPermissionFields.jsx`, `App.jsx`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Calendar date hover highlight

- **Issue:** Hovering calendar dates did not show the rounded highlight box like shadcn reference.
- **Reason:** Calendar override CSS reset cell/button backgrounds without hover rules; day button missed explicit `hover:bg-accent` and used wrong `rdp-day` class key.
- **Fix:** Restored shadcn day-button hover/focus/selected classes; CSS adds `hover` accent background on `button[data-day]`; `today` cell no longer forced transparent; DatePicker calendar uses `rounded-md border shadow-sm` per shadcn demo.
- **Files:** `calendar.jsx`, `date-picker.jsx`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix calendar size (global table CSS)

- **Issue:** Calendar still huge with bordered cells — not matching compact shadcn reference.
- **Reason:** Global `styles.css` rules `table { min-width: 1120px }` and `th, td { border; padding: 8px }` applied to react-day-picker's `table.rdp-month_grid`, blowing up the popover to full dashboard width.
- **Fix:** Scoped dashboard table rules to exclude `.rdp-month_grid` / `.rdp-weekday` / `.rdp-day`. Added calendar-specific resets in `index.css` (14rem / 2rem cells). Day buttons fixed to `h-8 w-8` without `w-full`.
- **Files:** `styles.css`, `index.css`, `calendar.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix calendar overlap / detached caption

- **Issue:** Calendar popover huge; month/year caption floated away from grid and overlapped action buttons.
- **Reason:** `react-day-picker` nav is `position: absolute` across full `.rdp-months` width — when months container expanded, prev/next/caption split apart. Legacy CSS could also inflate dropdown `select` elements.
- **Fix:** Restored official shadcn `Calendar` with fixed month width (`7 × --cell-size`), `w-fit` months container, `navLayout` default overlay, `DatePicker` popover `z-[200]` + `className="rounded-lg border"`. CSS isolates calendar dropdown selects and popper stacking.
- **Files:** `calendar.jsx`, `date-picker.jsx`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Compact shadcn calendar everywhere

- **Issue:** Date picker calendar grid was huge — cells stretched across full dashboard width instead of compact shadcn popover.
- **Reason:** Calendar month/week used `w-full` + `flex-1` without fixed cell width, so popover expanded to viewport; legacy global button min-heights could also inflate day cells.
- **Fix:** Calendar uses fixed `--cell-size: 2rem` and `w-fit` grid; `DatePicker` compact format (`MMM d, yyyy`), dropdown caption, `minDate`/`maxDate` support. CSS isolates `[data-slot="calendar"]` from legacy styles. Replaced remaining native `type="date"` inputs with `DatePicker` in order detail, dealer report, contact book, inward GRN, and order templates.
- **Files:** `calendar.jsx`, `date-picker.jsx`, `index.css`, `OrderDetailPanel.jsx`, `DealerReportPanel.jsx`, `ContactBookPanel.jsx`, `InwardGrnEntryPage.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix dashboard scroll (shadcn shell, pass 2)

- **Issue:** Scroll still stuck after first fix — inventory table and other tabs would not scroll.
- **Reason:** Flex chain broken at multiple points: `App.jsx` inner wrapper missing `min-h-0`; `InventoryDashboard` fragment broke flex; Radix `ScrollArea` used without height (expands to full content); `h-full` chain unreliable without `html/body/#root` height lock.
- **Fix:** Shell uses explicit `h-svh` on provider; scroll region tagged `[data-dashboard-scroll]`. Full flex chain with `min-h-0` from shell → inventory panel → list table (`overflow-y-auto`). Replaced broken `ScrollArea` with native overflow on inventory table. `html/body/#root` height + overflow lock so inner regions scroll.
- **Files:** `DashboardShell.jsx`, `App.jsx`, `InventoryTabPanel.jsx`, `InventoryDataContext.jsx`, `InventoryDashboard.jsx`, `InventorySubNav.jsx`, `InventoryListPage.jsx`, `index.css`, `responsive-desktop.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix dashboard scroll (shadcn shell)

- **Issue:** Could not scroll anywhere — inventory table and other tabs clipped with no scrollbar.
- **Reason:** Desktop CSS locks `.page.app-layout` to `100dvh` + `overflow: hidden` (old layout scrolled inside `.dashboard-main`). After shadcn `SidebarProvider` / `SidebarInset` migration, no inner region had `overflow-y: auto` or a bounded flex height chain.
- **Fix:** `DashboardShell` — provider/inset use `h-full min-h-0 overflow-hidden`; main content area gets `flex-1 overflow-y-auto` (full-bleed tabs scroll inside their panel). `App.jsx` page wrapper is flex column `h-svh`. Inventory + asset panels use `flex-1 min-h-0` instead of fixed `calc(100vh…)` heights. Desktop CSS targets shadcn sidebar wrapper.
- **Files:** `DashboardShell.jsx`, `App.jsx`, `InventoryTabPanel.jsx`, `InventoryDashboard.jsx`, `AssetManagementPanel.jsx`, `responsive-desktop.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Team chat shadcn UI

- **Issue:** Team chat used legacy panel CSS, native buttons/textarea, and emoji popover styling inconsistent with shadcn migration.
- **Fix:** Rebuilt `TeamChatPanel` with shadcn `Card`, `ScrollArea`, `PersonAvatar`, `Textarea`, `Button`, `Badge`, `Popover`, `Alert`, `Separator`. Message bubbles with own/other styling; Lucide toolbar icons. Team directory RPC + fallback query include `avatar_path`.
- **Migration:** `20260706130000_team_chat_directory_avatars.sql` (drops + recreates RPC — Postgres cannot change return type with `CREATE OR REPLACE` alone).
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Fix skewed avatars

- **Issue:** Profile photos in admin user table (and contact cards) looked stretched or oval.
- **Reason:** `AvatarImage` lacked `object-cover`; table cells and legacy 72×72 contact photo box squashed non-square containers.
- **Fix:** Shadcn avatar uses `object-cover` + `aspect-square`; fixed-width avatar table column; contact card photo wrapper no longer forces rectangle clip over round avatar.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Admin action button icon size

- **Issue:** Edit/delete icons in admin user & master directory tables looked too small inside their buttons.
- **Reason:** Legacy CSS forced 28×28px buttons with 15×15px SVGs.
- **Fix:** Replaced with shadcn `Button` (`size="icon"`, 36px) + Lucide `Pencil`/`Trash2` at 18px. Removed overly tight admin CSS overrides.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Fix blank admin panel

- **Issue:** Admin tab showed blank screen on open.
- **Reason:** `OrdersPerPageControl` used in admin user list footer but removed from `App.jsx` imports during pagination refactor — runtime `ReferenceError` crashed the panel.
- **Fix:** Restored `OrdersPerPageControl` import in `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Profile & contact avatars (shadcn)

- **Issue:** Contacts had photo upload but legacy image UI; dashboard users had no avatar field or picker.
- **Fix:** Added `profiles.avatar_path` + `profile-avatars` storage bucket. Shared `PersonAvatar`, `AvatarUploadField`, and `avatarUtils`. Contact Book uses shadcn avatars for cards and upload. Admin user create/edit and sidebar footer show profile photos with initials fallback.
- **Migration:** `supabase/migrations/20260706120000_add_profile_avatars.sql`
- **Files:** `src/avatarUtils.js`, `src/components/ui/person-avatar.jsx`, `avatar-upload-field.jsx`, `ContactBookPanel.jsx`, `ViewerUserEditModal.jsx`, `App.jsx`, sidebar layout, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Broad shadcn UI migration (orders, printing, reports)

- **Issue:** Many screens still used legacy HTML buttons, native date inputs, and `modal-backdrop` panels while shadcn components were installed but unused in key flows.
- **Fix:** Rolled shadcn across high-traffic areas using installed components (`Button`, `Input`, `Label`, `Select`, `Textarea`, `Checkbox`, `Dialog`, `Table`, `Alert`, `DatePicker`, `Calendar`, `Popover`).
- **New shared:** `OrdersListFilters.jsx` — date range, search, per-page for order tabs.
- **Migrated:** Order pagination; printing orders filters + create actions (`App.jsx`); job sheet & sticker/sampling forms; billing/dispatch/linked order filters; product revenue toolbar; coordinator report toolbar; printing dept inventory/utilization modals & actions; admin sidebar tab permissions (`Checkbox`).
- **Still legacy (next pass):** `App.jsx` inline create-order printing form, `OrderDetailPanel`, `ViewerUserEditModal`, inward/GRN modals, `ContactBookPanel`, `MockupStudio`, `dropdown-menu` / `Switch` not yet wired.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Shadcn Calendar date pickers

- **Issue:** Create order and inventory forms used native `<input type="date">` — inconsistent with shadcn UI and poor month/year navigation.
- **Fix:** Added shadcn `Calendar`, `Popover`, and `DatePicker` wrapper (`mode="single"`, `captionLayout="dropdown"`, `className="rounded-lg border"` per reference). Replaced date inputs in create order modal, job sheet, sticker/sampling forms, and inventory PO modal.
- **Dependencies:** `react-day-picker`, `date-fns`, `@radix-ui/react-popover`.
- **Files:** `src/components/ui/calendar.jsx`, `popover.jsx`, `date-picker.jsx`, `src/App.jsx`, `src/CreateJobSheetForm.jsx`, `src/CreateStickerOrderForm.jsx`, `src/inventory/modals/CreatePOModal.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Create order Save/Cancel button styles

- **Issue:** Custom `formCancel` / `formSave` variants used heavy solid dark fills instead of standard shadcn button styling.
- **Fix:** Cancel uses shadcn `variant="destructive"` (standard destructive token). Save uses new outline `success` variant — green border/text, transparent background (not solid).
- **Files:** `src/components/ui/button.jsx`, `src/App.jsx`, `src/CreateJobSheetForm.jsx`, `src/CreateStickerOrderForm.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Create order modal shadcn UI

- **Issue:** Create New Order modal used legacy backdrop/panel CSS; bare `select`/`input` elements broke the 3-column grid; mixed heights, blue accents, and misaligned footer buttons in dark mode.
- **Fix:** Replaced custom modal with shadcn `Dialog` (`CreateOrderModal.jsx`). Main printing form, job sheet, and sticker/sampling forms use unified `.create-order-form` grid with shadcn input/select/textarea tokens. Wrapped orphan Owner/Customer/Coordinator/Printing Mtrs fields in labeled cells. Save/Cancel use shadcn `Button` (right-aligned).
- **Files:** `src/components/orders/CreateOrderModal.jsx` (new), `src/App.jsx`, `src/CreateJobSheetForm.jsx`, `src/CreateStickerOrderForm.jsx`, `src/index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Sidebar brand logo slow spin

- **Feature:** Dashboard sidebar brand logo rotates slowly (14s per revolution) with `transform-origin: center` so spin pivots on the image midpoint. Respects `prefers-reduced-motion`.
- **Files:** `tailwind.config.js`, `src/components/layout/DashboardAppSidebar.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Home status cards spacing (shadcn grid)

- **Issue:** 11 status cards used `auto-fill` / 6-column legacy grid → uneven gaps (8+3 rows) and misaligned header vs card grid.
- **Fix:** New `HomeStatusPanel` with shadcn `Card` + responsive grid (`2→3→4→5→6` columns, max 6 on xl) for balanced 6+5 layout; consistent `gap-3`; header title and refresh row aligned with grid width.
- **Files:** `src/components/home/HomeStatusPanel.jsx` (new), `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Topbar and home dashboard alignment

- **Topbar:** Replaced fixed `h-14` header with flexible two-row layout on narrow viewports — search + Archive/Logout stay on one row with proper padding; no overlap with bottom border.
- **Search:** `GlobalSearchBox` accepts `className`; flexes in toolbar with `shrink-0` action buttons.
- **Home status grid:** `auto-fill` minmax grid for even card spacing; equal card heights; consistent section gaps.
- **Report toolbar:** Coordinator report filter segments use shadcn-neutral borders/spacing (no blue active gradient).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Sidebar logo alignment when collapsed

- **Issue:** Collapsing the sidebar to icon mode squished the brand logo — header kept `p-4` padding while rail width is only 48px.
- **Fix:** Rebuilt sidebar header with shadcn `SidebarMenuButton size="lg"` brand pattern; logo in fixed `aspect-square size-8` container with `object-contain` and `shrink-0`. Text hides in icon mode via `group-data-[collapsible=icon]:hidden`.
- **Footer:** Hide notification/theme controls when collapsed; center avatar; hide "Soon" badges in icon mode.
- **Topbar:** Tighter header alignment (`shrink-0` on trigger/actions, separator hidden on very small widths).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Neutral zinc dark theme + sidebar tab icons

- **Theme:** Switched design tokens from blue/slate palette to standard shadcn **zinc** (black/gray only in dark mode). Updated `components.json` `baseColor` to `zinc`.
- **Dark mode:** `--primary` is white-on-black; borders/inputs/muted use gray steps; no blue ring or accent colors.
- **Legacy admin panel:** Neutral overrides for create-user form, master view tabs, and status-tone toggle (removed indigo/blue active states).
- **Sidebar:** Restored Lucide icons beside each tab (shadcn default icon library). Inventory sub-nav icons restored too.
- **Shell:** Main content area uses `bg-background` (pure black in dark) instead of tinted muted blue.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Fix shadcn CSS conflicts, dark mode, sidebar icons

- **Issue:** Legacy `styles.css` applied blue gradient to all native `<button>` elements, removed focus rings globally, and `html.theme-dark body` overrode shadcn dark tokens — shadcn Button/Input looked broken or mismatched.
- **Fix:** Scoped global button styles and focus/box-shadow resets to `.legacy-ui` only; added `index.css` overrides so `body` uses shadcn `--background` / `--foreground` in light and dark; synced legacy CSS vars to shadcn tokens under `html.dark`.
- **Sidebar tokens:** Light mode sidebar now uses standard shadcn light sidebar palette (was incorrectly dark in light mode).
- **Sidebar nav:** Removed Lucide icon imports from `DashboardAppSidebar` and `InventorySubNav` — text-only shadcn `SidebarMenuButton` / `Button` items.
- **Shell controls:** `ThemeToggleButton` and `NotificationBellButton` now shadcn `Button` + `Badge` (no legacy gradient buttons in sidebar footer).
- **SidebarTrigger:** Replaced Lucide `PanelLeft` with text toggle in shadcn sidebar component.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Global search + legacy shadcn bridge

- **GlobalSearchBox:** Rewrote with shadcn `Input`, `Badge`, `ScrollArea`, Lucide `Search` icon — dropdown uses popover tokens.
- **Legacy bridge:** Expanded `src/index.css` `.legacy-ui` overrides so panels, tables, inputs, buttons, modals, and banners use shadcn design tokens (colors, borders, shadows) until each tab is fully migrated.
- **App banners:** Profile error, dev production warning, and master-table warnings now use shadcn `Alert` instead of `.panel` divs.
- **Tab scoping:** Inventory tab removed from `.legacy-ui` wrapper (full shadcn module); `fullBleed` shell for inventory + asset management.
- **Build fix:** `InventoryDashboard.jsx` return wrapped in fragment after layout refactor.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Inventory module full shadcn migration

- **UI rewrite:** Migrated all inventory pages, modals, and drawer from legacy `inventory.css` class names to shadcn/ui + Tailwind + Lucide icons.
- **Pages:** `InventoryOverview`, `InventoryListPage`, `InventoryAlertsPage`, `InventoryMovementsPage`, `InventoryPurchaseOrdersPage`, `InventorySuppliersPage`, `InventoryWarehousesPage` — Card/Table/Tabs/Badge patterns, shared `PageHeader` and status badges via `inventoryUiUtils.jsx`.
- **Modals/drawer:** `SkuDrawer` (Sheet), `AdjustStockModal`, `CreatePOModal`, `NewSkuModal`, `ImportSkusModal`, `NewSupplierModal`, `NewWarehouseModal`, `InventoryThresholdSettingsModal` — Dialog/Sheet with Input, Label, Select, Checkbox, Textarea.
- **Dashboard:** Toast stack in `InventoryDashboard.jsx` now Tailwind-styled with Lucide check icon.
- **Bug fix:** `CreatePOModal` PO number draft used undefined `POS` — now uses `pos.length` from context.
- **Preserved:** All business logic, hooks, callbacks, and data context unchanged.
- **Files:** `src/inventory/inventoryUiUtils.jsx` (new), all inventory pages/modals above, `InventoryDashboard.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Asset Management full shadcn rewrite

- **UI Rewrite:** Replaced `src/AssetManagementPanel.jsx` inline `css()`/`SCOPED_CSS` prototype styling with full shadcn/Tailwind layout and components.
- **Navigation/Layout:** Added shadcn-style sidebar nav (`bg-sidebar` + ghost/default `Button` inside `ScrollArea`), required root layout (`h-[calc(100vh-3.5rem)]`), and new header with search + scan/new actions.
- **Screens:** Migrated dashboard stats, assets table, detail page, add asset form, label settings, audit log, and scanner to `Card`, `Table`, `Badge`, `Select`, `Alert`, `Separator`, `Textarea`, and `Dialog`.
- **Behavior preserved:** Kept all asset business logic intact (state flow, user fetch from Supabase, assign/check-in/out, save asset, label preview/print, auto-tag generation, filters, admin settings).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Shadcn UI foundation + dashboard shell redesign

- **Foundation:** Added Tailwind CSS 3, PostCSS, and shadcn/ui (`components.json`, `src/index.css` design tokens, `@/` path alias in Vite). Installed core shadcn components: button, card, input, label, badge, select, table, tabs, dialog, sidebar, sheet, avatar, scroll-area, dropdown-menu, tooltip, separator.
- **Login:** Replaced legacy auth card with shadcn `LoginPage` (Card + Input + Button).
- **Dashboard shell:** Replaced custom `dashboard-sidebar` / topbar markup with shadcn `SidebarProvider` + `DashboardAppSidebar` + `DashboardShell` (collapsible sidebar, sticky header, SidebarTrigger). Dark mode syncs both `theme-dark` and shadcn `dark` class on `<html>`.
- **Asset Management:** Header actions migrated to shadcn Button/Input; layout uses Tailwind utility classes for full-bleed within the new shell.
- **Note:** Tab content (orders, inventory, billing, etc.) still uses existing CSS — migrate module-by-module next.
- **Files:** `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `components.json`, `jsconfig.json`, `src/index.css`, `src/lib/utils.js`, `src/components/ui/*`, `src/components/layout/*`, `src/components/auth/LoginPage.jsx`, `src/App.jsx`, `src/main.jsx`, `src/AssetManagementPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: admin label layout settings

- **Feature:** Admins get **Label settings** in the Asset Management sidebar (ADMIN section). Configure four label slots: above barcode line 1 & 2, below barcode line 1 & 2. Each slot maps to an asset field (name, tag, category, serial, manufacturer, location, assignee, category·serial, or hidden).
- **Print:** `assetLabelPrint.js` now renders labels from saved settings instead of hardcoded name/meta/tag/location. Barcode still always encodes the asset tag (CODE128).
- **Persistence:** Settings saved in browser `localStorage` (`scott-asset-label-settings`) via `src/assetLabelSettings.js`; live preview on settings page and Add asset form; **Print sample label** uses current draft before save.
- **Files:** `src/assetLabelSettings.js` (new), `src/assetLabelPrint.js`, `src/AssetManagementPanel.jsx`, `src/App.jsx` (`isAdmin` prop).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: auto tags, user assignment, sidebar Soon removed

- **Removed:** `laptop.jpg` placeholder image on asset detail header.
- **Auto tag IDs:** Manual tag suffix input removed. New assets get sequential tags (`IT-00001`, `IT-00002`, …) via `generateNextAssetTag()` in `src/assetTagUtils.js`; preview shows read-only auto-generated ID.
- **User assignment:** Assignee picker loads active users from `profiles` (`viewer` + `admin` roles — same pool as admin-created users). Add-asset **Assigned to** is a dropdown; unassigned assets on detail show **Assign asset** UI; check-out modal assigns a selected user; check-in clears assignment and marks asset Available.
- **Sidebar:** Removed **Soon** badge from Asset Management tab (`asset_management` dropped from `DASHBOARD_SIDEBAR_SOON_TAB_IDS`).
- **Files:** `src/AssetManagementPanel.jsx`, `src/assetTagUtils.js` (new), `src/dashboardSidebarConfig.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: scannable 4×6 cm labels + location field

- **Feature (barcode):** Replaced decorative barcode stripes with real **CODE128** barcodes via `jsbarcode` (same stack as inward GRN labels). Preview on Add asset and Asset detail; **Print label** opens a print window sized **4 cm × 6 cm** with scannable bars, asset tag, name, serial, category, and location.
- **Files (new):** `src/assetLabelBarcode.js`, `src/assetLabelPrint.js`.
- **Change (location):** Renamed form field **Home location** → **Location**. Dropdown options are now only **Ground floor** and **4th floor IT room** (default: Ground floor). Detail specs and assignment panel read live `detail.location`.
- **Files:** `src/AssetManagementPanel.jsx`, `src/assetLabelBarcode.js`, `src/assetLabelPrint.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: working Add form + functional filters

- **Fix (add asset):** "Save asset" now actually creates the asset. The Add form is fully controlled via a `form` state object; on save it builds an asset (status derived from whether "Assigned to" is set) and prepends it to a new `rawAssets` state list, then resets the form and bumps the tag suffix. Previously the inputs were uncontrolled (`defaultValue`) and Save merely navigated, so nothing persisted. Category/Home location are now `<select>` dropdowns.
- **Fix (filters):** Filter chips were static with no handlers. They now drive an `activeFilter` state and filter the table (`filteredAssets`). Removed the **Available** and **Laptops** chips; remaining `All assets` / `Checked out` / `Maintenance` work as status filters. Subtitle and dashboard stat cards/subtitle now show live counts.
- **Note:** Asset data is in-component React state only — it is **not** persisted to a backend yet, so it resets on refresh/tab change.
- **Files:** `src/AssetManagementPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management tab starts blank (no demo data)

- **Change:** Removed all seeded demo data from `AssetManagementPanel` so the tab opens empty until wired to a backend. Emptied `RAW_ASSETS`, `STATS` values (now `0`), `CATEGORIES`, `STATUS_DIST`, `ACTIVITY`, `ATTENTION`, `HISTORY`, and `AUDIT`; removed the unused `activityMeta` helper.
- **Empty states:** Added an `emptyHint()` renderer with contextual messages on Dashboard (categories/activity/needs-attention), Assets table, and Audit log. Dynamic counts replace hardcoded text ("Needs attention" badge, "N types", assets subtitle). Scanner result sheet now shows an idle "Awaiting scan" state instead of a fake matched asset.
- **Guards:** `selectedTag` defaults to `null`; `detail` is null-safe and `specs` short-circuits to `[]` when no asset is selected, preventing crashes with empty data.
- **Files:** `src/AssetManagementPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management tab (Tracer Asset Manager UI)

- **Feature:** The dashboard `asset_management` tab now renders a full Asset Manager UI (`AssetManagementPanel`) replacing the "Coming soon" placeholder. Native React port of the `Tracer Asset Manager.html` prototype.
- **Screens:** Dashboard (stat cards, assets-by-category bars, status distribution, recent activity, needs-attention), Assets table (filter chips + rows), Asset detail (specs, assignment, history timeline, barcode), Add asset (form + live tag preview), Audit log table, Mobile scanner mockup, and a check-in/out slide-over modal.
- **Data:** Presentational/mock only — no backend wiring yet. Internal state machine drives screen/selectedTag/modal/charger/tagSuffix.
- **Styling:** Original inline CSS preserved via a `css()` string→object helper; hover/focus/keyframes provided through a scoped `<style>` under `.asset-mgmt-root`; IBM Plex Sans/Mono pulled from Google Fonts. Panel fills the tab via `height: calc(100vh - 132px)`.
- **Files:** `src/AssetManagementPanel.jsx` (new), `src/App.jsx` (import + tab render).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-22 — GRN inward full-page entry

- **Feature:** Dispatch > Inward GRN entry now opens as full-page view (`InwardGrnEntryPage`) instead of modal.
- **Database:** Added `inward_grn_entries.grn_entry_detail` jsonb column (migration `20260630120000_add_grn_entry_detail.sql`) for apparel bora lines and fabric receipt lines.
- **Files:** `src/inwardGrnFormUtils.js`, `src/InwardGrnEntryPage.jsx`, `src/DispatchTabPanel.jsx`, `src/inwardEntryUtils.js`, `src/styles.css`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.
