import { supabase } from "./supabaseClient";

const DELAY_NEXT_BUTTONS = [
  { id: "menu_help", title: "Help with order" },
  { id: "menu_access", title: "Customer Access" }
];

export function formatDelayDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function delayAlertText({ customerName, orderNumber, oldDeliveryDate, newDeliveryDate }) {
  const name = String(customerName ?? "").trim() || "customer";
  return [
    `Hi ${name}, this is Scott Concierge.`,
    `We are sorry. Delivery for order ${orderNumber} has changed.`,
    `Old date: ${formatDelayDate(oldDeliveryDate) || "—"}`,
    `New date: ${formatDelayDate(newDeliveryDate) || "—"}`,
    "We apologise for the delay. Thank you for your patience."
  ].join("\n");
}

export async function fetchDelayAlerts() {
  const { data, error } = await supabase
    .from("support_delay_alerts")
    .select("id, order_id, customer_name, phone, old_delivery_date, new_delivery_date, created_at, sent_by")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    if (String(error.message ?? "").includes("Could not find the table")) return [];
    throw error;
  }
  return data ?? [];
}

export async function sendSupportDelayAlert({
  orderNumber,
  customerName,
  phone,
  oldDeliveryDate,
  newDeliveryDate,
  sessionUserId
}) {
  const orderId = String(orderNumber ?? "").trim().toUpperCase();
  const nextDate = String(newDeliveryDate ?? "").trim();
  const nextPhone = String(phone ?? "").trim();
  if (!orderId || !nextDate) {
    throw new Error("Order number and new delivery date are required.");
  }
  if (!nextPhone) {
    throw new Error("Customer phone is required so the delay text can be queued.");
  }
  if (!sessionUserId) {
    throw new Error("Sign in again before sending a delay alert.");
  }

  const message = delayAlertText({
    customerName,
    orderNumber: orderId,
    oldDeliveryDate,
    newDeliveryDate: nextDate
  });

  const { error: alertError } = await supabase.from("support_delay_alerts").insert({
    order_id: orderId,
    customer_name: String(customerName ?? "").trim() || null,
    phone: nextPhone,
    old_delivery_date: String(oldDeliveryDate ?? "").trim() || null,
    new_delivery_date: nextDate,
    reason: "Production delay",
    message,
    sent_by: sessionUserId
  });
  if (alertError) throw alertError;

  const { error: outError } = await supabase.from("enquiry_outbound_messages").insert([
    {
      enquiry_id: null,
      phone: nextPhone,
      kind: "delay_alert",
      text: message,
      buttons: []
    },
    {
      enquiry_id: null,
      phone: nextPhone,
      kind: "buttons",
      text: "What would you like to do next?",
      buttons: DELAY_NEXT_BUTTONS
    }
  ]);
  if (outError) throw outError;
  return { orderId, message };
}
