// Scott CUSTOMERS → Performance sub-tab.
//
// Two period pickers fed to `fetchCustomerPerformanceComparison` — which issues the two
// `customers/performance` calls in parallel and merges their `current_period` blocks through
// `mergeComparisonRows`.
//
// ---------------------------------------------------------------------------
// THE PICKER FOLLOWS THE GROWTH WINDOW
// ---------------------------------------------------------------------------
// The growth select offers WoW / MoM / Quarterly / Yearly, and each one now gets the picker
// AND the date range that belongs to it (`customerPerformancePeriodToRange`, which dispatches
// through `growthPeriodToPeriodMode`). This screen used to build a MONTH range for every
// mode, so "Yearly Growth" sent `period=yearly` with a one-month `start_date`/`end_date` and
// rendered month-sized numbers under a yearly heading. Offering an option the request cannot
// honour is worse than not offering it, and the four ranges are ~40 lines
// (`ScottOne/src/utils/customerPerformancePeriod.ts:121-177`).
//
// ---------------------------------------------------------------------------
// FILTERING AND EXPORT
// ---------------------------------------------------------------------------
// The toolbar is the house `ScottFilterBar` + `filterEngine`, not a 4-field substring match:
// enum filters on Customer Type and Zone (options derived from the loaded rows), numeric
// operators on every qty / value / change column and a date filter on Last Purchased Date —
// which is what makes "West-zone distributors whose value dropped more than 20%" expressible
// again (`ScottOne/.../customerPerformanceFilterConfig.ts`).
//
// Export goes through the SAME house path every other report uses (`exportReportCsv` over a
// `{headers, fieldMap, filename}` block). The 13 headers, their order and the
// `customer-performance-{slugA}-vs-{slugB}-{date}.csv` filename come from
// `buildCustomerPerformanceColumns` in `src/scott/reports/customerPerformanceConfig.js`, so
// the CSV this screen produces is byte-identical to the one the Reports screen produces —
// and it exports the FILTERED + SORTED set, never the visible page.
//
// NO MOCK DATA. The original substituted MOCK_PERIOD_A/B and MOCK_UNIQUE_CUSTOMERS whenever
// the integration came back empty in a dev build; the data layer deliberately dropped that,
// and so does this screen. An empty comparison renders as an empty table, and a missing KPI
// renders as an em dash.
//
// Growth percentages are UNDEFINED — never 0, never Infinity — when a side is missing or the
// baseline is 0 (`pctChange`). `DeltaPct` renders that as "—", which is the whole point:
// "no data" and "no change" must not look alike.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_PERFORMANCE_PERIOD_OPTIONS,
  customerPerformancePeriodToRange,
  defaultCustomerPerformancePeriods,
  fetchCustomerPerformanceComparison,
  fetchUniqueCustomersSummary,
  filterByOrderHistory,
  growthPeriodToPeriodMode,
  pctChange
} from "@/scott/data/customerPerformanceService";
import {
  applyFilterGroup,
  buildEnumOptionsFromRows,
  buildFilterColumns,
  createEmptyFilterGroup,
  filterRowsBySearch,
  isFilterGroupActive
} from "@/scott/list/filterEngine";
import {
  QUICK_FILTER_ALL_VALUE,
  applyQuickFilters,
  createEmptyQuickFilterValues,
  isQuickFilterActive,
  setQuickEnumFilter
} from "@/scott/list/quickFilters";
import { nextSortDirection, sortRows } from "@/scott/list/tableSort";
import {
  buildCustomerPerformanceColumns,
  customerPerformancePeriodLabel,
  periodSlug
} from "@/scott/reports/customerPerformanceConfig";
import exportReportCsv from "@/scott/reports/reportExport";
import {
  generateExportFilename,
  reportExportFieldMap,
  reportExportHeaders
} from "@/scott/data/reports/reportShared";
import ScottFilterBar from "@/scott/ui/ScottFilterBar";
import ScottPagination from "@/scott/ui/ScottPagination";
import ScottStatCards from "@/scott/ui/ScottStatCards";
import ScottTable from "@/scott/ui/ScottTable";

const MONTH_LABELS = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
]);

const ORDER_HISTORY_OPTIONS = Object.freeze([
  { value: "all", label: "All customers" },
  { value: "has_orders", label: "Has orders" },
  { value: "no_orders_yet", label: "No orders yet" }
]);

