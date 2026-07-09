# Security

## Authentication (web / mobile)

- Users sign in via Supabase Auth (email + password).
- Clients use **anon key** + user JWT; RLS enforces row access.
- **Never** embed `SUPABASE_SERVICE_ROLE_KEY` or `DASHBOARD_API_KEY` in browser or Flutter app.

## Dashboard Stock API (partner M2M)

| Control | Detail |
|---------|--------|
| Auth | Static Bearer token `DASHBOARD_API_KEY` (Edge Function secret only) |
| JWT | Disabled (`verify_jwt = false`); API key checked in function code |
| Data access | Service role client; tables have RLS with **no** user policies |
| Rotation | Regenerate key in Supabase secrets; share new value with Scott backend team |

## Outbound webhooks

- HMAC-SHA256 body signature: header `X-Dashboard-Signature: sha256=<hex>`
- Secret: `SCOTT_WEBHOOK_SECRET` (Edge Function secret)
- Scott backend must verify signature before trusting payload

## Secrets inventory

| Secret | Where | Purpose |
|--------|-------|---------|
| `DASHBOARD_API_KEY` | Edge: `dashboard-stock-api` | Inbound API auth |
| `SCOTT_WEBHOOK_BASE_URL` | Edge: `dashboard-stock-api` | Outbound webhook target |
| `SCOTT_WEBHOOK_SECRET` | Edge: `dashboard-stock-api` | Webhook HMAC |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions (platform) | DB access from functions |

See [DEPLOYMENT.md](./DEPLOYMENT.md) for env setup on Netlify (frontend) vs Supabase (backend).
