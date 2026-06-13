/** Job sheet size grid: XXS through 8XL (separate from printing order sizes). */
export const JOB_SHEET_SIZE_COLUMNS = [
  { key: "XXS", label: "XXS" },
  { key: "XS", label: "XS" },
  { key: "S", label: "S" },
  { key: "M", label: "M" },
  { key: "L", label: "L" },
  { key: "XL", label: "XL" },
  { key: "2XL", label: "2XL" },
  { key: "3XL", label: "3XL" },
  { key: "4XL", label: "4XL" },
  { key: "5XL", label: "5XL" },
  { key: "6XL", label: "6XL" },
  { key: "7XL", label: "7XL" },
  { key: "8XL", label: "8XL" }
];

export const JOB_SHEET_SIZE_TYPES = [
  { value: "alpha", label: "Alpha (XXS–8XL)" },
  { value: "numeric", label: "Numeric" },
  { value: "free", label: "Free size" },
  { value: "custom", label: "Custom" }
];

/** First job sheet order number when none exist yet. */
export const JOB_SHEET_ORDER_ID_START = 900;

export function emptyJobSheetSizesForm() {
  return Object.fromEntries(JOB_SHEET_SIZE_COLUMNS.map(({ key }) => [key, ""]));
}

export function newJobSheetExtraSizeRow() {
  return {
    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    label: "",
    qty: ""
  };
}

export function parseJobSheetSizeQty(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function sumJobSheetSizes(sizes, extraSizes = []) {
  let total = JOB_SHEET_SIZE_COLUMNS.reduce(
    (acc, { key }) => acc + parseJobSheetSizeQty(sizes?.[key]),
    0
  );
  if (Array.isArray(extraSizes)) {
    for (const row of extraSizes) {
      total += parseJobSheetSizeQty(row?.qty);
    }
  }
  return total;
}

export function jobSheetSizesToBreakdown(sizes, extraSizes = []) {
  const out = {};
  for (const { key } of JOB_SHEET_SIZE_COLUMNS) {
    const n = parseJobSheetSizeQty(sizes?.[key]);
    if (n > 0) out[key] = n;
  }
  if (Array.isArray(extraSizes)) {
    for (const row of extraSizes) {
      const label = String(row?.label ?? "").trim().toUpperCase();
      if (!label) continue;
      const n = parseJobSheetSizeQty(row?.qty);
      if (n > 0) out[label] = (out[label] ?? 0) + n;
    }
  }
  return out;
}

export function formatJobSheetOrderId(num) {
  const n = Number.parseInt(String(num), 10);
  if (!Number.isFinite(n) || n < 0) return String(JOB_SHEET_ORDER_ID_START).padStart(4, "0");
  return String(n).padStart(4, "0");
}

export function parseJobSheetOrderIdNumber(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/** Next order id after max existing production job sheet id (floor 0900). */
export function computeNextJobSheetOrderId(existingOrderIds) {
  let max = JOB_SHEET_ORDER_ID_START - 1;
  for (const raw of existingOrderIds ?? []) {
    const n = parseJobSheetOrderIdNumber(raw);
    if (n != null && n > max) max = n;
  }
  return formatJobSheetOrderId(max + 1);
}

export function emptyJobSheetForm() {
  return {
    order_id: "",
    order_date: "",
    sales_incharge_name: "",
    customer_name: "",
    size_type: "",
    rate_per_piece: "",
    total_quantity: "",
    sizes: emptyJobSheetSizesForm(),
    extraSizes: [],
    product_name: "",
    brand: "",
    color: "",
    fabric_type: "",
    branding: "no",
    branding_type: "",
    gsm: "",
    atta: "no",
    comments: "",
    delivery_required_on: ""
  };
}

export function parseJobSheetRate(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
