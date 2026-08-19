// Config-driven CSV upsert pipeline: parse -> configure -> review -> commit.
//
// Driven by the SAME column configs the bulk-edit grid uses (see `bulkEditState.js`),
// so a master gets import for free once its columns exist.
//
//   1. PARSE      the file is read, the header row is mapped to columns by display
//                 name OR field key, and rows are validated in chunks of 2,000 with a
//                 yield between chunks so the UI keeps painting on 65k-row files.
//   2. CONFIGURE  the user picks the match key(s) and a strategy (update / skip /
//                 create_new).
//   3. REVIEW     rows are classified against the existing records; duplicates WITHIN
//                 the file are flagged as errors; errors and duplicates can be exported
//                 as CSV for a fix-and-reupload round trip.
//   4. COMMIT     existing rows are RE-FETCHED and every row RE-CLASSIFIED immediately
//                 before executing, then rows run in `Promise.all` batches whose size is
//                 tiered by row count: >10,000 -> 80, >1,000 -> 40, else 20.
//
// CSV PARSER — KNOWN LIMITATION, REPRODUCED ON PURPOSE:
//   The parser splits the file on newlines FIRST and only then does quote-aware comma
//   splitting per line, so a newline INSIDE a quoted field breaks the row. This matches
//   the original hand-rolled parser and is documented rather than fixed: fixing it would
//   change which rows land in the "needs fixing" bucket for files that already round-trip
//   through this app's own error/duplicate/failure exports (the writer is RFC-4180
//   correct, so anything this app emits re-imports cleanly).
//   A BOM on the first header is harmless — headers go through `trim().toLowerCase()`,
//   and key normalisation strips U+FEFF explicitly as belt-and-braces.
//
// DIVERGENCE FROM THE ORIGINAL:
//   The legacy (pre-config) importer declared 18 types but was handed 6 more by routed
//   pages (`customers`, `orders`, `fabrics`, `sizeTypes`, `baseProductTypes`,
//   `baseProductAssetInfos`); its mutation lookup had no case for any of them and threw
//   `Unsupported import type` at commit, so those dialogs could open, template and
//   validate but never import. That whole class of bug cannot occur here: there is no
//   type registry — the caller passes the column config and the mutations directly.

import {
  KEY_ELIGIBLE_TYPES,
  enumOptionDisplayName,
  parseEnum,
  validateCellValue
} from "./bulkEditState";

// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------

/** Rows processed between UI yields while parsing. */
export const CSV_PARSE_CHUNK_SIZE = 2000;

/** Import strategies offered on the configure step. */
export const IMPORT_STRATEGIES = Object.freeze([
  { value: "update", label: "Update matching rows", hint: "Existing records are patched with the CSV values." },
  { value: "skip", label: "Skip matching rows", hint: "Existing records are left untouched." },
  { value: "create_new", label: "Always create new", hint: "No matching is performed — every row is created." }
]);

/**
 * Quote-aware split of ONE csv line. Unquoted cells are trimmed; quoted cells are kept
 * verbatim so leading/trailing spaces and embedded commas survive a round trip.
 * @param {string} line
 * @returns {string[]}
 */
export function parseCSVLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  let wasQuoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        wasQuoted = true;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(wasQuoted ? current : current.trim());
      current = "";
      wasQuoted = false;
      continue;
    }
    current += char;
  }
  cells.push(wasQuoted ? current : current.trim());
  return cells;
}

/**
 * Parse a whole CSV document into a matrix. Blank lines are dropped.
 * Does NOT support newlines inside quoted fields — see the note at the top.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  return String(text ?? "")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map(parseCSVLine);
}

/** RFC-4180 escaping: quote when the value carries a delimiter, quote, newline or edge space. */
export function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Build a CSV document from a header row and a matrix of rows.
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 */
export function createCSVContent(headers = [], rows = []) {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) lines.push((row ?? []).map(escapeCsvCell).join(","));
  return lines.join("\n");
}

