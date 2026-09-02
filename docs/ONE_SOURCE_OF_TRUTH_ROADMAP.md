# One Source of Truth — Build Roadmap for the Scott Ops Platform

> Captured 1 Sep 2026. This is the canonical build plan. Binding laws are in
> [`laws.md`](./laws.md) and enforced via `.cursor/rules/single-source-of-truth.mdc`.
>
> **Scott API section is frozen** — do not modify `src/scott/**`, the `scott_customers` /
> `scott_reports` / `scott_masters` tabs, `scott-*` edge functions, or the existing
> inventory-fetch integration. See the guard in `laws.md`.

*What to replicate from Uniware, what to leave in Uniware, and the order to build it in. Written for the in-house developer working in Cursor and for the module owners who will switch the spreadsheets off.*

Status as of 1 Sep 2026: live on Uniware · 50–300 own-shipped orders/day · distributors buy stock outright (sold-in) · one in-house developer + Cursor · existing platform is React 18 + Vite + TypeScript + Supabase with printing orders, billing, dispatch, GRN/barcode putaway, roles, and the enquiry module in build.

---

## 0. The answer in ten lines

1. Do not switch Uniware off. It stays the ecom fulfilment engine — channel orders, labels, manifests, marketplace inventory push — until Step 10 says otherwise.
2. The platform becomes the system of record for everything Uniware does badly or not at all: masters, B2B orders and job work, stock outside the ecom facility, billing and receivables, distributors, costing, people, and all reporting.
3. Reporting is one place because the platform also holds a read-only mirror of Uniware. Nobody opens two systems to answer "what do we have and what sold yesterday".
4. The rule that prevents oversells: every stock location has exactly one owner. Uniware owns on-hand stock in the ecom facility; the platform owns every other location. Stock crosses that line only through a transfer document that calls Uniware's inventory API.
5. Build order: masters → stock ledger → inbound → B2B orders and dispatch → billing and receivables → Uniware bridge → distributor portal → costing → people → reports → (later) ecom.
6. Each step kills one spreadsheet. The platform is the source of truth for a thing only when the sheet that used to hold it is switched off.
7. Steps 0–4 (masters through billing) are about 5 months of one developer's time. Everything through Step 9 is 9–12 months. These are estimates and assume the developer is not also firefighting.
8. Half of Step 0 is not code. It is cleaning the customer and SKU lists. Give that to an ops owner now.
9. Stock and money live in database functions with locks and tests, never in client code. This is the one place where "Cursor wrote it, it looks fine" is not good enough.
10. Every step below has a Done-when and a Kills line. If a step's sheet is still being filled a month after go-live, the step is not done.

---

## 1. Nine rules of the single source of truth

Write these into the repo (`docs/laws.md`) and into the Cursor rules file. The developer applies them to every migration.

1. **One master per entity.** Customers, vendors, SKUs, locations, employees, GST entities. Transactions reference master IDs. No free-text names on any transaction — the typo-split owners and duplicate customers in the receivables register are what free text produces.
2. **Stock is a ledger, not a number.** Nobody edits a quantity. Every change is an append-only movement with a reason and a reference document. On-hand is a sum.
3. **Money is a document.** Invoice, credit note, receipt, bill. Never a cell. Every rupee on a report traces to a document ID.
4. **Every document has a state machine and an audit row.** Status transitions are enforced in the database; every transition writes who, when, from, to.
5. **One owner per location.** A location is owned by the platform or by Uniware, never both. Cross-boundary moves are explicit transfer documents.
6. **Sheets export from the platform, never into it** (after cutover). Google Sheets survive as read-only mirrors for people who want them. Not as inputs.
7. **Tally is the statutory ledger.** The platform posts vouchers to it. Nobody types the same invoice twice. A daily reconciliation screen shows platform vs Tally.
8. **Every report is a SQL view over the same tables.** One definition of "sales", "outstanding", "stock", "on-time" — written once, in a metric dictionary, with an owner.
9. **Access is enforced in the database (RLS), not in the UI.** A sales rep, a distributor, an HR user each see only their rows even if they call the API directly.

**Any future module — the six questions.** Before anything new is added (a loyalty scheme, a sampling tracker, a vendor scorecard, whatever comes next): Which master does it reference or create? Are its quantities movements? Is its money a document? What is its state machine? Which view reports it? Which role sees it? A module that cannot answer all six is not ready to be built, and Cursor should be told so in the rules file.

---

## 2. Uniware → platform map

