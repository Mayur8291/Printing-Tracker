# Decisions

Older product history lives in [CHANGELOG.md](./CHANGELOG.md). New significant choices are recorded here.

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
