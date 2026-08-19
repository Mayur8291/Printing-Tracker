// Advanced filter framework for every Scott list page — schema, operators and the
// evaluation engine. Pure functions only: no React, no transport, no globals.
//
// The Scott API has no filter parameters, so every condition here is evaluated in the
// browser over the *full* dataset (see `useScottList`). The edge cases below are not
// incidental — they are the documented behaviour of the original implementation and
// several screens depend on them (notably: `is_false` matching absent values, and an
// empty enum selection matching everything instead of nothing).

/**
 * @typedef {'text'|'integer'|'decimal'|'enum'|'boolean'|'date'} FilterFieldType
 *
 * @typedef {'contains'|'not_contains'|'equals'|'not_equals'|'starts_with'|'ends_with'
 *   |'is_empty'|'is_not_empty'|'gt'|'gte'|'lt'|'lte'|'between'|'is_any_of'|'is_none_of'
 *   |'is_true'|'is_false'|'date_before'|'date_after'|'date_between'|'date_on'} FilterOperator
 *
 * @typedef {Object} FilterableColumn
 * @property {string} key                 row field key
 * @property {string} name                display label
 * @property {FilterFieldType} type
 * @property {{value: string, label: string}[]} [options]  enum options
 *
 * @typedef {Object} FilterCondition
 * @property {string} id                  stable key for UI lists
 * @property {string} field
 * @property {FilterOperator} operator
 * @property {unknown} value              string | number | string[] | [a,b] | null
 *
 * @typedef {Object} FilterGroup
 * @property {'and'|'or'} logic           single flat group — no nesting
 * @property {FilterCondition[]} conditions
 */

/** The six field types the engine understands. Anything else is treated as `text`. */
export const FILTER_FIELD_TYPES = Object.freeze([
  "text",
  "integer",
  "decimal",
  "enum",
  "boolean",
  "date"
]);

const TEXT_OPERATORS = Object.freeze([
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "is exactly" },
  { value: "not_equals", label: "is not" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" }
]);

const NUMBER_OPERATORS = Object.freeze([
  { value: "equals", label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "between", label: "between" },
  { value: "is_empty", label: "is empty" }
]);

const ENUM_OPERATORS = Object.freeze([
  { value: "is_any_of", label: "is any of" },
  { value: "is_none_of", label: "is none of" }
]);

const BOOLEAN_OPERATORS = Object.freeze([
  { value: "is_true", label: "is true" },
  { value: "is_false", label: "is false" }
]);

const DATE_OPERATORS = Object.freeze([
  { value: "date_on", label: "is on" },
  { value: "date_before", label: "is before" },
  { value: "date_after", label: "is after" },
  { value: "date_between", label: "is between" }
]);

/** Operators offered per field type. First entry is that type's default operator. */
export const OPERATORS_BY_TYPE = Object.freeze({
  text: TEXT_OPERATORS,
  integer: NUMBER_OPERATORS,
  decimal: NUMBER_OPERATORS,
  enum: ENUM_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  date: DATE_OPERATORS
});

/** Operators that take no value input at all. */
export const NO_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty", "is_true", "is_false"]);

/** Operators whose value is a two-element tuple. */
export const TWO_VALUE_OPERATORS = new Set(["between", "date_between"]);

/**
 * Column types that can never be filtered: files, read-only cells, and the list cells whose
 * row value is an array (`String([...])` would be the only thing a text condition could see).
 *
 * `relation` and `colors` are NOT in this set even though their row value is an object /
 * array: they are filtered through a display PROJECTION instead (see
 * `PROJECTED_COLUMN_TYPES` and `relationDisplayText` below), so the condition compares
 * against exactly the text `ScottTable` renders.
 */
const NON_FILTERABLE_COLUMN_TYPES = new Set([
  "image",
  "images",
  "image-list",
  "image-slots",
  "relation-list",
  "readonly",
  "actions"
]);

/**
 * Column types whose ROW value is never what the user sees, so a filter condition has to be
 * evaluated against the rendered text instead of the raw cell:
 *
 *   `relation`  an embedded `{id, name}` (`String(...)` is `"[object Object]"`) or a bare FK
 *               id that the table resolves to a name through `column.options`;
 *   `colors`    an array of `{id, name, hex_code}`.
 *
 * Both are projected by `filterColumnValueGetter`, which is the same resolution
 * `ScottTable.relationLabel` uses — the table and the filter can no longer disagree.
 */
const PROJECTED_COLUMN_TYPES = new Set(["relation", "colors"]);

