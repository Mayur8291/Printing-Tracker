// States / cities for the customers dialog — names the user picks, ids we only ever SEND
// when Scott itself told us what they are.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS (read before changing anything here)
// ---------------------------------------------------------------------------
// ScottOne sourced State and City from two SUPABASE tables (`indian_states` /
// `indian_cities`, see `ScottOne/src/services/masters/statesService.ts`). Those tables live
// in ScottOne's Supabase project only — this repo's project has no such migration — and the
// Scott dashboard API exposes NO `/states` or `/cities` route (confirmed against all five
// Postman collections and the endpoint superset). So neither of the two "real source"
// options is available here.
//
// The Scott customer form accepts ONLY ids:
//   addresses[i][city_id], addresses[i][state_id]
// There is no `addresses[i][city]` / `[state]` name field — the collection description spells
// the accepted keys out ("addresses with label, type, address, city_id, state_id,
// postal_code, is_primary"). A NAME in an `*_id` slot is coerced to 0/nil by Rails: the save
// either 422s or silently wipes the address's city and state. That is the bug this module
// exists to make structurally impossible.
//
// THE RULE, therefore:
//   - the FORM carries NAMES (`state_name`, `city_name`) — never an id masquerading as one;
//   - an id is attached to the outgoing address ONLY when it was OBSERVED on real data for
//     that exact name (a nested `city` / `state` object on a `GET customers/{id}` detail
//     response or a legacy-rich list row);
//   - when no id is known the key is OMITTED from the body entirely, which leaves whatever
//     Scott already has on the address untouched instead of destroying it.
//
// Ids ARE observable, just not enumerable: every detail read teaches us one more name→id
// pair. `learnLocationIds` records them and `localStorage` keeps them across sessions, so
// the catalogue fills in as the directory is used. Until a name has been seen with an id,
// its state/city simply does not round-trip on CREATE — lossy, but never corrupt, and the
// user can still create the customer, which is the thing that was impossible before.

import { normalizeId } from "@/scott/scottClient";

/** localStorage key. Bump the suffix if the stored shape ever changes. */
const STORAGE_KEY = "scott.customers.locationIds.v1";

/**
 * Every Indian state and union territory, by name.
 *
 * This is a LABEL list, not a master: it exists so the State field is answerable for the
 * whole country instead of only for the states that happen to be on the loaded page (the
 * old derived-from-rows behaviour made most of India un-enterable). Names are the ones
 * Scott echoes in the flat customer row's `state` field.
 */
export const INDIAN_STATE_NAMES = Object.freeze([
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal"
]);

function trimmed(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Lower-cased lookup key. `''` means "not a usable name". */
function nameKey(value) {
  return trimmed(value).toLowerCase();
}

/** Cities are ambiguous nationally, so they are keyed under their state when one is known. */
function cityKey(cityName, stateName) {
  const city = nameKey(cityName);
  if (!city) return "";
  const state = nameKey(stateName);
  return state ? `${state}::${city}` : `::${city}`;
}

// ---------------------------------------------------------------------------
// The catalogue itself
// ---------------------------------------------------------------------------

/** @type {{states: Map<string, {id: string, name: string}>, cities: Map<string, {id: string, name: string, state: string}>}} */
const catalogue = { states: new Map(), cities: new Map() };
let loaded = false;

function storage() {
  try {
    if (typeof globalThis === "undefined") return null;
    return globalThis.localStorage ?? null;
  } catch {
    // Safari private mode throws on the property access itself.
    return null;
  }
}

function loadFromStorage() {
  if (loaded) return;
  loaded = true;

  const store = storage();
  if (!store) return;
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "null");
    for (const entry of Array.isArray(parsed?.states) ? parsed.states : []) {
      const key = nameKey(entry?.name);
      const id = normalizeId(entry?.id);
      if (key && id) catalogue.states.set(key, { id, name: trimmed(entry.name) });
    }
    for (const entry of Array.isArray(parsed?.cities) ? parsed.cities : []) {
      const key = cityKey(entry?.name, entry?.state);
      const id = normalizeId(entry?.id);
      if (key && id) {
        catalogue.cities.set(key, {
          id,
          name: trimmed(entry.name),
          state: trimmed(entry.state)
        });
      }
    }
  } catch {
    // A corrupt cache must never break the dialog — start empty instead.
  }
}

function saveToStorage() {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        states: [...catalogue.states.values()],
        cities: [...catalogue.cities.values()]
      })
    );
  } catch {
    // Quota / private mode — the in-memory catalogue still works for this session.
  }
}