/** Trigger a browser download for generated CSV text. No-ops outside the browser. */
export function downloadCsv(filename, content) {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** `2026-08-15T09-31-02` — the suffix every generated CSV carries. */
export function csvTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:]/g, "-");
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** One sample cell per column type, for the downloadable template. */
export function sampleCellForColumn(column) {
  switch (column?.type) {
    case "text":
      return column.required ? `Sample ${column.name}` : "";
    case "integer":
    case "decimal":
      return column.required ? "0" : "";
    case "enum":
      return column.options?.[0]?.label ?? "";
    case "boolean":
      return "true";
    case "hex":
      return "#000000";
    default:
      return "";
  }
}

/** `{stem}-template.csv` content — headers are the column DISPLAY names. */
export function buildTemplateCsv(columns = []) {
  const headers = columns.map((column) => column.name ?? column.key);
  const sample = columns.map(sampleCellForColumn);
  return createCSVContent(headers, [sample]);
}

/** `{stem}-reference-values.csv` — one column per enum column, rows of option labels. */
export function buildReferenceValuesCsv(columns = []) {
  const enumColumns = columns.filter((column) => column.type === "enum" && column.options?.length);
  if (enumColumns.length === 0) return createCSVContent(["No dropdown columns"], []);
  const headers = enumColumns.map((column) => column.name ?? column.key);
  const depth = Math.max(...enumColumns.map((column) => column.options.length));
  const rows = [];
  for (let i = 0; i < depth; i += 1) {
    rows.push(enumColumns.map((column) => column.options[i]?.label ?? ""));
  }
  return createCSVContent(headers, rows);
}

// ---------------------------------------------------------------------------
// Step 1 — parse
// ---------------------------------------------------------------------------

/** Normalise a header cell for lookup: BOM-stripped, trimmed, lowercased. */
export function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase();
}

/**
 * Header -> column map, keyed by BOTH the lowercase display name AND the lowercase
 * field key, so a CSV may use either as its header row.
 */
export function buildColumnHeaderIndex(columns = []) {
  const index = new Map();
  for (const column of columns) {
    if (!column?.key) continue;
    const name = normalizeHeader(column.name);
    if (name && !index.has(name)) index.set(name, column);
    const key = normalizeHeader(column.key);
    if (key && !index.has(key)) index.set(key, column);
  }
  return index;
}

/**
 * Pre-build O(1) lookup maps per enum column so a 65k-row file does not do
 * `rows × options` scans. Identical semantics (and error text) to `parseEnum`.
 * @returns {Map<string, (raw: string) => {valid:boolean,error?:string,parsedValue?:unknown}>}
 */
export function buildEnumResolvers(columns = []) {
  const resolvers = new Map();

  for (const column of columns) {
    if (column?.type !== "enum") continue;
    const options = Array.isArray(column.options) ? column.options.filter(Boolean) : [];

    const byValue = new Map();
    const byValueLower = new Map();
    const byLabelLower = new Map();
    const byDisplayLower = new Map();

    for (const option of options) {
      const value = String(option.value);
      if (!byValue.has(value)) byValue.set(value, value);
      const valueLower = value.toLowerCase();
      if (!byValueLower.has(valueLower)) byValueLower.set(valueLower, value);
      const labelLower = String(option.label ?? "").toLowerCase();
      if (labelLower && !byLabelLower.has(labelLower)) byLabelLower.set(labelLower, value);
      const displayLower = enumOptionDisplayName(option.label).toLowerCase();
      // FIRST WINS on duplicate display names — never "ambiguous".
      if (displayLower && !byDisplayLower.has(displayLower)) byDisplayLower.set(displayLower, value);
    }

    resolvers.set(column.key, (raw) => {
      const text = String(raw ?? "").trim();
      if (!text) return parseEnum("", options, column);
      const lower = text.toLowerCase();
      const hit =
        byValue.get(text) ?? byValueLower.get(lower) ?? byLabelLower.get(lower) ?? byDisplayLower.get(lower);
      if (hit !== undefined) return { valid: true, parsedValue: hit };
      // Fall through to the shared parser purely for its error message.
      return parseEnum(text, options, column);
    });
  }

  return resolvers;
}

const yieldToUi = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * @typedef {object} ParsedRow
 * @property {number} rowNumber 1-based INCLUDING the header, so data starts at 2
 * @property {Record<string,string>} raw original header -> original cell text
 * @property {object} data the parsed row (undefined when the row is unusable)
 * @property {Record<string,string>} errors column display name -> message
 * @property {string[]} warnings
 * @property {boolean} valid
 */

