# Postman — Dashboard Stock API

Import these files into [Postman](https://www.postman.com/downloads/) or [Bruno](https://www.usebruno.com/) (Bruno: rename/import JSON as needed).

| File | Purpose |
|------|---------|
| `Scott_Dashboard_Stock_API.postman_collection.json` | All stock endpoints + happy-path folder |
| `Scott_Dashboard_Stock_API.staging.postman_environment.json` | Staging base URL + variables |
| `Scott_Dashboard_Stock_API.production.postman_environment.json` | Production base URL (paste prod API key) |

## Import steps

1. Postman → **Import** → drag all three JSON files (or import collection + one environment).
2. Top-right environment picker → **Scott Dashboard Stock API — Staging** (or Production).
3. If Production: set `DASHBOARD_API_KEY` in environment (Supabase → Edge Functions → Secrets).
4. Update `sku_code` / `facility_code` to match real inventory rows in dashboard.
5. Run **GET Snapshot** first, then **Happy path flow** folder if testing reserve → fulfill.

## Auth

Collection uses **Bearer Token** = `{{DASHBOARD_API_KEY}}`. This is the Edge Function secret — **not** Supabase login JWT or anon key.

## Auto variables

**POST Reserve** test script saves `reservation_id` into collection + environment so **Release** / **Fulfill** work without copy-paste.

See also: [DASHBOARD_STOCK_API.md](../DASHBOARD_STOCK_API.md) · [openapi/dashboard-stock-api.yaml](../openapi/dashboard-stock-api.yaml)
