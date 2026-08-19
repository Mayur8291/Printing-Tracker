// Unified column sort for every Scott table — pure, no React.
//
// The Scott API accepts no sort parameters, so sorting is always done in the browser
// over the full dataset (activating a sort is what flips `useScottList` into 'full' mode).
//
// Two invariants the UI depends on:
//   - the header cycle is asc -> desc -> off (off clears the key entirely);
//   - blank-ish cells ('', '-', '—', '–', null, undefined) sink to the bottom in BOTH
//     directions, so a descending sort never opens with a wall of empty rows.

/**
 * @typedef {'asc'|'desc'|null} SortDirection
 * @typedef {'string'|'number'|'date'|'boolean'} SortType
 *
 * @typedef {Object} ColumnSortState
 * @property {string|null} key
 * @property {SortDirection} direction
 *
 * @typedef {Object} SortableColumnLike
 * @property {string} [sortKey]
 * @property {string[]} [keys]
 * @property {string} [key]
 * @property {SortType} [sortType]
 * @property {boolean} [sortable]
 * @property {string} [format]   report format, used to infer sortType
 * @property {string} [type]     master column type, used to infer sortType
 * @property {(row: unknown) => unknown} [getSortValue]
 */

/** @type {ColumnSortState} */
export const EMPTY_SORT_STATE = Object.freeze({ key: null, direction: null });

/** Display placeholders that count as "no value". */
export const EMPTY_SORT_VALUES = Object.freeze(["", "-", "—", "–"]);

const EMPTY_SORT_VALUE_SET = new Set(EMPTY_SORT_VALUES);

/** null/undefined, blank strings, whitespace-only, and the dash placeholders. */
export function isEmptySortValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return EMPTY_SORT_VALUE_SET.has(value.trim());
}

/**
 * Header click cycle: a new column starts ascending, asc becomes desc, desc clears.
 * @param {ColumnSortState} sortState
 * @param {string} key
 * @returns {ColumnSortState}
 */
export function nextSortDirection(sortState, key) {
  const current = sortState?.key === key ? sortState?.direction : null;
  if (current === "asc") return { key, direction: "desc" };
  if (current === "desc") return { key: null, direction: null };
  return { key, direction: "asc" };
}

export function isSortActive(sortState) {
  return Boolean(sortState?.key) && (sortState?.direction === "asc" || sortState?.direction === "desc");
}

/** @returns {SortDirection} the direction for one column, or null when it is not sorted. */
export function getSortDirection(sortState, key) {
  return sortState?.key === key ? (sortState?.direction ?? null) : null;
}

/** `sortKey` wins, then the first of `keys`, then `key`. */
export function resolveColumnSortKey(column) {
  const candidates = [column?.sortKey, column?.keys?.[0], column?.key];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate) !== "") {
      return String(candidate);
    }
  }
  return null;
}

/** Report `format` (or a master column `type`) → comparison strategy. */
export function inferSortTypeFromFormat(format) {
  switch (String(format ?? "").toLowerCase()) {
    case "currency":
    case "number":
    case "percent":
    case "integer":
    case "decimal":
      return "number";
    case "date":
    case "datetime":
      return "date";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

/** Explicit `sortType` wins; otherwise infer from `format`, then from `type`. */
export function resolveColumnSortType(column) {
  if (column?.sortType) return column.sortType;
  return inferSortTypeFromFormat(column?.format ?? column?.type);
}

/** `getSortValue(row)` when the column supplies one, else the raw cell. */
export function getRowSortValue(row, column) {
  if (typeof column?.getSortValue === "function") return column.getSortValue(row);
  const key = resolveColumnSortKey(column);
  return key ? row?.[key] : undefined;
}

/** Find the column a sort key belongs to (primary resolution first, then raw `key`). */
export function findSortableColumn(columns, key) {
  const list = columns ?? [];
  return (
    list.find((column) => resolveColumnSortKey(column) === key) ??
    list.find((column) => column?.key === key) ??
    null
  );
}

/**
 * "₹ 1,234.50" / "12 %" -> 1234.5 / 12. Currency symbol, commas, percent signs and
 * whitespace are stripped before `Number()`.
 * @returns {number|null} null when the value cannot be read as a number
 */
export function coerceSortNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const cleaned = String(value ?? "").replace(/[₹,%\s]/g, "");
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** @returns {number|null} epoch ms, or null when unparseable. */
export function coerceSortDate(value) {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? null : ts;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const ts = new Date(text).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** @returns {1|0|null} null for values outside the known truthy/falsy vocabularies. */
export function coerceSortBoolean(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (key === true || key === 1 || key === "1" || key === "true" || key === "yes") return 1;
  if (key === false || key === 0 || key === "0" || key === "false" || key === "no") return 0;
  return null;
}

function baseCompare(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
}

function compareNumeric(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Compare two cell values under one strategy.
 *
 * Unparseable values inside a typed comparison sort after parseable ones (and fall back
 * to a base-sensitivity string compare when neither parses). Note this ordering IS
 * direction-multiplied by `sortRows`; only the documented empty set (`isEmptySortValue`)
 * is pinned to the bottom in both directions.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @param {SortType} type
 * @returns {number}
 */
export function compareSortValues(a, b, type) {
  switch (type) {
    case "number": {
      const na = coerceSortNumber(a);
      const nb = coerceSortNumber(b);
      if (na === null && nb === null) return baseCompare(a, b);
      if (na === null) return 1;
      if (nb === null) return -1;
      return compareNumeric(na, nb);
    }
    case "date": {
      const da = coerceSortDate(a);
      const db = coerceSortDate(b);
      if (da === null && db === null) return baseCompare(a, b);
      if (da === null) return 1;
      if (db === null) return -1;
      return compareNumeric(da, db);
    }
    case "boolean": {
      const ba = coerceSortBoolean(a);
      const bb = coerceSortBoolean(b);
      if (ba === null && bb === null) return baseCompare(a, b);
      if (ba === null) return 1;
      if (bb === null) return -1;
      return compareNumeric(ba, bb);
    }
    case "string":
    default:
      // `numeric: true` gives natural ordering ("Item 2" before "Item 10").
      return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
        sensitivity: "base",
        numeric: true
      });
  }
}

/**
 * Stable copy-sort of `rows` under `sortState`.
 *
 * No-ops (returning the input list) when there is no active sort, when no column matches
 * the sort key, or when the matched column is explicitly `sortable: false`.
 *
 * @template T
 * @param {T[]} rows
 * @param {ColumnSortState} sortState
 * @param {SortableColumnLike[]} columns
 * @returns {T[]}
 */
export function sortRows(rows, sortState, columns) {
  const list = Array.isArray(rows) ? rows : [];
  if (!isSortActive(sortState)) return list;

  const column = findSortableColumn(columns, sortState.key);
  if (!column || column.sortable === false) return list;

  const type = resolveColumnSortType(column);
  const direction = sortState.direction === "desc" ? -1 : 1;

  // Decorated with the original index so ties (and equal empties) keep input order.
  const decorated = list.map((row, index) => ({ row, index, value: getRowSortValue(row, column) }));

  decorated.sort((a, b) => {
    const aEmpty = isEmptySortValue(a.value);
    const bEmpty = isEmptySortValue(b.value);
    if (aEmpty && bEmpty) return a.index - b.index;
    if (aEmpty) return 1; // empties last in BOTH directions — never multiplied
    if (bEmpty) return -1;

    const cmp = compareSortValues(a.value, b.value, type);
    if (cmp !== 0) return cmp * direction;
    return a.index - b.index;
  });

  return decorated.map((entry) => entry.row);
}
