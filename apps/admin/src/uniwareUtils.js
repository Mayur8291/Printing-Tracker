import { messageFromFunctionInvoke } from "./edgeFunctionUtils";
import { supabase } from "./supabaseClient";

export async function fetchUniSettings() {
  const { data, error } = await supabase.from("uni_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveUniSettings(patch) {
  const { error } = await supabase.from("uni_settings").update(patch).eq("id", 1);
  if (error) throw error;
}

export async function fetchUniInventoryMirror() {
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("uni_inventory_mirror")
      .select("*")
      .order("sku_code", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

export async function fetchUniDrrBySku(fromDate, days, facility) {
  const { data, error } = await supabase.rpc("uni_drr_by_sku", {
    p_from: fromDate,
    p_days: Math.max(Number(days) || 1, 1),
    p_facility: facility && facility !== "all" ? facility : null
  });
  if (error) throw error;
  const map = {};
  for (const row of data ?? []) {
    const sku = String(row.sku_code || "").trim().toLowerCase();
    if (!sku) continue;
    map[sku] = { drr: Number(row.drr) || 0, sold: Number(row.sold_qty) || 0 };
  }
  return map;
}

export async function fetchUniSaleCoverage(fromDate) {
  const [{ count: missing, error: missingErr }, { count: total, error: totalErr }] = await Promise.all([
    supabase
      .from("uni_sale_order")
      .select("uni_code", { count: "exact", head: true })
      .gte("order_date", fromDate)
      .is("lines_checked_at", null),
    supabase
      .from("uni_sale_order")
      .select("uni_code", { count: "exact", head: true })
      .gte("order_date", fromDate)
  ]);
  if (missingErr) throw missingErr;
  if (totalErr) throw totalErr;
  return { missing: missing ?? 0, total: total ?? 0 };
}

export async function fetchUniSaleOrders() {
  const { data, error } = await supabase
    .from("uni_sale_order")
    .select("uni_code, channel, status, facility_code, customer_name, display_order_code, order_date, synced_at")
    .order("order_date", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchUniFeedHealth() {
  const { data, error } = await supabase.from("uni_feed_health_view").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function fetchUniTransfers() {
  const { data, error } = await supabase
    .from("uni_transfer")
    .select(
      "id, transfer_no, direction, qty, status, uniware_ref, error_text, note, created_at, " +
        "cat_sku ( sku_code ), from_loc:core_location!uni_transfer_from_location_id_fkey ( code, name ), " +
        "to_loc:core_location!uni_transfer_to_location_id_fkey ( code, name )"
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function createDraftUniTransfer({ direction, skuId, qty, fromLocationId, toLocationId, note }) {
  const { data, error } = await supabase
    .from("uni_transfer")
    .insert({
      direction,
      sku_id: skuId,
      qty,
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      note: note || null
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function postUniTransfer(transferId) {
  const { data, error } = await supabase.rpc("uni_post_transfer", { p_transfer_id: transferId });
  if (error) throw error;
  return data;
}

export async function invokeUniwareBridge(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("uniware-bridge", {
    body: { action, ...extra }
  });
  if (error) {
    if (typeof data?.error === "string" && data.error) throw new Error(data.error);
    const parsed = await messageFromFunctionInvoke(error);
    throw new Error(parsed);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
