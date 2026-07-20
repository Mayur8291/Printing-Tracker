// Shared stock primitives for the Scott International API (stock + order routes).
// Reserve/release/fulfill mutate inventory_facility_stock and the reservation
// tables; webhooks are enqueued in dashboard_webhook_outbox and drained here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
};

export type SupabaseAdmin = ReturnType<typeof createClient>;

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

export function errorResponse(status: number, error: string, details?: unknown) {
  return jsonResponse(details ? { error, details } : { error }, status);
}

export async function sha256Hex(message: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Accepts either the legacy DASHBOARD_API_KEY secret or any active key from
 * dashboard_api_keys (admin settings → API keys; sha256 hashes only).
 */
export async function requireApiKey(req: Request, client: SupabaseAdmin): Promise<Response | null> {
  const auth = req.headers.get("Authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return errorResponse(401, "UNAUTHORIZED");
  }

  const expected = Deno.env.get("DASHBOARD_API_KEY")?.trim();
  if (expected && token === expected) {
    return null;
  }

  const hash = await sha256Hex(token);
  const { data: keyRow } = await client
    .from("dashboard_api_keys")
    .select("id, status")
    .eq("key_hash", hash)
    .maybeSingle();

  if (keyRow?.status === "active") {
    await client
      .from("dashboard_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRow.id);
    return null;
  }

  if (keyRow?.status === "disabled") {
    return errorResponse(401, "KEY_DISABLED");
  }
  return errorResponse(401, "UNAUTHORIZED");
}

export function adminClient(): SupabaseAdmin {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );
}

export function newId(prefix: string) {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function getSkuMap(client: SupabaseAdmin, skuCodes: string[]) {
  if (!skuCodes.length) return new Map<string, { id: string; sku_code: string }>();
  const { data, error } = await client
    .from("inventory_skus")
    .select("id, sku_code")
    .in("sku_code", skuCodes);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.sku_code, r]));
}

export async function getOrCreateFacilityStock(
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

export type OrderItemInput = { sku_code: string; item_code: string; quantity: number };
export type Insufficient = { sku_code: string; requested: number; available: number };
export type StockChange = { sku_code: string; previous_stock: number; current_stock: number };

export function parseItems(raw: unknown): OrderItemInput[] {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .map((i: Record<string, unknown>) => ({
      sku_code: String(i?.sku_code ?? "").trim(),
      item_code: String(i?.item_code ?? "").trim(),
      quantity: Number(i?.quantity)
    }))
    .filter((i) => i.sku_code && Number.isFinite(i.quantity) && i.quantity > 0);
}

/** Check availability and hold stock. Returns insufficient[] OR the created reservation. */
export async function reserveStock(
  client: SupabaseAdmin,
  opts: { order_code: string; facility_code: string; items: OrderItemInput[] }
): Promise<
  | { ok: false; insufficient: Insufficient[] }
  | { ok: true; reservation_id: string; expires_at: string; changed: StockChange[] }
> {
  const skuMap = await getSkuMap(client, opts.items.map((i) => i.sku_code));
  const insufficient: Insufficient[] = [];

  for (const item of opts.items) {
    const sku = skuMap.get(item.sku_code);
    if (!sku) {
      insufficient.push({ sku_code: item.sku_code, requested: item.quantity, available: 0 });
      continue;
    }
    const row = await getOrCreateFacilityStock(client, sku.id, opts.facility_code);
    const available = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));
    if (available < item.quantity) {
      insufficient.push({ sku_code: item.sku_code, requested: item.quantity, available });
    }
  }

  if (insufficient.length) {
    return { ok: false, insufficient };
  }

  const reservation_id = newId("rsv_");
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const changed: StockChange[] = [];

  const { error: resErr } = await client.from("inventory_stock_reservations").insert({
    id: reservation_id,
    order_code: opts.order_code,
    facility_code: opts.facility_code,
    status: "RESERVED",
    expires_at
  });
  if (resErr) throw resErr;

  for (const item of opts.items) {
    const sku = skuMap.get(item.sku_code)!;
    const row = await getOrCreateFacilityStock(client, sku.id, opts.facility_code);
    const prevAvailable = Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty));

    await client.from("inventory_stock_reservation_items").insert({
      reservation_id,
      sku_id: sku.id,
      sku_code: item.sku_code,
      item_code: item.item_code,
      quantity: item.quantity
    });

    await client
      .from("inventory_facility_stock")
      .update({
        reserved_qty: Number(row.reserved_qty) + item.quantity,
        updated_at: new Date().toISOString()
      })
      .eq("id", row.id);

    changed.push({
      sku_code: item.sku_code,
      previous_stock: prevAvailable,
      current_stock: prevAvailable - item.quantity
    });
  }

  return { ok: true, reservation_id, expires_at, changed };
}

