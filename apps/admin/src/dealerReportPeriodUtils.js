import {
  computeDealerColumnTotals,
  formatDateRangeLabel,
  normalizeDateRange,
  todayLocalISODate
} from "./dealerReportUtils";

export const DEALER_PROGRESS_VIEWS = [
  { id: "weekly", label: "Weekly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "annual", label: "Annual" }
];

const QUARTER_NAMES = ["Q1", "Q2", "Q3", "Q4"];
const QUARTER_MONTH_LABELS = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];

/** Fiscal year starts in April. Q4 is Jan–Mar of the following calendar year. */
export function fiscalYearFromISODate(isoDate) {
  const y = Number(String(isoDate ?? "").slice(0, 4));
  const m = Number(String(isoDate ?? "").slice(5, 7));
  if (!Number.isFinite(y) || y < 2000) return new Date().getFullYear();
  if (!Number.isFinite(m) || m < 1 || m > 12) return y;
  return m >= 4 ? y : y - 1;
}

export function yearFromISODate(isoDate) {
  return fiscalYearFromISODate(isoDate);
}

export function quarterFromISODate(isoDate) {
  const m = Number(String(isoDate ?? "").slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return 1;
  if (m >= 4 && m <= 6) return 1;
  if (m >= 7 && m <= 9) return 2;
  if (m >= 10 && m <= 12) return 3;
  return 4;
}

export function quarterRange(fiscalYear, quarter) {
  const q = Math.min(4, Math.max(1, Number(quarter) || 1));
  const fy = Number(fiscalYear) || fiscalYearFromISODate(todayLocalISODate());
  if (q === 1) {
    return { from: `${fy}-04-01`, to: `${fy}-06-30`, quarter: q, year: fy };
  }
  if (q === 2) {
    return { from: `${fy}-07-01`, to: `${fy}-09-30`, quarter: q, year: fy };
  }
  if (q === 3) {
    return { from: `${fy}-10-01`, to: `${fy}-12-31`, quarter: q, year: fy };
  }
  const nextYear = fy + 1;
  return { from: `${nextYear}-01-01`, to: `${nextYear}-03-31`, quarter: q, year: fy };
}

export function yearRange(fiscalYear) {
  const fy = Number(fiscalYear) || fiscalYearFromISODate(todayLocalISODate());
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, year: fy };
}

export function capRangeToToday(fromISO, toISO) {
  const { from, to } = normalizeDateRange(fromISO, toISO);
  const today = todayLocalISODate();
  return { from, to: to > today ? today : to };
}

export function formatQuarterLabel(year, quarter) {
  const q = Math.min(4, Math.max(1, Number(quarter) || 1));
  return `${QUARTER_NAMES[q - 1]} ${year} (${QUARTER_MONTH_LABELS[q - 1]})`;
}

export function formatYearLabel(year) {
  const fy = Number(year) || fiscalYearFromISODate(todayLocalISODate());
  return `FY ${fy} (Apr ${fy} – Mar ${fy + 1})`;
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
      targetHint: "Annual target ÷ 4 · Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar",
      achievedHint: "Sum of daily entries in selected fiscal quarter"
    };
  }
  return {
    title: "Annual progress (YTD)",
    targetColumn: "Annual target",
    targetHint: "Full fiscal-year target (Apr–Mar)",
    achievedHint: "Sum of daily entries in fiscal year to date"
  };
}
