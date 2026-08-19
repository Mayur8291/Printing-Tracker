import { supabase } from "./supabaseClient";
import { insertEnquiryAssignmentNotification } from "./enquiryNotificationUtils";
import { logEnquiryActivity } from "./enquiryActivityUtils";
import { queueCloseSurveyIfNeeded } from "./enquiryCloseNotify";
import { applyEnquiryClosePatch, updateEnquiryFields } from "./enquiryUtils";

async function patchEnquiry(enquiryId, patch) {
  return updateEnquiryFields(enquiryId, patch);
}

function displayName(profile) {
  if (!profile) return "—";
  const name = String(profile.full_name ?? "").trim();
  if (name) return name;
  const email = String(profile.email ?? "").trim();
  if (email) return email;
  return "User";
}

/** Concierge desk timings (same as Scott Concierge). */
export const ENQUIRY_SLA_ALERT_MINUTES = 60;
export const ENQUIRY_SLA_ESCALATE_MINUTES = 120;
export const ENQUIRY_FALLBACK_MANAGER_NAME = "Gargi";
export const UNKNOWN_ACCOUNT_MANAGER_VALUE = "__unknown_gargi__";

export const ENQUIRY_HELP_TOPICS = ["enquiry", "product_issue", "regular"];
export const ENQUIRY_HELP_TOPIC_LABEL = {
  enquiry: "Enquiry",
  product_issue: "Product related issue",
  regular: "Regular order"
};

export const ENQUIRY_ORDER_TYPES = ["regular", "customized"];
export const ENQUIRY_ORDER_TYPE_LABEL = {
  regular: "Regular",
  customized: "Customized"
};

export function isEnquiryHelpPath(row) {
  if (String(row?.ticket_kind ?? "") === "complaint") return false;
  if (String(row?.ticket_kind ?? "") === "enquiry") return true;
  const orderType = String(row?.order_type ?? "");
  const help = String(row?.help_topic ?? "");
  return orderType === "customized" && help === "enquiry";
}

/** Help with order → Regular Order, or Customized → Concerns. Delay does not file a ticket. Enquiries go to the Enquiry tab. */
export function isComplaintsHelpPath(row) {
  if (isEnquiryHelpPath(row)) return false;
  const orderType = String(row?.order_type ?? "");
  const help = String(row?.help_topic ?? "");
  if (orderType === "regular" && help === "regular") return true;
  if (orderType === "customized" && help === "product_issue") return true;
  return String(row?.ticket_kind ?? "") === "complaint";
}

export function complaintsHelpPathLabel(row) {
  const orderType = String(row?.order_type ?? "");
  const help = String(row?.help_topic ?? "");
  if (isEnquiryHelpPath(row) || (orderType === "customized" && help === "enquiry")) {
    return "Help with order → Customized → Enquiries";
  }
  if (orderType === "regular" && help === "regular") return "Help with order → Regular Order";
  if (orderType === "customized" && help === "product_issue") return "Help with order → Customized → Concerns";
  return "—";
}

export const ENQUIRY_FEEDBACK_RATINGS = ["Very Good", "Good", "Average", "Poor", "Very Poor"];

export function lastTenDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(-10);
}

export function phonesMatch(a, b) {
  const left = lastTenDigits(a);
  const right = lastTenDigits(b);
  return Boolean(left && right && left.length >= 10 && left === right);
}

export function normalizeOrderCode(raw) {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isEnquiryUnpicked(enquiry) {
  if (!enquiry) return false;
  if (enquiry.picked_at) return false;
  return enquiry.status === "new" || enquiry.status === "assigned";
}

export function minutesWaiting(submittedAt, now = Date.now()) {
  const started = new Date(submittedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 60000));
}

export function findFallbackManagerProfile(teamProfiles) {
  const list = Array.isArray(teamProfiles) ? teamProfiles : [];
  const named = list.find(
    (p) => String(p?.full_name ?? "").trim().toLowerCase() === ENQUIRY_FALLBACK_MANAGER_NAME.toLowerCase()
  );
  if (named) return named;
  return list.find((p) => String(p?.role ?? "").toLowerCase() === "admin") || null;
}

export function isFallbackManagerProfile(profile) {
  if (!profile) return false;
  return String(profile.full_name ?? "").trim().toLowerCase() === ENQUIRY_FALLBACK_MANAGER_NAME.toLowerCase();
}

function phoneFromCustomerJson(customer) {
  if (!customer || typeof customer !== "object") return "";
  return String(customer.phone ?? customer.mobile ?? customer.contact_number ?? "").trim();
}

