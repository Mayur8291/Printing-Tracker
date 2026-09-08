import { sampleJobSheetIsClosed } from "./sampleJobSheetStages";

/** Default SLA when Sampling required on is empty: 2 days from save (`orders.created_at`). */
export const SAMPLE_JOB_SHEET_SLA_MS = 2 * 24 * 60 * 60 * 1000;

export const DEFAULT_SAMPLE_JOB_SHEET_SLA = Object.freeze({
  defaultSlaDays: 2,
  defaultSlaHours: 0,
  warnHours: 24,
  urgentHours: 12
});

const LOCAL_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function clampSampleSlaDays(raw) {
  const n = Math.floor(Number(raw) || 0);
  return Math.min(30, Math.max(1, n));
}

export function clampSampleSlaHours(raw) {
  const n = Math.floor(Number(raw) || 0);
  return Math.min(23, Math.max(0, n));
}

export function clampSampleSlaWarnHours(raw) {
  const n = Math.floor(Number(raw) || 0);
  return Math.min(168, Math.max(1, n));
}

export function sampleJobSheetSlaDurationMs(policy = DEFAULT_SAMPLE_JOB_SHEET_SLA) {
  const days = clampSampleSlaDays(policy.defaultSlaDays);
  const hours = clampSampleSlaHours(policy.defaultSlaHours);
  return (days * 24 + hours) * 60 * 60 * 1000;
}

function sampleJobSheetDeliveryDeadlineMs(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const day = text.slice(0, 10);
  if (!LOCAL_DAY_RE.test(day)) return null;
  const end = new Date(`${day}T23:59:59.999`).getTime();
  return Number.isFinite(end) ? end : null;
}

function sampleJobSheetDefaultDeadlineMs(order, policy) {
  const duration = sampleJobSheetSlaDurationMs(policy);
  const created = Date.parse(order?.created_at);
  if (Number.isFinite(created)) return created + duration;
  const date = String(order?.order_date ?? "").trim();
  if (!date) return null;
  const start = new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(start)) return null;
  return start + duration;
}

/** Sampling required on end-of-day when set; otherwise save time + admin SLA. */
export function sampleJobSheetSlaDeadlineMs(order, policy = DEFAULT_SAMPLE_JOB_SHEET_SLA) {
  return sampleJobSheetDeliveryDeadlineMs(order?.due_date) ?? sampleJobSheetDefaultDeadlineMs(order, policy);
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

export function sampleJobSheetSlaUrgency(remainingMs, policy = DEFAULT_SAMPLE_JOB_SHEET_SLA) {
  const urgentMs = clampSampleSlaWarnHours(policy.urgentHours) * 60 * 60 * 1000;
  const warnMs = clampSampleSlaWarnHours(policy.warnHours) * 60 * 60 * 1000;
  if (remainingMs < urgentMs) return "urgent";
  if (remainingMs < warnMs) return "warn";
  return "ok";
}

/**
 * Due In snapshot.
 * hidden = closed (Dispatched Successfully / complete) or no deadline.
 * breached = still open and past deadline (no timer).
 * countdown = still open and time left.
 */
export function getSampleJobSheetSlaSnapshot(order, nowMs = Date.now(), policy = DEFAULT_SAMPLE_JOB_SHEET_SLA) {
  if (!order || sampleJobSheetIsClosed(order)) {
    return { kind: "hidden" };
  }
  const deadline = sampleJobSheetSlaDeadlineMs(order, policy);
  if (deadline == null) return { kind: "hidden" };
  const remainingMs = deadline - nowMs;
  if (remainingMs <= 0) {
    return { kind: "breached" };
  }
  return {
    kind: "countdown",
    label: formatSampleJobSheetSlaCountdown(remainingMs),
    urgency: sampleJobSheetSlaUrgency(remainingMs, policy)
  };
}