// ---------------------------------------------------------------------------
// Display projection (relation / colors) — the one resolution both the TABLE and the
// FILTER read. `ScottTable.relationLabel` re-exports `relationDisplayText`, so a column
// that shows "Round Neck" is also filtered as "Round Neck" and never as "17" or
// "[object Object]".
// ---------------------------------------------------------------------------

/** The house empty-cell placeholder (duplicated from `ScottTable` to keep this module pure). */
const EMPTY_DISPLAY = "—";

/** Resolve a bare id against `column.options`; `''` when there is no option list or no hit. */
function relationOptionLabel(column, value) {
  const options = Array.isArray(column?.options) ? column.options : null;
  if (!options) return "";
  const hit = options.find((option) => String(option?.value ?? option?.id ?? option) === String(value));
  if (!hit) return "";
  return String(hit.label ?? hit.name ?? hit.value ?? hit.id ?? hit);
}

/**
 * Display text for ONE relation value — the exact algorithm `ScottTable` renders with:
 * an embedded object gives up its name, a bare id is resolved through `column.options`,
 * and anything unresolved falls back to `#id`.
 *
 * @param {{options?: unknown[]}} column
 * @param {unknown} value
 * @returns {string} '' when there is nothing to show.
 */
export function relationDisplayText(column, value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value
        .map((item) => relationDisplayText(column, item))
        .filter(Boolean)
        .join(", ");
    }
    const name = value.name ?? value.title ?? value.label ?? value.code ?? value.sku ?? "";
    const text = String(name).trim();
    if (text) return text;
    const id = value.id ?? value.value ?? "";
    return id === "" ? "" : `#${id}`;
  }
  const resolved = relationOptionLabel(column, value);
  if (resolved && resolved !== EMPTY_DISPLAY && resolved !== String(value)) return resolved;
  return `#${value}`;
}

/**
 * Display text for a `colors` cell — the swatch names, comma-joined, in render order.
 * @param {unknown} value
 * @returns {string}
 */
export function colorsDisplayText(value) {
  const list = Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value];
  return list
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const name = String(entry.name ?? entry.title ?? entry.label ?? "").trim();
        if (name) return name;
        const hex = String(entry.hex_code ?? entry.code ?? "").trim();
        if (hex) return hex;
        const id = entry.id ?? "";
        return id === "" ? "" : `#${id}`;
      }
      return String(entry ?? "").trim();
    })
    .filter(Boolean)
    .join(", ");
}

/** Read a (possibly dotted) key off a row — same reader `ScottTable` uses for cells. */
function readRowValue(row, key) {
  if (!row || !key) return undefined;
  if (!String(key).includes(".")) return row[key];
  return String(key)
    .split(".")
    .reduce((acc, part) => (acc == null ? acc : acc[part]), row);
}

/**
 * The projector for one COLUMN CONFIG, or null when the raw cell is already what the user
 * sees. Attached to the filterable column as `getValue` by `buildFilterColumns`.
 *
 * @param {{key?: string, type?: string, options?: unknown[]}} column a TABLE column config.
 * @returns {((row: object) => unknown)|null}
 */
export function filterColumnValueGetter(column) {
  const type = String(column?.type ?? "").toLowerCase();
  if (!PROJECTED_COLUMN_TYPES.has(type)) return null;
  const key = String(column?.key ?? "");
  if (!key) return null;
  // `column.format` FIRST, exactly as `renderScottCell` does: the rmp_brands / rmp_classes
  // relation columns are keyed on the FK and use `format` to prefer the embedded object,
  // so a getter that skipped it would filter on a different value than the cell shows.
  const project = (row) => {
    const raw = readRowValue(row, key);
    return typeof column?.format === "function" ? column.format(raw, row) : raw;
  };
  if (type === "colors") return (row) => colorsDisplayText(project(row));
  return (row) => relationDisplayText(column, project(row));
}

/**
 * The value one condition is evaluated against: the column's projection when it has one,
 * else the raw cell.
 *
 * @param {object} row
 * @param {FilterableColumn} column
 * @param {string} [field] condition field, when it differs from `column.key`
 */