function orderMatchResult({ found, orderId, customerName, phone, status, source, dueDate }) {
  return { found, orderId, customerName, phone, status, source, dueDate: dueDate || "" };
}

/** Staff lookup: Ready Stock (scott_orders) then printing tracker orders. */
export async function lookupOrderForEnquiry(orderIdRaw) {
  const code = normalizeOrderCode(orderIdRaw);
  if (!code) return orderMatchResult({ found: false, orderId: "", customerName: "", phone: "", status: "", source: "" });

  const { data: byCode, error: codeErr } = await supabase
    .from("scott_orders")
    .select("id, order_code, customer, status")
    .eq("order_code", code)
    .limit(1)
    .maybeSingle();
  if (codeErr && !String(codeErr.message ?? "").includes("Could not find")) {
    console.warn("scott_orders lookup:", codeErr.message);
  }
  if (byCode) {
    const customer = byCode.customer && typeof byCode.customer === "object" ? byCode.customer : {};
    return orderMatchResult({
      found: true,
      orderId: byCode.order_code || byCode.id,
      customerName: String(customer.name ?? customer.customer_name ?? "").trim(),
      phone: phoneFromCustomerJson(customer),
      status: byCode.status || "",
      source: "scott_orders"
    });
  }

  const { data: byId } = await supabase
    .from("scott_orders")
    .select("id, order_code, customer, status")
    .eq("id", code)
    .limit(1)
    .maybeSingle();
  if (byId) {
    const customer = byId.customer && typeof byId.customer === "object" ? byId.customer : {};
    return orderMatchResult({
      found: true,
      orderId: byId.order_code || byId.id,
      customerName: String(customer.name ?? customer.customer_name ?? "").trim(),
      phone: phoneFromCustomerJson(customer),
      status: byId.status || "",
      source: "scott_orders"
    });
  }

  const { data: tracker, error: trackerErr } = await supabase
    .from("orders")
    .select("id, order_id, customer_name, status, due_date")
    .eq("order_id", code)
    .limit(1)
    .maybeSingle();
  if (trackerErr && !String(trackerErr.message ?? "").includes("Could not find")) {
    console.warn("orders lookup:", trackerErr.message);
  }
  if (tracker) {
    return orderMatchResult({
      found: true,
      orderId: tracker.order_id || String(tracker.id),
      customerName: String(tracker.customer_name ?? "").trim(),
      phone: "",
      status: tracker.status || "",
      source: "orders",
      dueDate: tracker.due_date ? String(tracker.due_date).slice(0, 10) : ""
    });
  }

  return orderMatchResult({ found: false, orderId: code, customerName: "", phone: "", status: "", source: "" });
}

export function ownershipFromLookup(lookup, customerPhone) {
  if (!lookup?.found) {
    return {
      verified: false,
      label: "Not verified — no order with this Order ID for the registered mobile"
    };
  }
  if (!lookup.phone) {
    return {
      verified: false,
      label: "Order found — no phone on the order row, do not assume this customer owns it"
    };
  }
  if (!phonesMatch(lookup.phone, customerPhone)) {
    return {
      verified: false,
      label: "Not verified — WhatsApp / registered mobile did not match the order phone"
    };
  }
  return {
    verified: true,
    label: "Verified — phone matched the order"
  };
}

