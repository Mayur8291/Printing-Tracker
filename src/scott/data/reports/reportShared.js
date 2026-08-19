// Shared machinery for every Scott REPORTS data module.
//
// Everything in here is PURE (no transport, no React) so normalizers, derived-metric
// formulas and export field maps can be unit-tested without a Supabase client.
//
// Five concerns live here, and only here:
//   1. Dates      — requests go up as DD-MM-YYYY, responses come back as DD/MM/YYYY
//                   (sometimes with a `hh:mmAM` tail), UI state is always ISO YYYY-MM-DD.
//   2. Defaults   — the "today minus 1 year -> today" range every orders-backed report opens with.
//   3. Aliases    — `pickField`/`pickNumber`/`pickBoolean`: Scott renames the same field per
//                   endpoint, so every normalizer resolves a value from an ordered key list.
//   4. Display    — `-` placeholder, en-IN dates, `₹` + exactly 2 decimals. These formatters
//                   are the single source of truth for BOTH table cells and CSV cells, which is
//                   why the export field map is built from the same column defs.
//   5. Order ids  — Scott/Airtable emits truncated `OD-P-` stubs, and line-item lists populate
//                   customer/date/status on only ONE line per order (`enrichRowsByOrderId`).
//
// NOTE on placeholders: report cells use `-` (per the reports spec), NOT the `—` em dash used
// by `src/scott/ui/ScottTable.jsx`. Both are treated as "empty" by `src/scott/list/tableSort.js`,
// so sorting is unaffected, but the CSV output differs — keep `-` here for export parity.

// ---------------------------------------------------------------------------
// 1. Dates
// ---------------------------------------------------------------------------

/** Placeholder rendered for every empty report cell. */
export const EMPTY_REPORT_CELL = "-";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const DMY_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

/**
 * ISO `YYYY-MM-DD` -> Scott's `DD-MM-YYYY` request format.
 * Anything that is not an ISO date is returned untouched (already-formatted values pass through).
 * @param {string} isoDate
 * @returns {string}
 */