export function getFilterRowValue(row, column, field) {
  if (typeof column?.getValue === "function") return column.getValue(row);
  return row?.[field ?? column?.key];
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/** Any unrecognised type collapses to `text` — that is the engine's fallback everywhere. */
export function normalizeFieldType(type) {
  const key = String(type ?? "").toLowerCase();
  return FILTER_FIELD_TYPES.includes(key) ? key : "text";
}

/**
 * COLUMN type (a table column's `type`, or a bulk-edit column's) -> filter field type.
 *
 * This is the filter half of what `inferSortTypeFromFormat` (`tableSort.js`) does for sort,
 * and it exists because the two used to disagree: sorting read `number` as numeric and
 * `datetime` as a date while filtering collapsed both to `text`, which made the numeric,
 * enum and date operator sets unreachable on every master list. Same vocabulary, same
 * answer — one column can no longer be numeric to the sorter and textual to the filter.
 */
const COLUMN_TYPE_TO_FILTER_TYPE = Object.freeze({
  // numeric
  number: "decimal",
  currency: "decimal",
  percent: "decimal",
  // temporal
  datetime: "date",
  timestamp: "date",
  time: "date",
  // enumerated (a master's status column renders as a `badge`)
  badge: "enum",
  select: "enum",
  status: "enum",
  tag: "enum",
  // booleans
  switch: "boolean",
  // everything below is genuinely free text on the wire
  textarea: "text",
  string: "text",
  hex: "text",
  color: "text",
  url: "text",
  link: "text",
  relation: "text"
});

/**
 * Resolve one column's filter type. Types the engine already speaks pass through; the rest
 * go through the alias table above; anything unknown is text.
 * @param {unknown} type
 * @returns {FilterFieldType}
 */
export function columnTypeToFilterType(type) {
  const key = String(type ?? "").toLowerCase();
  if (FILTER_FIELD_TYPES.includes(key)) return key;
  return COLUMN_TYPE_TO_FILTER_TYPE[key] ?? "text";
}

/** `[{value,label}]` from whatever an option list looks like; drops valueless entries. */
function normalizeFilterOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => option && option.value !== undefined && option.value !== null)
    .map((option) => ({ value: String(option.value), label: String(option.label ?? option.value) }));
}

/** @returns {FilterOperator} first operator of the type's list. */
export function defaultOperatorForType(type) {
  return OPERATORS_BY_TYPE[normalizeFieldType(type)][0].value;
}

/** UI label for one operator, scoped to a field type. */
export function filterOperatorLabel(operator, type) {
  const list = OPERATORS_BY_TYPE[normalizeFieldType(type)] ?? TEXT_OPERATORS;
  const found = list.find((op) => op.value === operator);
  return found ? found.label : String(operator ?? "");
}

/** Operators legal for a type — the list the operator `Select` renders. */
export function operatorsForType(type) {
  return OPERATORS_BY_TYPE[normalizeFieldType(type)];
}

/**
 * The blank value a freshly-picked operator starts with.
 * null for no-value ops, a tuple for two-value ops, `[]` for enum, `''` otherwise.
 */
export function defaultValueForOperator(operator, type) {
  if (NO_VALUE_OPERATORS.has(operator)) return null;
  if (operator === "date_between") return ["", ""];
  if (operator === "between") return [0, 0];
  if (normalizeFieldType(type) === "enum") return [];
  return "";
}

let conditionIdCounter = 0;

/** `crypto.randomUUID()` when available, else a monotonic local id. */
export function createFilterConditionId() {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  conditionIdCounter += 1;
  return `filter_${Date.now().toString(36)}_${conditionIdCounter}`;
}

/**
 * Build one condition for a column, defaulting operator + value from its type.
 * @param {FilterableColumn} column
 * @param {Partial<FilterCondition>} [overrides]
 * @returns {FilterCondition}
 */
export function createFilterCondition(column, overrides) {
  const type = normalizeFieldType(column?.type);
  const operator = overrides?.operator ?? defaultOperatorForType(type);
  const hasValue = overrides ? Object.prototype.hasOwnProperty.call(overrides, "value") : false;
  return {
    id: overrides?.id ?? createFilterConditionId(),
    field: overrides?.field ?? column?.key ?? "",
    operator,
    value: hasValue ? overrides.value : defaultValueForOperator(operator, type)
  };
}

/** @returns {FilterGroup} */
export function createEmptyFilterGroup() {
  return { logic: "and", conditions: [] };
}

/** Concatenate two groups into a single AND group. */
export function mergeFilterGroups(a, b) {
  return {
    logic: "and",
    conditions: [...(a?.conditions ?? []), ...(b?.conditions ?? [])]
  };
}

export function isFilterGroupActive(group) {
  return (group?.conditions?.length ?? 0) > 0;
}

