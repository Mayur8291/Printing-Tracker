export const UNIWARE_DRR_UNITS = ["days", "months", "years"];

export function clampDrrAmount(unit, raw) {
  const n = Math.floor(Number(raw) || 0);
  if (unit === "years") return Math.min(Math.max(n, 1), 5);
  if (unit === "months") return Math.min(Math.max(n, 1), 24);
  return Math.min(Math.max(n, 1), 365);
}

/** Calendar-ish window used both for DRR divide and Sync orders lookback. */
export function drrPeriodDays(unit, amount) {
  const n = clampDrrAmount(unit, amount);
  if (unit === "years") return n * 365;
  if (unit === "months") return n * 30;
  return n;
}

export function drrPeriodFromDate(unit, amount, now = new Date()) {
  const days = drrPeriodDays(unit, amount);
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return from.toISOString().slice(0, 10);
}

export const UNIWARE_DRR_UNIT_LABEL = "pcs/day";

export function drrOfSku(drrBySku, skuCode) {
  return Number(drrBySku[String(skuCode || "").trim().toLowerCase()]?.drr) || 0;
}

export function soldOfSku(drrBySku, skuCode) {
  return Number(drrBySku[String(skuCode || "").trim().toLowerCase()]?.sold) || 0;
}

export function formatUniDrr(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatUniDrrWithUnit(value) {
  return `${formatUniDrr(value)} ${UNIWARE_DRR_UNIT_LABEL}`;
}
