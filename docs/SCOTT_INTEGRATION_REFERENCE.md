# Scott Dashboard — Integration Reference (APIs, Webhooks, Realtime)

One document covering everything an integrating team needs: every REST endpoint, every outbound webhook, and the realtime (websocket) channels. Postman collection with all of these ready to run: [`docs/postman/`](./postman/README.md). Shareable single-file HTML version: [`SCOTT_INTEGRATION_REFERENCE.html`](./SCOTT_INTEGRATION_REFERENCE.html).

**Last verified on staging:** 2026-07-20

---

## 1. Environments & authentication

| | Staging (test here first) | Production |
|---|---|---|
| Base URL | `https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/dashboard-stock-api` | `https://levwrmvqdntngeasrtnb.supabase.co/functions/v1/dashboard-stock-api` |
| API key | Shared separately / generate in Admin Panel | Issued at go-live |

Every request needs:

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Keys are either the shared `DASHBOARD_API_KEY` secret or per-client keys generated in **Admin Panel → Integrations → API keys** (recommended — can be disabled individually; a disabled key returns `401 KEY_DISABLED`).

---

## 2. Stock API

### 2.1 `GET /api/v1/stock/snapshot`

Available quantity (= on-hand − reserved) for one or more SKUs.

| Query param | Required | Example |
|---|---|---|
| `skus` | yes | `SKU-COTTON-WHT-M,SKU-COTTON-WHT-L` |
| `facility` | no | `SCOTT_1DAY_01` |

**200**

```json
{ "snapshot": { "SCOTT_1DAY_01:SKU-COTTON-WHT-M": 120 } }
```

Errors: `400 MISSING_SKUS`, `401 UNAUTHORIZED`.

### 2.2 `POST /api/v1/stock/reserve`

Hold stock for an order (24h `expires_at` recorded).

