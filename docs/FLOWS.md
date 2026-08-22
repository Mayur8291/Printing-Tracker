# Flows

## Dashboard Stock API (Scott International)

External order backend ↔ Scott Dashboard inventory (M2M, not browser).

### Stock snapshot

1. **Trigger:** Scott backend needs available qty before checkout or allocation.
2. **Entry:** `GET /functions/v1/dashboard-stock-api/api/v1/stock/snapshot?skus=...&facility=...`
3. **Auth:** `Authorization: Bearer <DASHBOARD_API_KEY>`
4. **Logic:** Edge function loads `inventory_facility_stock` joined to `inventory_skus`; available = `on_hand_qty - reserved_qty`.
5. **Response:** `{ snapshot: { "SCOTT_1DAY_01:SKU-COTTON-WHT-M": 120 } }`
6. **Failure:** `401` bad key; `400` missing `skus`.

### Reserve → fulfill / release

1. **Reserve:** Customer places RMP order → `POST .../stock/reserve` with `order_code`, `facility_code`, `items[]`.
2. **Check:** Each line compared to available; `409 INSUFFICIENT_STOCK` if short.
3. **Success:** Row in `inventory_stock_reservations` + items; `reserved_qty` increased on `inventory_facility_stock`; webhook `stock.level_changed` enqueued.
4. **Cancel / edit:** `DELETE .../stock/reserve/:id?reason=CANCELLED` — idempotent if already released; reserved qty restored.
5. **Dispatch:** `POST .../stock/fulfill/:id` — deducts `on_hand_qty` and `reserved_qty`; writes `inventory_stock_movements`; syncs `inventory_skus.stock_qty`.
6. **Edge cases:** Unknown SKU → treated as zero available on reserve; expired reservations not auto-released yet (24h `expires_at` stored for future cron).

### Manual adjust

1. **Trigger:** Damage, return, count correction.
2. **Entry:** `POST .../stock/adjust` with `facility_code`, `reason`, `items[{ sku_code, delta }]`.
3. **Logic:** Updates `on_hand_qty`; rejects if result would leave `on_hand < reserved`.
4. **Webhooks:** `stock.level_changed`; if available &lt; `reorder_point`, also `stock.low_threshold`.

See [DASHBOARD_STOCK_API.md](./DASHBOARD_STOCK_API.md).

### Order lifecycle (Scott RMP orders)

