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

export function filterProductionTrackerOrders(orders) {
  return orders.filter((o) => !o.is_complete && Boolean(o.is_production_order));
}

/** Billing tab lists all orders (date range still applied in App). */
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
  "pending",
  "on_hold"
]);

export function filterPrintingDepartmentOrders(orders) {
  return orders.filter(
    (o) => !o.is_complete && PRINTING_DEPARTMENT_STATUSES.has(o.status ?? "")
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
