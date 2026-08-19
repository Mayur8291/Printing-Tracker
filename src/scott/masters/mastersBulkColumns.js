// Adapters between a master config's `fields` array and the column config the BULK layer
// consumes (`src/scott/bulk/bulkEditState.js` — the same shape the grid and the CSV
// importer both read).
//
// `mastersDialogFields.js` does the equivalent job for `ScottEntityDialog`; this is its
// sibling for `ScottBulkEditGrid` / `ScottCsvImportDialog`. Both read the SAME `fields`
// array, so a master gets bulk edit and CSV import the moment its form fields exist.
//
// TYPE MAP (config field type -> bulk column type)
//   text, textarea, date  -> text
//   number                -> decimal        (see the note below)
//   color                 -> hex
//   switch, boolean       -> boolean
//   image                 -> image          (round-tripped through the field's `fileKey`)
//   select, enum          -> enum           (static `options`, or a relation master's
//                                            drained options, or `text` when neither
//                                            exists — mirroring `resolveSelectField`)
//   image-slots           -> one `url` column PER SLOT (`image_1`…`image_5`)
//   multiselect, image-list -> DROPPED
//
// WHY EVERY NUMBER IS A `decimal`
//   The configs carry no integer/decimal marker (`position`, `sort_order`, `price` and
//   `cgst` are all just `type: 'number'`). Rejecting `1.5` in a position cell the server
//   would happily round is worse than accepting it, so the stricter `integer` parser is
//   only used when a field opts in with `step: 1` / `integer: true`. `min` / `max` are
//   forwarded either way.
//
// WHY MULTISELECT / IMAGE-LIST ARE DROPPED
//   `multiselect` values (`fabric_ids`, `rmp_category_ids`, …) are written through the
//   service's relation SUB-ENDPOINTS, not through the create/update body — a grid cell
//   editing them would silently save nothing. `image-list` is a read-side gallery. Neither
//   is representable as one cell, so both are left to the row dialog. Neither is `required`,
//   and every payload builder already treats an absent list as "no change".
//
// WHY `image-slots` IS NOT DROPPED (it used to be)
//   One `image-slots` FIELD maps onto N wire fields — rmp_classes' `imageFiles` covers
//   `image_1`…`image_5` — so it is not one cell, it is five. Dropping it cost RMP Classes
//   its five documented URL columns, which also meant nothing in the app ever produced a
//   `url` column: the cell type's parser, renderer and editor were unreachable, and a CSV
//   round-trip silently discarded the image URLs. Each slot now becomes its own `url`
//   column ("Image 1".."Image 5", w220). File PICKING still belongs to the row dialog; the
//   grid and CSV carry URLs, which is exactly what the payload builders read per slot.
//
// NULLABLE ENUMS
//   A nullable relation select gets `nullable: true` and the grid's own "None" item, which
//   commits `''`. That is exactly what the payload builders expect: they map their
//   `noneValue` sentinel (`'none'`, `'__rmp_none__'`) to `''` and then omit the key, so an
//   empty cell and the sentinel are indistinguishable on the wire.

import { supportsScottBulkDelete } from "@/scott/bulk/bulkDeleteService";
import { fileKeyFor, isFileLikeValue } from "@/scott/masters/mastersDialogFields";

/** Field types that cannot be expressed as grid cells at all. */
export const BULK_UNSUPPORTED_FIELD_TYPES = Object.freeze(["multiselect", "image-list"]);

const UNSUPPORTED = new Set(BULK_UNSUPPORTED_FIELD_TYPES);

/** Per-type column widths, in px. */
const WIDTHS = Object.freeze({
  text: 190,
  textarea: 240,
  decimal: 120,
  integer: 120,
  enum: 200,
  boolean: 100,
  hex: 140,
  image: 130,
  url: 220
});

/**
 * The wire keys an `image-slots` field expands to. `field.slots` is what rmp_classes'
 * `imageFiles` declares; `config.imageSlots` is the same list published at config level.
 */
function imageSlotKeys(field, config) {
  const slots = Array.isArray(field?.slots) && field.slots.length > 0 ? field.slots : config?.imageSlots;
  return Array.isArray(slots) ? slots.filter((slot) => typeof slot === "string" && slot) : [];
}

/** `image_3` -> "Image 3"; anything unparseable keeps the raw key. */
function imageSlotLabel(slot, index) {
  const match = /^image[_-]?(\d+)$/i.exec(String(slot));
  if (match) return `Image ${match[1]}`;
  return `Image ${index + 1}`;
}

/**
 * Server-upload CSV header names. Scott's own parser reads the header text on the
 * `rmp_prices` bulk_upload path, and the documented contract is
 * `Name, Price, MRP, RMP SKU, Price Type, Status` — the field labels ("SKU", "Price type")
 * are the row-dialog's wording and must not leak into that file.
 */
const SERVER_UPLOAD_HEADERS = Object.freeze({
  rmp_sku_id: "RMP SKU",
  rmp_price_type_id: "Price Type"
});

function isIntegerField(field) {
  return field?.integer === true || field?.step === 1;
}

