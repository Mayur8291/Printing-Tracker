import {
  calcJobSheetBalanceAmount,
  calcJobSheetPendingAmount,
  calcJobSheetTotalAmount,
  parseJobSheetMoney
} from "./jobSheetPaymentUtils";

export function isJobSheetOrderRow(order) {
  if ((order?.order_kind ?? "printing") === "job_sheet") return true;
  if (!order?.is_production_order) return false;
  return Boolean(
    String(order?.sales_incharge_name ?? order?.coordinator_name ?? "").trim() ||
      order?.job_sheet_payment_mode ||
      order?.rate_per_piece != null
  );
}

export function mergeJobSheetIntoAdminDraft(order) {
  if (!isJobSheetOrderRow(order)) {
    return { isJobSheetRow: false };
  }
  return {
    isJobSheetRow: true,
    rate_per_piece:
      order?.rate_per_piece != null && order?.rate_per_piece !== ""
        ? String(order.rate_per_piece)
        : "",
    job_sheet_payment_mode: String(order?.job_sheet_payment_mode ?? "").trim(),
    job_sheet_advance_amount:
      order?.job_sheet_advance_amount != null && order?.job_sheet_advance_amount !== ""
        ? String(order.job_sheet_advance_amount)
        : "",
    job_sheet_advance_payment_date: String(order?.job_sheet_advance_payment_date ?? "").trim(),
    job_sheet_full_paid: Boolean(order?.job_sheet_full_paid),
    job_sheet_payment_closure_at: order?.job_sheet_payment_closure_at
      ? String(order.job_sheet_payment_closure_at)
      : "",
    job_sheet_delivery_city: String(order?.job_sheet_delivery_city ?? "").trim(),
    job_sheet_transport_charges:
      order?.job_sheet_transport_charges != null && order?.job_sheet_transport_charges !== ""
        ? String(order.job_sheet_transport_charges)
        : "",
    job_sheet_approval_date: String(order?.job_sheet_approval_date ?? "").trim(),
    job_sheet_approved_by: String(order?.job_sheet_approved_by ?? "").trim()
  };
}

export function buildJobSheetAdminPayload(draft, orderRow = {}) {
  const qty =
    typeof orderRow?.qty === "number" && Number.isFinite(orderRow.qty) && orderRow.qty > 0
      ? orderRow.qty
      : 0;
  const rate = parseJobSheetMoney(draft.rate_per_piece);
  const computedTotal =
    rate != null && qty > 0 ? calcJobSheetTotalAmount(draft.rate_per_piece, qty) : null;
  const orderCost =
    computedTotal ??
    parseJobSheetMoney(draft.order_cost) ??
    parseJobSheetMoney(orderRow?.order_cost);

  const advanceAmount = parseJobSheetMoney(draft.job_sheet_advance_amount);
  const fullPaid = Boolean(draft.job_sheet_full_paid);
  const balanceAmount =
    orderCost != null
      ? calcJobSheetBalanceAmount(orderCost, advanceAmount ?? 0)
      : calcJobSheetBalanceAmount(
          orderRow?.order_cost ?? 0,
          advanceAmount ?? 0
        );
  const pendingAmount =
    orderCost != null
      ? calcJobSheetPendingAmount(orderCost, advanceAmount ?? 0, fullPaid)
      : calcJobSheetPendingAmount(orderRow?.order_cost ?? 0, advanceAmount ?? 0, fullPaid);

  let paymentClosureAt =
    String(draft.job_sheet_payment_closure_at ?? "").trim() ||
    orderRow?.job_sheet_payment_closure_at ||
    null;
  if (fullPaid && !paymentClosureAt) {
    paymentClosureAt = new Date().toISOString();
  }
  if (!fullPaid) {
    paymentClosureAt = null;
  }

  const payload = {
    job_sheet_payment_mode: String(draft.job_sheet_payment_mode ?? "").trim() || null,
    job_sheet_advance_amount: advanceAmount,
    job_sheet_advance_payment_date:
      String(draft.job_sheet_advance_payment_date ?? "").trim() || null,
    job_sheet_balance_amount: balanceAmount,
    job_sheet_pending_amount: pendingAmount,
    job_sheet_full_paid: fullPaid,
    job_sheet_payment_closure_at: paymentClosureAt,
    job_sheet_delivery_city: String(draft.job_sheet_delivery_city ?? "").trim() || null,
    job_sheet_transport_charges: parseJobSheetMoney(draft.job_sheet_transport_charges),
    job_sheet_approval_date: String(draft.job_sheet_approval_date ?? "").trim() || null,
    job_sheet_approved_by: String(draft.job_sheet_approved_by ?? "").trim() || null
  };

  if (rate != null) {
    payload.rate_per_piece = rate;
  }
  if (orderCost != null) {
    payload.order_cost = orderCost;
  }

  return payload;
}
