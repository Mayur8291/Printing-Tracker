import { supabase } from "./supabaseClient";

export const ENQUIRY_ACTIVITY_LABEL = {
  created: "Logged enquiry",
  assigned: "Assigned",
  opened: "Opened enquiry",
  verified: "Marked verified",
  contacted: "Marked contacted",
  reached_out: "Reached out to customer",
  contact: "Contact history",
  closed: "Closed",
  status: "Updated status",
  details: "Updated details",
  feedback: "Logged customer feedback"
};

function looksLikeEnquiryCode(value) {
  return /^ENQ-|^CS-/i.test(String(value ?? "").trim());
}

/** Plain-language line for the Activity sheet: what happened, who, extra detail. */
export function describeEnquiryActivity(row, actorName = "Someone") {
  const detail = String(row?.detail ?? "").trim();
  const who = String(actorName || "Someone").trim() || "Someone";
  const extra = detail && !looksLikeEnquiryCode(detail) ? detail : "";
  switch (row?.action) {
    case "created":
      return { title: "Enquiry created", body: `${who} logged this case.` };
    case "assigned":
      return {
        title: "Assigned",
        body: extra && extra !== "Assigned on create" ? `${who} assigned this case — ${extra}.` : `${who} assigned this case.`
      };
    case "opened":
      return { title: "Opened", body: `${who} opened this case.` };
    case "verified":
      return { title: "Customer verified", body: `${who} marked the customer as verified.` };
    case "contacted":
      return { title: "Marked contacted", body: `${who} marked this case as contacted.` };
    case "reached_out":
      return { title: "Reached out", body: extra ? `${who}: ${extra}` : `${who} reached out to the customer.` };
    case "contact":
      return { title: "Contact note", body: extra ? `${who}: ${extra}` : `${who} added a contact event.` };
    case "closed":
      return { title: "Closed", body: `${who} closed this case.` };
    case "status":
      return {
        title: "Status changed",
        body: extra ? `${who} set status to ${extra.replace(/_/g, " ")}.` : `${who} changed the status.`
      };
    case "details":
      return { title: "Details updated", body: extra ? `${who} updated ${extra}.` : `${who} updated notes, priority, or tag.` };
    case "feedback":
      return { title: "Feedback logged", body: extra ? `${who}: ${extra}` : `${who} logged customer feedback.` };
    default:
      return {
        title: ENQUIRY_ACTIVITY_LABEL[row?.action] ?? String(row?.action ?? "Update"),
        body: extra ? `${who} — ${extra}` : who
      };
  }
}

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