export function countFilterConditions(group) {
  return group?.conditions?.length ?? 0;
}

/** JSON-safe snapshot (ids kept so UI keys survive a round trip). */
export function serializeFilterGroup(group) {
  return {
    logic: group?.logic === "or" ? "or" : "and",
    conditions: (group?.conditions ?? []).map((condition) => ({
      id: String(condition?.id ?? ""),
      field: String(condition?.field ?? ""),
      operator: condition?.operator,
      value: condition?.value ?? null
    }))
  };
}

/** Inverse of `serializeFilterGroup`; drops fieldless/operatorless junk and backfills ids. */
export function deserializeFilterGroup(raw) {
  const conditions = Array.isArray(raw?.conditions) ? raw.conditions : [];
  return {
    logic: raw?.logic === "or" ? "or" : "and",
    conditions: conditions
      .filter((condition) => condition?.field && condition?.operator)
      .map((condition) => ({
        id: condition.id ? String(condition.id) : createFilterConditionId(),
        field: String(condition.field),
        operator: condition.operator,
        value: condition.value ?? null
      }))
  };
}

/**
 * Convert bulk-edit / table column configs into `FilterableColumn[]`.
 *
 * - image / images / readonly / list columns are skipped (not filterable);
 * - types are resolved through `columnTypeToFilterType`, so `number` filters as a number,
 *   `datetime` as a date and a status `badge` as an enum — the same reading the sorter takes;
 * - an enum needs choices to be usable, so one with no resolvable options degrades to text
 *   rather than rendering a multi-select with nothing in it;
 * - `includeDates` appends `created_at` + `updated_at` as date columns.
 *
 * @param {{key?:string, name?:string, label?:string, header?:string, type?:string, options?:unknown[]}[]} columns
 * @param {{includeDates?: boolean, fields?: Array<object>}} [options]
 *   `fields` is the entity config's form-field array. Table columns carry no option lists
 *   (a `badge` column is just `{key:'status', type:'badge'}`), but the matching FIELD does —
 *   that is where an enum column's choices come from.
 * @returns {FilterableColumn[]}
 */
export function buildFilterColumns(columns, options) {
  const includeDates = options?.includeDates !== false;
  const fieldsByKey = new Map();
  for (const field of options?.fields ?? []) {
    if (field?.key) fieldsByKey.set(String(field.key), field);
  }

  const out = [];

  for (const column of columns ?? []) {
    const key = String(column?.key ?? "");
    if (!key) continue;
    const rawType = String(column?.type ?? "text").toLowerCase();
    if (NON_FILTERABLE_COLUMN_TYPES.has(rawType)) continue;

    let type = columnTypeToFilterType(rawType);
    let enumOptions = [];
    if (type === "enum") {
      enumOptions = normalizeFilterOptions(column?.options);
      if (enumOptions.length === 0) {
        enumOptions = normalizeFilterOptions(fieldsByKey.get(key)?.options);
      }
      if (enumOptions.length === 0) type = "text"; // an empty dropdown filters nothing
    }

    const filterColumn = {
      key,
      name: String(column?.name ?? column?.label ?? column?.header ?? key),
      type
    };
    if (type === "enum") filterColumn.options = enumOptions;
    // `relation` / `colors`: filter the DISPLAYED text, never the embedded object or the
    // bare FK id. Without this a user filtering `Type = "Round Neck"` on a column showing
    // "Round Neck" would compare against `"17"` (or `"[object Object]"`) and get zero rows.
    const getValue = filterColumnValueGetter(column);
    if (getValue) filterColumn.getValue = getValue;
    out.push(filterColumn);
  }

  if (includeDates) {
    const seen = new Set(out.map((column) => column.key));
    if (!seen.has("created_at")) out.push({ key: "created_at", name: "Created At", type: "date" });
    if (!seen.has("updated_at")) out.push({ key: "updated_at", name: "Updated At", type: "date" });
  }

  return out;
}

/**
 * The one derivation of an entity config's filterable columns — `useScottList` and
 * `ScottFilterBar` BOTH call this, so the builder can never offer a field the engine would
 * then evaluate under a different type.
 *
 * `config.filterColumns` (reports, customers) wins outright. Everything else — the 21
 * masters — is derived from the table columns the list actually renders, typed through
 * `columnTypeToFilterType` and given enum options from the config's own `fields`.
 *
 * @param {object} [config] entity config.
 * @returns {FilterableColumn[]}
 */
