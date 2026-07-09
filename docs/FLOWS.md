# Flows

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
2. **Services:** `createAnnualGoal()` with `user_id = created_by = auth.uid()` (owner insert RLS).
3. **Exit:** Goal appears in My goals; user can **Add task** on their goal.

## Goal tracker

### Admin sets annual goal

1. **Trigger:** Admin opens sidebar **Goals & Tasks** → **Manage users** tab.
2. **Entry:** Select user + year → **Create goal for user**.
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
