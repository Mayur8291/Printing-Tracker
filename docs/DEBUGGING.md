# Debugging

## Billing: "This dispatch is already invoiced"

- **Symptom:** Generate invoice fails naming the dispatch.
- **Root cause:** by design — `bill_invoice.dispatch_id` is unique. One invoice per dispatch.
- **Fix:** open the existing invoice (Billing & AR → Invoices). Corrections are a credit note, not a second invoice.

## Billing: "Invoices, credit notes and receipts are immutable"

- **Symptom:** UPDATE/DELETE on `bill_invoice`, `bill_credit_note`, `ar_receipt` or `ar_allocation` raises.
- **Root cause:** by design (law 3/4). The only UPDATE allowed is the totals write inside `bill_generate_from_dispatch` (transaction-local flag).
- **Fix:** issue a credit note or a counter receipt. Never disable the trigger.

## Billing: "Credit / Allocation exceeds invoice outstanding"

- **Symptom:** credit note or receipt allocation fails with the outstanding figure.
- **Root cause:** `ar_invoice_outstanding_locked` (total − credits − allocations) under `FOR UPDATE`.
- **Fix:** lower the amount. Check the Ageing tab for the live outstanding.

## Billing: GSTIN / place of supply errors

- **Symptom:** "GSTIN belongs to a different entity" or "Place of supply must be a 2-digit state code".
- **Root cause:** invoice GSTIN must belong to the order's entity; POS is the 2-digit state code (blank in the UI = GSTIN state → intra-state CGST+SGST).
- **Fix:** pick a GSTIN of the order's entity; enter a 2-digit POS for inter-state (IGST).

## Billing & AR tab empty / missing tables

- **Symptom:** panel error naming `bill_invoice` or the RPCs.
- **Root cause:** local/staging schema missing `20260902170000_step4_billing_receivables.sql`.
- **Fix:** confirm `npm run check:env` points at staging `scvojtvgnkmbupvyslmb`; migration already applied there. Production does not have this schema until an explicit release.

## Support table values missing in Dark Mode

| | |
|--|--|
| **Symptom** | Support → Enquiry / Complaints table cells look empty in Dark Mode. Light Mode is fine. |
| **Root cause** | Rows use `bg-red-50` / `bg-sky-50` (pale). Dark Mode `.table-panel` text is light. Light on pale. |
| **Fix** | Hard refresh. `PRIORITY_ROW_CLASS` and badges include `dark:` backgrounds and `text-foreground`. |
| **Verify** | Dark Mode: Code, Customer, Order ID, Concerns, Source, Assignee, Created all readable. Priority tint still there. |

## Sales order: "Order cannot be ready: N line(s) not fully reserved"

- **Symptom:** Mark ready fails naming the number of short lines.
- **Root cause:** by design (roadmap law) — `so_set_status` refuses `ready` unless every line has `qty_reserved + qty_dispatched ≥ qty`. Stock ran out at confirm time, so allocation was partial.
- **Fix:** get stock into the order's fulfilment location (GRN, production, job-work receipt, transfer), then Allocate stock on the order; repeat Mark ready.

## Sales order: "Dispatch X exceeds reserved Y for this line"

- **Symptom:** posting a dispatch fails naming the line's reserved qty.
- **Root cause:** by design — a dispatch can never exceed reserved qty (`so_post_dispatch` checks under lock; the dialog caps inputs too, but the DB is the authority).
- **Fix:** allocate more stock first (order must be re-set to ready is *not* needed — allocation works on confirmed/in_production; ready orders keep their reservations), or dispatch the reserved quantity only.

## Sales order / job work: "status changes only through …" / "append-only" errors

- **Symptom:** direct updates to `so_order`, `so_dispatch`, `jw_job` raise "status changes only through so_confirm / so_set_status / so_post_dispatch / so_cancel" or "Dispatches are append-only".
- **Root cause:** by design. Guard triggers allow status flips only inside the definer functions; dispatch documents freeze at creation.
- **Fix:** use the RPCs. Dispatch corrections are `return_in` movements + a note, never edits.

## Job work: worker location still shows input stock after receive

- **Symptom:** Stock Ledger shows leftover input SKUs at the job-worker location after a job is received/closed.
- **Root cause:** not a bug — receive only burns what was declared consumed. The leftover **is** the pending/loss figure the roadmap wants visible.
- **Fix:** if pieces physically came back, post a `transfer` movement worker → source (ref the job). If they are lost, leave them (or consume with a note) so the loss stays on record.

## SLA tab empty / no breaches shown

- **Symptom:** SLA tab shows "Nothing here" although orders exist.
- **Root cause:** no `sla_policy` rows for the order's channel (orders are unmeasured without a target), or all measured stages are within target while "breaches only" is on.
- **Fix:** save stage targets for the channels in use; toggle "Show all" to see running stages. Hours count Mon–Sat 09:30–18:30 IST only (`ops_business_hours_between`).

## Procurement: "status changes only through …" / "immutable" errors

- **Symptom:** direct updates to `po_purchase_order`, `po_grn` or `ap_bill` raise "status changes only through po_approve / po_post_grn / ap_approve_bill" or "… is immutable".
- **Root cause:** by design. Guard triggers allow status flips only inside the definer functions (transaction-local flag `ops.allow_status_change`). Approved/posted documents freeze.
- **Fix:** use the RPCs (`po_approve`, `po_post_grn`, `po_record_qc`, `ap_approve_bill`, `ap_record_payment`) or, for money corrections, a debit note / counter payment. Never disable the triggers.

## Procurement: GRN blocked with "Over-receipt: pending X plus tolerance…"

- **Symptom:** posting a GRN fails naming pending, tolerance and the allowed maximum.
- **Root cause:** received qty exceeds pending + tolerance% of ordered. Tolerance source: `crm_vendor_item.over_receipt_pct` for that vendor+SKU if set, else `po_settings.over_receipt_tolerance_pct`.
- **Fix:** correct the quantity, or (deliberately) raise the tolerance in Procurement → Settings / the vendor-item override, then repost. The failed draft GRN is auto-deleted by the UI.

## Procurement: bill approval fails with "Rate variance beyond tolerance"

- **Symptom:** `ap_approve_bill` raises listing SKUs with PO rate vs bill rate.
- **Root cause:** three-way match; variance beyond `po_settings.rate_variance_tolerance_pct`.
- **Fix:** in the approve dialog give an override reason (recorded, `match_status='override'`), or fix the line rates while the bill is draft. "Billed qty exceeds received" has no override — fix the qty.

## Procurement tab: "Procurement tables are not on this database yet"

- **Symptom:** inline message naming migration `20260902120000_step2_procurement.sql`.
- **Root cause / fix:** same pattern as Platform Masters — the env the app points at lacks the migration (staging has it since 2026-09-02; production only on an explicit release).

## Internal Support Platform missing from Tools

| | |
|--|--|
| **Symptom** | Tools has no Internal Support Platform, or click does nothing. |
| **Root cause** | Tab id is `internal_support`. Viewer with an explicit allowed-tab list must be granted that id. Support (Enquiry) is a different tab (`enquiry`). |
| **Fix** | Hard refresh. Admin: Tools list after Chat. Viewer: Admin Panel → grant **Internal Support Platform**. |
| **Verify** | LifeBuoy icon. Tabs **Open Tickets** and **Resolved**. **Raise an Issue** is a button on Open Tickets. Enquiry Support still under Inventory. |

## Internal Support History empty or Submit does not appear in History

| | |
|--|--|
| **Symptom** | Open Tickets has no rows after Submit, or Status will not change. |
| **Root cause** | Rows live in staging `internal_support_issues`. Insert needs `raised_by = auth.uid()`. Local app must use staging ref. Production has no table yet. |
| **Fix** | Sign in. Open Tickets → **Raise an Issue**. Submit. Hard refresh. Check `npm run check:env` is staging. Console `[internal-support] insert failed` if RLS or schema missing. |
| **Verify** | Admin: Open Tickets shows non-Resolved rows, Status Select, Name filter. Non-admin: only own rows, Status Badge, no Name filter. Columns Name | Status | Issue | Date. Issue line is `type - floor → View Issue`. Resolved tab shows Resolved rows for both roles. Date is raised day. |

## Internal Support Resolved tab missing or Status still editable

| | |
|--|--|
| **Symptom** | No **Resolved** tab, Resolved rows stay in Open Tickets, or Status can still change after Resolved. |
| **Root cause** | Open Tickets must exclude `status = Resolved`. Resolved tab is read-only. Staging update RLS requires `status <> Resolved`. |
| **Fix** | Hard refresh. Admin: set Status to Resolved on Open Tickets. Open **Resolved**. Confirm no Status dropdown. |
| **Verify** | Both admin and viewer see the tab. Viewer sees only own Resolved rows. Name filter on Resolved is admin only. |

## Internal Support History shows other people’s issues to a non-admin

| | |
|--|--|
| **Symptom** | Viewer History lists someone else’s submit, or viewer can change Status, or viewer sees a Name dropdown. |
| **Root cause** | Old RLS allowed authenticated select/update all. UI used to always render Select + Name filter. |
| **Fix** | Hard refresh. Confirm `profiles.role`. Staging must have `select own or admin` and `update admin`. Local list filters `raised_by` when not admin. |
| **Verify** | Sign in as viewer: only own History, Badge status, no Name filter. Sign in as admin: all rows, Status Select works. |

## Internal Support Status dropdown has no symbol in the closed box

| | |
|--|--|
| **Symptom** | Status list has icons, but the closed trigger is text only, or Lucide lines instead of colorful symbols. |
| **Root cause** | `SelectValue` with no children only prints the item text. Lucide icons do not match Production Tracker `.stage-icon` emoji. |
| **Fix** | Hard refresh. History Status must put `InternalSupportStatusMark` inside `SelectValue` and each `SelectItem`. |
| **Verify** | Closed box = emoji + name + chevron. Open list = same emoji + name for all four statuses. |

## Internal Support Platform issue buttons missing or not clickable

| | |
|--|--|
| **Symptom** | Tools Internal Support Platform has no heading, no buttons, or click does nothing visible. |
| **Root cause** | Panel must render `INTERNAL_SUPPORT_ISSUE_OPTIONS` as shadcn `Button`. Click toggles local `selectedIssues` array (outline vs default). Many can be on. No database. |
| **Fix** | Hard refresh. Open Tickets → **Raise an Issue**. Click a few options; they stay filled. Click one again to clear it. Close Dialog clears picks. |
| **Verify** | Ten labels: Internet, Power Cut, Water Issue, Machinery, Food, Issue with Asset, Lift not working, Issue with Biometric, Floor Hygeine, Lost Personnal Belongings. |

