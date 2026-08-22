# Decisions

Older product history lives in [CHANGELOG.md](./CHANGELOG.md). New significant choices are recorded here.

## 2026-08-22 — Open POs vs History; Generate is PO sent

**Context:** User wants Generate to land as **PO sent**. Completed comes from the backend and then appears only in **PO History**. Opening the panel should list Pending / PO Approved / PO sent. Create new PO should open the sheet only after that click.

**Options:** (1) One History list with all statuses. (2) Split Open POs (in progress) and History (Completed); Generate writes `po_sent`; Create sheet mounts on the Create tab.

**Decision:** Option 2. Tabs: **All PO Orders** (default), **Create new PO**, **PO History**. Status is display-only. Tab names sit apart (gap, not one pill).

**Why:** Staff see live POs first. Completed archive stays clean. Sheet does not allocate a voucher until Create is opened.

**Tradeoffs:** A PO disappears from All PO Orders when the backend marks Completed.

## 2026-08-22 — Purchase Order opens on History; History status is Completed

**Context:** User wants the panel to open on full PO History. History should display only **Completed**. Create new PO should show the heading and table.

**Options:** (1) Keep Create as default and four status picks. (2) Default History; Status column is Completed only; Create still mounts the A4 heading + table.

**Decision:** Option 2. Backend may still store other status keys. History UI does not show or edit them.

**Why:** Staff see History details immediately. Create stays a sheet they open on purpose.

**Tradeoffs:** Pending / PO sent / PO Approved no longer appear in History.

## 2026-08-22 — PO History filters are exact and date-only Clear

**Context:** User wanted a History filter bar like the mock: From/To, Clear, Search, Coordinator, View N / page.

**Options:** (1) Substring search like orders. (2) Exact match on seq after last `/`, full voucher, supplier, or coordinator. Clear all filters vs dates only.

**Decision:** Option 2. Dates filter `po_date` inclusive. **Clear** only empties From/To. Coordinator list comes from generated History names. View N / page uses shared `usePagination` (default 10).

**Why:** Staff type `392` not the full `PO/26-27/392`. Exact match avoids accidental partial hits.

**Tradeoffs:** Typing `39` shows nothing until the full seq or name is entered.

## 2026-08-22 — View PO Print uses Create Print rules

**Context:** User wants History → View PO → Print to print the same sheet they see, plus C23, same as Create new PO Print.

**Options:** (1) Separate View print layout. (2) Same print CSS as Create; flatten the dialog so the A4 root is not trapped.

**Decision:** Option 2. One print path: heading + table + C23. Dialog overlay/close/Print button stay `data-po-no-print`.

**Why:** One paper look for both tabs.

**Tradeoffs:** Print CSS must reset Dialog `transform` / `overflow`.

## 2026-08-22 — C23 signature is print-only

**Context:** User wants a signature box only when they click Print. Width like C42–C82. Height like R22. Bottom-right of C13.

**Options:** (1) Always show on the sheet. (2) Print-only via `data-po-print-only` (Create Print and View PO Print).

**Decision:** Option 2. Top-right **for SCOTT INTERNATIONAL** (small). Bottom-right **Authorised Signatory** (smaller). Never show the C23 id. Hide only in `@media screen`. Print fills the A4 card again. C23 overlays C13 bottom-right so C13 stays a complete row.

**Why:** Screen stay clean. Paper gets a sign block and the full table.

**Tradeoffs:** Preview on screen has no signature. Print preview / Print is the check.

## 2026-08-22 — View PO is the A4 print, not a summary

**Context:** User wants View PO to show the print of the Purchase Order heading and table.

**Options:** (1) Keep a field list. (2) Replay the saved A4 sheet (heading + R/C table) from `sheet_snapshot`.

**Decision:** Option 2. `PurchaseOrderPrintSheet` is read-only. Dialog chrome is not part of the print.

**Why:** History should look like the paper they generated.

**Tradeoffs:** Address lines under Supplier reload from `inventory_suppliers` by saved id; name still comes from the snapshot if the vendor is gone.

