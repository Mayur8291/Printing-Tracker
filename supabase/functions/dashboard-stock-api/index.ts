// Scott International integration API: stock routes + order lifecycle routes.
// Deploy: supabase functions deploy dashboard-stock-api
// Secrets: DASHBOARD_API_KEY, SCOTT_WEBHOOK_BASE_URL, SCOTT_WEBHOOK_SECRET (optional for webhooks)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  adminClient,
  corsHeaders,
  errorResponse,
  fireStockWebhooks,
  fulfillReservation,
  getOrCreateFacilityStock,
  getSkuMap,
  jsonResponse,
  newId,
  parseItems,
  recomputeSkuStockTotal,
  releaseReservation,
  requireApiKey,
  reserveStockIdempotent,
  type SupabaseAdmin
} from "./stockCore.ts";
import {
  handleCancelOrder,
  handleCreateOrder,
  handleGetOrder,
  handleSetOrderStatus,
  handleUpdateOrder
} from "./orders.ts";

function parseSkuList(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function handleSnapshot(req: Request, client: SupabaseAdmin) {
  const url = new URL(req.url);
  const skuCodes = parseSkuList(url.searchParams.get("skus"));
  const facilityFilter = url.searchParams.get("facility")?.trim() || null;

  if (!skuCodes.length) {
    return errorResponse(400, "MISSING_SKUS", { message: "Query param skus is required (comma-separated)." });
  }

  const skuMap = await getSkuMap(client, skuCodes);
  const skuIds = [...skuMap.values()].map((s) => s.id);
  if (!skuIds.length) {
    return jsonResponse({ snapshot: {} });
  }

  let q = client
    .from("inventory_facility_stock")
    .select("facility_code, on_hand_qty, reserved_qty, sku_id, inventory_skus(sku_code)")
    .in("sku_id", skuIds);

  if (facilityFilter) {
    q = q.eq("facility_code", facilityFilter);
  }

  const { data, error } = await q;
  if (error) throw error;

  const requested = new Set(skuCodes);
  const snapshot: Record<string, number> = {};

  for (const row of data ?? []) {
    const skuCode = (row as { inventory_skus?: { sku_code?: string } }).inventory_skus?.sku_code;
    if (!skuCode || !requested.has(skuCode)) continue;
    const facilityCode = String(row.facility_code ?? "").trim();
    if (!facilityCode || facilityCode === "DEFAULT") continue;
    const available = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));
    const key = `${facilityCode}:${skuCode}`;
    snapshot[key] = available;
  }

  if (facilityFilter) {
    for (const skuCode of skuCodes) {
      if (!skuMap.has(skuCode)) continue;
      const key = `${facilityFilter}:${skuCode}`;
      if (!(key in snapshot)) snapshot[key] = 0;
    }
  }

  return jsonResponse({ snapshot });
}

async function handleReserve(req: Request, client: SupabaseAdmin) {
  const body = await req.json();
  const order_code = String(body.order_code ?? "").trim();
  const facility_code = String(body.facility_code ?? "").trim();
  const items = parseItems(body.items);

  if (!order_code || !facility_code || !items.length) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  const result = await reserveStockIdempotent(client, { order_code, facility_code, items });
  if (!result.ok) {
    return errorResponse(409, "INSUFFICIENT_STOCK", result.insufficient);
  }

  if (!result.reused && result.changed.length) {
    await fireStockWebhooks(client, {
      facility_code,
      trigger: "RESERVATION",
      changed: result.changed
    });
  }

  return jsonResponse(
    {
      reservation_id: result.reservation_id,
      order_code,
      status: "RESERVED",
      expires_at: result.expires_at,
      reused: result.reused
    },
    result.reused ? 200 : 201
  );
}

async function handleRelease(reservationId: string, req: Request, client: SupabaseAdmin) {
  const url = new URL(req.url);
  const reason = url.searchParams.get("reason")?.trim() || "CANCELLED";

  const result = await releaseReservation(client, reservationId, reason);
  if (!result.ok) {
    return errorResponse(result.status, result.error);
  }

  if (!result.already && result.changed.length) {
    await fireStockWebhooks(client, {
      facility_code: result.facility_code,
      trigger: "RELEASE",
      changed: result.changed
    });
  }

  return jsonResponse({
    reservation_id: reservationId,
    status: "RELEASED",
    released_at: result.released_at
  });
}

async function handleFulfill(reservationId: string, req: Request, client: SupabaseAdmin) {
  let dispatched_at = new Date().toISOString();
  try {
    const body = await req.json();
    if (body?.dispatched_at) dispatched_at = String(body.dispatched_at);
  } catch {
    /* empty body OK */
  }

  const result = await fulfillReservation(client, reservationId, dispatched_at);
  if (!result.ok) {
    return errorResponse(result.status, result.error);
  }

  if (!result.already && result.changed.length) {
    await fireStockWebhooks(client, {
      facility_code: result.facility_code,
      trigger: "FULFILLMENT",
      changed: result.changed
    });
  }

  return jsonResponse({
    reservation_id: reservationId,
    status: "FULFILLED",
    fulfilled_at: result.fulfilled_at,
    stock_deducted: result.stock_deducted
  });
}

