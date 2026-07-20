// Order lifecycle routes (order-api-requirements.html).
// Orders live in scott_orders / scott_order_items; stock is held through the
// same reservation primitives as the stock routes. The order.status_changed
// webhook is enqueued by a DB trigger on scott_orders and drained here.

import {
  deliverPendingWebhooks,
  errorResponse,
  fireStockWebhooks,
  fulfillReservation,
  jsonResponse,
  newId,
  parseItems,
  releaseReservation,
  reserveStock,
  type StockChange,
  type SupabaseAdmin
} from "./stockCore.ts";

const TERMINAL = new Set(["COMPLETE", "CANCELLED", "FAILED"]);

async function getOrder(client: SupabaseAdmin, orderId: string) {
  const { data } = await client.from("scott_orders").select("*").eq("id", orderId).maybeSingle();
  return data;
}

async function getOrderItems(client: SupabaseAdmin, orderId: string) {
  const { data } = await client
    .from("scott_order_items")
    .select("item_code, sku_code, quantity, unit_price, dispatched_quantity")
    .eq("order_id", orderId);
  return data ?? [];
}

export async function handleCreateOrder(req: Request, client: SupabaseAdmin) {
  const body = await req.json();
  const order_code = String(body.order_code ?? "").trim();
  const facility_code = String(body.facility_code ?? "").trim();
  const items = parseItems(body.items);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!order_code || !facility_code || !items.length) {
    return errorResponse(400, "INVALID_REQUEST", {
      message: "order_code, facility_code and at least one item with sku_code/quantity are required."
    });
  }

  const { data: existing } = await client
    .from("scott_orders")
    .select("id, status")
    .eq("order_code", order_code)
    .in("status", ["PENDING", "PROCESSING", "COMPLETE"])
    .maybeSingle();
  if (existing) {
    return errorResponse(409, "ORDER_EXISTS", {
      dashboard_order_id: existing.id,
      status: existing.status
    });
  }

  const reserved = await reserveStock(client, { order_code, facility_code, items });
  if (!reserved.ok) {
    return errorResponse(409, "INSUFFICIENT_STOCK", reserved.insufficient);
  }

  const id = newId("ord_");
  const created_at = new Date().toISOString();

  const { error: orderErr } = await client.from("scott_orders").insert({
    id,
    order_code,
    facility_code,
    status: "PENDING",
    due_on: body.due_on ?? null,
    customer: body.customer ?? {},
    shipping_address: body.shipping_address ?? {},
    payment: body.payment ?? {},
    comment: String(body.comment ?? ""),
    reservation_id: reserved.reservation_id,
    created_at,
    updated_at: created_at
  });
  if (orderErr) {
    // Roll the hold back so a failed insert doesn't strand reserved stock.
    await releaseReservation(client, reserved.reservation_id, "ORDER_CREATE_FAILED");
    throw orderErr;
  }

  await client.from("scott_order_items").insert(
    items.map((i) => {
      const raw = rawItems.find((r: Record<string, unknown>) => String(r?.sku_code ?? "").trim() === i.sku_code);
      return {
        order_id: id,
        item_code: i.item_code,
        sku_code: i.sku_code,
        quantity: i.quantity,
        unit_price: Number(raw?.unit_price) || 0
      };
    })
  );

  await fireStockWebhooks(client, {
    facility_code,
    trigger: "RESERVATION",
    changed: reserved.changed
  });

  return jsonResponse({ dashboard_order_id: id, order_code, status: "PENDING", created_at }, 201);
}

export async function handleGetOrder(orderId: string, client: SupabaseAdmin) {
  const order = await getOrder(client, orderId);
  if (!order) return errorResponse(404, "ORDER_NOT_FOUND");

  const items = await getOrderItems(client, orderId);
  return jsonResponse({
    dashboard_order_id: order.id,
    order_code: order.order_code,
    status: order.status,
    updated_at: order.updated_at,
    items: items.map((i) => ({
      sku_code: i.sku_code,
      quantity: Number(i.quantity),
      dispatched_quantity: Number(i.dispatched_quantity)
    }))
  });
}

