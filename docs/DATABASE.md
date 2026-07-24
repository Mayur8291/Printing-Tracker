# Database

## Password reset requests

Admin-approved forgot-password flow from login screen.

### `password_reset_requests`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → `profiles.id` |
| `email` | text | Requester email (denormalized for admin list) |
| `requester_role` | text | `viewer` or `admin` |
| `routing` | text | `panel_admin` (any admin approves) or `main_admin` (only `admin@scott.com`) |
| `status` | text | `pending`, `approved`, `rejected`, `completed` |
| `admin_note` | text | Optional reviewer note |
| `requested_at` | timestamptz | When user submitted |
| `reviewed_by` | uuid | FK → `profiles.id` — approving admin |
| `reviewed_at` | timestamptz | When approved/rejected |
| `approved_expires_at` | timestamptz | User must set password before this (7 days after approve) |
| `completed_at` | timestamptz | When user finished password change |

**Migration:** `20260710160000_add_password_reset_requests.sql` — table + RLS (admin select/update only; public writes via Edge Functions).

## Goal tracker

Annual goals, assignable tasks, and timestamped status remarks.

### `user_annual_goals`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → `profiles.id` — goal owner |
| `year` | integer | Calendar year (annual cycle) |
| `title` | text | Goal title |
| `description` | text | Optional detail |
| `ownership` | text | Grouping label (e.g. Sales, Operations). Null = uncategorized until user assigns in UI |
| `priority` | text | `P0`, `P1`, `P2` (default `P2`) — same scale as tasks |
| `status` | text | `not_started`, `in_progress`, `completed`, `on_hold` |
| `created_by` | uuid | Admin who created the goal |
| `created_at` / `updated_at` | timestamptz | Audit |
| `completed_at` | timestamptz | When owner/admin marked complete |
| `admin_verified_at` / `admin_verified_by` | timestamptz / uuid | Admin verification |

### `user_goal_tasks`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `goal_id` | uuid | Optional FK → `user_annual_goals.id` |
| `assignee_id` | uuid | FK → `profiles.id` |
| `assigned_by` | uuid | FK → `profiles.id` |
| `title` | text | Task title |
| `description` | text | Optional |
| `deadline_date` | date | Due date |
| `priority` | text | `P0` (top) … `P2` (least, default) |
| `status` | text | `pending`, `in_progress`, `completed`, `cancelled` |
| `completed_at` | timestamptz | When marked complete (checkbox or status) |
| `admin_verified_at` / `admin_verified_by` | timestamptz / uuid | Admin verification of completion |

### `user_goal_status_remarks`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `goal_id` / `task_id` | uuid | One of them required |
| `author_id` | uuid | Who updated status |
| `previous_status` | text | Before change |
| `new_status` | text | After change |
| `remark` | text | Required for non-admin updates |
| `created_at` | timestamptz | Timestamp of remark |

### Migration

| Migration | Change |
|-----------|--------|
| `20260706180000_add_goal_tracker.sql` | Tables, RLS, realtime publication |
| `20260707130000_add_goal_task_and_order_status_notifications.sql` | Task assignment + order status notification tables, `orders_status_notify` trigger |
| `20260707140000_goal_task_completion_verification.sql` | Completion timestamps + verification columns |
| `20260707150000_goal_assigner_verification_rls.sql` | Assignee/owner completion verify RLS; nullable task_id on notifications |
| `20260709190000_orders_realtime.sql` | Add `orders` + `order_customer_assets` to `supabase_realtime` publication for live status/asset sync |
| `20260709200000_dashboard_realtime_publication.sql` | Add dispatch, masters, profiles, contacts, shared links, dealers, inventory, printing dept tables to realtime |
| `20260709120000_goal_assign_link_visibility.sql` | RPC `get_goals_for_task_assignment`; task insert may link assignee-owned goals |
| `20260709130000_fix_goal_task_insert_rls.sql` | Task insert uses `jwt_user_owns_goal(goal_id, assignee_id)` |
| `20260709140000_task_verification_by_assigner.sql` | Task verify RLS: `assigned_by` not assignee |
| `20260709150000_add_task_priority.sql` | `user_goal_tasks.priority` P0–P2 + assignee priority index |
| `20260709160000_remove_task_priority_p3.sql` | Drop P3; migrate existing P3 → P2; default P2 |
| `20260710140000_add_goal_ownership.sql` | `ownership` column on goals; RPC returns ownership |
| `20260710150000_add_goal_priority.sql` | `priority` P0–P2 on goals; RPC updated |
| `20260709170000_add_profile_notification_tones.sql` | `profiles.notification_tone_path`; `notification-tones` storage bucket |

