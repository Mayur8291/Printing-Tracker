import {
  computeDealerColumnTotals,
  formatDateRangeLabel,
  normalizeDateRange,
  todayLocalISODate,
  toISODateLocal
} from "./dealerReportUtils";

export const DEALER_PROGRESS_VIEWS = [
  { id: "weekly", label: "Weekly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "annual", label: "Annual" }
];

const QUARTER_NAMES = ["Q1", "Q2", "Q3", "Q4"];

export function yearFromISODate(isoDate) {
  const y = Number(String(isoDate ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear();
}

export function quarterFromISODate(isoDate) {
  const m = Number(String(isoDate ?? "").slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return 1;
  return Math.ceil(m / 3);
}

export function quarterRange(year, quarter) {
  const q = Math.min(4, Math.max(1, Number(quarter) || 1));
  const y = Number(year) || new Date().getFullYear();
  const startMonth = (q - 1) * 3;
  const start = new Date(y, startMonth, 1);
  const end = new Date(y, startMonth + 3, 0);
  return { from: toISODateLocal(start), to: toISODateLocal(end), quarter: q, year: y };
}

export function yearRange(year) {
  const y = Number(year) || new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31`, year: y };
}

export function capRangeToToday(fromISO, toISO) {
  const { from, to } = normalizeDateRange(fromISO, toISO);
  const today = todayLocalISODate();
  return { from, to: to > today ? today : to };
}

export function formatQuarterLabel(year, quarter) {
  return `${QUARTER_NAMES[(quarter || 1) - 1]} ${year}`;
}

export function formatYearLabel(year) {
  return String(year ?? new Date().getFullYear());
}

export function periodTargetFromAnnual(annualTarget, view) {
  const annual = Number(annualTarget) || 0;
  if (annual <= 0) return 0;
  if (view === "weekly") return Math.round(annual / 52);
  if (view === "quarterly") return Math.round(annual / 4);
  return annual;
}

export function progressRangeForView(view, { filterYear, filterQuarter, weekFrom, weekTo }) {
  if (view === "weekly") {
    return capRangeToToday(weekFrom, weekTo);
  }
  if (view === "quarterly") {
    const q = quarterRange(filterYear, filterQuarter);
    return capRangeToToday(q.from, q.to);
  }
  const y = yearRange(filterYear);
  return capRangeToToday(y.from, y.to);
}

export function progressPeriodLabel(view, { filterYear, filterQuarter, weekFrom, weekTo }) {
  if (view === "weekly") {
    return `Week ${formatDateRangeLabel(weekFrom, weekTo)}`;
  }
  if (view === "quarterly") {
    const range = progressRangeForView(view, { filterYear, filterQuarter, weekFrom, weekTo });
    return `${formatQuarterLabel(filterYear, filterQuarter)} (${formatDateRangeLabel(range.from, range.to)})`;
  }
  const range = progressRangeForView(view, { filterYear, filterQuarter, weekFrom, weekTo });
  return `${formatYearLabel(filterYear)} YTD (${formatDateRangeLabel(range.from, range.to)})`;
}

export function buildDealerPeriodProgress(dealers, entries, view) {
  const list = (dealers ?? []).filter((d) => d.isActive !== false);
  const achieved = computeDealerColumnTotals(entries, list);
  const rows = list.map((dealer) => {
    const annualTarget = Number(dealer.salesTarget) || 0;
    const periodTarget = periodTargetFromAnnual(annualTarget, view);
    const got = achieved.byKey[dealer.key] || 0;
    const percent = periodTarget > 0 ? Math.round((got / periodTarget) * 1000) / 10 : null;
    return {
      key: dealer.key,
      label: dealer.label,
      annualTarget,
      periodTarget,
      achieved: got,
      percent,
      remaining: Math.max(0, periodTarget - got),
      met: periodTarget > 0 && got >= periodTarget
    };
  });
  const annualTargetTotal = rows.reduce((a, r) => a + r.annualTarget, 0);
  const periodTargetTotal = rows.reduce((a, r) => a + r.periodTarget, 0);
  const achievedTotal = rows.reduce((a, r) => a + r.achieved, 0);
  const percentTotal =
    periodTargetTotal > 0 ? Math.round((achievedTotal / periodTargetTotal) * 1000) / 10 : null;
  return {
    view,
    rows,
    totals: {
      annualTarget: annualTargetTotal,
      periodTarget: periodTargetTotal,
      achieved: achievedTotal,
      percent: percentTotal,
      remaining: Math.max(0, periodTargetTotal - achievedTotal)
    }
  };
}

export function progressViewMeta(view) {
  if (view === "weekly") {
    return {
      title: "Weekly dealer progress",
      targetColumn: "Weekly target",
      targetHint: "Annual target ÷ 52",
      achievedHint: "Sum of daily entries in selected week"
    };
  }
  if (view === "quarterly") {
    return {
      title: "Quarterly monitoring",
      targetColumn: "Quarterly target",
      targetHint: "Annual target ÷ 4",
      achievedHint: "Sum of daily entries in selected quarter"
    };
  }
  return {
    title: "Annual progress (YTD)",
    targetColumn: "Annual target",
    targetHint: "Full-year target",
    achievedHint: "Sum of daily entries year-to-date"
  };
}
