# Dashboard Order API (Scott International)

Order lifecycle API for the Scott International backend — the dashboard plays the role UniCommerce plays today: Scott creates the order here, the dashboard progresses it through fulfillment, and notifies Scott of status changes via webhook.

**Spec source:** `order-api-requirements.html`
**Implementation:** Supabase Edge Function `dashboard-stock-api` (same function, same base URL and API key as the [Stock API](./DASHBOARD_STOCK_API.md))

## Base URL & authentication

Identical to the stock API:

```
https://<project-ref>.supabase.co/functions/v1/dashboard-stock-api
Authorization: Bearer <DASHBOARD_API_KEY>
```

## Order status values

Exactly these strings in API responses and webhook payloads (Scott's system keys off them, no mapping):

| Status | Meaning | Terminal | Where |
|--------|---------|----------|-------|
| `CREATED` | Order just received (webhook only on insert) | no | Webhook only — DB row is `PENDING` |
| `PENDING` | Order received, not started | no | API + webhook |
| `PROCESSING` | Being picked/packed | no | API + webhook |
| `COMPLETE` | Dispatched — stock permanently deducted | yes | API + webhook |
| `CANCELLED` | Cancelled — held stock released | yes | API + webhook |
| `FAILED` | Could not be placed / fulfilment failed — stock released | yes | API + webhook |

**Webhook status set:** `CREATED`, `PENDING`, `PROCESSING`, `COMPLETE`, `CANCELLED`, `FAILED`.

## Stock behaviour

- **Create** holds stock via an internal reservation (`inventory_stock_reservations`), same math as `POST /stock/reserve`. Available stock drops immediately.
- **Edit (items)** releases the old hold and creates a new one; feasibility is checked first crediting the order's own held stock, so shrinking an order never fails.
- **Cancel / FAILED** releases the hold.
- **COMPLETE** fulfills the reservation: on-hand deducted, `inventory_stock_movements` written, `inventory_skus.stock_qty` synced, items' `dispatched_quantity` set.

---

## POST /api/v1/orders

Create an order when a customer places an RMP order. Reserves stock.

**Body**

```json
{
  "order_code": "P-53011",
  "facility_code": "SCOTT_1DAY_01",
  "due_on": "2026-07-20T00:00:00Z",
  "customer": { "code": "P-104", "name": "Acme Traders", "email": "acme@example.com", "phone": "9876543210" },
  "shipping_address": { "name": "Acme Traders", "address_line1": "12 MG Road", "city": "Pune", "state": "MH", "country": "IN", "pincode": "411001" },
  "payment": { "instrument": "CASH", "cash_on_delivery": true },
  "comment": "Rush order - dispatch by Friday",
  "items": [
    { "item_code": "P-1-4201-88", "sku_code": "SKU-COTTON-WHT-M", "quantity": 50, "unit_price": 245.50 }
  ]
}
```

**201**

```json
{ "dashboard_order_id": "ord_abc123", "order_code": "P-53011", "status": "PENDING", "created_at": "2026-07-20T09:00:00Z" }
```

**Errors**

- `409 INSUFFICIENT_STOCK` — `details[]` with `sku_code`, `requested`, `available`.
- `409 ORDER_EXISTS` — an open (PENDING/PROCESSING/COMPLETE) order already uses this `order_code`. Re-create after CANCELLED/FAILED is allowed.
- `400 INVALID_REQUEST` — missing `order_code`, `facility_code`, or items.

---

## PATCH /api/v1/orders/:dashboard_order_id

Edit an order that hasn't been dispatched. `items` / `shipping_address` / `due_on` are a full replace (same shapes as create); omitted fields are untouched.

**200**

```json
{ "dashboard_order_id": "ord_abc123", "order_code": "P-53011", "status": "PENDING", "updated_at": "2026-07-20T10:00:00Z" }
```

**Errors:** `409 ORDER_NOT_EDITABLE` (`details.status` = COMPLETE/CANCELLED/FAILED), `409 INSUFFICIENT_STOCK`, `404 ORDER_NOT_FOUND`.

---

## DELETE /api/v1/orders/:dashboard_order_id

Cancel an order and release held stock. **Idempotent** — cancelling an already-cancelled order returns 200 with the original `cancelled_at`.

**Query (optional):** `reason=CUSTOMER_CANCELLED` (or `ORDER_EDIT`, `OUT_OF_STOCK`)

**200**

```json
{ "dashboard_order_id": "ord_abc123", "order_code": "P-53011", "status": "CANCELLED", "cancelled_at": "2026-07-20T11:00:00Z" }
```

**Errors:** `409 ORDER_NOT_EDITABLE` when already COMPLETE or FAILED, `404 ORDER_NOT_FOUND`.

---

## GET /api/v1/orders/:dashboard_order_id

Current status + items, for reconciliation/debugging.

**200**

```json
{
  "dashboard_order_id": "ord_abc123",
  "order_code": "P-53011",
  "status": "PROCESSING",
  "updated_at": "2026-07-20T12:00:00Z",
  "items": [
    { "sku_code": "SKU-COTTON-WHT-M", "quantity": 30, "dispatched_quantity": 0 }
  ]
}
```

---

## POST /api/v1/orders/:dashboard_order_id/status (dashboard-internal)

Not part of the Scott spec — this is how the dashboard side progresses fulfilment. Same bearer key.

**Body:** `{ "status": "PROCESSING" | "COMPLETE" | "FAILED", "dispatched_at": "..." }` (`dispatched_at` optional, COMPLETE only; use `DELETE` to cancel).

- `PROCESSING` — allowed from PENDING only.
- `COMPLETE` — fulfills the reservation (permanent deduction), sets `dispatched_at` and items' `dispatched_quantity`.
- `FAILED` — releases the reservation.

**Errors:** `400 INVALID_STATUS`, `409 ORDER_NOT_EDITABLE` / `INVALID_TRANSITION`, `404 ORDER_NOT_FOUND`.

---

## Webhook: order.status_changed (dashboard → Scott)

Fired on **order create** (`status: CREATED`, `previous_status: null`) and on **every subsequent status transition** (`status` matches the row: `PENDING`, `PROCESSING`, `COMPLETE`, `CANCELLED`, `FAILED`). Enqueued by a database trigger on `scott_orders` INSERT/UPDATE and delivered through `dashboard_webhook_outbox` — same retry contract and HMAC scheme as the stock webhooks.

**Webhook status values:** `CREATED`, `PENDING`, `PROCESSING`, `COMPLETE`, `CANCELLED`, `FAILED`. (`CREATED` is webhook-only at insert; the API row is stored as `PENDING`.)

**POST** `{SCOTT_WEBHOOK_BASE_URL}/webhooks/orders/status_changed`

**On create:**

```json
{
  "event": "order.status_changed",
  "event_id": "evt_abc123",
  "occurred_at": "2026-07-20T09:00:00Z",
  "dashboard_order_id": "ord_abc123",
  "order_code": "P-53011",
  "previous_status": null,
  "status": "CREATED"
}
```

**On transition (example COMPLETE):**

Header: `X-Dashboard-Signature: sha256=<hmac-sha256-hex(body, SCOTT_WEBHOOK_SECRET)>`

`dispatched_at` is present only when the new status is COMPLETE. Requires `SCOTT_WEBHOOK_BASE_URL` + `SCOTT_WEBHOOK_SECRET` secrets (not yet set on staging — deliveries stay `pending` in the outbox until then, and are drained on the next API call).

Stock webhooks (`stock.level_changed`) also fire from order create/edit/cancel/complete because those mutate availability.

---

## Data model

| Table | Purpose |
|-------|---------|
| `scott_orders` | One row per Scott order (`ord_*` id, status, facility, customer/address/payment JSON, `reservation_id` link) |
| `scott_order_items` | Line items (`sku_code`, `quantity`, `unit_price`, `dispatched_quantity`) |

Distinct from the internal printing-tracker `orders` table. Mutations are service-role only (edge function); dashboard users have read access. A partial unique index allows only one open order per `order_code`.

## Dashboard UI

Incoming app orders appear live in the **Ready Stock Order** sidebar tab (`src/ReadyStockOrdersPanel.jsx`) — status filters, search, customer/payment/item breakdown. Realtime via the `supabase_realtime` publication (`20260720130000_scott_orders_realtime.sql`).

## Deploy

```bash
supabase db push                                # migration 20260720120000_scott_orders.sql
supabase functions deploy dashboard-stock-api   # includes order routes
```

Verified on staging 2026-07-20: create → 450 avail, edit 50→30 → 470, PROCESSING → COMPLETE (deducted 30, `dispatched_quantity` 30), cancel idempotent, INSUFFICIENT_STOCK / ORDER_NOT_EDITABLE / 404 paths all correct.