## 2026-08-22 — R12 Dated is today, not voucher reserve day

**Context:** User wants Dated to be the PO-create day and to change every day. A reserved voucher from yesterday was freezing R12 on that old `created_at`.

**Options:** (1) Keep freeze on voucher `created_at`. (2) Live today in IST, flip when the calendar day changes. (3) Date picker.

**Decision:** Option 2. Create sheet always shows today. Generate stores that face as `po_date`. History stays frozen.

**Why:** PO creation day is when they make the PO, not when the number was reserved.

**Tradeoffs:** A sheet left open overnight updates Dated; staff cannot back-date from R12.

## 2026-08-22 — Generate PO requires supplier and goods line fields

**Context:** User did not want empty POs in History. Mandatory: Supplier (Bill form), Description of Goods, Due on, Quantity, Quantity unit, Rate.

**Options:** (1) Soft warn and still save. (2) Block Generate, exact copy **Mandatory details are Missing**, paint empty cells red.

**Decision:** Option 2. Every current goods line must be complete, including Quantity unit. Extra empty lines also fail until filled or removed. Save path throws the same message. UI shows that one sentence only — no field list under it.

**Why:** History should only hold usable POs.

**Tradeoffs:** Adding a blank extra line blocks Generate until that line is filled or deleted.

## 2026-08-22 — Generate PO writes History; reserved vouchers stay hidden

**Context:** User wanted PO History after **Generate PO**, with PO print + View PO, voucher only, bold supplier name, backend status, coordinator, Dated, and C42 qty.

**Options:** (1) Insert a second history table. (2) Reuse `dashboard_purchase_orders` and stamp `generated_at` on the reserved voucher. (3) Treat every reserved voucher as history.

**Decision:** Option 2. Sheet open / Plus still reserves a number. History `WHERE generated_at IS NOT NULL`. Status values: `pending`, `po_sent`, `po_approved`, `completed`. Coordinator is the signed-in profile name at generate time.

**Why:** One row per voucher. Unused reserved numbers do not clutter History.

**Tradeoffs:** Generate is an UPDATE (needs authenticated UPDATE RLS). Local-only fallback vouchers insert on generate if the reserved row is missing.

## 2026-08-22 — Create PO print block vs action buttons

**Context:** User wanted **PURCHASE ORDER** on the sheet for future print, and **Generate PO** / **Print** under the table in a different section.

**Decision:** Title lives inside the A4 card (`data-po-print-root`). Action buttons sit below the card (`data-po-no-print`). Print = `window.print()` + CSS that keeps only the print root.

**Why:** Print must not include dashboard chrome or the action row. Generate now saves History.

**Tradeoffs:** Title uses a little of the A4 height.

## 2026-08-22 — Purchase Order has Create and History tabs

**Context:** User wanted **Create new PO** and **PO History** opposite the Purchase Order heading. Create must show the full sheet.

**Decision:** House Tabs idiom (triggers only). Heading left, `TabsList` right. Create mounts `PurchaseOrderLayoutGrid`. History mounts `PurchaseOrderHistoryTable` after Generate PO.

**Why:** Same pattern as other dashboard sub-tabs. Keeps the sheet off-screen when History is open.

**Tradeoffs:** History is empty for now. The in-progress sheet unmounts when you leave Create (Plus voucher state is still in session).

## 2026-08-22 — C13 heading and height follow R2

**Context:** User wanted C13 to read **Amount Chargable (in words):** and be as tall as Consignee (R2). Shrink C11–C81 if the A4 sheet is tight.

**Decision:** Change the heading string. Measure R2 with ResizeObserver and set C13 to that height. Goods band min row 1.25rem.

**Why:** Words block should look like the Consignee tile, not a one-line leftover.

**Tradeoffs:** Extra goods lines share a shorter leftover band.

## 2026-08-22 — C42 is bold qty total; C82 is bold one line

**Context:** User wanted C42 to add Quantity numbers in bold, and C82 to stay on one line in bold.

