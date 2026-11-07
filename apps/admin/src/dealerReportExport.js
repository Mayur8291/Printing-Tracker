import {
  buildDealerPeriodProgress,
  formatQuarterLabel,
  formatYearLabel,
  progressPeriodLabel,
  progressViewMeta
} from "./dealerReportPeriodUtils";
import {
  computeDealerColumnTotals,
  formatDealerNumber,
  formatReportDateHeading,
  getAmountFromRecord
} from "./dealerReportUtils";

function downloadBlob(buffer, filename) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
}

function autosizeSheet(sheet, widths = []) {
  sheet.columns.forEach((col, index) => {
    col.width = widths[index] ?? (index === 0 ? 22 : 14);
    if (index > 0) {
      col.numFmt = "#,##0";
      col.alignment = { horizontal: "right" };
    }
  });
}

function addDailySheet(sheet, reportDealers, entries, title) {
  sheet.addRow([title]);
  sheet.addRow([]);
  const headerRow = ["Date", ...reportDealers.map((d) => d.label), "Total"];
  sheet.addRow(headerRow);
  styleHeaderRow(sheet.getRow(3));
  for (const row of entries) {
    sheet.addRow([
      formatReportDateHeading(row.report_date),
      ...reportDealers.map(({ key }) => getAmountFromRecord(row, key)),
      Number(row.total) || 0
    ]);
  }
  const totals = computeDealerColumnTotals(entries, reportDealers);
  const footer = sheet.addRow([
    "Total",
    ...reportDealers.map(({ key }) => totals.byKey[key] ?? 0),
    totals.total
  ]);
  footer.font = { bold: true };
  autosizeSheet(sheet, [24, ...reportDealers.map(() => 14), 14]);
}

function addProgressSheet(sheet, dealers, entries, view, periodLabel) {
  const meta = progressViewMeta(view);
  const progress = buildDealerPeriodProgress(dealers, entries, view);
  sheet.addRow([meta.title]);
  sheet.addRow([periodLabel]);
  sheet.addRow([meta.targetHint, meta.achievedHint]);
  sheet.addRow([]);
  sheet.addRow([
    "Dealer",
    "Annual target",
    meta.targetColumn,
    "Achieved",
    "Progress %",
    "Remaining"
  ]);
  styleHeaderRow(sheet.getRow(5));
  for (const row of progress.rows) {
    sheet.addRow([
      row.label,
      row.annualTarget,
      row.periodTarget,
      row.achieved,
      row.periodTarget > 0 ? row.percent : null,
      row.periodTarget > 0 ? row.remaining : null
    ]);
  }
  const footer = sheet.addRow([
    "Total",
    progress.totals.annualTarget,
    progress.totals.periodTarget,
    progress.totals.achieved,
    progress.totals.percent,
    progress.totals.remaining
  ]);
  footer.font = { bold: true };
  autosizeSheet(sheet, [24, 16, 16, 14, 12, 14]);
}

export async function exportDealerReportExcel({
  dealers,
  reportDealers,
  filterYear,
  filterQuarter,
  weekFrom,
  weekTo,
  weekEntries,
  quarterEntries,
  annualEntries
}) {
  if (!weekEntries?.length || !reportDealers?.length) {
    throw new Error("No report data to export.");
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scott Dashboard";
  workbook.created = new Date();

  const weekLabel = progressPeriodLabel("weekly", { filterYear, filterQuarter, weekFrom, weekTo });
  const quarterLabel = progressPeriodLabel("quarterly", { filterYear, filterQuarter, weekFrom, weekTo });
  const annualLabel = progressPeriodLabel("annual", { filterYear, filterQuarter, weekFrom, weekTo });

  addDailySheet(
    workbook.addWorksheet("Daily entries"),
    reportDealers,
    weekEntries,
    `Daily data feed — ${weekLabel}`
  );
  addProgressSheet(
    workbook.addWorksheet("Weekly report"),
    dealers,
    weekEntries,
    "weekly",
    weekLabel
  );
  addProgressSheet(
    workbook.addWorksheet("Quarterly monitoring"),
    dealers,
    quarterEntries ?? [],
    "quarterly",
    quarterLabel
  );
  addProgressSheet(
    workbook.addWorksheet("Annual YTD"),
    dealers,
    annualEntries ?? [],
    "annual",
    annualLabel
  );

  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["Dealer report export"]);
  summary.addRow(["Year", filterYear]);
  summary.addRow(["Quarter", formatQuarterLabel(filterYear, filterQuarter)]);
  summary.addRow(["Weekly range", weekLabel]);
  summary.addRow(["Quarterly period", quarterLabel]);
  summary.addRow(["Annual YTD", annualLabel]);
  summary.addRow([]);
  summary.addRow(["Cadence", "Target set annually · monitored quarterly · daily data · weekly dealer progress"]);
  summary.addRow([]);
  summary.addRow(["Weekly report — remaining to hit weekly target"]);
  summary.addRow(["Dealer", "Weekly target", "Achieved", "Progress %", "Remaining"]);
  styleHeaderRow(summary.getRow(summary.rowCount));
  const weekProgress = buildDealerPeriodProgress(dealers, weekEntries, "weekly");
  for (const row of weekProgress.rows) {
    summary.addRow([
      row.label,
      row.periodTarget,
      row.achieved,
      row.periodTarget > 0 ? row.percent : null,
      row.periodTarget > 0 ? row.remaining : null
    ]);
  }
  summary.addRow([
    "Total",
    weekProgress.totals.periodTarget,
    weekProgress.totals.achieved,
    weekProgress.totals.percent,
    weekProgress.totals.remaining
  ]).font = { bold: true };
  autosizeSheet(summary, [28, 40]);

  const safeYear = String(filterYear);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(buffer, `dealer-reports_${safeYear}_${formatQuarterLabel(filterYear, filterQuarter).replace(/\s+/g, "-")}.xlsx`);

  return {
    rowCount: weekEntries.length,
    total: formatDealerNumber(weekProgress.totals.achieved)
  };
}

export async function fetchEntriesForPeriodRange(supabase, fromDate, toDate) {
  const { data, error } = await supabase
    .from("dealer_daily_reports")
    .select("id, report_date, month_key, dealer_amounts, total, created_at, updated_at")
    .gte("report_date", fromDate)
    .lte("report_date", toDate)
    .order("report_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
