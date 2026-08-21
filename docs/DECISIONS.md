# Decisions

Older product history lives in [CHANGELOG.md](./CHANGELOG.md). New significant choices are recorded here.

## 2026-08-21 — Sketch R21 opposite Consignee is R21B

**Context:** User asked for Terms of Delivery in **R21 opposite R2**. The sketch also used R21 for a small top-right cell.

**Options:** (1) Fill small R21. (2) Fill the large block next to Consignee (`R21B`).

**Decision:** Option 2. Heading **Terms of Delivery**. Second line shadcn Input. Plus clears. Small R21 stays empty.

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
