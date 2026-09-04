# Decisions

Older product history lives in [CHANGELOG.md](./CHANGELOG.md). New significant choices are recorded here.

## 2026-09-04 — Inbox tab badges count unopened text only

**Context:** User wants a number beside Chats / Groups / Channels for new messages. Only unopened text.

**Decision:** Count messages with a non-empty body, not from self, not deleted, newer than `last_read_at`. Sum directs on Chats, groups on Groups. Channels 0 until channels exist. Hide badge at 0. Cap display at 99+.

**Why:** GIF/file-only is not a text message. Opening the thread still clears that conversation via `mark_conversation_read`.

**Tradeoffs:** Tab total is message count, not chat count. A row badge uses the same `unread_count`. Count walks recent messages on fetch (PostgREST row cap can undercount very large inboxes).

## 2026-09-04 — Chat presence is dashboard heartbeat, not chat-tab only

**Context:** User wants Online when the dashboard is the active browser tab, Away when they leave it, Offline if they never opened it or have been Away 2 hours. List dot and open-chat label must match.

**Options:** (1) Presence only while Chat tab is open. (2) App-wide heartbeat from `App.jsx`.

**Decision:** Option 2. Table `hr_user_presence`. Green / yellow / red tokens `--presence-online|away|offline`.

**Why:** “Active in the Dashboard” is the whole app, not only Chat.

**Tradeoffs:** Blur (another window) used to count as Away immediately. Updated: 5 minute Online grace after leaving the dashboard tab, then Away.

## 2026-09-04 — 5 minute Online grace after leaving the dashboard

**Context:** User wants Online to hold for 5 minutes if they open another browser tab.

**Decision:** Freeze `last_seen_at` when they leave. Display Online while that stamp is under 5 minutes, then Away, then Offline at 2 hours.

**Why:** A short tab switch should not look like they left.

**Tradeoffs:** Others still see Online for 5 minutes after close/crash.

## 2026-09-04 — Chat actions are icons; delete is soft

**Context:** User wants selectable messages in Chats/Groups with reply, react, delete, forward, pin. Multi-select only forward and delete. No written labels on the actions.

**Options:** (1) Context menu with words. (2) Icon toolbar in the thread header after click-select.

**Decision:** Option 2. Soft-delete own messages (`deleted_at`). One reaction per user. Forward copies into another conversation.

**Why:** Matches the request. Hard delete is not allowed.

**Tradeoffs:** Delete does nothing for other people's messages. Hover tooltip still names the icon for access.

## 2026-09-04 — Split inbox by conversation kind

**Context:** User wants created groups only on Groups, created chats only on Chats.

**Options:** (1) Keep mixed list on Chats. (2) Filter `kind=direct` vs `kind=group`.

**Decision:** Option 2. Auto-open first DM, not General. Thread follows the open tab kind.

**Why:** One place per conversation type.

**Tradeoffs:** General no longer opens by default on Chats.

## 2026-09-04 — Inbox tab panel stays at the bottom

**Context:** User pointed at the Chats / Groups / Channels bar and said keep that panel at the bottom only.

**Options:** (1) Tabs at top. (2) Same bar last in the left inbox.

**Decision:** Option 2. List heading + New chat / New group stay above the list. Chat rows unchanged.

**Why:** That bar is the switcher, not the page title.

**Tradeoffs:** Tab labels appear twice (heading + bottom bar).

## 2026-09-04 — Groups and Channels share Chats chrome

**Context:** User said Groups/Channels changing layout was wrong. New group should live on Groups, same header slot as New chat.

**Options:** (1) Keep full-width Empty on Groups/Channels. (2) Same left list + right thread on every inbox tab; only heading, action, and list body swap.

**Decision:** Option 2. New group only on Groups. Channels has heading and empty list, no extra button yet.

**Why:** Tab switch should not restyle the Chat panel.

**Tradeoffs:** Group chats still appear in the Chats list until Groups list is specified.

## 2026-09-04 — Chat inbox tabs live under the list, not under the composer

**Context:** User asked for a panel under Chats with Chats, Groups, Channels in one horizontal row. Groups and Channels stay empty for now.

**Options:** (1) Full-width Tabs under the whole chat Card (bar sits under the message box). (2) Tabs only in the left inbox; bar under the conversation list; thread only when Chats is selected.

**Decision:** Option 2. Default `inboxTab` is `chats`. Groups/Channels use shadcn `Empty`.

**Why:** “Under the Chats” means under the list. Composer stays clean. Existing chat behavior stays on Chats.

**Tradeoffs:** Phone thread view hides the bar until Back. Groups/Channels have no data yet.

**Superseded:** Tab panel sits at the bottom. See “Inbox tab panel stays at the bottom”.

## 2026-09-03 — Purchase Order Status Select matches job-sheet format