| Uniware capability | What you do with it | Step | Sheet or tool it retires |
|---|---|---|---|
| Facilities, shelves | Replicate as a Location master: warehouses, zones, bins, plus virtual locations (QC hold, damaged, in-transit, job worker, Amazon FC, distributor, Uniware facility) | 0 | — |
| Item types / catalog | Replicate as Style → Colour → Size item master, kits/packs, channel listing map (ASIN, FSN, seller SKU). Platform is the origin; pushed to Uniware | 0 | SKU lists in stock sheet |
| Inventory (good / bad / QC-rejected / virtual, snapshots, adjustments) | Replicate as an append-only ledger for platform-owned locations; read-only mirror of the Uniware facility | 1 | Stock maintenance sheet |
| Vendors, POs, GRN | Replicate in full: PO lifecycle with computed balances, Active-PO tracking, receipt straight into stock (QC gate by policy), three-way bill match, vendor ledger, payables ageing, vendor performance; extended to fabric, trims and packaging | 2 | LR register, GRN Word files, payables sheet, PO follow-up in WhatsApp/Excel |
| Sale orders, picklists, packing, dispatch | Replicate for B2B, counter, distributor and enquiry-won orders. Ecom orders stay in Uniware, mirrored | 3, 5 | SALES_MASTER, Job Sheet, counter register |
| Invoices, credit notes, GST | Replicate for B2B. Ecom invoices stay in Uniware. Both post to Tally | 4 | Receivables register, quotation docs |
| Shipping providers, labels, manifests | Do not replicate. Uniware keeps ecom shipping. B2B dispatch records transporter, LR, e-way bill | 3 | — |
| Marketplace / cart connectors | Do not replicate. Bridge read-only via Uniware API | 5 | Manual Uniware exports |
| Returns (customer return, RTO) | Ecom returns stay in Uniware, mirrored. B2B returns in platform with credit notes | 4, 5 | Returns tab in stock sheet |
| Payment reconciliation (UniReco) | Later: settlement import per channel | 10 | Payments_Received tab |
| Reports and dashboards | Replicate as SQL views + a targets table + a metric dictionary | 9 | Target trackers, WBR/MBR/QBR input sheets |
| Seller / vendor panel | Replace with a distributor portal built for the sold-in model | 6 | Distributor reporting sheets |
| *Not in Uniware:* costing and consumption, people, enquiry SLA, production SLA, distributor incentives | Platform-only modules | 3, 4, 6, 7, 8 | Costing Excel, punch-report processing, goal sheets |

**External connections and who owns the data on each**

| Connection | Direction | Step | Truth lives in |
|---|---|---|---|
| Uniware — item master | platform → Uniware | 0 | Platform |
| Uniware — inventory snapshot | Uniware → platform (mirror) | 1 | Uniware, for its facility |
| Uniware — transfers in/out | platform → Uniware (`inventory/adjust`) | 5 | Platform document; Uniware on-hand |
| Uniware — sale orders, shipments, invoices, returns | Uniware → platform (mirror) | 5 | Uniware |
| Tally Prime — vouchers | platform → Tally (daily XML) | 4 | Platform originates; Tally is the statutory ledger |
| GSP — e-invoice IRN, e-way bill | platform ↔ GSP | 4 | Platform |
| WhatsApp Cloud API | both (enquiry module; distributor nudges) | enquiry, 6 | Platform |
| Biometric punch export | device → platform | 8 | Platform |
| Amazon SP-API reports, Noon/Walmart exports | marketplace → platform (mirror) | 10a | Marketplace |
| Distributor declarations | distributor → platform (portal or template) | 6 | Distributor; platform holds the declared figure with a confidence flag |

---

## 3. The steps

Each step: what it is for · what gets built · rules that live in the database · done-when · kills · effort (est.).
Table prefixes: `core_`, `cat_`, `crm_`, `inv_`, `po_`, `so_`, `jw_`, `bill_`, `ar_`, `ap_`, `uni_`, `dist_`, `cost_`, `prod_`, `hr_`, `rpt_`. Same stack rules as the enquiry-platform prompt: Edge Functions for server logic, TanStack Query/Table, Recharts, date-fns, UTC storage, Asia/Kolkata display, TypeScript strict, generated DB types.

### Step 0 — Masters and entities (weeks 1–3)

**For:** ending the situation where the same customer, SKU or person exists under three spellings in four files.

