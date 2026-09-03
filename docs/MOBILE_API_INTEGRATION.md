# Mobile App Integration Guide — Dashboard Stock API

How to integrate the Scott Dashboard Stock API into the mobile application (Flutter / React Native / native).

**Spec source:** `dashboard-api-requirements.pdf`
**Backend:** Supabase Edge Function `dashboard-stock-api` (see [DASHBOARD_STOCK_API.md](./DASHBOARD_STOCK_API.md) for full endpoint reference)

---

## 1. Environments & keys

| Environment | Base URL | API key |
|---|---|---|
| **Staging** (use for all development & testing) | `https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/dashboard-stock-api` | `scott-staging-a50fde434c0470fb416954a08bb39f4c69585b90a6bbef94` |
| **Production** | `https://levwrmvqdntngeasrtnb.supabase.co/functions/v1/dashboard-stock-api` | Issued 2026-09-03 (NotFunny) — send over a private channel; not stored in git. Admin → Integrations shows prefix `scott_d1ef3cf4`. |

> ⚠️ **Key handling:** never hard-code the API key in the mobile app binary if the app talks to this API through your own backend (recommended). If the mobile app calls the dashboard directly, store the key in secure storage / remote config, not in source control.

### Where keys live on the dashboard side

- Supabase Dashboard → project → **Edge Functions → Secrets** → `DASHBOARD_API_KEY`
- Webhook signing (optional): `SCOTT_WEBHOOK_BASE_URL`, `SCOTT_WEBHOOK_SECRET`

---

## 2. Authentication

Every request must send:

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Missing/wrong key → `401 {"error":"UNAUTHORIZED"}`.
Key not configured server-side → `503 {"error":"API_NOT_CONFIGURED"}`.

---

## 3. Endpoints (quick reference)

All paths are relative to the base URL above.

| # | Method & path | Purpose |
|---|---|---|
| 1 | `GET /api/v1/stock/snapshot?skus=A,B&facility=F` | Stock levels for multiple SKUs (product listing, catalogue, search) |
| 2 | `POST /api/v1/stock/reserve` | Reserve stock when an order is placed |
| 3 | `DELETE /api/v1/stock/reserve/:reservation_id?reason=CANCELLED` | Release reserved stock (cancel / edit). Idempotent |
| 4 | `POST /api/v1/stock/fulfill/:reservation_id` | Convert reservation to permanent deduction on order COMPLETE |
| 5 | `POST /api/v1/stock/adjust` | Manual stock correction (damage, returns, count errors) |

### 3.1 Snapshot

```bash
curl "$BASE/api/v1/stock/snapshot?skus=SKU-COTTON-WHT-M,SKU-COTTON-WHT-L&facility=SCOTT_1DAY_01" \
  -H "Authorization: Bearer $API_KEY"
```

```json
{
  "snapshot": {
    "SCOTT_1DAY_01:SKU-COTTON-WHT-M": 120,
    "SCOTT_1DAY_01:SKU-COTTON-WHT-L": 85
  }
}
```

Keys are always `FACILITY_CODE:SKU_CODE`. Unknown SKUs are simply omitted (empty object if none found). Values are **available** stock (`on_hand − reserved`).

### 3.2 Reserve

```bash
curl -X POST "$BASE/api/v1/stock/reserve" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "order_code": "P-53011",
    "facility_code": "SCOTT_1DAY_01",
    "items": [
      { "sku_code": "SKU-COTTON-WHT-M", "item_code": "P-1-4201-88", "quantity": 50 }
    ]
  }'
```

- **201** → `{ "reservation_id": "rsv_…", "order_code", "status": "RESERVED", "expires_at" }` — store `reservation_id`; you need it for release/fulfill.
- **409** → `{ "error": "INSUFFICIENT_STOCK", "details": [{ "sku_code", "requested", "available" }] }` — show the shortage to the user; nothing was reserved.
- Reservations expire 24 h after creation (`expires_at`).

### 3.3 Release (cancel / order edit)

```bash
curl -X DELETE "$BASE/api/v1/stock/reserve/rsv_abc123?reason=CANCELLED" \
  -H "Authorization: Bearer $API_KEY"
```

