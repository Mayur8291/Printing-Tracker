# Changelog

## 2026-07-10 — Admin Roles & goals: minimal left-aligned user cards

- **UI:** User grid cards are full-width left column — name, one role line, one goals summary line, progress bar. Removed avatar/icons and extra task lines from overview cards; goal cards show title + one status line only.
- **Files:** `AdminRolesGoalsPanel.jsx`.

## 2026-07-10 — Admin Roles & goals: left-align user cards

- **UI:** User grid cards and goal cards in **Roles & goals** stack name, role, goals, progress bar, and tasks left-aligned (no split left/right rows).
- **Files:** `AdminRolesGoalsPanel.jsx`.

## 2026-07-10 — Policy: staging-first Supabase (migrations & edge functions)

- **Rule:** All `supabase db push`, migrations, and `functions deploy` default to **staging** (`scvojtvgnkmbupvyslmb`) only. Production (`levwrmvqdntngeasrtnb`) changes require explicit user request for production release.
- **Files:** `.cursor/rules/staging-first-supabase.mdc`, `.cursor/rules/staging-only-dev.mdc`, `docs/ENVIRONMENTS.md`.

## 2026-07-10 — Admin-approved password reset (login forgot password)

- **Feature:** Login **Forgot password?** → user submits reset request → admin approves in **Admin panel → Password resets** → user sets new password on login screen only (7-day approval window).
- **Routing:** Viewer requests → any admin; **admin** user requests → **main admin only** (`admin@scott.com`).
- **Migration:** `20260710160000_add_password_reset_requests.sql`.
- **Edge functions:** `request-password-reset`, `check-password-reset-status`, `complete-password-reset`, `admin-review-password-reset`.
- **Files:** `LoginPage.jsx`, `AdminPasswordResetRequestsPanel.jsx`, `passwordResetUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md, API.md.

## 2026-07-10 — Manage User Goals: show all user goals (incl. completed)

- **Issue:** Admin **Manage User Goals** tab looked empty when selected user only had completed goals — tab filtered to active goals only.
- **Fix:** Show all goals for the selected user (active + completed) with tasks; user picker merges team directory + admin viewer list; tab renamed from **Manage users** to **Manage User Goals**.
- **Files:** `GoalTrackerPanel.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-10 — Goals: ownership card grid, detail view, goal priority

- **UI:** My goals / Manage / Completed use ownership **card grid**; click card → full-page goals + tasks with **Back** button (not nested in-card list).
## 2026-07-10 — Goals: task priority colors visible in dark theme

- **Issue:** Task P0/P1/P2 badges washed out or invisible in dark mode (`theme-dark`).
- **Fix:** Dedicated `.task-priority-*` CSS for light + dark; badges on task title row; colored priority in assign/create selects.
- **Files:** `TaskPriorityBadge.jsx`, `index.css`, `GoalTrackerPanel.jsx`.
- **Feature:** Goal **priority** P0 / P1 / P2 (same as tasks); set on create; change in detail view dropdown.
- **Migration:** `20260710150000_add_goal_priority.sql` (staging + production applied).
- **Files:** `GoalTrackerPanel.jsx`, `goalTrackerUtils.js`, `AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** DATABASE.md, CHANGELOG.md.

## 2026-07-10 — Goals: ownership grouping (Ownership → Goal → Tasks)

- **Feature:** Annual goals have an **Ownership** field; My goals / Completed / Manage users tabs group goals under ownership headings. Legacy goals without ownership show under **Uncategorized** with **Set ownership** on each card.
- **Migration:** `20260710140000_add_goal_ownership.sql` — nullable `user_annual_goals.ownership`; updated `get_goals_for_task_assignment` RPC.
- **Files:** `goalTrackerUtils.js`, `GoalTrackerPanel.jsx`, `AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, DEBUGGING.md.

## 2026-07-10 — View order: order history modal visible again

- **Issue:** Order history not visible when opened from View order dialog.
- **Reason:** Modal rendered in app tree below Radix Dialog portal; focus trap blocked interaction.
- **Fix:** `OrderHistoryModal` portaled to `document.body`; View order `modal={false}` while history open; history button always in footer.
- **Files (new):** `src/components/OrderHistoryModal.jsx`.
- **Files:** `App.jsx`, `OrderDetailPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-10 — Postman collection for Dashboard Stock API

- **Feature:** Exportable Postman collection + staging/production environments for all stock endpoints and happy-path flow.
- **Files (new):** `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json`, staging/production environment JSON, `docs/postman/README.md`.
- **Documentation updated:** DASHBOARD_STOCK_API.md, CHANGELOG.md.

## 2026-07-10 — Dashboard Stock API (Scott International)

- **Feature:** Machine-to-machine stock API per `dashboard-api-requirements.pdf` — snapshot, reserve, release, fulfill, adjust + outbound webhooks.
- **Implementation:** Edge function `dashboard-stock-api` (Bearer `DASHBOARD_API_KEY`); migration `20260710120000_dashboard_stock_api.sql` for facility stock, reservations, adjustments, webhook outbox.
- **Files (new):** `supabase/functions/dashboard-stock-api/index.ts`, `docs/DASHBOARD_STOCK_API.md`, `docs/openapi/dashboard-stock-api.yaml`.
- **Files:** `supabase/config.toml` (`verify_jwt = false` for stock API).
- **Documentation updated:** API.md, ARCHITECTURE.md, DATABASE.md, CHANGELOG.md, FLOWS.md, DEBUGGING.md, SECURITY.md.

## 2026-07-09 — Inventory: Export SKU CSV

- **Issue:** Overview and SKU list **Export** buttons had no handler — click did nothing.
- **Fix:** CSV export utility downloads all SKU fields; overview fetches full SKU list from Supabase; list page exports filtered rows (or selected rows).
- **Files (new):** `src/inventory/inventorySkuExportUtils.js`.
- **Files:** `InventoryOverview.jsx`, `InventoryListPage.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-09 — Inventory overview: live KPI sparklines

- **Issue:** Overview KPI cards used hardcoded sparkline arrays and fake deltas; charts did not change when stock or SKUs updated.
- **Fix:** `buildInventoryOverviewKpis()` derives 14-day series from SKU stock, movements, alerts, and POs; realtime refresh reloads KPI movement window; deltas computed from actual trend.
- **Files (new):** `src/inventory/inventoryKpiUtils.js`.
- **Files:** `InventoryOverview.jsx`, `InventoryDataContext.jsx`, `inventoryDbUtils.js`, `inventoryQueryFields.js`, `Sparkline.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — View order: mockups preserved when approved images uploaded

- **Issue:** Uploading approved design images made mockup thumbnails vanish in View order.
- **Reason:** Recent-image patch merge returned `{ ...listRow, ...patch }` without re-merging mockup fields from the prior hydrated row; patch payload only contained `approved_design_images`.
- **Fix:** After applying image patch, run `mergeOrderDetailAssets()` again to keep `approved_design_url`; stash mockups in patch ref; re-hydrate order detail after successful upload.
- **Files:** `src/orderViewUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-09 — View order: mockup images no longer vanish on live refresh

- **Issue:** Mockup thumbnails in View order sometimes disappeared while the dialog stayed open.
- **Reason:** Silent order list refetch uses `ORDERS_LIST_SELECT` (no `approved_design_url`). Merge logic only preserved `approved_design_images`, and `viewOrderTarget` was replaced with the stripped list row on each realtime refresh.
- **Fix:** `mergeOrderDetailAssets()` keeps mockups, approved designs, archive, payment proof, and notes when list refetch omits them; View order syncs from merged row; opening an order always hydrates full detail row.
- **Files:** `src/orderViewUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, FLOWS.md.

## 2026-07-09 — Sidebar activity dots: correct tab only

- **Issue:** Saving a printing order showed activity dot on **Home** instead of only Printing Orders.
- **Reason:** `orders` (and goals tables) mapped to both their domain tab and `home`.
- **Fix:** Remove `home` from activity mappings; route `orders` by `order_kind` to Printing Orders, Production tracker, or Ready Stock Order.
- **Files:** `src/sidebarTabActivity.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — Printing order: SKU color auto-sync on product pick

- **Issue:** Picking inventory SKU (e.g. `6D-BL-S · 6 DEGREE · BLACK`) left Colors field showing wrong swatch (placeholder gray, wrong hex, or another variant).
- **Reason:** `colorsFromInventoryProduct()` preferred inventory `hex_color` (often default `#cccccc` or stale). Product picker also re-matched by **product name only**, so multiple SKUs named `6 DEGREE` could fight over selection.
- **Fix:**
  - Resolve order colors from SKU **color name**, **SKU code segments** (e.g. `BL` → black), then label text; use stored hex only when it is a real non-placeholder value.
  - Keep picker selection pinned by SKU `_uuid` when name matches; re-sync colors whenever selected SKU changes.
  - Color trigger dots use `swatchBackgroundForColor()` so named colors (e.g. `BLACK`) render correctly.
- **Files:** `src/inventory/inventoryProductPickerUtils.js`, `src/components/orders/PrintingOrderProductField.jsx`, `src/orderColorUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — Sidebar tab activity markers

- **Feature:** Blue dot on sidebar tab when data changes elsewhere (new printing order, task status update, dispatch entry, inventory, etc.).
- **Behavior:** Dot shows on tabs user is **not** viewing; clears when they open that tab. Chat keeps numeric unread badge.
- **Files (new):** `src/sidebarTabActivity.js`.
- **Files:** `App.jsx`, `DashboardAppSidebar.jsx`, `DashboardShell.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Dashboard-wide realtime sync

- **Issue:** Users and admins had to refresh to see updates from others (orders, dispatch, goals, inventory, contacts, etc.).
- **Reason:** Only some tables were on `supabase_realtime` and only a few panels subscribed to `postgres_changes`; most data loaded once on mount.
- **Fix:**
  - Migration `20260709200000_dashboard_realtime_publication.sql` — adds dispatch, masters, profiles, contacts, shared links, dealers, full inventory, printing dept tables to realtime publication.
  - Shared helper `src/realtimeUtils.js` — debounced multi-table subscriptions.
  - **App.jsx:** live masters, team profiles, admin permissions, global search; orders poll fallback 60s → 120s.
  - **Panels:** dispatch, contact book, shared links, goals (home + tab + admin), inventory bundle, printing dept inventory/utilization, dealer report.
