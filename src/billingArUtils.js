import { supabase } from "./supabaseClient";

/**
 * Step 4 billing + receivables (One Source of Truth) — read helpers + RPC
 * wrappers. Invoices, credit notes, receipts and allocations are NEVER
 * written directly: the SECURITY DEFINER functions are the only doors and
 * the documents are immutable once numbered. Only ar_followup (a working
 * document) uses admin RLS writes.
 */

export const AR_MODES = ["bank", "upi", "cash", "cheque", "adjustment"];

export const AR_BUCKETS = ["NOT_DUE", "0-30", "31-60", "61-90", "90+", "PAID"];

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchInvoices() {
  const { data, error } = await supabase
    .from("bill_invoice")
    .select(
      "id, invoice_no, invoice_date, due_date, place_of_supply, intra_state, credit_days, " +
        "subtotal, igst_amount, cgst_amount, sgst_amount, total, note, owner, created_at, " +
        "customer:crm_party ( id, legal_name ), entity:core_entity ( id, code ), " +
        "gstin:core_gstin ( id, gstin ), so_order ( id, so_no ), so_dispatch ( id, dispatch_no ), " +
        "bill_invoice_line ( id, qty, rate, taxable_value, gst_rate, igst, cgst, sgst, line_total, hsn, cat_sku ( sku_code ) )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

/** Dispatches that have no invoice yet — the pick list for Generate invoice. */
export async function fetchUninvoicedDispatches() {
  const { data: dispatches, error } = await supabase
    .from("so_dispatch")
    .select(
      "id, dispatch_no, dispatch_date, so_order ( id, so_no, entity_id, customer:crm_party ( id, legal_name ) ), " +
        "so_dispatch_line ( id, qty )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const rows = dispatches ?? [];
  if (!rows.length) return [];

  const { data: invoiced, error: invErr } = await supabase
    .from("bill_invoice")
    .select("dispatch_id")
    .in("dispatch_id", rows.map((d) => d.id));
  if (invErr) throw invErr;
  const done = new Set((invoiced ?? []).map((i) => i.dispatch_id));
  return rows.filter((d) => !done.has(d.id));
}

export async function fetchCreditNotes() {
  const { data, error } = await supabase
    .from("bill_credit_note")
    .select(
      "id, cn_no, note_date, amount, reason, created_at, " +
        "customer:crm_party ( id, legal_name ), bill_invoice ( id, invoice_no )"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchReceipts() {
  const { data, error } = await supabase
    .from("ar_receipt")
    .select(
      "id, receipt_no, amount, received_on, mode, utr, note, created_at, " +
        "customer:crm_party ( id, legal_name ), entity:core_entity ( id, code ), " +
        "ar_allocation ( id, invoice_id, amount )"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchOutstandingInvoices() {
  const { data, error } = await supabase
    .from("ar_invoice_outstanding_view")
    .select("*")
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchArCustomerLedger() {
  const { data, error } = await supabase
    .from("ar_customer_ledger_view")
    .select("*")
    .order("balance", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchFollowups() {
  const { data, error } = await supabase
    .from("ar_followup")
    .select(
      "id, next_date, note, outcome, status, owner, created_at, " +
        "customer:crm_party ( id, legal_name ), bill_invoice ( id, invoice_no )"
    )
    .order("next_date", { ascending: true })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// RPCs (SECURITY DEFINER functions)
// ---------------------------------------------------------------------------

export async function generateInvoice({ dispatchId, gstinId, placeOfSupply, invoiceDate, note }) {
  const { data, error } = await supabase.rpc("bill_generate_from_dispatch", {
    p_dispatch_id: dispatchId,
    p_gstin_id: gstinId,
    p_place_of_supply: placeOfSupply || null,
    p_invoice_date: invoiceDate,
    p_owner: null,
    p_note: note || null
  });
  if (error) throw error;
  return data; // the invoice number
}

export async function issueCreditNote({ invoiceId, amount, reason, noteDate }) {
  const { data, error } = await supabase.rpc("ar_issue_credit_note", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_reason: reason,
    p_note_date: noteDate
  });
  if (error) throw error;
  return data; // the credit-note number
}

export async function recordReceipt({ customerId, entityId, amount, receivedOn, mode, utr, note, allocations }) {
  const { data, error } = await supabase.rpc("ar_record_receipt", {
    p_customer_id: customerId,
    p_entity_id: entityId,
    p_amount: amount,
    p_received_on: receivedOn,
    p_mode: mode,
    p_utr: utr || null,
    p_note: note || null,
    p_allocations: (allocations ?? []).map((a) => ({ invoice_id: a.invoiceId, amount: a.amount }))
  });
  if (error) throw error;
  return data; // the receipt number
}

/** Soft credit check: { credit_limit, outstanding, over_limit, oldest_overdue_days }. */
export async function creditCheck(customerId) {
  const { data, error } = await supabase.rpc("ar_credit_check", { p_customer_id: customerId });
  if (error) throw error;
  return data ?? {};
}

// ---------------------------------------------------------------------------
// Follow-ups (admin RLS writes — working documents)
// ---------------------------------------------------------------------------

export async function createFollowup({ customerId, invoiceId, nextDate, note }) {
  const { error } = await supabase.from("ar_followup").insert({
    customer_id: customerId,
    invoice_id: invoiceId || null,
    next_date: nextDate,
    note: note || null
  });
  if (error) throw error;
}

export async function closeFollowup(followupId, outcome) {
  const { error } = await supabase
    .from("ar_followup")
    .update({ status: "done", outcome: outcome || null })
    .eq("id", followupId);
  if (error) throw error;
}