export function formatDateForScott(isoDate) {
  const text = String(isoDate ?? "").trim();
  const match = ISO_DATE_RE.exec(text);
  if (!match) return text;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

/** Scott's `DD-MM-YYYY` (or `DD/MM/YYYY`) -> ISO `YYYY-MM-DD`. `''` when unparseable. */
export function scottDateToIso(scottDate) {
  const text = String(scottDate ?? "").trim();
  if (ISO_DATE_RE.test(text)) return text.slice(0, 10);
  const match = DMY_RE.exec(text);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parse any date shape a Scott report can return.
 *
 * Day-first is tried BEFORE `new Date`, because `new Date('08/09/2025')` is parsed as
 * US month-first (9 Aug) by every JS engine, while Scott means 8 Sep.
 *
 * @param {unknown} value ISO, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD/MM/YYYY hh:mmAM`, epoch ms, Date
 * @returns {Date|null}
 */
export function parseScottDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (isBlank(value)) return null;

  const text = String(value).trim();

  const dmy = DMY_RE.exec(text);
  if (dmy) {
    const [, day, month, year] = dmy;
    const time = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(text.slice(dmy[0].length));
    let hours = time ? Number(time[1]) : 0;
    const minutes = time ? Number(time[2]) : 0;
    const meridiem = time?.[3]?.toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    const date = new Date(Number(year), Number(month) - 1, Number(day), hours, minutes);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Inclusive day count between two Scott `DD-MM-YYYY` values (ISO also accepted).
 * Always at least 1 — a single-day period still divides by 1 in the sales-loss math.
 * @returns {number}
 */
export function daysBetweenScottDates(start, end) {
  const from = parseScottDate(start);
  const to = parseScottDate(end);
  if (!from || !to) return 1;
  const ms = to.getTime() - from.getTime();
  return Math.max(1, Math.floor(ms / 86400000) + 1);
}

// ---------------------------------------------------------------------------
// 2. Default date ranges
// ---------------------------------------------------------------------------

/** Local (not UTC) ISO date — reports are read in the user's timezone. */
export function toIsoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayIso() {
  return toIsoDate(new Date());
}

/** ISO date N years back from `from` (default today). */
export function isoYearsAgo(years = 1, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setFullYear(d.getFullYear() - years);
  return toIsoDate(d);
}

/**
 * The range every orders-backed report opens with: today minus one year -> today.
 * Used by Order Tracking (`createDefaultOrderTrackingPeriod`) and RMP Sales
 * (`createDefaultPeriodConfig`), both in `date` mode.
 * @returns {{ mode: 'date', startDate: string, endDate: string }}
 */
export function createDefaultReportPeriod() {
  return { mode: "date", startDate: isoYearsAgo(1), endDate: todayIso() };
}

/** First/last ISO day of a calendar month (1-based month). */
export function monthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

/** ISO Monday–Sunday range for an HTML week input value (`YYYY-Www`). */
export function isoWeekRange(weekValue) {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(String(weekValue ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // ISO week 1 contains 4 Jan; Monday of that week is the anchor.
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7; // Mon = 0
  const week1Monday = new Date(year, 0, 4 - jan4Dow);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { startDate: toIsoDate(monday), endDate: toIsoDate(sunday) };
}

/**
 * Resolve any period config (`date|week|month|year`) to an ISO range.
 * @param {{mode?: string, startDate?: string, endDate?: string, weekValue?: string, month?: number, year?: number}} config
 * @returns {{startDate: string, endDate: string}}
 */
export function resolveReportPeriodRange(config) {
  const mode = String(config?.mode ?? "date");
  const now = new Date();

  if (mode === "week") {
    return isoWeekRange(config?.weekValue) ?? createDefaultReportPeriod();
  }
  if (mode === "month") {
    const year = Number(config?.year) || now.getFullYear();
    const month = Number(config?.month) || now.getMonth() + 1;
    return monthRange(year, month);
  }
  if (mode === "year") {
    const year = Number(config?.year) || now.getFullYear();
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  return {
    startDate: String(config?.startDate ?? isoYearsAgo(1)),
    endDate: String(config?.endDate ?? todayIso())
  };
}

/**
 * Period config -> the `start_date`/`end_date` query pair (DD-MM-YYYY), omitting blanks.
 * @returns {{start_date?: string, end_date?: string}}
 */
export function buildScottDateParams(config) {
  const { startDate, endDate } = resolveReportPeriodRange(config);
  const out = {};
  if (startDate) out.start_date = formatDateForScott(startDate);
  if (endDate) out.end_date = formatDateForScott(endDate);
  return out;
}

/** Inclusive day count of a resolved period — feeds the inventory sales-loss formula. */
export function daysInPeriod(config) {
  const { startDate, endDate } = resolveReportPeriodRange(config);
  return daysBetweenScottDates(startDate, endDate);
}

// ---------------------------------------------------------------------------
// 3. Field-alias resolution (used by EVERY normalizer)
// ---------------------------------------------------------------------------

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A value counts as "supplied" when it is not null/undefined and not an empty string. */
export function hasValue(value) {
  return value !== null && value !== undefined && String(value) !== "";
}

/**
 * First non-empty value across an ordered alias list — the core of every normalizer.
 * @param {Record<string, unknown>} row
 * @param {string[]} keys ordered aliases; the first one that carries a value wins
 * @param {unknown} [fallback]
 */
export function pickField(row, keys, fallback = undefined) {
  if (!isPlainObject(row)) return fallback;
  for (const key of keys ?? []) {
    if (hasValue(row[key])) return row[key];
  }
  return fallback;
}

/**
 * `pickField` coerced to a trimmed string (default `''`).
 *
 * Objects and arrays are SKIPPED rather than stringified: several alias lists contain a key
 * that is a plain string on one endpoint and an embedded record on another (`customer`,
 * `rmp_class`, …), and `"[object Object]"` must never reach a cell. The caller resolves the
 * embedded object separately via `pickObject`.
 */
export function pickString(row, keys, fallback = "") {
  if (!isPlainObject(row)) return fallback;
  for (const key of keys ?? []) {
    const value = row[key];
    if (!hasValue(value) || typeof value === "object") continue;
    return String(value).trim();
  }
  return fallback;
}

/**
 * Tolerant numeric read: strips `₹`, thousands commas, `%` and whitespace before Number().
 * @returns {number|undefined} undefined when the value is absent or non-numeric
 */
export function parseScottNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (isBlank(value)) return undefined;
  const cleaned = String(value).replace(/[₹,%\s]/g, "");
  if (cleaned === "") return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

/** `pickField` + `parseScottNumber`; undefined when no alias carries a number. */
export function pickNumber(row, keys) {
  if (!isPlainObject(row)) return undefined;
  for (const key of keys ?? []) {
    if (!hasValue(row[key])) continue;
    const num = parseScottNumber(row[key]);
    if (num !== undefined) return num;
  }
  return undefined;
}

const TRUTHY_TOKENS = new Set(["true", "1", "yes", "y", "t"]);
const FALSY_TOKENS = new Set(["false", "0", "no", "n", "f"]);

/**
 * Tri-state boolean read. Returns `undefined` when NO alias carries a signal — deliberately,
 * so the table renders `-` rather than a misleading "No" (reports spec §15.5).
 * @returns {boolean|undefined}
 */
export function pickBoolean(row, keys) {
  if (!isPlainObject(row)) return undefined;
  for (const key of keys ?? []) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (isBlank(value)) continue;
    const token = String(value).trim().toLowerCase();
    if (TRUTHY_TOKENS.has(token)) return true;
    if (FALSY_TOKENS.has(token)) return false;
  }
  return undefined;
}

/**
 * Resolve an embedded relation object (`rmp_class`, `RmpClass`, `customer`, …).
 * @param {Record<string, unknown>} row
 * @param {string[]} keys candidate keys, snake and Pascal
 * @returns {Record<string, unknown>|null}
 */
export function pickObject(row, keys) {
  if (!isPlainObject(row)) return null;
  for (const key of keys ?? []) {
    if (isPlainObject(row[key])) return row[key];
  }
  return null;
}

/** Sum an alias-resolved numeric field across rows (missing values count as 0). */
export function sumBy(rows, resolve) {
  let total = 0;
  for (const row of rows ?? []) {
    const value = typeof resolve === "function" ? resolve(row) : row?.[resolve];
    const num = parseScottNumber(value);
    if (num !== undefined) total += num;
  }
  return total;
}

// ---------------------------------------------------------------------------
// 4. Display formatters + CSV export field map
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReportColumnDef
 * @property {string} label            header + export header + filter name
 * @property {string[]} keys           field fallbacks, first non-empty wins
 * @property {'text'|'date'|'currency'|'number'|'percent'|'boolean'} [format]
 * @property {boolean} [relation]      resolve an embedded object via `.name`
 * @property {(row: unknown) => string} [formatValue] custom cell renderer (wins over `format`)
 * @property {string} [sortKey]
 * @property {'string'|'number'|'date'|'boolean'} [sortType]
 * @property {boolean} [sortable]
 * @property {'enum'|'text'|'decimal'|'date'} [type]  filter-type override
 * @property {{value: string, label: string}[]} [options] enum filter options
 */

/** en-IN `d MMM yyyy`; the raw string when unparseable; `-` when empty. */
export function formatReportDate(value) {
  if (isBlank(value)) return EMPTY_REPORT_CELL;
  const date = parseScottDate(value);
  if (!date) return String(value);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** `₹` + exactly 2 decimals; the raw string when non-numeric; `-` when empty. */
export function formatReportCurrency(value) {
  if (isBlank(value)) return EMPTY_REPORT_CELL;
  const num = parseScottNumber(value);
  if (num === undefined) return String(value);
  return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Grouped number; the raw string when non-numeric; `-` when empty. */
export function formatReportNumber(value) {
  if (isBlank(value)) return EMPTY_REPORT_CELL;
  const num = parseScottNumber(value);
  if (num === undefined) return String(value);
  return num.toLocaleString("en-IN");
}

/** `${n}%` (the order-report percent variant); the raw string when non-numeric. */
export function formatReportPercent(value) {
  if (isBlank(value)) return EMPTY_REPORT_CELL;
  const num = parseScottNumber(value);
  if (num === undefined) return String(value);
  return `${num}%`;
}

/** `Yes`/`No` for a real boolean signal, `-` when there is none. */
export function formatReportBoolean(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (isBlank(value)) return EMPTY_REPORT_CELL;
  const token = String(value).trim().toLowerCase();
  if (TRUTHY_TOKENS.has(token)) return "Yes";
  if (FALSY_TOKENS.has(token)) return "No";
  return EMPTY_REPORT_CELL;
}

/**
 * Render one cell. Resolution order (spec §6):
 *   formatValue -> relation `.name` -> first non-empty key -> format switch -> `-`.
 * @param {Record<string, unknown>} row
 * @param {ReportColumnDef} column
 * @returns {string}
 */
export function getReportCellValue(row, column) {
  if (typeof column?.formatValue === "function") {
    const custom = column.formatValue(row);
    return isBlank(custom) ? EMPTY_REPORT_CELL : String(custom);
  }

  if (column?.relation) {
    for (const key of column.keys ?? []) {
      const value = row?.[key];
      if (isPlainObject(value)) {
        const name = value.name ?? value.title ?? value.label;
        if (hasValue(name)) return String(name);
      } else if (hasValue(value)) {
        return String(value);
      }
    }
    return EMPTY_REPORT_CELL;
  }

  const raw = pickField(row, column?.keys ?? []);
  if (!hasValue(raw)) {
    // A real `false` is a value for boolean columns, not an empty cell.
    if (column?.format === "boolean" && typeof raw === "boolean") return formatReportBoolean(raw);
    if (column?.format === "boolean") {
      for (const key of column.keys ?? []) {
        if (typeof row?.[key] === "boolean") return formatReportBoolean(row[key]);
      }
    }
    return EMPTY_REPORT_CELL;
  }

  // A non-relation column that lands on an embedded record still must not print
  // "[object Object]" — fall back to its name, then to the placeholder.
  if (typeof raw === "object") {
    const name = isPlainObject(raw) ? (raw.name ?? raw.title ?? raw.label) : undefined;
    return hasValue(name) ? String(name) : EMPTY_REPORT_CELL;
  }

  switch (column?.format) {
    case "date":
      return formatReportDate(raw);
    case "currency":
      return formatReportCurrency(raw);
    case "number":
      return formatReportNumber(raw);
    case "boolean":
      return formatReportBoolean(raw);
    // `percent` falls through to raw text in the shared renderer; the order-report
    // config overrides it with `formatReportPercent` where a `%` suffix is wanted.
    default:
      return String(raw);
  }
}

/** Column labels, in table order — the CSV header row. */
export function reportExportHeaders(columns) {
  return (columns ?? []).map((column) => column.label);
}

/**
 * `{ [columnLabel]: (row) => cellString }` — CSV cells are produced by the SAME renderer
 * as table cells, which is what keeps export output identical to what the user sees.
 */
export function reportExportFieldMap(columns) {
  const map = {};
  for (const column of columns ?? []) {
    map[column.label] = (row) => getReportCellValue(row, column);
  }
  return map;
}

/** Headers + field map + filename in one call. */
export function buildReportExportConfig(columns, entityName) {
  return {
    entityName,
    headers: reportExportHeaders(columns),
    fieldMap: reportExportFieldMap(columns),
    filename: () => generateExportFilename(entityName)
  };
}

/** `${entity}-YYYY-MM-DD.csv` (lower-cased entity). */
export function generateExportFilename(entityName) {
  return `${String(entityName ?? "export").toLowerCase()}-${todayIso()}.csv`;
}

/**
 * Build CSV text from headers + a field map.
 *
 * QUIRK REPRODUCED (reports spec §5 / §18): the header row is joined RAW and every data cell
 * is wrapped in double quotes with **no escaping of embedded quotes**. Upstream ScottOne has
 * the same limitation; fixing it here would silently change every exported file.
 *
 * @param {{headers: string[], rows: unknown[], fieldMap: Record<string, string|((row:unknown)=>unknown)>}} args
 * @returns {string}
 */
export function buildReportCsv({ headers, rows, fieldMap }) {
  const head = (headers ?? []).join(",");
  const body = (rows ?? []).map((row) =>
    (headers ?? [])
      .map((header) => {
        const resolver = fieldMap?.[header];
        const value = typeof resolver === "function" ? resolver(row) : row?.[resolver];
        return `"${value === null || value === undefined ? "" : value}"`;
      })
      .join(",")
  );
  return [head, ...body].join("\n");
}

// ---------------------------------------------------------------------------
// 5. Order-id quirks (truncated stubs + line-item cross-fill)
// ---------------------------------------------------------------------------

/**
 * Scott/Airtable sometimes emits a truncated order id (`"OD-P-"`, `"OD-P"`).
 * Those must never reach the UI as-is.
 */
export function isIncompleteOrderId(orderId) {
  const text = String(orderId ?? "").trim();
  if (!text) return true;
  return /^OD-P-?$/i.test(text);
}

/** Complete order id, else `#<record id>`, else `-`. */
export function formatReportOrderId(orderId, reportId) {
  if (!isIncompleteOrderId(orderId)) return String(orderId).trim();
  const rid = String(reportId ?? "").trim();
  return rid ? `#${rid}` : EMPTY_REPORT_CELL;
}

/** Column-level renderer for the `Order ID` column. */
export function formatReportOrderIdCell(row) {
  return formatReportOrderId(row?.order_id, row?.id);
}

/**
 * Cross-fill parent fields across line items that share one complete `order_id`.
 *
 * Scott's line-item lists (order_reports / rmp_order_reports / orders) populate
 * customer/date/status on only ONE line per order; siblings come back blank. Pure: returns
 * the original array when nothing changed.
 *
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} fields fields a sibling may donate
 */
export function enrichRowsByOrderId(rows, fields) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0 || !fields?.length) return list;

  /** @type {Map<string, Record<string, unknown>>} */
  const donors = new Map();
  for (const row of list) {
    const orderId = String(row?.order_id ?? "").trim();
    if (!orderId || isIncompleteOrderId(orderId)) continue;
    const donor = donors.get(orderId) ?? {};
    for (const field of fields) {
      if (!hasValue(donor[field]) && hasValue(row?.[field])) donor[field] = row[field];
    }
    donors.set(orderId, donor);
  }

  let changed = false;
  const out = list.map((row) => {
    const orderId = String(row?.order_id ?? "").trim();
    if (!orderId || isIncompleteOrderId(orderId)) return row;
    const donor = donors.get(orderId);
    if (!donor) return row;

    let patch = null;
    for (const field of fields) {
      if (!hasValue(row?.[field]) && hasValue(donor[field])) {
        patch = patch ?? {};
        patch[field] = donor[field];
      }
    }
    if (!patch) return row;
    changed = true;
    return { ...row, ...patch };
  });

  return changed ? out : list;
}

/**
 * Merge a nested payload wrapper onto its row: `{...nested, ...row}`.
 * Row-level keys win — the wrapper is a fallback, never an override.
 * @param {Record<string, unknown>} row
 * @param {string[]} wrapperKeys e.g. ['order_report'], ['rmp_order_report','order_report']
 */
export function mergeNestedPayload(row, wrapperKeys) {
  if (!isPlainObject(row)) return {};
  for (const key of wrapperKeys ?? []) {
    if (isPlainObject(row[key])) return { ...row[key], ...row };
  }
  return row;
}

/** Now, as an ISO timestamp — the created_at/updated_at default for report rows that lack them. */
export function nowIsoTimestamp() {
  return new Date().toISOString();
}
