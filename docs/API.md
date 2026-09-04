# API

Scott Dashboard does **not** run a custom REST server in this repository for production hosting. The effective API is:

1. **Supabase PostgREST** — auto-generated REST for tables/views  
2. **PostgreSQL RPCs** — `supabase.rpc('function_name', params)`  
3. **Supabase Edge Functions** — HTTP endpoints for admin operations  
4. **Supabase Storage** — object upload/download APIs  
5. **Supabase Auth** — `/auth/v1/*` (via SDK)
6. **Local picklist PDF API (dev only)** — Express on port 3001, proxied by Vite as `/api/picklist/*`

Base URL (production): `https://levwrmvqdntngeasrtnb.supabase.co`

## Local picklist PDF API (development)

Runs with `npm run dev:picklist-api` or `npm run dev:all`. Vite dev server proxies `/api/picklist` → `http://localhost:3001`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/picklist/pdf` | `PicklistData` JSON (see `src/picklist/picklistTypes.js`) | `application/pdf` — filename `{picklistNo}.pdf` |
| GET | `/api/picklist/preview` | — | HTML preview (sample data) |
| GET | `/api/picklist/pdf/sample` | — | Sample PDF (`PK39506`) |
| GET | `/api/picklist/preview-assets` | `?picklistNo=PK39506` | `{ barcodeDataUri, logoSrc }` for React preview |

Validation: `server/picklist/validatePicklistData.js` — rejects unknown fields like `totalItems` (derived from Σ `items[].qty`).

PDF engine: Puppeteer + `bwip-js` Code128 PNG embedded in HTML (`src/picklist/buildPicklistHtml.js` + `picklist.css`).

**Production:** Netlify static deploy does not include this server — run the picklist API on a Node host or extend deployment separately.

## Authentication

| Method | Usage |
|--------|--------|
| Email + password | Web login via `supabase.auth.signInWithPassword` |
| JWT | Sent as `Authorization: Bearer <access_token>` on all API calls |
| Session refresh | Handled by `supabase-js` |

Mobile apps should use the same Auth flow. Never embed the **service role** key in clients.

## PostgREST (table access)

Pattern:

```http
GET /rest/v1/orders?select=*&status=eq.printing
Authorization: Bearer <user_jwt>
apikey: <anon_key>
```

Common tables (non-exhaustive — see [DATABASE.md](./DATABASE.md)):

| Table | Methods | Notes |
|-------|---------|-------|
| `profiles` | GET, PATCH (own) | User profile |
| `orders` | GET, POST, PATCH | RLS by role/permissions |
| `profile_order_permissions` | GET, UPSERT | Admin |
| `team_chat_messages` | GET, INSERT | Members only. Soft-delete/pin via RPC. |
| `team_chat_message_reactions` | GET, INSERT, PATCH, DELETE | Own reaction; member of the conversation |
| `user_goal_tasks` | GET, INSERT, PATCH | Goals module |
| Inventory tables | GET, POST, PATCH | See inventory migrations |
| `hr_assets` | GET, POST, PATCH | Asset Management register. Insert `created_by = auth.uid()`. Staging only until release. |
| `hr_user_presence` | GET | Team can read. Write via RPC only. |

Full schema: Supabase Dashboard → Table Editor, or `supabase/schema.sql`.

## RPC functions (examples)

| RPC | Purpose |
|-----|---------|
| `get_or_create_direct_conversation` | Chat DM |
| `create_group_conversation` | Chat group |
| `create_channel_conversation` | Admin-only org channel (adds every profile) |
| `mark_conversation_read` | Chat unread |
| `list_team_chat_directory` | Mention picker |
| `soft_delete_team_chat_messages` | Soft-delete own selected messages |
| `toggle_team_chat_message_pin` | Pin / unpin one message |
| `set_team_chat_message_reaction` | Toggle or replace own emoji |
| `set_my_dashboard_presence` | Heartbeat Online/Away for chat dots |
| `get_goals_for_task_assignment` | Goal dropdown for assigner |
| `purge_expired_team_chat_attachments` | Scheduled cleanup |

Invoke:

```javascript
const { data, error } = await supabase.rpc('mark_conversation_read', {
  p_conversation_id: conversationId
});
```

## Edge Functions

| Function | Auth | Purpose |
|----------|------|---------|
| `admin-create-user` | Admin JWT | Create user + profile |
| `admin-delete-user` | Admin JWT | Delete user |
| `admin-reset-password` | Admin JWT | Reset password (direct set) |
| `admin-review-password-reset` | Admin JWT | Approve/reject user reset request |
| `admin-list-password-reset-requests` | Admin JWT | List reset requests (bypasses PostgREST client cache) |
| `request-password-reset` | Public (anon) | Submit forgot-password request from login |
| `check-password-reset-status` | Public (anon) | Check pending/approved status for email |
| `complete-password-reset` | Public (anon) | Set new password after admin approval |
| `admin-promote-production` | Admin JWT | Trigger GitHub release |
| `admin-test-scott-webhook` | Admin JWT | Send signed test `stock.level_changed` to Scott backend (`base_url` in body; needs `SCOTT_WEBHOOK_SECRET`) |
| `dashboard-stock-api` | Bearer `DASHBOARD_API_KEY` | Scott International M2M API — stock (snapshot, reserve, fulfill, adjust) + order lifecycle (create/edit/cancel/get/status) |
| `tenor-gif-search` | Optional | Legacy GIF proxy |
| `uniware-bridge` | Admin JWT | Step 5 Uniware: `status`, `sync_inventory`, `sync_orders`, `adjust`. Secrets: `UNIWARE_BASE_URL`, `UNIWARE_USERNAME`, `UNIWARE_PASSWORD`, `UNIWARE_FACILITY`. Staging only until a production release. |

Full contracts: [DASHBOARD_STOCK_API.md](./DASHBOARD_STOCK_API.md) · [DASHBOARD_ORDER_API.md](./DASHBOARD_ORDER_API.md) · **All-in-one handoff:** [SCOTT_INTEGRATION_REFERENCE.md](./SCOTT_INTEGRATION_REFERENCE.md) (APIs + webhooks + realtime) · OpenAPI: [openapi/dashboard-stock-api.yaml](./openapi/dashboard-stock-api.yaml) · Mobile integration guide (keys, code samples): [MOBILE_API_INTEGRATION.md](./MOBILE_API_INTEGRATION.md)

Deploy: `supabase functions deploy <name>`

**Dashboard Stock API base path** (after deploy):

```text
https://<project-ref>.supabase.co/functions/v1/dashboard-stock-api/api/v1/stock/...
```

Secrets for `dashboard-stock-api`: `DASHBOARD_API_KEY` (required), `SCOTT_WEBHOOK_BASE_URL`, `SCOTT_WEBHOOK_SECRET` (optional outbound webhooks).

## Storage buckets

| Bucket | Purpose |
|--------|---------|
| Profile avatars | User photos |
| Notification tones | Custom MP3 |
| Team chat attachments | Chat files (TTL purge) |
| Approved designs / invoices | Order assets |

Public URLs via `supabase.storage.from(bucket).getPublicUrl(path)`.

## Realtime

Subscribe to Postgres changes:

```javascript
supabase.channel('x').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' }, handler)
```

## Future mobile / partner API (recommended)

For external clients, add a **versioned BFF** (e.g. `/v1/orders`) rather than exposing all PostgREST tables. See [PLATFORM_OVERVIEW.md](./PLATFORM_OVERVIEW.md) Section 8.

**Implemented (2026-07-10):** Dashboard Stock API for Scott International — see [DASHBOARD_STOCK_API.md](./DASHBOARD_STOCK_API.md).

## Rate limits

- Supabase project limits apply (connections, API requests, storage bandwidth).
- Giphy API: client-side, subject to Giphy plan limits.

## Error handling

- PostgREST returns JSON `{ message, code, details }`.
- Missing RLS permission → often empty array or 403 depending on policy.
- Schema cache lag after migration → retry or `NOTIFY pgrst, 'reload schema'`.

See [DEBUGGING.md](./DEBUGGING.md).