**Decision:** C42 = `sumPurchaseOrderQuantities` (whole numbers). C82 keeps ` ₹ 1000.00` with nowrap, bold, and non-breaking spaces.

**Why:** Total row should match Tally: qty count under Quantity, money under Amount.

**Tradeoffs:** Amount column is a bit wider so the rupee total fits.

## 2026-08-22 — C82 is the rupee total of Amount

**Context:** User wanted C82 to add every goods-line Amount and show ` ₹ 1000.00`.

**Decision:** C82 is display-only. Sum line amounts (2 decimals). Face ` ₹ ` + `toFixed(2)`. C13 words use the same numeric total.

**Why:** Tally total sits under Amount. Words must match the printed total.

**Tradeoffs:** Disc % still not in the sum.

## 2026-08-22 — Amount is Quantity × Rate

**Context:** User wanted Amount to auto-fill from Quantity × Rate, 2 decimals, on every goods line.

**Decision:** C81 is display-only. `formatPurchaseOrderLineAmount`. Disc % is not applied yet.

**Why:** Same Tally goods math. No typed Amount so the product cannot drift.

**Tradeoffs:** C82 / words row still wait for a later total.

## 2026-08-22 — Rate is the same open number as Quantity, 2 decimals

**Context:** User wanted Rate to match Quantity’s no-box number input, face like `450.00`, digits only, max 2 decimals, on every goods line.

**Decision:** Session `lineRates`. Type with `sanitizePurchaseOrderRate`. Blur with `formatPurchaseOrderRate` (`toFixed(2)`). Same Input chrome as Quantity.

**Why:** Tally rate column is money, not a free text box.

**Tradeoffs:** Format applies on blur so typing `450` is not forced to `450.00` mid-keystroke.

## 2026-08-22 — Quantity is number + unit; per is unit text only

**Context:** User wanted Quantity to look like a fill-in blank (`---`) plus a boxed unit dropdown. Number and unit must be the same size. per should auto-show that unit, not the typed number, and not sit in a box.

**Decision:** Session state per goods line (`lineQtys`, `lineUnits`). C41 = numeric Input (no box, no `___` line) + small `font-normal` shadcn Select (PCS, Kg, Mtr, Nos, Roll, Set), same 11px face. Extra rows reuse the same control. C61 = plain text of the selected unit at the top of the cell.

**Why:** Matches Tally-style qty / per. Number stays in Quantity. per is the unit of measure.

**Tradeoffs:** Quantity column is wider so the blank and the box fit. Units are not saved to the database yet.

## 2026-08-22 — C11–C81 extra lines via hover + / −

**Context:** User wants sub-rows only on demand, with a Word-style blue circle + / − on the left outline.

**Decision:** Keep one C11–C81 row. Hover left rail shows **+** (insert after) and **−** on extra rows (delete). Session state; card Plus resets. Cap 8 extra lines.

**Why:** Matches the sketch. First row always stays so the sheet never has zero goods lines.

**Tradeoffs:** Extra cell ids are `C21:L2` in `data-po-cell` only. Middle height is shared across line rows.

## 2026-08-22 — C13 is a new words row under C12–C82

**Context:** User wanted a long amount-in-words cell *under* C12–C82, not instead of that row. Code name C13; do not show that name.

**Decision:** Keep C12–C82 as eight tiles. Add C13 spanning all 8 columns under them. Words from C82.

**Why:** First pass ate the C12–C82 row. User said keep it.

**Tradeoffs:** C table is 4 rows. Middle row still takes leftover height.

## 2026-08-22 — R32 R41 R42 grow-to-fit type cells; flush sheet

**Context:** User wanted Other References / Dispatched through / Destination typeable, typed text bold, no scroll, no gaps anywhere on the sheet.

**Options:** (1) Fixed textarea + scroll. (2) Auto-grow textarea + `gap-0` / `rounded-none`.

**Decision:** Option 2. Session-only state; Plus clears.

**Why:** Same “adjust the cell to the words” rule as R1–R3. Gaps were the holes they already rejected.