- **Files (new):** `src/realtimeUtils.js`, `supabase/migrations/20260709200000_dashboard_realtime_publication.sql`.
- **Documentation updated:** CHANGELOG.md, ARCHITECTURE.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-09 — View order: mockup preview, status sync, customer assets

- **Issue 1 — Mockup preview behind dialog:** Click mockup in View order → image card hidden under order dialog.
- **Reason:** Preview rendered inside app shell; Radix Dialog portals to `document.body` at `z-50` and paints above in-app fixed layers.
- **Fix:** `ImagePreviewModal` portaled to `document.body` (`z-index: 2000`). Toolbar **Close** only (no hint, no backdrop/Esc dismiss). View order `Dialog` uses `modal={false}` while preview open so Radix does not block pointer events on the preview layer.
- **Issue 2 — Status not syncing across users:** One user changes status; others see stale value until manual refresh.
- **Reason:** App subscribed to `postgres_changes` on `orders`, but `orders` was never added to `supabase_realtime` publication.
- **Fix:** Migration `20260709190000_orders_realtime.sql` adds `orders` + `order_customer_assets` to realtime. `fetchOrders` also refreshes `viewOrderTarget` on silent refetch.
- **Issue 3 — Customer assets not view/download:** Some uploaded files fail to open or download.
- **Reason:** UI used `getPublicUrl()` without auth; bucket storage policy is `authenticated` only, so public URLs 403 for many files.
- **Fix:** Signed URLs via `createSignedUrl` (1h TTL); **View** for images/PDFs; **Download** with filename; realtime refetch when assets change on open order.
- **Files (new):** `src/components/ImagePreviewModal.jsx`, `supabase/migrations/20260709190000_orders_realtime.sql`.
- **Files:** `src/App.jsx`, `src/OrderDetailPanel.jsx`, `src/orderCustomerAssets.js`.
- **Bug fix:** Restored missing `ImagePreviewModal` import in `App.jsx` (blank screen after realtime work).
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, FLOWS.md, DATABASE.md.

## 2026-07-08 — Platform overview documentation (API, mobile, Uniware roadmap)

- **Added:** `docs/PLATFORM_OVERVIEW.md` — full stack brief (React + Supabase, not Flutter), API/mobile strategy, Uniware replacement phases, scaling, improvements.
- **Added:** `docs/OVERVIEW.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, Word export `docs/export/Scott_Dashboard_Platform_Overview.html` + `.doc`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-09 — Profile settings moved to sidebar (not Notifications tab)

- **Issue:** Avatar + notification tone lived on Notifications page — wrong place for user.
- **Fix:** Click sidebar **name/avatar** → **Profile settings** dialog: profile photo on top, notification tone below. Notifications tab = alert list only.
- **Files (new):** `src/components/profile/UserProfileSettingsDialog.jsx`.
- **Files:** `DashboardAppSidebar.jsx`, `DashboardShell.jsx`, `App.jsx`, `NotificationsPanel.jsx`.
- **Documentation updated:** FLOWS.md, CHANGELOG.md.

## 2026-07-09 — Preset profile avatars (50 characters)

- **Feature:** 50 built-in character avatars in `public/avatars/presets/`. Users pick from grid or upload photo.
- **Self-service:** Sidebar footer — click **name/avatar** → **Profile settings** dialog (avatar + notification tone).
- **Not in Notifications tab:** Alert list only on that page.
- **Admin:** **Create user** and **Edit user** include same picker (preset + upload).
- **Storage:** Presets stored as `profiles.avatar_path = preset:avatar-XX` (no bucket upload). Uploaded photos still use `profile-avatars` bucket.
- **Files (new):** `src/presetAvatars.js`, `src/components/profile/ProfileAvatarPicker.jsx`, `src/components/profile/ProfileAvatarSettings.jsx`.
- **Files:** `src/avatarUtils.js`, `src/App.jsx`, `src/ViewerUserEditModal.jsx`, `src/NotificationsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Production blank screen after removing .env from git

- **Issue:** Live site blank; console `Missing Supabase env vars`.
- **Cause:** Vite needs `VITE_SUPABASE_ANON_KEY` at Netlify build time; was previously supplied by committed `.env`.
- **Fix:** Set `VITE_SUPABASE_ANON_KEY` in Netlify production env; `VITE_SUPABASE_URL` in `netlify.toml` for production context.
- **Documentation updated:** DEBUGGING.md, RELEASE_AUTOMATION.md, CHANGELOG.md.

## 2026-07-09 — Fix Netlify production deploy blocked by secret scanning

- **Issue:** Production deploys on `main` failed with **Exposed secrets detected** (build exit code 2) after chat/goals release.
- **Cause:** `.env` (Supabase anon JWT) and `dist/` (Vite build with inlined env) were tracked in git; Netlify secret scan blocked publish.
- **Fix:** Add `dist/` to `.gitignore`; untrack `.env` and `dist/` from git. Document Netlify env setup (do not mark `VITE_*` as "Contains secret values").
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md, RELEASE_AUTOMATION.md.

## 2026-07-09 — Chat: no ghost DM until first message

- **Issue:** Picking a user in **New chat** (without sending) created a conversation — other user saw empty chat in inbox.
- **Fix:** Direct chat opens compose-only until first message; `get_or_create_direct_conversation` runs on send. Inbox hides empty direct conversations (no messages).
- **Files:** `src/TeamChatPanel.jsx`, `src/teamChatService.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Chat unread clear, highlight, message tone

- **Issue:** Unread badge stay after open chat; unread row hard to see; no sound on new chat message.
- **Fix:** Mark read clears badge immediately (optimistic + RPC). Unread rows get primary left border + bold text. New message play notification tone (respects `status_tones_enabled` + custom MP3); skip tone when user already viewing that thread.
- **Sidebar:** Chat tab shows total unread badge.
- **Files (new):** `src/teamChatNotificationUtils.js`.
- **Files:** `src/TeamChatPanel.jsx`, `src/teamChatService.js`, `src/App.jsx`, `DashboardAppSidebar.jsx`, `DashboardShell.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md.

## 2026-07-09 — Chat GIF search: Giphy (replaces Tenor)

- **Issue:** Tenor API discontinued / invalid keys — GIF Search tab empty.
- **Fix:** Switched to **Giphy** search + trending (`src/giphyGifApi.js`). Key via `VITE_GIPHY_API_KEY` in `.env`. Giphy allows browser CORS — no proxy needed.
- **Removed:** `src/tenorGifApi.js`, Vite Tenor proxy.
- **Files:** `src/components/chat/GifPicker.jsx`, `.env`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DATABASE.md.

## 2026-07-09 — Fix Tenor GIF search (CORS + v2 API)

- **Issue:** GIF Search tab empty — browser blocked direct Tenor calls (no CORS); old v1 endpoint discontinued; v2 requires `client_key` + Google Cloud API key (not old tenor.com demo key).
- **Fix:** `tenor-gif-search` Supabase Edge Function proxies Tenor v2; dev uses Vite proxy. Search tab shows errors when API fails; trending GIFs on empty query.
- **Files (new):** `src/tenorGifApi.js`, `supabase/functions/tenor-gif-search/index.ts`.
- **Files:** `src/components/chat/GifPicker.jsx`, `vite.config.js`.
- **Deploy:** `supabase functions deploy tenor-gif-search` + `supabase secrets set TENOR_API_KEY=<Google Cloud Tenor key>`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DEPLOYMENT.md.

## 2026-07-09 — Chat Enter to send + Tenor GIF key

- **Change:** Chat composer sends on **Enter**; **Shift+Enter** adds new line (WhatsApp-style).
- **Env:** `VITE_TENOR_API_KEY` enables GIF **Search** tab in chat picker.
- **Files:** `src/TeamChatPanel.jsx`, `.env`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Team chat v2 (DMs, groups, GIFs)

- **Issue:** Chat was one shared team wall — no private messages, no groups, no GIF send.
- **Fix:** WhatsApp-style inbox: conversation list, direct messages (any user → any user), group chats, GIF picker (presets + optional Tenor search via `VITE_TENOR_API_KEY`), file attachments kept. Legacy messages migrate into **General** group.
- **Database:** `20260709180000_team_chat_conversations.sql` — `team_chat_conversations`, `team_chat_conversation_members`, `conversation_id` + `gif_url` on messages, member-scoped RLS, RPCs `get_or_create_direct_conversation`, `create_group_conversation`, `mark_conversation_read`.
- **Files (new):** `src/teamChatService.js`, `src/components/chat/*`.
- **Files:** `src/TeamChatPanel.jsx`, `src/teamChatUtils.js`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-09 — Custom notification tone (MP3 upload)

- **Feature:** Every user can upload a personal MP3 notification tone on **Notifications** page. Custom tone plays for assignments, task alerts, order status, inward tags, and inventory alerts. **Preview**, **Replace**, or **Use default** (built-in sound).
- **Database:** `20260709170000_add_profile_notification_tones.sql` — `profiles.notification_tone_path`, `notification-tones` storage bucket + RLS.
- **Files (new):** `src/notificationToneUtils.js`, `src/notificationTonePlayer.js`, `src/components/notifications/NotificationToneSettings.jsx`.
- **Files:** `src/NotificationsPanel.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Remove P3 task priority

- **Change:** Priorities are **P0**, **P1**, **P2** only. Existing P3 tasks migrated to P2. Default on assign is P2.
- **Database:** `20260709160000_remove_task_priority_p3.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Task list priority filter