## Internal Support Floor options missing

| | |
|--|--|
| **Symptom** | No **Select your Floor** heading, or floor Buttons missing / more than one stay filled. |
| **Root cause** | Floor list only renders when a picked issue needs a floor (`internalSupportNeedsFloor`). Food / Issue with Asset / Issue with Biometric / Lost Personnal Belongings hide Floor. Mix with Internet (etc.) shows Floor. One `selectedFloor` string. |
| **Fix** | Hard refresh. Open Tickets → **Raise an Issue**. Pick Food: no Floor, Comment only. Pick Internet: Floor appears. Food + Internet: Floor appears. |
| **Verify** | Ground Floor through 5th Floor only after a floor-required issue is on. |

## Internal Support comment or Submit missing / Submit does nothing

| | |
|--|--|
| **Symptom** | No Comment box, no Submit, Submit does nothing, or Submit “works” but no ticket in the database. |
| **Root cause** | Comment and Submit show when there is at least one issue **and** (a floor is picked **or** every picked issue is Food / Issue with Asset / Issue with Biometric / Lost Personnal Belongings). Those four hide Floor. Empty comment shows FieldError. Floor-required issues with no floor hide Comment. Success clears the form, logs `[internal-support] submit`, and shows the thank-you Alert. No table yet. |
| **Fix** | Hard refresh. Open Tickets → **Raise an Issue**. Floor-required issue: Floor appears, pick a floor, then Comment. Food / Asset / Biometric / Lost belongings: no Floor, Comment only. Mix with Internet: Floor shows again. |
| **Verify** | Internet alone: Floor then Comment after a floor. Food alone: no Floor, Comment only. Food + Internet: Floor shows, Comment waits for a floor. After Submit: thank-you sentence. |

## Delivery required on still lets pick a past day

| | |
|--|--|
| **Symptom** | Create Job sheet or Create Sample Jobsheet calendar still has yesterday and older days. |
| **Root cause** | DatePicker must get `minDate` = today. Save also rejects `due_date` before today. |
| **Fix** | Hard refresh. Open Create Job sheet or Create Sample Jobsheet → Delivery required on. |
| **Verify** | Today and future days click. Past days grey / not selectable. Production still requires a date. Sample can leave it blank. |

## Sample Due In missing, wrong time, or SLA Breached too early

| | |
|--|--|
| **Symptom** | Sampling list has no **Due In** after Order date, View Sample Order has no Due In, countdown ignores **Delivery required on**, stays 48h when a date was filled, or **SLA Breached** shows while still inside the deadline. |
| **Root cause** | If `due_date` is set, SLA is end of that local day. If blank, SLA is `created_at` + 48 hours. List column is Sampling `extraColumn` after Order date. Closed samples show — on the list and hide Due In in the view. Browser clock drives the tick. |
| **Fix** | Hard refresh. Open **Sampling Tracker** → **All orders**. Check `due_date` and `created_at`. Create Sample Jobsheet can save without Delivery required on. Complete orders has no Due In column. |
| **Verify** | Save with a delivery date → All orders Due In counts to end of that day. Save with no date → near `48:00 Hrs Left`. Sampling Complete has no Due In. After Dispatched Successfully, view hides Due In. Past the deadline still open → red **SLA Breached**, no timer. |

## Sampling Complete still shows a Status dropdown or wrong status

| | |
|--|--|
| **Symptom** | Complete sample still has a Status picker, or the badge is not Dispatched Successfully. Dispatched Successfully row stays on All orders. |
| **Root cause** | Sampling Complete is `is_complete` **or** status `dispatched_successfully`. Closed samples always display Dispatched Successfully. Status Select is off on Complete and in View Sample Order when closed. |
| **Fix** | Hard refresh. Open Sampling Tracker → Complete orders. Pick Dispatched Successfully on All, or Mark as complete in View Sample Order. |
| **Verify** | Row leaves All, appears on Complete with locked Dispatched Successfully badge. Production Complete Status is unchanged. |

## Marked complete job missing from Production or Sampling Complete

| | |
|--|--|
| **Symptom** | Mark as complete, then the job is gone from All orders and not on Complete, or it shows under the other tracker. |
| **Root cause** | All = not complete. Complete = `is_complete`. Production Complete only has production job sheets. Sampling Complete only has `sample_job_sheet`. Each tracker remembers its own All/Complete tab. |
| **Fix** | Open the same tracker (Production vs Sampling). Click **Complete orders**. Clear From/To. |
| **Verify** | Complete a production job → Production Tracker → Complete orders. Complete a sample job → Sampling Tracker → Complete orders. The other tracker list does not gain that row. |

## Sampling Tracker status still shows printing or production stages

| | |
|--|--|
| **Symptom** | Sampling Status dropdown still has New Orders / Quotation approval / Cutting, or save fails on a new sample stage. |
| **Root cause** | Sampling uses `sampleJobSheetStages.js`. Staging needs the extra `orders.status` codes. Old sample rows were `quotation_approval` until backfill. |
| **Fix** | Apply `20260831065000_sample_job_sheet_statuses.sql` on staging. Hard refresh. Open **Sampling Tracker**, not Production Tracker. |
| **Verify** | Dropdown is Pattern Making \to Dispatched Successfully with icons. Production Tracker dropdown is unchanged. |

## Sampling Tracker list missing after save

| | |
|--|--|
| **Symptom** | Create Sample Jobsheet saves, but Sampling Tracker still looks empty, or user lands on Production Tracker. |
| **Root cause** | List is `filterSampleJobSheetOrders` (`order_kind = sample_job_sheet`). **All orders** hides complete rows. Date From/To uses `order_date`. After save, App keeps the **Sampling Tracker** sub-tab on All. |
| **Fix** | Open **Sampling Tracker**. Clear From/To. Hard refresh. Confirm the row is `sample_job_sheet` and not complete. |
| **Verify** | Save a sample job sheet → stay on Sampling Tracker → row shows with **View Sample Order**, **Sample Order**, **Order date**. Production Tracker does not show that row. |

## Production Tracker list missing after adding Sampling tab

| | |
|--|--|
| **Symptom** | Opening Production tracker shows a blank Sampling view, or the job-sheet table looks restyled. |
| **Root cause** | Default sub-tab is **Production Tracker**. Sampling has its own list. Production list is still `LinkedOrdersTabPanel` with Qty + Handover. |
| **Fix** | Click **Production Tracker**. Hard refresh. |
| **Verify** | Production Tracker = same table as before (count, Qty, Handover, View order, Production order, Delivery date). Sampling Tracker = sample list without count/Qty/Handover. |

## Create Sample Jobsheet fails or ID is not SA-0001

| | |
|--|--|
| **Symptom** | Save says order type is not enabled, or Order ID is not `SA-0001` / next number. |
| **Root cause** | Staging needs `sample_job_sheet` on `orders.order_kind`. IDs come from existing `sample_job_sheet` rows only. |
| **Fix** | Apply `20260831060510_add_order_kind_sample_job_sheet.sql` on staging. Next ID is max SA-#### + 1. |
| **Verify** | First save → `SA-0001`. Next → `SA-0002`. Production Tracker list does not show that row. |

## Purchase Order status change missing or available to staff

| | |
|--|--|
| **Symptom** | Non-admin sees a status dropdown, or admin cannot change status on All PO Orders, or History has a status pick. |
| **Root cause** | Status pick is admin-only on **All PO Orders**. PO History is always a Completed badge. Update checks `profiles.role === admin`. |
| **Fix** | Sign in as admin to change Pending / PO sent / PO Approved / Completed. Staff only see the badge. History never has a picker. |
| **Verify** | Admin → All PO Orders → dropdown works. Viewer → badge only. Both → History badge only. |

## Purchase Order History filters miss rows or stay empty

| | |
|--|--|
| **Symptom** | From/To, Search, or Coordinator hide a PO that should show. Or History looks empty after filters. |
| **Root cause** | Date uses `po_date` (`DD-Mmm-YY`). Search is **exact** (trim + case-insensitive): seq after last `/`, full voucher, supplier, or coordinator. Partial `39` does not match `392`. Coordinator dropdown uses names on generated rows. |
| **Fix** | Clear dates with **Clear**. Empty the search box. Set Coordinator to **All coordinators**. Type the full seq (`392`), full name, or full coordinator. Widen From/To. |
| **Verify** | Generate a PO. History → type only the number after the last `/`. Row shows. Pick that coordinator. Same row. Set From/To around Dated. **Clear** brings all dates back. |

## Purchase Order print includes the app chrome

| | |
|--|--|
| **Symptom** | Print shows sidebar / Generate PO / Plus, or misses **PURCHASE ORDER**. |
| **Root cause** | Only `[data-po-print-root]` (title + A4 card) should print. Buttons are `data-po-no-print`. |
| **Fix** | `@media print` in `styles.css` hides chrome when the print root exists. |
| **Verify** | Create tab: title on the sheet. Buttons under the card. Print preview = title + table only. |

## Purchase Order Generate blocked for empty mandatory fields

| | |
|--|--|
| **Symptom** | Generate PO shows only **Mandatory details are Missing**. Supplier / Description / Due on / Quantity / Rate cells turn red. |
| **Root cause** | Those fields are required before a History row is written. |
| **Fix** | Pick a supplier. Fill Description of Goods, Due on, Quantity, Quantity unit, and Rate on every goods line. Red clears as each field is filled. Generate again. |
| **Verify** | Empty Generate → red alert + red cells. Fill all → Generate → PO History row. |

## Purchase Order View PO Print differs from Create Print

| | |
|--|--|
| **Symptom** | History → View PO → Print is clipped, tiny, or missing C23. |
| **Root cause** | The sheet lives in a Dialog (`transform` + `overflow`). That traps `[data-po-print-root]` so Create Print CSS cannot fill A4. |
| **Fix** | Print flattens `[data-po-view-dialog]`. Same A4 + C23 rules as Create new PO. |
| **Verify** | Open a History row → View PO → Print. Preview matches Create Print: full sheet, C13, C23. |

## Purchase Order C23 shows on screen or missing on print

| | |
|--|--|
| **Symptom** | Print preview cuts the table, or no C23. Screen must stay without C23. |
| **Root cause** | Packed `height: auto` print made the table small. A4 + margins can clip C13 if C23 is an extra row. |
| **Fix** | Print fills 210mm × 297mm (`@page` margin 0). C13 keeps full height. C23 overlays C13 bottom-right. Hide C23 only in `@media screen`. |
| **Verify** | Create → Print. Sheet fills the page like the screen. C13 words fully visible. C23 at bottom-right. Screen still has no C23. |