**Tradeoffs:** Adjacent 1px borders meet (looks like a thicker line). Long text in R32/R41/R42 grows the right 4×2.

## 2026-08-22 — C1–C8 are goods column titles

**Context:** User named the top C row like a Tally goods table.

**Decision:** Store titles in `PURCHASE_ORDER_C_HEADINGS`. Render that text only. Cell ids stay in `data-po-cell`.

**Why:** Same fill-by-id pattern as R11/R12. Sketch codes stay hidden.

**Tradeoffs:** Narrow columns wrap long titles (Description of Goods sits in wide C2).

## 2026-08-22 — R3 growth must not stretch voucher rows

**Context:** After supplier pick, R3 grew and holes opened between cells.

**Options:** (1) Keep one 5-row grid and let rows share R3 height. (2) Split left stack vs right 4×2 so they do not share row tracks.

**Decision:** Option 2. R21B fills leftover beside R2/R3.

**Why:** User said no empty space between cells. Shared rows were the hole.

**Tradeoffs:** R1 is no longer a CSS row-span over the 4×2; visual alignment is by column width only.

## 2026-08-22 — R1 R2 R3 one left stack

**Context:** After R1 hugged its text, a hole opened between Invoice To and Consignee.

**Options:** (1) Stretch R1 down to fill the 4-row hole. (2) Stack R1, R2, R3 in one left column so R2 sits in that leftover space.

**Decision:** Option 2. Same `gap-1` as other tiles. Right 4x2 and R21B stay.

**Why:** User asked to close the space between R1 and R2 by moving those cells, not by growing Invoice To.

**Tradeoffs:** R21B sits in the fifth grid row beside the lower left stack, not in a separate band.

## 2026-08-22 — R1 R2 R3 stretch right; A4 sheet stays short

**Context:** User wanted R1/R2/R3 longer to the right, and the whole PO as short as possible, still A4.

**Options:** (1) Keep 50/50 columns and tall Terms box. (2) Widen the left cells (~3.2fr), shrink type/padding/Terms/C-rows, lock card to `210mm × 297mm`.

**Decision:** Option 2. Outer map stays (R tiles + C table). Left address cells are the long ones.

**Why:** Same format, more room for invoice/consignee/supplier, one A4 page.

**Tradeoffs:** Right voucher tiles and Terms box are narrower/shorter.

## 2026-08-22 — Purchase Order second table is C-grid on an A4 card

**Context:** User attached a C1–C82 sketch under the existing R sheet. No labels on screen. Whole table A4 size.

**Options:** (1) Same compact `max-w-3xl` card. (2) A4 page (`210mm × 297mm`) with the C-grid under the R-grid.

**Decision:** Option 2. Col 2 wide, middle row tall. Ids only in `data-po-cell`. Cells empty until filled.

**Why:** Matches the sketch and paper size.

**Tradeoffs:** Card is wider than the old `max-w-3xl`. On a narrow window it still `max-w-full`.

## 2026-08-21 — Sketch R21 opposite Consignee is R21B

**Context:** User asked for Terms of Delivery in **R21 opposite R2**. The sketch also used R21 for a small top-right cell.

**Options:** (1) Fill small R21. (2) Fill the large block next to Consignee (`R21B`).

**Decision:** Option 2. Heading **Terms of Delivery**. Below it a shadcn Textarea that fills the remaining cell. Plus clears. Small R21 stays empty.

**Why:** That large cell sits beside R2. Delivery terms need type space.

**Tradeoffs:** Sketch name R21 vs code R21B. UI still does not print those ids.

## 2026-08-21 — Purchase Order Dated is create day, not a picker

**Context:** R12 must show `Dated` then `17-Aug-26` style. User wants the day the PO was created (today → `21-Aug-26`).

**Options:** (1) Live clock that changes every day. (2) Date picker. (3) Freeze `created_at` of the voucher row, format IST `DD-Mmm-YY`.

**Decision:** Option 3. Same row as R11. Plus = new voucher = new Dated (today). Refresh keeps the old create day.

