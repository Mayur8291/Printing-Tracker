import { supabase } from "./supabaseClient";

/**
 * Step 3 sales orders (One Source of Truth) — read helpers + RPC wrappers.
 * Drafting (order/job headers + lines) uses admin RLS writes; everything that
 * numbers a document, reserves or moves stock (confirm, allocate, status,
 * dispatch, job issue/receive) goes through SECURITY DEFINER functions.
 * so_dispatch is never written directly — so_post_dispatch is the only door.
 */

export const SO_STATUS_LABEL = {
  draft: "Draft",
  confirmed: "Confirmed",
  in_production: "In production",
  ready: "Ready",
  partially_dispatched: "Partially dispatched",
  dispatched: "Dispatched",
  invoiced: "Invoiced",
  closed: "Closed",
  cancelled: "Cancelled"
};

export const SO_CHANNELS = [
  { value: "b2b", label: "B2B" },
  { value: "counter", label: "Counter sale" },
  { value: "distributor", label: "Distributor" },
  { value: "enquiry", label: "Enquiry" },
  { value: "ecom_uniware", label: "Ecom (Uniware)" }
];

export const JW_KINDS = ["printing", "embroidery", "sublimation", "stitching", "other"];

export const JW_STATUS_LABEL = {
  draft: "Draft",
  issued: "Issued",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled"
};