- **Feature:** **My tasks**, **Assigned by me**, and **All team tasks** tabs have a **Priority** dropdown — All, P0, P1, or P2. List stays sorted P0 → P2 within selection.
- **Files:** `src/goalTrackerUtils.js` (`filterTasksByPriority`), `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Task priority (P0–P2) on assign

- **Feature:** Assign task dialog adds **Priority** dropdown — P0 Top (red), P1 Medium (beige), P2 Less (green, default). Badge visible on goal tasks and task lists. **My tasks** sorted P0 → P2.
- **Database:** `20260709150000_add_task_priority.sql` — `user_goal_tasks.priority`, index on assignee + priority.
- **Files (new):** `src/components/goals/TaskPriorityBadge.jsx`.
- **Files:** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md.

## 2026-07-09 — Task verification by assigner (not assignee)

- **Issue:** Assignee could verify own completed task — wrong flow.
- **Fix:** When assignee marks task complete, **assigner** (`assigned_by`) gets verify controls + notification. RLS policy `goal tasks assigner verify completion`. Goals still verified by goal owner.
- **Files:** `src/goalTrackerUtils.js`, `src/AdminRolesGoalsPanel.jsx`.
- **Database:** `20260709140000_task_verification_by_assigner.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DEBUGGING.md, DATABASE.md.

## 2026-07-09 — Tasks stay on goal card; verification UI on card

- **Change:** Completed **tasks** no longer move to **Completed** tab — they stay on the goal card (and task list tabs). Only **goals** move to **Completed** when marked done.
- **UI:** Completed unverified tasks show **Pending verification** badge; verified tasks get strikethrough. Assignee remarks (e.g. “Not complete”) show below the task until verified.
- **Files:** `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-09 — Assign task: show assignee goals (RLS fix)

- **Issue:** **Link to goal** empty when assignee has goals (e.g. Test 2) — goals created by admin for that user not visible to assigner.
- **Reason:** RLS on `user_annual_goals` only allows owner, admin, or users with existing tasks on that goal. Task assigners could not read assignee goals before first link. Task insert also blocked linking to assignee-owned goals unless assigner owned the goal.
- **Fix:** Migration `20260709120000_goal_assign_link_visibility.sql` — `get_goals_for_task_assignment()` security-definer RPC for assign-task dropdown; task insert allows assignee-owned goals via `jwt_user_owns_goal(goal_id, assignee_id)` (`20260709130000_fix_goal_task_insert_rls.sql` — replaces RLS-blocked EXISTS subquery).
- **Files:** `src/goalTrackerUtils.js` (`fetchGoalsForTaskAssignment`), `src/GoalTrackerPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-07 — Assign task: link goal filtered by selected user

- **Fix:** **Link to goal** dropdown in Assign task shows only the selected **Assign to** user's goals for the current year (not everyone's goals).
- **Files:** `src/GoalTrackerPanel.jsx`.

## 2026-07-07 — Goals: assignee confirms completion (not admin)

- **Change:** Admin no longer verifies. Assignee marks complete → **Completed** tab → assignee **Verify complete** or **Not complete** with required remark (what still needs work). Goal owner same for goals. Notification on submit. Reject sends task/goal back to active with remark in history.
- **Database:** `20260707150000_goal_assigner_verification_rls.sql` — assignee/owner verify RLS; nullable `task_id` on goal notifications.
- **Files:** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`, `src/AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-07 — Admin completed tasks: labeled goal/task/user fields

- **Change:** Completed task rows (Goals **Completed** tab + Admin **Roles & goals**) now show labeled **Goal title**, **Task title**, **Task description**, and **User name** in a clear grid. Admin panel lists all completed tasks at top for review.
- **Files (new):** `src/components/goals/GoalTaskDetailGrid.jsx`.
- **Files:** `src/GoalTrackerPanel.jsx`, `src/AdminRolesGoalsPanel.jsx`.

## 2026-07-07 — Goals: checkbox complete + Completed tab + admin verification

- **Feature:** Users check box on task (assignee) or goal (owner) to mark complete — item moves out of active tabs into new **Completed** tab. Admin sees **Verify complete** / **Not complete** on completed items; verified badge when approved. Uncheck or admin reject moves back to active.
- **Database:** Migration `20260707140000_goal_task_completion_verification.sql` — `completed_at`, `admin_verified_at`, `admin_verified_by` on goals and tasks. Applied on staging.
- **Files:** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md, DATABASE.md, DEBUGGING.md.

## 2026-07-07 — Admin delete any goal or task

- **Feature:** Admin can delete any user's goal or task — **Goals & Tasks** (Manage users, All team tasks, goal cards) and **Admin panel → Roles & goals** (per-user goals, tasks assigned to/by them). Confirm dialog + error alert on failure. DB RLS already allowed admin delete.
- **Files:** `src/GoalTrackerPanel.jsx`, `src/AdminRolesGoalsPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-07 — Home: hide order status counts from normal users

- **Change:** **Order counts by status** grid on Home is admin-only. Normal users see Goals widget and their allowed tabs; no pipeline status overview.
- **Files:** `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-07 — Dispatch tab: shadcn UI migration

- **Change:** Dispatch section UI aligned with Printing Orders / LinkedOrdersTabPanel — shadcn `Tabs`, `Table`, `Button`, `Card`, `Skeleton`, `OrdersListSummary`, shared order badges/cells. App wrapper uses `space-y-4` instead of `dashboard-card`.
- **Files:** `src/DispatchTabPanel.jsx`, `src/OutwardChallanList.jsx`, `src/InwardEntryList.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-07 — Goals panel: My tasks tab first

- **Change:** Goals & Tasks tab order — **My tasks** first (default), then **My goals**.
- **Files:** `src/GoalTrackerPanel.jsx`.

## 2026-07-07 — Notifications: task assignments + order status updates

- **Feature:** Bell + Notifications page now include **task assigned to you** (goal tracker) and **order status updated** (coordinator + order creator). Realtime toasts for both; click opens Goals & Tasks or the order.
- **Database:** Migration `20260707130000_add_goal_task_and_order_status_notifications.sql` — `user_goal_task_notifications`, `order_status_notifications`, trigger `orders_status_notify`. Applied on staging.
- **Files (new):** `src/goalTaskNotificationUtils.js`.
- **Files:** `src/notificationsUtils.js`, `src/NotificationsPanel.jsx`, `src/App.jsx`, `src/goalTrackerUtils.js`, `src/components/notifications/AssignmentToastStack.jsx`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md, DEBUGGING.md.

## 2026-07-06 — Goals: user self-create + admin Roles & goals cards

- **Feature:** Users get **Create my goal** on Goals & Tasks → My goals. Admin **Roles & goals** tab (Admin panel) shows user cards with job role + progress; click card for goals, tasks, status, remarks. Admin **All team tasks** tab sees every task anyone created.
- **Database:** `20260706200000_goal_tracker_user_self_create.sql` — users can insert own annual goals. Applied on staging.
- **Files (new):** `src/AdminRolesGoalsPanel.jsx`.
- **Files:** `src/GoalTrackerPanel.jsx`, `src/goalTrackerUtils.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, FLOWS.md.

## 2026-07-06 — Sidebar: Goals & Tasks below Home

- **Change:** Moved **Goals & Tasks** from footer to Workspace section — order: Home → Goals & Tasks → Printing Orders.
- **Files:** `src/dashboardSidebarConfig.js`.

## 2026-07-06 — Fix dialog footer buttons (Assign task)

- **Issue:** Dialog buttons (e.g. Assign task) looked broken — no padding, misaligned Cancel vs primary action.
- **Reason:** Radix Themes `Button` adapter conflicted with shadcn `DialogFooter` / Tailwind design tokens.
- **Fix:** Restore native shadcn `Button` in `components/ui/button.jsx`; improve `DialogFooter` flex alignment with `gap-2` + `items-center`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Fix goal tracker RLS infinite recursion (staging)

- **Issue:** Home/Goals panel error: `infinite recursion detected in policy for relation user_annual_goals`.
- **Fix:** Migration `20260706190000_fix_goal_tracker_rls_recursion.sql` — security definer helpers break goals ↔ tasks policy cycle. Applied on staging `scvojtvgnkmbupvyslmb`.
- **Documentation updated:** DEBUGGING.md, CHANGELOG.md.

## 2026-07-06 — Goal tracker (annual goals, tasks, remarks)

- **Feature:** Annual goal tracker per user. Admin sets yearly goals + todo tasks with deadlines in sidebar **Goals & Tasks**. Any user can assign tasks to anyone. Non-admin status updates require timestamped remarks. Home page shows goal/task summary widget.
- **Database:** Migration `20260706180000_add_goal_tracker.sql` — `user_annual_goals`, `user_goal_tasks`, `user_goal_status_remarks` with RLS + realtime.
- **Files (new):** `src/goalTrackerUtils.js`, `src/GoalTrackerPanel.jsx`, `src/components/goals/HomeGoalTrackerPanel.jsx`.
- **Files:** `src/App.jsx`, `src/dashboardSidebarConfig.js`, `src/components/layout/DashboardAppSidebar.jsx`, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, FLOWS.md.

## 2026-07-06 — Inventory list pagination

- **Issue:** Apparel/Fabrics/Trims inventory showed all rows on one page (e.g. 3,894 apparel SKUs — disabled Prev/Next stub).
- **Fix:** Client-side pagination via shared `usePagination` (default 25/page, per-tab localStorage). Apparel paginates top-level style groups + standalone SKUs; fabrics/trims paginate SKU rows. Footer: per-page control + Prev/Next.
- **Files:** `src/inventory/pages/InventoryListPage.jsx`, `src/inventory/inventorySkuGrouping.js`, `src/orderPagination.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Radix Themes Button (via shadcn `Button` adapter)

- **Feature:** `src/components/ui/button.jsx` now renders `@radix-ui/themes` `Button` while keeping the same shadcn API (`variant`, `size`, `asChild`). All existing imports keep working. `buttonVariants` kept for calendar nav class names.
- **Theme:** `accentColor="gray"` + `radius="medium"` on root `<Theme>` to match zinc dashboard.
- **Files:** `src/components/ui/button.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Radix UI Themes provider

