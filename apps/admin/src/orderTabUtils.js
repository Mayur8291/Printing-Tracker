import { isJobSheetOrder } from "./jobSheetUtils";
import { isSampleJobSheetOrder } from "./sampleJobSheetUtils";
import { sampleJobSheetIsClosed } from "./sampleJobSheetStages";

export const PAYMENT_METHODS = [
  { value: "paid", label: "Paid" },
  { value: "pi_sent_advance_received", label: "PI Sent Advance Received" },
  { value: "pi_sent_pending_payment", label: "PI sent pending for payment" }
];

/** Payment methods that require proof upload when creating an order. */
export const PAYMENT_METHODS_REQUIRING_PROOF = new Set(["paid", "pi_sent_advance_received"]);

export const DELIVERY_METHODS = [
  { value: "self_pickup", label: "Self Pickup" },
  { value: "porter", label: "Porter" },
  { value: "courier_service", label: "Courier service" }
];

export const PAYMENT_METHOD_LABEL = Object.fromEntries(
  PAYMENT_METHODS.map((o) => [o.value, o.label])
);

export const DELIVERY_METHOD_LABEL = Object.fromEntries(
  DELIVERY_METHODS.map((o) => [o.value, o.label])
);

export function paymentMethodLabel(value) {
  if (!value) return "—";
  return PAYMENT_METHOD_LABEL[value] ?? value;
}

export function paymentMethodRequiresProof(value) {
  return PAYMENT_METHODS_REQUIRING_PROOF.has(value);
}

/** Supports legacy single URL string or JSON array of URLs. */
export function parsePaymentProofUrls(value) {
  if (value == null || String(value).trim() === "") return [];
  const trimmed = String(value).trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((u) => String(u).trim()).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }
  return [trimmed];
}

export function serializePaymentProofUrls(urls) {
  const list = (urls ?? []).map((u) => String(u).trim()).filter(Boolean);
  if (!list.length) return null;
  return JSON.stringify(list);
}

export function deliveryMethodLabel(value) {
  if (!value) return "—";
  return DELIVERY_METHOD_LABEL[value] ?? value;
}

export const DISPATCH_ISSUE_TYPES = [
  { value: "count_mismatch", label: "Count mismatch" },
  { value: "product_mismatch", label: "Product mismatch" },
  { value: "color_mismatch", label: "Color Mismatch" }
];

export function dispatchIssueLabel(value) {
  if (!value) return "—";
  const row = DISPATCH_ISSUE_TYPES.find((o) => o.value === value);
  return row?.label ?? value;
}

/** Suggest issue type from first failed verification checkbox. */
export function suggestDispatchIssueType({ sizesQtyOk, productNameOk, colorsOk }) {
  if (!sizesQtyOk) return "count_mismatch";
  if (!productNameOk) return "product_mismatch";
  if (!colorsOk) return "color_mismatch";
  return "count_mismatch";
}

export function isProductionTrackerOrder(order) {
  return Boolean(order?.is_production_order) && !isSampleJobSheetOrder(order);
}

export function filterProductionTrackerOrders(orders, listTab = "active") {
  const wantComplete = listTab === "complete";
  return orders.filter(
    (o) => isProductionTrackerOrder(o) && Boolean(o.is_complete) === wantComplete
  );
}

/** Sampling Tracker — saved sample job sheets only (not Production Tracker or Printing). */
export function filterSampleJobSheetOrders(orders, listTab = "active") {
  const wantComplete = listTab === "complete";
  return orders.filter(
    (o) => isSampleJobSheetOrder(o) && sampleJobSheetIsClosed(o) === wantComplete
  );
}

/** Printing orders tab — excludes production tracker job sheets and sample job sheets. */
export function filterPrintingTabOrders(orders) {
  return orders.filter((o) => !isJobSheetOrder(o) && !isSampleJobSheetOrder(o));
}

/** Main Billing tab lists every order. Production tracker billing uses production job sheets only. */
export function filterBillingOrders(orders) {
  return orders;
}

/** Search orders by order number, customer name, or coordinator (case-insensitive). */
export function filterOrdersBySearch(orders, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return orders;
  return orders.filter((o) => {
    const orderId = String(o.order_id ?? "").toLowerCase();
    const customer = String(o.customer_name ?? "").toLowerCase();
    const coordinator = String(o.coordinator_name ?? "").toLowerCase();
    return orderId.includes(q) || customer.includes(q) || coordinator.includes(q);
  });
}

