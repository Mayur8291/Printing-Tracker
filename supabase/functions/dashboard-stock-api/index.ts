// Deploy: supabase functions deploy dashboard-stock-api
// Secrets: DASHBOARD_API_KEY, SCOTT_WEBHOOK_BASE_URL, SCOTT_WEBHOOK_SECRET (optional for webhooks)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};

type SupabaseAdmin = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function errorResponse(status: number, error: string, details?: unknown) {
  return jsonResponse(details ? { error, details } : { error }, status);
}

function requireApiKey(req: Request): Response | null {
  const expected = Deno.env.get("DASHBOARD_API_KEY")?.trim();
  if (!expected) {
    return errorResponse(503, "API_NOT_CONFIGURED", {
      message: "Set DASHBOARD_API_KEY in Supabase Edge Function secrets."
    });
  }
  const auth = req.headers.get("Authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return errorResponse(401, "UNAUTHORIZED");
  }
  return null;
}

function adminClient(): SupabaseAdmin {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );
}

function newId(prefix: string) {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function parseSkuList(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getSkuMap(client: SupabaseAdmin, skuCodes: string[]) {
  if (!skuCodes.length) return new Map<string, { id: string; sku_code: string }>();
  const { data, error } = await client
    .from("inventory_skus")
    .select("id, sku_code")
    .in("sku_code", skuCodes);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.sku_code, r]));
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
    const available = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));
    const key = `${row.facility_code}:${skuCode}`;
    snapshot[key] = available;
  }

  return jsonResponse({ snapshot });
}