### `profiles.avatar_path`

| Value pattern | Meaning |
|---------------|---------|
| `preset:avatar-XX` | Built-in character from `/public/avatars/presets/` (no storage upload) |
| `{userId}/{uuid}-filename` | Uploaded photo in `profile-avatars` Supabase bucket |

Resolved for display by `profileAvatarPublicUrl()` in `src/avatarUtils.js`. Preset catalog: `src/presetAvatars.js`.

### `get_goals_for_task_assignment(p_assignee_id, p_year)`

Security-definer RPC for **Assign task → Link to goal**. Returns annual goals for the assignee/year so any authenticated assigner can populate the dropdown without broadening `user_annual_goals` SELECT RLS. Requires assignee to exist in `profiles`.

### `user_goal_task_notifications`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `recipient_user_id` | uuid | Assignee (FK → `profiles.id`) |
| `task_id` | uuid | FK → `user_goal_tasks.id` |
| `task_title` / `goal_title` | text | Snapshot for notification display |
| `goal_id` | uuid | Optional FK → `user_annual_goals.id` |
| `assigned_by_user_id` | uuid | Who assigned the task |
| `deadline_date` | date | Optional due date |
| `created_at` | timestamptz | When notification was created |

**RLS:** Recipient can read own rows; assigner can insert (skips self-assign in app).

### `order_status_notifications`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | bigint | Primary key |
| `recipient_user_id` | uuid | Coordinator or order creator |
| `order_id` | bigint | FK → `orders.id` |
| `order_display_id` | text | Human-readable order ref |
| `previous_status` / `new_status` | text | Status transition |
| `changed_by_user_id` | uuid | User who changed status (excluded from recipients) |
| `created_at` | timestamptz | When notification was created |

**Trigger:** `orders_status_notify` on `orders.status` UPDATE — notifies coordinator (name match on `profiles.full_name`) and `created_by`, excluding the actor.

## Team chat

Conversation-scoped messaging: direct (1:1), groups, GIF URLs, file attachments. Legacy wall messages live in **General** group.

### `team_chat_conversations`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `kind` | text | `direct` or `group` |
| `title` | text | Group name (null for direct) |
| `created_by` | uuid | FK → `profiles.id` |
| `last_message_at` | timestamptz | Inbox sort |
| `created_at` | timestamptz | Created time |

### `team_chat_conversation_members`

| Column | Type | Purpose |
|--------|------|---------|
| `conversation_id` | uuid | FK → `team_chat_conversations.id` |
| `user_id` | uuid | FK → `profiles.id` |
| `role` | text | `admin` or `member` |
| `joined_at` | timestamptz | Join time |
| `last_read_at` | timestamptz | Unread tracking |

**PK:** `(conversation_id, user_id)`.

### `team_chat_messages` (extended)

| Column | Type | Purpose |
|--------|------|---------|
| `conversation_id` | uuid | FK → `team_chat_conversations.id` (required for new messages) |
| `gif_url` | text | External GIF URL (Giphy search or preset) |
| `attachment_*` | text/bigint | File in `team-chat-files` bucket |
| `mentioned_user_ids` / `mentioned_order_ids` | uuid[] / bigint[] | @user and #order tokens |

**RLS:** SELECT/INSERT only when `jwt_user_in_conversation(conversation_id)`.

### RPCs