## Purchase Order View PO is a summary, not the sheet

| | |
|--|--|
| **Symptom** | View PO shows a field list, not **PURCHASE ORDER** plus the table. |
| **Root cause** | View PO must mount `PurchaseOrderPrintSheet` from `sheet_snapshot`. |
| **Fix** | Hard refresh. Open History → View PO. |
| **Verify** | Dialog shows the A4 heading and the same R/C table as Create / Print. |

## Purchase Order History empty after Generate PO

| | |
|--|--|
| **Symptom** | Generate PO does nothing, or History stays empty. |
| **Root cause** | History lists only rows with `generated_at`. That column (and UPDATE RLS) comes from `20260822104145_dashboard_purchase_order_history.sql`. |
| **Fix** | Apply that migration on staging. Confirm Generate writes the current voucher, then History shows PO / PO Number / Supplier / Status / Coordinator / PO date / Quantity. |
| **Verify** | Create a sheet → Generate PO → History row. PO Number = voucher. Supplier = bold R3 name. PO date = Dated. Quantity = C42. View PO opens the A4 **PURCHASE ORDER** heading and table. |

## Purchase Order Create / History tabs missing

| | |
|--|--|
| **Symptom** | No Create new PO / PO History, or the A4 sheet is gone after a tab click. |
| **Root cause** | Those sub-tabs live in `PurchaseOrderPanel`, opposite the heading. Create unmounts History and vice versa. |
| **Fix** | Default tab is `open` (Pending / PO sent / PO Approved). Create mounts the sheet on click. History shows Completed only after backend update. |
| **Verify** | Open Purchase Order → All PO Orders. Create new PO → heading + table. Generate → PO sent on All PO Orders. History empty until status is Completed. |

## Purchase Order C13 heading or height is wrong

| | |
|--|--|
| **Symptom** | C13 still says Amount in words, or the row is a thin strip vs Consignee. |
| **Root cause** | Old heading. C13 hugged text while C11–C81 took leftover height. |
| **Fix** | Heading `Amount Chargable (in words):`. ResizeObserver copies R2 height onto C13. Goods rows `minmax(1.25rem, 1fr)`. |
| **Verify** | C13 label matches. C13 box is as tall as R2 Consignee. Goods row still usable. |

## Purchase Order C42 qty total missing or C82 wraps

| | |
|--|--|
| **Symptom** | C42 empty, or C82 wraps / looks normal weight. |
| **Root cause** | C42 is the Quantity sum. C82 had `font-weight: 400` and spaces that wrapped. |
| **Fix** | `sumPurchaseOrderQuantities` on C42 (bold). C82 uses nowrap + bold + non-breaking spaces. |
| **Verify** | Qty 3 + 2 → C42 **5**. C82 ** ₹ 1550.00** on one line, bold. |

## Purchase Order C82 total is blank or missing ₹

| | |
|--|--|
| **Symptom** | C82 empty after line Amounts, or not ` ₹ 1000.00`. |
| **Root cause** | C82 is the sum of goods-line Amounts (qty × rate), not a typed field. |
| **Fix** | `sumPurchaseOrderLineAmounts` + `formatPurchaseOrderC82Display`. C13 words read the same number. |
| **Verify** | One row 3 × 450.00 → Amount 1350.00 and C82 ** ₹ 1350.00**. Add a second line 2 × 100.00 → C82 ** ₹ 1550.00**. Clear all rates → C82 empty. |

## Purchase Order Amount is blank or wrong

| | |
|--|--|
| **Symptom** | Amount stays empty after qty + rate, or has more than 2 decimals, or is a typed box. |
| **Root cause** | C81 is computed, not typed. Need both Quantity and Rate numbers. |
| **Fix** | `formatPurchaseOrderLineAmount` = qty × rate, `toFixed(2)`. Plain text at the top. Extra `C81:L*` rows use that line’s qty/rate. |
| **Verify** | Qty `3`, Rate `450.00` → Amount **1350.00**. Clear qty → Amount empty. New + row has its own product. |

## Purchase Order Rate will not take 450.00

| | |
|--|--|
| **Symptom** | Rate empty, letters type in, more than 2 decimals, or a boxed field. |
| **Root cause** | C51 was blank. Rate must match Quantity’s open Input and money face. |
| **Fix** | `sanitizePurchaseOrderRate` (digits + 2 decimals). Blur `formatPurchaseOrderRate` → `450.00`. Same no-box CSS as C41. Extra `C51:L*` rows reuse it. |
| **Verify** | Type `450a` → `450`. Type `450.999` → `450.99`. Leave field → **450.99**. New + rows have their own rate. Plus clears. |

## Purchase Order Quantity or per is wrong

| | |
|--|--|
| **Symptom** | Typed qty sits in a tiny black box / looks missing, or number+unit bunch in the corner. |
| **Root cause** | Input height collapsed (`min-height: 0`) so the digit clipped; browser focus outline looked like a box; width was only a few `ch`. |
| **Fix** | Open 1.25rem field, `outline: none`, number `flex-1`, unit on the right. No `___` row. |
| **Verify** | Type `3` — you see **3**, no black box, no underscore lines. Type `3.5` → stays **35** (no decimal). Unit (Roll) at the right of the top row. |

## Purchase Order Due on shows past days or a date box

| | |
|--|--|
| **Symptom** | Due on is a full date field, or yesterday can be picked. |
| **Root cause** | C31 was empty. A boxed DatePicker would look like a second cell. |
| **Fix** | Icon-only shadcn Calendar in a Popover. `isPurchaseOrderDueOnAllowed` blocks IST days before today. Label `formatPurchaseOrderDueOn` sits at the top. |
| **Verify** | Click the calendar icon. Yesterday is off. Pick today → **14-Aug -26** on one line at the top. New rows have their own icon. |

## Purchase Order Description of Goods is not typeable

| | |
|--|--|
| **Symptom** | Cannot type under Description of Goods. Extra lines also blank. |
| **Root cause** | C21 was an empty tile. |
| **Fix** | Each goods line has a normal-text Textarea that fills C21 / `C21:L*`. No inner box. Plus clears. Delete extra row drops that text. |
| **Verify** | Click anywhere in the Description cell and type. No second box inside the cell. |

## Purchase Order Sl No. stays blank or out of order

| | |
|--|--|
| **Symptom** | C11 has no 1. or numbers stay 1. 1. after insert. |
| **Root cause** | Serial comes from the current line index, not a stored number. |
| **Fix** | `purchaseOrderSlNoText(lineIndex)` on C11 / `C11:L*`. Insert or delete rebuilds 1. 2. 3. |
| **Verify** | One row → **1.** at the top of C11. Add below → **1.** **2.** Insert between → **1.** **2.** **3.** in order. |

## Purchase Order C11–C81 cannot add a line

| | |
|--|--|
| **Symptom** | No + / − on the left of the goods line. Cannot add or delete a sub-row. |
| **Root cause** | C11–C81 was one fixed grid row. |
| **Fix** | Hover anywhere on the left outline. **+** follows the pointer. Click adds a row after the line under the pointer. **−** only at the left end of an extra row’s join. Split lines match other cell borders. First row stays. |
| **Verify** | **−** does not travel with the mouse. New row line looks like the other table lines. |

## Purchase Order C12–C82 row missing

| | |
|--|--|
| **Symptom** | C12–C82 row gone. Words sat where those eight tiles should be. |
| **Root cause** | First pass merged C12–C82. User wanted that row kept, plus a new row under it. |
| **Fix** | Restore C12–C82. New long **C13** under them for amount in words. Do not print C13. |
| **Verify** | Eight tiles C12–C82. Under them one long words cell. No C-codes. |

## Purchase Order R32 R41 R42 scroll or sit away from neighbors

| | |
|--|--|
| **Symptom** | Other References / Dispatched through / Destination scroll, or holes between tiles. |
| **Root cause** | Those cells used `overflow` + sheet `gap-1`. Textarea default `min-height` 60px also boxed them. |
| **Fix** | Auto-grow textarea (`height = scrollHeight`, overflow hidden). Sheet `gap-0`, cells `rounded-none`. Typed text `font-bold`. |
| **Verify** | Type a long line in R32. Cell grows. No scrollbar. No empty band between tiles. Heading stays normal. |

## Purchase Order empty space after R3 supplier pick

| | |
|--|--|
| **Symptom** | After choosing a supplier in R3, holes open between cells (voucher tiles and/or under R3). |
| **Root cause** | R1+R2+R3 spanned the same 5 grid rows as R11–R42. R3 grew with address lines, so those rows stretched. |
| **Fix** | Two columns: left stack hugs R1/R2/R3. Right 4×2 is its own short grid. R21B `flex-1` only fills leftover. |
| **Verify** | Pick a supplier. R3 grows. R11–R42 stay tight. No empty band between tiles. |

## Purchase Order empty space between R1 and R2

| | |
|--|--|
| **Symptom** | Hole between Invoice To (R1) and Consignee (R2). |
| **Root cause** | R1 hugged its text, but the top grid stayed as tall as the four voucher rows. R2 started under that whole grid. |
| **Fix** | Stack R1, R2, R3 in one left column. Same `gap-1` as other tiles. |
| **Verify** | R2 sits tight under R1. Right 4x2 and R21B stay. |

## Purchase Order R2 shows a scrollbar

| | |
|--|--|
| **Symptom** | Consignee block (R2) has a scroll bar. Text is clipped. |
| **Root cause** | R2 was `overflow-auto` inside a fixed-height stack with R3. |
| **Fix** | R1/R2/R3 are `h-auto overflow-visible` and sit at the top. |
| **Verify** | Full Consignee text visible. No scroll bar. R2 sits tight under R1 (same gap as other cells). |

## Purchase Order C table shows C1 C21 labels

| | |
|--|--|
| **Symptom** | Second table prints C1, C21, etc. |
| **Root cause** | Those names are only for the sketch. UI must stay blank. |
| **Fix** | Ids live in `PURCHASE_ORDER_C_CELL_IDS` and `data-po-cell`. C1–C8 show goods headings only (`PURCHASE_ORDER_C_HEADINGS`). Never print C1/C21. |
| **Verify** | Top C row: Sl No., Description of Goods, Due on, Quantity, Rate, per, Disc %, Amount. No C-codes. |

## Purchase Order Terms of Delivery is a one-line box

| | |
|--|--|
| **Symptom** | Down R21 type field looks like a single-line Input. |
| **Root cause** | Percent height / `min-h-0` on the textarea collapsed it. Global `textarea { min-height: 44px }` on tablet also looks like one line. |
| **Fix** | R21B sits beside Consignee. Compact Textarea `rows={4}` and `[data-po-cell="R21B"] textarea { min-height: 4.5rem }`. Hard refresh. |
| **Verify** | Big type area, same block as Consignee + Supplier stacked on the left. |

