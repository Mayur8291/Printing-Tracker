// Scott CUSTOMERS data layer — bespoke, not driven by the masters config factory.
//
// Why bespoke: customers are the only Scott entity whose list rows and detail rows have
// DIFFERENT SHAPES, and whose writes carry a nested collection (addresses) through a
// multipart proxy that silently drops nested objects.
//
// ---------------------------------------------------------------------------
// THE TWO SHAPES `normalizeCustomer` must accept
// ---------------------------------------------------------------------------
//   A. PRODUCTION FLAT (what `GET customers` really returns today)
//      { id: 1598, customer_id: "P-1598", customer_company_name, customer_first_name,
//        customer_last_name, name, email, phone, approved: "Yes", onboarded: "Yes",
//        address, city, state, zip_code, zone: "West", rmp_price_type_name, … }
//      - `customer_id` is the display CODE, not the primary key.
//      - there is no `addresses[]`; one synthetic primary address is built from the flat
//        `address`/`city`/`state`/`zip_code` fields, with EMPTY city/state ids.
//      - there is usually no `customer_type`; it is inferred from `rmp_price_type_name`.
//      - `status` does not exist; it is derived from `approved`/`onboarded` Yes/No.
//   B. LEGACY RICH (Supabase-era payloads and some detail responses)
//      { customer_code, company_name, contact_person, customer_type, status,
//        profile_image, orders_count, lifetime_value, addresses: [{ …, city: {id,name} }] }
//
// ---------------------------------------------------------------------------
// WRITE RULES (all four are load-bearing)
// ---------------------------------------------------------------------------
//   1. Bodies go up as multipart form-data. The edge function's `bodyToFormData` SKIPS
//      plain-object values, so addresses are flattened client-side into Rails bracket
//      keys — `addresses[0][city_id]` — and booleans are the strings 'true'/'false'.
//   2. Key rename: UI `price_type_id` -> wire `rmp_price_type_id`.
//   3. PATCH expects the FULL form, so `updateCustomer` is READ-MERGE-WRITE. Never send a
//      partial body: omitted fields are cleared upstream.
//   4. Create/update responses are sparse — always re-read by id before returning.
//   5. `addresses[i][city_id]` / `[state_id]` are OMITTED whenever the id is unknown. This
//      repo has no states/cities master (see `src/scott/customers/customerLocationCatalogue.js`),
//      and a human name in an `*_id` slot is coerced to 0/nil by Rails — the save either
//      422s or silently wipes the address's city and state. Omitting keeps what Scott has.
//
// Payload builders are `async` for a uniform contract with the rest of the data layer
// (file helpers are async); nothing in this file actually awaits inside them.

import {
  buildScottPaginatedMeta,
  callScottDashboard,
  extractRecords,
  extractScottEntity,
  normalizeId,
  normalizeScottPageParams
} from "../scottClient";
import { fetchAllScottPages } from "../scottPagination";
import { proxifyScottImageUrl } from "../scottImage";

/** Every call in this file proxies through the `customers` resource. */
export const CUSTOMERS_RESOURCE = "customers";

/** UI page size for the customers list. */
export const CUSTOMERS_PAGE_SIZE = 20;

/**
 * Fetch-all budget: 500 rows x 40 pages = 20,000 customers.
 * Deliberately NOT the transport default (10,000 x 250) — Scott starts timing out on
 * customer pages much above 500.
 */
export const CUSTOMERS_FETCH_ALL = Object.freeze({ pageSize: 500, maxPages: 40 });

/** Address `type` values Scott accepts; anything else normalizes to 'office'. */
export const CUSTOMER_ADDRESS_TYPES = Object.freeze(["office", "delivery", "billing", "other"]);

/** Fields compared when deciding whether an existing address needs an update call. */
const ADDRESS_DIFF_FIELDS = Object.freeze([
  "label",
  "type",
  "address",
  "city_id",
  "state_id",
  "postal_code",
  "is_primary"
]);

/** Avatar-ish keys, in the order the original probes them. */
const AVATAR_KEYS = Object.freeze([
  "profile_image",
  "profile_image_url",
  "avatar_url",
  "image_url",
  "image"
]);

export const OWNER_DISTRIBUTOR_DELETE_MESSAGE =
  "Cannot delete the owner distributor. Please set another distributor as owner first.";