**Request**

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
{ "reservation_id": "rsv_abc123", "order_code": "P-53011", "status": "RESERVED", "expires_at": "2026-07-21T10:00:00Z" }
```

**409 `INSUFFICIENT_STOCK`**

```json
{ "error": "INSUFFICIENT_STOCK", "details": [ { "sku_code": "SKU-COTTON-WHT-M", "requested": 50, "available": 12 } ] }
```

### 2.3 `DELETE /api/v1/stock/reserve/:reservation_id`

Release a hold. **Idempotent** — releasing an already-released reservation returns 200.

Query (optional): `reason=CANCELLED` or `ORDER_EDIT`.

**200**

```json
{ "reservation_id": "rsv_abc123", "status": "RELEASED", "released_at": "2026-07-20T11:00:00Z" }
```

Errors: `404 RESERVATION_NOT_FOUND`, `409 ALREADY_FULFILLED`.

### 2.4 `POST /api/v1/stock/fulfill/:reservation_id`

Convert the hold into a permanent deduction (order dispatched). Idempotent for already-fulfilled.

Body (optional): `{ "dispatched_at": "2026-07-20T14:00:00Z" }`

**200**

```json
{
  "reservation_id": "rsv_abc123",
  "status": "FULFILLED",
  "fulfilled_at": "2026-07-20T14:00:00Z",
  "stock_deducted": [ { "sku_code": "SKU-COTTON-WHT-M", "deducted": 50, "remaining": 70 } ]
}
```

Errors: `404 RESERVATION_NOT_FOUND`, `409 RESERVATION_RELEASED`.

### 2.5 `POST /api/v1/stock/adjust`

Manual correction (damage, returns, count errors). Positive or negative deltas.

**Request**

```json
{
  "facility_code": "SCOTT_1DAY_01",
  "reason": "DAMAGE_WRITE_OFF",
  "items": [ { "sku_code": "SKU-COTTON-WHT-M", "delta": -12 } ]
}
```

**200**

```json
{ "adjustment_id": "adj_def456", "applied_at": "2026-07-20T09:00:00Z", "results": [ { "sku_code": "SKU-COTTON-WHT-M", "before": 120, "after": 108 } ] }
```

`409 INSUFFICIENT_STOCK` if a negative delta would leave on-hand below the reserved quantity.

---

## 3. Order API

Order status values (used exactly, no mapping): `PENDING` → `PROCESSING` → `COMPLETE`, or terminal `CANCELLED` / `FAILED`.

### 3.1 `POST /api/v1/orders` — create

Creates the order **and holds stock** (same math as reserve).

**Request**

```json
{
  "order_code": "P-53011",
  "facility_code": "SCOTT_1DAY_01",
  "due_on": "2026-07-25T00:00:00Z",
  "customer": { "code": "P-104", "name": "Acme Traders", "email": "acme@example.com", "phone": "9876543210" },
  "shipping_address": { "name": "Acme Traders", "address_line1": "12 MG Road", "city": "Pune", "state": "MH", "country": "IN", "pincode": "411001" },
  "payment": { "instrument": "CASH", "cash_on_delivery": true },
  "comment": "Rush order - dispatch by Friday",
  "items": [ { "item_code": "P-1-4201-88", "sku_code": "SKU-COTTON-WHT-M", "quantity": 50, "unit_price": 245.50 } ]
}
```

**201** — store `dashboard_order_id`, it is the id for all later calls:

```json
{ "dashboard_order_id": "ord_abc123", "order_code": "P-53011", "status": "PENDING", "created_at": "2026-07-20T09:00:00Z" }
```

| Error | When |
|---|---|
| `409 INSUFFICIENT_STOCK` | any line short — `details[]` has `sku_code`, `requested`, `available` |
| `409 ORDER_EXISTS` | an open (PENDING/PROCESSING/COMPLETE) order already uses this `order_code`; body includes the existing `dashboard_order_id` |
| `400 INVALID_REQUEST` | missing `order_code` / `facility_code` / items |

### 3.2 `GET /api/v1/orders/:dashboard_order_id` — read

**200**

```json
{
  "dashboard_order_id": "ord_abc123",
  "order_code": "P-53011",
  "status": "PROCESSING",
  "updated_at": "2026-07-20T12:00:00Z",
  "items": [ { "sku_code": "SKU-COTTON-WHT-M", "quantity": 30, "dispatched_quantity": 0 } ]
}
```

`404 ORDER_NOT_FOUND` for unknown ids.

### 3.3 `PATCH /api/v1/orders/:dashboard_order_id` — edit

Full replace of `items` / `shipping_address` / `due_on` (same shapes as create; omitted fields untouched). The old stock hold is swapped for a new one — shrinking an order never fails because its own held stock is credited during the feasibility check.

**200**

```json
{ "dashboard_order_id": "ord_abc123", "order_code": "P-53011", "status": "PENDING", "updated_at": "2026-07-20T10:00:00Z" }
```

Errors: `409 ORDER_NOT_EDITABLE` (`details.status` = COMPLETE/CANCELLED/FAILED), `409 INSUFFICIENT_STOCK`, `404 ORDER_NOT_FOUND`.

### 3.4 `DELETE /api/v1/orders/:dashboard_order_id` — cancel

Releases held stock. **Idempotent** — cancelling again returns 200 with the original `cancelled_at`.

Query (optional): `reason=CUSTOMER_CANCELLED` / `ORDER_EDIT` / `OUT_OF_STOCK`.

**200**

```json
{ "dashboard_order_id": "ord_abc123", "order_code": "P-53011", "status": "CANCELLED", "cancelled_at": "2026-07-20T11:00:00Z" }
```

`409 ORDER_NOT_EDITABLE` when already COMPLETE or FAILED.

### 3.5 `POST /api/v1/orders/:dashboard_order_id/status` — progress (dashboard-internal)

How the fulfilment side moves an order forward. Same bearer key.

Body: `{ "status": "PROCESSING" | "COMPLETE" | "FAILED", "dispatched_at": "..." }` (`dispatched_at` optional, COMPLETE only).

- `PROCESSING` — from PENDING only.
- `COMPLETE` — terminal; fulfills the reservation (permanent stock deduction), sets `dispatched_at` + per-item `dispatched_quantity`.
- `FAILED` — terminal; releases the hold.

Errors: `400 INVALID_STATUS`, `409 ORDER_NOT_EDITABLE` / `INVALID_TRANSITION`, `404 ORDER_NOT_FOUND`.

---

## 4. Webhooks (dashboard → Scott backend)

Configured via Edge Function secrets `SCOTT_WEBHOOK_BASE_URL` + `SCOTT_WEBHOOK_SECRET`. Until both are set, events queue in the outbox and deliver on the next API call after configuration.

**Signature (all events):** header `X-Dashboard-Signature: sha256=<hmac-sha256-hex(rawBody, SCOTT_WEBHOOK_SECRET)>` — verify against the **raw** request body before trusting the payload.

**Delivery contract:** respond `2xx` (e.g. `200 { "received": true }`). Anything else (or a timeout) keeps the event queued; it is retried on the next stock/order mutation. Deduplicate on `event_id`.

### 4.1 `POST {base}/webhooks/orders/status_changed`

Fired on **every** order status transition.

```json
{
  "event": "order.status_changed",
  "event_id": "evt_pqr678",
  "occurred_at": "2026-07-20T14:00:00Z",
  "dashboard_order_id": "ord_abc123",
  "order_code": "P-53011",
  "previous_status": "PROCESSING",
  "status": "COMPLETE",
  "dispatched_at": "2026-07-20T14:00:00Z"
}
```

`dispatched_at` is present only when `status` is `COMPLETE`.

### 4.2 `POST {base}/webhooks/stock/level_changed`

Fired whenever available stock changes.

```json
{
  "event": "stock.level_changed",
  "event_id": "evt_abc123",
  "occurred_at": "2026-07-20T14:00:00Z",
  "facility_code": "SCOTT_1DAY_01",
  "trigger": "RESERVATION",
  "changed_skus": [
    { "sku_code": "SKU-COTTON-WHT-M", "previous_stock": 120, "current_stock": 119 }
  ]
}
```

`trigger`: `RESERVATION` / `RELEASE` / `FULFILLMENT` / `ADJUST`. Stock values are **available** quantity (on-hand − reserved).

### 4.3 `POST {base}/webhooks/stock/low_threshold`

Fired when an adjustment leaves available quantity below a SKU's reorder point.

```json
{
  "event": "stock.low_threshold",
  "event_id": "evt_def456",
  "occurred_at": "2026-07-20T14:00:00Z",
  "facility_code": "SCOTT_1DAY_01",
  "low_stock_items": [
    { "sku_code": "SKU-COTTON-WHT-M", "available": 8, "threshold": 20 }
  ]
}
```

### 4.4 Verifying the signature (Node.js example)

```js
const crypto = require("crypto");