**Context:** User wants All PO Orders Status to look like the Production status dropdown (icon then name). Do not rename the list.

**Options:** (1) Keep colored Badge + Lucide. (2) Same Select layout as job sheets: colorful icon + existing labels.

**Decision:** Option 2. Names stay Pending, PO sent, PO Approved, Completed. Pending uses `/icons/pending.png`.

**Why:** One status Select look across tracker and Purchase Order.

**Tradeoffs:** PO statuses are not production stages. Icons are PO-specific except Pending's shared PNG.

## 2026-09-03 — Production NF inbound on; outbound webhook off

**Context:** NotFunny validated staging webhooks. User asked to ship production and hand them production API keys. NF earlier said they will send separate production webhook credentials. Scott app login stays unchanged.

**Options:** (1) Copy staging `SCOTT_WEBHOOK_*` onto production so live events hit the same NF function. (2) Deploy API + schema only; leave production outbound webhooks unset. (3) Wait for NF prod URL before any production ship.

**Decision (updated same day):** NF later confirmed that receiver **is** production. Option 1 is now in effect: same `SCOTT_WEBHOOK_*` on `levwrmvqdntngeasrtnb`. Inbound NotFunny key still production-only. Scott `SCOTT_AUTH_*` still not copied.

**Why:** They asked production keys to go live on the URL they already sent. Echo `evt_prod_1331ec06c6ad` returned `200 {"received":true}`.

**Tradeoffs:** Staging and production both POST to one NF function. Dedup is by `event_id`. Scott API tabs on the live site still need `SCOTT_AUTH_*` on production before those edge calls work.

## 2026-09-03 — Asset Management register is `hr_assets`

**Context:** Save asset only prepended to in-memory `rawAssets`. Leaving the tab unmounted the panel. Assets looked empty.

**Options:** (1) localStorage. (2) Keep panel mounted. (3) Staging table `hr_assets`, authenticated read, insert own, update for assign/check-in.

**Decision:** Option 3. Prefix `hr_` because these are company assets assigned to people (`profiles`), not SKU stock.

**Why:** One register for every user. Survive refresh. Match Internal Support / Contact Book pattern.

**Tradeoffs:** Staging only until a production release. No hard delete (Retired later). Tag allocated in the client with unique retry, not a gapless FY sequence.

## 2026-09-02 — Inventory Transfer is a facility-to-facility move

**Context:** Users need to move stock Makali ↔ Guthalli. The Adjust dialog had one warehouse and Transfer did not touch facility on-hand.

**Options:** (1) Two client calls to `adjust_sku_facility_stock`. (2) One DB function that deducts and adds under lock.

**Decision:** Option 2. `transfer_sku_facility_stock`. UI shows From and To.

**Why:** Two client calls can succeed on one side and fail on the other. Total SKU stock must stay the same.

**Tradeoffs:** Transfer cannot change overall qty (use IN/OUT/ADJUST for that). Reserved qty at source cannot be transferred.

## 2026-09-02 — Inventory list follows facility availability, not sku.stock_qty

**Context:** Adjust updated the DB; staging UI looked unchanged.

**Options:** (1) Paint `stock_qty` again. (2) Keep availability as truth and reload it after every refresh/adjust.

**Decision:** Option 2. Await `loadAvailability()` inside `refresh()`. Adjust writes the warehouse the user picked.

**Why:** Reserved qty only lives on `inventory_facility_stock`. Showing `stock_qty` would lie about sellable stock.

**Tradeoffs:** Extra availability fetch on silent refresh. Correct qty beats a cheap stale paint.

## 2026-09-02 — Step 5 Uniware mirror is a separate ledger

**Context:** Roadmap Step 5. Risk of double-counting ecom stock if the snapshot is summed into `inv_balance` or Inventory.

**Options:** (1) Pull Uniware qty into `inv_balance`. (2) Separate `uni_*` mirror + transfer document; never sum.

**Decision:** Option 2. Ecom orders stay on `uni_sale_order`, not mixed into `so_order`. Cross-boundary only via `uni_transfer` + Uniware adjust API. Contract in `docs/UNIWARE_BOUNDARY.md`.

**Why:** Law 5 — one owner per location. Uniware owns the ecom facility.

**Tradeoffs:** Two order lists (B2B `so_order` vs ecom mirror). WBR ecom rows wait until reporting reads the mirror. Sync is empty until edge secrets are set.

## 2026-09-02 — Support table rows stay readable in Dark Mode

**Context:** Support desk rows use pale priority backgrounds. Dark Mode panel text is light. Values disappear.

**Options:** (1) Drop row tints. (2) Dark-mode row + badge colors with `text-foreground`.

**Decision:** Option 2. Keep priority left border. Enquiry and Complaints share `SupportTicketDesk`.

