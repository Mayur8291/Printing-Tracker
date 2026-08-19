// The always-visible quick-filter row for a report.
//
// Upstream every report page opted into `ReportFilterToolbar` -> `QuickFilterBar`
// (4 enum dropdowns + one date range) derived from that report's own filter columns. The
// port shipped `scott/list/quickFilters.js` and the quick-filter state in `useScottList`
// but never passed `quickFilters` to `ScottListPage`, so the row rendered nowhere and both
// were dead code: "Filter by Order Status", "Filter by Item Type" and the Order Date range
// were reachable only from inside the advanced-filter popover.
//
// This module is the missing derivation. It produces:
//   chips       -> `ScottListPage`/`ScottFilterBar`'s `quickFilters` (the house control is a
//                  cycling chip rather than a dropdown; the VALUES are identical, so the
//                  serialization in `quickFilters.js` and the engine are untouched)
//   dateColumn  -> the one date column the range control binds to
//
// Both read `FilterableColumn`s (`buildReportFilterColumns` shape), so a report opts in by
// declaring filter columns — which all seven already do.

import { QUICK_FILTER_ALL_VALUE } from "@/scott/list/quickFilters";

/** Upstream `maxEnumColumns` / `maxDateColumns` defaults. */
export const QUICK_FILTER_MAX_ENUM_COLUMNS = 4;

/**
 * Enum filter columns that can actually drive a control.
 *
 * An optionless enum is skipped: `ScottFilterBar` would render a chip that cycles through
 * nothing, and the engine treats an empty `is_any_of` as "matches every row" — the same
 * silently-inert control upstream disabled. (`ReportView.useReportEnumOptions` fills the
 * options in from the drained rows for the descriptors that declare none, so those columns
 * appear here as soon as that resolves.)
 */
export function quickFilterEnumColumns(columns, maxEnumColumns = QUICK_FILTER_MAX_ENUM_COLUMNS) {
  return (Array.isArray(columns) ? columns : [])
    .filter((column) => column?.type === "enum" && (column.options?.length ?? 0) > 0)
    .slice(0, Math.max(0, maxEnumColumns));
}

/** The single date column the quick date range binds to, or null. */
export function quickFilterDateColumn(columns) {
  return (
    (Array.isArray(columns) ? columns : []).find((column) => {
      const type = String(column?.type ?? "");
      return type === "date" || type === "datetime";
    }) ?? null
  );
}

/**
 * Filter columns + current quick values -> `ScottFilterBar` chips.
 *
 * Each chip carries the "all" sentinel as its FIRST option so cycling past the last value
 * returns to unset, and so `ScottListPage`'s Clear-all (which writes `QUICK_FILTER_ALL_VALUE`
 * into every chip) resolves to a cleared field.
 *
 * @param {Array<object>} columns filter columns (`buildReportFilterColumns` shape)
 * @param {Record<string, string|[string, string]>} values `list.quickFilters`
 * @param {number} [maxEnumColumns]
 * @returns {Array<{key: string, label: string, value: string, options: Array<{value: string, label: string}>}>}
 */
export function buildReportQuickFilterChips(columns, values, maxEnumColumns = QUICK_FILTER_MAX_ENUM_COLUMNS) {
  return quickFilterEnumColumns(columns, maxEnumColumns).map((column) => {
    const name = String(column.name ?? column.key);
    const raw = values?.[column.key];
    return {
      key: column.key,
      label: `Filter by ${name}`,
      value: typeof raw === "string" && raw !== "" ? raw : QUICK_FILTER_ALL_VALUE,
      options: [
        { value: QUICK_FILTER_ALL_VALUE, label: `All ${name}s` },
        ...column.options.map((option) => ({
          value: String(option?.value ?? option),
          label: String(option?.label ?? option?.value ?? option)
        }))
      ]
    };
  });
}

/** `[from, to]` for a date column, normalised to two strings. */
export function quickFilterDateRange(values, key) {
  const raw = values?.[key];
  return Array.isArray(raw) ? [String(raw[0] ?? ""), String(raw[1] ?? "")] : ["", ""];
}

export default buildReportQuickFilterChips;
