import { ORDER_SIZE_COLUMNS, splitOrderIds } from "./orderViewUtils";

export function parseSizeQtyInput(raw) {
  const s = String(raw ?? "").replace(/\D/g, "");
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function emptySizesForm() {
  return Object.fromEntries(ORDER_SIZE_COLUMNS.map(({ key }) => [key, ""]));
}

export function sizesFormToBreakdown(sizes, extraSizes = []) {
  const out = {};
  for (const { key } of ORDER_SIZE_COLUMNS) {
    const n = parseSizeQtyInput(sizes?.[key]);
    if (n > 0) out[key] = n;
  }
  if (Array.isArray(extraSizes)) {
    for (const row of extraSizes) {
      const label = String(row?.label ?? "").trim().toUpperCase();
      if (!label) continue;
      const n = parseSizeQtyInput(row?.qty);
      if (n > 0) out[label] = (out[label] ?? 0) + n;
    }
  }
  return out;
}

export function sizeBreakdownToForm(breakdown) {
  const sizes = emptySizesForm();
  const extraSizes = [];
  if (!breakdown || typeof breakdown !== "object") return { sizes, extraSizes };
  const standardKeys = new Set(ORDER_SIZE_COLUMNS.map((c) => c.key));
  for (const [key, val] of Object.entries(breakdown)) {
    const n = parseSizeQtyInput(val);
    if (n <= 0) continue;
    if (standardKeys.has(key)) {
      sizes[key] = String(n);
    } else {
      extraSizes.push({
        id: `extra-${key}-${Math.random().toString(36).slice(2, 9)}`,
        label: String(key),
        qty: String(n)
      });
    }
  }
  return { sizes, extraSizes };
}

export function sumSizeForm(sizes, extraSizes = []) {
  let total = ORDER_SIZE_COLUMNS.reduce((acc, { key }) => acc + parseSizeQtyInput(sizes?.[key]), 0);
  if (Array.isArray(extraSizes)) {
    for (const row of extraSizes) {
      total += parseSizeQtyInput(row?.qty);
    }
  }
  return total;
}

function parseMoneyInput(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function normalizeOrderIdToken(raw) {
  return String(raw ?? "").replace(/\D/g, "").trim();
}

function parseOrderIdTokens(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const parts = s.split(/[\s,;]+/g).map(normalizeOrderIdToken).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export function buildAdminOrderDraftFromOrder(order) {
  const { sizes, extraSizes } = sizeBreakdownToForm(order?.size_breakdown);
  return {
    order_date: order?.order_date ?? "",
    order_id: splitOrderIds(order?.order_id).join(", "),
    owner_name: order?.owner_name ?? "",
    customer_name: order?.customer_name ?? "",
    product_name: order?.product_name ?? "",
    colors: Array.isArray(order?.colors) ? [...order.colors] : [],
    sizes,
    extraSizes,
    delivery_method: order?.delivery_method ?? "",
    order_cost: order?.order_cost != null && order?.order_cost !== "" ? String(order.order_cost) : "",
    printing_cost:
      order?.printing_cost != null && order?.printing_cost !== "" ? String(order.printing_cost) : "",
    is_production_order: Boolean(order?.is_production_order),
    expected_handover_to_printing: order?.expected_handover_to_printing ?? ""
  };
}

export function buildAdminOrderFieldsPayload(draft) {
  const size_breakdown = sizesFormToBreakdown(draft.sizes, draft.extraSizes);
  const qtyFromSizes = sumSizeForm(draft.sizes, draft.extraSizes);
  const orderIdJoined = parseOrderIdTokens(draft.order_id).join(", ") || null;
  return {
    order_date: String(draft.order_date ?? "").trim() || null,
    order_id: orderIdJoined,
    owner_name: String(draft.owner_name ?? "").trim() || null,
    customer_name: String(draft.customer_name ?? "").trim() || null,
    product_name: String(draft.product_name ?? "").trim() || null,
    colors: Array.isArray(draft.colors) ? draft.colors.filter(Boolean) : [],
    size_breakdown,
    ...(qtyFromSizes > 0 ? { qty: qtyFromSizes } : {}),
    delivery_method: String(draft.delivery_method ?? "").trim() || null,
    order_cost: parseMoneyInput(draft.order_cost),
    printing_cost: parseMoneyInput(draft.printing_cost),
    is_production_order: Boolean(draft.is_production_order),
    expected_handover_to_printing: draft.is_production_order
      ? String(draft.expected_handover_to_printing ?? "").trim() || null
      : null
  };
}

function hslToHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toLowerCase();
}

export const ORDER_COLOR_PALETTE = (() => {
  const pal = [];
  for (let c = 0; c < 8; c += 1) {
    const L = Math.round((c / 7) * 100);
    pal.push(hslToHex(0, 0, L));
  }
  for (let r = 1; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const hue = (c * 360) / 8;
      const sat = 52 + (r % 4) * 10;
      const light = 84 - (r - 1) * 10;
      pal.push(hslToHex(hue, Math.min(100, sat), Math.max(12, Math.min(92, light))));
    }
  }
  return pal;
})();

export function normalizeColorKey(c) {
  return String(c ?? "")
    .trim()
    .toLowerCase();
}

export function isCssColorString(c) {
  const t = String(c ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t) || /^rgb\(/i.test(t) || /^hsl\(/i.test(t);
}

export function newExtraSizeRow() {
  return {
    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    label: "",
    qty: ""
  };
}