- **200** → `{ "reservation_id", "status": "RELEASED", "released_at" }`
- Idempotent: releasing twice returns 200 again.
- **409 ALREADY_FULFILLED** if the order was already dispatched.
- **404 RESERVATION_NOT_FOUND** for unknown ids.

### 3.4 Fulfill (order complete)

```bash
curl -X POST "$BASE/api/v1/stock/fulfill/rsv_abc123" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{ "dispatched_at": "2026-06-30T14:00:00Z" }'   # body optional
```

- **200** → `{ "reservation_id", "status": "FULFILLED", "fulfilled_at", "stock_deducted": [{ "sku_code", "deducted", "remaining" }] }`
- Idempotent: fulfilling twice returns 200 with empty `stock_deducted`.
- **409 RESERVATION_RELEASED** if it was already cancelled.

### 3.5 Adjust (manual correction)

```bash
curl -X POST "$BASE/api/v1/stock/adjust" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "facility_code": "SCOTT_1DAY_01",
    "reason": "DAMAGE_WRITE_OFF",
    "items": [{ "sku_code": "SKU-COTTON-WHT-M", "delta": -12 }]
  }'
```

- **200** → `{ "adjustment_id", "applied_at", "results": [{ "sku_code", "before", "after" }] }`
- Unknown SKUs are skipped (not in `results`).
- **409 INSUFFICIENT_STOCK** if a negative delta would drop on-hand below reserved.

---

## 4. Error handling in the app

| HTTP | `error` | What the app should do |
|---|---|---|
| 400 | `INVALID_REQUEST`, `MISSING_SKUS` | Bug in request building — fix payload |
| 401 | `UNAUTHORIZED` | Wrong/expired key — refresh config, alert ops |
| 404 | `RESERVATION_NOT_FOUND`, `NOT_FOUND` | Reservation id lost/typo — reconcile locally |
| 409 | `INSUFFICIENT_STOCK` | Show shortage per SKU (`details[]`) |
| 409 | `ALREADY_FULFILLED` / `RESERVATION_RELEASED` | State conflict — refetch order state |
| 500 | `INTERNAL_ERROR` | Retry with backoff (max 3), then surface error |
| 503 | `API_NOT_CONFIGURED` | Server-side misconfig — alert dashboard team |

Retry guidance: `GET snapshot`, `DELETE release`, and **`POST /api/v1/orders`** (idempotent when an open `RESERVED` row already exists for the `order_code`) are safe to retry. Prefer **`POST /api/v1/orders` only** — do not also call `POST /stock/reserve` for the same order. Legacy `POST /stock/reserve` returns `200` with `reused: true` when a hold already exists.

---

## 5. Flutter / Dart client example

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class StockApiClient {
  StockApiClient({required this.baseUrl, required this.apiKey});

  final String baseUrl; // e.g. https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/dashboard-stock-api
  final String apiKey;

  Map<String, String> get _headers => {
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      };

  /// Returns {"FACILITY:SKU": qty}
  Future<Map<String, int>> snapshot(List<String> skus, {String? facility}) async {
    final query = {
      'skus': skus.join(','),
      if (facility != null) 'facility': facility,
    };
    final uri = Uri.parse('$baseUrl/api/v1/stock/snapshot')
        .replace(queryParameters: query);
    final res = await http.get(uri, headers: _headers);
    _check(res, 200);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return (body['snapshot'] as Map<String, dynamic>)
        .map((k, v) => MapEntry(k, (v as num).toInt()));
  }

  Future<Map<String, dynamic>> reserve({
    required String orderCode,
    required String facilityCode,
    required List<Map<String, dynamic>> items, // {sku_code, item_code, quantity}
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/v1/stock/reserve'),
      headers: _headers,
      body: jsonEncode({
        'order_code': orderCode,
        'facility_code': facilityCode,
        'items': items,
      }),
    );
    if (res.statusCode == 409) {
      throw InsufficientStockException(jsonDecode(res.body)['details']);
    }
    _check(res, 201);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<void> release(String reservationId, {String reason = 'CANCELLED'}) async {
    final res = await http.delete(
      Uri.parse('$baseUrl/api/v1/stock/reserve/$reservationId?reason=$reason'),
      headers: _headers,
    );
    _check(res, 200);
  }

  Future<Map<String, dynamic>> fulfill(String reservationId,
      {DateTime? dispatchedAt}) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/v1/stock/fulfill/$reservationId'),
      headers: _headers,
      body: jsonEncode({
        if (dispatchedAt != null)
          'dispatched_at': dispatchedAt.toUtc().toIso8601String(),
      }),
    );
    _check(res, 200);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  void _check(http.Response res, int expected) {
    if (res.statusCode != expected) {
      throw StockApiException(res.statusCode, res.body);
    }
  }
}

