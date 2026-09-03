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
  const { data, error } = await supabase
    .from("uni_inventory_mirror")
    .select("*")
    .order("synced_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function fetchUniSaleOrders() {
  const { data, error } = await supabase
    .from("uni_sale_order")
    .select("uni_code, channel, status, facility_code, customer_name, display_order_code, order_date, synced_at")
    .order("synced_at", { ascending: false })
    .limit(300);
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
    const detail = data?.error || error.message || "Uniware bridge failed";
    throw new Error(typeof detail === "string" ? detail : error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