/** @deprecated Use filterOrdersBySearch */
export const filterBillingOrdersBySearch = filterOrdersBySearch;

export const DISPATCH_FAIL_STATUS = "dispatch_fail";
export const DISPATCHED_STATUS = "dispatched";

/**
 * match = every size matches the job and the color is confirmed (green).
 * short = a size is short, or the color is not confirmed (red).
 * extra = a size is over and nothing is short and the color matches (yellow).
 * issue = an older receipt that has a reason and no size counts.
 */
export function productReceiptSizeRows(order) {
  const breakdown = order?.size_breakdown;
  if (!breakdown || typeof breakdown !== "object") return [];
  const standard = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
  const rows = [];
  for (const key of standard) {
    const qty = Number(breakdown[key]);
    if (Number.isFinite(qty) && qty > 0) rows.push({ key, label: key, qty });
  }
  for (const [key, val] of Object.entries(breakdown)) {
    if (standard.includes(key)) continue;
    const qty = Number(val);
    if (Number.isFinite(qty) && qty > 0) rows.push({ key, label: key, qty });
  }
  return rows;
}

function wholeQty(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const qty = Number(text);
  if (!Number.isSafeInteger(qty) || qty > 2147483647) return null;
  return qty;
}

export function productReceiptReview(order, receivedSizes, options = {}) {
  const colorOk = options === true || options.colorOk === true;
  const productMismatch = options?.productMismatch === true;
  const noPicklist = options?.noPicklist === true;
  const jobRows = productReceiptSizeRows(order);
  const rows = jobRows.length
    ? jobRows
    : [{ key: "Total", label: "Total", qty: Number(order?.qty) }];
  const lines = rows.map((row) => {
    const job = Number.isFinite(row.qty) ? row.qty : 0;
    const received = wholeQty(receivedSizes?.[row.key]);
    let result = null;
    if (received !== null) {
      if (received === job) result = "match";
      else if (received > job) result = "extra";
      else result = "short";
    }
    return { ...row, job, received, result };
  });
  const incomplete =
    lines.some((line) => line.received === null) ||
    (jobRows.length === 0 && !Number.isFinite(Number(order?.qty)));
  const anyShort = lines.some((line) => line.result === "short");
  const anyExtra = lines.some((line) => line.result === "extra");
  let outcome = null;
  if (noPicklist) outcome = "rejected";
  else if (!incomplete && lines.every((line) => line.result)) {
    if (anyShort || !colorOk || productMismatch) outcome = "short";
    else if (anyExtra) outcome = "extra";
    else outcome = "match";
  }
  return { lines, outcome, anyShort, anyExtra, colorOk, productMismatch, noPicklist };
}

export function productReceiptHistoryText({ lines, colorOk, productMismatch, noPicklist, remark }) {
  const rows = [];
  if (noPicklist) rows.push("No picklist — rejected by printing");
  for (const line of lines || []) {
    if (line.received === null || line.received === undefined) continue;
    if (line.result === "short") {
      rows.push(`${line.label}: ${line.received} of ${line.job} — short ${line.job - line.received}`);
    } else if (line.result === "extra") {
      rows.push(`${line.label}: ${line.received} of ${line.job} — extra ${line.received - line.job}`);
    } else {
      rows.push(`${line.label}: ${line.received} of ${line.job}`);
    }
  }
  if (colorOk === false) rows.push("Color issue");
  else if (colorOk === true) rows.push("Color matches");
  if (productMismatch) rows.push("Product mismatch");
  const note = String(remark ?? "").trim();
  if (note) rows.push(`Remark: ${note}`);
  return rows.join("\n");
}

export function productReceiptSummary(order) {
  if (order?.product_received_sizes && typeof order.product_received_sizes === "object") {
    const review = productReceiptReview(order, order.product_received_sizes, {
      colorOk: order.product_received_color_ok === true,
      productMismatch: order.product_received_product_ok === false,
      noPicklist: order.product_received_no_picklist === true
    });
    const text = productReceiptHistoryText({
      lines: review.lines,
      colorOk: order.product_received_color_ok,
      productMismatch: order.product_received_product_ok === false,
      noPicklist: order.product_received_no_picklist === true,
      remark: order.product_received_issue
    });
    if (text) return text;
  }
  const got = order?.product_received_qty;
  const job = order?.qty;
  if (got === null || got === undefined || got === "") return "";
  const received = Number(got);
  const expected = Number(job);
  if (!Number.isFinite(received)) return "";
  if (!Number.isFinite(expected)) return `Received ${received}`;
  if (received === expected) return `Received ${received} of ${expected}`;
  if (received > expected) return `Received ${received} of ${expected} — extra ${received - expected}`;
  return `Received ${received} of ${expected} — short ${expected - received}`;
}

