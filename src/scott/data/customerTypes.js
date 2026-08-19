// Customer type taxonomy, display rules and the RMP price-type linkage.
//
// Two vocabularies coexist and must not be confused:
//
//   1. The CANONICAL enum — `Customer.customer_type` is strictly 'retail' | 'distributor'.
//      That is what the create/edit form writes and what the wire field `customer_type`
//      carries. Everything in this file that *writes* uses this vocabulary.
//
//   2. The DISPLAY label — production Scott effectively uses RMP price-type NAMES as the
//      customer "type" shown in tables, exports and reports ("Regular", "Distributor",
//      "End Customer", "Corporate", "Mumbai", …). `resolveCustomerDisplayType` implements
//      that preference order; it is the only thing UI should call for a label.
//
// Scott also sends bare numeric customer-type IDs (e.g. `3`) on some endpoints. Those are
// meaningless to a reader and are deliberately DROPPED (`formatCustomerTypeLabel` returns
// undefined) rather than rendered as "3".
//
// KEY RENAME (the single most common porting mistake): the UI field on `Customer` is
// `price_type_id`, but the Scott form/wire key is `rmp_price_type_id`. Scott echoes back
// both `rmp_price_type_id` (id) and `rmp_price_type_name` (label) on reads.

import { normalizeId } from "../scottClient";

/** UI-side field name on `Customer`. */
export const CUSTOMER_PRICE_TYPE_UI_KEY = "price_type_id";
/** Wire/form field name Scott expects. */
export const CUSTOMER_PRICE_TYPE_WIRE_KEY = "rmp_price_type_id";

/** The canonical enum. Anything else is a display label, not a type. */
export const CUSTOMER_TYPES = Object.freeze(["retail", "distributor"]);

/** Exactly the two options the create/edit dialog offers. */
export const CUSTOMER_TYPE_OPTIONS = Object.freeze([
  { value: "retail", label: "Retail" },
  { value: "distributor", label: "Distributor" }
]);

/** Slugs with a fixed human label (case-insensitive lookup). */
const KNOWN_TYPE_LABELS = Object.freeze({
  retail: "Retail",
  distributor: "Distributor",
  dealer: "Dealer",
  customer: "Customer"
});

/** Keys a nested type object may hide its label under. */
const NESTED_TYPE_KEYS = Object.freeze(["name", "label", "title", "customer_type_name"]);

/** Record keys that hold an RMP price-type NAME, in priority order. */
const PRICE_TYPE_NAME_KEYS = Object.freeze([
  "rmp_price_type_name",
  "price_type_name",
  "rmpPriceTypeName"
]);

