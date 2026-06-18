import { supabase } from "./supabaseClient";
import { materialLabel, materialUnit } from "./printingDeptInventoryUtils";

export async function fetchAdminRecipientIds() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id).filter(Boolean);
}

/**
 * Notify admins when stock crosses below threshold (not on every movement while already low).
 */
export async function maybeNotifyPrintingInventoryLowStock({
  materialKey,
  previousStock,
  newStock,
  threshold,
  triggeredByUserId
}) {
  const limit = Number(threshold);
  const before = Number(previousStock);
  const after = Number(newStock);
  if (!materialKey || !triggeredByUserId || !Number.isFinite(limit) || limit <= 0) {
    return { ok: true, skipped: true };
  }
  if (after >= limit) return { ok: true, skipped: true };
  if (before < limit && after < limit) return { ok: true, skipped: true };

  const adminIds = await fetchAdminRecipientIds();
  const recipients = adminIds.filter((id) => id !== triggeredByUserId);
  if (!recipients.length) return { ok: true, skipped: true };

  const label = materialLabel(materialKey);
  const unit = materialUnit(materialKey);
  const rows = recipients.map((recipientId) => ({
    recipient_user_id: recipientId,
    material_key: materialKey,
    material_label: label,
    current_stock: after,
    threshold_qty: limit,
    triggered_by_user_id: triggeredByUserId
  }));

  const { error } = await supabase.from("printing_dept_inventory_notifications").insert(rows);
  if (error) {
    if (error.message?.includes("Could not find the table")) {
      console.warn("printing_dept_inventory_notifications table missing — run latest migration");
      return { ok: false, skipped: true, error };
    }
    console.error("Printing inventory notification:", error.message);
    return { ok: false, error };
  }

  return { ok: true, count: rows.length, materialLabel: label, unit, currentStock: after, threshold: limit };
}