export function productReceiptState(order) {
  if (!order?.product_received_at) return "missing";
  if (order.product_received_no_picklist === true) return "rejected";
  if (order.product_received_sizes && typeof order.product_received_sizes === "object") {
    const colorKnown =
      order.product_received_color_ok === true || order.product_received_color_ok === false;
    const review = productReceiptReview(order, order.product_received_sizes, {
      colorOk: colorKnown ? order.product_received_color_ok === true : true,
      productMismatch: order.product_received_product_ok === false,
      noPicklist: false
    });
    if (review.outcome) return review.outcome;
  }
  if (
    order.product_received_qty !== null &&
    order.product_received_qty !== undefined &&
    order.product_received_qty !== ""
  ) {
    const received = Number(order.product_received_qty);
    const job = Number(order.qty);
    if (Number.isFinite(received) && Number.isFinite(job)) {
      if (received === job) return "match";
      if (received > job) return "extra";
      return "short";
    }
  }
  if (String(order.product_received_issue ?? "").trim()) return "issue";
  return "match";
}

export function isDispatchVerificationFailed(order) {
  if (!order) return false;
  return (
    order.status === DISPATCH_FAIL_STATUS || Boolean(order.dispatch_verification_failed)
  );
}

export function dispatchRowHighlightClass(order) {
  return isDispatchVerificationFailed(order) ? "dispatch-row--failed" : "";
}

export function filterDispatchActiveOrders(orders) {
  return orders.filter((o) => {
    if (o.is_complete) return false;
    if (o.status === DISPATCHED_STATUS) return false;
    return Boolean(o.delivery_method) || o.status === DISPATCH_FAIL_STATUS;
  });
}

export function filterDispatchProcessedOrders(orders) {
  return orders.filter((o) => o.status === DISPATCHED_STATUS);
}

export function filterDispatchOrders(orders) {
  return orders.filter((o) => {
    if (o.is_complete) return false;
    return (
      Boolean(o.delivery_method) ||
      o.status === DISPATCH_FAIL_STATUS ||
      o.status === DISPATCHED_STATUS
    );
  });
}

export function sortOrdersNewestFirst(orders) {
  return [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/** Active jobs on the printing floor (excludes new/approval and dispatch-complete stages). */
const PRINTING_DEPARTMENT_STATUSES = new Set([
  "in_production",
  "printing",
  "fusing",
  "ironing",
  "packing",
  "pending"
]);

export function filterPrintingDepartmentOrders(orders) {
  return orders.filter(
    (o) =>
      !o.is_complete &&
      !isJobSheetOrder(o) &&
      !isSampleJobSheetOrder(o) &&
      PRINTING_DEPARTMENT_STATUSES.has(o.status ?? "")
  );
}

function dueDateSortKey(dueDate) {
  if (!dueDate) return Number.MAX_SAFE_INTEGER;
  const t = new Date(`${dueDate}T00:00:00`).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function createdAtSortKey(createdAt) {
  const t = new Date(createdAt).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * Printing queue priority: earliest delivery date first; same delivery day → order placed first (created_at).
 */
export function sortOrdersByPrintingPriority(orders) {
  return [...orders].sort((a, b) => {
    const dueDiff = dueDateSortKey(a.due_date) - dueDateSortKey(b.due_date);
    if (dueDiff !== 0) return dueDiff;
    const placedDiff = createdAtSortKey(a.created_at) - createdAtSortKey(b.created_at);
    if (placedDiff !== 0) return placedDiff;
    return String(a.order_id ?? a.id).localeCompare(String(b.order_id ?? b.id), undefined, {
      numeric: true
    });
  });
}

/** Urgency label for priority queue UI (delivery date vs today). */
export function printingPriorityUrgency(dueDate) {
  if (!dueDate) return "none";
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return "upcoming";
}

export function filterOrdersInDateRange(orders, dateFrom, dateTo) {
  return orders.filter((order) => {
    const orderDate = order.order_date;
    if (!dateFrom && !dateTo) return true;
    if (!orderDate) return false;
    if (dateFrom && orderDate < dateFrom) return false;
    if (dateTo && orderDate > dateTo) return false;
    return true;
  });
}
