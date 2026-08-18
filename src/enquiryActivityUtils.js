import { supabase } from "./supabaseClient";

export const ENQUIRY_ACTIVITY_LABEL = {
  created: "Logged enquiry",
  assigned: "Assigned",
  verified: "Marked verified",
  contacted: "Marked contacted",
  closed: "Closed",
  status: "Updated status",
  details: "Updated details",
  feedback: "Logged customer feedback"
};

export async function logEnquiryActivity({ enquiryId, actorId, action, detail }) {
  if (!enquiryId || !actorId || !action) return { ok: false, skipped: true };
  const { error } = await supabase.from("enquiry_activity_log").insert({
    enquiry_id: enquiryId,
    actor_id: actorId,
    action: String(action),
    detail: String(detail ?? "").trim() || null
  });
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) {
      console.warn("enquiry_activity_log missing — apply 20260818100000_enquiry_admin_assign_activity.sql");
      return { ok: false, skipped: true, error };
    }
    console.warn("enquiry activity log:", error.message);
    return { ok: false, error };
  }
  return { ok: true };
}

export async function fetchEnquiryActivity(enquiryId) {
  if (!enquiryId) return [];
  const { data, error } = await supabase
    .from("enquiry_activity_log")
    .select("id, enquiry_id, actor_id, action, detail, created_at")
    .eq("enquiry_id", enquiryId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) return [];
    throw error;
  }
  return data ?? [];
}
