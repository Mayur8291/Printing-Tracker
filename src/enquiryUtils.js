import { supabase } from "./supabaseClient";
import { insertEnquiryAssignmentNotification } from "./enquiryNotificationUtils";
import { logEnquiryActivity } from "./enquiryActivityUtils";
import { queueCloseSurveyIfNeeded } from "./enquiryCloseNotify";

export const ENQUIRY_STATUSES = ["new", "assigned", "in_progress", "resolved", "closed"];

export const ENQUIRY_STATUS_LABEL = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed"
};

export const ENQUIRY_PRIORITIES = ["low", "normal", "high", "urgent"];

export const ENQUIRY_PRIORITY_LABEL = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent"
};

export const ENQUIRY_SOURCES = [
  "WhatsApp",
  "Phone",
  "Email",
  "Walk-in",
  "Website",
  "Distributor",
  "Other"
];

export const EMPTY_ENQUIRY_FORM = {
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  product_details: "",
  source: "WhatsApp",
  priority: "normal",
  notes: "",
  order_id: "",
  order_type: "regular",
  help_topic: "regular"
};

const ENQUIRY_SELECT =
  "id, enquiry_code, customer_name, customer_phone, customer_email, product_details, source, notes, status, priority, assignee_id, assigned_by, assigned_at, created_by, created_at, updated_at, order_id, order_type, help_topic, ownership_verified, assigned_because_unknown, picked_at, sla_escalated_at, escalated_to_id, closed_at, feedback_rating, feedback_comment, feedback_at, feedback_requested_at, attachments";

export function profileDisplayName(profile) {
  if (!profile) return "—";
  const name = String(profile.full_name ?? "").trim();
  if (name) return name;
  const email = String(profile.email ?? "").trim();
  if (email) return email;
  return "User";
}

export function normalizeEnquiryStatus(status) {
  const s = String(status ?? "new").trim().toLowerCase();
  return ENQUIRY_STATUSES.includes(s) ? s : "new";
}

export function normalizeEnquiryPriority(priority) {
  const p = String(priority ?? "normal").trim().toLowerCase();
  return ENQUIRY_PRIORITIES.includes(p) ? p : "normal";
}

export async function fetchEnquiries() {
  const { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function createEnquiry({ createdBy, form }) {
  const payload = {
    customer_name: String(form.customer_name ?? "").trim(),
    customer_phone: String(form.customer_phone ?? "").trim() || null,
    customer_email: String(form.customer_email ?? "").trim() || null,
    product_details: String(form.product_details ?? "").trim() || null,
    source: String(form.source ?? "").trim() || null,
    priority: normalizeEnquiryPriority(form.priority),
    notes: String(form.notes ?? "").trim() || null,
    status: "new",
    created_by: createdBy,
    order_id: String(form.order_id ?? "").trim() || null,
    order_type: form.order_type === "customized" ? "customized" : "regular",
    help_topic: ["enquiry", "product_issue", "regular"].includes(form.help_topic)
      ? form.help_topic
      : "enquiry",
    ownership_verified: Boolean(form.ownership_verified),
    attachments: Array.isArray(form.attachments) ? form.attachments : []
  };
  if (!payload.customer_name) {
    throw new Error("Customer name is required.");
  }

  if (form.allowAssign === true && form.assignee_id) {
    payload.assignee_id = form.assignee_id;
    payload.assigned_by = createdBy;
    payload.assigned_at = new Date().toISOString();
    payload.status = "assigned";
    payload.assigned_because_unknown = Boolean(form.assigned_because_unknown);
  }

  const { data, error } = await supabase.from("enquiries").insert(payload).select(ENQUIRY_SELECT).single();
  if (error) throw error;
  await logEnquiryActivity({
    enquiryId: data.id,
    actorId: createdBy,
    action: "created",
    detail: data.enquiry_code
  });
  if (data.assignee_id) {
    await logEnquiryActivity({
      enquiryId: data.id,
      actorId: createdBy,
      action: "assigned",
      detail: "Assigned on create"
    });
  }
  return data;
}

export async function updateEnquiryFields(enquiryId, patch) {
  const { data, error } = await supabase
    .from("enquiries")
    .update(patch)
    .eq("id", enquiryId)
    .select(ENQUIRY_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function assignEnquiry({
  enquiry,
  assigneeId,
  assignedByUserId,
  assignedBecauseUnknown = false,
  isAdmin = false
}) {
  if (!isAdmin) throw new Error("Only an admin can assign enquiries.");
  if (!enquiry?.id) throw new Error("Enquiry not found.");
  if (!assigneeId) throw new Error("Pick someone to assign.");

  const patch = {
    assignee_id: assigneeId,
    assigned_by: assignedByUserId,
    assigned_at: new Date().toISOString(),
    status: enquiry.status === "new" ? "assigned" : enquiry.status,
    assigned_because_unknown: Boolean(assignedBecauseUnknown)
  };

  const updated = await updateEnquiryFields(enquiry.id, patch);

  await insertEnquiryAssignmentNotification({
    enquiryId: updated.id,
    enquiryCode: updated.enquiry_code,
    customerName: updated.customer_name,
    assigneeId,
    assignedByUserId
  });

  await logEnquiryActivity({
    enquiryId: updated.id,
    actorId: assignedByUserId,
    action: "assigned",
    detail: updated.enquiry_code
  });

  return updated;
}

export async function updateEnquiryStatus({ enquiryId, status, isAdmin, assigneeId, sessionUserId, enquiry }) {
  const next = normalizeEnquiryStatus(status);
  if (!isAdmin && assigneeId !== sessionUserId && enquiry?.escalated_to_id !== sessionUserId) {
    throw new Error("Only the assignee, SLA fallback, or an admin can update status.");
  }
  const patch = { status: next };
  const now = new Date().toISOString();
  if ((next === "in_progress" || next === "resolved" || next === "closed") && !enquiry?.picked_at) {
    patch.picked_at = now;
  }
  if (next === "closed" && !enquiry?.closed_at) {
    patch.closed_at = now;
  }
  const updated = await updateEnquiryFields(enquiryId, patch);
  await logEnquiryActivity({
    enquiryId,
    actorId: sessionUserId,
    action: "status",
    detail: next
  });
  if (next === "closed" && enquiry?.status !== "closed") {
    await queueCloseSurveyIfNeeded(updated, sessionUserId);
  }
  return updated;
}

export function filterEnquiries(enquiries, { statusFilter, searchQuery, assigneeFilter }) {
  const list = Array.isArray(enquiries) ? enquiries : [];
  const q = String(searchQuery ?? "").trim().toLowerCase();
  return list.filter((row) => {
    if (statusFilter && statusFilter !== "all" && row.status !== statusFilter) return false;
    if (assigneeFilter && assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned" && row.assignee_id) return false;
      if (assigneeFilter !== "unassigned" && row.assignee_id !== assigneeFilter) return false;
    }
    if (!q) return true;
    const haystack = [
      row.enquiry_code,
      row.customer_name,
      row.customer_phone,
      row.customer_email,
      row.product_details,
      row.source,
      row.notes,
      row.status,
      row.order_id,
      row.help_topic
    ]
      .map((v) => String(v ?? "").toLowerCase())
      .join(" ");
    return haystack.includes(q);
  });
}

export function enquiryStatusCounts(enquiries) {
  const counts = { all: enquiries.length, new: 0, assigned: 0, in_progress: 0, resolved: 0, closed: 0 };
  for (const row of enquiries) {
    if (counts[row.status] != null) counts[row.status] += 1;
  }
  return counts;
}