// ---------------------------------------------------------------------------
// Small read helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The upstream `str()` helper: `String(v).trim()`, with null/undefined collapsed to ''.
 *
 * CAUTION: it stringifies OBJECTS to "[object Object]". Two call sites below depend on
 * (and one is broken by) that — see the `city_name` / `state_name` note.
 */
function str(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** First trimmed-nonempty value. */
function firstStr(...values) {
  for (const value of values) {
    const text = str(value);
    if (text) return text;
  }
  return "";
}

/** Pass a value through as a string only when the key was actually present. */
function direct(value) {
  return value === null || value === undefined ? undefined : String(value);
}

/** Scott booleans arrive as `true`, `'true'` or `1`. */
function readBoolean(value) {
  return value === true || value === "true" || value === 1;
}

/** Number when finite, otherwise undefined (never default a metric to 0). */
function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** Timestamps are passed through only when they really are strings. */
function readTimestamp(value) {
  return typeof value === "string" ? value : "";
}

/**
 * `['1', '2']` from `[1, '2', { id: 3 }]`.
 * @param {unknown} value
 * @returns {string[]|undefined} undefined when the field is absent
 */
export function parseStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (isPlainObject(item)) return normalizeId(item.id);
      return "";
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Normalize one NESTED address object (legacy rich shape).
 *
 * `city_id`/`state_id` fall back to the ids inside the embedded `city`/`state` objects,
 * which is what makes an edited address round-trip without losing its location.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>} CustomerAddress
 */
export function normalizeAddress(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const city = isPlainObject(r.city) ? r.city : null;
  const state = isPlainObject(r.state) ? r.state : null;

  const type = String(r.type ?? "");
  const address = {
    id: r.id !== null && r.id !== undefined ? normalizeId(r.id) : undefined,
    customer_id:
      r.customer_id !== null && r.customer_id !== undefined ? normalizeId(r.customer_id) : undefined,
    label: String(r.label ?? ""),
    // Only these three pass through; everything else (including junk) becomes 'office'.
    type: type === "delivery" || type === "billing" || type === "other" ? type : "office",
    address: String(r.address ?? ""),
    city_id: normalizeId(r.city_id ?? city?.id ?? ""),
    state_id: normalizeId(r.state_id ?? state?.id ?? ""),
    postal_code: String(r.postal_code ?? ""),
    is_primary: readBoolean(r.is_primary),
    created_at: readTimestamp(r.created_at) || undefined,
    updated_at: readTimestamp(r.updated_at) || undefined,
    created_by: direct(r.created_by),
    updated_by: direct(r.updated_by)
  };

  if (city) address.city = { id: normalizeId(city.id), name: String(city.name ?? "") };
  if (state) address.state = { id: normalizeId(state.id), name: String(state.name ?? "") };

  return address;
}

/** Flat aliases for the upstream id of the synthetic primary address. */
const FLAT_ADDRESS_ID_KEYS = Object.freeze([
  "address_id",
  "customer_address_id",
  "primary_address_id"
]);

/**
 * The upstream address id a FLAT customer row carries, if any.
 *
 * The documented flat fixture has none, but `update_address`/`destroy_address` are keyed on
 * it, so whenever Scott does send one it has to survive normalization — otherwise every
 * address edit on a flat-shape customer degrades to "create a second address through the
 * PATCH body" and the two sub-endpoints can never fire (customers.md §4.5 step 4).
 *
 * @param {Record<string, unknown>} raw
 * @returns {string} normalized id, or `''`
 */
export function readFlatAddressId(raw) {
  const r = isPlainObject(raw) ? raw : {};
  for (const key of FLAT_ADDRESS_ID_KEYS) {
    const id = normalizeId(r[key]);
    if (id) return id;
  }
  // `address` is normally the street string, but an object form carries the id.
  if (isPlainObject(r.address)) {
    const id = normalizeId(r.address.id);
    if (id) return id;
  }
  return "";
}

/**
 * Synthesize the single primary address the PRODUCTION FLAT shape implies.
 *
 * `zip_code` is Scott's flat name for the postal code. City/state NAMES are preserved but
 * their IDS ARE EMPTY — the edit dialog re-resolves them by case-insensitive name match
 * against the states/cities masters before it can save.
 *
 * The address `id` is attached ONLY when the flat row actually carries one, so a payload
 * shaped exactly like the documented fixture normalizes byte-identically to before.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Array<Record<string, unknown>>} 0 or 1 addresses
 */