function verify(rawBody, signatureHeader, secret) {
  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

### 4.5 Connectivity test

Dashboard admins can send a signed test `stock.level_changed` (with `"test": true`) from the header environment popover → **Send test webhook**. Use it to verify your receiver before real traffic.

---

## 5. Realtime / websockets

There is no custom websocket server — realtime uses **Supabase Realtime** (websocket under the hood, `wss://<project-ref>.supabase.co/realtime/v1/websocket`).

### 5.1 What the dashboard itself subscribes to (already built)

| Channel | Tables | Drives |
|---|---|---|
| `ready-stock-orders-live` | `scott_orders`, `scott_order_items` | Ready Stock Order tab — app orders appear/update instantly |
| inventory availability | `inventory_facility_stock` | Reserved / Available columns + KPIs refresh when the API reserves/releases/fulfills |
| dashboard live sync | `orders`, `profiles`, chat/goals/inventory tables | Rest of the app (pre-existing) |

### 5.2 Subscribing from your own client (optional)

Backend integration should prefer the webhooks above. If a client app with a Supabase login wants push updates without polling:

```js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// sign in first — scott_orders is readable by authenticated users only

supabase
  .channel("orders-live")
  .on("postgres_changes",
    { event: "*", schema: "public", table: "scott_orders" },
    (payload) => console.log("order changed:", payload))
  .subscribe();
```

Tables published for realtime: `scott_orders`, `scott_order_items`, `inventory_facility_stock`, plus the dashboard's internal tables. All are read-only to clients — mutations only via the REST API.

---

## 6. Postman collection

Everything above is importable:

| File | Purpose |
|---|---|
| `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json` | Stock + Orders + happy-path flows + webhook payload examples |
| `docs/postman/Scott_Dashboard_Stock_API.staging.postman_environment.json` | Staging base URL + key variable |
| `docs/postman/Scott_Dashboard_Stock_API.production.postman_environment.json` | Production base URL + key variable |

Steps: Postman → Import → drop the three files → select the **staging** environment → paste the API key into `DASHBOARD_API_KEY` → run. The Create order / Reserve requests auto-save `dashboard_order_id` / `reservation_id` for the follow-up requests. The "Webhooks" folder contains example payloads the dashboard sends — point `scott_webhook_base_url` at [webhook.site](https://webhook.site) or your mock server to prototype the receiver.

## 7. Related documents

- [DASHBOARD_STOCK_API.md](./DASHBOARD_STOCK_API.md) — stock API contract
- [DASHBOARD_ORDER_API.md](./DASHBOARD_ORDER_API.md) — order API contract
- [MOBILE_API_INTEGRATION.md](./MOBILE_API_INTEGRATION.md) — mobile app guide (keys, Flutter/RN samples)
- [openapi/dashboard-stock-api.yaml](./openapi/dashboard-stock-api.yaml) — OpenAPI spec (stock endpoints)