/** Test seam: drop everything, including the persisted copy. */
export function resetLocationCatalogue() {
  catalogue.states.clear();
  catalogue.cities.clear();
  loaded = true;
  const store = storage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Record one observed `name -> id` pair.
 * @returns {boolean} true when something new was learnt
 */
function rememberState(name, id) {
  const key = nameKey(name);
  const realId = normalizeId(id);
  if (!key || !realId) return false;
  if (catalogue.states.get(key)?.id === realId) return false;
  catalogue.states.set(key, { id: realId, name: trimmed(name) });
  return true;
}

function rememberCity(name, id, stateName) {
  const realId = normalizeId(id);
  if (!realId) return false;

  let changed = false;
  // Stored twice on purpose: scoped to its state (the precise answer) and unscoped (so a
  // city typed before a state was chosen still resolves).
  for (const key of [cityKey(name, stateName), cityKey(name, "")]) {
    if (!key) continue;
    if (catalogue.cities.get(key)?.id === realId) continue;
    catalogue.cities.set(key, { id: realId, name: trimmed(name), state: trimmed(stateName) });
    changed = true;
  }
  return changed;
}

/**
 * Harvest every real state/city id visible on a set of normalized customers.
 *
 * Only nested `addresses[i].state` / `.city` objects (and their `state_id` / `city_id`
 * siblings) carry ids — the production flat row hardcodes both to `''`
 * (`buildAddressesFromFlatFields`), so it teaches nothing and is skipped silently.
 *
 * @param {Array<Record<string, unknown>>|Record<string, unknown>} customers
 * @returns {boolean} true when the catalogue grew
 */
export function learnLocationIds(customers) {
  loadFromStorage();

  const list = Array.isArray(customers) ? customers : [customers];
  let changed = false;

  for (const customer of list) {
    if (!isPlainObject(customer)) continue;
    const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];

    for (const address of addresses) {
      if (!isPlainObject(address)) continue;

      const stateName = trimmed(address.state?.name) || trimmed(customer.state_name);
      const stateId = normalizeId(address.state_id) || normalizeId(address.state?.id);
      if (rememberState(stateName, stateId)) changed = true;

      const cityName = trimmed(address.city?.name) || trimmed(customer.city_name);
      const cityId = normalizeId(address.city_id) || normalizeId(address.city?.id);
      if (rememberCity(cityName, cityId, stateName)) changed = true;
    }
  }

  if (changed) saveToStorage();
  return changed;
}

/**
 * The upstream `state_id` for a state NAME, or `''` when it has never been observed.
 * @param {string} name
 * @returns {string}
 */
export function lookupStateId(name) {
  loadFromStorage();
  return catalogue.states.get(nameKey(name))?.id ?? "";
}

/**
 * The upstream `city_id` for a city NAME. Prefers the entry recorded under `stateName`.
 * @param {string} name
 * @param {string} [stateName]
 * @returns {string}
 */
export function lookupCityId(name, stateName) {
  loadFromStorage();
  const scoped = catalogue.cities.get(cityKey(name, stateName));
  if (scoped?.id) return scoped.id;
  return catalogue.cities.get(cityKey(name, ""))?.id ?? "";
}

/** Every state name we know about: the static list plus anything Scott has shown us. */
export function knownStateNames(extraNames = []) {
  loadFromStorage();

  const byKey = new Map();
  for (const name of [
    ...INDIAN_STATE_NAMES,
    ...[...catalogue.states.values()].map((entry) => entry.name),
    ...(Array.isArray(extraNames) ? extraNames : [])
  ]) {
    const key = nameKey(name);
    if (key && !byKey.has(key)) byKey.set(key, trimmed(name));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * City names already seen, optionally narrowed to one state. Suggestions only — the City
 * field is free text, so an unlisted city is always enterable.
 */
export function knownCityNames(stateName, extraNames = []) {
  loadFromStorage();

  const state = nameKey(stateName);
  const byKey = new Map();
  for (const entry of catalogue.cities.values()) {
    if (state && nameKey(entry.state) && nameKey(entry.state) !== state) continue;
    const key = nameKey(entry.name);
    if (key && !byKey.has(key)) byKey.set(key, entry.name);
  }
  for (const name of Array.isArray(extraNames) ? extraNames : []) {
    const key = nameKey(name);
    if (key && !byKey.has(key)) byKey.set(key, trimmed(name));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve the ids to send for one form's location NAMES.
 *
 * Returns `''` for anything unknown — and `''` is what makes `customerFormToScottBody` OMIT
 * the key rather than write a bogus FK.
 *
 * @param {{state_name?: string, city_name?: string}} form
 * @returns {{state_id: string, city_id: string}}
 */
export function resolveLocationIds(form) {
  const stateName = trimmed(form?.state_name);
  const cityName = trimmed(form?.city_name);
  return {
    state_id: lookupStateId(stateName),
    city_id: lookupCityId(cityName, stateName)
  };
}