async function handleAdjust(req: Request, client: SupabaseAdmin) {
  const body = await req.json();
  const facility_code = String(body.facility_code ?? "").trim();
  const reason = String(body.reason ?? "MANUAL_ADJUST").trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!facility_code || !items.length) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  const skuCodes = items.map((i: { sku_code?: string }) => String(i.sku_code ?? "").trim()).filter(Boolean);
  const skuMap = await getSkuMap(client, skuCodes);
  const adjustment_id = newId("adj_");
  const applied_at = new Date().toISOString();
  const results: { sku_code: string; before: number; after: number }[] = [];
  const changed: { sku_code: string; previous_stock: number; current_stock: number }[] = [];
  const lowStock: { sku_code: string; available: number; threshold: number }[] = [];

  await client.from("inventory_stock_adjustments").insert({
    id: adjustment_id,
    facility_code,
    reason,
    applied_at
  });

  for (const item of items) {
    const sku_code = String(item.sku_code ?? "").trim();
    const delta = Number(item.delta);
    if (!sku_code || !Number.isFinite(delta) || delta === 0) continue;

    const sku = skuMap.get(sku_code);
    if (!sku) continue;

    const row = await getOrCreateFacilityStock(client, sku.id, facility_code);
    const before = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));
    const newOnHand = Math.max(0, Number(row.on_hand_qty) + delta);

    if (newOnHand < Number(row.reserved_qty)) {
      return errorResponse(409, "INSUFFICIENT_STOCK", [
        { sku_code, requested: Math.abs(delta), available: before }
      ]);
    }

    await client
      .from("inventory_facility_stock")
      .update({ on_hand_qty: newOnHand, updated_at: applied_at })
      .eq("id", row.id);

    await client.from("inventory_stock_adjustment_items").insert({
      adjustment_id,
      sku_id: sku.id,
      sku_code,
      delta,
      qty_before: Number(row.on_hand_qty),
      qty_after: newOnHand
    });

    await client.from("inventory_stock_movements").insert({
      sku_id: sku.id,
      movement_type: delta >= 0 ? "IN" : "OUT",
      qty: delta,
      reason,
      reference: adjustment_id
    });

    await recomputeSkuStockTotal(client, sku.id);

    const after = Math.max(0, newOnHand - Number(row.reserved_qty));
    results.push({ sku_code, before, after });
    changed.push({ sku_code, previous_stock: before, current_stock: after });

    const { data: skuRow } = await client
      .from("inventory_skus")
      .select("reorder_point")
      .eq("id", sku.id)
      .maybeSingle();
    const threshold = Number(skuRow?.reorder_point ?? 0);
    if (threshold > 0 && after < threshold) {
      lowStock.push({ sku_code, available: after, threshold });
    }
  }

  await fireStockWebhooks(client, {
    facility_code,
    trigger: "ADJUST",
    changed,
    lowStock
  });

  return jsonResponse({ adjustment_id, applied_at, results });
}

function routePath(req: Request): string {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/dashboard-stock-api/, "").replace(/\/$/, "") || "/";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const client = adminClient();

  const authFail = await requireApiKey(req, client);
  if (authFail) return authFail;

  const path = routePath(req);

  try {
    // Stock routes
    if (req.method === "GET" && path === "/api/v1/stock/snapshot") {
      return await handleSnapshot(req, client);
    }
    if (req.method === "POST" && path === "/api/v1/stock/reserve") {
      return await handleReserve(req, client);
    }
    if (req.method === "DELETE" && path.startsWith("/api/v1/stock/reserve/")) {
      const id = path.slice("/api/v1/stock/reserve/".length);
      return await handleRelease(id, req, client);
    }
    if (req.method === "POST" && path.startsWith("/api/v1/stock/fulfill/")) {
      const id = path.slice("/api/v1/stock/fulfill/".length);
      return await handleFulfill(id, req, client);
    }
    if (req.method === "POST" && path === "/api/v1/stock/adjust") {
      return await handleAdjust(req, client);
    }

    // Order routes
    if (req.method === "POST" && path === "/api/v1/orders") {
      return await handleCreateOrder(req, client);
    }
    const orderMatch = path.match(/^\/api\/v1\/orders\/([^/]+)(\/status)?$/);
    if (orderMatch) {
      const orderId = decodeURIComponent(orderMatch[1]);
      if (orderMatch[2] === "/status" && req.method === "POST") {
        return await handleSetOrderStatus(orderId, req, client);
      }
      if (!orderMatch[2]) {
        if (req.method === "GET") return await handleGetOrder(orderId, client);
        if (req.method === "PATCH") return await handleUpdateOrder(orderId, req, client);
        if (req.method === "DELETE") return await handleCancelOrder(orderId, req, client);
      }
    }

    return errorResponse(404, "NOT_FOUND", { path });
  } catch (e) {
    console.error("dashboard-stock-api", e);
    return errorResponse(500, "INTERNAL_ERROR", { message: String(e) });
  }
});