export function listWaitingAlerts(enquiries, now = Date.now()) {
  return (Array.isArray(enquiries) ? enquiries : [])
    .filter((row) => isEnquiryUnpicked(row))
    .map((row) => {
      const waiting = minutesWaiting(row.created_at, now);
      if (waiting < ENQUIRY_SLA_ALERT_MINUTES) return null;
      return {
        enquiryId: row.id,
        enquiryCode: row.enquiry_code,
        customerName: row.customer_name,
        orderId: row.order_id || "",
        assigneeId: row.assignee_id,
        submittedAt: row.created_at,
        waitingMinutes: waiting,
        message: `Not picked ${row.enquiry_code}. Customer query received over ${ENQUIRY_SLA_ALERT_MINUTES} minutes ago.`
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);
}

export async function fetchEnquirySlaEscalations() {
  const { data, error } = await supabase
    .from("enquiry_sla_escalations")
    .select(
      "id, enquiry_id, enquiry_code, customer_name, order_id, assignee_id, assignee_name, recipient_user_id, message, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) return [];
    throw error;
  }
  return data ?? [];
}

export async function pickEnquiry({ enquiry, action, sessionUserId, isAdmin }) {
  if (!enquiry?.id) throw new Error("Enquiry not found.");
  const isAssignee = enquiry.assignee_id === sessionUserId;
  const isFallback = enquiry.escalated_to_id === sessionUserId;
  if (!isAdmin && !isAssignee && !isFallback) {
    throw new Error("Only the assignee, SLA fallback, or an admin can pick this enquiry.");
  }

  const now = new Date().toISOString();
  const patch = {};
  if (!enquiry.picked_at) patch.picked_at = now;

  if (action === "verified") {
    if (enquiry.status === "new") patch.status = "assigned";
  } else if (action === "contacted") {
    patch.status = "in_progress";
  } else if (action === "closed") {
    patch.status = "closed";
    if (!enquiry.closed_at) patch.closed_at = now;
    if (!enquiry.picked_at) patch.picked_at = now;
  } else {
    throw new Error("Unknown pick action.");
  }

  const updated =
    action === "closed"
      ? await applyEnquiryClosePatch(enquiry.id, patch, enquiry.customer_phone)
      : await patchEnquiry(enquiry.id, patch);
  await logEnquiryActivity({
    enquiryId: enquiry.id,
    actorId: sessionUserId,
    action,
    detail: enquiry.enquiry_code
  });
  if (action === "closed" && enquiry.status !== "closed") {
    await queueCloseSurveyIfNeeded(updated, sessionUserId);
  }
  return updated;
}

export async function saveEnquiryFeedback({ enquiry, rating, comment, sessionUserId, isAdmin }) {
  if (!enquiry?.id) throw new Error("Enquiry not found.");
  if (enquiry.status !== "closed") throw new Error("Close the enquiry before logging feedback.");
  const isAssignee = enquiry.assignee_id === sessionUserId;
  const isFallback = enquiry.escalated_to_id === sessionUserId;
  const isCreator = enquiry.created_by === sessionUserId;
  if (!isAdmin && !isAssignee && !isFallback && !isCreator) {
    throw new Error("Only the customer chat, assignee, SLA fallback, or an admin can log feedback.");
  }
  const nextRating = ENQUIRY_FEEDBACK_RATINGS.includes(rating) ? rating : null;
  if (!nextRating) throw new Error("Pick a feedback rating.");
  const updated = await patchEnquiry(enquiry.id, {
    feedback_rating: nextRating,
    feedback_comment: String(comment ?? "").trim() || null,
    feedback_at: new Date().toISOString()
  });
  await logEnquiryActivity({
    enquiryId: enquiry.id,
    actorId: sessionUserId,
    action: "feedback",
    detail: nextRating
  });
  return updated;
}

export async function escalateUnpickedEnquiry({ enquiry, teamProfiles, profileById }) {
  if (!isEnquiryUnpicked(enquiry) || enquiry.sla_escalated_at) return null;
  if (minutesWaiting(enquiry.created_at) < ENQUIRY_SLA_ESCALATE_MINUTES) return null;

  const fallback = findFallbackManagerProfile(teamProfiles);
  if (!fallback?.id) return null;
  if (enquiry.assignee_id === fallback.id) return null;

  const assigneeName = displayName(profileById?.[enquiry.assignee_id]) || "Account manager";
  const message = `${assigneeName} has not picked ${enquiry.enquiry_code}.`;
  const now = new Date().toISOString();

  const updated = await patchEnquiry(enquiry.id, {
    sla_escalated_at: now,
    escalated_to_id: fallback.id
  });

  const { error: escErr } = await supabase.from("enquiry_sla_escalations").insert({
    enquiry_id: enquiry.id,
    enquiry_code: enquiry.enquiry_code,
    customer_name: enquiry.customer_name,
    order_id: enquiry.order_id || null,
    assignee_id: enquiry.assignee_id || null,
    assignee_name: assigneeName,
    recipient_user_id: fallback.id,
    message
  });
  if (escErr && !String(escErr.message ?? "").includes("Could not find the table") && escErr.code !== "23505") {
    console.warn("enquiry SLA escalation insert:", escErr.message);
  }

  await insertEnquiryAssignmentNotification({
    enquiryId: enquiry.id,
    enquiryCode: enquiry.enquiry_code,
    customerName: enquiry.customer_name,
    assigneeId: fallback.id,
    assignedByUserId: enquiry.assignee_id || enquiry.created_by
  });

  return updated;
}

export async function runEnquirySlaPass({ enquiries, teamProfiles, profileById, canWrite }) {
  if (!canWrite) return enquiries;
  let next = Array.isArray(enquiries) ? [...enquiries] : [];
  for (const row of next) {
    try {
      const updated = await escalateUnpickedEnquiry({ enquiry: row, teamProfiles, profileById });
      if (updated) {
        next = next.map((r) => (r.id === updated.id ? updated : r));
      }
    } catch (e) {
      console.warn("enquiry SLA pass:", e.message || e);
    }
  }
  return next;
}