- **Feature:** Added `@radix-ui/themes` — global styles import in `main.jsx`, app wrapped in `<Theme>` (syncs with light/dark toggle; `hasBackground={false}` so shadcn/Tailwind layout stays in control).
- **Files:** `package.json`, `package-lock.json`, `src/main.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-04 — Production tracker list: inline status edit

- **Issue:** Production tracker list showed status as read-only badge only; users had to open View order to change status.
- **Fix:** New `OrderListStatusCell` — dropdown in list when user has **Status** edit permission on Production tracker tab (admin always). Uses same pipeline options and `persistOrderStatus` as View order.
- **Files (new):** `src/components/orders/OrderListStatusCell.jsx`.
- **Files:** `src/LinkedOrdersTabPanel.jsx`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Fix blank screen on View order (job sheet)

- **Issue:** Production tracker **View order** → blank screen again.
- **Reason:** (1) Duplicate `useState`/`useEffect` in `OrderDetailPanel` after partial edit — React hooks count mismatch crash. (2) Job sheet payment `Select` used `value={undefined}` when payment mode / delivery city empty — shadcn Select controlled/uncontrolled crash.
- **Fix:** Remove duplicate hooks; stable `Select` sentinel values in `JobSheetOrderPaymentSection`; status dropdown always includes current status option.
- **Files:** `OrderDetailPanel.jsx`, `JobSheetOrderPaymentSection.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Production tracker: job sheet garment pipeline statuses

- **Feature:** Job sheets in Production tracker use a dedicated production pipeline status: Quotation approval → Sampling → Sourcing → Sourcing in transit → Inward → Cutting → Stitching → Trimming → Ironing → QC → Packing → Ready to Dispatch. Production users with **Status** edit permission update status in View order or list badges.
- **Database:** Migration `20260703183000_job_sheet_production_stages.sql` extends `orders.status` check + `status_label()`; backfills `order_kind = job_sheet` rows from `new` → `quotation_approval`. New job sheets save with `status: quotation_approval`.
- **Files (new):** `src/jobSheetProductionStages.js`.
- **Files:** `src/OrderDetailPanel.jsx`, `src/LinkedOrdersTabPanel.jsx`, `src/stickerOrderUtils.js`, `src/components/orders/OrderStatusBadge.jsx`, `src/App.jsx`, `src/orderPendingUtils.js`, `src/globalSearchUtils.js`, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-03 — Job sheet view order: payment & transactions + admin edit

- **Issue:** View order for production job sheets did not show advance payments, transaction proofs, dates, delivery, or approval details. Admin could not edit payment fields after create.
- **Fix:** New **Payment & transactions** and **Delivery & approval** sections in order detail (`JobSheetOrderPaymentSection.jsx`). Admin can edit payment mode, advance amount/date, full paid, delivery city, transport, approval fields, and rate per piece; **Save changes** persists via `jobSheetAdminEditUtils.js`. Admin can upload advance proof, full payment proof, and approval image. Order queries now select all `job_sheet_*` payment columns.
- **Files (new):** `src/JobSheetOrderPaymentSection.jsx`, `src/jobSheetAdminEditUtils.js`.
- **Files:** `src/OrderDetailPanel.jsx`, `src/orderAdminEditUtils.js`, `src/orderQueryFields.js`, `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Fix blank screen on View order (production tracker)

- **Issue:** Clicking **View order** in Production tracker → blank screen.
- **Reason:** `OrderDetailPanel` referenced `jobSheet` before it was declared (`ReferenceError`).
- **Fix:** Reorder declarations in `OrderDetailPanel.jsx`; safe fallback for `OrderColorsCell` prop.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Blank screen gate rule + check:ui script

- **Issue:** Repeated blank screens after UI changes (missing imports, stale vars like `effectiveQty`, bad merges in `App.jsx`).
- **Fix:** Added `.cursor/rules/blank-screen-gate.mdc` (always apply), `npm run check:ui` (`scripts/check-ui-gate.mjs`) — build + JSX import heuristic before marking work done.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Job sheets: production tracker only (not printing list)

- **Issue:** Job sheets saved with default `order_kind: printing` — showed in Printing orders list with printing UI.
- **Fix:** New job sheets save as `order_kind: job_sheet`. Printing tab excludes job sheets; global search routes them to Production tracker only. Detail panel shows job sheet fields (gender, size type, rate, etc.) not printing payment/designs.
- **Follow-up:** Stronger `isJobSheetOrder()` for legacy rows; history modal stacks above create form and closes with view/create; **Production order** badge on billing + production tracker (like sticker); billing payment column uses job sheet payment mode.
- **Migration:** `20260703200000_add_order_kind_job_sheet.sql` — adds `job_sheet` to `order_kind` check + backfill existing rows.
- **Files:** `jobSheetUtils.js`, `orderTabUtils.js`, `App.jsx`, `OrderDetailPanel.jsx`, `orderPendingUtils.js`, `globalSearchUtils.js`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, DEBUGGING.md.

## 2026-07-03 — Job sheet: total quantity read-only from sizes

- **Fix:** **Total quantity** is read-only, computed from size grid sum — not mandatory, no manual entry. Fixes browser “Please fill out this field” when qty showed as placeholder only. Fixed blank screen on open (stale `effectiveQty` reference).
- **Files:** `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Job sheet: auto total amount (rate × quantity)

- **Fix:** **Total amount** on create job sheet form now auto-calculates as rate per piece × total quantity (read-only). Advance % and balance/pending use same computed total.
- **Files:** `jobSheetPaymentUtils.js` (`calcJobSheetTotalAmount`), `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Job sheet history (same as printing order history)

- **Feature:** Production tracker job sheets now log changes to `order_activity_log` and show **Job sheet history** in order detail (same modal as printing orders).
- **Events:** Create, status, qty, sales incharge, product/gender/size type, rate, size breakdown, brand/fabric/GSM, branding, atta, handover, payment, proofs, delivery, approval, regular stock.
- **Migration:** `20260703190000_job_sheet_activity_log.sql` — extends `log_order_activity()` trigger; applied to linked Supabase project.
- **Files:** `orderHistoryUtils.js` (new), `App.jsx`, `OrderDetailPanel.jsx`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md, DEBUGGING.md.

## 2026-07-03 — Job sheet: regular stock from inventory

- **Feature:** **Regular stock** Yes/No radio beside Atta. When Yes, pick inventory SKUs from searchable dropdown; each selection adds to a list with qty input.
- **Migration:** `20260703180000_add_job_sheet_regular_stock.sql` — `job_sheet_regular_stock`, `job_sheet_regular_stock_items` on `orders`; applied to staging.
- **Files:** `CreateJobSheetForm.jsx`, `JobSheetRegularStockField.jsx` (new), `jobSheetUtils.js`, `App.jsx`, `inventoryProductPickerUtils.js`, `orderQueryFields.js`, `schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-03 — Job sheet: merged balance/pending + mandatory full-paid proof

- **UI:** Single read-only field **Balance / Pending amount** (replaces separate balance and pending fields).
- **Validation:** Full paid = Yes requires payment proof on save; production jobs marked full paid without proof cannot be updated until proof is uploaded via order detail.
- **Files:** `CreateJobSheetForm.jsx`, `App.jsx`, `OrderDetailPanel.jsx`, `jobSheetPaymentUtils.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Job sheet: payment, delivery, and approval fields

- **Feature:** Create Job sheet form now includes payment block (mode, total, advance + %, advance date, transaction proof), computed balance/pending amounts, full-paid radio with auto closure date/time, payment proof upload, delivery city (India cities), transport charges, and approval date/image/approver.
- **Migration:** `20260703160000_add_job_sheet_payment_delivery_approval.sql` — new `orders.job_sheet_*` columns; applied to **staging** (`scvojtvgnkmbupvyslmb`) only.
- **Files:** `CreateJobSheetForm.jsx`, `jobSheetUtils.js`, `jobSheetPaymentUtils.js` (new), `indianCities.js` (new), `App.jsx`, `schema.sql`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-07-03 — Inventory tabs: Apparel first

- **Fix:** Reordered inventory kind tabs to **Apparel → Fabrics → Trims** in list view and sidebar; default list tab is Apparel.
- **Files:** `InventoryListPage.jsx`, `InventorySubNav.jsx`, `InventoryDashboard.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-03 — Faster inventory load (staged SKUs + deferred movements)

- **Issue:** Inventory tab slow to open — long skeleton with thousands of SKUs.
- **Reason:** `fetchInventoryBundle` loaded all SKU pages, 100 stock movements, and full supplier/warehouse rows before first paint.
- **Fix:** Initial load uses first 1000 SKUs (`INVENTORY_SKU_LIST_SELECT`), background fetch for remaining SKUs, movements deferred (2.5s or when Movements tab opens). SKU drawer hydrates full row + last 6 movements on open. Slim supplier/warehouse selects.
- **Files:** `src/inventory/inventoryQueryFields.js` (new), `inventoryDbUtils.js`, `InventoryDataContext.jsx`, `InventoryDashboard.jsx`, `SkuDrawer.jsx`, `InventoryMovementsPage.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Faster initial load (orders list query + deferred extras)

- **Issue:** Dashboard felt slow after login — long loading skeleton before orders appeared.
- **Reason:** `fetchOrders` downloaded every order with heavy design image URL JSON for all rows. Global search extras (400 challans + contacts) ran immediately on login. Orders also polled every 25s on top of realtime.
- **Fix:** Split order queries — lightweight `ORDERS_LIST_SELECT` for list/tabs; full `ORDERS_FULL_SELECT` loaded when opening order detail (`hydrateOrderDetail`). Deferred global search extras by 2.5s. Poll interval 25s → 60s and only when tab visible.
- **Files:** `src/orderQueryFields.js` (new), `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-07-03 — Enforce staging-only local dev + environment health docs

- **Issue:** Risk of local dev or agents touching production Supabase during development.
- **Fix:** `supabaseClient.js` blocks dev server when production URL is loaded (escape: `VITE_ALLOW_PROD_IN_DEV=true`). Compact green pulse dot before global search shows staging (tooltip on hover); amber dot if prod. `npm run check:env` verifies dev commands. `VITE_APP_ENV=staging` on `.env.development` / `.env.staging`. Documented prod vs staging health and MCP rules in `docs/ENVIRONMENTS.md`. Cursor rule `.cursor/rules/staging-only-dev.mdc`.
- **Files:** `src/supabaseClient.js`, `src/components/DevEnvironmentIndicator.jsx`, `src/App.jsx`, `scripts/check-dev-env.mjs`, `package.json`, env examples, `docs/ENVIRONMENTS.md`, `.cursor/rules/staging-only-dev.mdc`.
- **Documentation updated:** CHANGELOG.md, ENVIRONMENTS.md.

