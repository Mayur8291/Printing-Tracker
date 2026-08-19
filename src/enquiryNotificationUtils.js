import { supabase } from "./supabaseClient";

/** Notify assignee when an enquiry is assigned (skip self-assign). */
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

  const { error } = await supabase.from("enquiry_assignment_notifications").insert({
    recipient_user_id: assigneeId,
    enquiry_id: enquiryId,
    enquiry_code: String(enquiryCode ?? "").trim() || "Enquiry",
    customer_name: String(customerName ?? "").trim() || "Customer",
    assigned_by_user_id: assignedByUserId
  });

  if (error) {
    if (error.message?.includes("Could not find the table")) {
      console.warn(
        "enquiry_assignment_notifications table missing — run migration 20260817130922_add_enquiries_dashboard.sql"
      );
      return { ok: false, skipped: true, error };
    }
    console.error("Enquiry assignment notification:", error.message);
    return { ok: false, error };
  }

  return { ok: true };
}