**Why:** Tint still shows urgency. Text must contrast.

**Tradeoffs:** Delay Alert / Order status have no tinted table; only success copy on Delay Alert got a dark text token.

## 2026-09-02 — Issue sits after Status on one line with View Issue

**Context:** User wants Issue next to Status but not before it, and `Power Cut - 2nd Floor → View Issue` on one line.

**Options:** (1) Issue before Status, stacked link. (2) Name | Status | Issue | Date; summary + arrow + View Issue inline.

**Decision:** Option 2.

**Why:** Status then Issue. Link is beside the text they typed, not under it.

**Tradeoffs:** Long type lists wrap with the link.

## 2026-09-02 — Issue column sits next to Status with type and floor

**Context:** User wants Issue next to Status, text like `Power Cut - 2nd Floor`, and **View Issue** under it. Do not restyle the table.

**Options:** (1) Keep View Issue as the only Issue cell. (2) Swap Name/Issue order; summary line + View Issue link.

**Decision:** Option 2. Columns: Name | Issue | Status | Date. Floor omitted when they did not pick one.

**Why:** Issue and Status belong together. The line is the input they gave.

**Tradeoffs:** Many issue types join with commas before ` - Floor`.

## 2026-09-02 — Raise an Issue is a button on Open Tickets

**Context:** User wants History renamed **Open Tickets**, no Raise tab, and all raise fields behind one **Raise an Issue** button.

**Options:** (1) Keep three tabs. (2) Two tabs; Dialog from the Open Tickets button holds the form.

**Decision:** Option 2. Default tab is Open Tickets. Same issue / floor / comment / submit rules.

**Why:** List first. Raise is an action, not a place.

**Tradeoffs:** Form is overlay, not a full page.

## 2026-09-02 — Resolved tab is locked after mark

**Context:** User wants a **Resolved** tab for `status = Resolved`, visible to admin and non-admin. After that mark, no one may change Status.

**Options:** (1) Filter only in History. (2) Third tab + UI lock. (3) Third tab + UI lock + staging RLS `status <> Resolved` on update.

**Decision:** Option 3. History excludes Resolved. Resolved tab has the same filters; Name filter stays admin only. Non-admin still sees only own rows.

**Why:** “Move them” needs its own tab. “Don’t give access” needs more than a hidden Select.

**Tradeoffs:** Closed stays in History. Admin cannot reopen a Resolved row without a later product change.

## 2026-09-02 — History is admin-all, non-admin own only

**Context:** User wants admin to see every History row and change Status. Non-admin should see only their own issues, read the status admin set, and not get a Name filter.

**Options:** (1) Client hide only. (2) Client hide + staging RLS (`raised_by = auth.uid()` or `jwt_user_is_admin()`; update admin only).

**Decision:** Option 2.

**Why:** UI hide is not enough. API would still leak other people’s rows.

**Tradeoffs:** Non-admin cannot change even their own status. Production table still not created.

## 2026-09-02 — Status Select copies Production Tracker symbol + name

**Context:** User wants History Status to look like the order-list dropdown: colorful symbol + name in the closed box and in every list row.

**Options:** (1) Lucide line icons. (2) Same `SelectValue` children + `.stage-icon` emoji as `OrderListStatusCell`.

**Decision:** Option 2. Open 📂, In Progress ⏳, Resolved ✅, Closed 🔒. Names stay those four words.

**Why:** Match the Production Tracker Status picker picture.

**Tradeoffs:** Emoji, not custom PNGs. Production stages stay on the tracker.

## 2026-09-02 — Status is one Select with icon inside

**Context:** Badge + Select made two boxes for the same status.

**Options:** (1) Keep both. (2) One Select; icon + name in trigger and items.

**Decision:** Option 2. Names stay Open, In Progress, Resolved, Closed.

**Why:** Match the single dropdown picture.

**Tradeoffs:** Color is on the icon via semantic tokens, not a second Badge.

## 2026-09-02 — History filters match PO History; View order is a link

**Context:** User wants From/To/Clear/Search/Name/page filters above History, status symbols/colors, and the Issue action as underlined **View order**.

**Options:** (1) Custom filters. (2) Same shadcn DatePicker + Input + Select + OrdersPerPageControl as PO History. Badge variants for status. `Button variant="link"` for View order.

**Decision:** Option 2. Name dropdown is the coordinator-slot. Status: Open secondary + Circle, In Progress default + Clock, Resolved outline + Check, Closed destructive + X.

**Why:** Match the picture and stay shadcn.

**Tradeoffs:** Link text later changed to **View Issue** (2026-09-02).

## 2026-09-02 — Internal Support History is a shared staging table

**Context:** User wants History of whoever submits: Issue (View Issue), Name, Status dropdown, Date.

