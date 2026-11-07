// Pure state logic for the Scott bulk-edit grid.
//
// No React, no DOM, no network — everything here is a pure function over an array of
// row states, so it can be unit-tested in plain node and re-used by the CSV importer
// (which shares the same cell parsers/validators).
//
// ROW STATE
//   {
//     rowKey,            stable internal key (see the "empty-id new rows" note below)
//     original, current, the API row and the edited row
//     isNew, isDeleted, isDirty,
//     validationErrors   { [columnKey]: message, _server?: message }
//   }
//
// COLUMN CONFIG (the same shape the CSV importer consumes)
//   { key, name, type, width?, required?, min?, max?, options?, editorOptions?,
//     nullable?, emptyLabel?, readonly?, imageConfig?, parseValue? }
//
// QUIRKS REPRODUCED (do not "fix"):
//   * EMPTY-ID NEW ROWS. `createEmptyRow()` yields a row whose id is `''`, so
//     `getRowId(row.current)` returns `''` for every unsaved row and they all share
//     that grid key. `getChanges()` still reports them that way. We additionally carry
//     an internal `rowKey` (the original generated an equivalent `new-{ts}-{rand}`
//     tempId for its selection set) so React keys and per-row server errors can still
//     tell two unsaved rows apart — that is the ONLY thing rowKey is used for.
//   * SOFT DELETE. Marking a row deleted in the grid is in-grid only; the actual
//     Scott delete is a soft delete, and `status: 'inactive'` is transmitted as
//     `is_deleted: true` by the master configs' payload builders.
//   * Deleting an unsaved new row just flags it deleted, so it silently drops out of
//     `getChanges()` instead of being removed from the array.
//
// DIVERGENCE FROM THE ORIGINAL (deliberate, low-risk):
//   The original's `validateRow` coerced every value through `String()` before
//   validating, which made the `image` / `images` object branches unreachable. Here the
//   raw value is passed for those two types so the branches actually run. No shipped
//   config marks an image column `required`, so behaviour is unchanged in practice.

// ---------------------------------------------------------------------------
// Cell types
// ---------------------------------------------------------------------------

/** Every cell type the grid and the CSV importer understand. */
export const BULK_EDIT_FIELD_TYPES = Object.freeze([
  "text",
  "integer",
  "decimal",
  "enum",
  "hex",
  "boolean",
  "url",
  "image",
  "images",
  "readonly"
]);

/** Types that may be used as a CSV match key (url/hex/boolean/image/readonly cannot). */
export const KEY_ELIGIBLE_TYPES = Object.freeze(["text", "integer", "decimal", "enum"]);

const TRUE_WORDS = new Set(["true", "yes", "1", "y"]);
const FALSE_WORDS = new Set(["false", "no", "0", "n", ""]);

/**
 * Enum labels often carry a disambiguating suffix — `"Blue (#1a2b3c)"`. The display
 * name is the label with that trailing ` (...)` removed; it is what CSV cells and
 * paste payloads are matched against.
 * @param {unknown} label
 * @returns {string}
 */
export function enumOptionDisplayName(label) {
  return String(label ?? "")
    .replace(/\s*\([^()]*\)\s*$/, "")
    .trim();
}

/** `nullable ?? !required` — the rule for "may this enum/field be blank?". */
export function isColumnNullable(column) {
  if (column?.nullable !== undefined) return Boolean(column.nullable);
  return !column?.required;
}

// ---------------------------------------------------------------------------
// Parsers / validators
// ---------------------------------------------------------------------------

/** text — trims; required-empty is an error. */
export function parseText(value, column) {
  const trimmed = String(value ?? "").trim();
  if (column?.required && !trimmed) return { valid: false, error: "Required field" };
  return { valid: true, parsedValue: trimmed };
}

/** integer — empty coerces to 0; base-10; bounds are inclusive. */
export function parseInteger(value, min, max) {
  const raw = String(value ?? "").trim();
  if (raw === "") return { valid: true, parsedValue: 0 };
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return { valid: false, error: "Must be a whole number" };
  if (min !== undefined && min !== null && parsed < min) {
    return { valid: false, error: `Minimum ${min}` };
  }
  if (max !== undefined && max !== null && parsed > max) {
    return { valid: false, error: `Maximum ${max}` };
  }
  return { valid: true, parsedValue: parsed };
}