| Function | Purpose |
|----------|---------|
| `get_or_create_direct_conversation(p_other_user_id)` | Find or create 1:1 chat |
| `create_group_conversation(p_title, p_member_ids)` | New group; creator is admin |
| `mark_conversation_read(p_conversation_id)` | Sets `last_read_at` for current user |
| `jwt_user_in_conversation(conversation_id)` | RLS helper |
| `list_team_chat_directory()` | Mention picker profiles |

### Migrations

| Migration | Change |
|-----------|--------|
| `20260526120000_add_team_chat.sql` | Initial messages table |
| `20260706130000_team_chat_directory_avatars.sql` | Directory RPC + avatars |
| `20260709180000_team_chat_conversations.sql` | Conversations, members, GIF, member RLS, General migration |

## `inward_grn_entries`

Multiple GRN rows per inward entry. Labels print per GRN row.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | bigint | Primary key |
| `inward_entry_id` | bigint | FK → `inward_entries.id` |
| `grn_no` | text | GRN number |
| `for_whom` | text | Recipient / department |
| `supplier` | text | Supplier name |
| `invoice_no` | text | Supplier invoice |
| `qty_received` | text | Total qty (pieces for apparel, kg for fabric) |
| `bora_carton_unit` | text | Bora count (apparel) or lot count (fabric) |
| `location_rack` | text | Storage location |
| `received_by` | text | Person who received goods |
| `remark` | text | Optional note |
| `size_breakdown` | jsonb | Aggregated size totals (apparel) for labels |
| `grn_entry_detail` | jsonb | Full form: `type`, `header`, `boras[]`, `fabrics[]` |
| `created_by` | uuid | Auth user |
| `created_at` | timestamptz | Insert time |

### `grn_entry_detail` shape

```json
{
  "version": 1,
  "type": "apparel",
  "header": { "date": "2026-06-22", "forWhom": "", "receivedBy": "", "remark": "" },
  "boras": [{ "id": "…", "label": "Bora 1", "products": [{ "id": "…", "name": "…", "S": "12", "M": "24", "L": "24", "XL": "18", "XXL": "6" }] }],
  "fabrics": [{ "id": "…", "ftype": "…", "color": "…", "gsm": "180", "rolls": "4", "kgs": "96.5", "lot": "LOT-7781" }]
}
```

### Migrations

| Migration | Change |
|-----------|--------|
| `20260619120000_add_inward_grn_entries.sql` | Create table, RLS, legacy data move |
| `20260630120000_add_grn_entry_detail.sql` | Add `grn_entry_detail` jsonb |

## Inventory

### `inventory_style_parents` (legacy)

Parent style table from an earlier dashboard grouping feature. **No longer used by the UI** — kept for historical rows only. New SKUs do not link to parents (`parent_style_id` is null).

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `parent_sku_code` | text | Unique parent code (e.g. `STY-1`) |
| `style_name` | text | Display style name |
| `kind` | text | `fabric`, `trim`, or `apparel` |
| `created_by` | uuid | Auth user |
| `created_at` | timestamptz | Insert time |

### `inventory_skus`

Master SKU records (flat list — one row per `sku_code`).

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `sku_code` | text | Unique SKU code |
| `kind` | text | `fabric`, `trim`, or `apparel` |
| `name` | text | Style or material name |
| `parent_style_id` | uuid | **Legacy** FK → `inventory_style_parents.id` (nullable; unused for new SKUs) |
| `unit_cost` | numeric | Cost per unit |
| `retail_price` | numeric | Sale price (all kinds) |
| `reorder_point` | numeric | Low-stock threshold |
| `doc` | numeric | Days of cover |
| `drr` | numeric | Daily run rate — **computed in UI** from `scott_order_items` (last 30 days ÷ 30); column kept for export/display sync, not manually edited |
| `stock_qty` | numeric | On-hand quantity |
| `bin_location` | text | Storage location within warehouse (e.g. aisle/bin code); set on create SKU form or bulk upload |
| `warehouse_id` | uuid | FK → `inventory_warehouses.id` (home warehouse) |
| `extra` | jsonb | Kind-specific fields (sizes, GSM, etc.) |

### Migrations (inventory)