**Options:** (1) Browser-only list. (2) Staging table `internal_support_issues`, authenticated read, insert own, update status.

**Decision:** Option 2. Name snapshot at submit. Status: Open, In Progress, Resolved, Closed. View Issue Dialog shows types, floor, comment, name, date, status. Staging only.

**Why:** “Whoever submits” means shared History, not one browser.

**Tradeoffs:** Any signed-in staff who can open the tab can change Status. No production table until an explicit release.

## 2026-09-02 — Internal Support form lives in Raise an Issue tab

**Context:** User wants a tab **Raise an Issue** that holds the existing issue form.

**Options:** (1) Keep one Card, no tabs. (2) shadcn Tabs; first tab is Raise an Issue with the current form.

**Decision:** Option 2. `defaultValue="raise_issue"`. Other tabs can be added later.

**Why:** Same form, clearer place, room for more tabs.

**Tradeoffs:** Only one tab for now.

## 2026-09-02 — Step 4 billing design choices

- **Context:** roadmap Step 4 — invoices generated not typed; ageing as a view; collections with owners. Same DB-first money laws as AP in Step 2.
- **One invoice per dispatch:** `unique (dispatch_id)` — partial dispatch already produced a dispatch document, so each dispatch invoices what actually left the warehouse. Alternative (one invoice per order) rejected: mixed GST dates and e-way ties to the consignment.
- **GSTIN-scoped sequences:** `ops_next_gstin_doc_no` — the law is gapless per GSTIN per FY, not per entity. Receipts stay entity-scoped (`RCPT/`) because they are not GST documents.
- **Soft credit check only:** `ar_credit_check` warns on confirm; hard block waits for department roles (roadmap: "hard block by role"). Blocking CEO/admin today would freeze real orders.
- **CGST/SGST paisa split:** tax rounded once, then CGST = round(tax/2), SGST = tax − CGST so halves always sum to the tax.
- **Unallocated receipts are advances:** allocation is optional; leftover receipt amount reduces customer exposure in the ledger but does not attach to an invoice until a later receipt/allocation (v1 does not support allocating an existing advance — next receipt can cover the invoice).
- **Deferred (need picks, not more schema guesswork):** GSP for IRN/QR and e-way; Tally XML daily batch + typed recon screen (the ₹27.93L gap); distributor incentive engine (`dist_incentive_scheme` as data); `bill_quote`/proforma numbering. Existing Billing / quotation Word flows stay until those land.
- **UI admin-only** (`ops_ar`) during build-out; existing Workspace Billing tab not touched.

## 2026-09-02 — Step 3 sales orders design choices

- **Context:** roadmap Step 3 — orders that reserve stock, drive dispatch, job work, SLA. Same DB-first discipline as Steps 1–2.
- **Partial allocation on confirm:** `so_confirm` reserves whatever is available instead of failing on shortfall — production fills the rest and `so_allocate` re-runs (top-up, idempotent). The hard gates sit later: ready requires full reservation, dispatch caps at reserved. Alternative (all-or-nothing confirm) rejected: real orders confirm before stock exists.
- **Reservation consumption splits rows:** dispatch consumes reservations FIFO; a partially used row is shrunk and a consumed row inserted for the used grain, so the reservation trail stays complete for audit instead of silently mutating quantities.
- **Dispatches append-only, no direct write policies:** like payments in Step 2 — `so_post_dispatch` is the only writer; corrections are `return_in` movements + note. LR/e-way fields live on the document for Step 4 invoicing.
- **Job-work loss = worker-location balance:** receive burns declared consumption and books declared outputs; whatever input remains at the worker location is the visible pending/loss (no separate loss ledger to maintain, the stock ledger already is one). Issued jobs cannot cancel — stock must come back through movements.
- **SLA measured from stage timestamps** (`confirmed_at` → `production_started_at` → `ready_at` → `dispatched_at`) against `sla_policy` targets in business hours (Mon–Sat 09:30–18:30 IST) — never typed dates. Escalation/notification deferred; the view carries `breached` for a later job.
- **Counter sales are a channel, not a module:** `channel='counter'` on `so_order`, per roadmap ("the walk-in register becomes a quick-order screen writing to the same so_order").
- **Enquiry hand-off deferred:** the roadmap's "won enquiry creates a draft so_order" needs the live Support module's enquiry schema; wiring it now risks the running module. Revisit as a small follow-up (create draft `so_order` + convert contact to `crm_party` from an enquiry action).
- **UI stays admin-only** (`ops_sales` in `DASHBOARD_ADMIN_ONLY_TAB_IDS`) during the build-out, same as Steps 0–2; existing SALES_MASTER/Job Sheet workflows untouched until cutover.

## 2026-09-02 — Step 2 procurement design choices