**Why:** Matches Tally-style PO header. Date is the books date of that voucher.

**Tradeoffs:** Staff cannot back-date from R12 yet. IST so a late-night US clock does not show the wrong calendar day.

## 2026-08-21 — Purchase Order voucher uses Indian FY and a per-year sequence

**Context:** R11 must show `Voucher No.` then `PO/26-27/392`. Serial +1 on each new PO. `26-27` is 1 Apr 2026–31 Mar 2027; from 1 Apr 2027 it becomes `27-28`.

**Options:** (1) Client-only counter. (2) One global sequence forever. (3) Per-FY sequence in `dashboard_purchase_orders`, calendar in `Asia/Kolkata`.

**Decision:** Option 3. Format `PO/{yy}-{yy+1}/{seq}`. FY 26-27 first unused seq is **392** so the first sheet matches the sample. Later FYs start at **1**. Plus button allocates the next row. Same browser session keeps the current voucher on refresh.

**Why:** Matches Indian books and the sample number. IST so the year does not flip at local midnight on a US/EU PC.

**Tradeoffs:** Opening the tab the first time in a session reserves a number. Two people clicking Plus at once rely on unique `(fy_code, seq)` + retry. Production does not get this table until an explicit prod release.

## 2026-08-21 — Purchase Order sheet is compact, not a giant table

**Context:** First grid filled the viewport. User still wants the same placing, but smaller and more like other dashboard cards — not a raw table.

**Options:** (1) Keep full-bleed table. (2) Compact Card with muted tiles and the same CSS grid placing.

**Decision:** Option 2. `max-w-2xl`, short rows, `gap-2`, rounded muted cells. Full-bleed off. Labels stay hidden. `R21B` still the large bottom-right.

**Why:** Same map, dashboard look.

**Tradeoffs:** Sheet is denser; content later must fit the compact cells.

## 2026-08-21 — Purchase Order sheet cells stay unlabeled

**Context:** User gave a cell map (R1, R11…R42, R2, R3, plus a large R21) and asked to build that layout without showing the names. Table size should follow the dashboard, not a tiny fixed box.

**Options:** (1) Show labels in cells. (2) Empty cells with ids only in code/`data-po-cell`.

**Decision:** Option 2. Grid fills the Purchase Order panel (full-bleed). Large bottom-right is `R21B` because the sketch reused R21. Plus button now allocates the next voucher (R11) and clears R3.

**Why:** User will name the values later by cell id.

**Tradeoffs:** Empty sheet until content is assigned. Duplicate sketch label R21 is disambiguated in code.

## 2026-08-20 — Purchase Order is a main sidebar tab

**Context:** User asked for **Purchase Order** as a main Scott Dashboard tab with an icon, not a Support sub-tab.

**Options:** (1) Keep it under Support. (2) Add `purchase_order` to the main sidebar (Inventory section) with a spreadsheet/document icon.

**Decision:** Option 2. Tab id `purchase_order`. Icon Lucide `FileSpreadsheet`. Panel `PurchaseOrderPanel.jsx` is a placeholder. Support sub-tabs stay Enquiry / Complaints / Delay alert / Order status / Report.

**Why:** User wants it next to Inventory / Support, not nested.

**Tradeoffs:** Viewers with an explicit allowed-tab list must be granted `purchase_order` by an admin. Inventory POs stay under Inventory until this desk is built.

## 2026-08-19 — No Windows-only Rollup package in dependencies

**Context:** Vercel Linux `npm install` failed because `@rollup/rollup-win32-x64-msvc` was a required dependency.

**Options:** (1) Keep it and force Linux to ignore platform. (2) Remove it and let Vite/Rollup optional deps pick the host OS binary.

**Decision:** Option 2. Never list `@rollup/rollup-win32-*` (or other OS-only native packages) in `dependencies`.

**Why:** Staging/Vercel and Netlify build on Linux. Local Windows still gets the win32 binary as an optional install.

**Tradeoffs:** A broken local Vite on Windows is fixed with `npm install` (optional dep), not by pinning a win32 package for every CI machine.