/** decimal — same as integer but `parseFloat`. */
export function parseDecimal(value, min, max) {
  const raw = String(value ?? "").trim();
  if (raw === "") return { valid: true, parsedValue: 0 };
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed)) return { valid: false, error: "Must be a number" };
  if (min !== undefined && min !== null && parsed < min) {
    return { valid: false, error: `Minimum ${min}` };
  }
  if (max !== undefined && max !== null && parsed > max) {
    return { valid: false, error: `Maximum ${max}` };
  }
  return { valid: true, parsedValue: parsed };
}

/** hex — uppercases, auto-prefixes `#`, accepts 3/4/6/8 digits; empty becomes #000000. */
export function parseHex(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "") return { valid: true, parsedValue: "#000000" };
  const digits = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9A-F]{3}([0-9A-F]{1})?$|^[0-9A-F]{6}([0-9A-F]{2})?$/.test(digits)) {
    return { valid: false, error: "Invalid hex color (e.g., #FF5733)" };
  }
  return { valid: true, parsedValue: `#${digits}` };
}

/** boolean — true/yes/1/y vs false/no/0/n/empty. */
export function parseBoolean(value) {
  if (typeof value === "boolean") return { valid: true, parsedValue: value };
  const raw = String(value ?? "").trim().toLowerCase();
  if (TRUE_WORDS.has(raw)) return { valid: true, parsedValue: true };
  if (FALSE_WORDS.has(raw)) return { valid: true, parsedValue: false };
  return { valid: false, error: "Must be true/false, yes/no, or 1/0" };
}

/** url — empty is fine, anything else must survive `new URL()`. */
export function parseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { valid: true, parsedValue: "" };
  try {
    // eslint-disable-next-line no-new
    new URL(raw);
    return { valid: true, parsedValue: raw };
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
}

/** Build the "these are the allowed values" message for a failed enum match. */
function enumFailureMessage(raw, options) {
  const names = options.map((option) => enumOptionDisplayName(option?.label) || String(option?.value ?? ""));
  const shown = names.slice(0, 10).filter(Boolean);
  const more = names.length > 10 ? ` +${names.length - 10} more` : "";
  const examples = options
    .slice(0, 3)
    .map((option) => `"${enumOptionDisplayName(option?.label) || option?.label}" (ID: ${option?.value})`)
    .join(", ");
  const allowed = shown.length ? ` Allowed: ${shown.join(", ")}${more}.` : "";
  const hint = examples ? ` Examples: ${examples}` : "";
  return `Invalid value "${raw}".${allowed}${hint}`;
}

/**
 * enum — deliberately forgiving, FIRST MATCH WINS:
 *   1. option value, exact
 *   2. option value, case-insensitive
 *   3. option label, case-insensitive
 *   4. option display name (label minus a trailing " (...)"), case-insensitive
 * Duplicate display names do NOT fail as ambiguous — the first option in list order wins.
 *
 * @param {unknown} value
 * @param {Array<{value: string, label: string}>} options
 * @param {object} [column]
 */
export function parseEnum(value, options = [], column) {
  const list = Array.isArray(options) ? options.filter(Boolean) : [];
  const raw = String(value ?? "").trim();

  if (!raw) {
    if (isColumnNullable(column)) return { valid: true, parsedValue: "" };
    return { valid: false, error: "Required field" };
  }

  const lower = raw.toLowerCase();

  for (const option of list) {
    if (String(option.value) === raw) return { valid: true, parsedValue: String(option.value) };
  }
  for (const option of list) {
    if (String(option.value).toLowerCase() === lower) {
      return { valid: true, parsedValue: String(option.value) };
    }
  }
  for (const option of list) {
    if (String(option.label ?? "").toLowerCase() === lower) {
      return { valid: true, parsedValue: String(option.value) };
    }
  }
  for (const option of list) {
    if (enumOptionDisplayName(option.label).toLowerCase() === lower) {
      return { valid: true, parsedValue: String(option.value) };
    }
  }

  return { valid: false, error: enumFailureMessage(raw, list) };
}

/** Duck-typed `File` check — `instanceof File` is unavailable in plain node tests. */
export function isFileLike(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof File !== "undefined" && value instanceof File) return true;
  return (
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.lastModified === "number"
  );
}

/** `{ existingUrl?, file?, previewUrl? }` */
export function isImageValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "existingUrl" in value || "file" in value || "previewUrl" in value;
}

/** `{ existingUrls?, files?, previewUrls? }` */
export function isImagesValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "existingUrls" in value || "files" in value || "previewUrls" in value;
}