export function buildAddressesFromFlatFields(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const address = str(r.address);
  if (!address) return [];

  // Same "[object Object]" caveat as `city_name` below — harmless here because the flat
  // shape never sends objects in these slots.
  const cityName = str(r.city);
  const stateName = str(r.state);

  const synthetic = {
    label: "Primary",
    type: "office",
    address,
    city_id: "",
    state_id: "",
    postal_code: String(r.zip_code ?? r.postal_code ?? ""),
    is_primary: true,
    city: cityName ? { id: "", name: cityName } : undefined,
    state: stateName ? { id: "", name: stateName } : undefined
  };

  const addressId = readFlatAddressId(r);
  if (addressId) synthetic.id = addressId;

  return [synthetic];
}

// ---------------------------------------------------------------------------
// normalizeCustomer
// ---------------------------------------------------------------------------

/** `customer_id` is only a CODE when it carries a letter or dash ("P-1598"). */
function codeFromCustomerId(value) {
  const text = str(value);
  return text && /[A-Za-z-]/.test(text) ? text : "";
}

/**
 * Derived status. Scott has no status column on customers: an unapproved or un-onboarded
 * customer counts as inactive, and the raw Yes/No strings are ALSO kept as their own
 * fields for the table columns.
 */
function readCustomerStatus(r) {
  const status = str(r.status).toLowerCase();
  if (status === "inactive" || status === "deleted") return "inactive";
  if (str(r.approved).toLowerCase() === "no") return "inactive";
  if (str(r.onboarded).toLowerCase() === "no") return "inactive";
  return "active";
}

/**
 * Production rarely sends `customer_type`; the RMP price-type NAME is the real signal.
 * @returns {'retail'|'distributor'}
 */
function readCustomerType(r) {
  if (r.customer_type === "distributor") return "distributor";
  if (r.customer_type === "retail") return "retail";
  if (str(r.rmp_price_type_name).toLowerCase().includes("distributor")) return "distributor";
  return "retail";
}

function readZone(r) {
  if (isPlainObject(r.zone)) {
    return { id: normalizeId(r.zone.id), name: String(r.zone.name ?? "") };
  }
  const zoneString = str(r.zone);
  if (zoneString) return { id: "", name: zoneString };

  const zoneId = normalizeId(r.zone_id);
  if (zoneId) return { id: zoneId, name: "" };

  return undefined;
}

function readAvatarUrl(r) {
  const raw = firstStr(...AVATAR_KEYS.map((key) => r[key]));
  if (!raw) return undefined;
  // Resolves relative paths against the effective Scott base and rewrites http images
  // through the same-origin proxy on https deploys.
  return proxifyScottImageUrl(raw);
}

/**
 * Scott API row -> `Customer`. Accepts BOTH documented shapes; every alias below is one
 * the API has actually been observed to use.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>} Customer
 */
