# Dashboard Stock API (Scott International)

Machine-to-machine stock API for the Scott International backend (RMP orders, catalogue, UniCommerce replacement). Order lifecycle routes live on the same function — see [DASHBOARD_ORDER_API.md](./DASHBOARD_ORDER_API.md).

**Spec source:** `dashboard-api-requirements.pdf`  
**Implementation:** Supabase Edge Function `dashboard-stock-api`

## Base URL

```
https://<project-ref>.supabase.co/functions/v1/dashboard-stock-api
```

Staging: use staging project ref. Production: `levwrmvqdntngeasrtnb`.

## Authentication

Every request:

```http
Authorization: Bearer <DASHBOARD_API_KEY>
Content-Type: application/json
```

Two ways to issue keys (both accepted):

1. **Admin UI (preferred):** Admin Panel → Integrations → API keys → "Generate a new API key" — per-client keys that can be disabled/deleted individually (stored as SHA-256 hashes; disabled keys get `401 KEY_DISABLED`).
2. **Legacy secret:** `DASHBOARD_API_KEY` in Supabase → Edge Functions → Secrets.

Optional webhook secrets:

| Secret | Purpose |
|--------|---------|
| `SCOTT_WEBHOOK_BASE_URL` | Their server base URL (e.g. `https://api.scott.example`) |
| `SCOTT_WEBHOOK_SECRET` | HMAC-SHA256 shared secret for outbound webhooks |

## Facility codes

Snapshot keys use **`FACILITY_CODE:SKU_CODE`** (e.g. `SCOTT_1DAY_01:SKU-COTTON-WHT-M`).

Map warehouses in the dashboard: set `inventory_warehouses.facility_code` to the external code — editable in the UI via **Inventory → Warehouses → Add warehouse → "Facility code (external)"** (warehouse cards show a "Not mapped" badge when unset). Existing SKU stock is backfilled into `inventory_facility_stock` on migration.

---

## GET /api/v1/stock/snapshot

Fetch available stock for multiple SKUs (on_hand − reserved), optionally filtered by facility.

**Query**

| Param | Required | Example |
|-------|----------|---------|
| `skus` | yes | `SKU-COTTON-WHT-M,SKU-COTTON-WHT-L` |
| `facility` | no | `SCOTT_1DAY_01` |

**200**

```json
{
  "snapshot": {
    "SCOTT_1DAY_01:SKU-COTTON-WHT-M": 120,
    "SCOTT_3DAY_01:SKU-COTTON-WHT-M": 200
  }
}
```

---

## POST /api/v1/stock/reserve

Hold stock when customer places RMP order.

**Body**

```json
{
  "order_code": "P-53011",
  "facility_code": "SCOTT_1DAY_01",
  "items": [
    { "sku_code": "SKU-COTTON-WHT-M", "item_code": "P-1-4201-88", "quantity": 50 }
  ]
}
```

**201**

```json
{
  "reservation_id": "rsv_abc123",
  "order_code": "P-53011",
  "status": "RESERVED",
  "expires_at": "2026-07-07T10:00:00Z"
}
```

**409** — `INSUFFICIENT_STOCK` with `details[]` (`sku_code`, `requested`, `available`).

---

## DELETE /api/v1/stock/reserve/:reservation_id

Release reserved stock (cancel / order edit). **Idempotent** if already released.

**Query:** `reason=CANCELLED` or `ORDER_EDIT`

**200**

```json
{
  "reservation_id": "rsv_abc123",
  "status": "RELEASED",
  "released_at": "2026-06-30T11:00:00Z"
}
```

---

## POST /api/v1/stock/fulfill/:reservation_id

Convert reservation to permanent deduction when order completes.

**Body (optional)**

```json
{ "dispatched_at": "2026-06-30T14:00:00Z" }
```

**200**

```json
{
  "reservation_id": "rsv_abc123",
  "status": "FULFILLED",
  "fulfilled_at": "2026-06-30T14:00:00Z",
  "stock_deducted": [
    { "sku_code": "SKU-COTTON-WHT-M", "deducted": 50, "remaining": 70 }
  ]
}
```

---

## POST /api/v1/stock/adjust

Manual correction (damage, returns, count errors).

**Body**

```json
{
  "facility_code": "SCOTT_1DAY_01",
  "reason": "DAMAGE_WRITE_OFF",
  "items": [
    { "sku_code": "SKU-COTTON-WHT-M", "delta": -12 },
    { "sku_code": "SKU-POLY-BLK-S", "delta": 50 }
  ]
}
```

**200**

```json
{
  "adjustment_id": "adj_def456",
  "applied_at": "2026-06-30T09:00:00Z",
  "results": [{ "sku_code": "SKU-COTTON-WHT-M", "before": 120, "after": 108 }]
}
```

---

## Outbound webhooks (dashboard → Scott backend)

When `SCOTT_WEBHOOK_BASE_URL` + `SCOTT_WEBHOOK_SECRET` are set, the edge function POSTs to:

| Event | Path |
|-------|------|
| Stock level changed | `{BASE}/webhooks/stock/level_changed` |
| Low threshold | `{BASE}/webhooks/stock/low_threshold` |
| Order status changed | `{BASE}/webhooks/orders/status_changed` (see [DASHBOARD_ORDER_API.md](./DASHBOARD_ORDER_API.md)) |

Header: `X-Dashboard-Signature: sha256=<hmac-sha256-hex(body)>`

Failed deliveries are queued in `dashboard_webhook_outbox` for retry on next mutation.

---

## Deploy

```bash
# Apply migration first
supabase db push

# Set secrets (Dashboard → Edge Functions → dashboard-stock-api)
# DASHBOARD_API_KEY, SCOTT_WEBHOOK_BASE_URL, SCOTT_WEBHOOK_SECRET

supabase functions deploy dashboard-stock-api
```

## Flutter / mobile note

This API is for the **Scott International order backend**, not the Flutter MVP (which uses Supabase Auth + direct table access for read inventory / create printing order). Both can coexist.

## Postman

Ready-made collection + staging/production environments:

- `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json`
- `docs/postman/Scott_Dashboard_Stock_API.staging.postman_environment.json`
- `docs/postman/Scott_Dashboard_Stock_API.production.postman_environment.json`

Import guide: [docs/postman/README.md](./postman/README.md)
