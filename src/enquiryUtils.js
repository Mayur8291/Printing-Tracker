import { supabase } from "./supabaseClient";
import { insertEnquiryAssignmentNotification } from "./enquiryNotificationUtils";
import { logEnquiryActivity } from "./enquiryActivityUtils";
import { queueCloseSurveyIfNeeded } from "./enquiryCloseNotify";
import { uploadEnquiryPhotos } from "./enquiryAttachmentUtils";

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
  help_topic: "regular",
  ticket_kind: "complaint"
};

export const EMPTY_ENQUIRY_DESK_FORM = {
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  product_details: "",
  source: "WhatsApp",
  priority: "normal",
  notes: "",
  order_id: "",
  order_type: "customized",
  help_topic: "enquiry",
  ticket_kind: "enquiry"
};

export function ticketKindFromForm(form) {
  if (form?.ticket_kind === "complaint" || form?.ticket_kind === "enquiry") return form.ticket_kind;
  if (form?.help_topic === "regular" || form?.help_topic === "product_issue") return "complaint";
  return "enquiry";
}

export const ENQUIRY_CODE_PREFIX = "ENQ";
export const COMPLAINT_CODE_PREFIX = "CS";

function paddedTicketCode(prefix, n) {
  return `${prefix}-${String(Math.max(1, n)).padStart(5, "0")}`;
}

function codeDigits(code) {
  const n = Number.parseInt(String(code ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function rowLooksLikeComplaint(row) {
  if (String(row?.ticket_kind ?? "") === "complaint") return true;
  if (String(row?.ticket_kind ?? "") === "enquiry") return false;
  return ["regular", "product_issue"].includes(String(row?.help_topic ?? ""));
}

function isUniqueEnquiryCodeError(error) {
  const msg = String(error?.message ?? "");
  return error?.code === "23505" || /enquiry_code|duplicate key/i.test(msg);
}

export async function allocateTicketCode(kind) {
  const prefix = kind === "complaint" ? COMPLAINT_CODE_PREFIX : ENQUIRY_CODE_PREFIX;
  const { data, error } = await supabase.from("enquiries").select("enquiry_code").like("enquiry_code", `${prefix}-%`);
  if (error) {
    console.warn("allocate ticket code:", error.message);
    return paddedTicketCode(prefix, (Date.now() % 90000) + 1);
  }
  let max = 0;
  for (const row of data ?? []) {
    max = Math.max(max, codeDigits(row.enquiry_code));
  }
  return paddedTicketCode(prefix, max + 1);
}

let complaintRelabelAttempts = 0;

/** Old complaint rows used ENQ-; rewrite to CS- when RLS allows. */
export async function relabelComplaintCodes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const needsRelabel = list.some(
    (row) => rowLooksLikeComplaint(row) && /^ENQ-\d+$/i.test(String(row?.enquiry_code ?? ""))
  );
  if (!needsRelabel || complaintRelabelAttempts >= 2) return list;
  complaintRelabelAttempts += 1;
  const usedCs = new Set();
  let maxCs = 0;
  for (const row of list) {
    const code = String(row?.enquiry_code ?? "").toUpperCase();
    if (!/^CS-\d+$/.test(code)) continue;
    usedCs.add(code);
    maxCs = Math.max(maxCs, codeDigits(code));
  }
  const patchedById = new Map();
  for (const row of list) {
    if (!rowLooksLikeComplaint(row)) continue;
    const current = String(row?.enquiry_code ?? "");
    if (!/^ENQ-\d+$/i.test(current)) continue;
    let candidate = paddedTicketCode(COMPLAINT_CODE_PREFIX, codeDigits(current));
    while (usedCs.has(candidate)) {
      maxCs += 1;
      candidate = paddedTicketCode(COMPLAINT_CODE_PREFIX, maxCs);
    }
    const { data, error } = await supabase
      .from("enquiries")
      .update({ enquiry_code: candidate })
      .eq("id", row.id)
      .select("id, enquiry_code")
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn("relabel complaint code:", error.message);
      continue;
    }
    usedCs.add(String(data.enquiry_code || candidate).toUpperCase());
    maxCs = Math.max(maxCs, codeDigits(data.enquiry_code || candidate));
    patchedById.set(row.id, { ...row, enquiry_code: data.enquiry_code || candidate });
  }
  if (!patchedById.size) return list;
  return list.map((row) => patchedById.get(row.id) || row);
}

const ENQUIRY_SELECT =
  "id, enquiry_code, customer_name, customer_phone, customer_email, product_details, source, notes, status, priority, assignee_id, assigned_by, assigned_at, created_by, created_at, updated_at, order_id, order_type, help_topic, ticket_kind, ownership_verified, assigned_because_unknown, picked_at, sla_escalated_at, escalated_to_id, closed_at, feedback_rating, feedback_comment, feedback_at, feedback_requested_at, attachments";

const ENQUIRY_SELECT_LEGACY = ENQUIRY_SELECT.replace(", ticket_kind", "");

function missingTicketKindColumn(error) {
  return String(error?.message ?? "").includes("ticket_kind");
}

export function friendlyEnquiryDbError(error) {
  const msg = String(error?.message ?? "");
  if (error?.code === "PGRST116" || /cannot coerce/i.test(msg)) {
    return "Could not finish saving this ticket. Please try again.";
  }
  if (/no unique or exclusion constraint matching the ON CONFLICT/i.test(msg) || /feedback queue/i.test(msg)) {
    return "Could not close this case. Try Close again.";
  }
  return msg || "Could not save this ticket.";
}

export function isCloseSurveyTriggerError(error) {
  const msg = String(error?.message ?? error?.cause?.message ?? "");
  return /ON CONFLICT|feedback queue|no unique or exclusion constraint|Could not close this case/i.test(msg);
}

/** Close even when staging still has the broken ON CONFLICT survey trigger. */
export async function applyEnquiryClosePatch(enquiryId, patch, customerPhone) {
  try {
    return await updateEnquiryFields(enquiryId, patch);
  } catch (e) {
    if (!isCloseSurveyTriggerError(e)) throw e;
    const phone = String(customerPhone ?? "").trim();
    if (!phone) throw e;
    await updateEnquiryFields(enquiryId, { ...patch, customer_phone: "" });
    return updateEnquiryFields(enquiryId, { customer_phone: phone, status: "closed" });
  }
}

async function insertEnquiryRow(payload) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!payload.enquiry_code || attempt > 0) {
      payload.enquiry_code = await allocateTicketCode(ticketKindFromForm(payload));
    }
    let { data, error } = await supabase.from("enquiries").insert(payload).select(ENQUIRY_SELECT).maybeSingle();
    if (error && missingTicketKindColumn(error) && payload.ticket_kind) {
      const retryPayload = { ...payload };
      delete retryPayload.ticket_kind;
      ({ data, error } = await supabase
        .from("enquiries")
        .insert(retryPayload)
        .select(ENQUIRY_SELECT_LEGACY)
        .maybeSingle());
    }
    if (error && isUniqueEnquiryCodeError(error)) {
      lastError = error;
      payload.enquiry_code = "";
      continue;
    }
    if (error) throw new Error(friendlyEnquiryDbError(error));
    if (!data) {
      throw new Error("Ticket was not returned after save. Refresh Support and look for the new row.");
    }
    return data;
  }
  throw new Error(friendlyEnquiryDbError(lastError) || "Could not allocate a unique ticket code.");
}

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
  let { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error && missingTicketKindColumn(error)) {
    ({ data, error } = await supabase
      .from("enquiries")
      .select(ENQUIRY_SELECT_LEGACY)
      .order("created_at", { ascending: false })
      .limit(500));
  }
  if (error) throw error;
  return relabelComplaintCodes(data ?? []);
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
    ticket_kind: ticketKindFromForm(form),
    ownership_verified: Boolean(form.ownership_verified),
    attachments: Array.isArray(form.attachments) ? form.attachments : []
  };
  if (!payload.customer_name) {
    throw new Error("Customer name is required.");
  }

  if (form.id) {
    payload.id = form.id;
  }

  if (form.allowAssign === true && form.assignee_id) {
    payload.assignee_id = form.assignee_id;
    payload.assigned_by = createdBy;
    payload.assigned_at = new Date().toISOString();
    payload.status = "assigned";
    payload.assigned_because_unknown = Boolean(form.assigned_because_unknown);
  }

  const data = await insertEnquiryRow(payload);
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