## 2026-07-03 — Fix orders table empty after save (missing DB columns)

- **Issue:** Orders vanished after saving jobs — loading skeleton, then empty table. Saves could succeed in DB but UI could not reload rows.
- **Reason:** `fetchOrders` selects `gender` and `product_type`, but migration `20260709120000_add_job_sheet_gender_product_type.sql` was not applied to production or staging Supabase projects. PostgREST failed the entire select; errors were console-only.
- **Fix:** Applied `add_job_sheet_gender_product_type` migration to production (`levwrmvqdntngeasrtnb`) and staging (`scvojtvgnkmbupvyslmb`). Added `ordersLoadError` alert in Printing tab when order fetch fails.
- **Files:** `src/App.jsx`, `docs/DEBUGGING.md`, `docs/CHANGELOG.md`.
- **Migration applied remotely:** `add_job_sheet_gender_product_type`.

## 2026-06-25 — Production tracker: Pets uses standard size grid

- **Issue:** Pets gender lost normal XXS–8XL quantity inputs.
- **Fix:** When gender is **Pets**, size grid uses standard alpha columns (XXS–8XL) with qty inputs like before; product type and size type dropdowns hidden. Additional sizes still available.
- **Files:** `jobSheetUtils.js`, `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Production tracker: fixed product type list

- **Fix:** Product type dropdown now uses fixed list: Denim Pant, Hoodies, Jacket, Polo, Round Neck, Shirt, Shorts, Skirts, Trackpant, V Neck (filtered by gender). Kids Polos maps to Polo; trackpants normalize to Trackpant. Pets gender skips product type.
- **Files:** `jobSheetSizeTypeConfig.js`, `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, README.md.

## 2026-06-25 — Production tracker: gender + product type dropdowns

- **Issue:** Job sheet only had size type; no separate gender or product type fields.
- **Fix:** Added **Gender** (Kids / Women / Men / Pets) and **Product type** (Shorts, Polo, Hoodies, etc.) dropdowns before size type. Options filter by selection; size type list narrows to matching style from size set helper. Saved on `orders.gender` and `orders.product_type`.
- **Migration:** `20260709120000_add_job_sheet_gender_product_type.sql`
- **Files:** `CreateJobSheetForm.jsx`, `jobSheetSizeTypeConfig.js`, `jobSheetUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, README.md, schema.sql.

## 2026-06-25 — Production tracker: size types from size set helper sheet

- **Issue:** Job sheet size type dropdown used generic options (Alpha/Numeric/Free/Custom) with no per-style size templates.
- **Reason:** `JOB_SHEET_SIZE_TYPES` was hard-coded placeholders; Excel **size set helper** defines 25 product styles with template numbers/labels beside each size (not quantities).
- **Fix:** New `jobSheetSizeTypeConfig.js` with all styles from the sheet (Kids Shorts, Men Polo, Kids Polos age ranges, etc.). Selecting size type loads the correct column set; headers show **size · template** (e.g. `M · 32`, `XXS · 0-2 Yrs`). Quantity inputs stay separate below each header.
- **Files:** `jobSheetSizeTypeConfig.js` (new), `jobSheetUtils.js`, `CreateJobSheetForm.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md, README.md.

## 2026-06-25 — SKU management: parent/sub SKUs save to inventory

- **Issue:** Adding parent or sub SKU in SKU management did not show up in the main inventory list.
- **Reason:** Parent-only rows live in `inventory_style_parents` (not stock records). Sub SKU flow opened a separate modal without calling `createSku` inline, and empty parents were omitted from the apparel grouped table.
- **Fix:** **Add sub SKU** now opens `AddSubSkuDialog` that calls `createSku` and writes to `inventory_skus`. After **Add parent SKU**, first sub SKU dialog opens automatically. Apparel list merges empty parent styles so new groups appear before variants exist.
- **Files:** `AddSubSkuDialog.jsx` (new), `SkuManagementModal.jsx`, `InventoryListPage.jsx`, `InventoryDashboard.jsx`, `inventorySkuGrouping.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory: SKU management panel

- **Issue:** No dedicated UI to browse parent styles, view sub SKUs, or add parent/sub SKUs outside the create-style flow.
- **Fix:** **SKU management** button on inventory list toolbar opens a dialog with parent SKU list (left), sub SKU table on parent click (right), **Add parent SKU** inline form, and **Add sub SKU** opens create modal locked to selected parent.
- **Files:** `SkuManagementModal.jsx` (new), `InventoryListPage.jsx`, `InventoryDashboard.jsx`, `InventoryDataContext.jsx` (`createStyleParent`), `NewSkuModal.jsx` (`initialParent`), `inventorySkuGrouping.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory tables: true shadcn styling + inline DOC/DRR

- **Issue:** Inventory list still looked legacy — blue gradient table headers, blue cell borders, static DOC/DRR numbers.
- **Reason:** Global `styles.css` rules targeted all `th`/`td` (blue gradient headers). Shadcn `Table` had no isolation marker.
- **Fix:** `data-shadcn-table` on shadcn Table + CSS isolation in `index.css` and scoped legacy rules in `styles.css`. Reorder/DOC/DRR columns use shadcn `Input` (`SkuMetricInput`) with save on blur. Toolbar/card use shadcn tokens.
- **Files:** `table.jsx`, `index.css`, `styles.css`, `InventoryListPage.jsx`, `SkuMetricInput.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory UI: remove Lucide icons

- **Issue:** Inventory module still used Lucide icons in nav, tables, modals — not aligned with shadcn-only UI policy.
- **Fix:** Removed all `lucide-react` imports under `src/inventory/`; buttons use text labels, shadcn `Alert`/`Badge`/`MovementTypeBadge`, and text sort/expand indicators.
- **Files:** All inventory pages, modals, `InventorySubNav.jsx`, `inventoryUiUtils.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Inventory: parent SKU groups, pricing, DOC & DRR

- **Issue:** SKUs were flat list only; no parent/sub style grouping; pricing limited to apparel retail; no DOC/DRR fields.
- **Fix:** New `inventory_style_parents` table; SKUs link via `parent_style_id`. Create apparel style: choose **new parent** or **existing parent** + sub SKU code. Per-SKU **unit cost + sale price** for all kinds. **Reorder**, **DOC** (days of cover), **DRR** (daily run rate) on create and in SKU drawer. Apparel list groups variants under expandable parent rows.
- **Migration:** `20260708120000_inventory_sku_parent_pricing_doc_drr.sql`
- **Files:** `inventoryDbUtils.js`, `InventoryDataContext.jsx`, `NewSkuModal.jsx`, `InventoryListPage.jsx`, `SkuDrawer.jsx`, `inventorySkuGrouping.js`, migration.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.

## 2026-06-25 — Live sync: printing product picker ↔ inventory SKUs

- **Issue:** New inventory SKUs did not appear in Create printing order product list until page reload.
- **Fix:** Supabase Realtime on `inventory_skus`; debounced silent refetch updates printing product picker and inventory tab when SKUs are added/updated/deleted.
- **Migration:** `20260707120000_inventory_skus_realtime.sql` (add table to `supabase_realtime` publication).
- **Files:** `App.jsx`, `InventoryDataContext.jsx`, migration.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix printing product picker missing SKUs

- **Issue:** Product name dropdown did not show all inventory SKUs.
- **Reason:** Single Supabase query capped at default row limit; shadcn `Select` viewport height matched trigger (one row visible, poor scroll).
- **Fix:** Paginated fetch for all SKUs; searchable scrollable Popover combobox with SKU code + name + color; global Select viewport scroll fix.
- **Files:** `PrintingOrderProductField.jsx`, `inventoryProductPickerUtils.js`, `select.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Printing order product picker from inventory

- **Issue:** Create printing order used free-text product name; colors picked manually.
- **Fix:** Product name is shadcn select from inventory SKUs (Apparel, Fabrics, Trims groups) plus **Custom** for manual entry. Picking inventory product auto-fills Colors from SKU hex/name.
- **Files:** `PrintingOrderProductField.jsx`, `inventoryProductPickerUtils.js`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Keep production block after job sheet save

- **Issue:** After saving job sheet from create printing order form, production section reset (Production = No, handover cleared) — no confirmation.
- **Reason:** `handleCreateJobSheet` cleared `is_production_order` and handover on success.
- **Fix:** Keep Production order Yes/No and handover date visible; show green shadcn **Job sheet created** alert with order #; hide Create job sheet button after success; final printing order still saves as printing-only when job sheet already created.
- **Files:** `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Admin empty dropdown: add & use inline

- **Issue:** Master-list dropdowns (owners, coordinators, sales incharges, inventory suppliers/warehouses) were empty with no way to add an entry in place.
- **Reason:** Admin had to leave the form and use Admin Panel master toolbar separately.
- **Fix:** New shadcn `MasterListSelectField` — when options are empty and user is admin, shows name input + **Add & use**; saves to DB, refreshes list, auto-selects. Wired to create order (owner/coordinator), job sheet (sales incharge), order detail, repeat template, inventory SKU/PO modals.
- **Files:** `MasterListSelectField.jsx`, `App.jsx`, `OrderDetailPanel.jsx`, `CreateJobSheetForm.jsx`, `InventoryDataContext.jsx`, `inventoryMasterQuickAdd.js`, `NewSkuModal.jsx`, `CreatePOModal.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Create job sheet from printing order form (handover row)

- **Issue:** User wanted **Create job sheet** beside the handover date in Create New Order (Production order = Yes), not in the order list rows.
- **Reason:** Prior change put the button on each list row; correct UX is inline on the production handover field while creating a printing order.
- **Fix:** shadcn **Create job sheet** button next to handover `DatePicker`. Opens job sheet form pre-filled from current printing form. On save: job sheet → Production Tracker; printing form resets to **Production order: No** so saved printing order is regular only. Row-level list buttons removed.
- **Files:** `App.jsx`, `jobSheetUtils.js`, `OrderViewActionCell.jsx`, `styles.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — shadcn-only UI standard + blank-screen gate

