/** Sample job sheets on Sampling Tracker. Order IDs are SA-0001, SA-0002, … sequential. */

export const SAMPLE_JOB_SHEET_ORDER_KIND = "sample_job_sheet";

export const SAMPLE_JOB_SHEET_ORDER_ID_RE = /^SA-(\d{4,})$/;

export function isSampleJobSheetOrder(order) {
  return String(order?.order_kind ?? "") === SAMPLE_JOB_SHEET_ORDER_KIND;
}

export function formatSampleJobSheetOrderId(num) {
  const n = Number.parseInt(String(num), 10);
  const safe = Number.isFinite(n) && n > 0 ? n : 1;
  return `SA-${String(safe).padStart(4, "0")}`;
}

export function parseSampleJobSheetOrderNumber(raw) {
  const match = SAMPLE_JOB_SHEET_ORDER_ID_RE.exec(String(raw ?? "").trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Next SA-#### after the highest existing sample job-sheet id. Starts at SA-0001. */
export function computeNextSampleJobSheetOrderId(existingOrderIds) {
  let max = 0;
  for (const raw of existingOrderIds ?? []) {
    const n = parseSampleJobSheetOrderNumber(raw);
    if (n != null && n > max) max = n;
  }
  return formatSampleJobSheetOrderId(max + 1);
}

export function isSampleJobSheetOrderIdConflict(message) {
  const text = String(message ?? "");
  return /orders_sample_job_sheet_order_id_uidx/i.test(text);
}

export async function fetchNextSampleJobSheetOrderId(client) {
  const { data, error } = await client
    .from("orders")
    .select("order_id")
    .eq("order_kind", SAMPLE_JOB_SHEET_ORDER_KIND);
  if (error) throw new Error(error.message);
  return computeNextSampleJobSheetOrderId((data || []).map((row) => row.order_id));
}