const MONTH_OPTIONS = Object.freeze(
  MONTH_LABELS.map((label, index) => ({ value: String(index + 1), label }))
);

const QUARTER_OPTIONS = Object.freeze([
  { value: "1", label: "Q1 (Jan – Mar)" },
  { value: "2", label: "Q2 (Apr – Jun)" },
  { value: "3", label: "Q3 (Jul – Sep)" },
  { value: "4", label: "Q4 (Oct – Dec)" }
]);

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

/** Year list around today, widened so a seeded default year is always selectable. */
function buildYearOptions(...extraYears) {
  const now = new Date().getFullYear();
  const years = new Set();
  for (let year = now - 5; year <= now + 1; year += 1) years.add(year);
  for (const year of extraYears) if (Number.isFinite(Number(year))) years.add(Number(year));
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => ({ value: String(year), label: String(year) }));
}

function sumBy(rows, key) {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = row?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : undefined;
}

/** Signed, coloured percentage — or an em dash when the change is genuinely unknowable. */
function DeltaPct({ value }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const text = `${value > 0 ? "+" : ""}${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value > 0 && "text-emerald-600 dark:text-emerald-400",
        value < 0 && "text-red-600 dark:text-red-400"
      )}
    >
      {text}
    </span>
  );
}

/**
 * One comparison period, rendered as whatever the growth window needs.
 *
 * week    a native `<input type="week">` (`YYYY-Www`) — the ORIGINAL's control;
 * month   month + year selects;
 * quarter quarter + year selects;
 * year    a single year select.
 */
function PeriodPicker({ id, label, mode, period, yearOptions, disabled, onChange }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-primary`}>{label}</Label>
      <div className="flex items-center gap-2">
        {mode === "week" ? (
          <Input
            id={`${id}-primary`}
            type="week"
            className="h-9 w-[10rem]"
            value={period.weekValue ?? ""}
            disabled={disabled}
            aria-label={`${label} week`}
            onChange={(event) => onChange({ ...period, weekValue: event.target.value })}
          />
        ) : null}

        {mode === "month" ? (
          <Select
            value={String(period.month)}
            onValueChange={(value) => onChange({ ...period, month: Number(value) })}
            disabled={disabled}
          >
            <SelectTrigger
              id={`${id}-primary`}
              className="h-9 w-[6.5rem]"
              aria-label={`${label} month`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {mode === "quarter" ? (
          <Select
            value={String(period.quarter ?? 1)}
            onValueChange={(value) => onChange({ ...period, quarter: Number(value) })}
            disabled={disabled}
          >
            <SelectTrigger
              id={`${id}-primary`}
              className="h-9 w-[10rem]"
              aria-label={`${label} quarter`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUARTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {mode === "week" ? null : (
          <Select
            value={String(period.year)}
            onValueChange={(value) => onChange({ ...period, year: Number(value) })}
            disabled={disabled}
          >
            <SelectTrigger
              id={mode === "year" ? `${id}-primary` : `${id}-year`}
              className="h-9 w-[6rem]"
              aria-label={`${label} year`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

/**
 * Customer performance comparison.
 *
 * @param {object} props
 * @param {Array<object>} [props.initialRows] test/storybook seam — pre-merged comparison rows.
 *        When supplied the two Scott calls are skipped entirely.
 * @param {object} [props.initialSummary] matching unique-customers KPI fixture.
 */
export default function ScottCustomerPerformanceTab({ initialRows, initialSummary }) {
  const defaults = useMemo(() => defaultCustomerPerformancePeriods(), []);
  const usesFixture = Array.isArray(initialRows);

  const [periodA, setPeriodA] = useState(() => ({
    year: defaults.periodA.year,
    month: defaults.periodA.month,
    quarter: defaults.periodA.quarter,
    weekValue: defaults.periodA.weekValue
  }));
  const [periodB, setPeriodB] = useState(() => ({
    year: defaults.periodB.year,
    month: defaults.periodB.month,
    quarter: defaults.periodB.quarter,
    weekValue: defaults.periodB.weekValue
  }));
  const [growthPeriod, setGrowthPeriod] = useState(defaults.growthPeriod);

  const [rows, setRows] = useState(() => (usesFixture ? initialRows : []));
  const [summary, setSummary] = useState(() => initialSummary ?? null);
  const [loading, setLoading] = useState(!usesFixture);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [historyMode, setHistoryMode] = useState("all");
  const [filters, setFilters] = useState(createEmptyFilterGroup);
  const [quickFilters, setQuickFilters] = useState(createEmptyQuickFilterValues);
  const [sort, setSort] = useState({ key: null, direction: null });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const periodMode = growthPeriodToPeriodMode(growthPeriod);

  const rangeA = useMemo(
    () => customerPerformancePeriodToRange(periodA, growthPeriod),
    [periodA, growthPeriod]
  );
  const rangeB = useMemo(
    () => customerPerformancePeriodToRange(periodB, growthPeriod),
    [periodB, growthPeriod]
  );
  const kpiStart = useMemo(
    () => [rangeA.start, rangeB.start].filter(Boolean).sort()[0] ?? "",
    [rangeA.start, rangeB.start]
  );
  const kpiEnd = useMemo(
    () => [rangeA.end, rangeB.end].filter(Boolean).sort().slice(-1)[0] ?? "",
    [rangeA.end, rangeB.end]
  );

  const yearOptions = useMemo(
    () => buildYearOptions(defaults.periodA.year, defaults.periodB.year),
    [defaults.periodA.year, defaults.periodB.year]
  );

  useEffect(() => {
    if (usesFixture) return undefined;

    let cancelled = false;
    setLoading(true);
    setError("");
    setSummaryError("");

    (async () => {
      const [comparison, kpis] = await Promise.allSettled([
        fetchCustomerPerformanceComparison({
          periodA: { startDate: rangeA.start, endDate: rangeA.end },
          periodB: { startDate: rangeB.start, endDate: rangeB.end },
          period: growthPeriod
        }),
        fetchUniqueCustomersSummary(kpiStart, kpiEnd)
      ]);
      if (cancelled) return;

      if (comparison.status === "fulfilled") {
        setRows(Array.isArray(comparison.value) ? comparison.value : []);
      } else {
        setRows([]);
        setError(messageOf(comparison.reason) || "Could not load customer performance.");
      }

      if (kpis.status === "fulfilled") {
        setSummary(kpis.value ?? null);
      } else {
        setSummary(null);
        setSummaryError(messageOf(kpis.reason) || "Could not load the unique-customers summary.");
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    usesFixture,
    rangeA.start,
    rangeA.end,
    rangeB.start,
    rangeB.end,
    kpiStart,
    kpiEnd,
    growthPeriod,
    reloadToken
  ]);

  // The one label pair the headers, the KPI subtitles and the export filename all share.
  const labelA = useMemo(
    () => customerPerformancePeriodLabel({ ...periodA, mode: periodMode }, "Period A"),
    [periodA, periodMode]
  );
  const labelB = useMemo(
    () => customerPerformancePeriodLabel({ ...periodB, mode: periodMode }, "Period B"),
    [periodB, periodMode]
  );

  const columns = useMemo(
    () => [
      // Customer ID is the identifier the rows are actually KEYED on (`mergeComparisonRows`
      // pairs the two responses by it) and the one upstream showed first. `customer_code` is
      // frequently absent from `customers/performance`, so a code-only column read "—" for
      // most rows and left duplicate names indistinguishable. Both are shown now.
      { key: "customer_id", header: "Customer ID", type: "mono", sortable: true },
      { key: "customer_code", header: "Code", type: "mono", sortable: true },
      { key: "customer_name", header: "Customer", type: "text", sortable: true },
      { key: "customer_type", header: "Type", type: "text", sortable: true },
      { key: "zone", header: "Zone", type: "text", sortable: true },
      { key: "qtyA", header: `Qty · ${labelA}`, type: "number", decimals: 0, sortable: true },
      { key: "qtyB", header: `Qty · ${labelB}`, type: "number", decimals: 0, sortable: true },
      { key: "qtyChange", header: "Qty Δ", type: "number", decimals: 0, sortable: true },
      {
        key: "qtyChangePct",
        header: "Qty Δ%",
        type: "percent",
        sortable: true,
        render: (row) => <DeltaPct value={row?.qtyChangePct} />
      },
      { key: "valueA", header: `Value · ${labelA}`, type: "currency", sortable: true },
      { key: "valueB", header: `Value · ${labelB}`, type: "currency", sortable: true },
      { key: "valueChange", header: "Value Δ", type: "currency", sortable: true },
      {
        key: "valueChangePct",
        header: "Value Δ%",
        type: "percent",
        sortable: true,
        render: (row) => <DeltaPct value={row?.valueChangePct} />
      },
      { key: "last_purchased_date", header: "Last Order", type: "date", sortable: true }
    ],
    [labelA, labelB]
  );

  /**
   * Filter columns for the advanced panel, typed off the display columns (so numeric
   * operators land on the qty/value columns and the date operators on Last Order) with the
   * two enum dropdowns filled from the loaded rows — an optionless enum falls back to text
   * in `buildFilterColumns`, and a text filter on Zone is not the control the spec asks for.
   */
  const filterColumns = useMemo(() => {
    const typeOptions = buildEnumOptionsFromRows(rows, "customer_type");
    const zoneOptions = buildEnumOptionsFromRows(rows, "zone");
    const typed = columns.map((column) => {
      if (column.key === "customer_type") return { ...column, type: "badge", options: typeOptions };
      if (column.key === "zone") return { ...column, type: "badge", options: zoneOptions };
      return column;
    });
    return buildFilterColumns(typed, { includeDates: false });
  }, [columns, rows]);

  /** Quick chips mirror the two enum filters — one click, no panel. */
  const quickFilterChips = useMemo(() => {
    const withAll = (options) => [
      { value: QUICK_FILTER_ALL_VALUE, label: "All" },
      ...options
    ];
    return [
      {
        key: "customer_type",
        label: "Type",
        value: quickFilters.customer_type || QUICK_FILTER_ALL_VALUE,
        options: withAll(buildEnumOptionsFromRows(rows, "customer_type"))
      },
      {
        key: "zone",
        label: "Zone",
        value: quickFilters.zone || QUICK_FILTER_ALL_VALUE,
        options: withAll(buildEnumOptionsFromRows(rows, "zone"))
      }
    ].filter((chip) => chip.options.length > 1);
  }, [rows, quickFilters]);

  const filtered = useMemo(() => {
    let out = filterByOrderHistory(rows, historyMode);
    const query = search.trim();
    if (query) out = filterRowsBySearch(out, query, filterColumns);
    if (isFilterGroupActive(filters)) out = applyFilterGroup(out, filters, filterColumns);
    if (isQuickFilterActive(quickFilters)) {
      out = applyQuickFilters(out, quickFilters, filterColumns);
    }
    return out;
  }, [rows, historyMode, search, filters, quickFilters, filterColumns]);

  const sorted = useMemo(
    () => (sort.key ? sortRows(filtered, sort, columns) : filtered),
    [filtered, sort, columns]
  );

  // Any change to the result set or its ordering starts the reader back at page 1.
  useEffect(() => {
    setPage(1);
  }, [search, historyMode, filters, quickFilters, sort, rows, pageSize]);

  const pageRows = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  const toggleSort = useCallback((key) => {
    if (!key) return;
    setSort((prev) => nextSortDirection(prev, key));
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setFilters(createEmptyFilterGroup());
    setQuickFilters(createEmptyQuickFilterValues());
  }, []);

  const handleQuickFilterChange = useCallback((key, value) => {
    setQuickFilters((prev) => setQuickEnumFilter(prev, key, value));
  }, []);

  /**
   * CSV export — the house path (`exportReportCsv` over a `{headers, fieldMap, filename}`
   * block), with the ORIGINAL's 13 columns and their order, not this table's grouping.
   */
  const handleExport = useCallback(() => {
    const exportColumns = buildCustomerPerformanceColumns({ a: labelA, b: labelB });
    exportReportCsv({
      exportConfig: {
        entityName: "customer-performance",
        headers: reportExportHeaders(exportColumns),
        fieldMap: reportExportFieldMap(exportColumns),
        filename: () =>
          generateExportFilename(
            `customer-performance-${periodSlug(labelA)}-vs-${periodSlug(labelB)}`
          )
      },
      // The FILTERED + SORTED set, never `pageRows`.
      rows: sorted
    });
  }, [sorted, labelA, labelB]);

  const stats = useMemo(() => {
    const qtyA = sumBy(rows, "qtyA");
    const qtyB = sumBy(rows, "qtyB");
    const valueA = sumBy(rows, "valueA");
    const valueB = sumBy(rows, "valueB");
    const qtyPct = pctChange(qtyA, qtyB);
    const valuePct = pctChange(valueA, valueB);
    const deltaText = (pct) =>
      pct === undefined
        ? undefined
        : `${Math.abs(pct).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;

    return [
      {
        key: "unique",
        label: "Unique customers",
        value: summary?.totalUniqueCustomers,
        format: "number",
        decimals: 0,
        sub: kpiStart && kpiEnd ? `${kpiStart} → ${kpiEnd}` : undefined
      },
      {
        key: "custom",
        label: "Custom order customers",
        value: summary?.uniqueCustomOrder,
        format: "number",
        decimals: 0
      },
      {
        key: "readymade",
        label: "Readymade customers",
        value: summary?.uniqueReadymade,
        format: "number",
        decimals: 0
      },
      {
        key: "compared",
        label: "Customers compared",
        value: rows.length,
        format: "number",
        decimals: 0,
        sub: `${labelA} vs ${labelB}`
      },
      {
        key: "qty",
        label: `Qty · ${labelB}`,
        value: qtyB,
        format: "number",
        decimals: 0,
        delta: deltaText(qtyPct),
        deltaDir: qtyPct !== undefined && qtyPct < 0 ? "down" : "up",
        sub: `vs ${labelA}`
      },
      {
        key: "value",
        label: `Value · ${labelB}`,
        value: valueB,
        format: "currency",
        delta: deltaText(valuePct),
        deltaDir: valuePct !== undefined && valuePct < 0 ? "down" : "up",
        sub: `vs ${labelA}`
      }
    ];
  }, [rows, summary, kpiStart, kpiEnd, labelA, labelB]);

  return (
    <div className="h-full min-h-0 space-y-6 overflow-y-auto">
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Compare two periods</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          {/* The growth window comes FIRST: it decides what the two pickers below are. */}
          <div className="grid gap-1.5">
            <Label htmlFor="scott-perf-growth">Growth window</Label>
            <Select value={growthPeriod} onValueChange={setGrowthPeriod} disabled={loading}>
              <SelectTrigger id="scott-perf-growth" className="h-9 w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_PERFORMANCE_PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <PeriodPicker
            id="scott-perf-a"
            label="Period A (baseline)"
            mode={periodMode}
            period={periodA}
            yearOptions={yearOptions}
            disabled={loading}
            onChange={setPeriodA}
          />
          <PeriodPicker
            id="scott-perf-b"
            label="Period B (comparison)"
            mode={periodMode}
            period={periodB}
            yearOptions={yearOptions}
            disabled={loading}
            onChange={setPeriodB}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="lg:ml-auto"
            disabled={loading || usesFixture}
            onClick={() => setReloadToken((token) => token + 1)}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </CardContent>
      </Card>

      <ScottStatCards
        stats={stats}
        loading={loading}
        error={summaryError}
        columns={6}
        skeletonCount={6}
      />

      <Card className="border shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <ScottFilterBar
            columns={filterColumns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search customer, code, type, zone…"
            quickFilters={quickFilterChips}
            onQuickFilterChange={handleQuickFilterChange}
            filters={filters}
            onFiltersChange={setFilters}
            onClearAll={clearAllFilters}
            resultCount={sorted.length}
            totalCount={rows.length}
            loading={loading}
            idPrefix="scott-customer-performance"
            actions={
              <>
                <Select value={historyMode} onValueChange={setHistoryMode}>
                  <SelectTrigger className="h-9 sm:w-44" aria-label="Filter by order history">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_HISTORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={loading || sorted.length === 0}
                  onClick={handleExport}
                >
                  Export CSV
                </Button>
              </>
            }
          />

          <ScottTable
            columns={columns}
            rows={pageRows}
            sort={sort}
            onToggleSort={toggleSort}
            loading={loading}
            error={error}
            idField="customer_id"
            emptyMessage={
              search.trim() || historyMode !== "all" || isFilterGroupActive(filters)
                ? "No comparison rows match these filters."
                : `No customer performance data for ${labelA} or ${labelB}.`
            }
            skeletonRows={8}
          />

          <ScottPagination
            page={page}
            pageSize={pageSize}
            total={sorted.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            loading={loading}
            idPrefix="scott-customer-performance"
            itemLabel="customers"
          />
        </CardContent>
      </Card>
    </div>
  );
}
