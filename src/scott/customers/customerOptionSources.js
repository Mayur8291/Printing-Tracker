// Option sources for the Scott customers create/edit dialog.
//
// `buildCustomerFields` (src/scott/data/customersConfig.js) accepts three injected option
// lists — `priceTypeOptions`, `stateOptions`, `cityOptions` — and sources none of them
// itself. This module is where they come from.
//
// ---------------------------------------------------------------------------
// WHERE EACH LIST COMES FROM
// ---------------------------------------------------------------------------
//   PRICE TYPES — a real source. The RMP masters registry:
//     `getMastersService('rmp_price_types').listAll()`. Rows arrive already normalized by
//     `rmpPriceTypesConfig.normalize` (`{ id, name, price_for, zone_id, zone, status }`),
//     which is exactly the shape `resolveDefaultRmpPriceTypeId` / `filterActiveRmpPriceTypes`
//     / `formatRmpPriceTypeOptionLabel` expect.
//
//   STATES / CITIES — NO ENUMERABLE SOURCE EXISTS. ScottOne read them from two Supabase
//     tables that this project does not have, and the Scott API exposes no `/states` or
//     `/cities` route. `customerLocationCatalogue.js` is the replacement: the STATE list is
//     a static all-India name list (so any state is enterable, not just the ones on the
//     loaded page), the CITY field is free text, and upstream ids are attached only when
//     they have actually been observed on real data. Nothing here ever puts a NAME into an
//     `*_id` field again.
//
//   ZONES — derived the same way, from `zone_id` + `zone_name` on the loaded rows. Zone is
//     a server-side list filter (`zone_id`), so only real ids are offered there; a
//     name-only zone is skipped rather than sent upstream as a bogus id.

import { normalizeId } from "@/scott/scottClient";
import { knownCityNames, knownStateNames } from "@/scott/customers/customerLocationCatalogue";
import { getMastersService } from "@/scott/data/masterConfigs";
import {
  filterActiveRmpPriceTypes,
  formatRmpPriceTypeOptionLabel
} from "@/scott/data/customerTypes";

/** Sentinel for the "no filter" entry of a shadcn Select (Radix rejects `value=""`). */
export const ALL_OPTION_VALUE = "__all__";

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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// RMP price types
// ---------------------------------------------------------------------------

/**
 * Every RMP price type, newest registry state. Rows are normalized by the masters config.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function loadRmpPriceTypes() {
  const rows = await getMastersService("rmp_price_types").listAll();
  return Array.isArray(rows) ? rows : [];
}

/**
 * Active price types as `ScottEntityDialog` select options.
 * Label is `"Regular (West)"` when the type carries a zone — `formatRmpPriceTypeOptionLabel`.
 * @param {Array<Record<string, unknown>>} types
 * @returns {Array<{value: string, label: string}>}
 */
export function buildPriceTypeOptions(types) {
  return filterActiveRmpPriceTypes(types)
    .map((type) => ({
      value: normalizeId(type?.id),
      label: formatRmpPriceTypeOptionLabel(type) || normalizeId(type?.id)
    }))
    .filter((option) => option.value && option.label)
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// States / cities
// ---------------------------------------------------------------------------

/**
 * State options for the dialog.
 *
 * The VALUE IS THE NAME, deliberately and visibly — the field key is `state_name`, so no
 * consumer can mistake it for an FK. `customerLocationCatalogue.resolveLocationIds` turns
 * the chosen name into an upstream id at submit time, or into `''` (= "omit the key").
 *
 * The static all-India list is unioned with every state name visible on the loaded rows, so
 * a spelling Scott uses that is not in the static list still appears (and an edit therefore
 * never renders a blank select).
 *
 * @param {Array<Record<string, unknown>>} [customers] rows to harvest extra names from
 * @returns {Array<{value: string, label: string}>}
 */
export function buildStateOptions(customers = []) {
  const seen = [];
  for (const customer of Array.isArray(customers) ? customers : []) {
    if (!isPlainObject(customer)) continue;
    const address = Array.isArray(customer.addresses) ? customer.addresses[0] : undefined;
    const name = firstNonEmpty(address?.state?.name, customer.state_name);
    if (name) seen.push(name);
  }
  return knownStateNames(seen).map((name) => ({ value: name, label: name }));
}

/**
 * City name suggestions for the (free-text) City field, narrowed to a state when one is
 * chosen. Never a gate: an unlisted city is typed straight in.
 *
 * @param {Array<Record<string, unknown>>} [customers]
 * @param {string} [stateName]
 * @returns {string[]}
 */
export function buildCitySuggestions(customers = [], stateName = "") {
  const wantedState = trimmed(stateName).toLowerCase();
  const seen = [];

  for (const customer of Array.isArray(customers) ? customers : []) {
    if (!isPlainObject(customer)) continue;
    const address = Array.isArray(customer.addresses) ? customer.addresses[0] : undefined;
    const city = firstNonEmpty(address?.city?.name, customer.city_name);
    if (!city) continue;
    if (wantedState) {
      const rowState = firstNonEmpty(address?.state?.name, customer.state_name).toLowerCase();
      if (rowState && rowState !== wantedState) continue;
    }
    seen.push(city);
  }

  return knownCityNames(stateName, seen);
}

/**
 * Zone options for the server-side `zone_id` list filter.
 * Only zones with a real upstream id are offered — a name has no meaning to that endpoint.
 *
 * @param {Array<Record<string, unknown>>} customers
 * @returns {Array<{value: string, label: string}>}
 */
export function buildZoneOptionsFromCustomers(customers) {
  const zones = new Map();

  for (const customer of Array.isArray(customers) ? customers : []) {
    if (!isPlainObject(customer)) continue;
    const id = normalizeId(customer.zone_id) || normalizeId(customer.zone?.id);
    if (!id) continue;
    const label = firstNonEmpty(
      customer.zone_name,
      isPlainObject(customer.zone) ? customer.zone.name : customer.zone
    );
    if (!zones.has(id)) zones.set(id, { value: id, label: label || `Zone ${id}` });
  }

  return [...zones.values()].sort((a, b) => a.label.localeCompare(b.label));
}