export const SLA_STAGES = [
  { value: "confirm_to_production", label: "Confirm → production start" },
  { value: "production_to_ready", label: "Production → ready" },
  { value: "ready_to_dispatch", label: "Ready → dispatch" }
];

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchSalesOrders() {
  const { data, error } = await supabase
    .from("so_order")
    .select(
      "id, so_no, status, status_reason, channel, order_date, promised_date, price_list, branding, note, " +
        "confirmed_at, production_started_at, ready_at, dispatched_at, created_at, " +
        "customer:crm_party ( id, legal_name ), entity:core_entity ( id, code, legal_name ), " +
        "location:core_location ( id, code, name ), " +
        "so_line ( id, sku_id, qty, rate, tax_pct, qty_reserved, qty_dispatched, cat_sku ( sku_code ) )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function fetchDispatches() {
  const { data, error } = await supabase
    .from("so_dispatch")
    .select(
      "id, dispatch_no, dispatch_date, transporter, lr_no, boxes, weight_kg, eway_bill_no, note, created_at, " +
        "so_order ( id, so_no, channel, customer:crm_party ( id, legal_name ) ), " +
        "so_dispatch_line ( id, qty, so_line ( id, cat_sku ( sku_code ) ) )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function fetchJobs() {
  const { data, error } = await supabase
    .from("jw_job")
    .select(
      "id, job_no, kind, in_house, status, expected_date, note, issued_at, received_at, created_at, " +
        "worker:crm_party ( id, legal_name ), entity:core_entity ( id, code ), " +
        "location:core_location!jw_job_location_id_fkey ( id, code, name ), " +
        "worker_location:core_location!jw_job_worker_location_id_fkey ( id, code, name ), " +
        "jw_job_line ( id, direction, sku_id, qty_planned, qty_moved, cat_sku ( sku_code ) )"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchSlaPolicies() {
  const { data, error } = await supabase
    .from("sla_policy")
    .select("*")
    .order("channel")
    .order("stage");
  if (error) throw error;
  return data ?? [];
}

/** Every order × stage measured against its target; the panel filters breaches. */
export async function fetchSlaRows() {
  const { data, error } = await supabase
    .from("so_sla_view")
    .select("*")
    .order("elapsed_hours", { ascending: false })
    .limit(400);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Drafting writes (admin RLS)
// ---------------------------------------------------------------------------

export async function createDraftSo({
  entityId,
  customerId,
  channel,
  locationId,
  orderDate,
  promisedDate,
  priceList,
  branding,
  note,
  lines
}) {
  const { data: so, error } = await supabase
    .from("so_order")
    .insert({
      entity_id: entityId,
      customer_id: customerId,
      channel,
      location_id: locationId,
      order_date: orderDate,
      promised_date: promisedDate || null,
      price_list: priceList || null,
      branding: Boolean(branding),
      note: note || null
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: lineError } = await supabase.from("so_line").insert(
    lines.map((l) => ({
      so_id: so.id,
      sku_id: l.skuId,
      qty: l.qty,
      rate: l.rate,
      tax_pct: l.taxPct ?? 0
    }))
  );
  if (lineError) {
    // Draft header without lines is useless — clean it up (draft delete allowed).
    await supabase.from("so_order").delete().eq("id", so.id);
    throw lineError;
  }
  return so.id;
}

export async function createDraftJob({
  entityId,
  kind,
  workerPartyId,
  inHouse,
  soId,
  locationId,
  workerLocationId,
  expectedDate,
  note,
  inputs,
  outputs
}) {
  const { data: job, error } = await supabase
    .from("jw_job")
    .insert({
      entity_id: entityId,
      kind,
      worker_party_id: workerPartyId || null,
      in_house: Boolean(inHouse),
      so_id: soId || null,
      location_id: locationId,
      worker_location_id: workerLocationId,
      expected_date: expectedDate || null,
      note: note || null
    })
    .select("id")
    .single();
  if (error) throw error;

  const lines = [
    ...inputs.map((l) => ({ job_id: job.id, direction: "input", sku_id: l.skuId, qty_planned: l.qty })),
    ...outputs.map((l) => ({ job_id: job.id, direction: "output", sku_id: l.skuId, qty_planned: l.qty }))
  ];
  const { error: lineError } = await supabase.from("jw_job_line").insert(lines);
  if (lineError) {
    await supabase.from("jw_job").delete().eq("id", job.id);
    throw lineError;
  }
  return job.id;
}

export async function saveSlaPolicy({ channel, stage, targetHours, isActive }) {
  const { error } = await supabase
    .from("sla_policy")
    .upsert(
      { channel, stage, target_hours: targetHours, is_active: isActive ?? true },
      { onConflict: "channel,stage" }
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// State-machine RPCs (SECURITY DEFINER functions)
// ---------------------------------------------------------------------------

export async function confirmSo(soId) {
  const { data, error } = await supabase.rpc("so_confirm", { p_so_id: soId });
  if (error) throw error;
  return data; // the assigned SO number
}

/** Top up reservations after production / new stock; returns qty newly reserved. */
export async function allocateSo(soId) {
  const { data, error } = await supabase.rpc("so_allocate", { p_so_id: soId });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function setSoStatus(soId, status, reason) {
  const { error } = await supabase.rpc("so_set_status", {
    p_so_id: soId,
    p_status: status,
    p_reason: reason || null
  });
  if (error) throw error;
}

export async function cancelSo(soId, reason) {
  const { error } = await supabase.rpc("so_cancel", { p_so_id: soId, p_reason: reason });
  if (error) throw error;
}

export async function postDispatch({
  soId,
  lines,
  dispatchDate,
  transporter,
  lrNo,
  boxes,
  weightKg,
  ewayBillNo,
  note
}) {
  const { data, error } = await supabase.rpc("so_post_dispatch", {
    p_so_id: soId,
    p_lines: lines.map((l) => ({ so_line_id: l.soLineId, qty: l.qty })),
    p_dispatch_date: dispatchDate,
    p_transporter: transporter || null,
    p_lr_no: lrNo || null,
    p_boxes: boxes ?? null,
    p_weight_kg: weightKg ?? null,
    p_eway_bill_no: ewayBillNo || null,
    p_note: note || null
  });
  if (error) throw error;
  return data; // the dispatch number
}

export async function issueJob(jobId) {
  const { data, error } = await supabase.rpc("jw_issue", { p_job_id: jobId });
  if (error) throw error;
  return data; // the job number
}

export async function receiveJob({ jobId, outputs, consumed, note }) {
  const { error } = await supabase.rpc("jw_receive", {
    p_job_id: jobId,
    p_outputs: outputs.map((l) => ({ sku_id: l.skuId, qty: l.qty })),
    p_consumed: (consumed ?? []).map((l) => ({ sku_id: l.skuId, qty: l.qty })),
    p_note: note || null
  });
  if (error) throw error;
}

export async function closeJob(jobId, note) {
  const { error } = await supabase.rpc("jw_close", { p_job_id: jobId, p_note: note || null });
  if (error) throw error;
}

export async function cancelJob(jobId, reason) {
  const { error } = await supabase.rpc("jw_cancel", { p_job_id: jobId, p_reason: reason });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function orderTotals(order) {
  const lines = order.so_line ?? [];
  let qty = 0;
  let reserved = 0;
  let dispatched = 0;
  let value = 0;
  for (const l of lines) {
    qty += Number(l.qty);
    reserved += Number(l.qty_reserved);
    dispatched += Number(l.qty_dispatched);
    value += Number(l.qty) * Number(l.rate);
  }
  return { qty, reserved, dispatched, value };
}