## 2026-08-19 — Close works without waiting for ON CONFLICT migration

**Context:** Staging close trigger still uses `ON CONFLICT (enquiry_id)`. CLI cannot `db push` without login. Enquiry and Complaints both failed Closed.

**Options:** (1) Wait for SQL. (2) On that error, Close with phone blank so the trigger skips, restore phone, queue survey in the app.

**Decision:** Option 2 in `applyEnquiryClosePatch`. Keep migration `20260819062942` for when staging can be pushed.

**Why:** User needed Close to work now on both desks.

**Tradeoffs:** Two updates on Close while the old trigger remains. Harmless after the trigger is fixed (first update succeeds, no retry).

## 2026-08-19 — Complaints CS- vs Enquiries ENQ-

**Context:** Both desks used `ENQ-#####`. User asked for CS on Complaints and ENQ on Enquiries so the codes never clash.

**Options:** (1) Wait for staging trigger only. (2) Allocate prefix on insert and relabel old complaint ENQ rows; keep the SQL migration.

**Decision:** Option 2. `allocateTicketCode` / `relabelComplaintCodes` in `enquiryUtils.js`. Trigger migration still preferred for sequences.

**Why:** Staging still had the old ENQ-only trigger.

**Tradeoffs:** Until the migration is applied, codes come from the app (max existing number + 1), not Postgres sequences.

## 2026-08-19 — Simulator files tickets without customer AM pick

**Context:** After product photos, Done asked admin users to pick an account manager. Staff-only UPDATE after insert also threw PostgREST coerce errors.

**Options:** (1) Keep AM pick in chat. (2) File as New, assign from Complaints desk. Upload photos before insert.

**Decision:** Option 2. Customer flow is Order ID → issue → photos → Done → confirmation. Admin assigns later. Creator UPDATE RLS added for other attach paths.

**Why:** User asked for a smooth customer flow. Chat should not expose staff assignment.

**Tradeoffs:** Simulator no longer assigns on create. Complaints rows start as New.

## 2026-08-19 — Track Order is automatic from production status

**Context:** Simulator had Home → Track Order. User asked to remove it and send WhatsApp when production updates status.

**Options:** (1) Keep Track Order chat. (2) Client JS after status save. (3) Postgres trigger on `orders.status`.

**Decision:** Option 3. Remove Track Order from the home menu. Trigger queues simulator copy. Phone from enquiry / contact book / Ready Stock. No Meta keys in the SPA.

**Why:** User asked for backend automation on production updates.

**Tradeoffs:** Tracker `orders` have no phone column. No matching phone → log skip, no WhatsApp. Live Meta still not sent from this dashboard.

## 2026-08-19 — Enquiry tab reuses Complaints desk; ENQ vs CS codes

**Context:** Enquiry tab was blank. Complaints already used `public.enquiries`. User asked for a matching enquiries table, ENQ codes, CS codes for complaints, and the same UI.

**Options:** (1) Second table duplicating RLS/SLA/activity. (2) Keep one `enquiries` table, add `ticket_kind`, two sequences.

**Decision:** Option 2. Enquiry = Customized → Enquiries (`ENQ-`). Complaints = Regular + Concerns (`CS-`). Relabel existing complaint `ENQ-00002` → `CS-00002`. Shared `SupportTicketDesk`. Same admin-assign / staff-pick rules.

**Why:** User asked to reuse the same components, API patterns, and role rules.

**Tradeoffs:** `product_details` still stores enquiry text (UI “Concerns” / “Enquiry details”). Live WhatsApp bot in `Scott_concierge` is not updated here — dashboard simulator is.

## 2026-08-18 — Production delay alert on Support for admin and staff

**Context:** Concierge `/admin` has “Send production delay alert”. Dashboard Support copied the desk but skipped that sender. User asked for it on Support for both admin and non-admin.

**Options:** (1) Keep delay-alert only in Concierge. (2) Admin-only card on Support. (3) Same Concierge form on Support for every signed-in user who can open the tab; queue simulator text (no Meta keys in the SPA).