/** image — a bare URL string or an ImageValue carrying an existing url or a new File. */
export function parseImage(value, column) {
  if (typeof value === "string") {
    if (column?.required && !value.trim()) return { valid: false, error: "Image required" };
    return { valid: true, parsedValue: value };
  }
  if (isImageValue(value)) {
    const hasImage = Boolean(value.existingUrl) || Boolean(value.file);
    if (column?.required && !hasImage) return { valid: false, error: "Image required" };
    return { valid: true, parsedValue: value };
  }
  if (column?.required) return { valid: false, error: "Image required" };
  return { valid: true, parsedValue: value };
}

/** images — an ImagesValue with at least one existing url or new File when required. */
export function parseImages(value, column) {
  if (isImagesValue(value)) {
    const count = (value.existingUrls?.length ?? 0) + (value.files?.length ?? 0);
    if (column?.required && count === 0) {
      return { valid: false, error: "At least one image required" };
    }
    return { valid: true, parsedValue: value };
  }
  if (column?.required) return { valid: false, error: "At least one image required" };
  return { valid: true, parsedValue: value };
}

/**
 * Validate one cell. A column may override everything with `parseValue(value)`.
 * Unknown types pass through untouched.
 *
 * @param {string} type
 * @param {unknown} value
 * @param {object} [column]
 * @returns {{ valid: boolean, error?: string, parsedValue?: unknown }}
 */
export function validateCellValue(type, value, column) {
  if (typeof column?.parseValue === "function") {
    const result = column.parseValue(value);
    return { valid: Boolean(result?.valid), error: result?.error, parsedValue: result?.value };
  }

  switch (type) {
    case "text":
      return parseText(value, column);
    case "integer":
      return parseInteger(value, column?.min, column?.max);
    case "decimal":
      return parseDecimal(value, column?.min, column?.max);
    case "hex":
      return parseHex(value);
    case "boolean":
      return parseBoolean(value);
    case "url":
      return parseUrl(value);
    case "enum":
      return parseEnum(value, column?.options ?? [], column);
    case "image":
      return parseImage(value, column);
    case "images":
      return parseImages(value, column);
    case "readonly":
      return { valid: true, parsedValue: value };
    default:
      return { valid: true, parsedValue: value };
  }
}

// ---------------------------------------------------------------------------
// Deep comparison (dirty tracking)
// ---------------------------------------------------------------------------

function fileSignature(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function filesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return fileSignature(a) === fileSignature(b);
}

function fileListsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((file, index) => filesEqual(file, b[index]));
}

/**
 * Deep equality tuned for grid values. Handles `File` (name + size + lastModified),
 * ImageValue, ImagesValue, arrays and plain objects; everything else compares with
 * `Object.is` after a `NaN`-tolerant check.
 */
export function isDeepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return (a ?? null) === (b ?? null);
  }

  if (isFileLike(a) || isFileLike(b)) {
    return isFileLike(a) && isFileLike(b) && filesEqual(a, b);
  }

  if (typeof a !== "object" || typeof b !== "object") {
    if (typeof a === "number" && typeof b === "number") return Object.is(a, b);
    return a === b;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => isDeepEqual(item, b[index]));
  }

  if (isImageValue(a) || isImageValue(b)) {
    if (!isImageValue(a) || !isImageValue(b)) return false;
    return (a.existingUrl ?? "") === (b.existingUrl ?? "") && filesEqual(a.file, b.file);
  }

  if (isImagesValue(a) || isImagesValue(b)) {
    if (!isImagesValue(a) || !isImagesValue(b)) return false;
    const urlsA = a.existingUrls ?? [];
    const urlsB = b.existingUrls ?? [];
    if (urlsA.length !== urlsB.length) return false;
    if (!urlsA.every((url, index) => url === urlsB[index])) return false;
    return fileListsEqual(a.files ?? [], b.files ?? []);
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && isDeepEqual(a[key], b[key]));
}

/** True when any non-readonly column differs between `original` and `current`. */
export function isRowDirty(original, current, columns = []) {
  return columns.some((column) => {
    if (!column?.key) return false;
    return !isDeepEqual(original?.[column.key], current?.[column.key]);
  });
}

// ---------------------------------------------------------------------------
// Row state
// ---------------------------------------------------------------------------

let rowKeySeed = 0;

/** `new-{timestamp}-{counter}{rand}` — the tempId the original generated per new row. */
export function createRowKey(prefix = "row") {
  rowKeySeed += 1;
  return `${prefix}-${Date.now()}-${rowKeySeed}${Math.random().toString(16).slice(2, 6)}`;
}

