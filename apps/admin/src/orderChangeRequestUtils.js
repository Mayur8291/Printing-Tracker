import { FORM_STAGES, STAGE_LABEL } from "./orderViewUtils";

export const ORDER_CHANGE_FIELDS = [
  { key: "qty", label: "Qty" },
  { key: "due_date", label: "Delivery date" },
  { key: "product_name", label: "Product name" },
  { key: "coordinator_name", label: "Coordinator" },
  { key: "status", label: "Order status" },
  { key: "remarks", label: "Remarks" }
];

/** Statuses a change request may ask for. On hold and cancel keep their own reason dialogs. */
export const REQUESTABLE_STATUSES = FORM_STAGES.filter((status) => status !== "on_hold");

export function requestableStatusOptions(current) {
  const options = [...REQUESTABLE_STATUSES];
  if (current && !options.includes(current)) options.unshift(current);
  return options;
}

export function orderChangeStatusLabel(status) {
  if (!status) return "—";
  return STAGE_LABEL[status] || status;
}

function fieldText(order, key) {
  if (key === "qty") {
    return order?.qty === null || order?.qty === undefined ? "" : String(order.qty);
  }
  if (key === "due_date") return String(order?.due_date ?? "").slice(0, 10);
  if (key === "status") return String(order?.status ?? "");
  return String(order?.[key] ?? "").trim();
}

export function orderChangeDraft(order) {
  const draft = {};
  for (const field of ORDER_CHANGE_FIELDS) {
    draft[field.key] = fieldText(order, field.key);
  }
  return draft;
}

export function orderChangePayload(order, draft) {
  const payload = {};
  for (const field of ORDER_CHANGE_FIELDS) {
    const next = String(draft?.[field.key] ?? "").trim();
    const current = fieldText(order, field.key);
    if (next !== current) payload[field.key] = draft[field.key];
  }
  return payload;
}

function displayValue(key, value) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  if (key === "status") return orderChangeStatusLabel(text);
  return text;
}

export function orderChangePreviewLines(order, draft) {
  const payload = orderChangePayload(order, draft);
  return ORDER_CHANGE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(payload, field.key)).map(
    (field) =>
      `${field.label}: ${displayValue(field.key, fieldText(order, field.key))} → ${displayValue(field.key, payload[field.key])}`
  );
}

export function orderChangeSummaryLines(summary) {
  return String(summary ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
