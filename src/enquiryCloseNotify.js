import { supabase } from "./supabaseClient";
import { logEnquiryActivity } from "./enquiryActivityUtils";

export const CLOSE_SURVEY_FEEDBACK_BTN = "case_feedback";
export const CLOSE_SURVEY_SKIP_BTN = "feedback_skip";

export const CLOSE_SURVEY_RATINGS = [
  { id: "rating_very_good", title: "⭐ Very Good", label: "Very Good" },
  { id: "rating_good", title: "⭐ Good", label: "Good" },
  { id: "rating_average", title: "⭐ Average", label: "Average" },
  { id: "rating_poor", title: "⭐ Poor", label: "Poor" },
  { id: "rating_very_poor", title: "⭐ Very Poor", label: "Very Poor" }
];

export function closeSurveyText(enquiryCode) {
  return `I hope your issue has been resolved for Case ${enquiryCode || "Enquiry"}.\n\nPlease provide your feedback about your experience.`;
}

export function closeSurveyRatingPrompt() {
  return {
    text: "How was your experience?",
    buttons: CLOSE_SURVEY_RATINGS.map((r) => ({ id: r.id, title: r.title }))
  };
}

export function closeSurveyCommentPrompt() {
  return {
    text: "Would you like to share any additional feedback?\nType your feedback, or tap Skip.",
    buttons: [
      { id: CLOSE_SURVEY_SKIP_BTN, title: "Skip" },
      { id: "menu_home", title: "Main menu" }
    ]
  };
}

export async function fetchEnquiryOutbound(enquiryId) {
  if (!enquiryId) return [];
  const { data, error } = await supabase
    .from("enquiry_outbound_messages")
    .select("id, enquiry_id, phone, kind, text, buttons, created_at")
    .eq("enquiry_id", enquiryId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) return [];
    throw error;
  }
  return data ?? [];
}

export async function fetchOutboundForPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return [];
  const { data, error } = await supabase
    .from("enquiry_outbound_messages")
    .select("id, enquiry_id, phone, kind, text, buttons, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) return [];
    throw error;
  }
  return (data ?? []).filter((row) => String(row.phone ?? "").replace(/\D/g, "").slice(-10) === digits);
}

export async function fetchEnquiryForSurvey(enquiryId) {
  if (!enquiryId) return null;
  const { data, error } = await supabase
    .from("enquiries")
    .select(
      "id, enquiry_code, status, customer_phone, assignee_id, escalated_to_id, created_by, feedback_rating, feedback_comment"
    )
    .eq("id", enquiryId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function queueCloseSurveyIfNeeded(enquiry, actorId) {
  if (!enquiry?.id || enquiry.status !== "closed") return enquiry;
  const phone = String(enquiry.customer_phone ?? "").trim();
  if (!phone) {
    await logEnquiryActivity({
      enquiryId: enquiry.id,
      actorId,
      action: "status",
      detail: "Close — no customer phone, survey text not sent"
    });
    return enquiry;
  }
  const existing = await fetchEnquiryOutbound(enquiry.id);
  if (existing.length) {
    await logEnquiryActivity({
      enquiryId: enquiry.id,
      actorId,
      action: "status",
      detail: "Close survey text queued for customer"
    });
    return enquiry;
  }
  const text = closeSurveyText(enquiry.enquiry_code);
  const { error } = await supabase.from("enquiry_outbound_messages").insert({
    enquiry_id: enquiry.id,
    phone,
    kind: "buttons",
    text,
    buttons: [{ id: CLOSE_SURVEY_FEEDBACK_BTN, title: "Feedback" }]
  });
  if (error && error.code !== "23505" && !String(error.message ?? "").includes("duplicate")) {
    console.warn("queue close survey:", error.message);
  }
  await logEnquiryActivity({
    enquiryId: enquiry.id,
    actorId,
    action: "status",
    detail: "Close survey text queued for customer"
  });
  return enquiry;
}