## Purchase Order Terms of Delivery is in the small R21 cell

| | |
|--|--|
| **Symptom** | Looking at the tiny cell left of Mode/terms of Payment. No Terms of Delivery box. |
| **Root cause** | Sketch reused **R21** for the large block opposite Consignee. Code id is **R21B**. Small R21 stays empty. |
| **Fix** | Type in the large cell next to Consignee / Supplier. |
| **Verify** | Down-right large cell. First line **Terms of Delivery**. Textarea fills that whole remaining box. Plus clears it. |

## Purchase Order R12 dated is wrong day

| | |
|--|--|
| **Symptom** | Dated is yesterday, blank, or not today. |
| **Root cause** | R12 is today's IST date (`formatPurchaseOrderDated(new Date())`), not voucher `created_at`. Day flip is checked every minute. |
| **Fix** | Hard refresh. Confirm PC/IST day. Leave the sheet open past midnight IST → date should change within a minute. |
| **Verify** | Create tab Dated = today (`22-Aug-26` on 22 Aug 2026 IST). Generate → History **PO date** matches that today. |

## Purchase Order R11 voucher does not increment

| | |
|--|--|
| **Symptom** | Plus keeps the same `PO/26-27/392`, or number jumps then resets. |
| **Root cause** | `dashboard_purchase_orders` missing on the linked project, or this browser is on the localStorage fallback while another user uses the table. |
| **Fix** | Apply `supabase/migrations/20260821064834_dashboard_purchase_order_vouchers.sql` on **staging** (`scvojtvgnkmbupvyslmb`). Hard refresh. Do not apply to production unless asked. |
| **Verify** | Open Purchase Order. R11 shows **Voucher No.** then `PO/26-27/392` (or next). Plus → 393, 394. After 1 Apr 2027 IST → `PO/27-28/1`. |

## Purchase Order R11 year looks wrong

| | |
|--|--|
| **Symptom** | Code shows `25-26` in April, or `27-28` in March 2027. |
| **Root cause** | FY is 1 Apr–31 Mar in `Asia/Kolkata`, not the PC timezone and not Jan–Dec. |
| **Fix** | Check `purchaseOrderFinancialYearCode`. 31 Mar 2027 = `26-27`. 1 Apr 2027 = `27-28`. |
| **Verify** | R11 second line matches the Indian books year. |

## Purchase Order R3 supplier dropdown is empty

| | |
|--|--|
| **Symptom** | R3 heading shows. Dropdown has no names. |
| **Root cause** | List is `inventory_suppliers` (same as Inventory → Suppliers). No rows, or RLS hides them. |
| **Fix** | Inventory → Suppliers → add a vendor. Hard refresh Purchase Order. |
| **Verify** | Dropdown shows the supplier **name**. Pick it. Address/contact/GSTIN appear under it. No extra labels. |

## Purchase Order sheet shows cell names like R1

| | |
|--|--|
| **Symptom** | Purchase Order grid prints R1, R11, etc. inside cells. |
| **Root cause** | Labels were only for the layout sketch. UI must stay blank. |
| **Fix** | Ids live in `purchaseOrderLayout.js` and `data-po-cell`. Do not put those strings in cell text. Large bottom-right is `R21B`. |
| **Verify** | Sidebar → Purchase Order. Compact card, empty muted tiles, same shape as the sketch. No R-codes. Not full-page. |

## Purchase Order tab missing for a viewer

| | |
|--|--|
| **Symptom** | Admin sees **Purchase Order** in the sidebar. A viewer with a saved tab list does not. |
| **Root cause** | New tab id `purchase_order` is grantable. Explicit `allowed_dashboard_tabs` arrays from before this tab do not include it. `null` still means all tabs. |
| **Fix** | Admin Panel → that viewer → enable **Purchase Order** view (and edit if needed) → save. |
| **Verify** | Sign in as that viewer. Sidebar Inventory section shows Purchase Order with the spreadsheet icon. |

## Vercel: npm install EBADPLATFORM for @rollup/rollup-win32-x64-msvc

| | |
|--|--|
| **Symptom** | Vercel (Linux) build on `develop` fails during `npm install`. Log: `EBADPLATFORM` / `@rollup/rollup-win32-x64-msvc` wanted `os: win32`, actual `os: linux`. |
| **Root cause** | That native Rollup binary was listed under `package.json` `dependencies`, so npm must install it. Linux CI cannot. Vite already pulls the correct `@rollup/rollup-*` binary via Rollup optional deps. |
| **Fix** | Do not add OS-specific `@rollup/rollup-*` packages as required deps. Keep them optional through `vite`/`rollup`. |
| **Verify** | Vercel install succeeds on Linux. Local Windows `npm run build` still works (optional win32 binary installs on Windows). |

## Support: Close enquiry fails with ON CONFLICT unique constraint

| | |
|--|--|
| **Symptom** | Activity dialog: set Status to Closed → Update status. Red text: `there is no unique or exclusion constraint matching the ON CONFLICT specification`. Row stays In progress. |
| **Root cause** | Close trigger `enquiries_queue_close_survey` did `ON CONFLICT (enquiry_id)`. Delay-alert migration dropped that unique index and left a **partial** unique index (`enquiry_id IS NOT NULL`). Postgres cannot use that for `ON CONFLICT (enquiry_id)`, so the whole status update rolls back. |
| **Fix** | Apply `20260819062942_fix_close_survey_conflict.sql` on staging when CLI login works. Until then the app Close path skips the broken trigger (blank phone for one save, then restore phone, then queue survey). |
| **Verify** | Open an in-progress enquiry with a phone → Status Closed → Update status. Badge becomes Closed. Simulator with that phone shows the feedback text. |

## Support: Complaints still show ENQ codes

| | |
|--|--|
| **Symptom** | Complaints tab codes look like `ENQ-00012`. Enquiry tab uses the same prefix. |
| **Root cause** | Staging trigger `set_enquiry_code` still stamps every row `ENQ-`. Prefix split migration was not on staging. |
| **Fix** | App now allocates `CS-` for complaints and `ENQ-` for enquiries on insert, and rewrites leftover complaint `ENQ-` rows to `CS-`. Also apply `20260819100000_enquiry_complaint_code_prefixes.sql` on staging `scvojtvgnkmbupvyslmb`. |
| **Verify** | File a Concerns ticket → confirmation `CS-#####`. File Customized → Enquiries → `ENQ-#####`. Complaints list uses CS. Enquiry list uses ENQ. |

## Support: WhatsApp simulator Done shows Cannot coerce JSON

| | |
|--|--|
| **Symptom** | After sending a photo and tapping **Done**, red text: `Cannot coerce the result to a single JSON object`. Ticket may exist without photos. |
| **Root cause** | App inserted the enquiry, then `UPDATE` attachments with `.single()`. Creator is not admin/assignee, so RLS returns 0 rows. PostgREST then fails coerce. |
| **Fix** | Photos upload first, then one insert with attachments (`createEnquiryWithPhotos`). Chat files on Done (no AM picker). Creator UPDATE policy `20260819120000_enquiries_creator_update.sql` for other attach paths. |
| **Verify** | Help with order → Customized → Concerns → Product issues → order ID → issue text → photo → Done. Confirmation with ticket code. Complaints lists the row with photo. No coerce error. |

## Support: delay alert section missing or send fails

| | |
|--|--|
| **Symptom** | Support → **Delay alert** has no send form, or Send says table not found. |
| **Root cause** | Card was not copied from Concierge at first. After the card landed, send needs staging table `support_delay_alerts` and nullable `enquiry_outbound_messages.enquiry_id`. Stale PostgREST cache also hides the table. |
| **Fix** | Hard refresh. Open Support → **Delay alert**. Apply `20260818180000_support_delay_alerts.sql` on **staging** `scvojtvgnkmbupvyslmb`, then `NOTIFY pgrst, 'reload schema';`. |
| **Verify** | Fill order + phone + new date → Send. Recent sent lists the order. WhatsApp simulator with that phone shows the apology text. |

## Support: production status WhatsApp not arriving

| | |
|--|--|
| **Symptom** | Production changes order status; simulator never gets a text. Support **Production status texts** empty or says skipped. |
| **Root cause** | Track Order was removed. Texts come from trigger `orders_queue_production_status_whatsapp`. Tracker orders have no phone. No matching enquiry/contact book/Ready Stock phone → skip. Migration not on staging. |
| **Fix** | Apply `20260819113000_production_status_whatsapp.sql` on staging. Put the customer phone on an enquiry with the same Order ID (or contact book / Ready Stock). Open simulator with that phone. Change Printing status. |
| **Verify** | On Support → **Order status**, card lists the order as queued. Simulator shows “Status is now: …”. Home menu has no Track Order. |

## Support: assign or status fails with ticket_kind does not exist

| | |
|--|--|
| **Symptom** | Assign user or update status on an enquiry: `column enquiries.ticket_kind does not exist`. |
| **Root cause** | App returns the row with `ticket_kind` after update. Staging table did not have that column until `20260819100000_enquiry_complaint_code_prefixes.sql`. List fetch had a fallback; assign/status did not. |
| **Fix** | Apply that migration on staging `scvojtvgnkmbupvyslmb`, then `NOTIFY pgrst, 'reload schema'`. Assign/status also retry without `ticket_kind` if the column is still missing. |
| **Verify** | Open Enquiry → assign a user. Change status. No `ticket_kind` error. |

## Support: Enquiry tab empty after WhatsApp Enquiries path

| | |
|--|--|
| **Symptom** | Simulator Customized → Enquiries saved a ticket but Enquiry tab is empty, or it still sits in Complaints with `ENQ-`. |
| **Root cause** | Before `ticket_kind`, that path was listed as a complaint. After the split, Enquiry tab only shows `ticket_kind=enquiry`. Missing `ticket_kind` column also blanks both lists. |
| **Fix** | Apply `20260819100000_enquiry_complaint_code_prefixes.sql` on staging, then `NOTIFY pgrst, 'reload schema'`. Hard refresh. Complaints codes become `CS-#####`. |
| **Verify** | Simulator: Home → Help with order → Customized → Enquiries → name → phone → skip or order ID → details. Confirmation shows `ENQ-#####`. Enquiry tab lists it. |

## Support Complaints: table empty after simulator ticket