export function normalizeCustomer(raw) {
  const r = isPlainObject(raw) ? raw : {};

  const addresses = Array.isArray(r.addresses ?? r.customer_addresses)
    ? (r.addresses ?? r.customer_addresses).map(normalizeAddress)
    : buildAddressesFromFlatFields(r);

  const zone = readZone(r);

  // LATENT QUIRK (reproduced deliberately): `str()` stringifies objects, so when `raw.city`
  // is an object this FIRST branch wins with "[object Object]" and the nested `.name`
  // branch below can never run. Left as-is for byte-identical behaviour with the original;
  // swapping the first and last candidates is the one-line fix if that is ever wanted.
  const cityName =
    str(r.city) || str(addresses[0]?.city?.name) || (isPlainObject(r.city) ? str(r.city.name) : "");
  const stateName =
    str(r.state) ||
    str(addresses[0]?.state?.name) ||
    (isPlainObject(r.state) ? str(r.state.name) : "");

  return {
    // `id` is the numeric PK; rows without one are dropped from lists.
    id: normalizeId(r.id),
    customer_code: str(r.customer_code) || codeFromCustomerId(r.customer_id),
    company_name: firstStr(r.customer_company_name, r.company_name, r.name),
    contact_person: firstStr(
      r.contact_person,
      r.contact_name,
      r.contact,
      `${str(r.customer_first_name)} ${str(r.customer_last_name)}`.trim(),
      r.dealer_name,
      r.sc_name
    ),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    customer_type: readCustomerType(r),
    is_owner_distributor: readBoolean(r.is_owner_distributor) || readBoolean(r.is_direct_deal),
    zone_id: normalizeId(r.zone_id) || (isPlainObject(r.zone) ? normalizeId(r.zone.id) : "") || undefined,
    // KEY RENAME: Scott's `rmp_price_type_id` is the UI's `price_type_id`.
    price_type_id: normalizeId(r.rmp_price_type_id ?? r.price_type_id) || undefined,
    distributor_ids: parseStringArray(r.distributor_ids ?? r.distributors),
    status: readCustomerStatus(r),
    credit_limit: r.credit_limit !== null && r.credit_limit !== undefined ? Number(r.credit_limit) : undefined,
    payment_terms: direct(r.payment_terms),
    gst: direct(r.gst),
    notes: direct(r.notes),
    avatar_url: readAvatarUrl(r),
    created_at: readTimestamp(r.created_at),
    updated_at: readTimestamp(r.updated_at),
    created_by: direct(r.created_by),
    updated_by: direct(r.updated_by),
    addresses,
    zone,
    brand_ids: parseStringArray(r.brand_ids ?? r.brands),
    // Only the legacy rich payload carries these — never default them to 0.
    last_order_date: str(r.last_order_date) || undefined,
    orders_count: finiteNumber(r.orders_count ?? r.order_count ?? r.total_orders),
    lifetime_value: finiteNumber(r.lifetime_value ?? r.total_lifetime_value ?? r.ltv),
    // Production flat fields, kept verbatim for table columns / client filters.
    rmp_price_type_name: direct(r.rmp_price_type_name),
    registered_by: direct(r.registered_by),
    dealer_name: direct(r.dealer_name),
    dealer_email: direct(r.dealer_email),
    sc_name: direct(r.sc_name),
    sc_email: direct(r.sc_email),
    city_name: cityName || undefined,
    state_name: stateName || undefined,
    // Unlike city/state above, this one is guarded by a typeof check, so an embedded zone
    // object correctly falls through to `zone.name`.
    zone_name: (typeof r.zone === "string" ? str(r.zone) : "") || str(zone?.name) || undefined,
    approved: str(r.approved) || undefined,
    onboarded: str(r.onboarded) || undefined
  };
}

// ---------------------------------------------------------------------------
// Write payload builders
// ---------------------------------------------------------------------------

/**
 * Body for the standalone address endpoints (`update_address`).
 * Booleans must be the STRINGS 'true'/'false' — FormData carries strings only.
 * @param {Record<string, unknown>} address
 */
export function addressToScottBody(address) {
  const a = isPlainObject(address) ? address : {};
  const body = {
    label: a.label || "Primary",
    type: a.type || "office",
    address: String(a.address ?? ""),
    postal_code: String(a.postal_code ?? ""),
    is_primary: a.is_primary ? "true" : "false"
  };
  // NEVER send an empty (or non-id) `*_id`: Rails coerces it to 0/nil and the address loses
  // its city/state. Omitting the key leaves the value upstream already holds. See
  // `src/scott/customers/customerLocationCatalogue.js` for why an id can be unknown at all.
  const cityId = normalizeId(a.city_id);
  if (cityId) body.city_id = cityId;
  const stateId = normalizeId(a.state_id);
  if (stateId) body.state_id = stateId;

  if (a.id !== null && a.id !== undefined && String(a.id) !== "") body.id = normalizeId(a.id);
  return body;
}

/**
 * Customer form -> multipart body, shared by create and update.
 *
 * Addresses become Rails bracket keys (`addresses[0][city_id]`) because the edge
 * function drops nested objects; `is_primary` is a string; `addresses[i][id]` is emitted
 * only for addresses that already exist upstream.
 *
 * `async` for contract uniformity with the rest of the data layer — nothing awaits here.
 *
 * @param {Record<string, unknown>} data
 * @returns {Promise<Record<string, unknown>>}
 */