**Decision:** Option 3. Card sits above Enquiry / Complaints / Report. Required: order number, phone, new delivery date. Copy matches Concierge. Staging table `support_delay_alerts` plus two `enquiry_outbound_messages` rows (`delay_alert` text + next-step buttons).

**Why:** User asked for the missing section and for both roles.

**Tradeoffs:** Authenticated users can insert delay rows (RLS `sent_by = auth.uid()`). Live WhatsApp Cloud API still not sent from this dashboard.

## 2026-08-18 — Lock Concerns and customer feedback in Complaints

**Context:** Staff/admin could rewrite customer Concerns and survey feedback in the ticket dialog.

**Options:** (1) Keep editable. (2) Read-only after receive for all roles.

**Decision:** Option 2. Show Concerns and feedback as frozen text. Notes and priority stay editable. Simulator still writes feedback.

**Why:** User asked freeze for both admin and non-admin.

**Tradeoffs:** Staff cannot correct a typo in Concerns from the desk; must live with what the customer sent.

## 2026-08-18 — Complaints list is Help-with-order paths only

**Context:** Complaints table mixed all enquiry rows and showed Product instead of Order ID / Concerns.

**Options:** (1) Show every enquiry. (2) Only Help with order → Regular Order and Help with order → Customized order.

**Decision:** Option 2. Columns: Order ID after Customer; Product renamed Concerns (`product_details`). Delay / Track / Access stay out (Delay still does not file a ticket).

**Why:** User asked those two Concierge paths only.

**Tradeoffs:** Older rows with `help_topic=enquiry` + `order_type=regular` (old create default) do not appear until re-filed on the Regular or Customized path.

## 2026-08-18 — Support sub-tabs Enquiry / Complaints / Report

**Context:** Support sidebar tab was one page (the Concierge desk). User wants three sub-tabs.

**Options:** (1) Three sidebar items. (2) Sub-tabs inside Support.

**Decision:** Option 2. Labels **Enquiry**, **Complaints**, **Report**. Default **Complaints** = current desk. Enquiry and Report stay blank.

**Why:** User asked for sub-tabs under Support, not new sidebar items.

**Tradeoffs:** Permission id stays `enquiry` for the whole Support tab.

## 2026-08-18 — Sidebar label Support (permission id enquiry)

**Context:** User asked the side panel tab **Enquiry** to read **Support**, with a matching icon.

**Options:** (1) Rename permission id and all `enquiry` keys. (2) Change visible label + icon only.

**Decision:** Option 2. Label **Support**, headphones icon. Tab id stays `enquiry` so sidebar permissions keep working.

**Why:** No DB/permission migration. Staff still see Support in the nav.

**Tradeoffs:** Code and tables still say enquiry. Admin permission checklist shows Support because it uses the sidebar label.

## 2026-08-18 — Concierge desk inside Enquiry, keep status format

**Context:** Scott Concierge is a WhatsApp help desk (`Scott_concierge`) with cases, pick buttons, and 2-hour Gargi SLA. The Dashboard already has a Support tab (permission id `enquiry`) with **New / Assigned / In progress / Resolved / Closed**.

**Options:** (1) New sidebar tab copying Concierge HTML. (2) Replace Enquiry statuses with Pending Verification / Verified / Contacted / Closed. (3) Keep Enquiry cards/tabs/table and add Concierge functions there.

**Decision:** Option 3. Map Verified → picked while staying Assigned; Contacted → In progress; Close → Closed. Pending badge = unpicked New/Assigned.

**Why:** User asked to keep New/Assigned/Pending format as present and only replicate functions.

**Tradeoffs:** Live Meta WhatsApp bot stays in Concierge. Dashboard Close and delay alerts queue the same copy for the WhatsApp simulator (and a future Edge Function). SLA persist needs someone with write RLS to open the tab.

**Future:** Optional pg_cron SLA watcher; Edge Function + WhatsApp Cloud API if secrets are stored on Supabase, not in the SPA.