1. **Create:** Scott backend → `POST .../api/v1/orders` (`order_code`, `facility_code`, `customer`, `shipping_address`, `payment`, `items[]`).
2. **Logic:** duplicate open `order_code` → `409 ORDER_EXISTS`; stock held via idempotent reservation (`reserveStockIdempotent` — reuses existing `RESERVED` row for same `order_code` + `facility_code` if partner already called `/stock/reserve`); duplicate SKU lines in one payload are merged; `409 INSUFFICIENT_STOCK` if short; row in `scott_orders` + items with `reservation_id`. Cancel / FAILED release **all** open holds for that order at the facility.
3. **Edit:** `PATCH .../orders/:id` — terminal status → `409 ORDER_NOT_EDITABLE`. Item replace checks feasibility crediting the order's own held stock, then releases the old reservation and creates a new one; items table replaced.
4. **Cancel:** `DELETE .../orders/:id?reason=...` — idempotent for already-cancelled; releases the reservation, sets `CANCELLED` + `cancel_reason`.
5. **Progress:** dashboard-internal `POST .../orders/:id/status` — `PROCESSING` (from PENDING), `COMPLETE` (fulfills reservation: on-hand deducted, movements written, `stock_qty` synced, `dispatched_at` + items' `dispatched_quantity` set), `FAILED` (releases reservation). **Dashboard UI:** Ready Stock Order detail → **Update status (syncs to app)** dropdown calls edge function `scott-order-update-status` (same transitions + cancel); webhooks fire via `scott_orders` trigger.
6. **Read:** `GET .../orders/:id` returns status + items with `dispatched_quantity`.
7. **Webhooks:** DB trigger on `scott_orders` INSERT/UPDATE enqueues `order.status_changed` — INSERT sends `status: CREATED` (`previous_status: null`); updates send `PENDING` / `PROCESSING` / `COMPLETE` / `CANCELLED` / `FAILED` with `previous_status` set. `dispatched_at` included when new status is COMPLETE. Delivered via `dashboard_webhook_outbox` (HMAC `X-Dashboard-Signature`). Stock changes additionally fire `stock.level_changed`.

See [DASHBOARD_ORDER_API.md](./DASHBOARD_ORDER_API.md).

### Admin Integrations (API keys / Channels / Facilities)

1. **Entry:** Admin Panel → "Integrations" tab (`AdminIntegrationsPanel`, admin-only).
2. **API keys:** generate → random `scott_*` key created in the browser, SHA-256 hashed, hash+prefix inserted into `dashboard_api_keys`, plaintext shown once with copy. Disable/enable/delete rows; the edge function checks the hash on every M2M request and bumps `last_used_at`.
3. **Channels:** add/enable/disable/delete rows in `dashboard_channels` (code, type, linked API key, default facility). Connector status badge derived from enabled + linked-key state.
4. **Facilities:** inline edit of `inventory_warehouses.facility_code` (sanitized uppercase; duplicate code error shown inline). Same field the Stock/Order API keys on.
5. **Failure:** RLS rejects non-admins; errors shown inline, page never blanks.

### Inventory → Warehouses — Edit + Layout

1. **Trigger:** Inventory → Warehouses → select a warehouse → **Edit** or **Layout**.
2. **Edit:** `EditWarehouseModal` → `editWarehouse` → `updateWarehouse` patches name/city/type/capacity/`facility_code`. Internal warehouse id is read-only.
3. **Facility rename:** DB trigger `inventory_warehouses_propagate_facility_code` updates facility stock, open reservations, open Scott orders, and channel defaults so Stock/Order APIs keep working with the new code (no API contract change). Availability map is reloaded after save.
4. **Layout:** `WarehouseLayoutModal` saves `{ zones: [{ name, rows, cols }] }` to `inventory_warehouses.layout`; bin map on the page renders from that layout (default A 8×10). Layout does not affect stock APIs.
5. **Failure:** duplicate facility code → inline error; page never blanks.

### Ready Stock Order tab (app orders in the dashboard)

1. **Trigger:** user opens sidebar → "Ready Stock Order" (`dashboardTab === "regular"` → `ReadyStockOrdersPanel`).
2. **Fetch:** `scott_orders` (newest first, limit 500) + `scott_order_items` for those ids + SKU display names from `inventory_skus` (authenticated read-only policies).
3. **Display:** shadcn table like the RMP order list — order code/id, placed time, facility, customer, status badge, payment (method / INR amount = Σ qty × unit_price / COD), item list (name, SKU, quantity, dispatched), due/dispatched date. Status filter tabs with counts + search.
4. **Realtime:** subscription on `scott_orders` + `scott_order_items` (publication via `20260720130000`) → silent refetch, so an order placed in the app appears without refresh.
5. **Order detail:** click order code → `ReadyStockOrderDetailDialog` (ORDER ITEMS tab; SHIPMENTS/INVOICES/RETURNS/ACTIVITIES placeholders disabled).
6. **Generate picklist:** button on detail header → `scott-order-generate-picklist` edge function (authenticated JWT). First run assigns `picklist_no` (`PK#####`), sets `picklist_generated_at`, moves `PENDING` → `PROCESSING`. Client maps response to `PicklistData` and `POST /api/picklist/pdf` (Puppeteer) → PDF opens in new tab + downloads `{picklistNo}.pdf`. Reprint when already PROCESSING returns same picklist without status change.
7. **Failure:** load error shows inline message; picklist pop-up blocked → alert; picklist API not running → start `npm run dev:all`; edge function not deployed → surfaced deploy hint; page never blanks.

### Ready Stock picklist generation

1. **Trigger:** user clicks **Generate Picklist** on order detail (Ready Stock Order tab).
2. **Auth:** browser POST `scott-order-generate-picklist` with Supabase session JWT.
3. **Order server:** service role loads order + items + SKU names/bin; if no picklist yet → unique `PK#####`, update order (`PROCESSING` if was `PENDING`); DB trigger enqueues `order.status_changed`; `deliverPendingWebhooks` drains outbox.
4. **PDF server:** client maps to `PicklistData` → `POST /api/picklist/pdf` on local picklist API (`server/index.js`, port 3001; Vite dev proxy `/api/picklist`).
5. **Render:** `buildPicklistHtml.js` + `picklist.css`; Code128 via `bwip-js` PNG data URI; Puppeteer A4 PDF with print CSS (`@page 12mm`, repeating thead, unbreakable rows).
6. **Preview (dev):** `/#/picklist-preview` (React + sample data) or `GET /api/picklist/preview` / `GET /api/picklist/pdf/sample`.
7. **Edge cases:** terminal orders cannot generate; empty items → 400; pop-up blocked → alert; picklist API down → error with start hint.

### Purchase Order tab

1. **Trigger:** user opens sidebar → **Purchase Order** (`dashboardTab === "purchase_order"` → `PurchaseOrderPanel`).
2. **Auth:** same dashboard session. Admin always sees the tab. Viewers need `purchase_order` in `allowed_dashboard_tabs` (or null = all tabs).
2b. **Sub-tabs:** Header row — **Purchase Order** on the left, shadcn Tabs on the right: **Create new PO** (default, full A4 sheet) and **PO History**. Inactive view unmounts. Create sheet title is **PURCHASE ORDER**. Under the sheet (own section): **Generate PO** and **Print**. Print uses `window.print()` and the same full A4 sheet (210mm × 297mm, `@page` margin 0) so the C table fills the paper. C13 stays the full words row (height like R2). Print-only **C23** sits in the C13 bottom-right. C23 is hidden on screen (`@media screen`).
2c. **Generate PO:** First checks mandatory fields: **Supplier (Bill form)**, **Description of Goods**, **Due on**, **Quantity**, **Quantity unit**, **Rate** on every goods line. If any empty → stop, show only **Mandatory details are Missing** (no field list), paint those cells red. After they are filled, reads the live sheet snapshot (voucher, R12 Dated, R3 bold supplier name, C42 qty, line fields). Updates that reserved `dashboard_purchase_orders` row: `generated_at`, `supplier_name`, `coordinator_name` (signed-in `profiles` display name), `po_date`, `quantity`, `status=pending`, `sheet_snapshot`. Then allocates the next voucher and switches to **PO History**. History lists only rows with `generated_at` set.
2d. **PO History table:** Columns **PO** (paper print + clickable **View PO**), **PO Number** (voucher value only), **Supplier** (bold R3 name), **Status** (backend: Pending / PO sent / PO Approved / Completed — color + icon; staff can change), **Coordinator**, **PO date** (Dated face), **Quantity** (C42). View PO dialog shows the saved A4 print (**PURCHASE ORDER** heading + table). Its **Print** button uses the same rules as Create new PO Print: `window.print()`, full 210mm × 297mm sheet, print-only **C23**. Dialog chrome is hidden. Realtime refresh on `dashboard_purchase_orders`.

3. **Display:** Fixed A4 shadcn **Card** (`210mm × 297mm`). Compact `11px` type. **R1 / R2 / R3** are the wide left cells (stretch right); they hug their text, stack flush (R2 under R1, `gap-0`), and do not scroll. After R3 supplier pick, the right 4×2 does not stretch — no empty band between tiles. **R1** Invoice To. **R2** Consignee. **R3** heading **Supplier (Bill form)** + dropdown of Inventory supplier names; after pick, stored supplier details (no extra labels). **R11** first line **Voucher No.** (normal) then bold `PO/{yy}-{yy+1}/{seq}` (example `PO/26-27/392`). **R12** first line **Dated** (normal) then bold create day `DD-Mmm-YY` (example `21-Aug-26`). **R22** first line **Mode/terms of Payment** (normal) then bold **30 days**. **R31** first line **Reference No. & date.** (normal) then the same bold voucher as R11. **R32** **Other References** (normal) plus type box (typed words bold, cell grows, no scroll). **R41** **Dispatched through** same. **R42** **Destination** same. **R21B** first line **Terms of Delivery** then a short shadcn Textarea. Sheet cells sit flush (`gap-0`). Below that, **C** table (C1–C8 / C11–C81 / C12–C82 / long **C13** under C12–C82). Top row: **Sl No.**, **Description of Goods**, **Due on**, **Quantity**, **Rate**, **per**, **Disc %**, **Amount**. Quantity line: readable number (no box) + unit on the right (normal text); Rate same open number as `450.00`; Amount = qty × rate (`1350.00`); per shows that unit as text. C12–C82 stay 8 tiles. **C82** is ` ₹ ` + the Amount-column total. New bottom row **C13**: **Amount Chargable (in words):** (reads C82; height matches R2; words blank until C82 has a number). Print-only **C23** sits in the C13 bottom-right (width C42–C82, height R22): top **for SCOTT INTERNATIONAL**, bottom **Authorised Signatory**. Hidden until Print. Never print the C-codes. Plus button on the card. Not Inventory POs.
4. **Cell ids:** stored in `purchaseOrderLayout.js` / `data-po-cell`. Fill later by id. Sketch labeled the large bottom-right **R21**; code uses **R21B** so it does not clash with small **R21**. Second table ids are **C1–C8**, **C11 C21 C31 C41 C51 C61 C71 C81**, **C12–C82**, then **C13** under that row (amount in words; C82 is the amount source), then print-only **C23** (signature). Never print those strings.
5. **Icon:** Lucide `FileSpreadsheet` in the shadcn sidebar; matching document SVG in `dashboardSidebarIcons.jsx`.
6. **Exit:** switch to another sidebar tab.
7. **R3 supplier:** `fetchInventorySuppliers()` reads `inventory_suppliers` (same columns as Inventory). Dropdown items are **name** only. On change, R3 prints name (bold) then address, contact, gstin, city/country, payment terms — values only.
8. **R11 voucher:** `allocatePurchaseOrderVoucher()` in `purchaseOrderVoucherUtils.js`. Indian FY 1 Apr–31 Mar in `Asia/Kolkata`. Code `PO/26-27/392` means FY 2026-27 serial 392. First open of the sheet in a browser session reserves a number. Plus reserves the next (`seq+1`) and clears R3, R21B, R32, R41, R42, extra C11–C81 lines, and Description of Goods text. FY 26-27 starts at 392 if empty; a new FY starts at 1 (`PO/27-28/1` from 1 Apr 2027). Insert `dashboard_purchase_orders`. Unique `(fy_code, seq)` with retry. If the table is missing, localStorage keeps the sequence until the staging migration is applied.
9. **R12 dated:** PO-create day, always **today** in `Asia/Kolkata` as `DD-Mmm-YY` (`formatPurchaseOrderDated(new Date())`). Not the voucher reserve `created_at`. Sheet left open past midnight IST flips to the new day (checked every minute). Generate copies that today into History `po_date`.
10. **R31 reference:** Same voucher string as R11 (not a new number). Heading **Reference No. & date.** Value bold.
11. **R22 payment:** Fixed copy **Mode/terms of Payment** / bold **30 days**.
12. **R21B delivery terms:** Cell opposite Consignee, narrower than R2/R3. Heading **Terms of Delivery**. Compact Textarea (`rows={4}`, min-height 4.5rem) so the A4 sheet stays short. Plus clears it.
13. **R32 / R41 / R42 type fields:** Heading normal. Type area under it. Typed text bold. Textarea grows with words (`overflow: hidden`, height = scrollHeight). No scrollbar. Plus clears them.
14. **C table:** Attached under the R sheet, flush (`gap-0`). 8 columns (col 2 wide). Rows: header / C11–C81 (and optional extra lines) / C12–C82 / long C13 / print-only C23. C1–C8 headings: Sl No., Description of Goods, Due on, Quantity, Rate, per, Disc %, Amount. C12–C82 stay eight tiles; **C22** is bold **Total**. **C13** under them: heading **Amount Chargable (in words):**, then bold Indian words from C82 (`purchaseOrderAmountInWords`). C13 height matches Consignee (R2). If the sheet is tight, C11–C81 shrinks. **C82** shows the sum of every goods-line Amount as ` ₹ 1000.00` (2 decimals). Words stay blank until that total exists. Never print the C-codes.
15. **C11–C81 sub-rows:** The Sl No. column (`C11`) prints **1.** on the first line, then **2.** **3.** for extra lines (`purchaseOrderSlNoText`), aligned to the top of the cell. Insert or delete in the middle renumbers in order. **C21** on every goods line is typeable (the whole cell, normal text, not bold). **C31** Due on: calendar icon only (no inner box). Selected date shows at the top as **14-Aug -26** on one line. Due on column is wider (`minmax(5.5rem,1.2fr)`) so that text does not wrap. Calendar allows today (IST) and future days only. **C41** Quantity: whole numbers only (no decimal). Readable 11px text with **no box** (outline/border off). No `___` line. Small unit Select sits on the right of that top row (PCS, Kg, Mtr, Nos, Roll, Set) as **normal** visible text. Unit is mandatory on Generate. Every extra line uses the same pair. **C51** Rate: same open number Input as Quantity. Numbers only, at most 2 decimals. Leave the field → face like **450.00**. Extra lines have their own rate. **C61** per: same unit as plain top text (no box, no quantity number). **C81** Amount: Quantity × Rate, 2 decimals (example 3 × 450.00 → **1350.00**). Normal top text, no box. Blank if qty or rate empty. Extra lines each compute their own. Disc % not used yet. **C42** (under Quantity, Total row): bold sum of Quantity numbers (whole numbers only). Empty if no qty. **C82** sums those Amounts as bold one-line ` ₹ 1350.00` (or more rows added together). C13 words follow C82. Card Plus and extra-row delete clear that line’s description, due date, qty, unit, and rate. Default one tall line. The goods band splits equally across current lines. Hover anywhere on the left outline → blue circle **+** follows the pointer. Click inserts a new 8-cell row after the line under the pointer (so you can add between rows). Near an extra-row join, **−** sits only at the left end of that join (not along the rest of the hover). New rows use the same cell border as the rest of the sheet. The first C11–C81 row cannot be deleted. Card Plus clears extra rows. Cap `PURCHASE_ORDER_C_MAX_EXTRA_LINES` (8). Extra cell ids like `C21:L2` live in `data-po-cell` only.
16. **Failure:** empty dropdown → no supplier rows or RLS. Add a vendor in Inventory → Suppliers. Select realtime refreshes when that table changes. Voucher stuck / duplicate → apply `20260821064834_dashboard_purchase_order_vouchers.sql` on staging. Generate fails / History empty → apply `20260822104145_dashboard_purchase_order_history.sql` on staging and `NOTIFY pgrst, 'reload schema'`. Generate with empty Supplier / Description / Due on / Quantity / Quantity unit / Rate → **Mandatory details are Missing** and red cells; no History row.

### Support dashboard (Enquiry data)

1. **Trigger:** user opens sidebar → **Support** (`dashboardTab === "enquiry"` → `EnquiryPanel`). Default sub-tab is **Complaints**.
2. **Sub-tabs:** **Enquiry** → **Complaints** → **Delay alert** → **Order status** → **Report**. Desks use `SupportTicketDesk`. Whole row tint follows priority. Delay form and production-status log are their own tabs (after Complaints, before Report). Report stays blank.
3. **Fetch:** `enquiries` (newest first, limit 500) — RLS returns all rows for admin; assignee sees assigned rows; creator sees rows they logged; Gargi sees SLA-escalated rows (`escalated_to_id`).
4. **Display (Enquiry):** `ticket_kind=enquiry` / Help with order → Customized → Enquiries. Codes `ENQ-#####`. Same columns as Complaints. Order ID optional.
5. **Display (Complaints):** Help with order → **Regular Order** (`order_type=regular`, `help_topic=regular`) and Help with order → **Customized → Concerns** (`product_issue`). Codes `CS-#####`. Columns: Code, Customer, **Order ID**, **Concerns**, Source, Status, Priority, Assignee, Created. No Track / Access / Delay / Enquiries tickets.
6. **Create:** **New enquiry** on Enquiry tab; **New complaint** on Complaints. Customer, phone, optional/required order ID, details. Ownership check when order ID present.
7. **Assign (admin only):** detail dialog → pick team member. Same for both desks. Non-admin cannot assign.
8. **Pick (assignee):** Mark verified / contacted / Close, notes, status. **Concerns** / enquiry details and **customer feedback** are read-only for admin and staff after receive. Each action writes `enquiry_activity_log`. Admin list refreshes live; admin detail **Activity** shows who did what.
9. **SLA:** unpicked = still `new`/`assigned` and no `picked_at`. 1 hour → ops-only waiting banner. 2 hours → escalate to Gargi, red banner, customer not told. Client pass on Support tab load writes `enquiry_sla_escalations` once.
10. **Realtime:** `enquiries` + `enquiry_sla_escalations` + `enquiry_activity_log` + `enquiry_outbound_messages` → silent refetch so admin sees staff work without refresh.
11. **Close survey:** First Close queues Concierge copy into `enquiry_outbound_messages` (Feedback button). If staging still has `ON CONFLICT (enquiry_id)`, the app Close path blanks phone for one save so the trigger skips, restores the phone, then inserts the survey row. WhatsApp simulator with the same phone shows that text. No Meta Cloud API send from this SPA.
12. **Production delay alert:** Support sub-tab **Delay alert** (after Complaints). Order number + phone + new date required. Lookup fills name/phone/old date from Ready Stock or tracker. Insert `support_delay_alerts` plus two outbound rows (apology text + Help / Access). Simulator with that phone shows the copy. Live Meta WhatsApp is not sent from this SPA.
13. **Production status texts:** Backend trigger `orders_queue_production_status_whatsapp` on `orders.status` change. Queues Concierge copy if a phone is found (enquiry Order ID match, contact book name, or Ready Stock customer JSON). Support sub-tab **Order status** lists recent sends/skips. No Track Order button in the simulator.
14. **Not copied from Concierge:** live WhatsApp Cloud API.
15. **Failure:** missing Concierge migration → inline message with `20260818082754_enquiry_concierge_desk.sql`; code prefixes missing → apply `20260819100000_enquiry_complaint_code_prefixes.sql`; Close fails with ON CONFLICT → apply `20260819062942_fix_close_survey_conflict.sql`; close survey missing → apply `20260818113000_enquiry_close_survey_message.sql`; delay send fails on missing table → apply `20260818180000_support_delay_alerts.sql`; production status texts missing → apply `20260819113000_production_status_whatsapp.sql` on staging then `NOTIFY pgrst, 'reload schema'`; RLS deny → error in panel; page never blanks.

### Support production delay alert

1. **Trigger:** Admin or staff opens **Support** → **Delay alert**.
2. **Lookup:** Blur Order number → `lookupOrderForEnquiry` (Ready Stock then tracker). Tracker `due_date` fills old date when present.
3. **Required:** order number, customer phone, new delivery date. Name and old date optional.
4. **Database:** insert `support_delay_alerts` (`sent_by = auth.uid()`). Insert two `enquiry_outbound_messages` with `enquiry_id` null: `kind=delay_alert` text, then next-step buttons.
5. **Customer view:** WhatsApp simulator open with the **same phone** shows the Concierge delay copy and Help / Access.
6. **Realtime:** `support_delay_alerts` refreshes Recent sent. `enquiry_outbound_messages` pushes into the simulator.
7. **Failure:** empty phone/new date → form error. Schema cache stale → apply delay migration + reload schema. Simulator closed or different phone → text is queued but not shown until that phone is used.

### Production status WhatsApp (automatic)

1. **Trigger:** Production (or any staff) changes `orders.status` on Printing Orders / Production tracker / job sheet.
2. **Backend:** AFTER UPDATE trigger `queue_production_status_customer_message` (security definer).
3. **Phone lookup:** latest enquiry with the same Order ID and a phone; else contact book name match; else Ready Stock `scott_orders.customer` phone.
4. **Send:** If phone found, insert `support_production_status_alerts` + two `enquiry_outbound_messages` rows (`production_status` text + Help / Access). If no phone, log the row with `skipped_reason` and do not queue WhatsApp.
5. **Customer view:** WhatsApp simulator with that phone shows the status copy. Support **Order status** tab lists queued vs skipped. Live Meta WhatsApp is not sent from this SPA.
6. **Failure:** Migration `20260819113000_production_status_whatsapp.sql` not on staging → no automatic text. Tracker orders have no phone of their own — link an enquiry or contact book first.

### Enquiry WhatsApp simulator (temporary)

1. **Trigger:** Support → Enquiry or Complaints → **WhatsApp simulator** (admin or tab editor).
2. **UI:** Right sheet, fake WhatsApp phone. Default customer John / `+919876543210`.
3. **Enquiry path:** Home → Help with order → Customized → Enquiries. Bot collects name, phone, optional Order ID (Skip allowed), then enquiry details. Saves `ticket_kind=enquiry` and replies with `ENQ-#####`. Row shows on the Enquiry tab. Admin assigns later from the desk (same role rules as Complaints).
4. **Complaint path:** Regular Order or Customized → Concerns still require Order ID (+ photos for product issues). Customer tap **Done** files the ticket (`CS-#####`) as New. Admin assigns later from Complaints. Chat never asks the customer to pick an account manager. **New member** — no welcome text, no home buttons.
5. **Test bypass (default on):** If order/phone does not match on complaint paths, still continue so the desk can be tested. Turn off to mimic live Concierge deny copy. There is no Track Order menu — production status texts arrive automatically.
6. **Exit:** Enquiry lands on Enquiry tab as New. Complaint lands on Complaints as New. Admin assigns from the desk.
7. **Close survey:** Keep the sheet open (same chat phone). When AM taps Close, bot sends “I hope your issue has been resolved…” + Feedback. Customer taps Feedback → stars → optional comment or Skip. That writes `feedback_rating` on the enquiry.
8. **Delay alert:** Keep the sheet open with the delay-alert phone. Support send queues apology text + next-step buttons into the same chat.
9. **Production status:** Keep the sheet open with the enquiry/contact phone. When production changes that order’s status, the bot shows the automatic update.
10. **Failure:** Photo type/size errors stay in chat. Close with empty phone → no survey text. Delay send with empty phone → form blocks send. Enquiry path with short details → bot asks for more. Status change with no phone → Support Order status tab shows skipped. Ticket save with no returning row used to show PostgREST “Cannot coerce…” — photos now upload before insert; chat shows a short retry line instead of the raw error.

### Enquiry Concierge ownership lookup

- **Trigger:** create form Order ID blur, or save.
- **Services:** `lookupOrderForEnquiry` → `scott_orders.order_code` / `id`, else `orders.order_id`.
- **Business logic:** staff see whether the order exists. `ownership_verified` true only when order has a phone and last-10 digits match enquiry phone.
- **Edge:** tracker `orders` often have no phone → not verified even if code matches. Empty Order ID → skip lookup.

### Inventory UI availability (Reserved / Available)

1. **Trigger:** Inventory tab mounts (`InventoryDataContext`).
2. **Fetch:** `inventory_sku_availability` view (paged 1000/req, authenticated read via `20260716120000`), aggregated per `sku_code` + per-facility breakdown → `availabilityBySku`.
3. **Display:** Inventory list shows **Reserved** (amber, tooltip "Held for open orders — not available to sell") and **Available** (= on_hand − reserved) next to On hand; low-stock status, stock bar, alerts, and overview KPIs compare against **available**.
4. **Realtime:** subscription on `inventory_facility_stock` (publication via `20260716130000`) refetches availability when the Stock API reserves/releases/fulfills.
5. **Failure:** query error → console warning, `availabilityBySku = null`, UI falls back to `stock_qty` (Reserved 0, Available = On hand); page never blanks.

### Inventory bulk Excel upload (stock + DOC, warehouse-scoped)

1. **Trigger:** Inventory → **Warehouses** → select warehouse → **Upload Bulk**.
2. **Template:** **Download template** → `inventory-stock-adjust-template.xlsx` (SKU Code required; Stock Qty, DOC, Storage Location, Reason optional). Stock Qty = on-hand **at that warehouse only**. DRR excluded — computed from Ready Stock order lines. Duplicate SKUs in one file are merged (last row wins per field).
3. **Upload:** user fills template → selects file → app loads **all** SKUs from DB → preview shows stock delta at the selected warehouse, DOC/storage changes, breakdown counts, and skipped rows; **Download skipped rows** exports full CSV with reasons.
4. **Apply:** `bulkImportStockAdjust` — stock rows batched via RPC `bulk_adjust_sku_facility_stock` (100 per transaction, wraps `adjust_sku_facility_stock`); DOC/bin via `updateSkuFields`; movements reference `BULK-EXCEL`. Confirm if zero stock rows but valid DOC/storage rows. Since `20260806110948`, apparel `extra.sizes` auto-syncs with `stock_qty` (SKU drawer **Stock by size** matches **On hand**); `warehouse_id` set when previously null.
5. **DRR (read-only):** `inventoryDrrUtils` sets DRR on inventory load = Σ order item qty (last 30 days, non-cancelled Scott orders) ÷ 30; updates live when orders change.
6. **Exit:** toast with stock adjusted / DOC updated / failed counts; inventory refreshes; movements appear on Movements tab.
7. **Failure:** missing SKU Code column → parse error; empty file → no rows; target below reserved qty → RPC error per row (batch continues); partial failures logged to console.

### Inventory list — warehouse locations

1. **Display:** **Warehouses** column shows name + on-hand per facility (tooltip when SKU spans multiple warehouses). Facility code shown when mapped.
2. **Filter:** Warehouse cycle filter shows SKUs with stock at that facility (or home `warehouse_id` fallback).
3. **Overview:** Warehouse dropdown filters **all** overview widgets (KPIs, fabric chart, movements, critical alerts, incoming POs). When one warehouse is selected, data is scoped to that facility; **All warehouses** shows combined data with warehouse name on each movement / PO row where applicable. Inventory Value still shows total-all-warehouses subline when filtered.

### Inventory SKU create (flat list)

1. **Trigger:** Inventory list → **New SKU** (or Overview shortcut).
2. **Form:** Single SKU code + name per row for fabric, trim, and apparel — no parent/sub grouping in UI. **Warehouse** + **Storage location** (`bin_location`, e.g. `A-12-03`) on same row.
3. **Save:** `insertSku` writes `inventory_skus` with `parent_style_id = null` and optional `bin_location`; opening stock logs movement type **IN**.
4. **List:** Apparel, fabrics, and trims render as flat paginated tables (search/sort/filter unchanged).
5. **API:** Scott Stock/Order APIs use `sku_code` only — parent removal is dashboard-only; legacy `inventory_style_parents` rows remain in DB.

### Inventory apparel SKU import (Excel)

1. **Trigger:** Inventory → Apparel list → **Import SKUs**.
2. **Template:** **Download template** → `inventory-apparel-sku-import-template.xlsx` (SKU, Size, Class Name, Color, Brand, Category). Delete example rows before upload.
3. **Upload:** user selects filled `.xlsx` → preview shows new vs duplicate SKUs (duplicates skipped if `sku_code` already exists).
4. **Apply:** `importSkus('apparel', records)` inserts new rows via `insertSku` batch; supplier left blank for later edit.
5. **Exit:** toast with import count; list refreshes.
6. **Failure:** missing required column → parse error; empty file → no rows; duplicate SKU in file → second row ignored.

### Inventory SKU pricing import (Excel, separate from Import SKUs)

1. **Trigger:** Inventory → Apparel / Fabrics / Trims list → **Import metrics and pricings**.
2. **Template:** **Download template** → `inventory-sku-pricing-import-template.xlsx` (SKU Code required; Unit Cost, Sale Price, Reorder Point, DOC optional). Fill only columns to update — blank columns leave existing values unchanged. DRR excluded (auto from orders).
3. **Upload:** user selects filled `.xlsx` → app loads all SKUs → preview shows per-field update counts, sample rows, and skipped rows (unknown SKU, no change, negative values).
4. **Apply:** `bulkImportSkuMetrics` batches via RPC `bulk_update_sku_metrics` (100 per transaction); only present JSON keys are patched on `inventory_skus`.
5. **Exit:** toast with updated / failed counts; list refreshes with new cost, sale price, reorder, DOC.
6. **Failure:** missing SKU Code column → parse error; row with no metric columns → ignored; SKU not in DB → skipped with CSV reason.

### Print calculator (DTF cost)

1. **Trigger:** Printing orders tab → **Print calculator** button (next to All orders / Complete orders / Print Queue).
2. **Usage:** Upload artwork images → set width/height in inches (auto-filled at 150 DPI from pixels) → per-artwork and total cost in ₹.
3. **Formula:** `(Height + 1) × (Width + 1) × rate_per_sq_in` — rate stored in `print_calculator_settings`.
4. **Background removal:** per artwork **Remove background** (lazy-loads `@imgly/background-removal` + ONNX model ~40MB on first use); crops to opaque PNG pixels; **W/H inches auto-set from result at 150 DPI**; **Download PNG** after removal.
5. **Admin:** Save new **rate per square inch** (admin RLS only); all users see updated rate on next open.
6. **Failure:** invalid rate ≤ 0 blocked on save; missing settings row defaults to rate `1`; background removal errors show alert (network/model download).

## Home tab

### Admin home

1. **Trigger:** Admin opens **Home**.
2. **Display:** **Order counts by status** grid (pipeline overview), **Goals & Tasks** widget, printing coordinator report, other admin widgets.
3. **Refresh:** Status counts update live via `orders-live` Realtime; manual refresh button still available.

### Normal user home

1. **Trigger:** Viewer opens **Home**.
2. **Display:** **Goals & Tasks** widget only (no order status count grid, no admin reports).
3. **Live sync:** Goals widget refetches on `user_annual_goals` / `user_goal_tasks` changes.
4. **Exit:** Links to **Goals & Tasks** tab for full panel.

## Dashboard live sync (all tabs)

1. **Trigger:** Any user INSERT/UPDATE/DELETE on a published table while another user has the app open.
2. **Database:** Row change replicated through Supabase Realtime (`postgres_changes`).
3. **Client:** Matching panel channel fires → debounced silent refetch (no full-page reload).
4. **Coverage:** Orders, printing queue, billing, dispatch inward/outward, inventory, goals, contact book, shared links, dealer report, printing dept inventory/utilization, masters, team directory, admin user permissions.
5. **Failure:** If Realtime disconnected, orders still poll every 120s; reopen tab or use panel Refresh where shown.

## Sidebar tab activity markers

1. **Trigger:** Realtime `postgres_changes` on a table mapped to a sidebar tab (e.g. `orders` → **Printing Orders** only, not Home).
2. **Routing:** `orders` use `order_kind` — printing/sticker/sampling → Printing Orders; `job_sheet` → Production tracker; `regular_stock` → Ready Stock Order. Goals tables → Goals & Tasks only.
3. **UI:** Small primary dot on the tab label (right side), same area as Chat unread count.
4. **Clear:** User opens that tab → dot removed.
5. **Skip:** No dot on the tab you are currently viewing (you already see live data there).
6. **Chat:** Still uses numeric badge for unread messages, not the activity dot.

## Notifications

Unified bell + **Notifications** sidebar tab. `fetchUserNotifications()` merges five sources, sorted by `created_at`.

| Kind | Trigger | Recipient | Open action |
|------|---------|-----------|-------------|
| `assignment` | Order saved with coordinator name | Matched profile | Open order |
| `order_status` | `orders.status` updated | Coordinator + `created_by` (not actor) | Open order |
| `goal_task` | `createGoalTask()` | Assignee (not self) | Goals & Tasks tab |
| `inward` | User tagged on inward entry | Tagged user | Inward entry |
| `printing_inventory` | Stock below threshold | Subscribed users | Printing inventory |

**Realtime:** `subscribeUserNotifications()` + dedicated toast channels in `App.jsx` for each table.

## Printing order create — product SKU → colors

1. **Trigger:** User opens Create order and picks a product from inventory (`PrintingOrderProductField`).
2. **Selection:** Picker stores inventory SKU by `_uuid` (not product name alone — many SKUs share one name).
3. **Color sync:** `colorsFromInventoryProduct()` resolves hex in order: SKU `color` field → SKU code segment (e.g. `BL` → black) → combined label → non-placeholder `hex_color`.
4. **UI:** `orderForm.colors` updates automatically; Colors trigger shows swatch via `swatchBackgroundForColor()`.
5. **Edge cases:** Custom product name clears inventory link; user can still edit colors manually in Mac-style picker without overwrite until another SKU is picked.

### Profile settings (sidebar footer)

1. **Trigger:** User clicks **name/avatar** in sidebar footer → **Profile settings** dialog (`UserProfileSettingsDialog`).
2. **Profile photo:** Grid of 50 preset characters or **Upload photo** → **Save photo** → `profiles.avatar_path` (`preset:avatar-XX` or storage path).
3. **Notification tone:** MP3 upload (max 2 MB) → `profiles.notification_tone_path`; **Preview** / **Use default** below avatar section in same dialog.
4. **Admin create/edit user:** Avatar picker also on **Create user** and **Edit user access** modals.
5. **Notifications tab:** Alert list only — no profile/tone cards.

### Custom notification tone (MP3)

1. **Trigger:** Sidebar **Profile settings** dialog → **Notification tone** section (not Notifications tab).
2. **Upload:** MP3 up to 2 MB → `uploadProfileNotificationTone()` → `notification-tones` bucket → `profiles.notification_tone_path`.
3. **Playback:** `notificationTonePlayer.js` uses custom public URL for all alert sounds when set; otherwise built-in `sounds/tone-01.mp3` (and Tone-02/03 for order status variants).
4. **Preview / reset:** **Preview** plays current tone; **Use default** clears path and deletes storage file.
5. **Requirement:** `status_tones_enabled` must be true (admin user-mgmt toggle) or no sound plays.

### Task assigned notification

1. **Trigger:** Any user clicks **Assign task** and picks another user.
2. **Services:** `createGoalTask()` → insert `user_goal_tasks` → `insertGoalTaskNotification()`.
3. **Display:** Bell badge, toast, Notifications list — title + goal + deadline.
4. **Exit:** Click notification → **Goals & Tasks** tab.

### Order status notification

1. **Trigger:** Order status changed (list inline edit, View order, or API update).
2. **Database:** Trigger `notify_order_status_change()` inserts rows for coordinator (name match) and order creator.
3. **Realtime:** `orders` table on `supabase_realtime` — all clients refetch on `postgres_changes` (channel `orders-live`).
4. **Display:** Toast shows `previous → new` with human-readable labels via `formatOrderStatusCode()`.
5. **Exit:** Click notification → open that order.

### View order — mockups & designs

1. **Trigger:** User opens **View order** → **Designs** / **Mockups** section.
2. **Hydration:** `openViewOrder()` always fetches `ORDERS_FULL_SELECT` (includes `approved_design_url`, approved images, payment proof).
3. **Live refresh:** List refetch uses lightweight columns; `mergeOrderDetailAssets()` keeps mockup URLs on the open order so thumbnails do not vanish during realtime sync or after approved-image upload patches.
4. **Preview:** Click thumbnail → `openPreview()` → `ImagePreviewModal` portaled to `document.body` (`z-index: 2000`).
5. **Exit preview:** Toolbar **Close** button.

### View order — customer assets

1. **Trigger:** View order panel open for a job with rows in `order_customer_assets`.
2. **Services:** `fetchOrderCustomerAssetsWithUrls()` — DB rows + `createSignedUrl` for view/download (authenticated storage).
3. **Realtime:** While panel open, subscribe to `order_customer_assets` filtered by `order_id` → reload list on insert/delete.
4. **UI:** **View** (images inline preview; PDF in new tab); **Download** (signed URL with filename).
5. **Retention:** Files auto-purged after 48 hours (`purge_expired_order_customer_assets` cron).
6. **Failure:** Expired/missing object → buttons show **Unavailable**; check storage path and cron.

## Team chat

WhatsApp-style inbox: sidebar conversation list + thread view. Data layer: `src/teamChatService.js`. UI: `TeamChatPanel.jsx` + `src/components/chat/*`.

### Open chat / General group

1. **Trigger:** User opens **Chat** tab.
2. **Services:** `fetchMyConversations()` — memberships + last message preview.
3. **Default:** **General** group (legacy team wall messages migrated here).
4. **Exit:** Select conversation → load messages via `fetchConversationMessages()`.

### Direct message (any user → any user)

1. **Trigger:** **New chat** → pick team member (compose screen opens — no DB conversation yet).
2. **First send:** RPC `get_or_create_direct_conversation(other_user_id)` then insert message — only then both users see the chat in inbox.
3. **Empty DMs:** Direct conversations with zero messages are hidden from both inboxes (no ghost chats).
4. **Send:** `sendChatMessage()` with `conversation_id`; marks read for sender.
5. **RLS:** Only conversation members see messages (`jwt_user_in_conversation`).

### Create group

1. **Trigger:** **New group** → name + member checkboxes.
2. **Services:** RPC `create_group_conversation(title, member_ids[])` — creator is admin member.
3. **Exit:** Group appears in inbox; all members can read/write.

### Send GIF / attachment

1. **GIF:** **GIF** button → **Quick GIFs** presets, or **Search** tab (Giphy search + trending via `VITE_GIPHY_API_KEY`). **Enter** sends message; **Shift+Enter** new line.
2. **File:** Paperclip → JPEG/PNG/WebP/GIF/PDF up to 15 MB → `team-chat-files` bucket.
3. **Constraint:** Message needs body, attachment, or GIF (empty text-only blocked).

### Realtime

`TeamChatPanel` subscribes to `team_chat_messages` and `team_chat_conversations` postgres changes; refreshes inbox + active thread.

**Unread:** Opening a thread calls `mark_conversation_read` — badge clears immediately. Unread rows highlighted (primary border + bold). Sidebar **Chat** tab shows total unread count.

**Sound:** New message for current user plays the same notification tone as tasks/orders (custom MP3 if set). No tone when user already has that conversation open on the Chat tab.

### Admin views all user goals and tasks

1. **Trigger:** Admin → **Admin Panel** → **Roles & goals** tab (or Goals & Tasks → **All team tasks**).
2. **Cards:** Each user shows name, job role, goal count, progress %, open tasks.
3. **Detail:** Click card → goals with progress bars, tasks assigned to them, tasks they assigned to others, remarks.
4. **Database:** Admin RLS on `user_annual_goals` / `user_goal_tasks` via `jwt_user_is_admin()`.

### User creates own goal

1. **Trigger:** Goals & Tasks → **My goals** → **Create my goal**.
2. **Form:** **Ownership** (required) → title → optional description.
3. **Services:** `createAnnualGoal()` with `ownership`, `user_id = created_by = auth.uid()` (owner insert RLS).
4. **Display:** Goals group under ownership headings (**Ownership → Goal → Tasks**). Legacy goals with null `ownership` show under **Uncategorized** until owner clicks **Set ownership**.
5. **Exit:** Goal appears in My goals; user can **Add task** on their goal.

## Goal tracker

### Admin sets annual goal

1. **Trigger:** Admin opens sidebar **Goals & Tasks** → **Manage User Goals** tab.
2. **Entry:** Select user + year → **Create goal for user** (ownership + title required). Tab lists **all** goals for that user (active and completed) grouped by ownership, with tasks on each goal.
3. **Services:** `createAnnualGoal()` → `user_annual_goals` insert (admin RLS).
4. **Tasks:** Admin adds tasks on goal with deadline via **Add task** → `user_goal_tasks`.
5. **Exit:** Goal visible on user homepage widget and **My goals** tab.

### User updates goal/task status

1. **Trigger:** Goal owner or task assignee clicks **Update status**.
2. **Input:** New status + remark (required for non-admin).
3. **Services:** `updateGoalStatusWithRemark()` / `updateTaskStatusWithRemark()` — updates row + inserts `user_goal_status_remarks`.
4. **Failure:** Empty remark for viewer → client error before save.

### User marks task or goal complete (checkbox)

1. **Trigger:** Assignee checks task checkbox, or goal owner checks goal checkbox on **My tasks** / **My goals** / goal card.
2. **Services:** `setTaskCompleted()` / `setGoalCompleted()` — status → `completed`, `completed_at` set, verification cleared.
3. **Exit (tasks):** Task **stays on goal card** and task list tabs with **Pending verification** badge. Does **not** move to **Completed** tab.
4. **Exit (goals):** Goal leaves **My goals** active list; appears under **Completed** tab with **Pending verification** until owner confirms.

### Assignee confirms task or goal completion

1. **Trigger:** Assignee marks task complete, or goal owner marks goal complete.
2. **Services:** `setTaskCompleted()` / `setGoalCompleted()` — status `completed`, verification cleared; notifier ping **assigner** (task) or **goal owner** (goal).
3. **Verify:** **Assigner** (who assigned the task) or **goal owner** (for goals) clicks **Verify complete** or **Not complete** on the goal card / task row / **Assigned by me** tab.
4. **Not complete:** Assigner/owner required remark → `user_goal_status_remarks` + task/goal status back to `in_progress`. Remark shows **below the task** on goal card until verified.
5. **Exit:** Verified tasks show strikethrough + **Verified** badge on goal card. Verified goals show **Verified** on **Completed** tab.

### Admin verifies completion

**Removed** — replaced by assignee/owner confirmation above.

### Admin deletes goal or task

1. **Trigger:** Admin clicks **Delete** on a goal card, task row, or in **Admin panel → Roles & goals** user detail.
2. **Confirm:** Dialog warns goal delete removes linked tasks too.
3. **Services:** `deleteAnnualGoal()` / `deleteGoalTask()` — RLS `jwt_user_is_admin()` only.
4. **Exit:** List refreshes; removed for assignee and on home widget.

### Any user assigns task

1. **Trigger:** **Assign task** button (sidebar panel or from goal card).
2. **Input:** Title, assignee, **priority** (P0–P2), optional goal link, deadline.
3. **Services:** `fetchGoalsForTaskAssignment(assigneeId, year)` via RPC `get_goals_for_task_assignment` (bypasses goal SELECT RLS for assign-task linking only). `createGoalTask()` — `assigned_by = auth.uid()`; may link to assignee-owned goal; stores `priority`.
4. **Exit:** Task appears in assignee **My tasks** (sorted P0 first, filterable by priority) and assigner **Assigned by me** with colored priority badge.

### Homepage widget

1. **Trigger:** User opens **Home** tab.
2. **Services:** `fetchGoalsForUser()` + `fetchMyAssignedTasks()` for current year.
3. **Display:** Counts (goals, open tasks, overdue) + upcoming deadlines; link to full panel.

## Password reset (admin-approved)

### User requests reset (login screen)

1. **Trigger:** User clicks **Forgot password?** on login.
2. **Input:** Email → **Request password reset** (or **Check status** if already submitted).
3. **Services:** Edge `request-password-reset` → row in `password_reset_requests` (`pending`). Admin users route to `main_admin` (only `admin@scott.com` may approve).
4. **Exit:** Message that admin will review; status **pending**.

### Admin approves or rejects

1. **Trigger:** Admin opens **Admin panel → Password resets**.
2. **Services:** Edge `admin-review-password-reset` with `approve` or `reject`. Approve sets `approved_expires_at` (+7 days).
3. **Failure:** Non–main-admin cannot approve `main_admin` routing requests.
4. **Exit:** User may set password on login when status is **approved**.

### User sets new password (login screen only)

1. **Trigger:** User returns to login → **Forgot password?** → enter email → **Check status** (or auto-check on blur).
2. **When approved:** New password + confirm fields appear.
3. **Services:** Edge `complete-password-reset` → `auth.admin.updateUserById` + request `completed`.
4. **Exit:** User signs in with new password on same login screen.