/**
 * Validate every non-readonly column of a row.
 *
 * `image` / `images` receive the RAW value (see the divergence note at the top of this
 * file); every other type is stringified first, exactly as the original did.
 *
 * @param {object} row
 * @param {Array<object>} columns
 * @returns {Record<string, string>} column key -> error message
 */
export function validateRow(row, columns = []) {
  const errors = {};
  for (const column of columns) {
    if (!column?.key) continue;
    if (column.readonly || column.type === "readonly") continue;
    const raw = row?.[column.key];
    const value = column.type === "image" || column.type === "images" ? raw : String(raw ?? "");
    const result = validateCellValue(column.type, value, column);
    if (!result.valid && result.error) errors[column.key] = result.error;
  }
  return errors;
}

/**
 * Wrap one API row as a grid row state.
 * @param {object} row
 * @param {{ isNew?: boolean, columns?: Array<object>, validate?: boolean, rowKey?: string }} [options]
 */
export function createRowState(row, options = {}) {
  const { isNew = false, columns = [], validate = isNew, rowKey } = options;
  return {
    rowKey: rowKey ?? createRowKey(isNew ? "new" : "row"),
    original: row,
    current: row,
    isNew,
    isDeleted: false,
    isDirty: isNew,
    validationErrors: validate ? validateRow(row, columns) : {}
  };
}

/**
 * Build the initial grid from a fetched list. Existing rows start clean and unvalidated
 * (the original only validated on edit / on birth of a new row).
 */
export function buildRowStates(data = [], columns = []) {
  return (Array.isArray(data) ? data : []).map((row) => createRowState(row, { columns }));
}

/**
 * Append an empty row. It is dirty and validated immediately, so missing required
 * fields are flagged the moment the row appears.
 */
export function addNewRow(rows, createEmptyRow, columns = []) {
  const empty = typeof createEmptyRow === "function" ? createEmptyRow() : {};
  return [...rows, createRowState(empty, { isNew: true, columns, validate: true })];
}

/**
 * Apply an edited row: recompute `isDirty` by deep comparison and re-run validation.
 * Matches on `rowKey`.
 */
export function markRowDirty(rows, rowKey, nextRow, columns = []) {
  return rows.map((state) => {
    if (state.rowKey !== rowKey) return state;
    const isDirty = state.isNew || isRowDirty(state.original, nextRow, columns);
    return {
      ...state,
      current: nextRow,
      isDirty,
      validationErrors: validateRow(nextRow, columns)
    };
  });
}

/** Write one cell and re-derive dirty/validation state. */
export function setCellValue(rows, rowKey, columnKey, value, columns = []) {
  const target = rows.find((state) => state.rowKey === rowKey);
  if (!target) return rows;
  return markRowDirty(rows, rowKey, { ...target.current, [columnKey]: value }, columns);
}

/**
 * Soft-delete rows in the grid. New rows are flagged too (so they drop out of
 * `getChanges`) rather than being spliced out — a documented quirk.
 */
export function markRowsDeleted(rows, rowKeys) {
  const keys = rowKeys instanceof Set ? rowKeys : new Set(rowKeys ?? []);
  return rows.map((state) => (keys.has(state.rowKey) ? { ...state, isDeleted: true } : state));
}