export function scottFilterColumnsFor(config) {
  if (Array.isArray(config?.filterColumns) && config.filterColumns.length > 0) {
    return config.filterColumns;
  }
  return buildFilterColumns(config?.columns ?? [], {
    includeDates: true,
    fields: config?.fields
  });
}

/** Report column `format` → filter field type. */
export function formatToFilterType(format) {
  switch (String(format ?? "").toLowerCase()) {
    case "date":
      return "date";
    case "currency":
    case "number":
    case "percent":
      return "decimal";
    default:
      return "text";
  }
}

/**
 * Bridge for report column definitions (`{label, keys, format, type?, options?}`).
 * The filter key is always `keys[0]`.
 * @returns {FilterableColumn[]}
 */
export function buildReportFilterColumns(sources) {
  const out = [];
  for (const source of sources ?? []) {
    const key = String(source?.keys?.[0] ?? source?.key ?? "");
    if (!key) continue;
    const column = {
      key,
      name: String(source?.label ?? key),
      type: normalizeFieldType(source?.type ?? formatToFilterType(source?.format))
    };
    if (Array.isArray(source?.options)) column.options = source.options;
    out.push(column);
  }
  return out;
}

/**
 * Distinct non-empty values of one field, as enum options — used to derive quick-filter
 * options from a loaded dataset. `''` and `'-'` are excluded.
 * @returns {{value: string, label: string}[]}
 */
export function buildEnumOptionsFromRows(rows, key) {
  const seen = new Set();
  for (const row of rows ?? []) {
    const raw = row?.[key];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value === "" || value === "-") continue;
    seen.add(value);
  }
  return [...seen]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}

/** Local-day bounds. `YYYY-MM-DD` without a zone parses as *local* time, by design. */
function localDayStart(date) {
  return new Date(`${date}T00:00:00`).getTime();
}

function localDayEnd(date) {
  return new Date(`${date}T23:59:59`).getTime();
}

function testTextCondition(rawValue, operator, value) {
  // `?? ''` so a null cell is an empty string rather than the literal "null".
  const text = String(rawValue ?? "").toLowerCase();
  const needle = String(value ?? "").toLowerCase();

  switch (operator) {
    case "contains":
      return text.includes(needle);
    case "not_contains":
      return !text.includes(needle);
    case "equals":
      return text === needle;
    case "not_equals":
      return text !== needle;
    case "starts_with":
      return text.startsWith(needle);
    case "ends_with":
      return text.endsWith(needle);
    default:
      return true;
  }
}

function testNumberCondition(rawValue, operator, value) {
  const num = Number(rawValue);
  if (Number.isNaN(num)) return false; // non-numeric cells never match a numeric condition

  if (operator === "between") {
    const [min, max] = Array.isArray(value) ? value : [undefined, undefined];
    return num >= Number(min) && num <= Number(max); // inclusive on both ends
  }

  const target = Number(value);
  switch (operator) {
    case "equals":
      return num === target;
    case "not_equals":
      return num !== target;
    case "gt":
      return num > target;
    case "gte":
      return num >= target;
    case "lt":
      return num < target;
    case "lte":
      return num <= target;
    default:
      return true;
  }
}

function testEnumCondition(rawValue, operator, value) {
  const selected = Array.isArray(value) ? value : [];
  if (selected.length === 0) return true; // nothing selected == no restriction

  const text = String(rawValue ?? "");
  const hit = selected.some((option) => String(option) === text);

  switch (operator) {
    case "is_any_of":
      return hit;
    case "is_none_of":
      return !hit;
    default:
      return true;
  }
}

function testDateCondition(rawValue, operator, value) {
  // Precedence matters: the row guard runs BEFORE the "blank input filters nothing"
  // shortcuts below, so a half-filled date condition still drops rows whose date is
  // absent or unparseable. Same shape as the numeric branch.
  if (isEmptyValue(rawValue)) return false;
  const rowTs = new Date(rawValue).getTime();
  if (Number.isNaN(rowTs)) return false;

  if (operator === "date_between") {
    const [from, to] = Array.isArray(value) ? value : ["", ""];
    if (!from || !to) return true; // an incomplete range filters nothing
    return rowTs >= localDayStart(from) && rowTs <= localDayEnd(to);
  }

  const date = String(value ?? "");
  if (!date) return true; // a blank date input filters nothing

  switch (operator) {
    case "date_on":
      return rowTs >= localDayStart(date) && rowTs <= localDayEnd(date);
    case "date_before":
      return rowTs < localDayStart(date);
    case "date_after":
      return rowTs > localDayEnd(date);
    default:
      return true;
  }
}

