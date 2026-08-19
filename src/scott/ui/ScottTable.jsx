// Generic sortable data table for every Scott list / report.
//
// MUST render through the shadcn `Table` component: it emits `data-shadcn-table`, and
// `src/index.css` keys the legacy-CSS reset off that attribute. A raw <table> silently
// inherits the 16k-line legacy stylesheet and looks broken.

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { EmptyHint, SortIndicator } from "@/inventory/inventoryUiUtils";
import { cn } from "@/lib/utils";
import { relationDisplayText } from "@/scott/list/filterEngine";
import { proxifyScottImageUrl } from "@/scott/scottImage";

/** Header cell classes — dense list-page rhythm from the house template. */
export const SCOTT_HEAD_CLASS = "h-11 whitespace-nowrap px-4 text-xs font-medium text-muted-foreground";
/** Body cell classes. */
export const SCOTT_CELL_CLASS = "px-4 py-3 align-middle";
/** Trailing actions column. */
export const SCOTT_ACTIONS_CELL_CLASS = "min-w-[9rem] px-4 py-3 text-right align-middle";

/**
 * Badge tones. Unlike `STOCK_STATUS_STYLES` in `inventoryUiUtils` these carry dark
 * variants, because every Scott screen must read correctly in both themes.
 */
export const SCOTT_TONE_STYLES = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
  danger:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400",
  neutral:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600/50 dark:bg-slate-500/10 dark:text-slate-300",
  info:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-400"
};

/** Cell types that are numeric and therefore right-aligned. */
const NUMERIC_TYPES = new Set(["number", "currency", "percent"]);

const TRUTHY = new Set(["true", "1", "yes", "y", "active", "enabled", "on"]);
const FALSY = new Set(["false", "0", "no", "n", "inactive", "disabled", "off"]);

const DEFAULT_BADGE_TONES = {
  active: "success",
  approved: "success",
  completed: "success",
  done: "success",
  delivered: "success",
  paid: "success",
  pending: "warning",
  processing: "warning",
  partial: "warning",
  hold: "warning",
  inactive: "neutral",
  draft: "neutral",
  archived: "neutral",
  deleted: "danger",
  cancelled: "danger",
  canceled: "danger",
  failed: "danger",
  rejected: "danger"
};

/** Em dash placeholder — the house empty-cell convention. */
export const EMPTY_CELL = "—";

function isBlank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/** @param {unknown} value @returns {string} trimmed text or the em dash placeholder. */
export function formatScottText(value) {
  const text = String(value ?? "").trim();
  return text || EMPTY_CELL;
}

/** @param {unknown} value @returns {string} localised integer/decimal, or em dash. */
export function formatScottNumber(value, maximumFractionDigits = 2) {
  if (isBlank(value)) return EMPTY_CELL;
  const n = Number(value);
  if (!Number.isFinite(n)) return formatScottText(value);
  return n.toLocaleString("en-IN", { maximumFractionDigits });
}