/**
 * Step 1. Parse + validate a CSV against the column config.
 *
 * @param {string} text raw file text
 * @param {Array<object>} columns
 * @param {object} [options]
 * @param {() => object} [options.createEmptyRow] seed row for each parsed record
 * @param {number} [options.chunkSize=2000]
 * @param {(parsed: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{ rows: ParsedRow[], headers: string[], unknownHeaders: string[],
 *   missingRequiredLabels: string[], totalRows: number }>}
 */
export async function parseCsvFileText(text, columns = [], options = {}) {
  const { createEmptyRow, chunkSize = CSV_PARSE_CHUNK_SIZE, onProgress } = options;
  const matrix = parseCSV(text);

  if (matrix.length === 0) {
    return { rows: [], headers: [], unknownHeaders: [], missingRequiredLabels: [], totalRows: 0 };
  }

  const headers = matrix[0];
  const dataRows = matrix.slice(1);
  const columnIndex = buildColumnHeaderIndex(columns);
  const resolvers = buildEnumResolvers(columns);

  const mapped = headers.map((header) => columnIndex.get(normalizeHeader(header)) ?? null);
  const unknownHeaders = headers.filter((header, i) => !mapped[i] && String(header).trim() !== "");

  const present = new Set(mapped.filter(Boolean).map((column) => column.key));
  const missingRequiredLabels = columns
    .filter((column) => column.required && !present.has(column.key))
    .map((column) => column.name ?? column.key);

  const rows = [];

  for (let start = 0; start < dataRows.length; start += chunkSize) {
    const slice = dataRows.slice(start, start + chunkSize);

    slice.forEach((cells, offset) => {
      const rowNumber = start + offset + 2; // +1 for 0-based, +1 for the header row
      const raw = {};
      headers.forEach((header, i) => {
        raw[header] = cells[i] ?? "";
      });

      const errors = {};
      const warnings = [];

      for (const label of missingRequiredLabels) {
        errors[label] = "Required column missing in CSV";
      }

      const draft = typeof createEmptyRow === "function" ? createEmptyRow() : {};

      headers.forEach((header, i) => {
        const column = mapped[i];
        if (!column) return;
        const cell = cells[i] ?? "";
        const resolver = resolvers.get(column.key);
        const result = resolver ? resolver(cell) : validateCellValue(column.type, cell, column);
        if (result.valid) draft[column.key] = result.parsedValue;
        else errors[column.name ?? column.key] = result.error ?? "Invalid value";
      });

      const valid = Object.keys(errors).length === 0;
      // `data` is kept even for invalid rows so the review table can preview them.
      rows.push({ rowNumber, raw, data: draft, errors, warnings, valid });
    });

    try {
      onProgress?.(rows.length, dataRows.length);
    } catch {
      /* ignore */
    }
    if (start + chunkSize < dataRows.length) await yieldToUi();
  }

  return { rows, headers, unknownHeaders, missingRequiredLabels, totalRows: dataRows.length };
}

// ---------------------------------------------------------------------------
// Step 2 — configure (match keys + strategy)
// ---------------------------------------------------------------------------

/** Columns usable as a match key: text / integer / decimal / enum only. */
export function keyEligibleColumns(columns = []) {
  return columns.filter(
    (column) =>
      column?.key &&
      !column.readonly &&
      KEY_ELIGIBLE_TYPES.includes(column.type)
  );
}

/**
 * Default match keys: explicit override -> the "Name" column -> the first required text
 * column -> the first eligible column.
 */