export async function customerFormToScottBody(data) {
  const form = isPlainObject(data) ? data : {};

  const body = {
    customer_code: String(form.customer_code ?? ""),
    company_name: String(form.company_name ?? ""),
    contact_person: String(form.contact_person ?? ""),
    email: String(form.email ?? ""),
    phone: String(form.phone ?? ""),
    customer_type: form.customer_type === "distributor" ? "distributor" : "retail",
    status: form.status === "inactive" ? "inactive" : "active",
    gst: String(form.gst ?? "")
  };

  // KEY RENAME, and only when set — sending an empty `rmp_price_type_id` 422s upstream.
  if (form.price_type_id) body.rmp_price_type_id = normalizeId(form.price_type_id);

  const addresses = Array.isArray(form.addresses) ? form.addresses : [];
  addresses.forEach((raw, index) => {
    const address = isPlainObject(raw) ? raw : {};
    body[`addresses[${index}][label]`] = address.label || "Primary";
    body[`addresses[${index}][type]`] = address.type || "office";
    body[`addresses[${index}][address]`] = String(address.address ?? "");
    // Same rule as `addressToScottBody`: an id we do not genuinely know is OMITTED, never
    // guessed and never replaced by the human-readable name.
    const cityId = normalizeId(address.city_id);
    if (cityId) body[`addresses[${index}][city_id]`] = cityId;
    const stateId = normalizeId(address.state_id);
    if (stateId) body[`addresses[${index}][state_id]`] = stateId;
    body[`addresses[${index}][postal_code]`] = String(address.postal_code ?? "");
    body[`addresses[${index}][is_primary]`] = address.is_primary ? "true" : "false";
    // Present only when editing an address Scott already knows about.
    if (address.id !== null && address.id !== undefined && String(address.id) !== "") {
      body[`addresses[${index}][id]`] = normalizeId(address.id);
    }
  });

  return body;
}

// ---------------------------------------------------------------------------
// READ operations
// ---------------------------------------------------------------------------

/**
 * Server-side list query. Only `search` and `zone_id` are real upstream columns; everything
 * else the customers screen offers is evaluated client-side over the fetched-all dataset.
 */
function buildCustomerListQuery(pageParams, filters) {
  const f = isPlainObject(filters) ? filters : {};
  const query = { items: pageParams.items, page: pageParams.page };

  const search = str(f.search);
  if (search) query.search = search;

  // NO `status` / `customer_type` PARAMS. Scott has neither column: `status` is DERIVED in
  // `readCustomerStatus` from `approved`/`onboarded`, and `customer_type` is INFERRED in
  // `readCustomerType` from the RMP price-type name whenever the (usually absent) explicit
  // field is missing. Sending them upstream returned an unfiltered list while the chip
  // claimed a filter was on. Both now run client-side over the normalized values, exactly
  // as the original did (`ScottOne/src/pages/Customers.tsx` sent only `search`).
  const zoneId = normalizeId(f.zone_id);
  if (zoneId) query.zone_id = zoneId;

  return query;
}

/**
 * One page of customers.
 *
 * Filters may be passed inline with the page params (`{ page, items, search, zone_id }`) or
 * as the second argument — both are merged. `status` / `customer_type` are accepted and
 * IGNORED: they are client-side concepts (see `buildCustomerListQuery`).
 *
 * @param {{page?:number, items?:number, pageSize?:number, search?:string, zone_id?:string}} [params]
 * @param {{search?:string, zone_id?:string}} [filters]
 * @returns {Promise<{data: object[], page:number, pageSize:number, totalCount:number, totalPages:number, totalCountIsExact:boolean}>}
 */
export async function fetchCustomersPaginated(params = {}, filters = {}) {
  const { page, pageSize, items, ...inlineFilters } = isPlainObject(params) ? params : {};
  const pageParams = normalizeScottPageParams({
    page,
    items: items ?? pageSize ?? CUSTOMERS_PAGE_SIZE
  });

  const { body } = await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "GET",
    query: buildCustomerListQuery(pageParams, { ...inlineFilters, ...(filters ?? {}) })
  });

  const records = extractRecords(body);
  const rows = records.map(normalizeCustomer).filter((row) => row.id !== "");

  // Meta is built from the RAW record count so dropped id-less rows can never make a full
  // page look like the last one.
  return { data: rows, ...buildScottPaginatedMeta(body, pageParams, records.length) };
}

