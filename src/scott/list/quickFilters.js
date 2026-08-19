// Quick filters — the always-visible dropdown / date-range row above a Scott table.
//
// Quick filters own no evaluation logic: they serialize into ordinary `FilterCondition`s
// and run through the same engine as the advanced filter panel. Their generated ids are
// prefixed `quick__` so a merged group can still tell the two systems apart.
//
// Quick and advanced filters are independent state and combine with AND semantics.

import { applyFilterGroup } from "./filterEngine";

/**
 * @typedef {Record<string, string | [string, string]>} QuickFilterValues
 *   enum column -> the single selected value ('' / absent = unset)
 *   date column -> [from, to] ISO date strings
 */

/** Every generated condition id starts with this. */
export const QUICK_FILTER_ID_PREFIX = "quick__";

/** Sentinel used by the "All {Name}s" option in the quick-filter selects. */
export const QUICK_FILTER_ALL_VALUE = "__all__";

/** `quick__<key>`, plus `__from` / `__to` for the one-sided date conditions. */
export function quickFilterConditionId(key, suffix) {
  return suffix ? `${QUICK_FILTER_ID_PREFIX}${key}__${suffix}` : `${QUICK_FILTER_ID_PREFIX}${key}`;
}

/** @returns {QuickFilterValues} */
export function createEmptyQuickFilterValues() {
  return {};
}

function isSetEnumValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    String(value) !== "" &&
    value !== QUICK_FILTER_ALL_VALUE
  );
}

/** A date entry counts as set when at least one bound is filled. */
function isSetDateRange(value) {
  return Boolean(String(value?.[0] ?? "")) || Boolean(String(value?.[1] ?? ""));
}

function isSetQuickValue(value) {
  return Array.isArray(value) ? isSetDateRange(value) : isSetEnumValue(value);
}

// ---------------------------------------------------------------------------
// Pure state transformers (a hook can hold these in `useState`)
// ---------------------------------------------------------------------------

/** Selecting the "all" sentinel or an empty value clears the field. */
export function setQuickEnumFilter(values, key, value) {
  const next = { ...(values ?? {}) };
  if (!isSetEnumValue(value)) delete next[key];
  else next[key] = String(value);
  return next;
}

export function setQuickDateRange(values, key, from, to) {
  const next = { ...(values ?? {}) };
  const range = [String(from ?? ""), String(to ?? "")];
  if (!isSetDateRange(range)) delete next[key];
  else next[key] = range;
  return next;
}

export function clearQuickFilter(values, key) {
  const next = { ...(values ?? {}) };
  delete next[key];
  return next;
}

export function clearAllQuickFilters() {
  return {};
}

// ---------------------------------------------------------------------------
// Serialization into engine conditions
// ---------------------------------------------------------------------------

/**
 * Convert quick-filter values into a normal AND `FilterGroup`.
 *
 * - enum `v`                -> `is_any_of` with `[v]`, id `quick__<key>`
 * - date `[from, to]`       -> `date_between` with `[from, to]`, id `quick__<key>`
 * - date `[from, '']`       -> `date_after`  with `from`, id `quick__<key>__from`
 * - date `['', to]`         -> `date_before` with `to`,   id `quick__<key>__to`
 * - falsy / unset entries are skipped entirely
 *
 * @param {QuickFilterValues} values
 * @returns {{logic:'and', conditions: {id:string, field:string, operator:string, value:unknown}[]}}
 */
export function buildQuickFilterGroup(values) {
  const conditions = [];

  for (const [key, raw] of Object.entries(values ?? {})) {
    if (Array.isArray(raw)) {
      const from = String(raw[0] ?? "").trim();
      const to = String(raw[1] ?? "").trim();

      if (from && to) {
        conditions.push({
          id: quickFilterConditionId(key),
          field: key,
          operator: "date_between",
          value: [from, to]
        });
      } else if (from) {
        conditions.push({
          id: quickFilterConditionId(key, "from"),
          field: key,
          operator: "date_after",
          value: from
        });
      } else if (to) {
        conditions.push({
          id: quickFilterConditionId(key, "to"),
          field: key,
          operator: "date_before",
          value: to
        });
      }
      continue;
    }

    if (!isSetEnumValue(raw)) continue;
    conditions.push({
      id: quickFilterConditionId(key),
      field: key,
      operator: "is_any_of",
      value: [String(raw)]
    });
  }

  return { logic: "and", conditions };
}

/** One count per set field (a two-sided date range still counts once). */
export function countQuickFilters(values) {
  return Object.values(values ?? {}).filter(isSetQuickValue).length;
}

export function isQuickFilterActive(values) {
  return countQuickFilters(values) > 0;
}

/**
 * Run the quick filters over a row list via the shared engine.
 * @template T
 * @param {T[]} rows
 * @param {QuickFilterValues} values
 * @param {import('./filterEngine').FilterableColumn[]} columns
 * @returns {T[]}
 */
export function applyQuickFilters(rows, values, columns) {
  const list = Array.isArray(rows) ? rows : [];
  if (!isQuickFilterActive(values)) return list;
  return applyFilterGroup(list, buildQuickFilterGroup(values), columns);
}
