// Authenticated dashboard users: generate a warehouse picklist for a Scott RMP order.
// First generation moves PENDING → PROCESSING and stores picklist_no.
// Re-print returns the same picklist when already PROCESSING.
// Deploy: supabase functions deploy scott-order-generate-picklist

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { deliverPendingWebhooks } from "../dashboard-stock-api/stockCore.ts";
import { corsHeaders, createServiceClient, jsonResponse } from "../_shared/passwordReset.ts";

const TERMINAL = new Set(["COMPLETE", "CANCELLED", "FAILED"]);

function formatPicklistNo(n: number) {
  return `PK${String(n).padStart(5, "0")}`;
}

async function nextPicklistNo(client: ReturnType<typeof createServiceClient>) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = formatPicklistNo(Math.floor(10000 + Math.random() * 90000));
    const { data } = await client
      .from("scott_orders")
      .select("id")
      .eq("picklist_no", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return formatPicklistNo(Math.floor(Date.now() % 100000));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!jwt) {
      return jsonResponse({ error: "Unauthorized: sign in and try again." }, 401);
    }

    const client = createServiceClient();
    const {
      data: { user },
      error: userErr
    } = await client.auth.getUser(jwt);
    if (userErr || !user) {
      return jsonResponse({ error: `Unauthorized: ${userErr?.message ?? "Invalid session"}` }, 401);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) {
      return jsonResponse({ error: "order_id is required." }, 400);
    }

    const { data: order, error: orderErr } = await client
      .from("scott_orders")
      .select(
        "id, order_code, facility_code, status, customer, picklist_no, picklist_generated_at, created_at, updated_at"
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) throw orderErr;
    if (!order) {
      return jsonResponse({ error: "Order not found." }, 404);
    }
    if (TERMINAL.has(order.status)) {
      return jsonResponse({ error: `Cannot generate picklist for ${order.status} order.` }, 409);
    }

    const { data: items, error: itemsErr } = await client
      .from("scott_order_items")
      .select("item_code, sku_code, quantity, unit_price")
      .eq("order_id", orderId)
      .order("sku_code");
    if (itemsErr) throw itemsErr;
    if (!items?.length) {
      return jsonResponse({ error: "Order has no line items." }, 400);
    }

    const skuCodes = [...new Set(items.map((i) => i.sku_code))];
    const { data: skuRows } = await client
      .from("inventory_skus")
      .select("sku_code, name, bin_location")
      .in("sku_code", skuCodes);
    const skuByCode = new Map((skuRows ?? []).map((s) => [s.sku_code, s]));

    const now = new Date().toISOString();
    let picklistNo = order.picklist_no as string | null;
    let picklistGeneratedAt = order.picklist_generated_at as string | null;
    let status = order.status as string;
    let statusChanged = false;

    if (!picklistNo) {
      picklistNo = await nextPicklistNo(client);
      picklistGeneratedAt = now;
      const patch: Record<string, unknown> = {
        picklist_no: picklistNo,
        picklist_generated_at: picklistGeneratedAt,
        updated_at: now
      };
      if (status === "PENDING") {
        patch.status = "PROCESSING";
        status = "PROCESSING";
        statusChanged = true;
      }
      const { error: updErr } = await client.from("scott_orders").update(patch).eq("id", orderId);
      if (updErr) throw updErr;
      if (statusChanged) {
        await deliverPendingWebhooks(client);
      }
    }

    const picklistItems = items.map((item, idx) => {
      const sku = skuByCode.get(item.sku_code);
      const bin = String(sku?.bin_location ?? "").trim();
      return {
        line_no: idx + 1,
        sku_code: item.sku_code,
        sku_name: sku?.name || item.sku_code,
        shelf_code: bin || "—",
        comment: null,
        pick_update: "",
        quantity: Number(item.quantity)
      };
    });

    return jsonResponse({
      ok: true,
      order_id: order.id,
      order_code: order.order_code,
      facility_code: order.facility_code,
      status,
      status_changed: statusChanged,
      customer_name: (order.customer as Record<string, unknown>)?.name ?? "",
      picklist_no: picklistNo,
      picklist_generated_at: picklistGeneratedAt,
      total_items: picklistItems.length,
      items: picklistItems
    });
  } catch (e) {
    return jsonResponse({ error: String(e?.message ?? e) }, 500);
  }
});