/** Undo an in-grid delete (nothing has been sent to Scott yet). */
export function restoreRows(rows, rowKeys) {
  const keys = rowKeys instanceof Set ? rowKeys : new Set(rowKeys ?? []);
  return rows.map((state) => (keys.has(state.rowKey) ? { ...state, isDeleted: false } : state));
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function hasValidationErrors(state) {
  return Object.keys(state.validationErrors ?? {}).some((key) => key !== "_server");
}

/**
 * Split the grid into the three operations the save executor runs.
 *
 * Rules (verbatim from the original):
 *   deleted && !new                     -> delete (id from `original`)
 *   new && !deleted && no errors        -> create
 *   dirty && !deleted && no errors      -> update (id from `original`)
 *   anything with validation errors is silently excluded — the Save button is disabled
 *   while `invalidCount > 0` anyway.
 *
 * `rowKey` rides along on every entry so per-row server errors can be mapped back even
 * for new rows, whose `getRowId` is `''` (see the empty-id quirk at the top).
 *
 * @param {Array<object>} rows
 * @param {(row: object) => string} getRowId
 * @returns {{ toCreate: Array<{rowKey:string,row:object}>,
 *             toUpdate: Array<{id:string,rowKey:string,row:object}>,
 *             toDelete: Array<{id:string,rowKey:string}>,
 *             toDeleteIds: string[] }}
 */
export function getChanges(rows = [], getRowId = (row) => String(row?.id ?? "")) {
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  for (const state of rows) {
    if (state.isDeleted) {
      if (state.isNew) continue; // never persisted — nothing to delete upstream
      toDelete.push({ id: getRowId(state.original), rowKey: state.rowKey });
      continue;
    }
    if (hasValidationErrors(state)) continue;
    if (state.isNew) {
      toCreate.push({ rowKey: state.rowKey, row: state.current });
      continue;
    }
    if (state.isDirty) {
      toUpdate.push({ id: getRowId(state.original), rowKey: state.rowKey, row: state.current });
    }
  }

  return { toCreate, toUpdate, toDelete, toDeleteIds: toDelete.map((entry) => entry.id) };
}

/**
 * Map per-row save failures back onto the grid, into `validationErrors._server`.
 * Matches on `rowKey` first, then on the current row's id, then the original's — the
 * original only had the last two, which could not distinguish unsaved rows.
 *
 * @param {Array<object>} rows
 * @param {Array<{ rowId?: string, rowKey?: string, error: string }>} errors
 * @param {(row: object) => string} [getRowId]
 */
export function applyServerErrors(rows = [], errors = [], getRowId = (row) => String(row?.id ?? "")) {
  if (!errors.length) return rows;

  const byKey = new Map();
  const byId = new Map();
  for (const entry of errors) {
    if (!entry?.error) continue;
    if (entry.rowKey) byKey.set(String(entry.rowKey), entry.error);
    if (entry.rowId !== undefined && entry.rowId !== null && String(entry.rowId) !== "") {
      byId.set(String(entry.rowId), entry.error);
    }
  }

  return rows.map((state) => {
    const message =
      byKey.get(state.rowKey) ??
      byId.get(String(getRowId(state.current) ?? "")) ??
      byId.get(String(getRowId(state.original) ?? ""));
    if (!message) return state;
    return {
      ...state,
      validationErrors: { ...(state.validationErrors ?? {}), _server: message }
    };
  });
}

/**
 * Reconcile the grid with what a save ACTUALLY did — the fix for the duplicate-record bug.
 *
 * Before this existed, a partial failure left every row exactly as it was: rows whose create
 * had already succeeded were still `isNew` with the empty id, and `_server` errors are
 * excluded from `hasValidationErrors`, so the retry the error toast invites re-ran
 * `getChanges` and POSTed them a second time — one duplicate per row, per retry.
 *
 * `batchSave` reports both halves of the ledger, so the reconciliation is exact:
 *
 *   succeeded create -> stops being new: `original = current` (merged with the record the
 *                       server handed back, so the row adopts its real id), clean, no errors
 *   succeeded update -> `original = current`, clean
 *   succeeded delete -> removed from the grid entirely
 *   failed anything  -> untouched, still dirty/new/deleted, ready for `applyServerErrors`
 *   not attempted    -> untouched (rows excluded by validation errors are NOT retired)
 *
 * A created row whose response carried no usable id keeps `_server` guidance instead of a
 * fabricated id: it is no longer `isNew` (so it can never be re-created) and no longer
 * `isDirty` (so it can never be PATCHed against an empty id) — the panel's "Reload rows"
 * brings the real record back.
 *
 * @param {Array<object>} rows
 * @param {{ succeeded?: Array<{rowKey?:string, operation?:string, record?:unknown}> }} result
 *   the `batchSave` return value.
 * @param {(row: object) => string} [getRowId]
 * @returns {Array<object>}
 */
export function reconcileRowsAfterSave(rows = [], result = {}, getRowId = (row) => String(row?.id ?? "")) {
  const succeeded = Array.isArray(result?.succeeded) ? result.succeeded : [];
  if (succeeded.length === 0) return rows;

  const byKey = new Map();
  for (const entry of succeeded) {
    if (entry?.rowKey) byKey.set(String(entry.rowKey), entry);
  }
  if (byKey.size === 0) return rows;

  const out = [];
  for (const state of rows) {
    const entry = byKey.get(state.rowKey);
    if (!entry) {
      out.push(state); // failed, or never attempted — leave it exactly as it is
      continue;
    }

    if (entry.operation === "delete") continue; // gone upstream; drop it from the grid

    // A create answers with the persisted record; merging it in is what gives the row its
    // real id. An update's response is merged too when it is a plain object (harmless, and
    // it picks up server-computed fields), otherwise `current` stands on its own.
    const record = entry.record && typeof entry.record === "object" && !Array.isArray(entry.record)
      ? entry.record
      : null;
    const saved = record ? { ...state.current, ...record } : { ...state.current };

    const errors = { ...(state.validationErrors ?? {}) };
    delete errors._server;

    if (entry.operation === "create" && !getRowId(saved)) {
      errors._server = "Saved on Scott, but the response carried no id — reload rows to keep editing this record.";
    }

    out.push({
      ...state,
      original: saved,
      current: saved,
      isNew: false,
      isDirty: false,
      validationErrors: errors
    });
  }

  return out;
}

/** Drop every `_server` message (called at the start of each save attempt). */
export function clearServerErrors(rows = []) {
  return rows.map((state) => {
    if (!state.validationErrors?._server) return state;
    const next = { ...state.validationErrors };
    delete next._server;
    return { ...state, validationErrors: next };
  });
}

/** Toolbar counters. `deletedCount` is the only one that counts deleted rows. */
export function computeGridStats(rows = []) {
  let dirtyCount = 0;
  let newCount = 0;
  let deletedCount = 0;
  let invalidCount = 0;

  for (const state of rows) {
    if (state.isDeleted) {
      deletedCount += 1;
      continue;
    }
    if (state.isNew) newCount += 1;
    else if (state.isDirty) dirtyCount += 1;
    if (hasValidationErrors(state)) invalidCount += 1;
  }

  return {
    dirtyCount,
    newCount,
    deletedCount,
    invalidCount,
    hasChanges: dirtyCount + newCount + deletedCount > 0,
    rowCount: rows.length
  };
}

// ---------------------------------------------------------------------------
// Paste (Excel / Google Sheets)
// ---------------------------------------------------------------------------

/** Split clipboard text into a matrix: rows on newlines, columns on tabs. */
export function parseClipboardMatrix(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

/**
 * Apply a clipboard matrix starting at (targetRowKey, targetColumnKey).
 *
 * Behaviour kept from the original:
 *   * columns are walked LEFT TO RIGHT by ABSOLUTE index — a readonly column in the
 *     middle is skipped but the offset is NOT compacted;
 *   * pasting past the last row APPENDS new rows (`createEmptyRow`, `isNew: true`);
 *   * each cell is validated; invalid cells are dropped silently, then whole-row
 *     validation still flags whatever remains wrong.
 *
 * NOTE: in the original this pipeline was unreachable — the paste handler read
 * `data-row-id` / `data-column-key` attributes that nothing ever emitted. Our grid
 * emits them, so paste actually works here. That is a deliberate divergence.
 */
export function applyPaste(rows, { targetRowKey, targetColumnKey, matrix, columns = [], createEmptyRow }) {
  if (!Array.isArray(matrix) || matrix.length === 0) return rows;

  const startRowIndex = rows.findIndex((state) => state.rowKey === targetRowKey);
  const startColumnIndex = columns.findIndex((column) => column.key === targetColumnKey);
  if (startRowIndex < 0 || startColumnIndex < 0) return rows;

  const next = [...rows];

  matrix.forEach((cells, rowOffset) => {
    const rowIndex = startRowIndex + rowOffset;

    if (rowIndex >= next.length) {
      const empty = typeof createEmptyRow === "function" ? createEmptyRow() : {};
      next.push(createRowState(empty, { isNew: true, columns, validate: false }));
    }

    const state = next[rowIndex];
    if (!state) return;

    let draft = { ...state.current };

    cells.forEach((cell, columnOffset) => {
      const column = columns[startColumnIndex + columnOffset];
      if (!column?.key) return;
      // Readonly columns absorb their slot without shifting the rest — quirk preserved.
      if (column.readonly || column.type === "readonly") return;
      const result = validateCellValue(column.type, cell, column);
      if (!result.valid) return; // invalid pasted cells are dropped silently
      draft[column.key] = result.parsedValue;
    });

    const isDirty = state.isNew || isRowDirty(state.original, draft, columns);
    next[rowIndex] = {
      ...state,
      current: draft,
      isDirty,
      validationErrors: validateRow(draft, columns)
    };
  });

  return next;
}

/** Rebuild the grid from a fresh server payload (called when a refetch lands). */
export function resetToInitial(data = [], columns = []) {
  return buildRowStates(data, columns);
}
