import { sampleJobSheetIsClosed } from "./sampleJobSheetStages";

/** Default SLA when Delivery Required On is empty: 2 days from save (`orders.created_at`). */
export const SAMPLE_JOB_SHEET_SLA_MS = 2 * 24 * 60 * 60 * 1000;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const LOCAL_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function sampleJobSheetDeliveryDeadlineMs(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const day = text.slice(0, 10);
  if (!LOCAL_DAY_RE.test(day)) return null;
  const end = new Date(`${day}T23:59:59.999`).getTime();
  return Number.isFinite(end) ? end : null;
}

function sampleJobSheetDefaultDeadlineMs(order) {
  const created = Date.parse(order?.created_at);
  if (Number.isFinite(created)) return created + SAMPLE_JOB_SHEET_SLA_MS;
  const date = String(order?.order_date ?? "").trim();
  if (!date) return null;
  const start = new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(start)) return null;
  return start + SAMPLE_JOB_SHEET_SLA_MS;
}

/** Delivery Required On end-of-day when set; otherwise save time + 2 days. */
export function sampleJobSheetSlaDeadlineMs(order) {
  return sampleJobSheetDeliveryDeadlineMs(order?.due_date) ?? sampleJobSheetDefaultDeadlineMs(order);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatSampleJobSheetSlaCountdown(remainingMs) {
  const safe = Math.max(0, remainingMs);
  const totalMinutes = Math.floor(safe / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)} Hrs Left`;
}

export function sampleJobSheetSlaUrgency(remainingMs) {
  if (remainingMs < TWELVE_HOURS_MS) return "urgent";
  if (remainingMs < TWENTY_FOUR_HOURS_MS) return "warn";
  return "ok";
}

/**
 * Due In snapshot.
 * hidden = closed (Dispatched Successfully / complete) or no deadline.
 * breached = still open and past deadline (no timer).
 * countdown = still open and time left.
 */
export function getSampleJobSheetSlaSnapshot(order, nowMs = Date.now()) {
  if (!order || sampleJobSheetIsClosed(order)) {
    return { kind: "hidden" };
  }
  const deadline = sampleJobSheetSlaDeadlineMs(order);
  if (deadline == null) return { kind: "hidden" };
  const remainingMs = deadline - nowMs;
  if (remainingMs <= 0) {
    return { kind: "breached" };
  }
  return {
    kind: "countdown",
    label: formatSampleJobSheetSlaCountdown(remainingMs),
    urgency: sampleJobSheetSlaUrgency(remainingMs)
  };
}
