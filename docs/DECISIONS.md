# Decisions

Older product history lives in [CHANGELOG.md](./CHANGELOG.md). New significant choices are recorded here.

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

**Tradeoffs:** Live Meta WhatsApp bot and production delay alerts stay in Concierge. Dashboard Close queues the same survey copy for the WhatsApp simulator (and future Edge Function). SLA persist needs someone with write RLS to open the tab.

**Future:** Optional pg_cron SLA watcher; Edge Function + WhatsApp Cloud API if secrets are stored on Supabase, not in the SPA.