| | |
|--|--|
| **Symptom** | Simulator filed a ticket but Complaints list is empty. |
| **Root cause** | Complaints only shows Help with order → Regular Order, or Help with order → Customized → Concerns. Track, Access, Delay, and Customized → Enquiries do not list here (Enquiries go to the Enquiry tab as `ENQ-`). |
| **Fix** | Use **Help with order → Regular Order** or **Help with order → Customized → Concerns**. Confirm Order ID was sent in chat. |
| **Verify** | Code starts with `CS-`. Order ID column filled; Concerns shows the customer message. |

## Enquiry: non-admin cannot assign

| | |
|--|--|
| **Symptom** | Assign picker missing, or error “Only an admin can assign enquiries”. |
| **Root cause** | Assign is admin-only. Simulator as non-admin creates **New** (unassigned) for admin. |
| **Fix** | Sign in as admin to assign. Staff use Mark verified / Contacted / Close on tickets already assigned to them. Admin opens the row → **Activity** to see staff work. |

## Enquiry: WhatsApp simulator does not create a ticket

| | |
|--|--|
| **Symptom** | Chat works but Enquiry table empty. |
| **Root cause** | Path was Track/Access/Delay (no ticket), or AM pick failed (no Gargi / no team names), or create RLS error. |
| **Fix** | Use **Help → Customized → Enquiries**, type 8+ chars, pick an AM. Keep **Test bypass** on if the order phone does not match. Need at least one active team profile. |
| **Verify** | Support → Complaints shows row with Order ID beside Customer, Concerns = the typed issue. |

## Enquiry: Concierge columns missing / create fails

| | |
|--|--|
| **Symptom** | Support → Complaints error about schema cache / missing column (`order_id`, `picked_at`, `attachments`). Create enquiry fails. |
| **Root cause** | Migration `20260818082754_enquiry_concierge_desk.sql` not on this Supabase project, or PostgREST schema cache stale. |
| **Fix** | Apply that migration on **staging** (`scvojtvgnkmbupvyslmb`). Then `NOTIFY pgrst, 'reload schema';`. Hard refresh the app. |
| **Verify** | New enquiry with Order ID + photo; detail shows Mark verified / Contacted / Close. |

## Enquiry: Close does not send automatic text

| | |
|--|--|
| **Symptom** | AM taps Close; customer (WhatsApp simulator) never gets “I hope your issue has been resolved…”. |
| **Root cause** | Close used to only set `status=closed`. Survey now queues in `enquiry_outbound_messages`. Simulator must stay open with the **same phone**. Empty phone skips send. Migration not on staging → no table/trigger. |
| **Fix** | Apply `20260818113000_enquiry_close_survey_message.sql` on **staging**. Open Enquiry → WhatsApp simulator with the ticket phone → AM Close. Hard refresh if schema cache stale (`NOTIFY pgrst, 'reload schema'`). |
| **Verify** | Detail shows **Customer message sent**. Simulator shows Feedback button. |
| **Note** | This dashboard does not send live Meta WhatsApp. Real phone SMS/WA stays in `Scott_concierge` unless an Edge Function is added later. |

| | |
|--|--|
| **Symptom** | Assigned ticket older than 2 hours, no red SLA banner. |
| **Root cause** | Ticket already has `picked_at`, or no profile named **Gargi** (fallback is first admin), or opener has no write RLS so persist is skipped. |
| **Fix** | Confirm status is still New/Assigned and Pending badge shows. Add a user whose `full_name` is Gargi. Open Enquiry as admin so the client SLA pass can write `enquiry_sla_escalations`. |
| **Note** | Missed-pick SLA still does not message the customer. Close **does** queue the Concierge feedback text for the ticket phone (simulator). Live WhatsApp Cloud API stays in `Scott_concierge`. |

Security findings (not runtime bugs): see [VULNERABILITIES.md](./VULNERABILITIES.md).

## Stock Ledger: drift alert banner / wrong stock number

- **Symptom:** red "Stock drift detected" banner on the Stock Ledger tab, or a balance that looks wrong.
- **Root cause candidates:** (1) someone wrote `inv_balance` directly with service role bypassing the functions — never do this; (2) a partially failed manual SQL session.
- **Investigation:** `select * from inv_drift_alert where resolved_at is null;` then rebuild the truth for that sku/location: `select sum(case when to_location_id = :loc then qty else -qty end) from inv_movement where sku_id = :sku and (to_location_id = :loc or from_location_id = :loc) and state = :state;`
- **Fix:** post a corrective `adjustment` movement with a note (never edit `inv_balance`), then set `resolved_at` on the alert. `inv_recompute_drift()` can be run ad hoc as postgres.
- **Note:** `inv_movement` UPDATE/DELETE always raises "append-only" — that is by design, not a bug.

## Platform Masters: "Masters tables not on this database yet"

- **Symptom:** Platform Masters tab shows the inline message naming migration `20260901180000_step0_masters_and_entities.sql`.
- **Root cause:** the environment the app points at (check `VITE_SUPABASE_URL`) does not have the Step 0 migration — applied on staging 2026-09-01; production gets it only on an explicit release.
- **Fix:** apply the migration to that environment (staging default), then Refresh.
- **Also check:** duplicate-name save errors are the DB unique indexes working (`crm_party_norm_name_idx`, `cat_sku` unique code) — not a bug; merge or rename instead.

## Goals: ownership column missing / create goal fails

| | |
|--|--|
| **Symptom** | Create goal or set ownership fails; PostgREST error about `ownership` column. |
| **Fix** | Apply migration `20260710140000_add_goal_ownership.sql` on the Supabase project (`supabase db push`). |

## Goals: Manage User Goals tab empty but user has goals

| | |
|--|--|
| **Symptom** | Admin picks user in **Manage User Goals** — shows “No goals” or empty grid, but user has goals in DB or **My goals**. |
| **Root cause** | Tab previously showed **active goals only** (`status !== completed`). Users whose goals are all marked complete looked empty; completed goals live in **Completed** tab globally, not per-user in manage view. |
| **Fix** | Manage tab now loads **all** goals for the selected user (active + completed) with tasks. Tab label is **Manage User Goals** (was “Manage users”). |
| **Verify** | Goals & Tasks → Manage User Goals → pick user with only completed goals → ownership cards and goal detail with tasks appear. |

## Password reset: user cannot set password after approval

| | |
|--|--|
| **Symptom** | Admin approved request but login still shows pending or “no approved request”. |
| **Root cause** | Edge functions not deployed, migration not applied, or approval expired (`approved_expires_at` past 7 days). |
| **Fix** | Run `supabase db push` + deploy all four password-reset edge functions on **the same Supabase project your app uses**. Local `npm run dev` uses **staging** (`.env.development` → `scvojtvgnkmbupvyslmb`); production Netlify uses `levwrmvqdntngeasrtnb`. Deploy to both if you test locally and on live site. After migrate, apply `20260710161000_reload_schema_password_reset.sql` or wait ~30s. Ensure `VITE_SUPABASE_ANON_KEY` has no space after `=`. Restart dev server after `.env` change. |
| **Admin-user requests** | Only `admin@scott.com` sees and can approve `routing = main_admin` rows in **Password resets** tab. |

## Order history modal not visible (View order)

| | |
|--|--|
| **Symptom** | Click **Order history** in View order — nothing appears, or modal hidden behind dialog. |
| **Root cause** | History modal rendered inside app shell; Radix View order `Dialog` portals to `document.body` at `z-50` and stacks above in-app fixed layers. Focus trap also blocked interaction. |
| **Fix (2026-07-10)** | `OrderHistoryModal` portaled to `document.body` (`z-index: 2000`); View order `Dialog` uses `modal={false}` while history open (same pattern as mockup preview). History button always shown in order detail footer (not gated on edit permissions). |
| **Empty list** | `No activity yet` = table exists but no rows for that job; trigger `log_order_activity()` only logs changes after migration — not backfilled. |
| **SQL check** | `SELECT event_type, message, created_at FROM order_activity_log WHERE order_id = <id> ORDER BY created_at DESC;` |

## Dashboard Stock API returns 401 UNAUTHORIZED

| | |
|--|--|
| **Symptom** | Scott backend gets `401` on all stock endpoints. |
| **Root cause** | Missing/wrong `DASHBOARD_API_KEY` secret on edge function, or caller not sending `Authorization: Bearer ...`. |
| **Fix** | Supabase Dashboard → Edge Functions → `dashboard-stock-api` → Secrets: set `DASHBOARD_API_KEY`. Redeploy function after secret change. Match exact Bearer value on client. |
| **Also check** | `503 API_NOT_CONFIGURED` means secret not set at all. |

## Dashboard Stock API snapshot shows 0 but UI shows on-hand stock

- **Symptom:** SKU has units on hand in the inventory UI, but `GET /stock/snapshot` returns 0 (often keyed `DEFAULT:<sku>`).
- **Root cause:** UI stock mutations write `inventory_skus.stock_qty` only; the API reads `inventory_facility_stock`, which drifted after its one-time backfill (migration `20260710120000`).
- **Fix:** apply `20260716140000_sync_sku_stock_to_facility.sql` — adds trigger `inventory_skus_sync_facility_stock` + one-time resync. If a specific SKU still mismatches, check whether it has multiple facility rows (resync skips multi-facility SKUs; correct manually).
- **Check:** `select s.sku_code, s.stock_qty, fs.facility_code, fs.on_hand_qty, fs.reserved_qty from inventory_skus s join inventory_facility_stock fs on fs.sku_id = s.id where s.sku_code = '<SKU>';`

## Dashboard Stock API snapshot empty for known SKUs

| | |
|--|--|
| **Symptom** | `200` with `{}` snapshot keys for SKUs that exist in dashboard. |
| **Root cause** | `inventory_skus.sku_code` mismatch vs external codes; or warehouse `facility_code` not set / wrong facility filter. |
| **Fix** | Align `sku_code` with external catalogue; set `inventory_warehouses.facility_code` (e.g. `SCOTT_1DAY_01`); re-run backfill or insert `inventory_facility_stock` rows. Migration `20260710120000_dashboard_stock_api.sql` backfills from existing SKU `stock_qty`. |

## Inventory list: Reserved column always 0 / Available equals On hand

- **Symptom:** SKUs with open Scott International reservations show Reserved 0 and Available = On hand.
- **Root cause:** `inventory_sku_availability` fetch failed (see console `Inventory availability load (falling back to stock_qty)`), usually because migration `20260716120000_facility_stock_read_access.sql` (read policies + view) is not applied on the connected project, or the user JWT is missing (anon has no policy).
- **Fix:** apply the migration (`npx supabase db push` on the linked project), confirm login session, hard refresh. Realtime updates also need `20260716130000_facility_stock_realtime.sql` (adds table to `supabase_realtime`).
- **Note:** the UI intentionally fails soft — a broken availability query must never blank the inventory page; it just falls back to `stock_qty`.

