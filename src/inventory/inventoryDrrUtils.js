import { supabase } from "../supabaseClient";

/** Daily run rate = total ordered qty in lookback window ÷ days. */
export const INVENTORY_DRR_LOOKBACK_DAYS = 30;

const ACTIVE_ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETE"];

/**
 * Compute DRR per SKU from Scott RMP order line items (scott_order_items).
 * @param {{ lookbackDays?: number }} [opts]
 * @returns {Promise<Record<string, number>>} lowercase sku_code → drr
 */
export async function fetchComputedDrrBySkuCode({ lookbackDays = INVENTORY_DRR_LOOKBACK_DAYS } = {}) {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceIso = since.toISOString();

  const { data: orders, error: orderErr } = await supabase
    .from("scott_orders")
    .select("id")
    .gte("created_at", sinceIso)
    .in("status", ACTIVE_ORDER_STATUSES);
  if (orderErr) throw orderErr;

  const orderIds = (orders ?? []).map((o) => o.id);
  if (!orderIds.length) return {};

  const totals = {};
  const chunkSize = 200;
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize);
    const { data: items, error: itemErr } = await supabase
      .from("scott_order_items")
      .select("sku_code, quantity")
      .in("order_id", chunk);
    if (itemErr) throw itemErr;

    for (const item of items ?? []) {
      const code = String(item.sku_code ?? "").trim().toLowerCase();
      if (!code) continue;
      totals[code] = (totals[code] ?? 0) + (Number(item.quantity) || 0);
    }
  }

  const drrMap = {};
  for (const [code, totalQty] of Object.entries(totals)) {
    drrMap[code] = Math.round((totalQty / lookbackDays) * 100) / 100;
  }
  return drrMap;
}

/** @param {Array<{ id: string, drr?: number }>} skus */
export function applyComputedDrrToSkus(skus, drrMap) {
  return skus.map((sku) => ({
    ...sku,
    drr: drrMap[String(sku.id).trim().toLowerCase()] ?? 0
  }));
}

export function formatDrr(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