- **Policy:** All new and migrated UI must use shadcn components only (no legacy buttons/inputs/modals).
- **Pre-build gate:** Before finalizing UI work — run `npm run build`, verify imports in changed files, check dev terminal for HMR/JSX errors, confirm app loads (no blank screen).
- **Files:** `.cursor/rules/shadcn-ui-only.mdc`, `docs/DEBUGGING.md`.
- **Documentation updated:** CHANGELOG.md, DEBUGGING.md.

## 2026-06-25 — Fix blank screen after View Order Dialog change

- **Issue:** App showed blank white screen on load.
- **Reason:** `CreateOrderModal` import was accidentally removed from `App.jsx` when adding shadcn `Dialog` for View Order; React crashed with `ReferenceError: CreateOrderModal is not defined`.
- **Fix:** Restored `import CreateOrderModal from "./components/orders/CreateOrderModal"`.
- **Files:** `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — View order modal shadcn UI

- **Issue:** View order modal had mismatched legacy buttons (purple Mark complete, red Delete, plain Save) and form controls that did not match shadcn dark theme.
- **Reason:** `OrderDetailPanel` still used legacy CSS classes (`btn-mark-complete`, `danger-btn`, `order-detail-control`, `status-pill`) inside old modal shell.
- **Fix:** Migrated panel to shadcn `Button`, `Input`, `Select`, `Textarea`, `Checkbox`, `Badge`, `OrderStatusBadge`, and `DatePicker`. Wrapped modal in shadcn `Dialog`. Footer actions use proper variants: outline / default / secondary / destructive.
- **Files:** `OrderDetailPanel.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Prevent duplicate order saves + pending row loader

- **Issue:** Orders sometimes saved multiple times on double-submit; form stayed open during long uploads; no in-list feedback while saving.
- **Reason:** Regular create-order handler had no submit lock or `saving` state; async upload+insert allowed repeated clicks. Other forms closed only after save finished.
- **Fix:** Global `orderSubmitLockRef` blocks concurrent submits across all order forms. After validation, form closes immediately, optimistic pending row appears at top of Printing / Production Tracker lists with shadcn `Loader2` spinner instead of “View order”; pending clears after insert + refresh. Added `savingOrder` on main create form submit button.
- **Files:** `App.jsx`, `OrderViewActionCell.jsx`, `orderPendingUtils.js`, `LinkedOrdersTabPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Global search dropdown scroll

- **Issue:** Global search results list would not scroll; wheel moved the dashboard behind the dropdown instead.
- **Reason:** `ScrollArea` with only `max-h-72` never got a fixed height (Radix viewport stayed full content height). Dropdown also lived inside `overflow-hidden` shell without portal, so wheel events bubbled to `[data-dashboard-scroll]`.
- **Fix:** Render results in shadcn `PopoverContent` (portals to body). Replaced `ScrollArea` with native `overflow-y-auto max-h-72` and `overscroll-contain`; stop wheel propagation at list edges. Header set `overflow-visible`.
- **Files:** `GlobalSearchBox.jsx`, `DashboardShell.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Printing, Billing, Production Tracker shadcn UI

- **Issue:** Printing, Billing, and Production Tracker still showed legacy blue summary bar, bordered tables, status pills, and native tab buttons.
- **Reason:** Those panels used old CSS classes (`orders-processed-summary`, `orders-table-compact`, `status-pill`, `orders-tab`) inside `.legacy-ui`; global `table`/`th`/`td` rules overrode shadcn styling.
- **Fix:** Migrated all three areas to shadcn `Card` summary, `Table`, `Badge`, `Tabs`, `Button`, `Skeleton`. Shared components: `OrdersListSummary`, `OrderStatusBadge`, `OrderIdBadges`, `orderTableUtils`. Added `data-orders-table` CSS isolation from legacy global table rules.
- **Files:** `BillingTabPanel.jsx`, `LinkedOrdersTabPanel.jsx`, `PrintingDepartmentPanel.jsx`, `App.jsx`, new order components under `components/orders/`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Admin edit user modal shadcn UI

- **Issue:** Edit user access modal had broken layout — huge misaligned checkboxes and floating labels in Order & sidebar access.
- **Reason:** Modal lived inside `.legacy-ui`; global rule styled all `input` as full-width `h-9` text fields, including native checkboxes. Legacy CSS grid fought shadcn components.
- **Fix:** Rebuilt `ViewerUserEditModal` with shadcn `Dialog`, `Input`, `Label`, `Select`, `Switch`, `Button`. Extracted `OrderFieldPermissionFields` with shadcn `Checkbox` grid. Refreshed `SidebarTabPermissionFields` with Tailwind table layout. Create-user permissions in `App.jsx` use same component. Legacy input rule excludes checkbox/radio/file types.
- **Files:** `ViewerUserEditModal.jsx`, `OrderFieldPermissionFields.jsx`, `SidebarTabPermissionFields.jsx`, `App.jsx`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Calendar date hover highlight

- **Issue:** Hovering calendar dates did not show the rounded highlight box like shadcn reference.
- **Reason:** Calendar override CSS reset cell/button backgrounds without hover rules; day button missed explicit `hover:bg-accent` and used wrong `rdp-day` class key.
- **Fix:** Restored shadcn day-button hover/focus/selected classes; CSS adds `hover` accent background on `button[data-day]`; `today` cell no longer forced transparent; DatePicker calendar uses `rounded-md border shadow-sm` per shadcn demo.
- **Files:** `calendar.jsx`, `date-picker.jsx`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix calendar size (global table CSS)

- **Issue:** Calendar still huge with bordered cells — not matching compact shadcn reference.
- **Reason:** Global `styles.css` rules `table { min-width: 1120px }` and `th, td { border; padding: 8px }` applied to react-day-picker's `table.rdp-month_grid`, blowing up the popover to full dashboard width.
- **Fix:** Scoped dashboard table rules to exclude `.rdp-month_grid` / `.rdp-weekday` / `.rdp-day`. Added calendar-specific resets in `index.css` (14rem / 2rem cells). Day buttons fixed to `h-8 w-8` without `w-full`.
- **Files:** `styles.css`, `index.css`, `calendar.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix calendar overlap / detached caption

- **Issue:** Calendar popover huge; month/year caption floated away from grid and overlapped action buttons.
- **Reason:** `react-day-picker` nav is `position: absolute` across full `.rdp-months` width — when months container expanded, prev/next/caption split apart. Legacy CSS could also inflate dropdown `select` elements.
- **Fix:** Restored official shadcn `Calendar` with fixed month width (`7 × --cell-size`), `w-fit` months container, `navLayout` default overlay, `DatePicker` popover `z-[200]` + `className="rounded-lg border"`. CSS isolates calendar dropdown selects and popper stacking.
- **Files:** `calendar.jsx`, `date-picker.jsx`, `index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Compact shadcn calendar everywhere

- **Issue:** Date picker calendar grid was huge — cells stretched across full dashboard width instead of compact shadcn popover.
- **Reason:** Calendar month/week used `w-full` + `flex-1` without fixed cell width, so popover expanded to viewport; legacy global button min-heights could also inflate day cells.
- **Fix:** Calendar uses fixed `--cell-size: 2rem` and `w-fit` grid; `DatePicker` compact format (`MMM d, yyyy`), dropdown caption, `minDate`/`maxDate` support. CSS isolates `[data-slot="calendar"]` from legacy styles. Replaced remaining native `type="date"` inputs with `DatePicker` in order detail, dealer report, contact book, inward GRN, and order templates.
- **Files:** `calendar.jsx`, `date-picker.jsx`, `index.css`, `OrderDetailPanel.jsx`, `DealerReportPanel.jsx`, `ContactBookPanel.jsx`, `InwardGrnEntryPage.jsx`, `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix dashboard scroll (shadcn shell, pass 2)

- **Issue:** Scroll still stuck after first fix — inventory table and other tabs would not scroll.
- **Reason:** Flex chain broken at multiple points: `App.jsx` inner wrapper missing `min-h-0`; `InventoryDashboard` fragment broke flex; Radix `ScrollArea` used without height (expands to full content); `h-full` chain unreliable without `html/body/#root` height lock.
- **Fix:** Shell uses explicit `h-svh` on provider; scroll region tagged `[data-dashboard-scroll]`. Full flex chain with `min-h-0` from shell → inventory panel → list table (`overflow-y-auto`). Replaced broken `ScrollArea` with native overflow on inventory table. `html/body/#root` height + overflow lock so inner regions scroll.
- **Files:** `DashboardShell.jsx`, `App.jsx`, `InventoryTabPanel.jsx`, `InventoryDataContext.jsx`, `InventoryDashboard.jsx`, `InventorySubNav.jsx`, `InventoryListPage.jsx`, `index.css`, `responsive-desktop.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Fix dashboard scroll (shadcn shell)

- **Issue:** Could not scroll anywhere — inventory table and other tabs clipped with no scrollbar.
- **Reason:** Desktop CSS locks `.page.app-layout` to `100dvh` + `overflow: hidden` (old layout scrolled inside `.dashboard-main`). After shadcn `SidebarProvider` / `SidebarInset` migration, no inner region had `overflow-y: auto` or a bounded flex height chain.
- **Fix:** `DashboardShell` — provider/inset use `h-full min-h-0 overflow-hidden`; main content area gets `flex-1 overflow-y-auto` (full-bleed tabs scroll inside their panel). `App.jsx` page wrapper is flex column `h-svh`. Inventory + asset panels use `flex-1 min-h-0` instead of fixed `calc(100vh…)` heights. Desktop CSS targets shadcn sidebar wrapper.
- **Files:** `DashboardShell.jsx`, `App.jsx`, `InventoryTabPanel.jsx`, `InventoryDashboard.jsx`, `AssetManagementPanel.jsx`, `responsive-desktop.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Team chat shadcn UI