/** Upload photos first, then insert so staff who cannot UPDATE still get attachments. */
export async function createEnquiryWithPhotos({ createdBy, form, files }) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!createdBy) {
    throw new Error("Sign in again before filing this ticket.");
  }
  const enquiryId = list.length ? crypto.randomUUID() : form.id;
  let attachments = Array.isArray(form.attachments) ? form.attachments : [];
  if (list.length) {
    const uploaded = await uploadEnquiryPhotos({
      userId: createdBy,
      enquiryId,
      files: list
    });
    attachments = uploaded.map(({ path, name, mime, size }) => ({ path, name, mime, size }));
  }
  return createEnquiry({
    createdBy,
    form: {
      ...form,
      ...(enquiryId ? { id: enquiryId } : {}),
      attachments
    }
  });
}

export async function updateEnquiryFields(enquiryId, patch) {
  let { data, error } = await supabase
    .from("enquiries")
    .update(patch)
    .eq("id", enquiryId)
    .select(ENQUIRY_SELECT)
    .maybeSingle();
  if (error && missingTicketKindColumn(error)) {
    ({ data, error } = await supabase
      .from("enquiries")
      .update(patch)
      .eq("id", enquiryId)
      .select(ENQUIRY_SELECT_LEGACY)
      .maybeSingle());
  }
  if (error) throw new Error(friendlyEnquiryDbError(error));
  if (!data) {
    throw new Error("Could not update this ticket. Refresh Support and try again.");
  }
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
  const updated =
    next === "closed"
      ? await applyEnquiryClosePatch(enquiryId, patch, enquiry?.customer_phone)
      : await updateEnquiryFields(enquiryId, patch);
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
      row.help_topic,
      row.ticket_kind
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