**Context:** Third roadmap migration (`20260902120000_step2_procurement.sql`), staging only. User decisions: QC gate on by default, approval = admin access, tolerances editable.

**Decisions:**

1. **Status flips only through functions, enforced in the DB.** Guard triggers block any status change unless a transaction-local flag (`ops.allow_status_change`) is set — and only the SECURITY DEFINER functions set it. Admin RLS write on the document tables therefore covers *drafting only*; nobody can flip a PO to approved with a direct update.
2. **Numbers assigned at approval/posting, not creation.** Drafts never burn a gapless sequence number; `ops_next_doc_no` auto-provisions the `core_sequence` row (prefix `PO/<FY>/`, `GRN/<FY>/`) so no manual sequence setup is needed.
3. **`sent`/`open` PO statuses deferred.** The roadmap machine includes them, but they only mean something once PO PDF/email exists. v1: draft → approved → partially_received → fulfilled → closed (+short_closed/cancelled). Amendments post-approval = short-close + fresh PO (no `po_version` machinery yet).
4. **Ledger gained `to_state` instead of a QC-location hack.** QC pass/fail is a state change at the same location; faking it with virtual locations would have polluted location masters. Same-location movements are only legal when the state changes.
5. **Double billing is structurally impossible**: one bill line per GRN line (unique index), one vendor invoice number per vendor (unique index) — not just validated in code.
6. **Billed > received is a hard stop; rate variance is an override.** Quantity fraud is never acceptable; rate differences happen (freight, revisions) and are allowed with a recorded reason (`match_status='override'`).
7. **MSME due-date cap editable** (`msme_due_cap_days`, default 45) applied to micro/small vendors at bill approval, flagged `msme_capped`.
8. **Payments have no RLS write path at all** — only `ap_record_payment` writes them, and block triggers make them append-only. Corrections are counter entries.
9. **Fulfilment counts only positive pending** (`greatest(pending, 0)`) so over-receipt on one line cannot mask a short line — found during the smoke test design.
10. **Existing Purchase Order voucher tab untouched**; the new module lives under `ops_procurement` until cutover.

## 2026-09-01 — Step 1 stock ledger design choices

**Context:** Second roadmap migration (`20260901191500_step1_stock_ledger.sql`), staging only.

**Decisions:**

1. **Role gate pattern `auth.uid() is not null and not jwt_user_is_admin()`.** Blocks non-admin app users while allowing admin users and server contexts (SQL/service, where `auth.uid()` is null). Warehouse-department roles come with the scanner flow; the gate lives in one helper (`inv_assert_can_post`) so widening it is a one-line change.
2. **Append-only enforced by trigger, not just policy.** RLS alone would not stop the table owner; the trigger raises for everyone. Corrections are reversing movements.
3. **Balances maintained synchronously by the posting function** (not by a trigger on `inv_movement`) so the negative-stock check and the lock happen in one place; the nightly recompute is the safety net (drift alerts, pg_cron 02:30 IST).
4. **Reservations are generic (`ref_type`/`ref_id`)**, not FK'd to order lines — `so_order` arrives in Step 3 and will pass its own refs. `inv_allocate(order_id)` lands then.
5. **Count sessions/lines are admin-writable directly** — they are working documents; only `inv_count_post` moves stock. Expected qty snapshots at line insert via trigger.
6. **Smoke test by rollback:** the whole scenario ran in one transaction ending in a deliberate raise, so staging keeps zero test rows while the assertions (balances, blocked over-issue/over-reserve/edit, drift 0) are proven.
7. **Existing Inventory tab and Scott stock integration untouched** — the new ledger runs beside them until cutover; nothing reads or writes the frozen integration tables.

## 2026-09-01 — Step 0 masters schema choices (One Source of Truth)

**Context:** First migration of the roadmap ([ONE_SOURCE_OF_TRUTH_ROADMAP.md](./ONE_SOURCE_OF_TRUTH_ROADMAP.md)). Schema only, staging only, no UI.

**Decisions:**

1. **`cat_sku.colour_id` nullable at first.** Legacy/Uniware SKUs import before styles/colours are structured; the column must be filled before Step 1 (stock ledger) goes live. Alternative (not null from day one) would block the import-then-reconcile flow the roadmap prescribes.
2. **No audit trigger on `core_sequence`.** Every allocated number is an update; auditing it means one audit row per invoice. The numbered documents are the audit trail.
3. **Bank details in `crm_party_bank`, admin-only RLS.** There is no `accounts` DB role yet; admin gate now, dedicated accounts role when Step 4 lands. Masking in-row was rejected — separate table keeps RLS simple and provable.
4. **`core_next_sequence()` is SECURITY DEFINER, granted to `authenticated`.** Non-admin billing users must allocate numbers while the sequence table itself stays admin-write-only. Function only increments a locked counter; `search_path` pinned; revoked from `anon`/`public`.
5. **Unique normalized names** (`lower`, collapsed whitespace) per kind on `crm_party` (unmerged rows only), `core_entity`, `cat_brand` — law 1's typo-split protection at the index level.
6. **Existing SKU codes inherited as-is.** Nothing the Scott integration maps on is renamed (hard guard in laws.md).