- **Issue:** Team chat used legacy panel CSS, native buttons/textarea, and emoji popover styling inconsistent with shadcn migration.
- **Fix:** Rebuilt `TeamChatPanel` with shadcn `Card`, `ScrollArea`, `PersonAvatar`, `Textarea`, `Button`, `Badge`, `Popover`, `Alert`, `Separator`. Message bubbles with own/other styling; Lucide toolbar icons. Team directory RPC + fallback query include `avatar_path`.
- **Migration:** `20260706130000_team_chat_directory_avatars.sql` (drops + recreates RPC — Postgres cannot change return type with `CREATE OR REPLACE` alone).
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Fix skewed avatars

- **Issue:** Profile photos in admin user table (and contact cards) looked stretched or oval.
- **Reason:** `AvatarImage` lacked `object-cover`; table cells and legacy 72×72 contact photo box squashed non-square containers.
- **Fix:** Shadcn avatar uses `object-cover` + `aspect-square`; fixed-width avatar table column; contact card photo wrapper no longer forces rectangle clip over round avatar.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Admin action button icon size

- **Issue:** Edit/delete icons in admin user & master directory tables looked too small inside their buttons.
- **Reason:** Legacy CSS forced 28×28px buttons with 15×15px SVGs.
- **Fix:** Replaced with shadcn `Button` (`size="icon"`, 36px) + Lucide `Pencil`/`Trash2` at 18px. Removed overly tight admin CSS overrides.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Fix blank admin panel

- **Issue:** Admin tab showed blank screen on open.
- **Reason:** `OrdersPerPageControl` used in admin user list footer but removed from `App.jsx` imports during pagination refactor — runtime `ReferenceError` crashed the panel.
- **Fix:** Restored `OrdersPerPageControl` import in `App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-07-06 — Profile & contact avatars (shadcn)

- **Issue:** Contacts had photo upload but legacy image UI; dashboard users had no avatar field or picker.
- **Fix:** Added `profiles.avatar_path` + `profile-avatars` storage bucket. Shared `PersonAvatar`, `AvatarUploadField`, and `avatarUtils`. Contact Book uses shadcn avatars for cards and upload. Admin user create/edit and sidebar footer show profile photos with initials fallback.
- **Migration:** `supabase/migrations/20260706120000_add_profile_avatars.sql`
- **Files:** `src/avatarUtils.js`, `src/components/ui/person-avatar.jsx`, `avatar-upload-field.jsx`, `ContactBookPanel.jsx`, `ViewerUserEditModal.jsx`, `App.jsx`, sidebar layout, `supabase/schema.sql`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Broad shadcn UI migration (orders, printing, reports)

- **Issue:** Many screens still used legacy HTML buttons, native date inputs, and `modal-backdrop` panels while shadcn components were installed but unused in key flows.
- **Fix:** Rolled shadcn across high-traffic areas using installed components (`Button`, `Input`, `Label`, `Select`, `Textarea`, `Checkbox`, `Dialog`, `Table`, `Alert`, `DatePicker`, `Calendar`, `Popover`).
- **New shared:** `OrdersListFilters.jsx` — date range, search, per-page for order tabs.
- **Migrated:** Order pagination; printing orders filters + create actions (`App.jsx`); job sheet & sticker/sampling forms; billing/dispatch/linked order filters; product revenue toolbar; coordinator report toolbar; printing dept inventory/utilization modals & actions; admin sidebar tab permissions (`Checkbox`).
- **Still legacy (next pass):** `App.jsx` inline create-order printing form, `OrderDetailPanel`, `ViewerUserEditModal`, inward/GRN modals, `ContactBookPanel`, `MockupStudio`, `dropdown-menu` / `Switch` not yet wired.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Shadcn Calendar date pickers

- **Issue:** Create order and inventory forms used native `<input type="date">` — inconsistent with shadcn UI and poor month/year navigation.
- **Fix:** Added shadcn `Calendar`, `Popover`, and `DatePicker` wrapper (`mode="single"`, `captionLayout="dropdown"`, `className="rounded-lg border"` per reference). Replaced date inputs in create order modal, job sheet, sticker/sampling forms, and inventory PO modal.
- **Dependencies:** `react-day-picker`, `date-fns`, `@radix-ui/react-popover`.
- **Files:** `src/components/ui/calendar.jsx`, `popover.jsx`, `date-picker.jsx`, `src/App.jsx`, `src/CreateJobSheetForm.jsx`, `src/CreateStickerOrderForm.jsx`, `src/inventory/modals/CreatePOModal.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Create order Save/Cancel button styles

- **Issue:** Custom `formCancel` / `formSave` variants used heavy solid dark fills instead of standard shadcn button styling.
- **Fix:** Cancel uses shadcn `variant="destructive"` (standard destructive token). Save uses new outline `success` variant — green border/text, transparent background (not solid).
- **Files:** `src/components/ui/button.jsx`, `src/App.jsx`, `src/CreateJobSheetForm.jsx`, `src/CreateStickerOrderForm.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Create order modal shadcn UI

- **Issue:** Create New Order modal used legacy backdrop/panel CSS; bare `select`/`input` elements broke the 3-column grid; mixed heights, blue accents, and misaligned footer buttons in dark mode.
- **Fix:** Replaced custom modal with shadcn `Dialog` (`CreateOrderModal.jsx`). Main printing form, job sheet, and sticker/sampling forms use unified `.create-order-form` grid with shadcn input/select/textarea tokens. Wrapped orphan Owner/Customer/Coordinator/Printing Mtrs fields in labeled cells. Save/Cancel use shadcn `Button` (right-aligned).
- **Files:** `src/components/orders/CreateOrderModal.jsx` (new), `src/App.jsx`, `src/CreateJobSheetForm.jsx`, `src/CreateStickerOrderForm.jsx`, `src/index.css`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Sidebar brand logo slow spin

- **Feature:** Dashboard sidebar brand logo rotates slowly (14s per revolution) with `transform-origin: center` so spin pivots on the image midpoint. Respects `prefers-reduced-motion`.
- **Files:** `tailwind.config.js`, `src/components/layout/DashboardAppSidebar.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Home status cards spacing (shadcn grid)

- **Issue:** 11 status cards used `auto-fill` / 6-column legacy grid → uneven gaps (8+3 rows) and misaligned header vs card grid.
- **Fix:** New `HomeStatusPanel` with shadcn `Card` + responsive grid (`2→3→4→5→6` columns, max 6 on xl) for balanced 6+5 layout; consistent `gap-3`; header title and refresh row aligned with grid width.
- **Files:** `src/components/home/HomeStatusPanel.jsx` (new), `src/App.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Topbar and home dashboard alignment

- **Topbar:** Replaced fixed `h-14` header with flexible two-row layout on narrow viewports — search + Archive/Logout stay on one row with proper padding; no overlap with bottom border.
- **Search:** `GlobalSearchBox` accepts `className`; flexes in toolbar with `shrink-0` action buttons.
- **Home status grid:** `auto-fill` minmax grid for even card spacing; equal card heights; consistent section gaps.
- **Report toolbar:** Coordinator report filter segments use shadcn-neutral borders/spacing (no blue active gradient).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Sidebar logo alignment when collapsed

- **Issue:** Collapsing the sidebar to icon mode squished the brand logo — header kept `p-4` padding while rail width is only 48px.
- **Fix:** Rebuilt sidebar header with shadcn `SidebarMenuButton size="lg"` brand pattern; logo in fixed `aspect-square size-8` container with `object-contain` and `shrink-0`. Text hides in icon mode via `group-data-[collapsible=icon]:hidden`.
- **Footer:** Hide notification/theme controls when collapsed; center avatar; hide "Soon" badges in icon mode.
- **Topbar:** Tighter header alignment (`shrink-0` on trigger/actions, separator hidden on very small widths).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Neutral zinc dark theme + sidebar tab icons

- **Theme:** Switched design tokens from blue/slate palette to standard shadcn **zinc** (black/gray only in dark mode). Updated `components.json` `baseColor` to `zinc`.
- **Dark mode:** `--primary` is white-on-black; borders/inputs/muted use gray steps; no blue ring or accent colors.
- **Legacy admin panel:** Neutral overrides for create-user form, master view tabs, and status-tone toggle (removed indigo/blue active states).
- **Sidebar:** Restored Lucide icons beside each tab (shadcn default icon library). Inventory sub-nav icons restored too.
- **Shell:** Main content area uses `bg-background` (pure black in dark) instead of tinted muted blue.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Fix shadcn CSS conflicts, dark mode, sidebar icons

- **Issue:** Legacy `styles.css` applied blue gradient to all native `<button>` elements, removed focus rings globally, and `html.theme-dark body` overrode shadcn dark tokens — shadcn Button/Input looked broken or mismatched.
- **Fix:** Scoped global button styles and focus/box-shadow resets to `.legacy-ui` only; added `index.css` overrides so `body` uses shadcn `--background` / `--foreground` in light and dark; synced legacy CSS vars to shadcn tokens under `html.dark`.
- **Sidebar tokens:** Light mode sidebar now uses standard shadcn light sidebar palette (was incorrectly dark in light mode).
- **Sidebar nav:** Removed Lucide icon imports from `DashboardAppSidebar` and `InventorySubNav` — text-only shadcn `SidebarMenuButton` / `Button` items.
- **Shell controls:** `ThemeToggleButton` and `NotificationBellButton` now shadcn `Button` + `Badge` (no legacy gradient buttons in sidebar footer).
- **SidebarTrigger:** Replaced Lucide `PanelLeft` with text toggle in shadcn sidebar component.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Global search + legacy shadcn bridge

- **GlobalSearchBox:** Rewrote with shadcn `Input`, `Badge`, `ScrollArea`, Lucide `Search` icon — dropdown uses popover tokens.
- **Legacy bridge:** Expanded `src/index.css` `.legacy-ui` overrides so panels, tables, inputs, buttons, modals, and banners use shadcn design tokens (colors, borders, shadows) until each tab is fully migrated.
- **App banners:** Profile error, dev production warning, and master-table warnings now use shadcn `Alert` instead of `.panel` divs.
- **Tab scoping:** Inventory tab removed from `.legacy-ui` wrapper (full shadcn module); `fullBleed` shell for inventory + asset management.
- **Build fix:** `InventoryDashboard.jsx` return wrapped in fragment after layout refactor.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Inventory module full shadcn migration

- **UI rewrite:** Migrated all inventory pages, modals, and drawer from legacy `inventory.css` class names to shadcn/ui + Tailwind + Lucide icons.
- **Pages:** `InventoryOverview`, `InventoryListPage`, `InventoryAlertsPage`, `InventoryMovementsPage`, `InventoryPurchaseOrdersPage`, `InventorySuppliersPage`, `InventoryWarehousesPage` — Card/Table/Tabs/Badge patterns, shared `PageHeader` and status badges via `inventoryUiUtils.jsx`.
- **Modals/drawer:** `SkuDrawer` (Sheet), `AdjustStockModal`, `CreatePOModal`, `NewSkuModal`, `ImportSkusModal`, `NewSupplierModal`, `NewWarehouseModal`, `InventoryThresholdSettingsModal` — Dialog/Sheet with Input, Label, Select, Checkbox, Textarea.
- **Dashboard:** Toast stack in `InventoryDashboard.jsx` now Tailwind-styled with Lucide check icon.
- **Bug fix:** `CreatePOModal` PO number draft used undefined `POS` — now uses `pos.length` from context.
- **Preserved:** All business logic, hooks, callbacks, and data context unchanged.
- **Files:** `src/inventory/inventoryUiUtils.jsx` (new), all inventory pages/modals above, `InventoryDashboard.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Asset Management full shadcn rewrite