| Migration | Change |
|-----------|--------|
| `20260620120000_add_inventory_tables.sql` | Core inventory tables |
| `20260708120000_inventory_sku_parent_pricing_doc_drr.sql` | Parent styles, `doc`, `drr`, `parent_style_id` |
| `20260710120000_dashboard_stock_api.sql` | Facility stock, reservations, adjustments, webhook outbox, `inventory_warehouses.facility_code` |

### `inventory_warehouses.facility_code`

| Column | Type | Purpose |
|--------|------|---------|
| `facility_code` | text | External facility id for Stock API snapshot keys (e.g. `SCOTT_1DAY_01`). Unique when set. |
| `layout` | jsonb | Bin map for the warehouse page: `{ "zones": [{ "name": "A", "rows": 8, "cols": 10 }] }` (since `20260720150000_warehouse_edit_layout.sql`). |

**Facility code rename:** trigger `inventory_warehouses_propagate_facility_code` rewrites `inventory_facility_stock`, open reservations (`status = RESERVED`), open Scott orders (`PENDING`/`PROCESSING`), and `dashboard_channels.default_facility_code` when the warehouse facility code changes. Stock/Order API request/response shapes are unchanged — callers keep sending `facility_code`; only the value moves. Editable from Inventory → Warehouses → Edit, and Admin → Integrations → Facilities.

### `inventory_facility_stock`

Per-facility on-hand and reserved qty. **Available** = `on_hand_qty - reserved_qty`.

| Column | Type | Purpose |
|--------|------|---------|
| `sku_id` | uuid | FK → `inventory_skus.id` |
| `facility_code` | text | External facility code |
| `on_hand_qty` | numeric | Physical stock |
| `reserved_qty` | numeric | Held for open reservations |
| `updated_at` | timestamptz | Last mutation |

Constraint: `reserved_qty <= on_hand_qty`.

