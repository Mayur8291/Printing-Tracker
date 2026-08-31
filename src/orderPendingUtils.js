function newClientKey() {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createPendingPrintingOrder({
  orderId,
  customerName,
  productName,
  coordinatorName,
  dueDate,
  qty,
  status = "new",
  orderKind = "printing"
}) {
  return {
    clientKey: newClientKey(),
    id: null,
    _isPending: true,
    targetTab: "printing",
    order_id: orderId || null,
    customer_name: customerName || "—",
    product_name: productName || "—",
    coordinator_name: coordinatorName || "—",
    due_date: dueDate || null,
    qty: qty ?? 0,
    status,
    order_kind: orderKind
  };
}

export function createPendingProductionOrder({
  orderId,
  customerName,
  productName,
  coordinatorName,
  dueDate,
  qty,
  handoverDate
}) {
  return {
    clientKey: newClientKey(),
    id: null,
    _isPending: true,
    targetTab: "production_tracker",
    order_id: orderId || null,
    customer_name: customerName || "—",
    product_name: productName || "—",
    coordinator_name: coordinatorName || "—",
    due_date: dueDate || null,
    expected_handover_to_printing: handoverDate || null,
    qty: qty ?? 0,
    status: "quotation_approval",
    order_kind: "job_sheet",
    is_production_order: true
  };
}

export function createPendingSampleJobSheet({
  orderId,
  customerName,
  productName,
  coordinatorName,
  orderDate,
  dueDate,
  qty
}) {
  return {
    clientKey: newClientKey(),
    id: null,
    _isPending: true,
    targetTab: "sampling_tracker",
    order_id: orderId || null,
    customer_name: customerName || "—",
    product_name: productName || "—",
    coordinator_name: coordinatorName || "—",
    order_date: orderDate || null,
    due_date: dueDate || null,
    created_at: new Date().toISOString(),
    qty: qty ?? 0,
    status: "pattern_making",
    order_kind: "sample_job_sheet",
    is_production_order: false
  };
}

export function orderMatchesPending(realOrder, pending) {
  if (!realOrder || !pending) return false;
  const realOrderId = String(realOrder.order_id ?? "").trim();
  const pendingOrderId = String(pending.order_id ?? "").trim();
  if (realOrderId && pendingOrderId && realOrderId === pendingOrderId) return true;
  if (
    String(realOrder.customer_name ?? "").trim() === String(pending.customer_name ?? "").trim() &&
    String(realOrder.product_name ?? "").trim() === String(pending.product_name ?? "").trim() &&
    Number(realOrder.qty) === Number(pending.qty)
  ) {
    return true;
  }
  return false;
}

export function mergePendingOrders(pendingOrders, realOrders, targetTab) {
  const tabPending = pendingOrders.filter((p) => p.targetTab === targetTab);
  const visiblePending = tabPending.filter(
    (pending) => !realOrders.some((order) => orderMatchesPending(order, pending))
  );
  return [...visiblePending, ...realOrders];
}
