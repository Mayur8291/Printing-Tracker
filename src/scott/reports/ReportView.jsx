// The generic report screen — one component behind six of the seven reports.
//
//   report-level filters (registry `filters`)  ->  stat tiles  ->  list  ->  pagination
//
// It reads a registry descriptor and nothing else, which is why RMP Sales' four tabs are
// just four descriptors handed to the same component. `ScottListPage` supplies the search /
// advanced-filter / table / pagination shell, and `useScottList` supplies the hybrid
// server<->full-dataset behaviour that the master lists use, so sorting and filtering feel
// identical here.
//
// READ-ONLY: `mayEdit` is hard-coded false, so no create/edit/delete affordance can ever
// appear. `ScottListPage` still shows Export for read-only users, which is the intent —
// anyone who can see a report can take it away as CSV.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isInventoryReportApiPending,
  isWhConfigPending
} from "@/scott/data/reports/totalInventoryService";
import { buildEnumOptionsFromRows } from "@/scott/list/filterEngine";
import { setQuickDateRange, setQuickEnumFilter } from "@/scott/list/quickFilters";
import useScottList from "@/scott/list/useScottList";
import ScottListPage from "@/scott/ui/ScottListPage";
import ReportDetailDialog from "@/scott/reports/ReportDetailDialog";
import ReportFilterBar from "@/scott/reports/ReportFilters";
import { ReportQuickDateRange } from "@/scott/reports/ReportFilters";
import {
  buildReportQuickFilterChips,
  quickFilterDateColumn,
  quickFilterDateRange
} from "@/scott/reports/reportQuickFilters";
// Split rather than `import Default, { Named }`: scripts/check-ui-gate.mjs only records the
// first binding of a mixed statement and then reports the other one as a missing import.
import ReportStatsRow from "@/scott/reports/ReportStatsRow";
import { useReportStats } from "@/scott/reports/ReportStatsRow";
import { ReportBreakdownCards } from "@/scott/reports/ReportStatsRow";
import { toScottTableColumns } from "@/scott/reports/reportColumns";
import { exportReportCsv } from "@/scott/reports/reportExport";
import { buildReportRequest, resetReportDrainCache } from "@/scott/reports/reportRequests";

/** Registry filter defaults -> the report's opening filter state. */
export function defaultFilterValues(report) {
  const values = {};
  for (const field of report?.filters ?? []) {
    if (!field?.key) continue;
    // `default` is produced by the service (createDefault…), so the documented opening
    // state — today−1yr ranges, `pending`/`completed` report types — comes from there.
    values[field.key] = typeof field.default === "function" ? field.default() : field.default;
  }
  return values;
}

/**
 * Filter keys the registry marks `perTab` — each sub-tab keeps its OWN value for them.
 *
 * RMP Sales upstream holds four independent period states (`overviewPeriod`, `brandPeriod`,
 * `classPeriod`, `coordinatorPeriod`); collapsing them into one shared value meant narrowing
 * the Brand tab silently re-scoped Overview the moment you switched back.
 */
export function perTabFilterKeys(report) {
  return (report?.filters ?? []).filter((field) => field?.perTab && field.key).map((field) => field.key);
}

/** Report-level values with the active tab's per-tab overrides applied. */
export function mergeTabFilterValues(values, overrides, keys) {
  if (!overrides || !(keys?.length > 0)) return values;
  const out = { ...values };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) out[key] = overrides[key];
  }
  return out;
}

