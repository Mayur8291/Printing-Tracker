import { findProfileIdByCoordinatorName } from "./coordinatorSelectUtils";

/**
 * Notify assignee when an order is assigned to them (cross-user; uses DB + realtime).
 * Skips when assignee is the same user as assigner or name cannot be resolved.
 */
export async function insertOrderAssignmentNotification(
  supabase,
  {
    coordinatorName,
    orderId,
    orderDisplayId,
    assignedByUserId,
    profileLookup = []
  }
) {
  const name = String(coordinatorName ?? "").trim();
  const assignerId = assignedByUserId;
  if (!name || !assignerId || !orderId) return { ok: true, skipped: true };

  const recipientId = findProfileIdByCoordinatorName(name, profileLookup);
  if (!recipientId || recipientId === assignerId) return { ok: true, skipped: true };

  const { error } = await supabase.from("order_assignment_notifications").insert({
    recipient_user_id: recipientId,
    order_id: orderId,
    order_display_id: orderDisplayId ? String(orderDisplayId).trim() || null : null,
    coordinator_name: name,
    assigned_by_user_id: assignerId
  });

  if (error) {
    if (error.message?.includes("Could not find the table")) {
      console.warn(
        "order_assignment_notifications table missing — run supabase migration 20260612120000_add_order_assignment_notifications.sql"
      );
      return { ok: false, skipped: true, error };
    }
    console.error("Assignment notification:", error.message);
    return { ok: false, error };
  }

  return { ok: true };
}