**Tradeoffs:** admin-only writes are coarse until per-department roles exist; acceptable while there is no masters UI.

## 2026-09-01 — Hide Floor row for Food, Asset, Biometric, Lost belongings

**Context:** User does not want Floor on screen for Food, Issue with Asset, Issue with Biometric, Lost Personnal Belongings. If they also pick another issue, Floor must show.

**Options:** (1) Always show Floor, optional for those four. (2) Hide Floor unless any selected issue needs a location.

**Decision:** Option 2. `floorRequired` gates both visibility and Submit. Mix with Internet shows Floor again.

**Why:** Those four go straight to Comment. Other issues still need a floor.

**Tradeoffs:** First load has no Floor until a floor-required issue is picked.

## 2026-09-01 — Internal Support Submit thank-you copy

**Context:** User does not want the check + Submitted + “ticket save comes next” Alert.

**Options:** (1) Keep that placeholder. (2) One-line thank-you in AlertDescription.

**Decision:** Option 2. Exact copy: Thank you. Your issue has been submitted and the concerned team will look into it shortly.

**Why:** That is the message staff should see after Submit.

**Tradeoffs:** Still no database ticket; the words say submitted.

## 2026-09-01 — Floor optional for Food, Asset, Biometric, Lost belongings

**Context:** Floor should be mandatory before Comment, except Food, Issue with Asset, Issue with Biometric, Lost Personnal Belongings.

**Options:** (1) Always require floor. (2) Require floor only when a non-exception issue is selected. Mixed picks still require floor.

**Decision:** Option 2. Comment + Submit wait for a floor unless every selected issue is in the exception list. Labels match the Buttons (including Personnal).

**Why:** Those four are not tied to a floor the same way Internet / Lift / Hygiene are.

**Tradeoffs:** Food + Internet still needs a floor. Floor row still shows for exception-only picks; it is just optional.

## 2026-09-01 — Internal Support floor is a single pick under issues

**Context:** User wants heading **Select your Floor** under the issue list, with Ground Floor through 5th Floor.

**Options:** (1) ToggleGroup. (2) Same shadcn Buttons as issues, one selected at a time.

**Decision:** Option 2. Match the issue Buttons. Floor sits under issues, before Comment. Submit needs a floor.

**Why:** Same shadcn Button look as the issue row. One person is on one floor.

**Tradeoffs:** ToggleGroup is not installed; Buttons stay consistent with this panel.

## 2026-09-01 — Internal Support Comment waits for one issue pick

**Context:** User wants the Comment box only after at least one issue Button is selected.

**Options:** (1) Always show Comment. (2) Show Comment + Submit only when `selectedIssues.length > 0`.

**Decision:** Option 2. Un-pick the last issue hides Comment again. Typed text stays in state.

**Why:** No comment until they say what kind of problem.

**Tradeoffs:** After Submit, picks clear so Comment hides; success Alert still shows.

## 2026-09-01 — Internal Support comment + Submit are local only

**Context:** User wants a comment box under the issue Buttons and a Submit button under that.

**Options:** (1) Textarea + Submit, no save. (2) Write a tickets table now.

**Decision:** Option 1. shadcn Field + Textarea + Submit. Require at least one issue and a comment. Alert tells them save is not wired.

**Why:** User asked for the box and the button. Ticket backend was not in this step.

**Tradeoffs:** Submit feels done but nothing lands in Supabase yet.

## 2026-09-01 — Internal Support issue Buttons are multi-select

**Context:** User wants more than one issue type on at the same time.

**Options:** (1) Keep single string. (2) Toggle membership in a local array.

**Decision:** Option 2. Click on = add. Click again = remove. Still shadcn Buttons, no ticket save.

**Why:** One person can have Internet and Lift not working at once.

**Tradeoffs:** Heading still says “the option”. Refresh still clears the list.

## 2026-09-01 — Internal Support issue types are shadcn Buttons

**Context:** User wants a heading and ten clickable issue options on Internal Support Platform.

**Options:** (1) ToggleGroup. (2) RadioGroup / FieldSet. (3) shadcn `Button` outline grid, selected = `variant="default"`.

**Decision:** Option 3. Labels kept as given (including Hygeine / Personnal). Local select only.

**Why:** User asked for Clickable Button. Ten options is more than ToggleGroup’s 2–7 range. Ticket save is not in this step.

**Tradeoffs:** Refresh loses the pick. Spelling matches the request, not dictionary.

