const SAMPLING_ORDER_ID_RE = /^sampling[_-]?(\d+)$/i;

export function parseSamplingOrderNumber(orderId) {
  const match = String(orderId ?? "")
    .trim()
    .match(SAMPLING_ORDER_ID_RE);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function formatSamplingOrderIdDisplay(orderId) {
  const n = parseSamplingOrderNumber(orderId);
  if (n == null) {
    const text = String(orderId ?? "").trim();
    return text || null;
  }
  return `sampling${n}`;
}

/** Next id after max existing sampling order id (starts at sampling1). */
export function computeNextSamplingOrderId(existingOrderIds) {
  let max = 0;
  for (const raw of existingOrderIds ?? []) {
    const n = parseSamplingOrderNumber(raw);
    if (n != null && n > max) max = n;
  }
  return `sampling${max + 1}`;
}

export function samplingSizeFromBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return "";
  const size = breakdown.Size ?? breakdown.size;
  return size != null ? String(size).trim() : "";
}

export function samplingSizeToBreakdown(sizeText) {
  const size = String(sizeText ?? "").trim();
  return size ? { Size: size } : {};
}

export const emptySamplingOrderForm = () => ({
  order_id: "",
  customer_name: "",
  product_name: "",
  qty: "",
  size: "",
  due_date: ""
});
