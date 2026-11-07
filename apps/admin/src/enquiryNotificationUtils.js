import { supabase } from "./supabaseClient";

/**
 * Fan-out Support inbox rows to assignee + platform/Support admins (skips the actor).
 * RPC `notify_enquiry_watchers` (migration 20261005074841 / 20261005 enquiry update).
 * Never throws — enquiry save must not fail because the inbox write failed.
 */
export async function notifyEnquiryWatchers({ enquiryId, kind, summary }) {
  if (!enquiryId) return { ok: true, skipped: true };
  const { data, error } = await supabase.rpc("notify_enquiry_watchers", {
    p_enquiry_id: enquiryId,
    p_kind: String(kind ?? "status"),
    p_summary: String(summary ?? "").trim() || null
  });
  if (error) {
    if (String(error.message ?? "").includes("Could not find the function")) {
      console.warn("notify_enquiry_watchers missing — apply 20261005 enquiry update notifications migration");
      return { ok: false, skipped: true, error };
    }
    console.error("Enquiry watchers notification:", error.message);
    return { ok: false, error };
  }
  return { ok: true, count: Number(data) || 0 };
}

/** @deprecated Use notifyEnquiryWatchers({ kind: "assigned" }). Kept for old call sites. */
export async function insertEnquiryAssignmentNotification({
  enquiryId,
  enquiryCode,
  customerName,
  assigneeId,
  assignedByUserId
}) {
  if (!enquiryId || !assigneeId || !assignedByUserId || assigneeId === assignedByUserId) {
    return { ok: true, skipped: true };
  }
  return notifyEnquiryWatchers({
    enquiryId,
    kind: "assigned",
    summary: `${enquiryCode || "Enquiry"} · ${customerName || "Customer"} assigned`
  });
}