async function fireStockWebhooks(
  client: SupabaseAdmin,
  opts: {
    facility_code: string;
    trigger: "RESERVATION" | "RELEASE" | "FULFILLMENT" | "ADJUST";
    changed: { sku_code: string; previous_stock: number; current_stock: number }[];
    lowStock?: { sku_code: string; available: number; threshold: number }[];
  }
) {
  const occurred = new Date().toISOString();
  const eventId = () => `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  if (opts.changed.length) {
    await client.rpc("enqueue_dashboard_webhook", {
      p_event_type: "stock.level_changed",
      p_payload: {
        event: "stock.level_changed",
        event_id: eventId(),
        occurred_at: occurred,
        facility_code: opts.facility_code,
        trigger: opts.trigger,
        changed_skus: opts.changed
      }
    });
  }

  if (opts.lowStock?.length) {
    await client.rpc("enqueue_dashboard_webhook", {
      p_event_type: "stock.low_threshold",
      p_payload: {
        event: "stock.low_threshold",
        event_id: eventId(),
        occurred_at: occurred,
        facility_code: opts.facility_code,
        low_stock_items: opts.lowStock
      }
    });
  }

  await deliverPendingWebhooks(client);
}

async function deliverPendingWebhooks(client: SupabaseAdmin) {
  const base = Deno.env.get("SCOTT_WEBHOOK_BASE_URL")?.trim().replace(/\/$/, "");
  const secret = Deno.env.get("SCOTT_WEBHOOK_SECRET")?.trim();
  if (!base || !secret) return;

  const { data: pending } = await client
    .from("dashboard_webhook_outbox")
    .select("id, event_type, payload, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);

  for (const row of pending ?? []) {
    const path =
      row.event_type === "stock.low_threshold"
        ? "/webhooks/stock/low_threshold"
        : "/webhooks/stock/level_changed";
    const body = JSON.stringify(row.payload);
    const sig = await hmacSha256Hex(secret, body);

    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Signature": `sha256=${sig}`
        },
        body
      });
      if (res.ok) {
        await client
          .from("dashboard_webhook_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id);
      } else {
        const errText = await res.text();
        await client
          .from("dashboard_webhook_outbox")
          .update({
            attempts: (row.attempts ?? 0) + 1,
            last_error: `${res.status} ${errText}`.slice(0, 500)
          })
          .eq("id", row.id);
      }
    } catch (e) {
      await client
        .from("dashboard_webhook_outbox")
        .update({
          attempts: (row.attempts ?? 0) + 1,
          last_error: String(e).slice(0, 500)
        })
        .eq("id", row.id);
    }
  }
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateFacilityStock(
  client: SupabaseAdmin,
  skuId: string,
  facilityCode: string
) {
  const { data: existing } = await client
    .from("inventory_facility_stock")
    .select("*")
    .eq("sku_id", skuId)
    .eq("facility_code", facilityCode)
    .maybeSingle();

  if (existing) return existing;

  const { data: inserted, error } = await client
    .from("inventory_facility_stock")
    .insert({ sku_id: skuId, facility_code: facilityCode, on_hand_qty: 0, reserved_qty: 0 })
    .select("*")
    .single();
  if (error) throw error;
  return inserted;
}

async function handleReserve(req: Request, client: SupabaseAdmin) {
  const body = await req.json();
  const order_code = String(body.order_code ?? "").trim();
  const facility_code = String(body.facility_code ?? "").trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!order_code || !facility_code || !items.length) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  const skuCodes = items.map((i: { sku_code?: string }) => String(i.sku_code ?? "").trim()).filter(Boolean);
  const skuMap = await getSkuMap(client, skuCodes);
  const insufficient: { sku_code: string; requested: number; available: number }[] = [];

  for (const item of items) {
    const sku_code = String(item.sku_code ?? "").trim();
    const quantity = Number(item.quantity);
    if (!sku_code || !Number.isFinite(quantity) || quantity <= 0) continue;
    const sku = skuMap.get(sku_code);
    if (!sku) {
      insufficient.push({ sku_code, requested: quantity, available: 0 });
      continue;
    }
    const row = await getOrCreateFacilityStock(client, sku.id, facility_code);
    const available = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));
    if (available < quantity) {
      insufficient.push({ sku_code, requested: quantity, available });
    }
  }

  if (insufficient.length) {
    return errorResponse(409, "INSUFFICIENT_STOCK", insufficient);
  }

  const reservation_id = newId("rsv_");
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const changed: { sku_code: string; previous_stock: number; current_stock: number }[] = [];

  const { error: resErr } = await client.from("inventory_stock_reservations").insert({
    id: reservation_id,
    order_code,
    facility_code,
    status: "RESERVED",
    expires_at
  });
  if (resErr) throw resErr;

  for (const item of items) {
    const sku_code = String(item.sku_code ?? "").trim();
    const item_code = String(item.item_code ?? "").trim();
    const quantity = Number(item.quantity);
    const sku = skuMap.get(sku_code)!;
    const row = await getOrCreateFacilityStock(client, sku.id, facility_code);
    const prevAvailable = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));

    await client.from("inventory_stock_reservation_items").insert({
      reservation_id,
      sku_id: sku.id,
      sku_code,
      item_code,
      quantity
    });

    const newReserved = Number(row.reserved_qty) + quantity;
    await client
      .from("inventory_facility_stock")
      .update({ reserved_qty: newReserved, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    changed.push({
      sku_code,
      previous_stock: prevAvailable,
      current_stock: prevAvailable - quantity
    });
  }

  await fireStockWebhooks(client, {
    facility_code,
    trigger: "RESERVATION",
    changed
  });

  return jsonResponse(
    {
      reservation_id,
      order_code,
      status: "RESERVED",
      expires_at
    },
    201
  );
}

async function handleRelease(reservationId: string, req: Request, client: SupabaseAdmin) {
  const url = new URL(req.url);
  const reason = url.searchParams.get("reason")?.trim() || "CANCELLED";

  const { data: reservation } = await client
    .from("inventory_stock_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (!reservation) {
    return errorResponse(404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status === "RELEASED") {
    return jsonResponse({
      reservation_id: reservationId,
      status: "RELEASED",
      released_at: reservation.released_at ?? new Date().toISOString()
    });
  }

  if (reservation.status === "FULFILLED") {
    return errorResponse(409, "ALREADY_FULFILLED");
  }

  const { data: items } = await client
    .from("inventory_stock_reservation_items")
    .select("*")
    .eq("reservation_id", reservationId);

  const changed: { sku_code: string; previous_stock: number; current_stock: number }[] = [];
  const released_at = new Date().toISOString();

  for (const item of items ?? []) {
    const { data: stock } = await client
      .from("inventory_facility_stock")
      .select("*")
      .eq("sku_id", item.sku_id)
      .eq("facility_code", reservation.facility_code)
      .maybeSingle();

    if (!stock) continue;
    const prevAvailable = Math.max(0, Number(stock.on_hand_qty) - Number(stock.reserved_qty));
    const newReserved = Math.max(0, Number(stock.reserved_qty) - Number(item.quantity));
    await client
      .from("inventory_facility_stock")
      .update({ reserved_qty: newReserved, updated_at: released_at })
      .eq("id", stock.id);

    const newAvailable = Math.max(0, Number(stock.on_hand_qty) - newReserved);
    changed.push({
      sku_code: item.sku_code,
      previous_stock: prevAvailable,
      current_stock: newAvailable
    });
  }

  await client
    .from("inventory_stock_reservations")
    .update({ status: "RELEASED", released_at, release_reason: reason })
    .eq("id", reservationId);

  await fireStockWebhooks(client, {
    facility_code: reservation.facility_code,
    trigger: "RELEASE",
    changed
  });

  return jsonResponse({
    reservation_id: reservationId,
    status: "RELEASED",
    released_at
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

  const { data: reservation } = await client
    .from("inventory_stock_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (!reservation) {
    return errorResponse(404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status === "FULFILLED") {
    return jsonResponse({
      reservation_id: reservationId,
      status: "FULFILLED",
      fulfilled_at: reservation.fulfilled_at,
      stock_deducted: []
    });
  }

  if (reservation.status === "RELEASED") {
    return errorResponse(409, "RESERVATION_RELEASED");
  }

  const { data: items } = await client
    .from("inventory_stock_reservation_items")
    .select("*")
    .eq("reservation_id", reservationId);

  const stock_deducted: { sku_code: string; deducted: number; remaining: number }[] = [];
  const changed: { sku_code: string; previous_stock: number; current_stock: number }[] = [];

  for (const item of items ?? []) {
    const { data: stock } = await client
      .from("inventory_facility_stock")
      .select("*")
      .eq("sku_id", item.sku_id)
      .eq("facility_code", reservation.facility_code)
      .maybeSingle();

    if (!stock) continue;
    const qty = Number(item.quantity);
    const prevAvailable = Math.max(0, Number(stock.on_hand_qty) - Number(stock.reserved_qty));
    const newOnHand = Math.max(0, Number(stock.on_hand_qty) - qty);
    const newReserved = Math.max(0, Number(stock.reserved_qty) - qty);

    await client
      .from("inventory_facility_stock")
      .update({
        on_hand_qty: newOnHand,
        reserved_qty: newReserved,
        updated_at: dispatched_at
      })
      .eq("id", stock.id);

    await client.from("inventory_stock_movements").insert({
      sku_id: item.sku_id,
      movement_type: "OUT",
      qty: -qty,
      reason: "Order fulfillment",
      reference: reservation.order_code
    });

    await client
      .from("inventory_skus")
      .update({ stock_qty: newOnHand })
      .eq("id", item.sku_id);

    const remaining = Math.max(0, newOnHand - newReserved);
    stock_deducted.push({ sku_code: item.sku_code, deducted: qty, remaining });
    changed.push({
      sku_code: item.sku_code,
      previous_stock: prevAvailable,
      current_stock: remaining
    });
  }

  await client
    .from("inventory_stock_reservations")
    .update({ status: "FULFILLED", fulfilled_at: dispatched_at })
    .eq("id", reservationId);

  await fireStockWebhooks(client, {
    facility_code: reservation.facility_code,
    trigger: "FULFILLMENT",
    changed
  });

  return jsonResponse({
    reservation_id: reservationId,
    status: "FULFILLED",
    fulfilled_at: dispatched_at,
    stock_deducted
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

    await client.from("inventory_skus").update({ stock_qty: newOnHand }).eq("id", sku.id);

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

  const authFail = requireApiKey(req);
  if (authFail) return authFail;

  const client = adminClient();
  const path = routePath(req);

  try {
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

    return errorResponse(404, "NOT_FOUND", { path });
  } catch (e) {
    console.error("dashboard-stock-api", e);
    return errorResponse(500, "INTERNAL_ERROR", { message: String(e) });
  }
});