- **UI Rewrite:** Replaced `src/AssetManagementPanel.jsx` inline `css()`/`SCOPED_CSS` prototype styling with full shadcn/Tailwind layout and components.
- **Navigation/Layout:** Added shadcn-style sidebar nav (`bg-sidebar` + ghost/default `Button` inside `ScrollArea`), required root layout (`h-[calc(100vh-3.5rem)]`), and new header with search + scan/new actions.
- **Screens:** Migrated dashboard stats, assets table, detail page, add asset form, label settings, audit log, and scanner to `Card`, `Table`, `Badge`, `Select`, `Alert`, `Separator`, `Textarea`, and `Dialog`.
- **Behavior preserved:** Kept all asset business logic intact (state flow, user fetch from Supabase, assign/check-in/out, save asset, label preview/print, auto-tag generation, filters, admin settings).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-28 — Shadcn UI foundation + dashboard shell redesign

- **Foundation:** Added Tailwind CSS 3, PostCSS, and shadcn/ui (`components.json`, `src/index.css` design tokens, `@/` path alias in Vite). Installed core shadcn components: button, card, input, label, badge, select, table, tabs, dialog, sidebar, sheet, avatar, scroll-area, dropdown-menu, tooltip, separator.
- **Login:** Replaced legacy auth card with shadcn `LoginPage` (Card + Input + Button).
- **Dashboard shell:** Replaced custom `dashboard-sidebar` / topbar markup with shadcn `SidebarProvider` + `DashboardAppSidebar` + `DashboardShell` (collapsible sidebar, sticky header, SidebarTrigger). Dark mode syncs both `theme-dark` and shadcn `dark` class on `<html>`.
- **Asset Management:** Header actions migrated to shadcn Button/Input; layout uses Tailwind utility classes for full-bleed within the new shell.
- **Note:** Tab content (orders, inventory, billing, etc.) still uses existing CSS — migrate module-by-module next.
- **Files:** `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `components.json`, `jsconfig.json`, `src/index.css`, `src/lib/utils.js`, `src/components/ui/*`, `src/components/layout/*`, `src/components/auth/LoginPage.jsx`, `src/App.jsx`, `src/main.jsx`, `src/AssetManagementPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: admin label layout settings

- **Feature:** Admins get **Label settings** in the Asset Management sidebar (ADMIN section). Configure four label slots: above barcode line 1 & 2, below barcode line 1 & 2. Each slot maps to an asset field (name, tag, category, serial, manufacturer, location, assignee, category·serial, or hidden).
- **Print:** `assetLabelPrint.js` now renders labels from saved settings instead of hardcoded name/meta/tag/location. Barcode still always encodes the asset tag (CODE128).
- **Persistence:** Settings saved in browser `localStorage` (`scott-asset-label-settings`) via `src/assetLabelSettings.js`; live preview on settings page and Add asset form; **Print sample label** uses current draft before save.
- **Files:** `src/assetLabelSettings.js` (new), `src/assetLabelPrint.js`, `src/AssetManagementPanel.jsx`, `src/App.jsx` (`isAdmin` prop).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: auto tags, user assignment, sidebar Soon removed

- **Removed:** `laptop.jpg` placeholder image on asset detail header.
- **Auto tag IDs:** Manual tag suffix input removed. New assets get sequential tags (`IT-00001`, `IT-00002`, …) via `generateNextAssetTag()` in `src/assetTagUtils.js`; preview shows read-only auto-generated ID.
- **User assignment:** Assignee picker loads active users from `profiles` (`viewer` + `admin` roles — same pool as admin-created users). Add-asset **Assigned to** is a dropdown; unassigned assets on detail show **Assign asset** UI; check-out modal assigns a selected user; check-in clears assignment and marks asset Available.
- **Sidebar:** Removed **Soon** badge from Asset Management tab (`asset_management` dropped from `DASHBOARD_SIDEBAR_SOON_TAB_IDS`).
- **Files:** `src/AssetManagementPanel.jsx`, `src/assetTagUtils.js` (new), `src/dashboardSidebarConfig.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: scannable 4×6 cm labels + location field

- **Feature (barcode):** Replaced decorative barcode stripes with real **CODE128** barcodes via `jsbarcode` (same stack as inward GRN labels). Preview on Add asset and Asset detail; **Print label** opens a print window sized **4 cm × 6 cm** with scannable bars, asset tag, name, serial, category, and location.
- **Files (new):** `src/assetLabelBarcode.js`, `src/assetLabelPrint.js`.
- **Change (location):** Renamed form field **Home location** → **Location**. Dropdown options are now only **Ground floor** and **4th floor IT room** (default: Ground floor). Detail specs and assignment panel read live `detail.location`.
- **Files:** `src/AssetManagementPanel.jsx`, `src/assetLabelBarcode.js`, `src/assetLabelPrint.js`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management: working Add form + functional filters

- **Fix (add asset):** "Save asset" now actually creates the asset. The Add form is fully controlled via a `form` state object; on save it builds an asset (status derived from whether "Assigned to" is set) and prepends it to a new `rawAssets` state list, then resets the form and bumps the tag suffix. Previously the inputs were uncontrolled (`defaultValue`) and Save merely navigated, so nothing persisted. Category/Home location are now `<select>` dropdowns.
- **Fix (filters):** Filter chips were static with no handlers. They now drive an `activeFilter` state and filter the table (`filteredAssets`). Removed the **Available** and **Laptops** chips; remaining `All assets` / `Checked out` / `Maintenance` work as status filters. Subtitle and dashboard stat cards/subtitle now show live counts.
- **Note:** Asset data is in-component React state only — it is **not** persisted to a backend yet, so it resets on refresh/tab change.
- **Files:** `src/AssetManagementPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management tab starts blank (no demo data)

- **Change:** Removed all seeded demo data from `AssetManagementPanel` so the tab opens empty until wired to a backend. Emptied `RAW_ASSETS`, `STATS` values (now `0`), `CATEGORIES`, `STATUS_DIST`, `ACTIVITY`, `ATTENTION`, `HISTORY`, and `AUDIT`; removed the unused `activityMeta` helper.
- **Empty states:** Added an `emptyHint()` renderer with contextual messages on Dashboard (categories/activity/needs-attention), Assets table, and Audit log. Dynamic counts replace hardcoded text ("Needs attention" badge, "N types", assets subtitle). Scanner result sheet now shows an idle "Awaiting scan" state instead of a fake matched asset.
- **Guards:** `selectedTag` defaults to `null`; `detail` is null-safe and `specs` short-circuits to `[]` when no asset is selected, preventing crashes with empty data.
- **Files:** `src/AssetManagementPanel.jsx`.
- **Documentation updated:** CHANGELOG.md.

## 2026-06-25 — Asset Management tab (Tracer Asset Manager UI)

- **Feature:** The dashboard `asset_management` tab now renders a full Asset Manager UI (`AssetManagementPanel`) replacing the "Coming soon" placeholder. Native React port of the `Tracer Asset Manager.html` prototype.
- **Screens:** Dashboard (stat cards, assets-by-category bars, status distribution, recent activity, needs-attention), Assets table (filter chips + rows), Asset detail (specs, assignment, history timeline, barcode), Add asset (form + live tag preview), Audit log table, Mobile scanner mockup, and a check-in/out slide-over modal.
- **Data:** Presentational/mock only — no backend wiring yet. Internal state machine drives screen/selectedTag/modal/charger/tagSuffix.
- **Styling:** Original inline CSS preserved via a `css()` string→object helper; hover/focus/keyframes provided through a scoped `<style>` under `.asset-mgmt-root`; IBM Plex Sans/Mono pulled from Google Fonts. Panel fills the tab via `height: calc(100vh - 132px)`.
- **Files:** `src/AssetManagementPanel.jsx` (new), `src/App.jsx` (import + tab render).
- **Documentation updated:** CHANGELOG.md.

## 2026-06-22 — GRN inward full-page entry

- **Feature:** Dispatch > Inward GRN entry now opens as full-page view (`InwardGrnEntryPage`) instead of modal.
- **Database:** Added `inward_grn_entries.grn_entry_detail` jsonb column (migration `20260630120000_add_grn_entry_detail.sql`) for apparel bora lines and fabric receipt lines.
- **Files:** `src/inwardGrnFormUtils.js`, `src/InwardGrnEntryPage.jsx`, `src/DispatchTabPanel.jsx`, `src/inwardEntryUtils.js`, `src/styles.css`.
- **Documentation updated:** CHANGELOG.md, DATABASE.md.
