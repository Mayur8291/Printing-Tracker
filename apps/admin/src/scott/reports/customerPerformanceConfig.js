// Customer Performance — the registry's 7th report, wired up here.
//
// `reportRegistry.js` carries this one as `implemented: false` with `service`/`columns`/
// `stats`/`export` all null, because `customerPerformanceService.js` was owned by a parallel
// worker when the registry was written. That service exists now, so this module supplies the
// missing half and `reportsCatalog.js` overlays it onto the placeholder — the registry file
// itself is left untouched (it belongs to another worker).
//
// TWO THINGS THIS REPORT DOES DIFFERENTLY, both preserved from the service:
//
//  1. The comparison is TWO independent fetches merged in the browser. Each response carries
//     a `previous_period` block and it is deliberately never read — the user picked period A,
//     so period A is what the baseline must be.
//  2. A growth percentage is UNDEFINED, not 0 and not Infinity, whenever a side is missing or
//     the baseline is 0. `formatGrowthPercent` renders that as an em dash. "No data" and
//     "no change" must not look alike.

import { buildReportFilterColumns } from "@/scott/list/filterEngine";
import {
  formatReportDate,
  generateExportFilename,
  reportExportFieldMap,
  reportExportHeaders,
  resolveReportPeriodRange
} from "@/scott/data/reports/reportShared";
import {
  CUSTOMER_PERFORMANCE_FETCH_ALL,
  CUSTOMER_PERFORMANCE_PERIOD_OPTIONS,
  defaultCustomerPerformancePeriods,
  fetchCustomerPerformanceComparison,
  filterByOrderHistory,
  pctChange
} from "@/scott/data/customerPerformanceService";

/** The em dash an undefined growth figure renders as — never `NaN`, never `0%`. */
export const NO_GROWTH_PLACEHOLDER = "—";

/**
 * `pctChange` output -> a cell string.
 * @param {number|undefined|null} value
 * @returns {string} `+12.5%` / `-8.3%` / `—`
 */
export function formatGrowthPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_GROWTH_PLACEHOLDER;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** Growth badges: green up, red down, neutral when there is no percentage at all. */
function growthTone(value) {
  const text = String(value ?? "").trim();
  if (!text || text === NO_GROWTH_PLACEHOLDER || text === "-") return "neutral";
  return text.startsWith("-") ? "danger" : "success";
}

// ---------------------------------------------------------------------------
// Period labels
// ---------------------------------------------------------------------------
//
// Spec §12: the qty/value headers and the export filename must NAME the two periods
// (`Qty (<label>)`, `customer-performance-<slugA>-vs-<slugB>-YYYY-MM-DD.csv`). Static
// `(A)`/`(B)` headers make a downloaded file impossible to attribute afterwards.

const MONTH_LABELS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]);

/**
 * One picker period -> its human label (`August 2026`, `2026`, `2026-06-01 → 2026-06-30`).
 * @param {{mode?: string, year?: unknown, month?: unknown, startDate?: string, endDate?: string}} period
 * @param {string} [fallback]
 */
export function customerPerformancePeriodLabel(period, fallback = "Period") {
  const year = Number(period?.year);
  const month = Number(period?.month);
  const quarter = Number(period?.quarter);
  const mode = String(period?.mode ?? "month");

  if (mode === "year" && Number.isFinite(year)) return String(year);
  // `week` / `quarter` exist because the Customers → Performance screen honours all four
  // growth windows (weekly / monthly / quarterly / yearly), not just the monthly one.
  if (mode === "week") {
    const match = /^(\d{4})-W(\d{1,2})$/.exec(String(period?.weekValue ?? "").trim());
    if (match) return `Week ${Number(match[2])}, ${match[1]}`;
  }
  if (mode === "quarter" && Number.isFinite(year) && Number.isFinite(quarter)) {
    return `Q${Math.min(4, Math.max(1, quarter))} ${year}`;
  }
  if (mode === "date") {
    const start = String(period?.startDate ?? "").trim();
    const end = String(period?.endDate ?? "").trim();
    if (start && end) return `${start} → ${end}`;
    if (start || end) return start || end;
  }
  if (Number.isFinite(month) && Number.isFinite(year)) {
    return `${MONTH_LABELS[Math.min(11, Math.max(0, month - 1))]} ${year}`;
  }
  return fallback;
}