/** Banners that explain an empty table before the user files a bug about it. */
function ReportNotices({ reportKey }) {
  if (reportKey !== "total_inventory") return null;
  const apiPending = isInventoryReportApiPending();
  const whPending = isWhConfigPending();
  if (!apiPending && !whPending) return null;

  return (
    <Alert>
      <AlertDescription className="space-y-1 text-sm">
        {apiPending ? (
          <p>
            The inventory API is disabled for this build (<code>VITE_INVENTORY_REPORT_API_ENABLED=false</code>),
            so this report has no upstream data.
          </p>
        ) : null}
        {whPending ? (
          <p>
            Warehouse names are not configured (<code>VITE_INVENTORY_REPORT_WH1_NAME</code> /
            <code> VITE_INVENTORY_REPORT_WH2_NAME</code>); per-warehouse stock falls back to the total.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** The enum filter columns a descriptor declares with no `options` — the inert ones. */
export function optionlessEnumKeys(columns) {
  return (Array.isArray(columns) ? columns : [])
    .filter((column) => column?.type === "enum" && !Array.isArray(column?.options))
    .map((column) => column.key);
}

/**
 * Merge row-derived options into the declared filter columns.
 * A declared `options` array always wins; an empty derivation is left alone.
 * @param {Array<object>} columns
 * @param {Record<string, Array<{value: string, label: string}>>|null} derived
 * @returns {Array<object>}
 */
export function applyDerivedEnumOptions(columns, derived) {
  if (!derived) return columns;
  return (Array.isArray(columns) ? columns : []).map((column) => {
    const options = derived[column?.key];
    if (!Array.isArray(options) || options.length === 0) return column;
    if (column?.type !== "enum" || Array.isArray(column?.options)) return column;
    return { ...column, options };
  });
}

/**
 * Fill in the `options` of enum filter columns the descriptor declares WITHOUT any.
 *
 * `ScottFilterBar` renders "No options available" for an optionless enum and the condition
 * then falls through as `is_any_of []`, which the engine treats as "matches every row" — a
 * silently inert control. Customer Performance's Customer Type and Zone are exactly that
 * case, and the spec builds both from the loaded rows
 * (`buildCustomerPerformanceFilterColumns(labels, rows)` → `buildEnumOptionsFromRows`).
 *
 * The rows come from `request.fetchAll()`, which is the 30 s-cached drain the stat tiles and
 * the CSV export already share, so this costs no extra upstream call. A failure leaves the
 * declared columns untouched.
 *
 * @param {Array<object>} columns declared filter columns
 * @param {{cacheKey: string, fetchAll: () => Promise<object[]>}} request
 * @returns {Array<object>}
 */
export function useReportEnumOptions(columns, request) {
  const [derived, setDerived] = useState(null);

  const pending = useMemo(() => optionlessEnumKeys(columns), [columns]);

  const pendingKey = pending.join("|");
  const cacheKey = request?.cacheKey ?? "";
  const fetchAll = request?.fetchAll;

  useEffect(() => {
    if (pending.length === 0 || typeof fetchAll !== "function") {
      setDerived(null);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchAll();
        if (cancelled) return;
        const next = {};
        for (const key of pending) next[key] = buildEnumOptionsFromRows(rows, key);
        setDerived(next);
      } catch {
        // The list itself already surfaces the failure; leave the filters as declared.
        if (!cancelled) setDerived(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, cacheKey, fetchAll]);

  return useMemo(() => applyDerivedEnumOptions(columns, derived), [columns, derived]);
}

/**
 * @param {object} props
 * @param {object} props.report registry descriptor.
 * @param {Array<object>} [props.tabs] sub-tab descriptors (RMP Sales).
 * @param {string} [props.activeTab] active sub-tab key.
 * @param {(key: string) => void} [props.onTabChange]
 * @param {(message: unknown) => void} [props.toast]
 * @param {(message: unknown) => void} [props.toastError]
 * @param {(values: object) => import("react").ReactNode} [props.renderExtras]
 *   Extra content under the stat tiles, given the live filter values (Customer Performance
 *   uses it for the `unique_customers` KPI row, which is a separate endpoint).
 */
export default function ReportView({
  report,
  tabs = null,
  activeTab,
  onTabChange,
  toast,
  toastError,
  renderExtras
}) {
  const [values, setValues] = useState(() => defaultFilterValues(report));
  // { [tabKey]: { [perTabFilterKey]: value } } — absent entries fall through to `values`.
  const [tabFilterValues, setTabFilterValues] = useState({});
  const [statsToken, setStatsToken] = useState(0);
  const [detailRow, setDetailRow] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const tab = useMemo(
    () => (Array.isArray(tabs) ? (tabs.find((t) => t.key === activeTab) ?? tabs[0]) : null),
    [tabs, activeTab]
  );

  const perTabKeys = useMemo(() => perTabFilterKeys(report), [report]);
  const activeTabKey = tab?.key ?? "";
  const effectiveValues = useMemo(
    () => mergeTabFilterValues(values, tabFilterValues[activeTabKey], perTabKeys),
    [values, tabFilterValues, activeTabKey, perTabKeys]
  );

  // Tab-level descriptors win; the report-level ones are the single-tab case.
  const descriptor = tab ?? report;
  const statsConfig = tab?.stats ?? report?.stats ?? null;
  const fetchById = report?.service?.fetchById;
  const hasDetail = Boolean(report?.detailRoute && typeof fetchById === "function");

  const valuesKey = JSON.stringify(effectiveValues);
  const request = useMemo(
    () => buildReportRequest({ report, tab, values: effectiveValues }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report?.key, tab?.key, valuesKey]
  );

  // A descriptor may build its columns / filter columns / export block FROM the applied
  // filters — Customer Performance names both comparison periods in its qty/value headers
  // and in the export filename (spec §12). Memoised on `valuesKey` so the identities stay
  // stable between filter changes and `listConfig` below cannot churn per render.
  const reportColumns = useMemo(
    () =>
      typeof descriptor?.buildColumns === "function"
        ? descriptor.buildColumns(effectiveValues)
        : (descriptor?.columns ?? report?.columns ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [descriptor, report?.columns, valuesKey]
  );

  const declaredFilterColumns = useMemo(
    () =>
      typeof descriptor?.buildFilterColumns === "function"
        ? descriptor.buildFilterColumns(effectiveValues)
        : (descriptor?.filterColumns ?? report?.filterColumns ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [descriptor, report?.filterColumns, valuesKey]
  );

  const exportConfig = useMemo(() => {
    const base = descriptor?.export ?? report?.export ?? null;
    if (!base || typeof base.build !== "function") return base;
    return { ...base, ...base.build(effectiveValues) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor, report?.export, valuesKey]);

  const filterColumns = useReportEnumOptions(declaredFilterColumns, request);

  const tableColumns = useMemo(() => toScottTableColumns(reportColumns), [reportColumns]);

  const listConfig = useMemo(
    () => ({
      key: `${report?.key ?? "report"}:${tab?.key ?? "-"}`,
      idField: "id",
      label: tab?.label ?? report?.label ?? "records",
      singularLabel: "record",
      pageSize: report?.pageSize ?? 20,
      columns: tableColumns,
      filterColumns,
      supportsBulkDelete: false,
      // Report endpoints do not take `search` — all but three drop the param silently — so
      // searching in server mode changed nothing at all. `searchMode: 'client'` makes a query
      // flip the list into full-dataset mode and run through `filterRowsBySearch`, which is
      // what the original report hook did (`isClientFilterActive` counted `debouncedSearch`).
      searchMode: "client",
      fetchAllOptions: report?.fetchAll
    }),
    [report?.key, report?.label, report?.pageSize, report?.fetchAll, tab?.key, tab?.label, tableColumns, filterColumns]
  );

  const fetchPage = useCallback((args) => request.fetchPage(args), [request]);
  const fetchAll = useCallback(() => request.fetchAll(), [request]);
  const list = useScottList({ config: listConfig, fetchPage, fetchAll });

  const { setPage, refresh, setQuickFilters } = list;

  // ---- quick filters (the always-visible row upstream showed on every report) ----
  //
  // `useScottList` has held the state and the engine wiring all along; only the derivation
  // and the two setters were missing, so this is pure wiring — no new filtering semantics.
  const quickFilterChips = useMemo(
    () => buildReportQuickFilterChips(filterColumns, list.quickFilters),
    [filterColumns, list.quickFilters]
  );

  const quickDateColumn = useMemo(() => quickFilterDateColumn(filterColumns), [filterColumns]);

  const handleQuickFilterChange = useCallback(
    (key, next) => setQuickFilters((prev) => setQuickEnumFilter(prev, key, next)),
    [setQuickFilters]
  );

  const handleQuickDateChange = useCallback(
    (key, from, to) => setQuickFilters((prev) => setQuickDateRange(prev, key, from, to)),
    [setQuickFilters]
  );

  // A report-level filter change alters what is REQUESTED, and `useScottList` cannot see
  // that (its fetch effects key off page/pageSize/search/reloadToken). Snap back to page 1
  // and invalidate — batched, so it costs one fetch, not two.
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    setPage(1);
    refresh();
  }, [request.cacheKey, setPage, refresh]);

  const statsState = useReportStats({ stats: statsConfig, request, reloadToken: statsToken });

  // TILES THAT MUST HONOUR THE ACTIVE FILTERS.
  //
  // `stats.compute` runs over the whole drained dataset, which is right for a report-wide
  // total but wrong for the RMP Sales brand / class / coordinator tiles: upstream computes
  // those from the DISPLAYED rows (`displayBrandRows` & co.), so filtering to one brand
  // re-totals the tiles instead of leaving them contradicting the table. Those descriptors
  // set `overFilteredRows`, and whenever a client-side filter/search/sort is active
  // (`mode === 'full'`, the only mode in which `processedRows` is populated) the compute is
  // re-run over the filtered set. With no filter active the two are the same rows.
  const filteredStats = useMemo(() => {
    if (statsConfig?.overFilteredRows !== true) return null;
    if (typeof statsConfig?.compute !== "function") return null;
    if (list.mode !== "full" || list.loading) return null;
    return statsConfig.compute(list.processedRows);
  }, [statsConfig, list.mode, list.loading, list.processedRows]);

  // When the filtered recompute supplied the tiles, the drain's own loading/error state is
  // irrelevant to them — the numbers on screen are already correct and complete.
  const usingFilteredStats = filteredStats !== null;
  const tileStats = usingFilteredStats ? filteredStats : statsState.stats;

  const handleRefresh = useCallback(() => {
    resetReportDrainCache(); // otherwise Refresh would replay the cached drain
    setStatsToken((token) => token + 1);
    refresh();
  }, [refresh]);

  // `ScottListPage` calls `list.refresh` itself (header button + the error card's Retry),
  // so the cache-clearing version has to be swapped in rather than sat beside it.
  const listForPage = useMemo(() => ({ ...list, refresh: handleRefresh }), [list, handleRefresh]);

  const handleExport = useCallback(async () => {
    if (!exportConfig) return;
    try {
      // `processedRows` is the filtered+sorted set; in server mode it is empty, so the
      // drained dataset is the honest source — never just the visible page.
      const rows = list.mode === "full" ? list.processedRows : await request.fetchAll();
      const count = exportReportCsv({
        exportConfig,
        rows,
        // Only the RMP Sales overview map takes an argument (the status fallback); the
        // other factories ignore it.
        fieldMapArgs: [effectiveValues?.reportType ?? ""]
      });
      toast?.(`Exported ${count.toLocaleString("en-IN")} rows to CSV.`);
    } catch (error) {
      toastError?.(error);
    }
  }, [exportConfig, list.mode, list.processedRows, request, effectiveValues?.reportType, toast, toastError]);

  const openDetail = useCallback((row) => {
    setDetailRow(row);
    setDetailOpen(true);
  }, []);

  const handleFilterChange = useCallback(
    (key, next) => {
      if (activeTabKey && perTabKeys.includes(key)) {
        setTabFilterValues((prev) => ({
          ...prev,
          [activeTabKey]: { ...(prev[activeTabKey] ?? {}), [key]: next }
        }));
        return;
      }
      setValues((prev) => ({ ...prev, [key]: next }));
    },
    [activeTabKey, perTabKeys]
  );

  const busy = list.loading || statsState.loading;

  return (
    <>
      <ScottListPage
        config={listConfig}
        list={listForPage}
        title={report?.label}
        subtitle={report?.description}
        mayEdit={false}
        selectable={false}
        fullHeight={false}
        onExport={exportConfig ? handleExport : undefined}
        onEdit={hasDetail ? openDetail : undefined}
        quickFilters={quickFilterChips}
        onQuickFilterChange={handleQuickFilterChange}
        searchPlaceholder={`Search ${(tab?.label ?? report?.label ?? "records").toLowerCase()}…`}
        emptyMessage="No rows for the selected filters."
      >
        {Array.isArray(tabs) && tabs.length > 1 ? (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <Tabs value={tab?.key ?? tabs[0].key} onValueChange={(next) => onTabChange?.(next)}>
              <TabsList aria-label={`${report?.label} views`}>
                {tabs.map((entry) => (
                  <TabsTrigger key={entry.key} value={entry.key}>
                    {entry.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <ReportNotices reportKey={report?.key} />

        <ReportFilterBar
          fields={report?.filters}
          values={effectiveValues}
          onChange={handleFilterChange}
          idPrefix={`${report?.key}-${tab?.key ?? "main"}`}
          activeTab={tab?.key}
          disabled={busy}
          extras={
            quickDateColumn ? (
              <ReportQuickDateRange
                id={`${report?.key}-${tab?.key ?? "main"}-quick-${quickDateColumn.key}`}
                label={String(quickDateColumn.name ?? quickDateColumn.key)}
                value={quickFilterDateRange(list.quickFilters, quickDateColumn.key)}
                onChange={(from, to) => handleQuickDateChange(quickDateColumn.key, from, to)}
                disabled={busy}
              />
            ) : null
          }
        />

        <ReportStatsRow
          tiles={statsConfig?.tiles}
          stats={tileStats}
          loading={usingFilteredStats ? false : statsState.loading}
          error={usingFilteredStats ? "" : statsState.error}
          paginationTotal={list.pagination?.totalCount}
          rows={list.rows}
          onRetry={handleRefresh}
        />

        {/* RMP Sales Overview only — no other `compute` produces `customerTypeBreakdown`. */}
        <ReportBreakdownCards rows={statsState.stats?.customerTypeBreakdown} />

        {typeof renderExtras === "function" ? renderExtras(effectiveValues) : null}
      </ScottListPage>

      {hasDetail ? (
        <ReportDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          row={detailRow}
          columns={reportColumns}
          fetchById={fetchById}
          title={`${report?.label} — detail`}
        />
      ) : null}
    </>
  );
}