/** Record keys that hold a zone NAME (after the nested `zone` object). */
const ZONE_NAME_KEYS = Object.freeze(["zone_name", "region", "area"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = trimmed(value);
    if (text) return text;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Display taxonomy
// ---------------------------------------------------------------------------

/**
 * Human label for a customer-type slug.
 *
 * Known slugs map to their fixed label; any other non-numeric string passes through
 * verbatim (Scott invents labels freely). A BARE NUMERIC value — string or number — is
 * a Scott type ID, carries no meaning for a reader, and returns undefined.
 *
 * @param {unknown} value
 * @returns {string|undefined}
 */
export function formatCustomerTypeLabel(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return undefined;

  const text = trimmed(value);
  if (!text) return undefined;
  if (Number.isFinite(Number(text))) return undefined; // "3", "12.0" -> a type id, not a label

  return KNOWN_TYPE_LABELS[text.toLowerCase()] ?? text;
}

/**
 * Same as `formatCustomerTypeLabel`, but first unwraps a nested type object
 * (`{ name | label | title | customer_type_name }`).
 * @param {unknown} value
 * @returns {string|undefined}
 */
export function parseCustomerTypeValue(value) {
  if (isPlainObject(value)) {
    for (const key of NESTED_TYPE_KEYS) {
      const label = formatCustomerTypeLabel(value[key]);
      if (label) return label;
    }
    return undefined;
  }
  return formatCustomerTypeLabel(value);
}

/**
 * Try each key on a record until one yields a usable label.
 * @param {Record<string, unknown>} record
 * @param {string[]} [keys]
 * @returns {string|undefined}
 */
export function parseCustomerTypeFromRecord(record, keys = ["customer_type", "customer_type_name"]) {
  if (!isPlainObject(record)) return undefined;
  for (const key of keys) {
    const label = parseCustomerTypeValue(record[key]);
    if (label) return label;
  }
  return undefined;
}

/**
 * THE display rule for "customer type" everywhere (tables, CSV export, reports).
 *
 * Per record, in order:
 *   1. an RMP price-type NAME (`rmp_price_type_name` / `price_type_name` / `rmpPriceTypeName`)
 *   2. `customer_type_name`, formatted
 *   3. `customer_type`, parsed (nested objects unwrapped, numeric ids dropped)
 * then, once every record is exhausted:
 *   4. the customer's own `rmp_price_type_name`
 *   5. the customer's `customer_type`, formatted
 *
 * @param {Array<Record<string, unknown>>} records rows that may carry type info (report row, list row…)
 * @param {Record<string, unknown>} [customer] the resolved customer, used as the last resort
 * @returns {string|undefined}
 */
export function resolveCustomerDisplayType(records, customer) {
  for (const record of Array.isArray(records) ? records : []) {
    if (!isPlainObject(record)) continue;

    const priceTypeName = firstNonEmpty(...PRICE_TYPE_NAME_KEYS.map((key) => record[key]));
    if (priceTypeName) return priceTypeName;

    const named = formatCustomerTypeLabel(record.customer_type_name);
    if (named) return named;

    const parsed = parseCustomerTypeValue(record.customer_type);
    if (parsed) return parsed;
  }

  if (isPlainObject(customer)) {
    const own = firstNonEmpty(...PRICE_TYPE_NAME_KEYS.map((key) => customer[key]));
    if (own) return own;
    return formatCustomerTypeLabel(customer.customer_type);
  }
  return undefined;
}

/**
 * Zone label for a row: nested `zone` / `Zone` (object or string), then `zone_name` /
 * `region` / `area`, then `zone_id` through the lookup map, then the customer's own
 * zone fields.
 *
 * @param {Array<Record<string, unknown>>} records
 * @param {Record<string, unknown>} [customer]
 * @param {Map<string, string>} [zoneById] `zone_id` -> zone name
 * @returns {string|undefined}
 */
export function resolveZoneDisplayLabel(records, customer, zoneById) {
  const lookup = zoneById instanceof Map ? zoneById : null;

  const fromRow = (row) => {
    if (!isPlainObject(row)) return "";
    const nested = row.zone ?? row.Zone;
    if (isPlainObject(nested)) {
      const name = trimmed(nested.name ?? nested.label ?? nested.title);
      if (name) return name;
    } else {
      const name = trimmed(nested);
      if (name) return name;
    }
    const flat = firstNonEmpty(...ZONE_NAME_KEYS.map((key) => row[key]));
    if (flat) return flat;
    const zoneId = normalizeId(row.zone_id);
    if (zoneId && lookup?.has(zoneId)) return trimmed(lookup.get(zoneId));
    return "";
  };

  for (const record of Array.isArray(records) ? records : []) {
    const label = fromRow(record);
    if (label) return label;
  }
  const own = fromRow(customer);
  return own || undefined;
}

/**
 * `zone_id` -> `zone_name` map built from a customer list (used to label report rows
 * that only carry a zone id).
 * @param {Array<Record<string, unknown>>} customers
 * @returns {Map<string, string>}
 */
export function buildZoneLookupFromCustomers(customers) {
  const map = new Map();
  for (const customer of Array.isArray(customers) ? customers : []) {
    if (!isPlainObject(customer)) continue;
    const id = normalizeId(customer.zone_id ?? customer.zone?.id);
    if (!id) continue;
    // `zone` is only usable as a name when it IS a string — passing the object through
    // would stringify it to "[object Object]" and poison the lookup.
    const name = firstNonEmpty(
      customer.zone_name,
      isPlainObject(customer.zone) ? customer.zone.name : customer.zone
    );
    if (name && !map.has(id)) map.set(id, name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// RMP price type <-> customer type
// ---------------------------------------------------------------------------

/**
 * The price-type name a customer type should default to.
 * @param {'retail'|'distributor'|string} type
 * @returns {'Distributor'|'Regular'}
 */
export function preferredPriceTypeNameForCustomerType(type) {
  return type === "distributor" ? "Distributor" : "Regular";
}

/**
 * Selectable price types: not soft-deleted, not flagged inactive/deleted.
 * @param {Record<string, unknown>} type
 */
export function isActiveRmpPriceType(type) {
  if (!isPlainObject(type)) return false;
  if (type.is_deleted === true || type.is_deleted === "true") return false;
  const status = trimmed(type.status).toLowerCase();
  return status !== "inactive" && status !== "deleted";
}

/** Active-only view of a price-type list (what the dialog's select is fed). */
export function filterActiveRmpPriceTypes(types) {
  return (Array.isArray(types) ? types : []).filter(isActiveRmpPriceType);
}

function matchesZone(type, zoneKey) {
  return normalizeId(type?.zone_id) === zoneKey || normalizeId(type?.zone?.id) === zoneKey;
}

/**
 * Resolve the default RMP price type id for a preferred NAME.
 *
 * Resolution order (all four steps matter):
 *   1. active types only — but if NONE are active, fall back to the whole list rather
 *      than resolving nothing;
 *   2. the customer's own zone pool first, then the global pool;
 *   3. inside each pool: exact case-insensitive name match, then a partial `includes` match;
 *   4. undefined when nothing matches (callers treat that as "leave empty").
 *
 * @param {Array<Record<string, unknown>>} types  RmpPriceType rows
 * @param {string} preferredName e.g. 'Regular' | 'Distributor'
 * @param {string} [zoneId] the customer's zone
 * @returns {string|undefined}
 */
export function resolveDefaultRmpPriceTypeId(types, preferredName, zoneId) {
  const list = Array.isArray(types) ? types.filter(isPlainObject) : [];
  if (list.length === 0) return undefined;

  const wanted = trimmed(preferredName).toLowerCase();
  // Without a name every partial match would hit — refuse rather than pick at random.
  if (!wanted) return undefined;

  const active = list.filter(isActiveRmpPriceType);
  const pool = active.length > 0 ? active : list;

  const zoneKey = normalizeId(zoneId);
  const zoned = zoneKey ? pool.filter((type) => matchesZone(type, zoneKey)) : [];

  for (const candidates of [zoned, pool]) {
    if (candidates.length === 0) continue;

    const exact = candidates.find((type) => trimmed(type.name).toLowerCase() === wanted);
    if (exact) return normalizeId(exact.id) || undefined;

    const partial = candidates.find((type) => trimmed(type.name).toLowerCase().includes(wanted));
    if (partial) return normalizeId(partial.id) || undefined;
  }
  return undefined;
}

/**
 * Price-type id to preselect when editing a customer.
 *
 * An explicit `price_type_id` always wins — even when it is not in `types` (the type may
 * be soft-deleted or belong to another zone; clobbering it would silently re-price the
 * customer). Otherwise resolve from the echoed `rmp_price_type_name` + `zone_id`.
 *
 * @param {Record<string, unknown>} customer
 * @param {Array<Record<string, unknown>>} types
 * @returns {string} '' when nothing can be resolved
 */
export function resolveRmpPriceTypeIdFromCustomer(customer, types) {
  const existing = trimmed(customer?.[CUSTOMER_PRICE_TYPE_UI_KEY]);
  if (existing) return existing;

  const name = trimmed(customer?.rmp_price_type_name);
  if (name) return resolveDefaultRmpPriceTypeId(types, name, customer?.zone_id) ?? "";

  return "";
}

/**
 * Select-option label: `"Regular (West)"` when the type carries a zone, else just the name.
 * @param {Record<string, unknown>} type
 * @returns {string}
 */
export function formatRmpPriceTypeOptionLabel(type) {
  const name = trimmed(type?.name);
  const zoneName = trimmed(type?.zone?.name);
  return zoneName ? `${name} (${zoneName})` : name;
}
