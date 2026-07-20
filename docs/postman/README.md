# Postman — Dashboard Stock & Order API

Import these files into [Postman](https://www.postman.com/downloads/) or [Bruno](https://www.usebruno.com/) (Bruno: rename/import JSON as needed).

| File | Purpose |
|------|---------|
| `Scott_Dashboard_Stock_API.postman_collection.json` | Stock + Order endpoints, happy-path folders, webhook payload examples |
| `Scott_Dashboard_Stock_API.staging.postman_environment.json` | Staging base URL + variables |
| `Scott_Dashboard_Stock_API.production.postman_environment.json` | Production base URL (paste prod API key) |

## Collection folders

| Folder | Contents |
|--------|----------|
| **Stock** | snapshot / reserve / release / fulfill / adjust |
| **Orders** | create / get / update / cancel / set status (PROCESSING, COMPLETE, FAILED) |
| **Order happy path flow** | create → get → PROCESSING → COMPLETE (or cancel) in order |
| **Happy path flow (stock only)** | snapshot → reserve → fulfill (or release) |
| **Webhooks (dashboard → your server)** | example payloads the dashboard POSTs to the Scott backend (`order.status_changed`, `stock.level_changed`, `stock.low_threshold`) — point `scott_webhook_base_url` at a mock server / webhook.site to prototype the receiver |

## Import steps

1. Postman → **Import** → drag all three JSON files (or import collection + one environment).
2. Top-right environment picker → **Scott Dashboard Stock API — Staging** (or Production).
3. If Production: set `DASHBOARD_API_KEY` in environment (Supabase secret or a key generated in Admin Panel → Integrations → API keys).
4. Update `sku_code` / `facility_code` to match real inventory rows in dashboard.
5. Run **GET Snapshot** first, then a happy-path folder.

## Auth

Collection uses **Bearer Token** = `{{DASHBOARD_API_KEY}}`. This is an M2M API key — **not** Supabase login JWT or anon key. Admin-generated keys (Admin Panel → Integrations) work the same way.

## Auto variables

- **POST Reserve stock** saves `reservation_id` → Release / Fulfill work without copy-paste.
- **POST Create order** saves `dashboard_order_id` → Get / Update / Cancel / Set status work without copy-paste.

See also: [SCOTT_INTEGRATION_REFERENCE.md](../SCOTT_INTEGRATION_REFERENCE.md) (full readable reference) · [DASHBOARD_STOCK_API.md](../DASHBOARD_STOCK_API.md) · [DASHBOARD_ORDER_API.md](../DASHBOARD_ORDER_API.md) · [openapi/dashboard-stock-api.yaml](../openapi/dashboard-stock-api.yaml)