/** @param {unknown} value @returns {string} `₹1,23,456.78`, or em dash. */
export function formatScottCurrency(value) {
  if (isBlank(value)) return EMPTY_CELL;
  const n = Number(value);
  if (!Number.isFinite(n)) return formatScottText(value);
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** @param {unknown} value @returns {string} `12.5%`, or em dash. */
export function formatScottPercent(value) {
  if (isBlank(value)) return EMPTY_CELL;
  const n = Number(value);
  if (!Number.isFinite(n)) return formatScottText(value);
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

/** @param {unknown} value ISO string, `yyyy-MM-dd`, epoch ms or Date. @returns {string} `05 Mar 2024`. */
export function formatScottDate(value) {
  if (isBlank(value)) return EMPTY_CELL;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return formatScottText(value);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * `05 Mar 2024, 04:03 pm` — the house date format plus a time, for the `datetime` /
 * `timestamp` columns every master carries as Created At / Updated At. Without it those
 * cells fell through to `text` and printed the raw ISO string.
 * @param {unknown} value ISO string, epoch ms or Date.
 * @returns {string}
 */
export function formatScottDateTime(value) {
  if (isBlank(value)) return EMPTY_CELL;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return formatScottText(value);
  const day = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** @param {unknown} value @returns {boolean | null} tri-state read of an API truthy flag. */
export function readScottBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (isBlank(value)) return null;
  const text = String(value).trim().toLowerCase();
  if (TRUTHY.has(text)) return true;
  if (FALSY.has(text)) return false;
  return null;
}

function toneForBadge(column, value) {
  if (typeof column?.tone === "function") return column.tone(value) || "neutral";
  const key = String(value ?? "").trim().toLowerCase();
  if (column?.tones && column.tones[key]) return column.tones[key];
  return DEFAULT_BADGE_TONES[key] || "neutral";
}

function labelForValue(column, value) {
  const options = Array.isArray(column?.options) ? column.options : null;
  if (options) {
    const hit = options.find((o) => String(o?.value ?? o?.id ?? o) === String(value));
    if (hit) return String(hit.label ?? hit.name ?? hit.value ?? hit.id ?? hit);
  }
  return formatScottText(value);
}

/**
 * Display text for ONE relation value. Two shapes reach these columns:
 *   * an embedded object — `{id, name}` / `{id, title}` / `{id, code}` → its name;
 *   * a bare id string — resolved against `column.options` (the masters layer injects the
 *     related master's drained options for columns carrying `optionsResource`), else `#id`.
 * @returns {string} display text, or `''` when there is nothing to show.
 */
export function relationLabel(column, value) {
  // Delegated to the filter engine's projection so the TABLE and the FILTER read one
  // resolution: filtering a relation column by the name on screen has to match the row that
  // shows it (`relationDisplayText` is what `buildFilterColumns` attaches as `getValue`).
  return relationDisplayText(column, value);
}

/** Hex ready for a `backgroundColor`, or `''`. */
function swatchHex(raw) {
  const hex = String(raw ?? "").trim();
  if (!hex) return "";
  return /^#?[0-9a-f]{3,8}$/i.test(hex) ? (hex.startsWith("#") ? hex : `#${hex}`) : hex;
}

/** Every image url an `image-list` column can show, in slot order. */
export function imageListUrls(column, row) {
  const slots = Array.isArray(column?.imageSlots) && column.imageSlots.length > 0
    ? column.imageSlots
    : [column?.key];
  const suffix = typeof column?.thumbSuffix === "string" ? column.thumbSuffix : "";
  const urls = [];
  for (const slot of slots) {
    if (!slot) continue;
    const thumb = suffix ? readScottCellValue(row, `${slot}${suffix}`) : undefined;
    const raw = thumb ?? readScottCellValue(row, slot);
    const src = proxifyScottImageUrl(typeof raw === "object" ? (raw?.url ?? raw?.image_url) : raw);
    if (src) urls.push(src);
  }
  return urls;
}

/**
 * Read a (possibly dotted) column key off a row.
 * @param {object} row
 * @param {string} key e.g. `"customer.name"`
 */
export function readScottCellValue(row, key) {
  if (!row || !key) return undefined;
  if (!String(key).includes(".")) return row[key];
  return String(key)
    .split(".")
    .reduce((acc, part) => (acc == null ? acc : acc[part]), row);
}

/**
 * Render one cell body for a column config.
 * @param {object} column column config (see CONFIG SHAPE in SCOTT-ARCHITECTURE.md)
 * @param {object} row the normalized row
 * @returns {import("react").ReactNode}
 */
export function renderScottCell(column, row) {
  if (typeof column?.render === "function") return column.render(row);

  const raw = readScottCellValue(row, column?.key);
  const value = typeof column?.format === "function" ? column.format(raw, row) : raw;

  switch (column?.type) {
    case "number":
      return <span className="tabular-nums">{formatScottNumber(value, column.decimals ?? 2)}</span>;

    case "currency":
      return <span className="tabular-nums">{formatScottCurrency(value)}</span>;

    case "percent":
      return <span className="tabular-nums">{formatScottPercent(value)}</span>;

    case "date":
      return <span className="whitespace-nowrap">{formatScottDate(value)}</span>;

    case "datetime":
    case "timestamp":
      return <span className="whitespace-nowrap">{formatScottDateTime(value)}</span>;

    case "link": {
      const href = String(value ?? "").trim();
      if (!href) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      // House anchor pattern (see `OrderDetailPanel`): a shadcn link-variant Button with
      // `asChild`, never a bare <a> — a raw anchor inherits the legacy stylesheet.
      const safe = /^(https?:|mailto:|tel:)/i.test(href) ? href : `https://${href}`;
      return (
        <Button variant="link" className="h-auto max-w-[22rem] justify-start truncate px-0" asChild>
          <a href={safe} target="_blank" rel="noopener noreferrer" title={href}>
            {column.linkLabel || href}
          </a>
        </Button>
      );
    }

    case "badge": {
      if (isBlank(value)) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      return (
        <Badge variant="outline" className={cn("font-normal", SCOTT_TONE_STYLES[toneForBadge(column, value)])}>
          {labelForValue(column, value)}
        </Badge>
      );
    }

    case "color": {
      const hex = String(value ?? "").trim();
      if (!hex) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      const swatch = /^#?[0-9a-f]{3,8}$/i.test(hex) ? (hex.startsWith("#") ? hex : `#${hex}`) : hex;
      return (
        <span className="flex items-center gap-2">
          <span
            className="inline-block size-4 shrink-0 rounded-full border shadow-sm"
            style={{ backgroundColor: swatch }}
            aria-hidden
          />
          <span className="font-mono text-xs uppercase">{swatch}</span>
        </span>
      );
    }

    case "image": {
      const src = proxifyScottImageUrl(value);
      if (!src) {
        return (
          <span className="flex size-10 items-center justify-center rounded-md border bg-muted/40 text-[10px] text-muted-foreground">
            {EMPTY_CELL}
          </span>
        );
      }
      return (
        <span className="block size-10 overflow-hidden rounded-md border bg-muted/40">
          <img
            src={src}
            alt={column.alt || String(column.header || "Preview")}
            loading="lazy"
            className="size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        </span>
      );
    }

    case "boolean": {
      const flag = readScottBoolean(value);
      if (flag === null) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      return (
        <Badge
          variant="outline"
          className={cn("font-normal", SCOTT_TONE_STYLES[flag ? "success" : "neutral"])}
        >
          {flag ? column.trueLabel || "Yes" : column.falseLabel || "No"}
        </Badge>
      );
    }

    case "relation": {
      const text = relationLabel(column, value);
      if (!text) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      return <span className="whitespace-nowrap">{text}</span>;
    }

    case "relation-list": {
      const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
      const labels = list.map((item) => relationLabel(column, item)).filter(Boolean);
      if (labels.length === 0) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      const shown = labels.slice(0, column.maxItems ?? 3);
      return (
        <span className="flex flex-wrap items-center gap-1">
          {shown.map((label, index) => (
            <Badge key={`${label}-${index}`} variant="secondary" className="font-normal">
              {label}
            </Badge>
          ))}
          {labels.length > shown.length ? (
            <span className="text-xs text-muted-foreground">+{labels.length - shown.length}</span>
          ) : null}
        </span>
      );
    }

    case "colors": {
      const list = Array.isArray(value) ? value : [];
      if (list.length === 0) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
      const shown = list.slice(0, column.maxItems ?? 6);
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {shown.map((entry, index) => {
            const name = String(entry?.name ?? "").trim() || `#${entry?.id ?? index}`;
            const hex = swatchHex(entry?.hex_code ?? entry?.code ?? entry);
            return (
              <span
                key={`${entry?.id ?? name}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-0.5 pr-2"
                title={hex ? `${name} ${hex}` : name}
              >
                <span
                  className="inline-block size-4 shrink-0 rounded-full border"
                  style={hex ? { backgroundColor: hex } : undefined}
                  aria-hidden
                />
                <span className="text-xs">{name}</span>
              </span>
            );
          })}
          {list.length > shown.length ? (
            <span className="text-xs text-muted-foreground">+{list.length - shown.length}</span>
          ) : null}
        </span>
      );
    }

    case "image-list": {
      const urls = imageListUrls(column, row);
      if (urls.length === 0) {
        return (
          <span className="flex size-10 items-center justify-center rounded-md border bg-muted/40 text-[10px] text-muted-foreground">
            {EMPTY_CELL}
          </span>
        );
      }
      return (
        <span className="flex items-center gap-1">
          {urls.map((src, index) => (
            <span key={`${src}-${index}`} className="block size-9 overflow-hidden rounded-md border bg-muted/40">
              <img
                src={src}
                alt={`${column.header || column.key || "Image"} ${index + 1}`}
                loading="lazy"
                className="size-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
            </span>
          ))}
        </span>
      );
    }

    case "mono":
      return <span className="font-mono text-xs">{formatScottText(value)}</span>;

    case "text":
    default:
      return formatScottText(value);
  }
}

/** Normalize the hook's `sort` value — tolerant of `{key,dir}` / `{column,direction}` / null. */
function readSort(sort) {
  if (!sort || typeof sort !== "object") return { key: null, dir: null };
  const key = sort.key ?? sort.column ?? sort.field ?? null;
  const dir = sort.dir ?? sort.direction ?? sort.order ?? null;
  if (!key || (dir !== "asc" && dir !== "desc")) return { key: null, dir: null };
  return { key: String(key), dir };
}

/** Accept a Set / array / null and hand back a Set of string ids. */
function toSelectionSet(selection) {
  if (selection instanceof Set) return new Set([...selection].map((v) => String(v)));
  if (Array.isArray(selection)) return new Set(selection.map((v) => String(v)));
  return new Set();
}

/** Emit the same container type the caller passed in, so `setSelection` stays happy. */
function fromSelectionSet(set, original) {
  return original instanceof Set ? new Set(set) : [...set];
}

/**
 * Sortable, selectable Scott data table.
 *
 * @param {object} props
 * @param {Array<object>} props.columns column configs: `{ key, header, type, sortable, align, width, className, headerClassName, render, format, options, tones, tone, decimals, trueLabel, falseLabel, maxItems, imageSlots, thumbSuffix }`.
 *        `type` also accepts `relation` (object or id → name), `relation-list`, `colors`
 *        (swatch row) and `image-list` (`imageSlots` + `thumbSuffix` → thumbnails).
 * @param {Array<object>} [props.rows] rows to render (already paginated by the hook).
 * @param {{key?: string, dir?: "asc"|"desc"}|null} [props.sort] active sort from `useScottList`.
 * @param {(key: string) => void} [props.onToggleSort] `toggleSort` from `useScottList` (asc → desc → off).
 * @param {boolean} [props.loading=false] renders Skeleton rows instead of data.
 * @param {string} [props.error] panel-level error; renders a destructive Alert above the table.
 * @param {string} [props.emptyMessage="No records found."] shown via `EmptyHint` when there are no rows.
 * @param {boolean} [props.selectable=false] show the leading checkbox column.
 * @param {Set<string>|Array<string>} [props.selection] currently selected row ids.
 * @param {(next: Set<string>|Array<string>) => void} [props.onSelectionChange] emitted in the same shape as `selection`.
 * @param {string} [props.idField="id"] which field identifies a row.
 * @param {(row: object) => string} [props.getRowId] override for `idField`.
 * @param {(row: object) => import("react").ReactNode} [props.rowActions] trailing action cell content.
 * @param {(row: object) => void} [props.onRowClick] whole-row click handler (adds `cursor-pointer`).
 * @param {boolean} [props.stickyHeader=true] pins the header while the body scrolls.
 * @param {number} [props.skeletonRows=8] skeleton row count while `loading`.
 * @param {string} [props.className] extra classes on the bordered table shell.
 * @param {import("react").ReactNode} [props.footer] optional `<tfoot>`-style node rendered under the table.
 */
export default function ScottTable({
  columns = [],
  rows = [],
  sort = null,
  onToggleSort,
  loading = false,
  error = "",
  emptyMessage = "No records found.",
  selectable = false,
  selection,
  onSelectionChange,
  idField = "id",
  getRowId,
  rowActions,
  onRowClick,
  stickyHeader = true,
  skeletonRows = 8,
  className,
  footer = null
}) {
  const safeColumns = Array.isArray(columns) ? columns.filter(Boolean) : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const { key: sortKey, dir: sortDir } = readSort(sort);

  const rowId = (row, index) => {
    if (typeof getRowId === "function") return String(getRowId(row));
    const value = readScottCellValue(row, idField);
    return value == null ? `row-${index}` : String(value);
  };

  const selectedSet = toSelectionSet(selection);
  const pageIds = safeRows.map((row, i) => rowId(row, i));
  const selectedOnPage = pageIds.filter((id) => selectedSet.has(id));
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  function emitSelection(nextSet) {
    onSelectionChange?.(fromSelectionSet(nextSet, selection));
  }

  function toggleRow(id) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emitSelection(next);
  }

  function toggleAllOnPage() {
    const next = new Set(selectedSet);
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    emitSelection(next);
  }

  const columnCount = safeColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  function headerCell(column) {
    const numeric = NUMERIC_TYPES.has(column.type);
    const alignRight = column.align === "right" || (numeric && column.align !== "left" && column.align !== "center");
    const sortable = column.sortable !== false && Boolean(column.key) && typeof onToggleSort === "function";
    const active = sortKey === column.key;

    if (!sortable) {
      return (
        <TableHead
          key={column.key || column.header}
          style={column.width ? { width: column.width } : undefined}
          className={cn(
            SCOTT_HEAD_CLASS,
            alignRight && "text-right",
            column.align === "center" && "text-center",
            column.headerClassName
          )}
        >
          {column.header ?? column.key}
        </TableHead>
      );
    }

    return (
      <TableHead
        key={column.key}
        style={column.width ? { width: column.width } : undefined}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={cn(
          SCOTT_HEAD_CLASS,
          "cursor-pointer select-none",
          alignRight && "text-right",
          column.align === "center" && "text-center",
          active && "text-foreground",
          column.headerClassName
        )}
        onClick={() => onToggleSort(column.key)}
      >
        {column.header ?? column.key}
        <SortIndicator col={column.key} sortBy={sortKey} sortDir={sortDir} />
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className={cn("overflow-hidden rounded-md border bg-card", className)}>
        <Table>
          <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-card")}>
            <TableRow>
              {selectable ? (
                <TableHead className={cn(SCOTT_HEAD_CLASS, "w-12")}>
                  <Checkbox
                    checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAllOnPage}
                    disabled={loading || pageIds.length === 0}
                    aria-label="Select all rows on this page"
                  />
                </TableHead>
              ) : null}
              {safeColumns.map(headerCell)}
              {rowActions ? <TableHead className={cn(SCOTT_HEAD_CLASS, "text-right")}>Actions</TableHead> : null}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: Math.max(1, skeletonRows) }).map((_, rowIndex) => (
                <TableRow key={`scott-skeleton-${rowIndex}`}>
                  {selectable ? (
                    <TableCell className={cn(SCOTT_CELL_CLASS, "w-12")}>
                      <Skeleton className="size-4 rounded-sm" />
                    </TableCell>
                  ) : null}
                  {safeColumns.map((column) => (
                    <TableCell key={`${column.key || column.header}-skeleton`} className={SCOTT_CELL_CLASS}>
                      <Skeleton className="h-4 w-full max-w-[10rem]" />
                    </TableCell>
                  ))}
                  {rowActions ? (
                    <TableCell className={SCOTT_ACTIONS_CELL_CLASS}>
                      <Skeleton className="ml-auto h-8 w-24 rounded-md" />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : safeRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={Math.max(1, columnCount)}>
                  <EmptyHint>{emptyMessage}</EmptyHint>
                </TableCell>
              </TableRow>
            ) : (
              safeRows.map((row, index) => {
                const id = pageIds[index];
                const isSelected = selectedSet.has(id);
                return (
                  <TableRow
                    key={id}
                    data-state={isSelected ? "selected" : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <TableCell
                        className={cn(SCOTT_CELL_CLASS, "w-12")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(id)}
                          aria-label={`Select row ${id}`}
                        />
                      </TableCell>
                    ) : null}

                    {safeColumns.map((column) => {
                      const numeric = NUMERIC_TYPES.has(column.type);
                      const alignRight =
                        column.align === "right" || (numeric && column.align !== "left" && column.align !== "center");
                      return (
                        <TableCell
                          key={column.key || column.header}
                          className={cn(
                            SCOTT_CELL_CLASS,
                            alignRight && "text-right",
                            column.align === "center" && "text-center",
                            column.className
                          )}
                        >
                          {renderScottCell(column, row)}
                        </TableCell>
                      );
                    })}

                    {rowActions ? (
                      <TableCell className={SCOTT_ACTIONS_CELL_CLASS} onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap justify-end gap-2">{rowActions(row)}</div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {footer}
      </div>
    </div>
  );
}
