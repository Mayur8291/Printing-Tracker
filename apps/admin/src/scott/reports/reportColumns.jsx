// Report column defs -> ScottTable column configs.
//
// The two shapes are different on purpose:
//
//   report column   { label, keys[], format, formatValue, relation, badge, sticky, computed }
//                   — owned by `src/scott/data/reports/*`, and ALSO the source of the CSV
//                     field map (`reportExportFieldMap`).
//   ScottTable col  { key, header, type, render, sortable, align, className }
//
// Every cell here renders through `getReportCellValue`, the SAME function the export field
// map uses. That is the whole point of the adapter: what the table shows and what the CSV
// contains can never drift, including the `-` empty placeholder (reports spec) rather than
// ScottTable's own `—`.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getReportCellValue } from "@/scott/data/reports/reportShared";
import { resolveColumnSortType } from "@/scott/list/tableSort";
import { SCOTT_TONE_STYLES } from "@/scott/ui/ScottTable";

/** Formats that right-align and get tabular numerals. */
const NUMERIC_FORMATS = new Set(["number", "currency", "percent"]);

/** Cell strings that mean "no value" and must never be wrapped in a badge. */
const PLACEHOLDER_CELLS = new Set(["", "-", "—"]);

/** Report configs say `destructive`; `SCOTT_TONE_STYLES` calls that tone `danger`. */
const TONE_ALIASES = Object.freeze({ destructive: "danger", error: "danger", ok: "success" });

const DEFAULT_TONES = Object.freeze({
  active: "success",
  completed: "success",
  delivered: "success",
  dispatched: "success",
  paid: "success",
  "in stock": "success",
  pending: "warning",
  partial: "warning",
  processing: "warning",
  overdue: "danger",
  failed: "danger",
  cancelled: "danger",
  "out of stock": "danger",
  oos: "danger"
});

/** @returns {string} a key into `SCOTT_TONE_STYLES`. */
export function resolveReportBadgeTone(column, value) {
  const token = String(value ?? "").trim().toLowerCase();
  const raw =
    (typeof column?.tone === "function" ? column.tone(value) : undefined) ??
    column?.tones?.[token] ??
    DEFAULT_TONES[token] ??
    "neutral";
  const tone = TONE_ALIASES[raw] ?? raw;
  return SCOTT_TONE_STYLES[tone] ? tone : "neutral";
}

/**
 * The field a column reads/sorts on. `sortKey` wins, then the first alias, then the label —
 * matching `resolveColumnSortKey` in `tableSort.js` so the header key and the sort key agree.
 */
export function resolveReportColumnKey(column) {
  return String(column?.sortKey ?? column?.keys?.[0] ?? column?.label ?? "");
}

/**
 * One report column -> one ScottTable column.
 * @param {import('@/scott/data/reports/reportShared').ReportColumnDef} column
 * @returns {object}
 */
export function toScottTableColumn(column) {
  const key = resolveReportColumnKey(column);
  const numeric = NUMERIC_FORMATS.has(String(column?.format ?? ""));
  const sticky = column?.sticky === "left";

  return {
    key,
    header: column?.label ?? key,
    // `type` stays "text": the renderer below already formats the value, and letting
    // ScottTable re-format a formatted string would double-process it.
    type: "text",
    align: numeric ? "right" : undefined,
    // A computed column (fill rate, growth %) has no backing field, so by default there is
    // nothing to sort on. Declaring `sortValue(row)` supplies one — `tableSort.getRowSortValue`
    // prefers `getSortValue` over the raw cell — which is what makes the fill-rate headers
    // sortable numerically instead of alphabetically over "12.5%" / "N/A".
    sortable:
      column?.sortable !== false &&
      key !== "" &&
      (column?.computed !== true || typeof column?.sortValue === "function"),
    sortType: resolveColumnSortType(column),
    ...(typeof column?.sortValue === "function" ? { getSortValue: column.sortValue } : {}),
    className: cn(numeric && "tabular-nums", sticky && "sticky left-0 z-[1] bg-card"),
    headerClassName: cn(sticky && "sticky left-0 z-[11] bg-card"),
    render: (row) => {
      const text = getReportCellValue(row, column);
      if (!column?.badge) return text;
      // A badge around a placeholder reads as a value, so keep those plain. `-` is the
      // reports-spec placeholder; `—` is what an undefined growth percentage renders as.
      if (PLACEHOLDER_CELLS.has(text)) return <span className="text-muted-foreground">{text || "-"}</span>;
      return (
        <Badge variant="outline" className={cn("font-normal", SCOTT_TONE_STYLES[resolveReportBadgeTone(column, text)])}>
          {text}
        </Badge>
      );
    }
  };
}

/**
 * Adapt a whole column list, guaranteeing DISTINCT keys.
 *
 * Two report columns can legitimately share a first alias — Order Tracking declares both
 * "Order ID" and "Order Number" over `order_number`. A shared key would give React duplicate
 * child keys and would make `onToggleSort` address whichever header matched first, so the
 * repeat gets a suffixed key plus an explicit accessor that still sorts on the real field.
 *
 * @param {Array<object>} columns report column defs
 * @returns {Array<object>} ScottTable columns
 */
export function toScottTableColumns(columns) {
  const used = new Map();

  return (Array.isArray(columns) ? columns : []).filter(Boolean).map((column) => {
    const adapted = toScottTableColumn(column);
    const base = adapted.key;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    if (seen === 0) return adapted;
    // A column that declared its own `sortValue` keeps it — the field fallback is only for
    // repeats that really do read the shared field.
    return {
      ...adapted,
      key: `${base}__${seen + 1}`,
      getSortValue: adapted.getSortValue ?? ((row) => row?.[base])
    };
  });
}

export default toScottTableColumns;