/** Release a reservation back to available. Idempotent for already-released. */
export async function releaseReservation(
  client: SupabaseAdmin,
  reservationId: string,
  reason: string
): Promise<
  | { ok: false; status: number; error: string }
  | { ok: true; already: boolean; released_at: string; facility_code: string; changed: StockChange[] }
> {
  const { data: reservation } = await client
    .from("inventory_stock_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (!reservation) return { ok: false, status: 404, error: "RESERVATION_NOT_FOUND" };
  if (reservation.status === "FULFILLED") return { ok: false, status: 409, error: "ALREADY_FULFILLED" };
  if (reservation.status === "RELEASED") {
    return {
      ok: true,
      already: true,
      released_at: reservation.released_at ?? new Date().toISOString(),
      facility_code: reservation.facility_code,
      changed: []
    };
  }

  const { data: items } = await client
    .from("inventory_stock_reservation_items")
    .select("*")
    .eq("reservation_id", reservationId);

  const changed: StockChange[] = [];
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

    changed.push({
      sku_code: item.sku_code,
      previous_stock: prevAvailable,
      current_stock: Math.max(0, Number(stock.on_hand_qty) - newReserved)
    });
  }

  await client
    .from("inventory_stock_reservations")
    .update({ status: "RELEASED", released_at, release_reason: reason })
    .eq("id", reservationId);

  return { ok: true, already: false, released_at, facility_code: reservation.facility_code, changed };
}

export type StockDeducted = { sku_code: string; deducted: number; remaining: number };

/** Convert a reservation into a permanent deduction. Idempotent for already-fulfilled. */
export async function fulfillReservation(
  client: SupabaseAdmin,
  reservationId: string,
  dispatchedAt: string
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      already: boolean;
      fulfilled_at: string;
      facility_code: string;
      stock_deducted: StockDeducted[];
      changed: StockChange[];
    }
> {
  const { data: reservation } = await client
    .from("inventory_stock_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (!reservation) return { ok: false, status: 404, error: "RESERVATION_NOT_FOUND" };
  if (reservation.status === "RELEASED") return { ok: false, status: 409, error: "RESERVATION_RELEASED" };
  if (reservation.status === "FULFILLED") {
    return {
      ok: true,
      already: true,
      fulfilled_at: reservation.fulfilled_at,
      facility_code: reservation.facility_code,
      stock_deducted: [],
      changed: []
    };
  }

  const { data: items } = await client
    .from("inventory_stock_reservation_items")
    .select("*")
    .eq("reservation_id", reservationId);

  const stock_deducted: StockDeducted[] = [];
  const changed: StockChange[] = [];

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
      .update({ on_hand_qty: newOnHand, reserved_qty: newReserved, updated_at: dispatchedAt })
      .eq("id", stock.id);

    await client.from("inventory_stock_movements").insert({
      sku_id: item.sku_id,
      movement_type: "OUT",
      qty: -qty,
      reason: "Order fulfillment",
      reference: reservation.order_code
    });

    await client.from("inventory_skus").update({ stock_qty: newOnHand }).eq("id", item.sku_id);

    const remaining = Math.max(0, newOnHand - newReserved);
    stock_deducted.push({ sku_code: item.sku_code, deducted: qty, remaining });
    changed.push({ sku_code: item.sku_code, previous_stock: prevAvailable, current_stock: remaining });
  }

  await client
    .from("inventory_stock_reservations")
    .update({ status: "FULFILLED", fulfilled_at: dispatchedAt })
    .eq("id", reservationId);

  return {
    ok: true,
    already: false,
    fulfilled_at: dispatchedAt,
    facility_code: reservation.facility_code,
    stock_deducted,
    changed
  };
}

// ---------------------------------------------------------------------------
// Webhooks

export async function fireStockWebhooks(
  client: SupabaseAdmin,
  opts: {
    facility_code: string;
    trigger: "RESERVATION" | "RELEASE" | "FULFILLMENT" | "ADJUST";
    changed: StockChange[];
    lowStock?: { sku_code: string; available: number; threshold: number }[];
  }
) {
  const occurred = new Date().toISOString();

  if (opts.changed.length) {
    await client.rpc("enqueue_dashboard_webhook", {
      p_event_type: "stock.level_changed",
      p_payload: {
        event: "stock.level_changed",
        event_id: newId("evt_"),
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
        event_id: newId("evt_"),
        occurred_at: occurred,
        facility_code: opts.facility_code,
        low_stock_items: opts.lowStock
      }
    });
  }

  await deliverPendingWebhooks(client);
}

const WEBHOOK_PATHS: Record<string, string> = {
  "stock.level_changed": "/webhooks/stock/level_changed",
  "stock.low_threshold": "/webhooks/stock/low_threshold",
  "order.status_changed": "/webhooks/orders/status_changed"
};

export async function deliverPendingWebhooks(client: SupabaseAdmin) {
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
    const path = WEBHOOK_PATHS[row.event_type] ?? "/webhooks/stock/level_changed";
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

export async function hmacSha256Hex(secret: string, message: string) {
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