/** `nullable ?? !required` — the same rule `bulkEditState.isColumnNullable` applies. */
function nullableOf(field) {
  if (field?.nullable !== undefined) return Boolean(field.nullable);
  return !field?.required;
}

function staticOptions(field) {
  if (!Array.isArray(field?.options)) return [];
  return field.options
    .filter((option) => option && option.value !== undefined && option.value !== null)
    .map((option) => ({ value: String(option.value), label: String(option.label ?? option.value) }));
}

/**
 * One `select` / `enum` field -> one column.
 * `relationsAsText` downgrades relation-backed selects to free text; the RMP Prices
 * server upload uses it so the CSV can be validated without draining `rmp_skus`.
 */
function enumColumn(base, field, optionsByResource, relationsAsText) {
  const fixed = staticOptions(field);
  if (fixed.length > 0) {
    return { ...base, type: "enum", options: fixed, nullable: nullableOf(field), emptyLabel: field.emptyLabel };
  }

  const resource = typeof field.optionsResource === "string" ? field.optionsResource : "";
  // No resource to read (e.g. `rmp_price_types.zone_id`, sourced from the local Supabase
  // zones master) — an empty dropdown is unanswerable, so it degrades to an id input,
  // exactly as the row dialog does.
  if (!resource || relationsAsText) {
    return { ...base, type: "text", width: WIDTHS.text };
  }

  const entry = optionsByResource?.[resource];
  return {
    ...base,
    type: "enum",
    options: Array.isArray(entry?.options) ? entry.options : [],
    nullable: nullableOf(field),
    emptyLabel: field.emptyLabel
  };
}

/**
 * Master config -> bulk-edit / CSV column configs.
 *
 * @param {object} config a master config from `masterConfigs.js`.
 * @param {Record<string, {options?: Array<{value:string,label:string}>}>} [optionsByResource]
 *   relation option lists, from `useMasterRelationOptions`.
 * @param {{relationsAsText?: boolean, serverUpload?: boolean}} [options]
 *   `serverUpload` switches the two relation columns to the header text Scott's own CSV
 *   parser expects (see `SERVER_UPLOAD_HEADERS`).
 * @returns {Array<object>} columns for `ScottBulkEditGrid` / `ScottCsvImportDialog`.
 */
export function bulkColumnsFor(config, optionsByResource = {}, options = {}) {
  const { relationsAsText = false, serverUpload = false } = options;
  const columns = [];

  for (const field of config?.fields ?? []) {
    if (!field?.key) continue;
    const type = field.type || "text";
    if (UNSUPPORTED.has(type)) continue;

    if (type === "image-slots") {
      // One field, one column per slot — the five `url` columns RMP Classes documents.
      imageSlotKeys(field, config).forEach((slot, index) => {
        columns.push({
          key: slot,
          name: imageSlotLabel(slot, index),
          required: false,
          type: "url",
          width: WIDTHS.url
        });
      });
      continue;
    }

    const base = {
      key: field.key,
      name: (serverUpload ? SERVER_UPLOAD_HEADERS[field.key] : undefined) ?? field.label ?? field.key,
      required: Boolean(field.required),
      width: WIDTHS.text
    };

    if (type === "number") {
      const numeric = isIntegerField(field) ? "integer" : "decimal";
      columns.push({ ...base, type: numeric, width: WIDTHS[numeric], min: field.min, max: field.max });
      continue;
    }
    if (type === "color") {
      columns.push({ ...base, type: "hex", width: WIDTHS.hex });
      continue;
    }
    if (type === "switch" || type === "boolean") {
      columns.push({ ...base, type: "boolean", width: WIDTHS.boolean });
      continue;
    }
    if (type === "image") {
      // `urlKey`: where a bulk/CSV cell holding an image URL must land on the write form.
      // Some configs (rmp_categories) deliberately ignore the echoed stored URL under the
      // field key so the dialog stops re-uploading it, and read a NEW url from a separate
      // key instead — without this the CSV image column is silently inert.
      columns.push({
        ...base,
        type: "image",
        width: WIDTHS.image,
        fileKey: fileKeyFor(field),
        ...(field.urlKey ? { urlKey: field.urlKey } : {})
      });
      continue;
    }
    if (type === "select" || type === "enum") {
      columns.push(enumColumn({ ...base, width: WIDTHS.enum }, field, optionsByResource, relationsAsText));
      continue;
    }
    columns.push({ ...base, type: "text", width: type === "textarea" ? WIDTHS.textarea : WIDTHS.text });
  }

  return columns;
}

/** Relation masters whose options a bulk column set needs (`[]` once downgraded to text). */
export function bulkRelationResourcesFor(config, { relationsAsText = false } = {}) {
  if (relationsAsText) return [];
  const seen = [];
  for (const field of config?.fields ?? []) {
    if (!field?.key || UNSUPPORTED.has(field.type)) continue;
    const type = field.type || "text";
    if (type !== "select" && type !== "enum") continue;
    if (staticOptions(field).length > 0) continue;
    const resource = field.optionsResource;
    if (typeof resource === "string" && resource && !seen.includes(resource)) seen.push(resource);
  }
  return seen;
}