Sync (since `20260716140000_sync_sku_stock_to_facility.sql`): trigger `inventory_skus_sync_facility_stock` mirrors dashboard-UI `stock_qty` changes into this table (SKU's warehouse facility, `DEFAULT` fallback). Service-role writes are excluded — the `dashboard-stock-api` edge function maintains this table directly and writes back `stock_qty` on fulfill/adjust; syncing those again would double-count.

**Warehouse-scoped adjust (since `20260722180000_warehouse_facility_stock_adjust.sql`):** RPC `adjust_sku_facility_stock(sku_id, warehouse_id, target_on_hand, reason, reference, user_id)` — sets on-hand for one facility, recomputes SKU total from all facilities, logs movement. Used by Warehouses → Upload Bulk and manual Adjust when a warehouse is selected. Trigger skip flag `app.skip_facility_sync` prevents double-count on total recompute.

### `inventory_stock_reservations` / `inventory_stock_reservation_items`

RMP order holds from external backend. Status: `RESERVED` → `RELEASED` or `FULFILLED`.

### `inventory_stock_adjustments` / `inventory_stock_adjustment_items`

Audit log for manual +/- deltas via `POST /api/v1/stock/adjust`.

### `dashboard_webhook_outbox`

Outbound webhook queue (`stock.level_changed`, `stock.low_threshold`, `order.status_changed`). Edge function delivers with HMAC; failed rows stay `pending` for retry on next mutation.

### `scott_orders` / `scott_order_items` (since `20260720120000_scott_orders.sql`)

Scott International RMP orders — the external order lifecycle (`order-api-requirements.html`), **not** the internal printing-tracker `orders` table.

| Column (scott_orders) | Notes |
|--------|-------|
| `id` | `ord_*` text pk, returned as `dashboard_order_id` |
| `order_code` | Scott's code; partial unique index allows one open (PENDING/PROCESSING/COMPLETE) order per code |
| `status` | `PENDING` / `PROCESSING` / `COMPLETE` / `CANCELLED` / `FAILED` (check constraint) |
| `facility_code`, `due_on`, `customer`, `shipping_address`, `payment`, `comment` | Order payload (JSON columns for the nested objects) |
| `reservation_id` | FK → `inventory_stock_reservations` (the stock hold; `on delete set null`) |
| `cancel_reason`, `cancelled_at`, `dispatched_at` | Lifecycle metadata |
| `picklist_no`, `picklist_generated_at` | Warehouse picklist (since `20260722120000`); unique index on `picklist_no` when set |

`scott_order_items`: `order_id` (cascade), `item_code`, `sku_code`, `quantity`, `unit_price`, `dispatched_quantity` (set to `quantity` on COMPLETE).

Trigger `scott_orders_status_changed` enqueues `order.status_changed` into the outbox on every status transition (includes `dispatched_at` when COMPLETE). Order API mutations use `service_role` via `dashboard-stock-api`; picklist generation uses `scott-order-generate-picklist` (authenticated JWT → service role update). `authenticated` has read-only SELECT on orders/items.

### `dashboard_api_keys` / `dashboard_channels` (since `20260720140000_admin_integrations.sql`)

Admin Panel → Integrations.

- `dashboard_api_keys`: M2M keys for `dashboard-stock-api`. `key_hash` (SHA-256 hex, unique) + `key_prefix` for display — **plaintext never stored**. `status` active/disabled, `last_used_at` bumped by the edge function on successful auth. RLS: all ops require `jwt_user_is_admin()`; service_role has select/update.
- `dashboard_channels`: order-source registry — unique `code`, `channel_type` (CUSTOM/MOBILE_APP/SHOPIFY/AMAZON/FLIPKART/MYNTRA/JIOMART/OTHER check), `enabled`, optional `api_key_id` FK and `default_facility_code`. RLS: admin-only, service_role read.

### RPC (stock API)

| Function | Purpose |
|----------|---------|
| `facility_stock_available(sku_id, facility_code)` | Available qty helper |
| `inventory_sku_id_by_code(sku_code)` | Resolve SKU uuid |
| `enqueue_dashboard_webhook(event_type, payload)` | Insert outbox row |

### `inventory_sku_availability` (view)

Per-SKU, per-facility availability for the frontend (`security_invoker`): `sku_id`, `sku_code`, `facility_code`, `on_hand_qty`, `reserved_qty`, `available_qty` (= `greatest(0, on_hand − reserved)`), `updated_at`. SELECT granted to `authenticated`.

Access (since `20260716120000_facility_stock_read_access.sql`): mutations `service_role` only (edge function); **read-only SELECT** for `authenticated` on `inventory_facility_stock`, `inventory_stock_reservations`, `inventory_stock_reservation_items`, and the view. Adjustments/outbox stay `service_role` only. The migration also rewrites backfilled `facility_code` values that fell back to the warehouse id (e.g. `WH-01`) to the warehouse's real `facility_code` (merges quantities on collision).

## `orders` — job sheet payment / delivery / approval

Production tracker job sheets store payment and approval data on the same `orders` row (`is_production_order = true`).

| Column | Type | Purpose |
|--------|------|---------|
| `order_cost` | numeric | Total amount |
| `job_sheet_payment_mode` | text | Mode of payment (cash, UPI, bank transfer, etc.) |
| `job_sheet_advance_amount` | numeric | Advance received |
| `job_sheet_advance_payment_date` | date | Date advance was received |
| `job_sheet_advance_proof_url` | text | JSON array of transaction proof URLs (`payment-screenshots` bucket) |
| `job_sheet_balance_amount` | numeric | Total minus advance (snapshot at save) |
| `job_sheet_pending_amount` | numeric | Balance when not full paid; 0 when full paid |
| `job_sheet_full_paid` | boolean | Whether order is fully paid |
| `job_sheet_payment_closure_at` | timestamptz | Auto-set when full paid = yes |
| `job_sheet_payment_proof_url` | text | JSON array of final payment proof URLs |
| `job_sheet_delivery_city` | text | Delivery city (India) |
| `job_sheet_transport_charges` | numeric | Transport charges |
| `job_sheet_approval_date` | date | Approval date |
| `job_sheet_approval_image_url` | text | Approval image URL (`approved-designs` bucket) |
| `job_sheet_approved_by` | text | Approver name |
| `job_sheet_regular_stock` | boolean | Whether regular stock items are used |
| `job_sheet_regular_stock_items` | jsonb | Array of `{ sku_uuid, sku_code, name, color, qty }` from inventory |

### Migrations (job sheet payment)

| Migration | Change |
|-----------|--------|
| `20260703160000_add_job_sheet_payment_delivery_approval.sql` | Add columns above |
| `20260703180000_add_job_sheet_regular_stock.sql` | Regular stock flag + items jsonb |

## `orders.order_kind` — job sheet

| Value | Purpose |
|-------|---------|
| `printing` | Standard printing floor order |
| `job_sheet` | Production tracker job sheet only — **excluded** from Printing orders tab |
| `sticker`, `sampling`, `regular_stock` | Other specialized flows |

Job sheets: `order_kind = job_sheet`, `is_production_order = true`. Listed in **Production tracker** only (`filterProductionTrackerOrders`). Printing tab uses `filterPrintingTabOrders` to exclude `job_sheet`.

| Migration | Change |
|-----------|--------|
| `20260703200000_add_order_kind_job_sheet.sql` | Add `job_sheet` to check constraint; backfill existing job sheet rows |

## Job sheet production status (`orders.status`)

Garment pipeline for Production tracker (`order_kind = job_sheet`). Updated by production users with **Status** field permission in View order.

| Code | Label |
|------|-------|
| `quotation_approval` | Quotation approval |
| `sampling` | Sampling |
| `sourcing` | Sourcing |
| `sourcing_in_transit` | Sourcing in transit |
| `inward` | Inward |
| `cutting` | Cutting |
| `stitching` | Stitching |
| `trimming` | Trimming |
| `ironing` | Ironing |
| `qc` | QC |
| `packing` | Packing |
| `ready` | Ready to Dispatch |

| Migration | Change |
|-----------|--------|
| `20260703183000_job_sheet_production_stages.sql` | Extend `orders_status_check`; update `status_label()`; backfill `new` → `quotation_approval` for job sheets |

## `order_activity_log`

Append-only timeline for printing orders and production job sheets (same `orders` row, `is_production_order` distinguishes type).

| Column | Type | Purpose |
|--------|------|---------|
| `id` | bigint | Primary key |
| `order_id` | bigint | FK → `orders.id` |
| `event_type` | text | Event key (see below) |
| `message` | text | Human-readable summary |
| `meta` | jsonb | Structured before/after or snapshot |
| `actor_id` | uuid | Auth user (nullable) |
| `actor_label` | text | Display name at time of event |
| `created_at` | timestamptz | Event time |

**Trigger:** `trg_log_order_activity` on `orders` INSERT/UPDATE calls `log_order_activity()`.

**Printing event types:** `order_created`, `status_changed`, `marked_complete`, design review events, `remarks_updated`, `qty_updated`, `due_date_updated`, `coordinator_updated`, `printing_mtrs_updated`, `received_at_printing_updated`.

**Job sheet event types (added 20260703190000):** `job_sheet_created`, `sales_incharge_updated`, `product_name_updated`, `colors_updated`, `size_type_updated`, `gender_updated`, `product_type_updated`, `rate_per_piece_updated`, `size_breakdown_updated`, `brand_updated`, `fabric_type_updated`, `gsm_updated`, `branding_updated`, `atta_updated`, `expected_handover_updated`, `job_sheet_payment_updated`, `job_sheet_advance_proof_uploaded`, `job_sheet_payment_proof_uploaded`, `job_sheet_delivery_updated`, `job_sheet_approval_updated`, `job_sheet_regular_stock_updated`.

**UI labels:** `src/orderHistoryUtils.js` maps `event_type` → display label; modal title is **Job sheet history** when `is_production_order`.

### Migrations (activity log)

| Migration | Change |
|-----------|--------|
| `20260520180000_add_order_activity_log.sql` | Table + initial trigger |
| `20260703190000_job_sheet_activity_log.sql` | Job sheet field logging in trigger |