/**
 * Every customer, newest first.
 *
 * Sorted with the original's raw comparator: an unparseable `created_at` yields NaN, which
 * V8 treats as "equal" and leaves those rows in fetch order. Reproduced as-is.
 *
 * @param {object} [filters]
 * @returns {Promise<object[]>}
 */
export async function fetchCustomers(filters = {}) {
  const rows = await fetchAllScottPages(
    (pp) => fetchCustomersPaginated({ page: pp.page, items: pp.items }, filters),
    CUSTOMERS_FETCH_ALL
  );
  return [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * `GET customers/{id}` — the FULL record (list rows lack the nested address ids that the
 * update/destroy address endpoints need, so edit flows must call this first).
 * @param {string} id
 * @returns {Promise<object>}
 * @throws when the response carries no record
 */
export async function getCustomerById(id) {
  const { body } = await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "GET",
    pathSuffix: normalizeId(id)
  });

  const entity = extractScottEntity(body) ?? extractRecords(body)[0];
  if (!entity) throw new Error("Customer not found");
  return normalizeCustomer(entity);
}

/** Spec-name alias for `getCustomerById`. */
export const fetchCustomerById = getCustomerById;

/**
 * `GET customers/by_code?customer_code=…`. Unlike `getCustomerById` this resolves to
 * null instead of throwing — callers use it to test existence.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function getCustomerByCode(code) {
  const { body } = await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "GET",
    pathSuffix: "by_code",
    query: { customer_code: String(code ?? "") }
  });

  const entity = extractScottEntity(body) ?? extractRecords(body)[0];
  return entity ? normalizeCustomer(entity) : null;
}

// ---------------------------------------------------------------------------
// WRITE operations
// ---------------------------------------------------------------------------

/**
 * `POST customers`. The create response is sparse, so the freshly created id is re-read
 * before returning.
 * @param {object} customerData
 * @returns {Promise<object>}
 */
export async function createCustomer(customerData) {
  const { body } = await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "POST",
    body: await customerFormToScottBody(customerData)
  });

  const created = extractScottEntity(body);
  if (!created) throw new Error("Unexpected create customer response");

  const createdId = normalizeId(created.id);
  if (createdId) return getCustomerById(createdId);

  // No id to re-read with — hand back whatever the response did carry.
  return normalizeCustomer(created);
}

/**
 * READ-MERGE-WRITE update.
 *
 * Scott's PATCH replaces the whole form, so the current record is re-read and every field
 * the caller did not supply is carried over. `price_type_id` is merged with an explicit
 * `undefined` check rather than `??` so that passing `''` can genuinely CLEAR it.
 *
 * @param {{id: string, updates: object, previousAddresses?: object[]}} args
 * @returns {Promise<object>} the re-read customer
 */
export async function updateCustomer({ id, updates = {}, previousAddresses } = {}) {
  const rid = normalizeId(id);
  const current = await getCustomerById(rid);

  const merged = {
    customer_code: updates.customer_code ?? current.customer_code,
    company_name: updates.company_name ?? current.company_name,
    contact_person: updates.contact_person ?? current.contact_person,
    email: updates.email ?? current.email,
    phone: updates.phone ?? current.phone,
    customer_type: updates.customer_type ?? current.customer_type,
    status: updates.status ?? current.status,
    gst: updates.gst ?? current.gst,
    addresses: updates.addresses ?? current.addresses,
    // `''` must survive as "clear this", which `??` would swallow.
    price_type_id:
      updates.price_type_id !== undefined ? updates.price_type_id : current.price_type_id
  };

  await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "PATCH",
    pathSuffix: rid,
    body: await customerFormToScottBody(merged)
  });

  // Removals and edits of EXISTING addresses need their own endpoints; brand-new
  // addresses already rode along in the PATCH body above.
  if (updates.addresses) {
    await syncCustomerAddresses(rid, previousAddresses ?? current.addresses, updates.addresses);
  }

  return getCustomerById(rid);
}

/**
 * Pair each next address with the previous address it replaces.
 *
 * Matching by id is the nested (legacy) shape's path. The PRODUCTION FLAT shape reaches
 * here with a one-element collection on both sides where the FORM's copy has no id —
 * `customerFormToCustomerData` can only copy an id the record actually carried — so a
 * by-id-only match found nothing and the whole sync became a no-op, which is why
 * `update_address`/`destroy_address` never fired in production. Falling back to POSITION
 * pairs those two and recovers the id from the previous side.
 *
 * @param {object[]} previous
 * @param {object[]} next
 * @returns {{pairs: Array<{before: object, after: object, id: string}>, keptIds: Set<string>}}
 */
