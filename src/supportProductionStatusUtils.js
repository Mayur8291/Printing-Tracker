import { supabase } from "./supabaseClient";

export async function fetchProductionStatusAlerts() {
  const { data, error } = await supabase
    .from("support_production_status_alerts")
    .select(
      "id, order_id, customer_name, phone, old_status, new_status, skipped_reason, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) return [];
    throw error;
  }
  return data ?? [];
}