## Apparel SKU import preview shows [object Object]

| | |
|--|--|
| **Symptom** | Size, Brand, Color, Category columns show `[object Object]` in import preview; SKU column may look fine. |
| **Root cause** | Excel cells stored as rich text / formula objects; parser used `cell.value` + `String(obj)`. |
| **Fix (2026-07-30)** | Use `excelCellString()` (`cell.text` + rich-text/formula fallbacks) in `inventorySkuImportUtils.js`. |

## Order save fails: null value in column "owner_name"

| | |
|--|--|
| **Symptom** | Alert on Save after changing delivery date only; date not updated in list. |
| **Root cause** | Admin user save merged full admin field payload; empty `owner_name` became `null` but column is `NOT NULL`. |
| **Fix (2026-07-28)** | Admin fields only sent when admin draft was edited; required text fields fall back to existing row value. |

## Order API: order.status_changed webhook never arrives at Scott backend

- **Symptom:** Order transitions succeed (200 from `/api/v1/orders/:id/status` or DELETE) but Scott's receiver gets nothing.
- **Root cause:** delivery needs both `SCOTT_WEBHOOK_BASE_URL` and `SCOTT_WEBHOOK_SECRET` edge-function secrets; until set, the trigger still enqueues rows in `dashboard_webhook_outbox` with status `pending` (delivery drained on the next API call once secrets exist). Also check `last_error` on the outbox row — non-2xx from their server keeps it pending with `attempts` incremented.
- **Fix:** `npx supabase secrets set SCOTT_WEBHOOK_BASE_URL=... SCOTT_WEBHOOK_SECRET=...` (staging link), then any order/stock API call retries delivery. Verify with the admin header popover "Send test webhook".
- **Queries:** `select event_type, status, attempts, last_error from dashboard_webhook_outbox order by created_at desc limit 20;`

## Warehouse Edit: facility code changed but snapshot still uses old code

- **Symptom:** Admin renamed facility code on a warehouse, but `GET /stock/snapshot?facility=OLD` still returns data / new code returns empty.
- **Root cause:** migration `20260720150000_warehouse_edit_layout.sql` (propagate trigger) not applied on the connected project — only the warehouse row updated, facility stock still keyed by the old code.
- **Fix:** `npx supabase db push` on the linked project, then re-save the facility code (or run a one-off update of `inventory_facility_stock.facility_code`). Confirm trigger: `select tgname from pg_trigger where tgname = 'inventory_warehouses_propagate_facility_code';`
- **Note:** Stock/Order API shapes are unchanged — callers must use the **new** facility code after a rename.

## Generate Picklist fails or status stays PENDING

- **Symptom:** Click **Generate Picklist** → error, or picklist opens but order status still PENDING.
- **Root causes:**
  - Edge function `scott-order-generate-picklist` not deployed on the connected project → deploy hint in UI.
  - Migration `20260722120000_scott_order_picklist.sql` not applied → update fails on unknown columns.
  - **Picklist PDF API not running** — `[vite] http proxy error: /api/picklist/pdf` / `ECONNREFUSED` → nothing listening on port 3001. **`npm run dev` now starts Vite + picklist API together.** If you use `npm run dev:vite` only, also run `npm run dev:picklist-api` in a second terminal.
  - Pop-up blocked → PDF blob tab never opens (allow pop-ups for the dashboard origin).
  - Order is COMPLETE/CANCELLED/FAILED → function returns 409 (by design).
- **Fix:** `npx supabase link --project-ref scvojtvgnkmbupvyslmb && npx supabase db push && npx supabase functions deploy scott-order-generate-picklist`. Hard refresh, sign in again, retry.
- **Queries:** `select id, order_code, status, picklist_no, picklist_generated_at from scott_orders where order_code = 'P-TEST-005';`

## Inventory bulk Excel upload fails or SKUs skipped

- **Symptom:** Upload Excel shows all rows red / "SKU not found".
- **Root cause:** SKU Code in template must match existing `inventory_skus.sku_code` exactly (case-insensitive). Template example rows must be deleted before upload.
- **Fix:** Download fresh template, use real SKU codes from inventory export; ensure at least one of Stock Qty, DOC, or Storage Location is filled per row. Re-upload after creating missing SKUs via **Import SKUs** if needed.
- **Symptom:** File has 4000+ rows but preview/process shows ~1700.
- **Root cause:** Rows without Stock Qty, DOC, or Storage Location are ignored at parse; duplicate SKUs are merged (last row wins); preview **skipped** count excludes invalid SKUs (`SKU not found`, `No change`, etc.). Progress bar counts **valid** rows only.
- **Fix:** Use **Download skipped rows** CSV in preview to see every rejected SKU and reason. Fill **Stock Qty** column for rows that should change on-hand. Dedupe Excel or rely on merge (last row wins).
- **Symptom:** Stock unchanged but DOC updated — Stock Qty blank or already matches on-hand (delta 0). Preview shows amber warning when zero stock rows will apply.
- **Symptom:** Upload fails with RPC / function not found on `bulk_adjust_sku_facility_stock`.
- **Fix:** Apply migration `20260725180000_bulk_adjust_facility_stock.sql` on staging: `npx supabase link --project-ref scvojtvgnkmbupvyslmb && npx supabase db push`.
- **Symptom:** Stock applied but list still shows 0 at warehouse.
- **Fix:** Filter inventory list to the same warehouse; hard refresh (`Cmd+Shift+R`); confirm toast shows `N stock adjusted` not only DOC updated.

## Apparel SKU drawer: Stock by size 0 but On hand shows total

- **Symptom:** SKU detail shows **XXXL: 0** in the size grid but **On hand 200** and **Total 200 units** (e.g. after bulk warehouse upload).
- **Root cause:** SKU import sets `extra.sizes` to `{Size: 0}`; bulk upload only updated `stock_qty` and `inventory_facility_stock`, not `extra.sizes`.
- **Fix:** Apply migration `20260806110948_sync_apparel_sizes_with_stock.sql` (trigger + backfill). Hard refresh SKU drawer after deploy.
- **Check:** `select sku_code, stock_qty, extra->'sizes' as sizes, warehouse_id from inventory_skus where sku_code = '<SKU>';` — sizes sum should equal `stock_qty`.
- **External API:** Stock for partners is in `inventory_facility_stock` / `GET /stock/snapshot` keyed `FACILITY:SKU` — not `extra.sizes`. If API returns empty, verify `facility` param and exact `sku_code`.

## Stock API snapshot returns DEFAULT:SKU instead of SCOTT_1DAY_01:SKU

- **Symptom:** Postman shows `"DEFAULT:NF-BSHM-BL-S": 0` instead of `"SCOTT_1DAY_01:NF-BSHM-BL-S": 0`.
- **Root cause:** Early backfill (`20260710120000`) created `inventory_facility_stock` rows with `facility_code = DEFAULT` when SKUs had no `warehouse_id`. Bulk upload later wrote real facility rows but stale DEFAULT zeros remained.
- **Fix:** Apply `20260806120436_cleanup_default_facility_stock.sql` and redeploy `dashboard-stock-api`. Partners should pass `?facility=SCOTT_1DAY_01` on snapshot — zero stock SKUs then return explicit `0` at that facility.
- **Check:** `select sku_code, facility_code, on_hand_qty from inventory_sku_availability where sku_code = '<SKU>';` — expect mapped facility codes only, no `DEFAULT`.

## Ready Stock: no way to mark order dispatched after picklist

- **Symptom:** Picklist generates and status becomes PROCESSING, but no UI to move to COMPLETE / FAILED / CANCELLED for app sync.
- **Fix:** Ready Stock Order detail → **Update status (syncs to app)** → choose status → **Apply status**. Requires edge function `scott-order-update-status` deployed on the connected project.
- **Deploy:** `npx supabase link --project-ref scvojtvgnkmbupvyslmb && npx supabase functions deploy scott-order-update-status`
- **Statuses (exact strings for app):** `PENDING` → `PROCESSING` → `COMPLETE` | `FAILED` | `CANCELLED`. Webhook `order.status_changed` fires on each transition.

## Ready Stock Order tab empty though app orders exist

- **Symptom:** Orders created via the Order API return 201 but the Ready Stock Order tab shows "No app orders yet".
- **Root cause:** the connected Supabase project is missing migration `20260720120000_scott_orders.sql` (tables + authenticated SELECT policies) — or the browser is pointed at a different environment than the API calls (check the admin header env toggle). Live updates additionally need `20260720130000_scott_orders_realtime.sql`.
- **Fix:** `npx supabase db push` on the linked project, confirm the header env matches where the order was created, hard refresh.
- **Queries:** `select id, order_code, status, created_at from scott_orders order by created_at desc limit 10;`

## Order API: 409 ORDER_EXISTS on create

- **Symptom:** Creating an order returns `ORDER_EXISTS` though Scott's side thinks it's new.
- **Root cause:** partial unique index allows only one open (PENDING/PROCESSING/COMPLETE) `scott_orders` row per `order_code` — usually a retry of a create whose 201 response was lost.
- **Fix:** the 409 body includes the existing `dashboard_order_id` and status; Scott's backend should adopt that id instead of retrying. Re-use of an `order_code` is allowed after CANCELLED/FAILED.

## Order API: inventory multiplied on place / extra stock back on cancel

| | |
|--|--|
| **Symptom** | Available drops by 2× order qty on place; cancel restores more than expected, or ghost reserved qty remains. |
| **Root cause** | Partner called **both** `POST /api/v1/stock/reserve` and `POST /api/v1/orders` for the same `order_code`, or duplicate SKU lines in `items[]`. Cancel only released `scott_orders.reservation_id`, not orphan holds. |
| **Fix (2026-07-28)** | Deploy `dashboard-stock-api` with idempotent reserve + cancel releases all open holds. DB index `inventory_stock_reservations_one_open_per_order` on staging. Partner should use **order API only** (`POST /api/v1/orders` → cancel `DELETE /api/v1/orders/:id`). |
| **Queries** | `select id, order_code, status, facility_code from inventory_stock_reservations where order_code = '<code>' order by created_at;` — expect at most one `RESERVED` row per facility after fix. |

## Dashboard Stock API 409 on reserve under load

| | |
|--|--|
| **Symptom** | Two concurrent reserves for last units — both might pass check-then-act in edge function (race). |
| **Mitigation** | Serialize reserves per SKU/facility in caller; future: Postgres RPC with `SELECT FOR UPDATE` on `inventory_facility_stock`. |