class StockApiException implements Exception {
  StockApiException(this.status, this.body);
  final int status;
  final String body;
  @override
  String toString() => 'StockApiException($status): $body';
}

class InsufficientStockException implements Exception {
  InsufficientStockException(this.details);
  final dynamic details; // [{sku_code, requested, available}]
}
```

Usage:

```dart
final api = StockApiClient(
  baseUrl: 'https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/dashboard-stock-api',
  apiKey: '<STAGING_KEY>',
);

final stock = await api.snapshot(['SKU-COTTON-WHT-M'], facility: 'SCOTT_1DAY_01');
```

## 6. JavaScript / React Native example

```js
const BASE = "https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/dashboard-stock-api";
const KEY = "<STAGING_KEY>";

async function stockApi(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status, details: data.details });
  return data;
}

// Snapshot
const { snapshot } = await stockApi(
  "/api/v1/stock/snapshot?skus=SKU-COTTON-WHT-M,SKU-COTTON-WHT-L&facility=SCOTT_1DAY_01"
);

// Reserve
const reservation = await stockApi("/api/v1/stock/reserve", {
  method: "POST",
  body: {
    order_code: "P-53011",
    facility_code: "SCOTT_1DAY_01",
    items: [{ sku_code: "SKU-COTTON-WHT-M", item_code: "P-1-4201-88", quantity: 50 }],
  },
});
```

---

## 7. Webhooks (dashboard → your backend)

If the mobile app has its own backend, the dashboard can push stock changes instead of the app polling:

| Event | Path on your server | Fired on |
|---|---|---|
| `stock.level_changed` | `POST {your_base}/webhooks/stock/level_changed` | reserve, release, fulfill, adjust |
| `stock.low_threshold` | `POST {your_base}/webhooks/stock/low_threshold` | available stock drops below SKU reorder point |

Setup: give the dashboard team your base URL + a shared secret → set as `SCOTT_WEBHOOK_BASE_URL` and `SCOTT_WEBHOOK_SECRET` in Edge Function secrets.

Each request carries `X-Dashboard-Signature: sha256=<hmac-sha256-hex(rawBody)>`. Verify (Node example):

```js
import crypto from "crypto";

function verifySignature(rawBody, signatureHeader, secret) {
  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Respond `200 { "received": true }`. Non-2xx responses are queued in `dashboard_webhook_outbox` and retried on the next stock mutation.

---

## 8. Testing checklist (staging)

1. `GET snapshot` with a real SKU → quantities keyed `FACILITY:SKU`.
2. `POST reserve` more than available → 409 with `details[]`.
3. `POST reserve` valid → 201, save `reservation_id`.
4. `GET snapshot` again → available dropped by the reserved quantity.
5. `DELETE release` → 200; snapshot back to original. Repeat delete → still 200 (idempotent).
6. Reserve again → `POST fulfill` → 200 with `stock_deducted[]`; snapshot shows permanent deduction.
7. `POST adjust` with negative/positive delta → before/after in `results[]`.

Postman collection with all of these pre-built: `docs/postman/Scott_Dashboard_Stock_API.postman_collection.json` (+ staging/production environment files, see [docs/postman/README.md](./postman/README.md)).

---

## 9. Production go-live steps (dashboard team)

Production is **not deployed yet** (staging-first policy). When ready:

1. `npx supabase link --project-ref levwrmvqdntngeasrtnb`
2. `npx supabase db push` (applies `20260710120000_dashboard_stock_api.sql`)
3. Set `DASHBOARD_API_KEY` (new production-only value), optional webhook secrets, in Edge Function secrets
4. `npx supabase functions deploy dashboard-stock-api`
5. Re-link CLI to staging: `npx supabase link --project-ref scvojtvgnkmbupvyslmb`
6. Share the production key with the mobile/backend team over a secure channel (not email/chat plaintext)