## 2026-09-01 — Internal Support Platform is a Tools tab, not Support Enquiry

**Context:** User wants an Internal Support Platform panel under Tools, with a relevant symbol.

**Options:** (1) Reuse Support (`enquiry`). (2) New Tools tab `internal_support` with LifeBuoy icon and a Card shell.

**Decision:** Option 2. Grantable like other Tools. No tickets yet.

**Why:** Support Enquiry is customer-facing desks. This is an internal workspace. LifeBuoy is distinct from Headphones.

**Tradeoffs:** Viewers with a frozen allowed-tab list will not see it until an admin grants `internal_support`.

## 2026-08-31 — Job sheet Delivery required on is today or later

**Context:** Create Job sheet and Create Sample Jobsheet must not offer past days for Delivery required on.

**Options:** (1) Allow any date. (2) Calendar min = today; save also rejects past.

**Decision:** Option 2. Same DatePicker on both forms. Sample date still optional.

**Why:** User asked only running day and future days.

**Tradeoffs:** Uses the device local calendar day, same as order date. View order can still change an existing due date.

## 2026-08-31 — Production / Sampling tabs match the All / Complete pill

**Context:** User wants Production Tracker and Sampling Tracker buttons to look like All orders / Complete orders, and to drop the green / orange colours.

**Options:** (1) Keep apart coloured tabs. (2) Same default muted TabsList pill as All / Complete, two stacked rows.

**Decision:** Option 2. No custom trigger colours. Lists still stay split by kind.

**Why:** Same visibility and format as the list pill. Colour was extra.

**Tradeoffs:** The two pill rows now look alike. Labels still tell them apart.

## 2026-08-31 — Sampling SLA is Delivery Required On, else 2 days from save

**Context:** After Create Sample Jobsheet save, Due In must follow **Delivery required on** when the user filled it. If they left it blank, keep a 2-day default to Dispatched Successfully.

**Options:** (1) Always 2 days from save. (2) Always `due_date`. (3) `due_date` end-of-day when set, else `created_at` + 48h.

**Decision:** Option 3. Sample create does not require Delivery required on. Production job sheet still does. Sampling **All orders** has **Due In** after Order date. Sampling **Complete orders** has no Due In. Hide Due In in the view when closed. Breach uses destructive Badge on the list and Alert in the view.

**Why:** User asked for the filled date, and 2 days only as the fallback.

**Tradeoffs:** Browser clock can drift. End of local day means a same-day delivery date still has hours left that evening. Editing `order_date` does not move the default SLA.

## 2026-08-31 — Sampling Complete is Dispatched Successfully and status is locked

**Context:** Sampling Complete must take jobs that are Dispatched Successfully or Mark as complete. After that, status must show Dispatched Successfully and must not change.

**Options:** (1) Only `is_complete`. (2) Treat `dispatched_successfully` as closed too, because viewers cannot write `is_complete` (RLS). Display overlay + hide Select.

**Decision:** Option 2. Admin Mark as complete also writes `status = dispatched_successfully` and `is_complete`. Viewer status pick writes status only. Complete tab `canEditStatus` is false.

**Why:** Both user paths work. RLS stays as-is. Production Complete is unchanged.

**Tradeoffs:** A viewer-closed sample may have `is_complete = false` until an admin marks complete; the list still treats it as complete.

## 2026-08-31 — Tracker All / Complete pill is separate from Production / Sampling switch

**Context:** User wants All orders / Complete orders under both trackers (Printing pill). Production and Sampling lists must not mix.

**Options:** (1) Same TabsList for both rows. (2) Tracker switch as apart bordered tabs (PO style); All/Complete as muted pill TabsList. Separate `is_complete` filters per `order_kind`.

**Decision:** Independent All/Complete state per tracker. Mark complete routes to that tracker’s Complete tab. Visual later matched the All/Complete pill (no colour).

**Why:** Same Complete UI. Sample complete never appears in Production Complete.

**Tradeoffs:** Two list-tab states in App.

## 2026-09-03 — Mark complete does not switch list tab

**Context:** User does not want the page to jump to Complete orders after Mark as complete.

**Options:** (1) Keep routing to Complete so the job stays visible. (2) Stay on the current list; job leaves All because it is complete.

**Decision:** Option 2. `handleMarkComplete` / sample-complete status save do not call `setOrdersTab("complete")` or tracker Complete.

**Why:** Operator stays in the All-orders workflow. Complete list is still there when they want it.

**Tradeoffs:** The completed row disappears from All immediately. User must open Complete orders to see it.

## 2026-09-03 — Sent to Dispatch auto-completes after 10 minutes

**Context:** Sent to Dispatch stayed on All forever because Complete is `is_complete`, not that status. Viewer trigger blocks `is_complete`.

