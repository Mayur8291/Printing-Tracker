// The seven reports the panel offers, and where the selection is remembered.
//
// `REPORT_REGISTRY` is the source of truth for six of them. The seventh
// (`customer_performance`) is still a placeholder there — `implemented: false`, every slot
// null — because the registry predates `customerPerformanceService.js`. It is completed HERE
// rather than in the registry file, which belongs to another worker.
//
// Everything downstream reads this catalog, so the panel never has to know which entries
// arrived complete and which were overlaid.

import { REPORT_GROUPS, REPORT_REGISTRY } from "@/scott/data/reports/reportRegistry";
import { implementCustomerPerformanceReport } from "@/scott/reports/customerPerformanceConfig";

/** localStorage key holding the last report the user looked at. */
export const SELECTED_REPORT_STORAGE_KEY = "scott.reports.selectedReport";
/** localStorage key holding the last RMP Sales sub-tab. */
export const SELECTED_TAB_STORAGE_KEY = "scott.reports.selectedTab";

/** All seven reports, registry order, with the placeholder filled in. */
export const REPORTS = Object.freeze(
  REPORT_REGISTRY.map((report) =>
    report.key === "customer_performance" ? implementCustomerPerformanceReport(report) : report
  )
);

export const DEFAULT_REPORT_KEY = REPORTS[0]?.key ?? "order_reports";

/** @returns {object|null} */
export function getReport(key) {
  return REPORTS.find((report) => report.key === key) ?? null;
}

/**
 * `[{ group, reports }]` in `REPORT_GROUPS` order — the shape both the desktop pill row and
 * the mobile select consume. Falls back to the registry's own grouping for any group the
 * catalog gained since.
 */
export function getGroupedReports() {
  const grouped = [];
  const seen = new Set();

  for (const group of REPORT_GROUPS) {
    const reports = REPORTS.filter((report) => report.group === group);
    if (reports.length === 0) continue;
    reports.forEach((report) => seen.add(report.key));
    grouped.push({ group, reports });
  }

  const ungrouped = REPORTS.filter((report) => !seen.has(report.key));
  if (ungrouped.length > 0) grouped.push({ group: "Other", reports: ungrouped });

  return grouped;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
//
// Wrapped because localStorage throws in private-mode Safari and in any embedded context
// with storage disabled — a report panel must not fail to mount over a preference.

function readStorage(key) {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key, value) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value ?? ""));
  } catch {
    /* preference is best-effort */
  }
}

/** The remembered report, validated against the catalog. */
export function loadSelectedReportKey() {
  const stored = readStorage(SELECTED_REPORT_STORAGE_KEY);
  return getReport(stored) ? stored : DEFAULT_REPORT_KEY;
}

export function saveSelectedReportKey(key) {
  writeStorage(SELECTED_REPORT_STORAGE_KEY, key);
}

/** The remembered sub-tab, validated against that report's own tabs. */
export function loadSelectedTabKey(reportKey) {
  const report = getReport(reportKey);
  const tabs = report?.tabs;
  if (!Array.isArray(tabs) || tabs.length === 0) return "";
  const stored = readStorage(`${SELECTED_TAB_STORAGE_KEY}.${reportKey}`);
  return tabs.some((tab) => tab.key === stored) ? stored : tabs[0].key;
}

export function saveSelectedTabKey(reportKey, tabKey) {
  writeStorage(`${SELECTED_TAB_STORAGE_KEY}.${reportKey}`, tabKey);
}

export default REPORTS;