function pairAddresses(previous, next) {
  const previousById = new Map();
  previous.forEach((address) => {
    const id = normalizeId(address?.id);
    if (id) previousById.set(id, address);
  });

  const pairs = [];
  const keptIds = new Set();
  const usedIndexes = new Set();

  next.forEach((address, index) => {
    const id = normalizeId(address?.id);
    if (id && previousById.has(id)) {
      const before = previousById.get(id);
      usedIndexes.add(previous.indexOf(before));
      keptIds.add(id);
      pairs.push({ before, after: address, id });
      return;
    }
    if (id) {
      // Known to Scott but not to us — still an existing address, never a destroy target.
      keptIds.add(id);
      pairs.push({ before: null, after: address, id });
      return;
    }

    // Idless (flat shape): the previous address in the same slot is the one being edited,
    // provided nothing else has already claimed it.
    const before = previous[index];
    const beforeId = normalizeId(before?.id);
    if (!before || usedIndexes.has(index) || !beforeId) return;
    usedIndexes.add(index);
    keptIds.add(beforeId);
    pairs.push({ before, after: address, id: beforeId });
  });

  return { pairs, keptIds };
}

/**
 * Reconcile the address collection after a PATCH. Covers BOTH customer shapes.
 *   - previously-known address no longer claimed by `next` -> destroy_address
 *   - paired address with any changed field -> update_address (with the upstream id)
 *   - address with no id on either side -> nothing (the PATCH body carried it)
 *
 * @param {string} customerId
 * @param {object[]} previousAddresses
 * @param {object[]} nextAddresses
 * @param {{update?: Function, destroy?: Function}} [deps] seam for tests only
 */
export async function syncCustomerAddresses(
  customerId,
  previousAddresses,
  nextAddresses,
  deps = {}
) {
  const rid = normalizeId(customerId);
  const previous = Array.isArray(previousAddresses) ? previousAddresses : [];
  const next = Array.isArray(nextAddresses) ? nextAddresses : [];
  const update = deps.update ?? updateCustomerAddress;
  const destroy = deps.destroy ?? destroyCustomerAddress;

  const { pairs, keptIds } = pairAddresses(previous, next);

  for (const address of previous) {
    const addressId = normalizeId(address?.id);
    if (addressId && !keptIds.has(addressId)) {
      await destroy(rid, addressId);
    }
  }

  for (const { before, after, id } of pairs) {
    if (!before) continue;
    const changed = ADDRESS_DIFF_FIELDS.some((field) => before[field] !== after[field]);
    // The id may come from the PREVIOUS side (flat shape), so it is re-attached here rather
    // than trusted on `after` — `update_address` is addressed by it.
    if (changed) await update(rid, { ...after, id });
  }
}

/**
 * `POST customers/{customerId}/update_address`.
 * @param {string} customerId
 * @param {object} address must carry the upstream address `id`
 */
export async function updateCustomerAddress(customerId, address) {
  await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "POST",
    pathSuffix: `${normalizeId(customerId)}/update_address`,
    body: addressToScottBody(address)
  });
}

/**
 * `POST customers/{customerId}/destroy_address` with a `{ id }` body.
 * @param {string} customerId
 * @param {string} addressId
 */
export async function destroyCustomerAddress(customerId, addressId) {
  await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "POST",
    pathSuffix: `${normalizeId(customerId)}/destroy_address`,
    body: { id: normalizeId(addressId) }
  });
}

/**
 * `DELETE customers/{id}`.
 *
 * The owner-distributor guard is CLIENT-SIDE (Scott does not enforce it), which is why the
 * record is fetched first — deleting the owner distributor silently breaks pricing for
 * every customer under it.
 *
 * @param {string} id
 */
export async function deleteCustomer(id) {
  const rid = normalizeId(id);
  const customer = await getCustomerById(rid);

  if (customer?.is_owner_distributor && customer?.customer_type === "distributor") {
    throw new Error(OWNER_DISTRIBUTOR_DELETE_MESSAGE);
  }

  await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "DELETE",
    pathSuffix: rid
  });
}
