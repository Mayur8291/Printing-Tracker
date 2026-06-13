import {
  capRangeToToday,
  formatQuarterLabel,
  periodTargetFromAnnual,
  quarterFromISODate,
  quarterRange,
  yearFromISODate
} from "./dealerReportPeriodUtils";
import { getAmountFromRecord, todayLocalISODate } from "./dealerReportUtils";

function parseISODateLocal(iso) {
  const [y, m, d] = String(iso ?? "").split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysInclusive(fromISO, toISO) {
  const a = parseISODateLocal(fromISO);
  const b = parseISODateLocal(toISO);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return Math.max(1, diff + 1);
}

export function formatDealerCompactINR(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 100000) {
    const lakhs = abs / 100000;
    const text = lakhs >= 10 || lakhs % 1 === 0 ? String(Math.round(lakhs)) : lakhs.toFixed(1);
    return `${sign}₹${text}L`;
  }
  if (abs >= 1000) {
    const k = abs / 1000;
    const text = k >= 10 || k % 1 === 0 ? String(Math.round(k)) : k.toFixed(1);
    return `${sign}₹${text}k`;
  }
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

export function currentQuarterContext(referenceDate = todayLocalISODate()) {
  const year = yearFromISODate(referenceDate);
  const quarter = quarterFromISODate(referenceDate);
  const range = quarterRange(year, quarter);
  const capped = capRangeToToday(range.from, range.to);
  return {
    year,
    quarter,
    label: formatQuarterLabel(year, quarter),
    range: capped,
    quarterStart: range.from,
    quarterEnd: range.to
  };
}

export function buildDealerCardModel(dealer, entries, context = currentQuarterContext()) {
  const annualTarget = Number(dealer?.salesTarget) || 0;
  const quarterlyTarget = periodTargetFromAnnual(annualTarget, "quarterly");
  let achieved = 0;
  for (const row of entries ?? []) {
    achieved += getAmountFromRecord(row, dealer.key);
  }
  const percent =
    quarterlyTarget > 0 ? Math.min(999, Math.round((achieved / quarterlyTarget) * 1000) / 10) : 0;
  const remaining = Math.max(0, quarterlyTarget - achieved);

  const today = todayLocalISODate();
  const effectiveEnd = context.range.to;
  const totalDays = daysInclusive(context.quarterStart, context.quarterEnd);
  const elapsedDays = daysInclusive(context.quarterStart, effectiveEnd);
  const daysLeft = Math.max(0, daysInclusive(today, context.quarterEnd) - 1);
  const weeksLeft = Math.max(1, Math.ceil((daysLeft + 1) / 7));

  const expectedByNow = quarterlyTarget > 0 ? (quarterlyTarget * elapsedDays) / totalDays : 0;
  const behindBy = Math.round(Math.max(0, expectedByNow - achieved));
  const sellPerWeek = remaining > 0 ? Math.round(remaining / weeksLeft) : 0;

  return {
    key: dealer.key,
    label: dealer.label,
    quarterlyTarget,
    achieved,
    percent,
    remaining,
    sellPerWeek,
    behindBy,
    met: quarterlyTarget > 0 && achieved >= quarterlyTarget,
    onTrack: quarterlyTarget > 0 && behindBy === 0 && !remaining,
    periodLabel: context.label
  };
}

export function buildDealerCardModels(dealers, entries, context) {
  return (dealers ?? [])
    .filter((d) => d.isActive !== false)
    .map((dealer) => buildDealerCardModel(dealer, entries, context))
    .sort((a, b) => b.achieved - a.achieved || a.label.localeCompare(b.label));
}
