import { supabase } from "./supabaseClient";

/**
 * Step 1 stock ledger (One Source of Truth) — read helpers + RPC wrappers.
 * All stock mutations go through DB functions (inv_post_movement etc.);
 * this module never writes inv_movement/inv_balance directly.
 */

export const STOCK_STATES = ["good", "qc_hold", "damaged"];

export const STOCK_STATE_LABEL = {
  good: "Good",
  qc_hold: "QC hold",
  damaged: "Damaged"
};

/** Movement presets the UI offers; each maps to reason + which locations apply. */
export const MOVEMENT_TYPES = [
  { id: "receive", label: "Receive (GRN)", reason: "grn", needsFrom: false, needsTo: true },
  { id: "transfer", label: "Transfer", reason: "transfer", needsFrom: true, needsTo: true },
  { id: "issue", label: "Issue / dispatch", reason: "dispatch", needsFrom: true, needsTo: false },
  { id: "return_in", label: "Return in", reason: "return_in", needsFrom: false, needsTo: true },
  {
    id: "adjust_in",
    label: "Adjustment + (needs note)",
    reason: "adjustment",
    needsFrom: false,
    needsTo: true
  },
  {
    id: "adjust_out",
    label: "Adjustment − (needs note)",
    reason: "adjustment",
    needsFrom: true,
    needsTo: false
  }
];

export const MOVEMENT_REASON_LABEL = {
  grn: "GRN",
  qc_pass: "QC pass",
  qc_fail: "QC fail",
  putaway: "Putaway",
  transfer: "Transfer",
  pick: "Pick",
  dispatch: "Dispatch",
  return_in: "Return in",
  adjustment: "Adjustment",
  kit_build: "Kit build",
  kit_break: "Kit break",
  consumption: "Consumption",
  production_out: "Production out",
  cycle_count: "Cycle count"
};

export async function fetchStockBalances() {
  const { data, error } = await supabase
    .from("inv_balance")
    .select("sku_id, location_id, state, qty, updated_at, cat_sku ( sku_code ), core_location ( code, name )")
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchStockMovements() {
  const { data, error } = await supabase
    .from("inv_movement")
    .select(
      "id, qty, state, reason, ref_type, ref_id, lot, note, created_at, cat_sku ( sku_code ), from_location:core_location!inv_movement_from_location_id_fkey ( code ), to_location:core_location!inv_movement_to_location_id_fkey ( code )"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchActiveReservations() {
  const { data, error } = await supabase
    .from("inv_reservation")
    .select("sku_id, location_id, qty")
    .eq("status", "active")
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchDriftAlerts() {
  const { data, error } = await supabase
    .from("inv_drift_alert")
    .select("id, sku_id, location_id, state, ledger_qty, balance_qty, detected_at")
    .is("resolved_at", null)
    .order("detected_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

/** Post one movement through the locked DB function. Returns the movement id. */
export async function postStockMovement({
  skuId,
  fromLocationId,
  toLocationId,
  qty,
  state,
  reason,
  refType,
  refId,
  lot,
  note
}) {
  const { data, error } = await supabase.rpc("inv_post_movement", {
    p_sku_id: skuId,
    p_from_location_id: fromLocationId || null,
    p_to_location_id: toLocationId || null,
    p_qty: qty,
    p_state: state || "good",
    p_reason: reason,
    p_ref_type: refType || null,
    p_ref_id: refId || null,
    p_lot: lot || null,
    p_note: note || null
  });
  if (error) throw error;
  return data;
}

/** reserved lookup key */
export function balanceKey(skuId, locationId) {
  return `${skuId}::${locationId}`;
}
