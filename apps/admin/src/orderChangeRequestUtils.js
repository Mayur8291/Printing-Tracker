import { ORDER_SIZE_COLUMNS } from "./orderViewUtils";

export const ORDER_CHANGE_FIELDS = [
  { key: "due_date", label: "Delivery date" },
  { key: "product_name", label: "Product name" },
  { key: "remarks", label: "Remarks" }
];

const STANDARD_SIZE_KEYS = new Set(ORDER_SIZE_COLUMNS.map((column) => column.key));

function positiveSize(value) {
  const qty = Number(value);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/** Sizes the person can edit. Empty when the order has no size breakdown, so qty stays one number. */
export function orderChangeSizeRows(order) {
  const breakdown = order?.size_breakdown;
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return [];
  const hasAny = Object.values(breakdown).some((value) => positiveSize(value) > 0);
  if (!hasAny) return [];
  const rows = ORDER_SIZE_COLUMNS.map((column) => ({
    key: column.key,
    label: column.label,
    qty: positiveSize(breakdown[column.key])
  }));
  for (const [key, value] of Object.entries(breakdown)) {
    if (STANDARD_SIZE_KEYS.has(key)) continue;
    const qty = positiveSize(value);
    if (qty > 0) rows.push({ key, label: key, qty });
  }
  return rows;
}

function fieldText(order, key) {
  if (key === "qty") {
    return order?.qty === null || order?.qty === undefined ? "" : String(order.qty);
  }
  if (key === "due_date") return String(order?.due_date ?? "").slice(0, 10);
  return String(order?.[key] ?? "").trim();
}

export function orderChangeDraft(order) {
  const draft = { sizes: {} };
  for (const field of ORDER_CHANGE_FIELDS) {
    draft[field.key] = fieldText(order, field.key);
  }
  const rows = orderChangeSizeRows(order);
  if (rows.length > 0) {
    for (const row of rows) draft.sizes[row.key] = String(row.qty);
  } else {
    draft.qty = fieldText(order, "qty");
  }
  return draft;
}

function sizeNumber(value) {
  const text = String(value ?? "").trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

export function orderChangePayload(order, draft) {
  const payload = {};
  const rows = orderChangeSizeRows(order);
  if (rows.length > 0) {
    const sizes = {};
    for (const row of rows) {
      const next = sizeNumber(draft?.sizes?.[row.key]);
      if (next === null || next === row.qty) continue;
      sizes[row.key] = String(next);
    }
    if (Object.keys(sizes).length > 0) payload.sizes = sizes;
  } else {
    const next = String(draft?.qty ?? "").trim();
    if (next !== fieldText(order, "qty")) payload.qty = next;
  }
  for (const field of ORDER_CHANGE_FIELDS) {
    const next = String(draft?.[field.key] ?? "").trim();
    if (next !== fieldText(order, field.key)) payload[field.key] = draft[field.key];
  }
  return payload;
}

export function orderChangeSizeTotal(order, draft) {
  const rows = orderChangeSizeRows(order);
  if (rows.length === 0) return null;
  let sum = 0;
  for (const row of rows) {
    const next = sizeNumber(draft?.sizes?.[row.key]);
    if (next === null) return null;
    sum += next;
  }
  return sum;
}

export function orderChangePreviewLines(order, draft) {
  const payload = orderChangePayload(order, draft);
  const lines = [];
  const rows = orderChangeSizeRows(order);
  if (payload.sizes) {
    for (const row of rows) {
      if (!Object.prototype.hasOwnProperty.call(payload.sizes, row.key)) continue;
      lines.push(`${row.label}: ${row.qty} → ${payload.sizes[row.key]}`);
    }
    const nextTotal = orderChangeSizeTotal(order, draft);
    const currentTotal = Number(order?.qty);
    if (nextTotal !== null && nextTotal !== currentTotal) {
      lines.push(`Qty: ${Number.isFinite(currentTotal) ? currentTotal : "—"} → ${nextTotal}`);
    }
  } else if (Object.prototype.hasOwnProperty.call(payload, "qty")) {
    lines.push(`Qty: ${fieldText(order, "qty") || "—"} → ${String(payload.qty).trim() || "—"}`);
  }
  for (const field of ORDER_CHANGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, field.key)) continue;
    const current = fieldText(order, field.key) || "—";
    const next = String(payload[field.key] ?? "").trim() || "—";
    lines.push(`${field.label}: ${current} → ${next}`);
  }
  return lines;
}

export function orderChangeSummaryLines(summary) {
  return String(summary ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
