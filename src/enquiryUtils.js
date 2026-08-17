import { supabase } from "./supabaseClient";
import { insertEnquiryAssignmentNotification } from "./enquiryNotificationUtils";

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
  "Phone",
  "Email",
  "Walk-in",
  "Website",
  "Distributor",
  "WhatsApp",
  "Other"
];

export const EMPTY_ENQUIRY_FORM = {
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  product_details: "",
  source: "Phone",
  priority: "normal",
  notes: ""
};

const ENQUIRY_SELECT =
  "id, enquiry_code, customer_name, customer_phone, customer_email, product_details, source, notes, status, priority, assignee_id, assigned_by, assigned_at, created_by, created_at, updated_at";

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
    created_by: createdBy
  };
  if (!payload.customer_name) {
    throw new Error("Customer name is required.");
  }

  const { data, error } = await supabase.from("enquiries").insert(payload).select(ENQUIRY_SELECT).single();
  if (error) throw error;
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

export async function assignEnquiry({ enquiry, assigneeId, assignedByUserId }) {
  if (!enquiry?.id) throw new Error("Enquiry not found.");
  if (!assigneeId) throw new Error("Pick someone to assign.");

  const patch = {
    assignee_id: assigneeId,
    assigned_by: assignedByUserId,
    assigned_at: new Date().toISOString(),
    status: enquiry.status === "new" ? "assigned" : enquiry.status
  };

  const updated = await updateEnquiryFields(enquiry.id, patch);

  await insertEnquiryAssignmentNotification({
    enquiryId: updated.id,
    enquiryCode: updated.enquiry_code,
    customerName: updated.customer_name,
    assigneeId,
    assignedByUserId
  });

  return updated;
}

export async function updateEnquiryStatus({ enquiryId, status, isAdmin, assigneeId, sessionUserId }) {
  const next = normalizeEnquiryStatus(status);
  if (!isAdmin && assigneeId !== sessionUserId) {
    throw new Error("Only the assignee or an admin can update status.");
  }
  return updateEnquiryFields(enquiryId, { status: next });
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
      row.status
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
