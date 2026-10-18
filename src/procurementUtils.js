import { supabase } from "./supabaseClient";

/**
 * Step 2 procurement (One Source of Truth) — read helpers + RPC wrappers.
 * Drafting (PO, GRN, bill headers/lines) uses admin RLS writes; everything
 * that moves stock or money (approve, post GRN, QC, approve bill, payments)
 * goes through the SECURITY DEFINER functions. Never writes ap_payment directly.
 */

export const PO_STATUS_LABEL = {
  draft: "Draft",
  approved: "Approved",
  partially_received: "Partially received",
  fulfilled: "Fulfilled",
  closed: "Closed",
  short_closed: "Short closed",
  cancelled: "Cancelled"
};

export const BILL_STATUS_LABEL = {
  draft: "Draft",
  approved: "Approved",
  cancelled: "Cancelled"
};

export const PAYMENT_MODES = ["bank", "upi", "cash", "cheque", "adjustment"];

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchPurchaseOrders() {
  const { data, error } = await supabase
    .from("po_purchase_order")
    .select(
      "id, po_no, status, status_reason, order_date, expected_date, credit_days, note, created_at, " +
        "vendor:crm_party ( id, legal_name ), entity:core_entity ( id, code, legal_name ), " +
        "location:core_location ( id, code, name ), " +
        "po_line ( id, sku_id, qty_ordered, rate, tax_pct, qty_received, qty_rejected, qty_cancelled, cat_sku ( sku_code ) )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

/** Posted + draft GRNs for one PO's lines (keyed by po_line ids). */
export async function fetchGrnsForPoLines(poLineIds) {
  if (!poLineIds.length) return [];
  const { data, error } = await supabase
    .from("po_grn_line")
    .select(
      "id, grn_id, po_line_id, qty, qc_required, qty_qc_pass, qty_qc_fail, qc_note, " +
        "po_grn ( id, grn_no, status, received_date, location_id )"
    )
    .in("po_line_id", poLineIds);
  if (error) throw error;
  return data ?? [];
}

export async function fetchBills() {
  const { data, error } = await supabase
    .from("ap_bill")
    .select(
      "id, bill_no, bill_date, credit_days, due_date, msme_capped, subtotal, tax_amount, total, " +
        "match_status, override_reason, note, status, created_at, " +
        "vendor:crm_party ( id, legal_name, msme_category ), entity:core_entity ( id, code ), " +
        "ap_bill_line ( id, grn_line_id, qty, rate, tax_pct )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function fetchOutstandingBills() {
  const { data, error } = await supabase
    .from("ap_bill_outstanding_view")
    .select("*")
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchVendorLedger() {
  const { data, error } = await supabase
    .from("ap_vendor_ledger_view")
    .select("*")
    .order("balance", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPayments() {
  const { data, error } = await supabase
    .from("ap_payment")
    .select(
      "id, amount, paid_on, mode, utr, note, created_at, vendor:crm_party ( id, legal_name ), " +
        "ap_payment_allocation ( id, bill_id, amount )"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchDebitNotes() {
  const { data, error } = await supabase
    .from("ap_debit_note")
    .select("id, note_date, amount, reason, status, bill_id, grn_id, vendor:crm_party ( id, legal_name )")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchPoSettings() {
  const { data, error } = await supabase.from("po_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Posted GRN lines of one vendor that are not on any bill yet — the pick list
 * for "Record bill". One bill line per GRN line (enforced by a unique index).
 */
export async function fetchUnbilledGrnLines(vendorId) {
  const { data: grnLines, error } = await supabase
    .from("po_grn_line")
    .select(
      "id, qty, qty_qc_fail, po_grn!inner ( id, grn_no, status, vendor_id, received_date ), " +
        "po_line ( id, rate, tax_pct, cat_sku ( sku_code ) )"
    )
    .eq("po_grn.vendor_id", vendorId)
    .eq("po_grn.status", "posted");
  if (error) throw error;
  const lines = grnLines ?? [];
  if (!lines.length) return [];

  const { data: billed, error: billedErr } = await supabase
    .from("ap_bill_line")
    .select("grn_line_id")
    .in("grn_line_id", lines.map((l) => l.id));
  if (billedErr) throw billedErr;
  const billedSet = new Set((billed ?? []).map((b) => b.grn_line_id));
  return lines.filter((l) => !billedSet.has(l.id));
}

// ---------------------------------------------------------------------------
// Drafting writes (admin RLS)
// ---------------------------------------------------------------------------

export async function createDraftPo({ entityId, vendorId, deliveryLocationId, orderDate, expectedDate, creditDays, note, lines }) {
  const { data: po, error } = await supabase
    .from("po_purchase_order")
    .insert({
      entity_id: entityId,
      vendor_id: vendorId,
      delivery_location_id: deliveryLocationId,
      order_date: orderDate,
      expected_date: expectedDate || null,
      credit_days: creditDays ?? 0,
      note: note || null
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: lineError } = await supabase.from("po_line").insert(
    lines.map((l) => ({
      po_id: po.id,
      sku_id: l.skuId,
      qty_ordered: l.qty,
      rate: l.rate,
      tax_pct: l.taxPct ?? 0
    }))
  );
  if (lineError) {
    // Draft header without lines is useless — clean it up (draft delete is allowed).
    await supabase.from("po_purchase_order").delete().eq("id", po.id);
    throw lineError;
  }
  return po.id;
}

/** Create a draft GRN + lines, then post it in one go through the DB function. */
export async function receiveGrn({ entityId, vendorId, locationId, receivedDate, lrNo, transporter, note, lines }) {
  const { data: grn, error } = await supabase
    .from("po_grn")
    .insert({
      entity_id: entityId,
      vendor_id: vendorId,
      location_id: locationId,
      received_date: receivedDate,
      lr_no: lrNo || null,
      transporter: transporter || null,
      note: note || null
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: lineError } = await supabase.from("po_grn_line").insert(
    lines.map((l) => ({ grn_id: grn.id, po_line_id: l.poLineId, qty: l.qty }))
  );
  if (lineError) {
    await supabase.from("po_grn").delete().eq("id", grn.id);
    throw lineError;
  }

  const { data: grnNo, error: postError } = await supabase.rpc("po_post_grn", { p_grn_id: grn.id });
  if (postError) {
    // Posting failed (tolerance, PO state…) — remove the draft so it doesn't linger.
    await supabase.from("po_grn").delete().eq("id", grn.id);
    throw postError;
  }
  return grnNo;
}

export async function createDraftBill({ vendorId, entityId, billNo, billDate, creditDays, note, lines }) {
  const { data: bill, error } = await supabase
    .from("ap_bill")
    .insert({
      vendor_id: vendorId,
      entity_id: entityId,
      bill_no: billNo,
      bill_date: billDate,
      credit_days: creditDays ?? null,
      note: note || null
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: lineError } = await supabase.from("ap_bill_line").insert(
    lines.map((l) => ({
      bill_id: bill.id,
      grn_line_id: l.grnLineId,
      qty: l.qty,
      rate: l.rate,
      tax_pct: l.taxPct ?? 0
    }))
  );
  if (lineError) {
    await supabase.from("ap_bill").delete().eq("id", bill.id);
    throw lineError;
  }
  return bill.id;
}

export async function createDebitNote({ vendorId, entityId, billId, grnId, amount, reason }) {
  const { error } = await supabase.from("ap_debit_note").insert({
    vendor_id: vendorId,
    entity_id: entityId,
    bill_id: billId || null,
    grn_id: grnId || null,
    amount,
    reason
  });
  if (error) throw error;
}

export async function savePoSettings({ overReceiptPct, rateVariancePct, msmeDueCapDays, userId }) {
  const { error } = await supabase
    .from("po_settings")
    .update({
      over_receipt_tolerance_pct: overReceiptPct,
      rate_variance_tolerance_pct: rateVariancePct,
      msme_due_cap_days: msmeDueCapDays,
      updated_by: userId ?? null
    })
    .eq("id", 1);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// State-machine RPCs (SECURITY DEFINER functions)
// ---------------------------------------------------------------------------

export async function approvePo(poId) {
  const { data, error } = await supabase.rpc("po_approve", { p_po_id: poId });
  if (error) throw error;
  return data; // the assigned PO number
}

export async function cancelPo(poId, reason) {
  const { error } = await supabase.rpc("po_cancel", { p_po_id: poId, p_reason: reason });
  if (error) throw error;
}

export async function shortClosePo(poId, reason) {
  const { error } = await supabase.rpc("po_short_close", { p_po_id: poId, p_reason: reason });
  if (error) throw error;
}

export async function closePo(poId) {
  const { error } = await supabase.rpc("po_close", { p_po_id: poId });
  if (error) throw error;
}

export async function recordQc({ grnLineId, qtyPass, qtyFail, note }) {
  const { error } = await supabase.rpc("po_record_qc", {
    p_grn_line_id: grnLineId,
    p_qty_pass: qtyPass || 0,
    p_qty_fail: qtyFail || 0,
    p_note: note || null
  });
  if (error) throw error;
}

export async function approveBill(billId, overrideReason) {
  const { error } = await supabase.rpc("ap_approve_bill", {
    p_bill_id: billId,
    p_override_reason: overrideReason || null
  });
  if (error) throw error;
}

export async function cancelBill(billId, reason) {
  const { error } = await supabase.rpc("ap_cancel_bill", { p_bill_id: billId, p_reason: reason });
  if (error) throw error;
}

export async function recordPayment({ vendorId, entityId, amount, paidOn, mode, utr, note, allocations }) {
  const { data, error } = await supabase.rpc("ap_record_payment", {
    p_vendor_id: vendorId,
    p_entity_id: entityId,
    p_amount: amount,
    p_paid_on: paidOn,
    p_mode: mode,
    p_utr: utr || null,
    p_note: note || null,
    p_allocations: (allocations ?? []).map((a) => ({ bill_id: a.billId, amount: a.amount }))
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatMoney(value) {
  const n = Number(value ?? 0);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function poLinePending(line) {
  return Number(line.qty_ordered) - Number(line.qty_received) - Number(line.qty_cancelled);
}