export async function handleUpdateOrder(orderId: string, req: Request, client: SupabaseAdmin) {
  const order = await getOrder(client, orderId);
  if (!order) return errorResponse(404, "ORDER_NOT_FOUND");
  if (TERMINAL.has(order.status)) {
    return errorResponse(409, "ORDER_NOT_EDITABLE", { status: order.status });
  }

  const body = await req.json();
  const newItems = body.items != null ? parseItems(body.items) : null;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const updated_at = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at };

  if (body.due_on !== undefined) patch.due_on = body.due_on;
  if (body.shipping_address !== undefined) patch.shipping_address = body.shipping_address ?? {};
  if (body.customer !== undefined) patch.customer = body.customer ?? {};
  if (body.comment !== undefined) patch.comment = String(body.comment ?? "");

  const changed: StockChange[] = [];

  if (newItems) {
    if (!newItems.length) {
      return errorResponse(400, "INVALID_REQUEST", { message: "items must contain at least one entry." });
    }

    // Feasibility first: new quantities may consume the stock this order
    // already holds, so credit the old reservation back before comparing.
    const oldHeld = new Map<string, number>();
    if (order.reservation_id) {
      const { data: oldResItems } = await client
        .from("inventory_stock_reservation_items")
        .select("sku_code, quantity")
        .eq("reservation_id", order.reservation_id);
      const { data: oldRes } = await client
        .from("inventory_stock_reservations")
        .select("status")
        .eq("id", order.reservation_id)
        .maybeSingle();
      if (oldRes?.status === "RESERVED") {
        for (const r of oldResItems ?? []) {
          oldHeld.set(r.sku_code, (oldHeld.get(r.sku_code) ?? 0) + Number(r.quantity));
        }
      }
    }

    const { data: skuRows } = await client
      .from("inventory_skus")
      .select("id, sku_code")
      .in("sku_code", newItems.map((i) => i.sku_code));
    const skuIds = new Map((skuRows ?? []).map((r) => [r.sku_code, r.id]));

    const insufficient: { sku_code: string; requested: number; available: number }[] = [];
    for (const item of newItems) {
      const skuId = skuIds.get(item.sku_code);
      if (!skuId) {
        insufficient.push({ sku_code: item.sku_code, requested: item.quantity, available: 0 });
        continue;
      }
      const { data: stock } = await client
        .from("inventory_facility_stock")
        .select("on_hand_qty, reserved_qty")
        .eq("sku_id", skuId)
        .eq("facility_code", order.facility_code)
        .maybeSingle();
      const available = stock
        ? Math.max(0, Number(stock.on_hand_qty) - Number(stock.reserved_qty))
        : 0;
      const effective = available + (oldHeld.get(item.sku_code) ?? 0);
      if (item.quantity > effective) {
        insufficient.push({ sku_code: item.sku_code, requested: item.quantity, available: effective });
      }
    }
    if (insufficient.length) {
      return errorResponse(409, "INSUFFICIENT_STOCK", insufficient);
    }

    if (order.reservation_id) {
      const released = await releaseReservation(client, order.reservation_id, "ORDER_EDIT");
      if (released.ok) changed.push(...released.changed);
    }

    const reserved = await reserveStock(client, {
      order_code: order.order_code,
      facility_code: order.facility_code,
      items: newItems
    });
    if (!reserved.ok) {
      // Feasibility passed above; only a concurrent mutation can land here.
      return errorResponse(409, "INSUFFICIENT_STOCK", reserved.insufficient);
    }
    changed.push(...reserved.changed);
    patch.reservation_id = reserved.reservation_id;

    await client.from("scott_order_items").delete().eq("order_id", orderId);
    await client.from("scott_order_items").insert(
      newItems.map((i) => {
        const raw = rawItems.find((r: Record<string, unknown>) => String(r?.sku_code ?? "").trim() === i.sku_code);
        return {
          order_id: orderId,
          item_code: i.item_code,
          sku_code: i.sku_code,
          quantity: i.quantity,
          unit_price: Number(raw?.unit_price) || 0
        };
      })
    );
  }

  const { error } = await client.from("scott_orders").update(patch).eq("id", orderId);
  if (error) throw error;

  if (changed.length) {
    await fireStockWebhooks(client, {
      facility_code: order.facility_code,
      trigger: "RESERVATION",
      changed
    });
  }

  return jsonResponse({
    dashboard_order_id: orderId,
    order_code: order.order_code,
    status: order.status,
    updated_at
  });
}