**Build**
- `core_entity` — legal entities and every seller GSTIN (you have 15). Every document carries `entity_id` and `gstin_id`. Sequences (`core_sequence`) per entity × document type × financial year: invoice numbers must be consecutive and unique per GSTIN per FY; quotations keep the `SFIPL/QTN/2026-27/###` pattern.
- `core_location` — `kind`: warehouse | zone | bin | virtual; `virtual_kind`: qc_hold | damaged | in_transit | job_worker | amazon_fc | distributor | uniware_facility; `owner_system`: platform | uniware | external (Amazon FCs and sold-in distributor stock are external — the platform records what it sent, never what is "on hand" there; on-hand comes from a mirror). Makali and Guttahalli with their zones and bins; one location per job worker, per Amazon FC, per distributor.
- `cat_style` → `cat_colour` → `cat_sku` (one row per size). SKU code, barcode/EAN, HSN, GST slab reference (rate by price band stored as data, with effective dates — not in code), brand (Scott, AWG, Zenshark, Cutiepaw, Holydrip, Not Funny, Giordano, UCB), category, weight, standard cost (filled in Step 7). `cat_kit` — pack-of-2 and other combos as kit SKU → component SKUs × qty. `cat_channel_listing` — SKU ↔ channel + ASIN/FSN/seller-SKU + entity.
- `crm_party` — `kind`: customer | vendor | job_worker | transporter | principal; segment (same enum as the enquiry module); owner (the "credit given by" person); credit days; credit limit; price list; GSTINs; PAN; addresses; `parent_id` for branches (BDO RISE's six branch rows become one parent with six children); `merged_into_id` for de-duplication. Vendor-side fields: MSME/Udyam number and category, lead-time days, payment terms, default QC requirement, bank details (masked, accounts role only). `crm_vendor_item` for vendor × item rates, MOQ, lead time and QC-exempt flag (detail in Step 2). `crm_contact` per person at the party.
- `hr_employee` — linked to `auth.users`; department, tier (the six-tier ladder), manager, in-time, status.
- Uniware alignment: item types created or updated in Uniware from the platform master via its Create-or-Update Item API, so SKU codes are identical on both sides. Import Uniware's current item export first and reconcile; zero unmapped SKUs before Step 1 goes live. Existing SKU codes — including the ones the app's current inventory-fetch integration maps on — are inherited as they are, never renamed; new codes are only for new items.

**Rules in the database:** unique normalized names; merges keep history; no transaction table has a text name column for a party or SKU.

**Ops work (not code):** one owner, two weeks: clean the customer list from the receivables register, SALES_MASTER, Tally ledgers and Uniware; clean the SKU list from the stock sheet and Uniware. Import via CSV with a dedupe report.

**Done when:** every screen picks from masters; Tally ledger names map 1:1 to `crm_party`; Uniware and platform SKU lists match.
**Kills:** the scattered customer and SKU lists (nothing visible yet — this is foundation).
**Effort:** 3 weeks dev, of which the developer is idle-ish for one while ops cleans data — use that week to set up staging, backups and RLS (Section 4).

### Step 1 — Stock ledger (weeks 3–7)

**For:** one true stock number per SKU per location, in real time, from scans.

**Build**
- `inv_movement` — append-only: sku, from_location, to_location, qty, `state` (good | qc_hold | damaged), `reason` (grn, qc_pass, qc_fail, putaway, transfer, pick, dispatch, return_in, adjustment, kit_build, kit_break, consumption, production_out, cycle_count), `ref_type` + `ref_id`, optional lot/batch, actor, timestamp. Inserts only. Corrections are reversing movements with a reason.
- `inv_balance` (sku × location × state) maintained by trigger. Nightly job recomputes from movements and raises an alert on any drift.
- `inv_reservation` — order line → qty at a location. `inv_allocate(order_id)` is a SQL function using `SELECT … FOR UPDATE`. Allocation never happens in client code. Releases on cancel or expiry.
- `inv_count` — cycle-count sessions: expected vs counted, variance approval, then adjustment movements.
- Kit build and break as paired movements sharing one reference (this is the SKU_Transfers ledger from the stock sheet, made permanent).
- Extend the existing GRN/barcode putaway module to write `inv_movement` rows instead of its own quantities; backfill history.
- Uniware inventory mirror, read-only: hourly pull of the Uniware inventory snapshot into `uni_inventory_mirror` (facility, SKU, good/bad/QC, timestamp). Shown beside platform stock, never summed into it. This is the first thing that makes the dashboard "one place" for stock.
- Screens: stock by location; style × colour × size matrix; stock cover in weeks (8-week sales rate); movement history per SKU; count session; mirror panel with "synced N min ago".

**Rules in the database:** balance ≥ 0 per state enforced in the allocation and movement functions; every movement has a reference document; adjustment movements need a reason and a role.

**Ops work:** barcode labels on every carton and pack in both warehouses; scanners on the floor; a rule that nothing moves without a scan.

**Done when:** stock maintenance sheet retired; every stock figure in the app is a sum over `inv_movement`; nightly drift is zero for two straight weeks.
**Kills:** stock maintenance sheet — Stock_Summary, SKU_Transfers and the own-warehouse side of Returns. FC_Transfers become transfer documents from platform stock to `amazon_fc` external locations; what Amazon actually holds is reconciled against the FBA inventory report in Step 10a.
**Effort:** 4 weeks.

### Step 2 — Procurement: PO → receipt → QC → stock → bill → payment (weeks 6–10)

**For:** every purchase known from the day it is ordered to the day it is paid; stock that appears in inventory the moment it is received; a PO balance nobody has to compute; a vendor page that holds everything about the vendor.

**Build — purchase orders**
- `po_purchase_order` — PO number from `core_sequence` (per entity, per FY); vendor or manufacturer from `crm_party`; entity; order date; expected delivery date; delivery location; payment terms (credit days from the vendor master, overridable per PO); buyer. Status machine: draft → approved → sent → open → partially_received → fulfilled → closed, plus short_closed and cancelled. Approval threshold by amount and role. Amendments create a new `po_version`; the old version is kept.
- `po_line` — item (finished-goods SKU, fabric, trim, packaging — anything in the catalog; fabric and trims carry `item_kind = raw_material` with their own UOM: kg, m, pcs, plus lot, GSM, shade), qty ordered, rate, tax, discount, expected date per line (staggered deliveries), `qty_received`, `qty_rejected`, `qty_cancelled`, and computed `qty_pending = ordered − received − cancelled`. **PO balance** is pending qty and pending value per line and per PO, always derived from GRN lines, never typed.
- Over-receipt tolerance per vendor-item (fabric by weight typically ±5%); anything beyond needs approval.
- PO PDF sent to the vendor by email or WhatsApp from the platform; vendor acknowledgement date recorded.
- **Active POs screen** — every open or partially received PO with vendor, expected date, days overdue, pending qty and value, last GRN; filters by vendor, item, location; overdue alerts to the buyer. Pending PO qty feeds the stock-cover view as "on order", so planning sees on-hand + inbound.

**Build — receipt straight into inventory**
- `po_grn` — against one or more PO lines (partial receipts, several GRNs per PO, one GRN across several POs from the same vendor). Fields are the goods-inward stamp: received date, PO no, LR no, transporter, bundles, GRN no and date, shortage/damage, handed over to, checked by, verified by. Attachments: invoice photo, LR photo. Barcode scan at receipt. GRN PDF generated for stapling to the purchase invoice — replaces the Word GRNs.
- Posting the GRN writes `inv_movement` rows immediately: to `qc_hold` when QC is required, or straight to `good` when the vendor-item is QC-exempt. That is "goes directly into inventory": on-hand rises at receipt; *available* rises at QC pass. QC-exempt is a flag on the vendor-item, not a habit. The stock screen shows on-hand, in-QC and available as three numbers.
- QC result per GRN line: `qc_pass` (to good), `qc_fail` (to damaged or rejected), shortage recorded. Rejections raise a `po_return` (return to vendor) and a debit note.
- Every GRN line updates the PO line balances by trigger. The PO becomes **fulfilled** when every line's pending is zero; the buyer can **short-close** with a reason (vendor cannot supply, order cancelled), which releases the balance from "on order". Nobody closes a PO by hand.
- Receipts without a PO are allowed only for a whitelist of item kinds (samples, consumables) and are flagged. Otherwise: no PO, no GRN.

**Build — billing and payables**
- `ap_bill` — vendor invoice number and date (captured exactly as printed — this is what GSTR-2B input-credit matching depends on), vendor GSTIN check, lines matched to GRN lines. **Three-way match:** PO rate and qty ↔ GRN qty ↔ bill qty and rate; rate, qty and tax variances flagged against a tolerance; a bill with unmatched lines cannot be approved without an override and a reason. Due date = bill date + vendor credit days, shortened automatically for MSME vendors (see Section 8). TDS-applicability flag.
- `ap_debit_note` — shortage, damage, rejection, rate difference; linked to the GRN or bill.
- `ap_advance` and `ap_payment` — advances allocated to later bills, part payments, UTR. Vendor ledger view: bills − debit notes − payments = balance. Payables ageing with the same buckets as receivables. Payment-run screen: due this week, MSME dues first.
- Tally: purchase vouchers from approved bills, debit notes and payments go in the daily batch built in Step 4; Sundry Creditors reconciled daily alongside Sundry Debtors.

**Build — vendor data**
- `crm_party` (kind vendor) carries: legal and trade name, GSTINs, PAN, MSME/Udyam number and category (micro, small, medium), bank details (masked in the UI; accounts role only), credit days and payment terms, default tax, lead-time days, categories supplied, default QC requirement, contacts, addresses, rating.
- `crm_vendor_item` — vendor × item: last rate, rate history with effective dates, MOQ, lead time, QC-exempt flag, preferred-vendor rank. Rates on a new PO default from here and are compared against it.
- Vendor performance view, per vendor per quarter: on-time delivery % (GRN date vs expected), fill rate (received ÷ ordered), rejection % and shortage % from QC, rate variance vs PO, bills outstanding, average days to pay. This is the page you open before a rate negotiation.
- Vendor documents (GST certificate, Udyam certificate, cancelled cheque, agreements) in Storage under accounts RLS.

**Rules in the database:** GRN qty cannot exceed PO pending plus tolerance; PO balances are computed, never edited; a bill line cannot exceed GRN'd qty; posted GRNs and approved bills are immutable (corrections are debit notes or reversing GRNs); status transitions only through functions; every transition audited.

**Screens:** Active POs · PO detail with a balance bar (ordered / received / rejected / pending) and the GRN and bill timeline · Receive (scanner mode) · QC queue · Bills to match · Payment run · Vendor page (PO history, GRNs, bills, ledger, performance, rate history, documents) · Payables ageing.

**Done when:** the handwritten LR register stops; every inward has a GRN in the platform the same day, and the GRN number is written on the invoice; no PO is closed by hand; the vendor ledger equals Tally Sundry Creditors daily.
**Kills:** LR register, GRN Word files, the payables side of the accounts sheet, PO follow-up on WhatsApp and Excel.
**Effort:** 4 weeks. The three-way match and the vendor ledger are the extra week; they are also what makes the PO's billing trustworthy.

### Step 3 — B2B orders, job work, dispatch, SLA (weeks 9–15)

**For:** replacing SALES_MASTER with orders that reserve stock, drive production and dispatch, and carry a clock.

**Build**
- `so_order` — customer, entity, `channel` (b2b | counter | distributor | enquiry | ecom_uniware), owner, promised dispatch date, price list, branding flag, status machine: draft → confirmed → in_production → ready → partially_dispatched → dispatched → invoiced → closed, plus cancelled. `so_line` stores one row per SKU (per size). The UI shows the size grid (Size1…Size13 labels by size type, as today); the database never stores "LABEL-QTY" strings.
- Confirm → `inv_allocate`. Credit check on confirm (Step 4 adds the hard block).
- `jw_job` — printing, embroidery, sublimation; in-house line or job worker; input SKUs → output SKUs; challan out and in; movements to and from the job-worker location; loss recorded. The existing printing-orders module folds into this.
- Picklist → pack → `so_dispatch` — transporter, LR no, boxes, weight, e-way bill no (consignments above the threshold), POD photo. Partial dispatch allowed. Dispatch is what triggers the invoice in Step 4.
- Counter sales: the walk-in register becomes a quick-order screen (brand, coordinator, cash/tax, regular/end customer) writing to the same `so_order`.
- SLA: `sla_policy` per channel and segment with stage targets (confirm → production start, production → ready, ready → dispatch), business-hours aware (Mon–Sat 09:30–18:30, same calendar as the enquiry module), breach flags and escalation to owner then manager. The enquiry module's response SLA and this order SLA read the same calendar table.
- Enquiry hand-off: a won enquiry creates a draft `so_order` with the contact converted to a `crm_party`.
- Customer page: orders, quotes, invoices, outstanding, enquiries, notes — one screen per party.

**Rules in the database:** an order cannot move to ready without reservations covering its lines; a dispatch cannot exceed reserved qty; status transitions only through the function; every transition audited.

**Done when:** SALES_MASTER and the Job Sheet are read-only; every dispatch has an order; the SLA report runs off timestamps, not typed dates.
**Kills:** SALES_MASTER, Job Sheet, the Production-sheet IMPORTRANGE, the counter sales register.
**Effort:** 6 weeks.

### Step 4 — Billing, receivables, Tally (weeks 13–19)

**For:** invoices that are generated, not typed; an ageing report nobody has to rebuild; collections with owners.

**Build**
- `bill_invoice` generated from dispatch, per entity and GSTIN sequence; HSN, GST slab by price band, place of supply, IGST or CGST+SGST. E-invoice IRN and QR through a GSP (mandatory at your turnover). E-way bill from the same document. `bill_credit_note` for returns and rate differences. `bill_quote` and proforma with the existing quotation numbering.
- `ar_receipt` — amount, mode, UTR, date; `ar_allocation` across invoices so part-payments work.
- Ageing view: NOT DUE / 0–30 / 31–60 / 61–90 / 90+ past due; due date = invoice date + party credit days; owner from the party master, overridable per invoice. `ar_followup` — next date, note, outcome — and a collections screen per owner.
- Credit control: soft warning at confirm when outstanding exceeds the limit or the oldest overdue exceeds N days; hard block by role.
- Distributor incentive engine: `dist_incentive_scheme` holds the rules as data (85% collection threshold, 1% / 1.5% / 2% slabs, 0.5% annual kicker); a monthly job computes `dist_incentive_ledger` from invoices and receipts; credit notes issue from it.
- Tally: a daily batch exports sales, credit notes, receipts and purchase vouchers as Tally XML per entity (one Tally company per entity), plus a reconciliation screen: platform totals vs Tally ledgers, with the differences listed by party. The ₹27.93L gap found in July is what this screen shows every morning instead of once a quarter.

**Rules in the database:** an invoice is immutable once numbered — corrections are credit notes; receipts cannot over-allocate; sequences are gapless per GSTIN per FY.

**Done when:** the receivables register is retired; B2B invoice PDFs come only from the platform; Tally sundry debtors equal platform outstanding within tolerance, daily.
**Kills:** receivables register, quotation Word files, manual Tally entry for B2B.
**Effort:** 6 weeks (GSP integration and Tally XML are the slow parts).

### Step 5 — Uniware bridge (weeks 19–23, can move up to right after Step 1 if ecom visibility hurts more than B2B)

**For:** ecom orders, shipments, returns and stock visible in the platform without anyone touching Uniware for reporting.

**Boundary contract (write it down, sign it, put it in `docs/`):**
- SKU master originates in the platform and is pushed to Uniware (from Step 0).
- Uniware owns on-hand stock in its facility. The platform mirrors it (Step 1) and never counts it as platform-owned.
- Platform → ecom facility transfers are a transfer document in the platform (movement to `in_transit`, then to the `uniware_facility` location as a mirror-only marker) that calls Uniware's `POST /services/rest/v1/inventory/adjust` with `adjustmentType: ADD` and the transfer number in `remarks` (or creates a Uniware GRN, if you prefer their inbound trail). Reverse transfers do the opposite. Nothing else in the platform writes Uniware inventory.
- Sale orders: incremental pull via Uniware's sale-order search and get APIs into `so_order` with `channel = ecom_uniware`, status mirrored, lines mapped by SKU. Shipping packages, invoices and returns pulled the same way for revenue, GST and returns reporting. The platform never edits an ecom order — it links out to Uniware.
- Auth: OAuth token per tenant with the `Facility` header per facility; token refresh; every upsert keyed on Uniware's code so retries are idempotent; `uni_sync_log` with a last-success watermark per feed; alert if any feed has no success for two hours.
- B2B orders do not enter Uniware unless they already do today — if some B2B dispatch runs through Uniware now, keep it there until Step 3 is live, then move it, one customer group at a time.

**Done when:** Uniware stock and orders appear in the platform with a sync timestamp; the WBR's ecom rows fill from the platform; no one exports from Uniware to paste into a sheet.
**Kills:** manual Uniware exports and the pasted rows in the WBR data sheet.
**Effort:** 4 weeks. Confirm your Uniware plan includes API access before scheduling this.

### Step 6 — Distributor side: sold-in stock visibility and portal (weeks 23–28)

**For:** knowing what each dealer holds and sells through, when the stock is legally theirs.

**Model for sold-in stock:** `dist_stock_position` per distributor × SKU × week: opening + sell-in (from your invoices — automatic and trustworthy) − sell-out (reported by them) ± declared count (reported) = closing, with a `confidence` flag (declared | estimated) and weeks of cover. Sell-in you know exactly; sell-out and counts depend on their reporting, so the model must survive gaps.

**Build**
- Distributor portal: Supabase auth with an external `distributor` role; RLS to their own `party_id` only. Screens: invoices and outstanding with ageing; incentive status this quarter (showing the number is what makes them chase the 85%); place a reorder (creates `so_order`, `channel = distributor`); declare weekly sell-out and stock by SKU (size-grid entry or an xlsx template upload); price list and catalog downloads.
- Fallback for dealers who will not log in: a weekly WhatsApp template (from the enquiry module's messaging layer) with a link; or a per-dealer sheet template the platform imports. Still an import owned by the platform, not a sheet someone consolidates by hand.
- Incentive lever: make sell-out reporting compliance a condition of the slab. Data for money.
- Reports: distributor scorecard (annual and monthly target vs actual per dealer — the 50 cr plan figures load into `rpt_target`; collections %; stock cover; SKU mix; sell-through), replenishment suggestions feeding production planning, and the weekly distributor brief generated from the same views.

**Done when:** at least 8 of the 10 dealers declare weekly for a full month; replenishment suggestions are used in a production plan.
**Kills:** distributor weekly reporting sheets; Dealers Q1 and Dealer-YOY tabs.
**Effort:** 5 weeks.

### Step 7 — Costing and consumption (weeks 28–33)

**For:** a cost per SKU that is maintained, a margin per order that is real, and a monthly consumption figure that comes from movements.

**Build**
- `cost_bom` per style (per size where consumption differs): fabric (kg or m per piece, GSM, wastage %), trims (thread, labels, buttons, zips, tags, polybag), CMT rate (in-house line or vendor), printing/embroidery rate per placement, packaging. `cost_std` per SKU as a dated rollup.
- `cost_actual` from documents already in the system: purchase rates from GRNs and bills; job-work bills; freight from dispatch; fabric issued vs pieces produced from production orders (actual consumption and wastage variance); marketplace fees later from Step 10.
- `prod_order` — the minimum production module: cut-make plan (style, colour, size ratio), fabric lot issued (movement to a WIP location), output into finished goods (`production_out` movement), rejects. No line planning, no MRP in v1.
- Views: margin per order (price − standard cost − branding − freight), per customer, per SKU, per channel; monthly consumption cost (fabric ₹, trims, job work, consumables); standard vs actual variance.

**Decision needed first:** standard-cost basis — last purchase or weighted average. Pick once; changing it later restates every margin.

**Done when:** every finished-goods SKU has a standard cost; the monthly consumption report comes from movements, not from an Excel someone maintains.
**Kills:** costing Excel per style; ad-hoc consumption sheets.
**Effort:** 5 weeks.

### Step 8 — People (weeks 33–37)

**For:** attendance, goals and reviews on the same data everything else uses.

**Build**
- `hr_attendance` — import of the daily punch report from the biometric export; late = first punch after the employee's in-time, no grace; per-employee in-time overrides; late-comers screen replaces the monthly Excel. `hr_leave`, `hr_shift`.
- `hr_goal` — the SMART goal sheets as rows: goal, metric, target, period, and a `source_view` so actuals auto-fill from platform data where they exist (sales per owner, collections per owner, dispatch SLA per warehouse, production per line); manual entry only where no view exists.
- `hr_review` — the quarterly assessment (Delivers / Thinks / Solves Alone / Right First Time, 1–5) plus goal % from `hr_goal`; tier ladder field on the employee; `hr_document` (offers, IDs, contracts) in Storage under HR-only RLS.
- Payroll: do not build. Export attendance and leave to your payroll tool or CA. PF, ESI, PT and TDS compliance are not a Cursor project.

**Done when:** the late-comers report is a screen; goal actuals auto-fill for sales and collections at minimum.
**Kills:** punch-report processing; goal-sheet xlsx as a data-entry surface.
**Effort:** 4 weeks.

### Step 9 — Reports, targets, one dashboard (weeks 37–41; views accumulate from Step 1 onward)

**For:** WBR, MBR, QBR and the CEO view as exports of one set of definitions.

**Build**
- `rpt_target` — scope (company | person | dealer | channel | brand), period, value. Load FY26-27: company monthly goals (90.01 cr), person-wise annual targets, dealer annual targets, reseller channel plan.
- `rpt_metric_dictionary` — metric name, definition in words, source view, owner. Anyone who disputes a number reads the definition, not a formula in cell AC14.
- Views: sales (invoice-based, by entity, brand, channel, owner, customer, period), outstanding and ageing, stock and cover, order SLA, production throughput, consumption, distributor scorecard, enquiry funnel, ecom from the mirror.
- Home dashboard by role. CEO: target vs achievement MTD/QTD/YTD by company, person and dealer; cash collected; outstanding 90+; stock cover; SLA breaches; enquiry pipeline. Sales, Accounts, Warehouse, HR each get their own home.
- Scheduled outputs: WBR/MBR/QBR packs as xlsx or pdf from the views; daily 09:00 digest; weekly distributor brief. A read-only Google Sheets mirror via scheduled export for anyone who insists — never edited.

**Done when:** WBR/MBR/QBR are generated, not filled; the Monthly Target vs Achievement sheet is retired.
**Kills:** Q1 2026-27 target workbook, Person Wise tabs, B2B side of the WBR inputs.
**Effort:** 4 weeks plus small increments earlier.

### Step 10 — Ecom, in the order it is safe

**10a — Reports and money (read-only, low risk, do this first).** Amazon SP-API report pulls (Business Report, FBA inventory, MTR, settlements) and Noon/Walmart exports into `ecom_*` tables; ASIN mapping from Step 0; FBA stock as `amazon_fc` mirror locations; settlements into `ar_receipt` per channel (the Payments_Received tab, automated); the monthly GST B2C split per seller GSTIN generated by a job instead of by hand; marketplace fees into the cost views.

**10b — Order management for own-fulfilled ecom (decision gate, not a default).** At 50–300 own-shipped orders a day, replacing Uniware's connectors and courier layer with in-house code costs more than it saves unless a specific Uniware failure is costing you more than a developer-year. Re-price Uniware for the ecom facility alone once B2B has left it; compare with a cheaper OMS. If you still build: D2C cart first (simplest API), Amazon MFN via SP-API second, and never courier integrations by hand — use an aggregator API.

**10c — Retire Uniware only when** every channel you sell on is covered, a 30-day parallel run shows zero oversells, and a named person is on call for the integrations.

---

## 4. Platform hygiene — before Step 1 goes live, not after

- Staging Supabase project; migrations in git; no schema change outside a migration.
- Point-in-time recovery enabled; nightly logical export to Storage; a restore drill once a quarter.
- RLS per role and department: sales rep sees own customers; distributor sees own party; HR sees `hr_*`; warehouse sees `inv_`, `po_`, `so_` fulfilment; viewer sees masked PII. Verified by direct API calls, not by the UI.
- `audit_log` trigger on every table that holds a document or a master.
- Anything that moves stock or money is a database function, with tests (pgTAP or a Deno suite). Cursor writes tests willingly; require them in the pull request template.
- Feature flags per module; runbooks per module in `docs/` — "stock drift", "Uniware sync stopped", "Tally import failed", "IRN generation failing".
- Multi-entity from day one: `entity_id` and `gstin_id` on every document; place-of-supply logic for 15 GSTINs.
- Mobile: warehouse, counter and distributor screens usable on a 390px phone; scanner mode with keyboard-wedge input.
- Never hard-delete a document. Status = cancelled. GST records must survive six-plus years.
- **Existing integrations are not touched.** The connection the app already has for inventory fetch and 1-day / 2-day delivery keeps running as it is: its tables become the mirror source (reuse its data — do not add a second pull against the same API and risk its rate limits), new modules read those tables and never write them, its credentials and the RLS policies on the tables it writes stay unchanged until Step 10, and every SKU code it maps on is inherited by the Step 0 master exactly as it is today. The only new call towards that side is the optional transfer document in Step 5.

---

## 5. Sequence, capacity, parallel tracks

| Step | Weeks (est.) | Developer builds | Ops owner does in parallel | Needs first |
|---|---|---|---|---|
| 0 Masters | 1–3 | Schema, imports, Uniware SKU push | Clean customer + SKU lists | — |
| 1 Ledger | 3–7 | Movements, balances, allocation, counts, mirror | Barcode labels, scanners, floor rule | 0 |
| 2 Procurement | 6–10 | PO lifecycle and balances, Active POs, GRN → stock, QC, three-way match, vendor ledger and performance | Load open POs with pending balances; vendor MSME/GST data; stop the LR register | 1 |
| 3 Orders | 9–15 | Orders, job work, dispatch, SLA, counter | Migrate open orders; retire SALES_MASTER | 1, 2 |
| 4 Billing | 13–19 | Invoices, IRN/e-way, receipts, ageing, incentives, Tally (sales and purchase side) | Pick GSP; CA sign-off; daily reconciliation owner | 2, 3 |
| 5 Uniware bridge | 19–23 | Orders/shipments/returns pull, transfers | Confirm API access with Unicommerce | 0, 1 |
| 6 Distributors | 23–28 | Portal, stock position, scorecard, brief | Onboard 10 dealers; tie reporting to incentive | 4 |
| 7 Costing | 28–33 | BOM, std cost, production order, margin views | Capture BOMs for top 50 styles first | 1, 2, 3 |
| 8 People | 33–37 | Attendance import, goals, reviews | Confirm in-times, goal sources | 0 |
| 9 Reports | 37–41 | Targets, dictionary, dashboards, scheduled packs | Retire target sheets and WBR inputs | all |
| 10 Ecom | later | 10a reports and settlements; 10b by decision | Re-price Uniware for ecom-only | 5, 9 |

Total to Step 9: 41–45 weeks of build for one developer using Cursor, assuming no parallel feature work on the existing modules. With normal interruptions, plan for 10–12 months. Steps 0–4 are the ones that change how money and stock behave; they land around month 5.

If cash is the pain, pull Step 4 ahead of Step 3 — invoicing can start from the existing dispatch module with typed orders, then Step 3 replaces the typing. If ecom visibility is the pain, run Step 5 straight after Step 1.

---

## 6. What not to build

Courier integrations. Marketplace connectors (Uniware's 280 exist for a reason). Payroll. Full MRP or line planning. A CRM beyond party + contact + enquiry. An accounting general ledger — Tally does it. A storefront — Shopify or equivalent does it. A video/CCTV claims module (Uniware's Unicapture) — only if marketplace claims become a measurable loss.

---

## 7. Decisions to make before the developer starts (with a recommendation each)

1. **Location ownership boundary with Uniware — defined physically.** Which warehouse, or which zone of it, is the Uniware facility? If the whole flex warehouse is Uniware's, FC transfers leave from Uniware's stock and the platform records them from the mirror plus Amazon's inbound-shipment reports; if only an ecom pick zone is Uniware's, the FC-transfer flow stays platform-owned. Recommend: the smallest zone that covers own-shipped ecom orders is Uniware's; the platform owns everything else. Sign it.
2. **Which sheet dies first.** Recommend: stock maintenance sheet and LR register (Steps 1–2). They are the least political and the most error-prone.
3. **GSP for e-invoice and e-way bill.** Pick one vendor; get API credentials per GSTIN; test IRN generation in their sandbox during Step 3.
4. **Tally posting method.** Recommend XML import via a daily batch to start; a live connector later if the daily lag hurts. Name the person who reconciles every morning.
5. **Distributor reporting channel.** Recommend portal + WhatsApp nudge, with sell-out reporting written into the incentive scheme.
6. **Do any B2B orders pass through Uniware today?** If yes, they move out in Step 3, customer group by customer group — not in one weekend.
7. **Standard-cost basis.** Recommend weighted average. Pick once.
8. **Module owners.** Warehouse lead for Steps 1–2, sales lead for 3, accounts for 4, distributor manager for 6, production head for 7, HR for 8. Software does not retire sheets; owners do. Each owner gets a kill date for their sheet.
9. **QC gate default on receipt.** "Straight into inventory" and "QC before inward" cannot both be the default. Recommend: every GRN posts to on-hand immediately, into QC hold by default; available stock rises at QC pass; vendor-items you trust get a QC-exempt flag so their receipts land as available at once. Purchase owner decides the exempt list; nobody else.
10. **PO approval threshold.** Who can approve a PO up to what value, and who above it. Put the numbers in a table, not in someone's head.

---

## 8. Things you may have missed

- **Master-data cleanup is the first project, and it is not code.** The receivables register alone shows split owner names, duplicate customers and a branch split six ways. Migrate that as-is and the single source of truth is single but wrong.
- **Two invoice generators is legal, but only with discipline.** Uniware invoices ecom, the platform invoices B2B; both must post to Tally and both need separate, gapless sequences per GSTIN per FY. Fifteen GSTINs times two systems needs a sequence register your CA has seen.
- **Uniware API access may be plan-gated.** Ask your account manager whether your plan includes the API, what the rate limits are, and what the ecom-only price would be once B2B leaves. Do this before Step 5 is scheduled, not the week it starts.
- **FBA stock is not yours operationally.** Keep Amazon FC locations mirror-only. The moment someone can "adjust" FBA stock in the platform, you have two truths again.
- **Sold-in distributor stock depends on their reporting.** Tie it to the incentive or expect three of ten to report. The sell-in half of the model is exact; design every distributor report to be useful with sell-in alone.
- **Job workers hold your most invisible stock.** Printers and embroiderers holding your blanks are inventory locations. Step 3's job-work challans are the fix; enforce them from day one or the ledger is wrong on the shop floor.
- **The developer is a single point of failure.** Code in git, docs in the repo, a Cursor rules file carrying the nine rules, and a second person — even part-time — who can deploy. The enquiry-platform prompt's discipline (RLS, idempotency, acceptance criteria) applies to every step here; the ledger and billing steps need more of it, not less.
- **Cutover, not coexistence, is where oversells happen.** For each step, a parallel run with daily reconciliation, then a hard cutover date. Never two live sources of the same number for more than two weeks.
- **MSME payment rule changes your payables ageing.** Under Section 43B(h) of the Income-tax Act, payments to registered micro and small vendors made later than the MSMED Act limit (45 days with a written agreement, 15 without) are not deductible in that year. Your vendor master must carry Udyam status and the payables screen must age MSME dues against that clock, not against negotiated credit days. Confirm the treatment with your CA — it applies to every fabric and trims vendor who is Udyam-registered.
- **TDS on purchases (194Q) needs a running total per vendor.** The deduction itself can stay in Tally, but the trigger — cumulative purchases from one vendor crossing the FY threshold — is a number the platform holds. Show it on the vendor page.
- **Input credit depends on the bill being typed exactly.** GSTR-2B matching needs the vendor's GSTIN, invoice number and date as filed. Capture them from the physical bill at GRN time, once; a retyped invoice number is a delayed credit.
- **Principal stock (Giordano, UCB) has its own terms.** It is ordinary inventory with `vendor = principal`, but MRP rules and any consignment terms differ by principal — confirm ownership per principal before it enters the ledger.
- **The question to ask Unicommerce this week:** what does the ecom-only facility cost once B2B volume leaves? Their answer sets the bar for Step 10b.

---

## Sources

Uniware API references used for the bridge step: [Using the Uniware APIs](https://documentation.unicommerce.com/docs/using-the-uniware-apis.html) · [Adjust Inventory (Single)](https://documentation.unicommerce.com/docs/adjust-inventory.html) · [Adjust Inventory (Multiple)](https://documentation.unicommerce.com/docs/adjust-inventory-bulk.html) · [Create or Update Item](https://documentation.unicommerce.com/docs/createoredit-itemtype.html) · [Create Sale Order](https://documentation.unicommerce.com/docs/saleorder-create.html) · [Get Sale Order](https://documentation.unicommerce.com/docs/saleorder-get.html) · [Sale Order overview](https://documentation.unicommerce.com/docs/saleorder-overview.html) · [Unicommerce products page](https://unicommerce.com/products/)