/**
 * Evaluate one condition against one row.
 *
 * @param {Record<string, unknown>} row
 * @param {FilterCondition} condition
 * @param {FilterFieldType|FilterableColumn} [column]
 *   The column, or just its type. Passing the COLUMN is what lets a `relation` / `colors`
 *   condition be evaluated against the projected display text (`column.getValue`) instead of
 *   the raw cell; a bare type string keeps the pre-projection behaviour.
 * @returns {boolean}
 */
export function testFilterCondition(row, condition, column) {
  const operator = condition?.operator;
  const columnConfig = column && typeof column === "object" ? column : null;
  const type = columnConfig ? columnConfig.type : column;
  const rawValue = columnConfig
    ? getFilterRowValue(row, columnConfig, condition?.field)
    : row?.[condition?.field];

  // No-value operators are type-independent and evaluated first.
  switch (operator) {
    case "is_empty":
      return isEmptyValue(rawValue);
    case "is_not_empty":
      return !isEmptyValue(rawValue);
    case "is_true":
      return rawValue === true || rawValue === "true";
    case "is_false":
      // Absent counts as false — this is deliberate, not an oversight.
      return rawValue === false || rawValue === "false" || isEmptyValue(rawValue);
    default:
      break;
  }

  switch (normalizeFieldType(type)) {
    case "integer":
    case "decimal":
      return testNumberCondition(rawValue, operator, condition?.value);
    case "enum":
      return testEnumCondition(rawValue, operator, condition?.value);
    case "date":
      return testDateCondition(rawValue, operator, condition?.value);
    case "boolean":
      return true; // only is_true / is_false apply, both handled above
    case "text":
    default:
      return testTextCondition(rawValue, operator, condition?.value);
  }
}

/**
 * Apply a flat AND/OR group to a row list.
 * An empty group returns the input untouched (same reference).
 *
 * @template T
 * @param {T[]} rows
 * @param {FilterGroup} group
 * @param {FilterableColumn[]} columns
 * @returns {T[]}
 */
export function applyFilterGroup(rows, group, columns) {
  const list = Array.isArray(rows) ? rows : [];
  const conditions = group?.conditions ?? [];
  if (conditions.length === 0) return list;

  // The COLUMN is carried through (not just its type) so a projected `relation` / `colors`
  // condition can read `column.getValue(row)`.
  const colMap = new Map();
  for (const column of columns ?? []) {
    if (column?.key) colMap.set(column.key, { ...column, type: normalizeFieldType(column.type) });
  }

  // Unknown fields are filtered as text.
  const columnOf = (field) => colMap.get(field) ?? "text";
  const useOr = group?.logic === "or";

  return list.filter((row) =>
    useOr
      ? conditions.some((condition) => testFilterCondition(row, condition, columnOf(condition?.field)))
      : conditions.every((condition) => testFilterCondition(row, condition, columnOf(condition?.field)))
  );
}

/**
 * Free-text search over a row list (client side). A row matches when ANY of:
 *   1. a formatted display value contains the query (values equal to `'-'` are skipped);
 *   2. a raw scalar at one of the filter-column keys contains the query;
 *   3. any scalar anywhere on the row contains the query (objects/arrays skipped).
 *
 * @template T
 * @param {T[]} rows
 * @param {string} query
 * @param {FilterableColumn[]} [columns]
 * @param {(row: T, column: FilterableColumn) => unknown} [getDisplayValue]
 * @returns {T[]}
 */
export function filterRowsBySearch(rows, query, columns, getDisplayValue) {
  const list = Array.isArray(rows) ? rows : [];
  const needle = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return list;

  const cols = columns ?? [];
  const matches = (value) =>
    value !== null &&
    value !== undefined &&
    typeof value !== "object" &&
    String(value).toLowerCase().includes(needle);

  return list.filter((row) => {
    if (typeof getDisplayValue === "function") {
      for (const column of cols) {
        const display = getDisplayValue(row, column);
        if (display === "-") continue; // placeholder text is not searchable
        if (matches(display)) return true;
      }
    }

    for (const column of cols) {
      // Projected columns (`relation` / `colors`) search on the same text the table shows.
      if (typeof column?.getValue === "function") {
        if (matches(column.getValue(row))) return true;
        continue;
      }
      if (column?.key && matches(row?.[column.key])) return true;
    }

    for (const value of Object.values(row ?? {})) {
      if (matches(value)) return true;
    }

    return false;
  });
}