/** Default cell value for a column type when the field declares no `defaultValue`. */
function emptyValueFor(type) {
  switch (type) {
    case "integer":
    case "decimal":
      return 0;
    case "boolean":
      return false;
    case "hex":
      return "#000000";
    case "image":
      return "";
    default:
      return "";
  }
}

/**
 * A blank row for "Add row" / CSV seeding: every bulk column at its config default, plus an
 * EMPTY id — `getChanges` classifies rows by the grid's own `isNew` flag, and an empty id is
 * the documented shape for an unsaved row (see `bulkEditState.js`).
 *
 * @param {object} config
 * @param {Array<object>} [columns] pass the derived columns to keep the two in step.
 */
export function createEmptyBulkRow(config, columns) {
  const list = Array.isArray(columns) && columns.length > 0 ? columns : bulkColumnsFor(config);
  const byKey = new Map((config?.fields ?? []).map((field) => [field.key, field]));
  const row = { [config?.idField || "id"]: "" };

  for (const column of list) {
    const field = byKey.get(column.key);
    row[column.key] = field?.defaultValue !== undefined ? field.defaultValue : emptyValueFor(column.type);
  }
  return row;
}

/**
 * Grid/CSV row -> the form `service.create` / `service.update` expect.
 *
 * This is the bulk-layer twin of `toWriteForm`: it only re-homes image values, because the
 * config payload builders read a freshly picked file and an existing URL from two different
 * keys (`logoFile` vs `logo_url`). The grid's image cell hands back
 * `{ existingUrl?, file?, previewUrl? }`; an untouched cell is still the plain URL string
 * the list row carried.
 *
 * Keys outside the bulk column set (ids, timestamps, embedded relation objects) are dropped,
 * so a partial-body master never receives fields it does not accept.
 */
export function bulkRowToWriteForm(config, row, columns) {
  const list = Array.isArray(columns) && columns.length > 0 ? columns : bulkColumnsFor(config);
  const byKey = new Map((config?.fields ?? []).map((field) => [field.key, field]));
  const form = {};

  for (const column of list) {
    const field = byKey.get(column.key);
    const value = row?.[column.key];

    if (column.type === "image") {
      const fileKey = column.fileKey || fileKeyFor(field ?? { key: column.key });
      const urlKey = column.urlKey || field?.urlKey || "";
      const putUrl = (url) => {
        form[column.key] = url;
        if (urlKey) form[urlKey] = url;
      };
      if (typeof value === "string") {
        putUrl(value);
      } else if (value && typeof value === "object") {
        if (isFileLikeValue(value.file)) form[fileKey] = value.file;
        putUrl(typeof value.existingUrl === "string" ? value.existingUrl : "");
      } else {
        putUrl("");
      }
      continue;
    }

    if (column.type === "boolean") {
      form[column.key] = value === true || value === "true";
      continue;
    }

    form[column.key] = value;
  }

  return form;
}

/** `(row) => id` for the bulk layer, honouring `config.idField`. */
export function bulkRowIdFor(config) {
  const idField = config?.idField || "id";
  return (row) => {
    const value = row?.[idField] ?? row?.id;
    return value === null || value === undefined ? "" : String(value);
  };
}

/**
 * May this master's list page offer bulk delete?
 * BOTH sides must agree: the config declares the endpoint, and `bulkDeleteService` confirms
 * the resource is really wired for it (it excludes `base_product_types`, whose DELETE never
 * carries a body, so `ids[]` would be dropped silently).
 */
export function supportsMasterBulkDelete(config) {
  return config?.supportsBulkDelete === true && supportsScottBulkDelete(config?.resource);
}

/** RMP Prices only: the config declares a server-side `bulk_upload` + status endpoint. */
export function usesServerBulkUpload(config) {
  return Boolean(config?.bulkUpload?.pathSuffix);
}

/** CSV match keys the config prefers (`rmp_prices` keys on the SKU + price-type pair). */
export function defaultBulkMatchKeys(config) {
  const keys = config?.bulkImportMatch?.matchKeys;
  return Array.isArray(keys) && keys.length > 0 ? keys : undefined;
}

/**
 * Should CSV match keys be compared by RESOLVED OPTION ID rather than display name?
 *
 * It matters whenever a match key is an enum: `rmp_prices` keys on
 * `(rmp_sku_id, rmp_price_type_id)`, and two SKUs may share a display name while their ids
 * never collide. A config can declare it; otherwise the server-upload master gets it, which
 * is the documented wiring (inert while Scott owns the matching, load-bearing the moment
 * that master falls back to the client upsert path).
 */
export function bulkMatchEnumKeysByValueId(config) {
  if (config?.bulkImportMatch?.matchEnumKeysByValueId !== undefined) {
    return config.bulkImportMatch.matchEnumKeysByValueId === true;
  }
  return usesServerBulkUpload(config);
}

/** `rmp-prices` — the stem every generated CSV filename is built from. */
export function bulkFilenameStem(config) {
  return String(config?.key || config?.resource || "master").replace(/_/g, "-");
}
