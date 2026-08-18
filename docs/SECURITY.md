# Security

- Enquiry **assign** is admin-only (RLS insert + update trigger). Non-admin cannot set `assignee_id`.
- Enquiry activity log is scoped; admin sees all staff actions on the Support tab.

## Enquiry Concierge desk

- Order ownership is a **staff** flag (`ownership_verified`). The dashboard does not expose order data to customers.
- Enquiry photos go to bucket `enquiry-attachments`; upload path must start with `auth.uid()`.
- SLA messages go to Gargi (or first admin). The **customer is never told** about a missed pick.
- Close queues customer survey copy in `enquiry_outbound_messages` (Feedback button). The SPA does not hold WhatsApp Cloud API keys; live Meta send is not from this app.

## Authentication (web / mobile)

- Users sign in via Supabase Auth (email + password).
- Clients use **anon key** + user JWT; RLS enforces row access.
- **Never** embed `SUPABASE_SERVICE_ROLE_KEY` or `DASHBOARD_API_KEY` in browser or Flutter app.

## Dashboard Stock API (partner M2M)

| Control | Detail |
|---------|--------|
| Auth | Bearer token: legacy `DASHBOARD_API_KEY` secret **or** per-client keys from `dashboard_api_keys` |
| Key storage | Admin-generated keys stored as **SHA-256 hash + display prefix only**; plaintext shown once in the UI at creation, never persisted or logged |
| Key lifecycle | Admin Panel → Integrations → API keys: generate / disable (`401 KEY_DISABLED`) / delete; `last_used_at` tracked per key |
| Key management RLS | `dashboard_api_keys` / `dashboard_channels`: all operations require `jwt_user_is_admin()` |
| JWT | Disabled (`verify_jwt = false`); API key checked in function code |
| Data access | Service role client; partner tables have RLS with no user write policies |
| Rotation | Preferred: generate a new key in the admin UI, hand over, disable the old one. Legacy: rotate `DASHBOARD_API_KEY` secret |

## Outbound webhooks

- HMAC-SHA256 body signature: header `X-Dashboard-Signature: sha256=<hex>`
- Secret: `SCOTT_WEBHOOK_SECRET` (Edge Function secret)
- Scott backend must verify signature before trusting payload
- Connectivity test: admin edge function `admin-test-scott-webhook` (admin JWT) signs and sends a test event; the secret never reaches the browser — only the target base URL is sent from the client

## Runtime environment toggle (admin header)

- Admins can switch the browser between staging and production backends; choice lives in localStorage (`scott-dashboard-env-override`), not on the server.
- Ships **anon keys only** for both projects (anon keys are public by design; RLS + JWT still gate all data).
- Switching to production requires an inline confirmation ("live production data"); explicit override works in local dev too (console-warned). The dev hard block applies only when the **build default** (`.env` files) points at production without `VITE_ALLOW_PROD_IN_DEV=true`.

## Secrets inventory

| Secret | Where | Purpose |
|--------|-------|---------|
| `DASHBOARD_API_KEY` | Edge: `dashboard-stock-api` | Inbound API auth |
| `SCOTT_WEBHOOK_BASE_URL` | Edge: `dashboard-stock-api` | Outbound webhook target |
| `SCOTT_WEBHOOK_SECRET` | Edge: `dashboard-stock-api` | Webhook HMAC |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions (platform) | DB access from functions |

See [DEPLOYMENT.md](./DEPLOYMENT.md) for env setup on Netlify (frontend) vs Supabase (backend).