export function resolveDefaultMatchKeys(columns = [], defaultKeyFields) {
  const eligible = keyEligibleColumns(columns);
  if (eligible.length === 0) return [];

  if (Array.isArray(defaultKeyFields) && defaultKeyFields.length > 0) {
    const allowed = new Set(eligible.map((column) => column.key));
    const picked = defaultKeyFields.filter((key) => allowed.has(key));
    if (picked.length > 0) return picked;
  }

  const named = eligible.find((column) => normalizeHeader(column.name) === "name" || column.key === "name");
  if (named) return [named.key];

  const requiredText = eligible.find((column) => column.required && column.type === "text");
  if (requiredText) return [requiredText.key];

  return [eligible[0].key];
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function normalizeKeyPart(value, column, { matchEnumKeysByValueId = false } = {}) {
  const type = column?.type;

  if (type === "integer") {
    const n = Number(value);
    if (Number.isFinite(n)) return String(Math.floor(n));
    return String(value ?? "").trim().toLowerCase();
  }
  if (type === "decimal") {
    const n = Number(value);
    if (Number.isFinite(n)) return String(n);
    return String(value ?? "").trim().toLowerCase();
  }
  if (type === "enum") {
    const resolved = parseEnum(value, column?.options ?? [], column);
    if (resolved.valid && resolved.parsedValue !== "") {
      const id = String(resolved.parsedValue);
      if (matchEnumKeysByValueId) return id.toLowerCase();
      // Otherwise match on the DISPLAY NAME so duplicate options that share a name
      // still align with the DB rows they came from.
      const option = (column.options ?? []).find((entry) => String(entry.value) === id);
      return enumOptionDisplayName(option?.label).trim().toLowerCase();
    }
    return String(value ?? "").trim().toLowerCase();
  }

  return String(value ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase();
}

/**
 * Composite match key: `part1|part2|…`.
 * @param {object} row
 * @param {string[]} keys
 * @param {Array<object>} columns
 * @param {{matchEnumKeysByValueId?: boolean}} [options]
 */
export function normalizeKeyValue(row, keys = [], columns = [], options = {}) {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  return keys
    .map((key) => normalizeKeyPart(row?.[key], byKey.get(key), options))
    .join("|");
}

/**
 * Index existing rows by composite key. Empty keys are skipped; on duplicate keys the
 * LAST row wins (matches the original, which logged a DEV warning).
 */
export function buildExistingIndex(existingRows = [], keys = [], columns = [], options = {}) {
  const index = new Map();
  let emptyKeys = 0;
  let duplicateKeys = 0;

  for (const row of existingRows) {
    const key = normalizeKeyValue(row, keys, columns, options);
    if (!key || key === keys.map(() => "").join("|")) {
      emptyKeys += 1;
      continue;
    }
    if (index.has(key)) duplicateKeys += 1;
    index.set(key, row);
  }

  return { index, emptyKeys, duplicateKeys };
}

// ---------------------------------------------------------------------------
// Step 3 — review / classification
// ---------------------------------------------------------------------------

/**
 * Classify every parsed row into `create | update | skip | error`.
 *
 * In-file duplicates: the FIRST occurrence of a key is actionable, every later row with
 * the same key becomes an error carrying `errors._duplicate`.
 *
 * @returns {{ rows: Array<ParsedRow & {action:string, matchedExisting?: object, key?: string}>,
 *   summary: { create:number, update:number, skip:number, error:number, duplicate:number } }}
 */
export function classifyParsedRows(parsedRows = [], existingIndex, config = {}) {
  const { strategy = "update", keys = [], columns = [], matchEnumKeysByValueId = false } = config;
  const index = existingIndex instanceof Map ? existingIndex : existingIndex?.index ?? new Map();

  const seenCsvKeys = new Map();
  const summary = { create: 0, update: 0, skip: 0, error: 0, duplicate: 0 };

  const rows = parsedRows.map((row) => {
    if (!row.valid) {
      summary.error += 1;
      return { ...row, action: "error" };
    }

    const key = normalizeKeyValue(row.data, keys, columns, { matchEnumKeysByValueId });

    // In-file duplicates are flagged under EVERY strategy, `create_new` included: the check
    // is about the file contradicting itself, not about matching existing records, and two
    // rows sharing a key are just as wrong when both would be inserted.
    if (key) {
      const firstAt = seenCsvKeys.get(key);
      if (firstAt !== undefined) {
        summary.error += 1;
        summary.duplicate += 1;
        return {
          ...row,
          action: "error",
          key,
          errors: {
            ...row.errors,
            _duplicate: `Duplicate of row ${firstAt} — same key "${key}" already appears in this file`
          }
        };
      }
      seenCsvKeys.set(key, row.rowNumber);
    }

    if (strategy === "create_new") {
      summary.create += 1;
      return { ...row, action: "create", key };
    }

    const matched = index.get(key);
    if (!matched) {
      summary.create += 1;
      return { ...row, action: "create", key };
    }

    if (strategy === "skip") {
      summary.skip += 1;
      return { ...row, action: "skip", key, matchedExisting: matched };
    }

    summary.update += 1;
    return { ...row, action: "update", key, matchedExisting: matched };
  });

  return { rows, summary };
}

/** `{stem}-import-errors-{ts}.csv` — original row + an `Errors` (and `Warnings`) column. */
export function buildErrorsCsv(rows = [], headers = []) {
  const failing = rows.filter((row) => row.action === "error" || !row.valid);
  const hasWarnings = failing.some((row) => (row.warnings ?? []).length > 0);
  const outHeaders = ["Row", ...headers, "Errors", ...(hasWarnings ? ["Warnings"] : [])];
  const body = failing.map((row) => [
    row.rowNumber,
    ...headers.map((header) => row.raw?.[header] ?? ""),
    Object.entries(row.errors ?? {})
      .map(([column, message]) => `${column}: ${message}`)
      .join(" | "),
    ...(hasWarnings ? [(row.warnings ?? []).join(" | ")] : [])
  ]);
  return createCSVContent(outHeaders, body);
}

/** `{stem}-import-duplicates-{ts}.csv` — Row + original headers + Reason. */
export function buildDuplicatesCsv(rows = [], headers = []) {
  const duplicates = rows.filter((row) => row.errors?._duplicate);
  const outHeaders = ["Row", ...headers, "Reason"];
  const body = duplicates.map((row) => [
    row.rowNumber,
    ...headers.map((header) => row.raw?.[header] ?? ""),
    row.errors._duplicate
  ]);
  return createCSVContent(outHeaders, body);
}

/**
 * `{stem}-failures-{ts}.csv` — original headers plus a `comments` column carrying the
 * server error, designed for fix-and-reupload round trips.
 */
export function buildFailuresCsv(failures = [], headers = []) {
  const outHeaders = ["Row", ...headers, "comments"];
  const body = failures.map((failure) => [
    failure.rowNumber,
    ...headers.map((header) => failure.raw?.[header] ?? ""),
    failure.error
  ]);
  return createCSVContent(outHeaders, body);
}

// ---------------------------------------------------------------------------
// Step 4 — commit
// ---------------------------------------------------------------------------

/** Tiered concurrency: >10,000 rows -> 80, >1,000 -> 40, else 20. */
export function resolveImportConcurrency(rowCount) {
  const n = Number(rowCount) || 0;
  if (n > 10000) return 80;
  if (n > 1000) return 40;
  return 20;
}

/** Rows above this get the "each row is an individual API call" warning on review. */
export const LARGE_IMPORT_WARNING_THRESHOLD = 10000;

function errorMessage(error) {
  if (error instanceof Error) return error.message || "Request failed";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message || "Request failed";
  }
  return "Request failed";
}

/**
 * Step 4. Execute the import.
 *
 * Before anything is written the existing rows are re-fetched and every actionable row
 * is re-classified against a fresh index, so a stale review screen can never turn an
 * update into a duplicate create. A failure of that re-fetch is NON-FATAL: the cached
 * rows are reused.
 *
 * @param {object} params
 * @param {Array<object>} params.rows classified rows from `classifyParsedRows`
 * @param {Array<object>} params.columns
 * @param {string[]} params.keys match keys
 * @param {"update"|"skip"|"create_new"} params.strategy
 * @param {Array<object>} [params.existingRows] rows already fetched during review
 * @param {() => Promise<Array<object>>} [params.fetchExisting] pre-commit re-fetch
 * @param {(payload: object) => Promise<unknown>} params.createMutation
 * @param {(args: {id: string, updates: object}) => Promise<unknown>} params.updateMutation
 * @param {(row: object) => object} [params.toCreatePayload]
 * @param {(row: object) => object} [params.toUpdatePayload]
 * @param {(row: object) => string} [params.getRowId]
 * @param {boolean} [params.matchEnumKeysByValueId]
 * @param {(completed: number, total: number) => void} [params.onProgress]
 * @param {() => boolean} [params.shouldAbort] checked BETWEEN batches
 * @returns {Promise<{created:number,updated:number,skipped:number,failed:number,
 *   aborted:boolean, failures: Array<{rowNumber:number,error:string,raw:object}>}>}
 */
export async function runCsvImport(params) {
  const {
    rows = [],
    columns = [],
    keys = [],
    strategy = "update",
    existingRows = [],
    fetchExisting,
    createMutation,
    updateMutation,
    toCreatePayload = (row) => row,
    toUpdatePayload = (row) => row,
    getRowId = (row) => String(row?.id ?? ""),
    matchEnumKeysByValueId = false,
    onProgress,
    shouldAbort
  } = params ?? {};

  // 1. Re-fetch existing rows. Failure is non-fatal.
  let currentExisting = existingRows;
  if (typeof fetchExisting === "function" && strategy !== "create_new") {
    try {
      const fresh = await fetchExisting();
      if (Array.isArray(fresh)) currentExisting = fresh;
    } catch (error) {
      console.warn("[scott] bulk import: pre-commit refetch failed, using cached rows", error);
    }
  }

  // 2. Rebuild the index and re-classify. Rows that became `skip` are dropped.
  const { index } = buildExistingIndex(currentExisting, keys, columns, { matchEnumKeysByValueId });
  const actionable = rows.filter((row) => row.action === "create" || row.action === "update");
  const preflightSkipped = rows.filter((row) => row.action === "skip").length;

  const planned = [];
  let reclassifiedSkips = 0;

  for (const row of actionable) {
    if (strategy === "create_new") {
      planned.push({ ...row, action: "create" });
      continue;
    }
    const key = row.key ?? normalizeKeyValue(row.data, keys, columns, { matchEnumKeysByValueId });
    const matched = index.get(key);
    if (!matched) {
      planned.push({ ...row, action: "create", matchedExisting: undefined });
      continue;
    }
    if (strategy === "skip") {
      reclassifiedSkips += 1;
      continue;
    }
    planned.push({ ...row, action: "update", matchedExisting: matched });
  }

  // 3. Tiered concurrency.
  const concurrency = resolveImportConcurrency(planned.length);
  const failures = [];
  let created = 0;
  let updated = 0;
  let completed = 0;
  let aborted = false;

  async function runRow(row) {
    try {
      if (row.action === "create") {
        await createMutation(toCreatePayload(row.data));
        created += 1;
      } else {
        // Columns absent from the CSV keep their DB values.
        const merged = { ...row.matchedExisting, ...row.data };
        await updateMutation({
          id: getRowId(row.matchedExisting),
          updates: toUpdatePayload(merged)
        });
        updated += 1;
      }
    } catch (error) {
      failures.push({ rowNumber: row.rowNumber, error: errorMessage(error), raw: row.raw });
    } finally {
      completed += 1;
      try {
        onProgress?.(completed, planned.length);
      } catch {
        /* ignore */
      }
    }
  }

  for (let i = 0; i < planned.length; i += concurrency) {
    // Abort is checked BETWEEN batches — an already-dispatched batch always finishes.
    if (typeof shouldAbort === "function" && shouldAbort()) {
      aborted = true;
      break;
    }
    await Promise.all(planned.slice(i, i + concurrency).map(runRow));
  }

  return {
    created,
    updated,
    skipped: preflightSkipped + reclassifiedSkips,
    failed: failures.length,
    aborted,
    failures,
    concurrency
  };
}

/** House toast copy for a finished import. */
export function summarizeImport(result) {
  const created = result?.created ?? 0;
  const updated = result?.updated ?? 0;
  const skipped = result?.skipped ?? 0;
  const failed = result?.failed ?? 0;
  if (failed > 0) {
    return {
      tone: "error",
      message: `${failed} of ${created + updated + failed} rows failed.`
    };
  }
  return {
    tone: "success",
    message: `Import complete: ${created} created, ${updated} updated, ${skipped} skipped.`
  };
}