/** `August 2026` -> `august-2026`, for the export filename. */
export function periodSlug(label) {
  return (
    String(label ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "period"
  );
}

/** The two labels the columns and the filename share. */
export function customerPerformancePeriodLabels(values) {
  return {
    a: customerPerformancePeriodLabel(values?.periodA, "Period A"),
    b: customerPerformancePeriodLabel(values?.periodB, "Period B")
  };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * The 13 comparison columns, with the two period labels folded into the qty/value headers.
 *
 * ORDER AND HEADERS ARE THE CONTRACT (spec §12: "13, test-locked via export headers"; the
 * ORIGINAL is `buildCustomerComparisonColumns` in `customerComparisonTableConfig.ts`):
 *
 *   Customer ID, Customer Type, Customer Name, Zone,
 *   Qty (A), Value (A), Qty (B), Value (B),      <- INTERLEAVED per period, not grouped
 *   Qty Change, Value Change, Qty Change %, Value Change %,
 *   Last Purchased Date
 *
 * Column 0 binds `customer_id`, NOT `customer_code`: the service resolves
 * `customer_id ← customer_id|customerId|id → nested id → customer_code`, so a row that only
 * carries a code still exports a value, while a row that carries only `customer_id` (the
 * common case) would export BLANK from a `customer_code` binding.
 *
 * @param {{a: string, b: string}} [labels]
 * @returns {import('@/scott/data/reports/reportShared').ReportColumnDef[]}
 */
export function buildCustomerPerformanceColumns(labels) {
  const a = labels?.a || "A";
  const b = labels?.b || "B";

  return [
    // Numeric sort, like the ORIGINAL's `getSortValue` (ids are numeric strings upstream).
    { label: "Customer ID", keys: ["customer_id"], sortKey: "customer_id", sortType: "number" },
    // `type: "enum"` so the toolbar builds the dropdown options from the loaded rows.
    { label: "Customer Type", keys: ["customer_type"], type: "enum" },
    { label: "Customer Name", keys: ["customer_name"] },
    { label: "Zone", keys: ["zone"], type: "enum" },
    { label: `Qty (${a})`, keys: ["qtyA"], format: "number" },
    { label: `Value (${a})`, keys: ["valueA"], format: "currency" },
    { label: `Qty (${b})`, keys: ["qtyB"], format: "number" },
    { label: `Value (${b})`, keys: ["valueB"], format: "currency" },
    { label: "Qty Change", keys: ["qtyChange"], format: "number" },
    { label: "Value Change", keys: ["valueChange"], format: "currency" },
    {
      label: "Qty Change %",
      keys: ["qtyChangePct"],
      sortKey: "qtyChangePct",
      sortType: "number",
      badge: true,
      tone: growthTone,
      formatValue: (row) => formatGrowthPercent(row?.qtyChangePct)
    },
    {
      label: "Value Change %",
      keys: ["valueChangePct"],
      sortKey: "valueChangePct",
      sortType: "number",
      badge: true,
      tone: growthTone,
      formatValue: (row) => formatGrowthPercent(row?.valueChangePct)
    },
    {
      // Upstream labels a blank last-purchase date "No Orders Yet" (ScottOne
      // customerPerformanceReportService.ts:73-78) so a never-ordered customer is
      // distinguishable from missing data. The `no_orders_yet` filter option below
      // depends on this. reportExportFieldMap derives the CSV from this same def,
      // so one formatValue covers table + export.
      label: "Last Purchased Date",
      keys: ["last_purchased_date"],
      formatValue: (row) =>
        String(row?.last_purchased_date ?? "").trim()
          ? formatReportDate(row.last_purchased_date)
          : "No Orders Yet"
    }
  ];
}

/** The static shape, kept for anything that needs a descriptor before filters exist. */
export const CUSTOMER_PERFORMANCE_COLUMNS = Object.freeze(
  buildCustomerPerformanceColumns({ a: "A", b: "B" })
);

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function sum(rows, key) {
  let total = 0;
  for (const row of rows ?? []) {
    const value = row?.[key];
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Aggregates across the merged comparison rows.
 * The two growth figures go through the SAME `pctChange` the per-row columns use, so a zero
 * baseline produces an em dash at the tile level too.
 */
export function computeCustomerPerformanceStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const qtyA = sum(list, "qtyA");
  const qtyB = sum(list, "qtyB");
  const valueA = sum(list, "valueA");
  const valueB = sum(list, "valueB");

  return {
    customerCount: list.length,
    qtyA,
    qtyB,
    valueA,
    valueB,
    qtyGrowth: formatGrowthPercent(pctChange(qtyA, qtyB)),
    valueGrowth: formatGrowthPercent(pctChange(valueA, valueB))
  };
}

export const CUSTOMER_PERFORMANCE_STAT_TILES = Object.freeze([
  { key: "customerCount", label: "Customers Compared", format: "number" },
  { key: "qtyA", label: "Qty · Period A", format: "number" },
  { key: "qtyB", label: "Qty · Period B", format: "number" },
  { key: "qtyGrowth", label: "Qty Growth", format: "text" },
  { key: "valueB", label: "Value · Period B", format: "currency" },
  { key: "valueGrowth", label: "Value Growth", format: "text" }
]);

// ---------------------------------------------------------------------------
// Filters + transport
// ---------------------------------------------------------------------------

/** Seeded once at module load so both period pickers open on the documented defaults. */
const PERIOD_DEFAULTS = defaultCustomerPerformancePeriods();

/**
 * `defaultCustomerPerformancePeriods()` describes a period as `{mode:'month', year, month,
 * start, end}`; the shared period picker speaks `{mode, year, month, startDate, endDate}`.
 */
function toPickerPeriod(period) {
  return {
    mode: "month",
    year: period?.year,
    month: period?.month,
    startDate: period?.start ?? "",
    endDate: period?.end ?? ""
  };
}

export const CUSTOMER_PERFORMANCE_FILTERS = Object.freeze([
  {
    key: "growthPeriod",
    type: "select",
    label: "Growth Period",
    options: CUSTOMER_PERFORMANCE_PERIOD_OPTIONS,
    default: PERIOD_DEFAULTS.growthPeriod
  },
  {
    key: "periodA",
    type: "period",
    label: "Baseline period (A)",
    modes: ["month", "date", "year"],
    default: toPickerPeriod(PERIOD_DEFAULTS.periodA)
  },
  {
    key: "periodB",
    type: "period",
    label: "Comparison period (B)",
    modes: ["month", "date", "year"],
    default: toPickerPeriod(PERIOD_DEFAULTS.periodB)
  },
  {
    key: "orderHistoryFilter",
    type: "select",
    label: "Order history",
    options: [
      { value: "all", label: "All customers" },
      { value: "has_orders", label: "Orders > 0" },
      { value: "no_orders_yet", label: "No Orders Yet" }
    ],
    default: "all"
  }
]);

/**
 * Filter values -> the shape `fetchCustomerPerformanceComparison` wants, plus the KPI range.
 * Also the drain cache key, so every field that changes the request has to appear here.
 */
export function buildCustomerPerformanceFilters(values) {
  const rangeA = resolveReportPeriodRange(values?.periodA ?? toPickerPeriod(PERIOD_DEFAULTS.periodA));
  const rangeB = resolveReportPeriodRange(values?.periodB ?? toPickerPeriod(PERIOD_DEFAULTS.periodB));
  const starts = [rangeA.startDate, rangeB.startDate].filter(Boolean).sort();
  const ends = [rangeA.endDate, rangeB.endDate].filter(Boolean).sort();

  return {
    a_start: rangeA.startDate,
    a_end: rangeA.endDate,
    b_start: rangeB.startDate,
    b_end: rangeB.endDate,
    period: values?.growthPeriod ?? PERIOD_DEFAULTS.growthPeriod,
    order_history: values?.orderHistoryFilter ?? "all",
    // KPI cards cover everything the table compares (the union of A and B).
    kpi_start: starts[0] ?? "",
    kpi_end: ends[ends.length - 1] ?? ""
  };
}

/** The whole comparison for one filter set. `order_history` is a client-side predicate. */
export async function fetchCustomerPerformanceRows(filters = {}) {
  const rows = await fetchCustomerPerformanceComparison({
    periodA: { startDate: filters.a_start, endDate: filters.a_end },
    periodB: { startDate: filters.b_start, endDate: filters.b_end },
    period: filters.period
  });
  return filterByOrderHistory(rows, filters.order_history);
}

// ---------------------------------------------------------------------------
// The descriptor overlay
// ---------------------------------------------------------------------------

/**
 * Turn the registry placeholder into a real descriptor.
 * @param {object} placeholder the `customer_performance` entry from `REPORT_REGISTRY`.
 * @returns {object}
 */
export function implementCustomerPerformanceReport(placeholder = {}) {
  return {
    ...placeholder,
    implemented: true,
    pageSize: placeholder.pageSize ?? 20,
    fetchAll: placeholder.fetchAll ?? CUSTOMER_PERFORMANCE_FETCH_ALL,
    serverPaginated: false,
    // One drain per filter set; `useScottList` pages the merged rows client-side.
    service: { fetchAll: fetchCustomerPerformanceRows },
    // `reportRequests.js` prefers this over its per-key switch.
    buildApiFilters: buildCustomerPerformanceFilters,
    filters: CUSTOMER_PERFORMANCE_FILTERS,
    // Static shapes first, so a consumer that never applies filters still gets a valid
    // descriptor; `ReportView` swaps in the period-labelled versions once it has values.
    columns: CUSTOMER_PERFORMANCE_COLUMNS,
    filterColumns: buildReportFilterColumns(CUSTOMER_PERFORMANCE_COLUMNS),
    buildColumns: (values) => buildCustomerPerformanceColumns(customerPerformancePeriodLabels(values)),
    buildFilterColumns: (values) =>
      buildReportFilterColumns(
        buildCustomerPerformanceColumns(customerPerformancePeriodLabels(values))
      ),
    stats: { tiles: CUSTOMER_PERFORMANCE_STAT_TILES, compute: computeCustomerPerformanceStats },
    export: {
      entityName: "customer-performance-report",
      headers: reportExportHeaders(CUSTOMER_PERFORMANCE_COLUMNS),
      fieldMap: () => reportExportFieldMap(CUSTOMER_PERFORMANCE_COLUMNS),
      filename: () => generateExportFilename("customer-performance-report"),
      /**
       * Period-aware export (spec §12): the headers name the periods and the filename is
       * `customer-performance-<slugA>-vs-<slugB>-YYYY-MM-DD.csv`, so a downloaded file can
       * always be attributed to the comparison that produced it.
       */
      build: (values) => {
        const labels = customerPerformancePeriodLabels(values);
        const columns = buildCustomerPerformanceColumns(labels);
        return {
          headers: reportExportHeaders(columns),
          fieldMap: () => reportExportFieldMap(columns),
          filename: () =>
            generateExportFilename(
              `customer-performance-${periodSlug(labels.a)}-vs-${periodSlug(labels.b)}`
            )
        };
      }
    }
  };
}

export default implementCustomerPerformanceReport;