**Options:** (1) Treat `sent_to_dispatch` as complete in the list filter. (2) After 10 minutes set `is_complete` in the existing promote RPC. (3) Disable the scope trigger around that UPDATE.

**Decision:** Option 2. Stamp `status_sent_to_dispatch_at`. RPC completes matching rows. Transaction GUC lets the scope trigger allow that write (no table-lock DISABLE TRIGGER).

**Why:** Same Complete flag as Mark as complete. 10-minute window matches the request. Client already polls the RPC every 30s.

**Tradeoffs:** Jobs already on Sent to Dispatch get a fresh 10-minute window on migrate (`now()`, not `created_at`).

## 2026-08-31 — Sampling Tracker has its own status pipeline

**Context:** Sampling Tracker Status must not use Production or Printing stages. User listed nine sample stages with symbols, same dropdown UI.

**Options:** (1) Reuse Production codes with different labels (breaks Production labels for shared codes). (2) New sampling codes; reuse only `qc` and `ready` where the label already matches.

**Decision:** Option 2. Dedicated codes for Pattern Making, Sample Cutting, Sample Stitching, Trim + Iron, Branding, Packaging, Dispatched Successfully. Reuse `qc` and `ready`. Do not use `dispatched` (that is Dispatch tab). Same shadcn Select + `renderStageIcon` as Production. New sample jobs start at `pattern_making`.

**Why:** Production dropdown stays the same. Sample jobs never land in Dispatch Processed.

**Tradeoffs:** `orders_status_check` grows. Existing sample rows backfill to Pattern Making.

## 2026-08-31 — Sampling Tracker reuses Production list with different words and fewer columns

**Context:** After Create Sample Jobsheet, Sampling Tracker needs a saved-job list like Production Tracker. Words and a few columns must differ. Production Tracker must stay the same.

**Options:** (1) New table component. (2) Reuse `LinkedOrdersTabPanel` with optional props (hide summary/Qty/extra column; relabel view/date/badge).

**Decision:** Option 2. Date column reads `order.order_date`. Badge text **Sample Order**. Action **View Sample Order**. No count card, no Qty, no Handover. Sub-tab state lives in App so save can stay on Sampling.

**Why:** Same table look. Production defaults unchanged.

**Tradeoffs:** From/To is the shared App date range (same as Production), filtered on `order_date`.

## 2026-08-31 — Sample job sheets use SA-0001 and a new order_kind

**Context:** Sampling Tracker needs the Production job-sheet form without Total quantity. Order IDs must be sequential `SA-0001` and must not mix with Production job sheets.

**Options:** (1) Reuse `job_sheet` + SA- prefix. (2) New `sample_job_sheet` kind, `is_production_order = false`, unique `order_id` among samples.

**Decision:** Option 2. Next ID = max existing SA number + 1. Retry on unique conflict.

**Why:** Production list stays clean. Numbers stay in order.

**Tradeoffs:** Sampling list later reused `LinkedOrdersTabPanel`; this ADR kept the create-ID choice.

## 2026-08-31 — Production Tracker sub-tabs; Sampling left empty

**Context:** User wants Production Tracker and Sampling Tracker under the Production tracker sidebar tab. Current list must stay as-is. Sampling stays empty.

**Options:** (1) Restyle like Purchase Order separated pills. (2) Reuse Printing Orders `TabsList` format; wrap the existing list without changing `LinkedOrdersTabPanel`.

**Decision:** Option 2. `ProductionTrackerPanel` wraps children. Sampling renders nothing yet.

**Why:** No list UI change. Shared tab `cn()` / Tabs format stays.

**Tradeoffs:** Sampling list was empty at first; history list landed in a later ADR.

## 2026-08-31 — Sampling Tracker bar is a stub, same shadcn filters

**Context:** User wants From / To / Clear / Create Sample Jobsheet / View on Sampling Tracker, matching Production Tracker. Create must not fill a form yet.

**Decision:** Reuse `OrdersListFilters` and an outline `Button`. Create Sample Jobsheet has no handler.

**Why:** Same CN / shadcn format as Production Tracker. Form comes later.

**Tradeoffs:** Dates and View N later filter the Sampling history list (see later ADR).

## 2026-08-24 — Admin-only PO status; History has no picker

**Context:** User wants status change on Purchase Order for admin only, and no status change on PO History for anyone.

**Options:** (1) Dropdown for every signed-in user. (2) Admin dropdown on All PO Orders only; History always a Completed badge.

**Decision:** Option 2. `isAdmin` from App (`profiles.role`). Update helper re-checks admin. All PO Orders dropdown includes Pending / PO sent / PO Approved / Completed.

**Why:** Completed still comes from the backend. Non-admin must not change workflow status.

**Tradeoffs:** RLS still allows authenticated UPDATE of the row; the SPA and helper block non-admin status writes.

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
