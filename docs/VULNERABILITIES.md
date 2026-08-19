# Vulnerability report — Scott Dashboard

**Date:** 2026-08-17  
**Scope:** Whole `develop` build (frontend, edge functions, RLS, RPCs, Auth, deploy). Staging Supabase advisors included.  
**Method:** Code review of auth/RLS/edge functions + [Security Review](https://cursor.com) pass + Supabase MCP `get_advisors` (security) on staging `scvojtvgnkmbupvyslmb`.  
**Not in scope:** Production live pentest, partner Flutter app, physical warehouse process.

This is a **findings document**. No code was patched in this pass. Fix order is at the bottom.

---

## Snapshot

| Severity | Count | Meaning |
|----------|------:|---------|
| **High** | 3 | Logged-in (or API) user can change **stock or partner order state** without a real role check |
| **Medium** | 9 | Data leak, spam, weak reset, SSRF (admin), quota abuse |
| **Low / advisor** | Many | Default `SECURITY DEFINER` grants, mutable `search_path`, leaked-password protection off |
| **By design / OK** | — | Anon keys in bundle, CORS `*`, service role only in Edge |

UI tab hide is **not** security. PostgREST + Edge Functions are the real gate.

---

## High

### H1 — Any signed-in user can change Ready Stock order status (stock + webhooks)

| | |
|--|--|
| **Issue** | Edge function accepts any valid session JWT, then uses **service role** to COMPLETE / FAIL / CANCEL Scott RMP orders. |
| **Why** | Auth is `getUser(jwt)` only. No `jwt_user_is_admin()`, warehouse role, or Ready Stock tab permission. UI hide does not stop a direct `fetch`. |
| **Where** | `supabase/functions/scott-order-update-status/index.ts` lines 35–80 |
| **Impact** | Deduct or release stock; fire `order.status_changed` to partner app. |
| **Fix** | After JWT, require admin **or** explicit warehouse/Ready Stock permission. Audit log `user.id`. Same gate as picklist. |

### H2 — Any signed-in user can generate picklists and move PENDING → PROCESSING

| | |
|--|--|
| **Issue** | Same JWT-only pattern; service role writes `picklist_no` and status. |
| **Why** | `scott-order-generate-picklist` never checks role. |
| **Where** | `supabase/functions/scott-order-generate-picklist/index.ts` lines 37–50+ |
| **Impact** | Warehouse workflow hijack; partner webhook on status change. |
| **Fix** | Same authorization as H1. |

### H3 — Any signed-in user can set warehouse on-hand via RPC

| | |
|--|--|
| **Issue** | `adjust_sku_facility_stock` and `bulk_adjust_sku_facility_stock` are `SECURITY DEFINER` and **granted to `authenticated`**. Function body has **no** admin / inventory-permission check. |
| **Why** | Built so the dashboard UI can adjust stock from the browser. RLS on facility tables blocks direct UPDATE, so the RPC bypasses RLS for everyone who can call it. |
| **Where** | `supabase/migrations/20260722180000_warehouse_facility_stock_adjust.sql` (grant ~159); `20260725180000_bulk_adjust_facility_stock.sql` (grant ~66) |
| **Impact** | Any viewer with login can zero or inflate stock at a facility. |
| **Fix** | Inside RPC: `jwt_user_is_admin()` **or** inventory edit permission. `REVOKE` from `PUBLIC` / `anon`. Optional: move mutations to an admin-only edge function. |

Related: `bulk_update_sku_metrics` is also granted to `authenticated` (`20260730220000_bulk_update_sku_metrics.sql`) — same class of bug (SKU metrics, not qty). Treat as **High** if metrics drive pricing/ops; otherwise Medium. Listed here as **H3b**.

---

## Medium

### M1 — Enquiry assignment notification spam

| | |
|--|--|
| **Issue** | INSERT on `enquiry_assignment_notifications` only checks `assigned_by_user_id = auth.uid()`. No admin check, no proof the enquiry was assigned. |
| **Where** | `supabase/migrations/20260817130922_add_enquiries_dashboard.sql` ~137–142 |
| **Impact** | Any logged-in user can insert rows into another user’s inbox. |
| **Fix** | Admin-only insert, or security-definer RPC that writes the notification only after a valid assign. |

### M2 — Enquiry assignee can rewrite customer PII

| | |
|--|--|
| **Issue** | Assignee UPDATE policy allows **all columns** as long as they stay the assignee. |
| **Where** | Same migration ~115–121; client `enquiryUtils.js` is not the gate. |
| **Impact** | Assignee can change phone, email, product, priority via PostgREST. |
| **Fix** | Restrict columns (trigger / generated columns / RPC for `status` + `notes` only). |

### M3 — Every authenticated user can read all `scott_orders`

| | |
|--|--|
| **Issue** | SELECT policy `using (true)` for `authenticated`. |
| **Where** | `supabase/migrations/20260720120000_scott_orders.sql` ~97–101 |
| **Impact** | Customer JSON, address, payment, order codes — REST `GET /rest/v1/scott_orders`. |
| **Fix** | Scope to admin + warehouse group / tab permission if org-wide read is not intended. |

### M4 — Every authenticated user can read all printing `orders`

| | |
|--|--|
| **Issue** | Same pattern: `"orders readable by authenticated users"` → `using (true)`. |
| **Where** | `supabase/schema.sql` ~352–356 |
| **Impact** | Customer, payment, design URLs org-wide. Sidebar field permissions do not apply to REST. |
| **Fix** | Align RLS with `profile_order_permissions` if that is the security model. |

### M5 — Password reset status enumerates accounts

| | |
|--|--|
| **Issue** | Public function (`verify_jwt = false`). Unknown email → `{ status: "none" }`; known user with a request → `pending` / `approved`. |
| **Where** | `supabase/functions/check-password-reset-status/index.ts` ~27–60; `supabase/config.toml` `[functions.check-password-reset-status]` |
| **Impact** | Unauthenticated email enumeration + reset-pipeline state. |
| **Fix** | Identical generic response for all emails; rate-limit IP/email. |

### M6 — Weak password + no rate limit on complete reset

| | |
|--|--|
| **Issue** | Min password **6** characters; public endpoint; no throttle after admin approval (7-day window). |
| **Where** | `supabase/functions/complete-password-reset/index.ts` ~25–26, ~60 |
| **Fix** | 12+ chars, complexity, rate limit, shorter approval window. Enable Auth leaked-password protection (advisor). |

### M7 — Admin webhook test is SSRF-shaped

| | |
|--|--|
| **Issue** | Admin supplies `base_url`; server `fetch`es it and signs with real `SCOTT_WEBHOOK_SECRET`. Only `http(s)://` prefix checked. |
| **Where** | `supabase/functions/admin-test-scott-webhook/index.ts` ~52–79 |
| **Impact** | Stolen **admin** JWT can probe internal URLs from Supabase egress. |
| **Fix** | Allowlist partner hosts; block private IPs; or use secret-only base URL. |

### M8 — `tenor-gif-search` can burn API quota

| | |
|--|--|
| **Issue** | Proxies Tenor with server `TENOR_API_KEY`. Chat now mostly uses Giphy client-side; function may still be deployed. |
| **Where** | `supabase/functions/tenor-gif-search/index.ts` ~36–81 |
| **Fix** | Require session + rate limit, or undeploy if unused. |

### M9 — Team directory exposes all profile emails

| | |
|--|--|
| **Issue** | Authenticated SELECT on all `profiles` (chat/assignee pickers). |
| **Where** | `supabase/schema.sql` ~814–818; RPC `list_team_chat_directory` |
| **Impact** | Staff email harvest by any viewer. Often accepted internally. |
| **Fix** | View/RPC with minimum columns (`id`, `full_name`, `department`) if emails should stay private. |

---

## Staging Supabase advisors (2026-08-17)

Source: MCP `get_advisors` type=`security` on staging.

| Level | Advisor | Count | Notes |
|-------|---------|------:|-------|
| WARN | Public / signed-in can execute `SECURITY DEFINER` functions | 28 + 28 | Includes stock adjust RPCs (see **H3**). Many are trigger helpers — still **REVOKE FROM PUBLIC / anon**. |
| WARN | Function `search_path` mutable | 11 | Triggers (`touch_*`, `count_design_urls`, …). Set `search_path = public` to cut search-path injection. |
| WARN | Leaked password protection disabled | 1 | Enable HaveIBeenPwned check in Auth settings. |
| INFO | RLS on, no policies | 3 | `dashboard_webhook_outbox`, `inventory_stock_adjustments`, `inventory_stock_adjustment_items` — **intentional** service-role-only (no policies = no client access). |

Remediation index: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

---

## Reviewed — no Medium+ (or accepted)

| Area | Result |
|------|--------|
| Service role in frontend | Not in client bundle |
| `runtimeEnv.js` hardcoded staging/prod **anon** keys | Public by design; RLS + JWT still required |
| Admin header env toggle | Client target switch; confirmation on production |
| `dashboard-stock-api` | Bearer API key / hashed keys; JWT off by design |
| Outbound webhooks | HMAC-SHA256 `X-Dashboard-Signature` |
| Picklist HTML | `escapeHtml` on user fields |
| Local picklist PDF API (`server/index.js`) | No auth — **dev/localhost only**, not Netlify/Vercel static host |
| CORS `Access-Control-Allow-Origin: *` on Edge | OK for Bearer tokens (not cookie session) |
| `dangerouslySetInnerHTML` barcodes | SVG from `bwip-js` / local tag string, not raw customer HTML |
| Enquiry SELECT RLS | Admin all; assignee + creator scoped — OK |
| `enqueue_dashboard_webhook` | Granted to `service_role` only |

---

## Edge function JWT map

From `supabase/config.toml` (functions **not** listed inherit platform default, usually JWT on):

| Function | Gateway JWT | Extra risk |
|----------|-------------|------------|
| `admin-create-user` / delete / reset / promote | on | Must still check admin in code |
| `admin-review-password-reset` / list | on | Same |
| `admin-test-scott-webhook` | on | M7 SSRF |
| `request-password-reset` | **off** | Needed for login screen |
| `check-password-reset-status` | **off** | M5 enumeration |
| `complete-password-reset` | **off** | M6 |
| `dashboard-stock-api` | **off** | API key in function — OK |
| `scott-order-update-status` | not in toml | H1 if deployed without role check |
| `scott-order-generate-picklist` | not in toml | H2 |
| `tenor-gif-search` | not in toml | M8 |

---

## Priority fix order

1. **H1 + H2** — role-check Ready Stock edge functions (stock + partner webhooks).  
2. **H3 / H3b** — admin-or-inventory-edit inside stock/metrics RPCs; revoke `PUBLIC`/`anon`.  
3. **M1 + M2** — enquiry notification insert + assignee column scope.  
4. **M3 + M4** — decide if org-wide order read is intended; if not, tighten RLS.  
5. **M5 + M6** — generic reset responses, rate limits, stronger passwords, leaked-password Auth setting.  
6. **M7 + M8** — webhook URL allowlist; Tenor rate limit or remove.  
7. Advisor cleanup — `search_path`, revoke extra DEFINER grants.

---

## How to re-run this audit

```bash
# Code + UI still build
npm run check:ui

# Staging advisors (agent / MCP)
# get_advisors type=security  → project scvojtvgnkmbupvyslmb
```

Do **not** run advisor DDL or Auth setting changes on production (`levwrmvqdntngeasrtnb`) unless an explicit production release is requested.