## Printing order create: Colors swatch wrong after SKU pick

### Symptom
Product picker shows correct SKU label (e.g. `6D-BL-S · 6 DEGREE · BLACK`) but Colors field shows wrong swatch (gray, pink, or another variant).

### Root cause
1. Inventory `hex_color` default `#cccccc` or stale value was used before SKU color name / code.
2. Multiple inventory SKUs share the same `name`; picker re-matched by name only and could desync uuid vs colors.
3. Named colors (e.g. `BLACK`) in `orderForm.colors` did not get CSS `backgroundColor` unless stored as hex.

### Fix (2026-07-09)
- `colorsFromInventoryProduct()` in `inventoryProductPickerUtils.js` — color name → SKU segment (`BL` → black) → label → real hex.
- `PrintingOrderProductField` keeps selection by `_uuid` and re-syncs colors on SKU change.
- Create-order color dots use `swatchBackgroundForColor()`.

### Verify
Pick `6D-BL-S · 6 DEGREE · BLACK` → Colors dot is black (`#1a1a1a`). Change to another color variant of same product name → swatch updates to that SKU’s color.

## Sidebar activity dot on wrong tab (e.g. Home after order save)

### Symptom
User saves printing order; blue activity dot appears on **Home** (or Goals widget tab) instead of **Printing Orders**.

### Root cause
`SIDEBAR_ACTIVITY_TABLE_TABS` listed `home` alongside domain tabs for `orders` and goal tables.

### Fix (2026-07-09)
- Orders: dot only on tab for `order_kind` (`printing` → Printing Orders, `job_sheet` → Production tracker, `regular_stock` → Ready Stock Order).
- Goals: dot only on **Goals & Tasks**, not Home.

### Verify
Save order while on Home → dot on Printing Orders only. Open Printing Orders → dot clears.

## View order: mockup image vanishes while dialog open

### Symptom
View order shows mockup thumbnail, then it disappears (shows "No mockups") without closing the dialog — often after another user edits an order or realtime refresh fires.

### Root cause
`fetchOrders()` loads lightweight list rows without `approved_design_url`. On each refresh, `viewOrderTarget` was overwritten with that row and merge only preserved `approved_design_images`, not mockups.

### Fix (2026-07-09)
- `mergeOrderDetailAssets()` preserves `approved_design_url` and related detail fields when list refetch omits them.
- View order target syncs from merged orders array after refresh.
- `openViewOrder()` always calls `hydrateOrderDetail()` for full row.

### Verify
Open order with mockups, wait for live refresh or save status from another tab — mockups stay visible.

### Also: mockups vanish after uploading approved design images
- **Cause:** Image-upload patch merge replaced the open order row without preserving `approved_design_url`.
- **Fix:** Re-merge detail assets after patch; include mockup URL in patch ref; hydrate full row after upload.

## Netlify production deploy: "Exposed secrets detected" (build exit code 2)

### Symptom
Production deploy on `main` fails. Deploy log shows **Exposed secrets detected** and `Build script returned non-zero exit code: 2`. GitHub Actions promote may still succeed (DB + functions only).

### Root cause
Netlify **secret scanning** (Secrets Controller / smart detection) blocks publish when it finds API keys or JWTs in:

1. **Tracked `.env`** — Supabase anon key committed in git (even though `.gitignore` lists `.env`, an already-tracked file stays in the repo).
2. **Tracked `dist/`** — a local `npm run build` inlines `VITE_*` values into `dist/assets/*.js`; committing `dist/` puts the anon JWT in git.
3. **Netlify env marked "Contains secret values"** — Vite always embeds `VITE_SUPABASE_ANON_KEY` / `VITE_GIPHY_API_KEY` in the browser bundle; marking them as secrets makes the post-build scan fail every time.

### Fix
1. **Repo:** stop tracking secrets and build output:
   ```bash
   git rm --cached .env
   git rm -r --cached dist/
   ```
   Ensure `.gitignore` includes `.env` and `dist/`. Commit and push to `main`.