export async function handleCancelOrder(orderId: string, req: Request, client: SupabaseAdmin) {
  const order = await getOrder(client, orderId);
  if (!order) return errorResponse(404, "ORDER_NOT_FOUND");

  if (order.status === "CANCELLED") {
    return jsonResponse({
      dashboard_order_id: orderId,
      order_code: order.order_code,
      status: "CANCELLED",
      cancelled_at: order.cancelled_at ?? order.updated_at
    });
  }
  if (order.status === "COMPLETE" || order.status === "FAILED") {
    return errorResponse(409, "ORDER_NOT_EDITABLE", { status: order.status });
  }

  const url = new URL(req.url);
  const reason = url.searchParams.get("reason")?.trim() || "CUSTOMER_CANCELLED";
  const cancelled_at = new Date().toISOString();

  let changed: StockChange[] = [];
  if (order.reservation_id) {
    const released = await releaseReservation(client, order.reservation_id, reason);
    if (released.ok) changed = released.changed;
  }

  const { error } = await client
    .from("scott_orders")
    .update({ status: "CANCELLED", cancelled_at, cancel_reason: reason, updated_at: cancelled_at })
    .eq("id", orderId);
  if (error) throw error;

  if (changed.length) {
    await fireStockWebhooks(client, {
      facility_code: order.facility_code,
      trigger: "RELEASE",
      changed
    });
  } else {
    await deliverPendingWebhooks(client);
  }

  return jsonResponse({
    dashboard_order_id: orderId,
    order_code: order.order_code,
    status: "CANCELLED",
    cancelled_at
  });
}

/**
 * Dashboard-internal transition endpoint (not in the Scott spec): moves an
 * order PENDING → PROCESSING → COMPLETE (fulfills the reservation) or → FAILED
 * (releases it). The scott_orders trigger fires order.status_changed for Scott.
 */
export async function handleSetOrderStatus(orderId: string, req: Request, client: SupabaseAdmin) {
  const order = await getOrder(client, orderId);
  if (!order) return errorResponse(404, "ORDER_NOT_FOUND");

  const body = await req.json().catch(() => ({}));
  const status = String(body?.status ?? "").trim().toUpperCase();

  if (!["PROCESSING", "COMPLETE", "FAILED"].includes(status)) {
    return errorResponse(400, "INVALID_STATUS", {
      message: "status must be PROCESSING, COMPLETE or FAILED. Use DELETE to cancel."
    });
  }
  if (order.status === status) {
    return jsonResponse({
      dashboard_order_id: orderId,
      order_code: order.order_code,
      status,
      updated_at: order.updated_at
    });
  }
  if (TERMINAL.has(order.status)) {
    return errorResponse(409, "ORDER_NOT_EDITABLE", { status: order.status });
  }
  if (status === "PROCESSING" && order.status !== "PENDING") {
    return errorResponse(409, "INVALID_TRANSITION", { from: order.status, to: status });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  let changed: StockChange[] = [];
  let trigger: "FULFILLMENT" | "RELEASE" | null = null;

  if (status === "COMPLETE") {
    const dispatched_at = String(body?.dispatched_at ?? "").trim() || now;
    if (order.reservation_id) {
      const fulfilled = await fulfillReservation(client, order.reservation_id, dispatched_at);
      if (!fulfilled.ok) {
        return errorResponse(fulfilled.status, fulfilled.error);
      }
      changed = fulfilled.changed;
      trigger = "FULFILLMENT";
    }
    patch.dispatched_at = dispatched_at;
  }

  if (status === "FAILED" && order.reservation_id) {
    const released = await releaseReservation(client, order.reservation_id, "ORDER_FAILED");
    if (released.ok) {
      changed = released.changed;
      trigger = "RELEASE";
    }
  }

  const { error } = await client.from("scott_orders").update(patch).eq("id", orderId);
  if (error) throw error;

  if (status === "COMPLETE") {
    // Full dispatch: everything on the order shipped.
    const items = await getOrderItems(client, orderId);
    for (const i of items) {
      await client
        .from("scott_order_items")
        .update({ dispatched_quantity: Number(i.quantity) })
        .eq("order_id", orderId)
        .eq("sku_code", i.sku_code);
    }
  }

  if (trigger && changed.length) {
    await fireStockWebhooks(client, { facility_code: order.facility_code, trigger, changed });
  } else {
    await deliverPendingWebhooks(client);
  }

  return jsonResponse({
    dashboard_order_id: orderId,
    order_code: order.order_code,
    status,
    updated_at: now,
    ...(status === "COMPLETE" ? { dispatched_at: patch.dispatched_at } : {})
  });
}