2. **Netlify → Environment variables:** set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GIPHY_API_KEY` as normal variables — **do not** enable **Contains secret values** (Supabase anon + Giphy client keys are public in the browser by design).
3. **Redeploy:** Netlify → Deploys → **Trigger deploy** on `main` (or push a fix commit).
4. **If still blocked** (smart detection false positive on Supabase JWT in build output): add site env `SECRETS_SCAN_SMART_DETECTION_ENABLED` = `false` (lowercase). Prefer fixing tracked files first.

### Verify
Deploy log reaches **Deploy site** / **Published** with no secret scan failure. Live app loads; Network tab Supabase requests use production host.

## View order mockup preview appears behind dialog

### Symptom
Printing order **View order** open → click mockup thumbnail → preview card hidden behind order dialog.

### Root cause
Image preview was a fixed overlay inside the React app tree. Radix **Dialog** (View order) portals to `document.body` with `z-50`, which stacks above non-portaled overlays even when CSS `z-index` is higher inside the app shell.

### Root cause
1. Radix **View order** `Dialog` runs in **modal** mode — disables pointer events on everything outside the dialog, including the portaled preview. Close button clicks never reach the handler.
2. Earlier close control sat under the image in the paint order.

### Fix
- Preview: toolbar **Close** only; instruction text removed; no backdrop/Esc dismiss.
- `App.jsx`: `modal={previewImages.length === 0}` on View order Dialog while preview open; block Esc/outside dismiss on dialog when preview showing.
- CSS: `pointer-events: auto` on preview stack.

### Verify
Open View order → mockup → click **Close** → preview gone, View order still open.

## Order status not updating for other users

### Symptom
User A changes order status; User B still sees old status (list or View order) until hard refresh or ~60s poll.

### Root cause
`App.jsx` subscribes to `postgres_changes` on `public.orders`, but **`orders` was not in the `supabase_realtime` publication**. Realtime events never fired; only the 60s visibility poll refreshed data.

### Fix
1. Apply migration `20260709190000_orders_realtime.sql` on Supabase (adds `orders` and `order_customer_assets` to realtime).
2. Client: `fetchOrders({ silent: true })` on subscription + refresh `viewOrderTarget` when refetch completes.

### Verify
Two browsers logged in → change status on one → other updates within ~1–2s without refresh.

### Logs / checks
Browser console: Supabase Realtime channel `orders-live` subscribed. Supabase Dashboard → Database → Publications → `supabase_realtime` includes `orders`.

## Supabase `db push`: remote migration versions not found locally

### Symptom
`supabase db push` fails: **Remote migration versions not found in local migrations directory** — lists timestamps like `20260703045936`.

### Root cause
Someone applied SQL on remote (Dashboard / another machine) without committing matching files under `supabase/migrations/`. Remote history has versions the repo does not.

### Fix
1. Compare histories:
   ```bash
   supabase migration list
   ```
2. Mark orphan **remote-only** versions reverted (does not undo schema already applied):
   ```bash
   supabase migration repair --status reverted 20260703045936 20260703102945 20260703104937
   ```
3. Push pending local files (including out-of-order ones):
   ```bash
   supabase db push --include-all
   ```
4. If push fails on `No valid role for order update` during a migration **UPDATE** on `orders`, that migration must disable `trg_enforce_order_update_scope` during the backfill (see `20260528150000_update_payment_methods.sql`).

### Verify
`supabase migration list` — Local and Remote columns match for all rows. Realtime publication includes `orders` after `20260709190000_orders_realtime.sql`.

## Customer assets fail to view or download

### Symptom
View order → **Customer assets** / **Uploaded assets** → Download or open fails (403/blank) for some files.

### Root cause
UI used `storage.getPublicUrl()`. Storage RLS on `order-customer-assets` allows **authenticated** reads only; anonymous public URLs fail unless bucket/object is fully public.

### Fix
`fetchOrderCustomerAssetsWithUrls()` uses `createSignedUrl` (1 hour). View button for images/PDFs; Download uses signed URL with filename.

### Edge cases
- Files older than **48 hours** are purged by cron — row may remain briefly; signed URL returns not found.
- Non-preview types: Download only.

### Verify
Upload PDF + PNG on create job → View order → View/Download both work while logged in.

## Production blank screen: Missing Supabase env vars

### Symptom
Live site white/blank. Console: `Uncaught Error: Missing Supabase env vars. Check .env configuration.` (`src/supabaseClient.js`).

### Root cause
Vite bakes `VITE_*` into the bundle **at build time**. After `.env` was removed from git, Netlify builds no longer get `VITE_SUPABASE_ANON_KEY` unless you set it in **Netlify → Environment variables**. Local `.env` does not affect production deploys.

### Fix
1. **Netlify → Site configuration → Environment variables → Add a variable**
2. Set for **Production** scope (or **All** if you use one context):

   | Key | Value |
   |-----|--------|
   | `VITE_SUPABASE_ANON_KEY` | Production anon/publishable key from [Supabase → Project Settings → API](https://supabase.com/dashboard/project/levwrmvqdntngeasrtnb/settings/api) |
   | `VITE_GIPHY_API_KEY` | *(optional)* Giphy key for chat GIF search |

   `VITE_SUPABASE_URL` is set in `netlify.toml` for production; you can mirror it in the UI if needed.

3. **Do not** enable **Contains secret values** on `VITE_*` vars (breaks Netlify secret scan on Vite output).
4. **Deploys → Trigger deploy → Clear cache and deploy site** on `main`.

### Verify
Hard refresh production URL. Console has no Supabase env error. Network requests go to `levwrmvqdntngeasrtnb.supabase.co`.

## Notifications: goal task or order status missing

### Symptom
Bell shows order assignments but not task assignments or order status changes.

### Root cause
Migration `20260707130000_add_goal_task_and_order_status_notifications.sql` not applied — tables `user_goal_task_notifications` / `order_status_notifications` missing. Console may warn `Could not find the table`.

### Fix
Run migration on linked project: `npx supabase db query --linked -f supabase/migrations/20260707130000_add_goal_task_and_order_status_notifications.sql` then `npx supabase migration repair --status applied 20260707130000`.

### Order status not notifying coordinator
Coordinator name on order must match `profiles.full_name` (case-insensitive trim). User who changed status is excluded from recipients.

**Verifier:** Task → `assigned_by` (assigner); goal → `user_id` (owner). Stored in `admin_verified_at` / `admin_verified_by` (any verifier, not admin-only).

## Goal tracker: checkbox complete fails

### Symptom
Checking complete errors or item does not move to **Completed** tab.

### Root cause
Migration `20260707140000_goal_task_completion_verification.sql` not applied — missing `completed_at` / `admin_verified_*` columns.

### Fix
Run migration on linked project, then `npx supabase migration repair --status applied 20260707140000`.

## Goal tracker: infinite recursion in RLS policy

### Symptom
Home or Goals panel shows: `infinite recursion detected in policy for relation "user_annual_goals"`.

### Root cause
Initial goal tracker RLS used cross-table `EXISTS` subqueries: `user_annual_goals` select checked `user_goal_tasks`, and tasks select checked `user_annual_goals` — circular policy evaluation.

### Fix
Migration `20260706190000_fix_goal_tracker_rls_recursion.sql` adds `security definer` helpers (`jwt_goal_has_task_for_user`, `jwt_user_owns_goal`, `jwt_user_can_read_goal_task`) and rewrites policies to call them instead of nested table subqueries.

## Goals: Assign task — Link to goal empty for assignee

**Symptom:** Pick user in **Assign to** (e.g. Test 2) — **Link to goal** only shows **No goal**, even though admin created goals for that user.

**Root cause:** `user_annual_goals` SELECT RLS hides other users' goals unless you are admin or already have a task on that goal. Direct `fetchGoalsForUser(assigneeId)` returns empty for non-admin assigners.

**Fix:** Migration `20260709120000_goal_assign_link_visibility.sql` — use `fetchGoalsForTaskAssignment()` → RPC `get_goals_for_task_assignment`. Migration `20260709130000_fix_goal_task_insert_rls.sql` — task INSERT uses `jwt_user_owns_goal(goal_id, assignee_id)` so goal ownership check bypasses goal SELECT RLS.

**Verify:** Staging query — `select title, user_id from user_annual_goals g join profiles p on p.id = g.user_id where p.full_name = 'Test 2';` then open Assign task, pick Test 2, confirm goal appears.

## Chat: empty inbox or conversation_id errors

### Symptom
Chat tab shows errors, empty inbox, or cannot send messages.

### Root cause
Migration `20260709180000_team_chat_conversations.sql` not applied — missing conversation tables, `conversation_id` column, or RPCs.

### Fix
Run on linked project:
`npx supabase db query --linked -f supabase/migrations/20260709180000_team_chat_conversations.sql`
then `npx supabase migration repair --status applied 20260709180000`.

### Verify
After migration, all users should be in **General** group; **New chat** opens a direct thread.

### GIF search empty
**Quick GIFs** tab always works (preset CDN URLs).

**Search tab empty — check:**
1. `VITE_GIPHY_API_KEY` set in `.env` (get key from [Giphy Developers](https://developers.giphy.com/dashboard/)).
2. Restart dev server after `.env` change (`npm run dev`).
3. Beta keys limited to 100 requests/hour — 429 means rate limit; wait or upgrade key.

**Verify key:**
```bash
curl "https://api.giphy.com/v1/gifs/search?api_key=YOUR_KEY&q=dog&limit=1&rating=pg"
```

## Job sheet appears in Printing orders list

### Symptom
Job sheet shows in **Printing orders** with printing columns/format; should only be in **Production tracker**.

### Root cause
Job sheet saved with default `order_kind = printing`. Printing tab did not exclude production tracker job sheets.

### Fix
Apply `20260703200000_add_order_kind_job_sheet.sql` (sets `order_kind = job_sheet` on save + backfill). Reload app — job sheets only in Production tracker.

## Job sheet history empty or only generic events

### Symptom
**Job sheet history** modal opens but shows no entries for old job sheets, or only status/qty changes — not payment, gender, size type, etc.

### Root cause
History reads `order_activity_log`. Job-sheet-specific events are written by `log_order_activity()` only after migration `20260703190000_job_sheet_activity_log.sql` is applied. Events are not backfilled for past edits.

### Investigation
1. Open job sheet → **Job sheet history**.
2. Supabase: `SELECT event_type, message, created_at FROM order_activity_log WHERE order_id = <id> ORDER BY created_at DESC;`
3. Check migrations: `list_migrations` or `supabase migration list` for `job_sheet_activity_log`.

### Fix
Apply `20260703190000_job_sheet_activity_log.sql` on the linked project. Edit and save a job sheet field to confirm a new row appears (e.g. `job_sheet_payment_updated`).

## Orders table empty after save (loading skeleton, then no rows)

### Symptom
After saving a job or job sheet, a brief loading row appears, then the orders table is empty. Browser console may show `column orders.gender does not exist` (or another missing column). Data may still exist in Supabase SQL editor.

### Root cause
`fetchOrders` in `App.jsx` selects columns that are not yet on the linked Supabase project. Postgres rejects the whole query; the UI only logged the error and left `orders` empty. Optimistic “pending” rows are removed in `finally` after save, so the new job vanishes too.

### Investigation
1. Browser DevTools → Console — look for Supabase/PostgREST errors on `orders` select.
2. Supabase SQL editor: `SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('gender','product_type');`
3. Compare with `fetchOrders` select list in `src/App.jsx` and files under `supabase/migrations/`.

### Fix
Apply the missing migration on the project your `.env` points to (e.g. `20260709120000_add_job_sheet_gender_product_type.sql` for `gender` / `product_type`). Reload the app.

### Example (2026-07-03)
- **Cause:** Migration existed in repo but was not applied to production (`levwrmvqdntngeasrtnb`) or staging (`scvojtvgnkmbupvyslmb`).
- **Fix:** Applied `add_job_sheet_gender_product_type` via Supabase MCP on both projects. Added `ordersLoadError` banner in `App.jsx` when fetch fails.

### Prevention
Run `npm run check:env` before DB work. List fetch omits design URL blobs — if detail panel images empty briefly, wait for detail hydration or hard refresh.

## Dashboard slow after login

### Symptom
Long skeleton on Printing / orders tabs; app feels sluggish right after sign-in.

### Root cause
- `fetchOrders` pulled all rows with heavy columns (`approved_design_url`, `approved_design_images`, archives) for every order.
- `loadGlobalSearchExtras` ran immediately (hundreds of challan rows + contacts).
- Background poll every 25s duplicated realtime subscriptions.

### Fix (2026-07-03)
- List fetch uses `ORDERS_LIST_SELECT`; full assets load on **View order** only.
- Search extras deferred 2.5s after login.
- Poll every 120s when tab visible only (orders fallback after Realtime).

### Investigation
Network tab → `orders` request payload size before/after. Console for slow Supabase errors.

## Dashboard data stale until manual refresh

### Symptom
User A changes order, challan, goal, inventory, contact, etc.; User B sees old data until browser refresh.

### Root cause
Table not in `supabase_realtime` publication and/or panel only fetched on mount with no `postgres_changes` subscription.

### Fix
1. Apply migrations through `20260709200000_dashboard_realtime_publication.sql`.
2. Client uses `subscribePostgresChanges` per panel (see `src/realtimeUtils.js`).
3. Verify Supabase Dashboard → Database → Publications → `supabase_realtime` lists the table.

### Verify
Two browsers → change data on one → other updates within ~1–2s on the relevant tab without refresh.

### Investigation
Browser DevTools → Network → WS filter → confirm Realtime socket connected. Console: channel names like `orders-live`, `dispatch-live-*`, `goals-live-*`.

## Blank screen after deploy / HMR

### Symptom
App white/blank; console `ImagePreviewModal is not defined` (or similar ReferenceError in `App.jsx`).

### Root cause
`ImagePreviewModal` import removed from `App.jsx` while component still rendered at bottom of tree — React throws on first render.

### Fix
Ensure `App.jsx` includes:
`import ImagePreviewModal from "./components/ImagePreviewModal";`

Hard refresh after fix (`Cmd+Shift+R`).

## Inventory tab slow to open

### Symptom
Inventory shows skeleton a long time before overview or SKU tables appear.

### Root cause
- All SKU pages fetched sequentially before UI (3000+ rows).
- Stock movements (100 rows + joins) loaded on every inventory open.
- SKU drawer waited on global movement list.

### Fix (2026-07-03)
- First **1000 SKUs** load for fast paint; rest load in background.
- Movements deferred until Movements tab or after 2.5s.
- Opening a SKU fetches full row + recent movements for that SKU only.

## Blank white screen on load

### Symptom
Browser shows empty white page. Dev server may still run. Console often has `ReferenceError: X is not defined`.

### Root cause
React crashes during initial render — usually a JSX component used without import, or a syntax error in a root file (`App.jsx`, `main.jsx`).

### Investigation
1. Open browser DevTools → Console. Note the first red error and file/line.
2. Check dev terminal for Vite/Babel JSX parse errors.
3. In the reported file, confirm every `<PascalCase>` tag has an import.
4. Run `npm run build` — some runtime issues still compile.

### Fix
Restore missing import or fix JSX structure. Hard refresh (`Cmd+Shift+R`).

### Example (2026-07-03 — formatJobSheetMoneyDisplay missing import)
- **Symptom:** View order in Production tracker → blank screen; console: `ReferenceError: formatJobSheetMoneyDisplay is not defined` at `OrderDetailPanel.jsx`.
- **Fix:** Restore `import { formatJobSheetMoneyDisplay } from "./jobSheetPaymentUtils";` in `OrderDetailPanel.jsx`.

### Example (2026-07-03 — duplicate hooks + Select crash)
- **Symptom:** View order on production job sheet → blank screen.
- **Cause 1:** Duplicate `useState` / `useEffect` left in `OrderDetailPanel.jsx` after a partial edit — React hooks count changed between renders → crash.
- **Cause 2:** `JobSheetOrderPaymentSection` passed `value={undefined}` to shadcn `Select` when payment mode or delivery city was empty — controlled/uncontrolled Select crash.
- **Fix:** Remove duplicate hooks; use sentinel `__none__` Select values; ensure status dropdown options always include the order’s current status.
- **Verify:** `npm run check:ui` then hard refresh and open View order on a job sheet.

### Example (2026-07-03 — jobSheet before init)
- **Cause:** `OrderDetailPanel` used `jobSheet` in `showJobSheetPaymentProof` before `const jobSheet = isJobSheetOrder(order)` — `ReferenceError: Cannot access 'jobSheet' before initialization`. View order in Production tracker crashed entire app.
- **Fix:** Declare `jobSheet` before any use. Run `npm run check:ui` before finishing.

### Example (2026-06-25)
- **Cause:** `CreateOrderModal` import removed from `App.jsx` while adding shadcn `Dialog` for View Order.
- **Fix:** `import CreateOrderModal from "./components/orders/CreateOrderModal";`

### Prevention (required before finishing UI work)

Run **`npm run check:ui`** (build + JSX import scan). See `.cursor/rules/blank-screen-gate.mdc` and `.cursor/rules/shadcn-ui-only.mdc`.
