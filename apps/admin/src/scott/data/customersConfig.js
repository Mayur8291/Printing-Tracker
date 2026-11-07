// Customers list/dialog CONFIG — the object `ScottListPage` + `ScottEntityDialog` render.
//
// It follows the same CONFIG SHAPE as the masters registry (`columns` + `fields` + the
// payload builders), but customers do NOT go through `createMastersService`: their CRUD is
// bespoke and lives in `customersService.js`. The builders here delegate to it, so a page
// can wire `useScottList({ config: customersConfig, fetchPage, fetchAll })` exactly like
// any master.
//
// ---------------------------------------------------------------------------
// THREE SHAPE FACTS THAT DRIVE THIS FILE
// ---------------------------------------------------------------------------
// 1. THE TABLE SHOWS FIELDS THE ROW DOES NOT HAVE. Address, city, state, postal code and
//    zone live inside `addresses[0]` / `zone` on a normalized `Customer`. Those four
//    columns therefore carry both a `format` (display fallback) and a `getSortValue`
//    (sort fallback) — a bare `key` would render every one of them empty.
// 2. CLIENT FILTERING NEEDS A FLAT ROW. `toFilterRow` (`customerToFilterRow`) projects
//    those nested values onto flat keys. `useScottList` applies it to the WHOLE drained
//    dataset whenever full mode is on, filter active or not. That is a deliberate
//    divergence: upstream flattened only while a filter was active
//    (`fullDatasetSource = isAnyFilterActive ? filterRows : allCustomers`), so an
//    address/postal SEARCH combined with sort-only silently missed. The quirk is fixed
//    here — the flattened row is a superset, so nothing else changes.
// 3. THE FORM EDITS ONE ADDRESS. The API accepts many; the dialog manages exactly one
//    primary address, which is what `customerFormToCustomerData` emits.
//
// VALIDATION: this codebase has no form library and no per-field error UI. Every validator
// below is a pure function returning ONE message string (or null), matching the
// `ScottEntityDialog` contract: `field.validate(value, form)` -> message, and the dialog
// shows the first one in a single form-level Alert.

import {
  createCustomer,
  customerFormToScottBody,
  deleteCustomer,
  fetchCustomers,
  fetchCustomersPaginated,
  normalizeCustomer,
  updateCustomer
} from "./customersService";
import { CUSTOMER_TYPE_OPTIONS } from "./customerTypes";
import { resolveLocationIds } from "@/scott/customers/customerLocationCatalogue";

// ---------------------------------------------------------------------------
// Validation (pure — no React, no DOM)
// ---------------------------------------------------------------------------

/** Indian GSTIN: 2-digit state code, PAN, entity number, 'Z', checksum. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;

/** Indian PIN code. */
export const POSTAL_CODE_REGEX = /^[0-9]{6}$/;

/** Deliberately loose: an optional +, then 10–15 digits/spaces/dashes/parens. */
export const PHONE_REGEX = /^[\+]?[0-9\s\-\(\)]{10,15}$/;

/** Minimal shape check — the browser's own email validation is the second line of defence. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shown whenever the customer being edited is the owner / direct-deal distributor.
 * Ported from `ScottOne/src/components/masters/CustomerDialogNew.tsx:367-375`.
 */
export const OWNER_DISTRIBUTOR_TYPE_WARNING =
  "This customer is marked as an owner / direct-deal distributor. Changing the type may affect ownership and pricing behaviour for every customer under it.";

export const CUSTOMER_FIELD_LIMITS = Object.freeze({
  customer_code: 50,
  company_name: 255,
  contact_person: 255,
  gst: 15,
  address: 500,
  postal_code: 6,
  state_name: 100,
  city_name: 100
});

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** `required` + `maxLength` in one place, so every message reads the same way. */
function requiredText(value, label, maxLength) {
  const trimmed = text(value);
  if (!trimmed) return `${label} is required.`;
  if (maxLength && trimmed.length > maxLength) {
    return `${label} must be ${maxLength} characters or fewer.`;
  }
  return null;
}

export function validateCustomerCode(value) {
  return requiredText(value, "Customer code", CUSTOMER_FIELD_LIMITS.customer_code);
}

export function validateCompanyName(value) {
  return requiredText(value, "Company name", CUSTOMER_FIELD_LIMITS.company_name);
}

export function validateContactPerson(value) {
  return requiredText(value, "Contact person", CUSTOMER_FIELD_LIMITS.contact_person);
}

export function validateEmail(value) {
  const trimmed = text(value);
  if (!trimmed) return "Email is required.";
  return EMAIL_REGEX.test(trimmed) ? null : "Enter a valid email address.";
}

export function validatePhone(value) {
  const trimmed = text(value);
  if (!trimmed) return "Phone is required.";
  return PHONE_REGEX.test(trimmed)
    ? null
    : "Enter a valid phone number (10–15 digits, spaces, dashes and brackets allowed).";
}

/** GST is OPTIONAL — an empty value passes; a present one must be a full GSTIN. */
export function validateGstin(value) {
  const trimmed = text(value);
  if (!trimmed) return null;
  return GSTIN_REGEX.test(trimmed.toUpperCase())
    ? null
    : "Enter a valid 15-character GSTIN (e.g. 27AABCU9603R1ZX).";
}

export function validatePostalCode(value) {
  const trimmed = text(value);
  if (!trimmed) return "Postal code is required.";
  return POSTAL_CODE_REGEX.test(trimmed) ? null : "Postal code must be 6 digits.";
}

export function validateAddressLine(value) {
  return requiredText(value, "Street address", CUSTOMER_FIELD_LIMITS.address);
}

export function validateStateName(value) {
  return requiredText(value, "State", CUSTOMER_FIELD_LIMITS.state_name);
}

export function validateCityName(value) {
  return requiredText(value, "City", CUSTOMER_FIELD_LIMITS.city_name);
}

export function validateCustomerType(value) {
  return value === "retail" || value === "distributor" ? null : "Customer type is required.";
}

/**
 * Validate a whole form in field order.
 * @param {Record<string, unknown>} form
 * @returns {string|null} the FIRST problem, or null when the form is valid
 */
export function validateCustomerForm(form) {
  const f = form ?? {};
  const checks = [
    validateCustomerCode(f.customer_code),
    validateCompanyName(f.company_name),
    validateContactPerson(f.contact_person),
    validateEmail(f.email),
    validatePhone(f.phone),
    validateGstin(f.gst),
    validateCustomerType(f.customer_type),
    validateStateName(f.state_name),
    validateCityName(f.city_name),
    validatePostalCode(f.postal_code),
    validateAddressLine(f.address)
  ];
  return checks.find(Boolean) ?? null;
}

// ---------------------------------------------------------------------------
// Column helpers (nested reads with the documented fallbacks)
// ---------------------------------------------------------------------------

const primaryAddress = (row) => (Array.isArray(row?.addresses) ? row.addresses[0] : undefined);

const addressLineOf = (row) => primaryAddress(row)?.address ?? "";
const postalCodeOf = (row) => primaryAddress(row)?.postal_code ?? "";
const cityNameOf = (row) => row?.city_name || primaryAddress(row)?.city?.name || "";
const stateNameOf = (row) => row?.state_name || primaryAddress(row)?.state?.name || "";
const zoneNameOf = (row) => row?.zone_name || row?.zone?.name || "";

const STATUS_OPTIONS = Object.freeze([
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
]);

const YES_NO_OPTIONS = Object.freeze([
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" }
]);

/** Price-type names Scott has actually returned — the filter enum, not a closed set. */
export const CUSTOMER_PRICE_TYPE_FILTER_OPTIONS = Object.freeze([
  { value: "Regular", label: "Regular" },
  { value: "End Customer", label: "End Customer" },
  { value: "Distributor", label: "Distributor" },
  { value: "Mumbai", label: "Mumbai" },
  { value: "Pune", label: "Pune" },
  { value: "Delhi", label: "Delhi" },
  { value: "Chennai", label: "Chennai" },
  { value: "Hyderabad", label: "Hyderabad" },
  { value: "Mumbai, Navi Mumbai", label: "Mumbai, Navi Mumbai" }
]);

/** How the customer got into Scott. The wire value is CamelCase; the label is not. */
export const CUSTOMER_REGISTERED_BY_OPTIONS = Object.freeze([
  { value: "Self", label: "Self" },
  { value: "SalesCoordinator", label: "Sales Coordinator" },
  { value: "Dealer", label: "Dealer" }
]);

// ---------------------------------------------------------------------------
// Table columns — 19 data columns (+ the Actions cell the list page appends)
// ---------------------------------------------------------------------------

export const CUSTOMERS_TABLE_COLUMNS = Object.freeze([
  { key: "customer_code", header: "Customer Code", type: "text", sortable: true },
  { key: "company_name", header: "Company Name", type: "text", sortable: true },
  { key: "contact_person", header: "Contact Person", type: "text", sortable: true },
  { key: "email", header: "Email", type: "text", sortable: true },
  { key: "phone", header: "Phone", type: "text", sortable: true },
  { key: "gst", header: "GST", type: "text", sortable: true },
  // The next four read out of `addresses[0]` — see the header note.
  {
    key: "address_line",
    header: "Address",
    type: "text",
    sortable: true,
    format: (raw, row) => raw || addressLineOf(row),
    getSortValue: addressLineOf
  },
  {
    key: "city_name",
    header: "City",
    type: "text",
    sortable: true,
    format: (raw, row) => raw || cityNameOf(row),
    getSortValue: cityNameOf
  },
  {
    key: "state_name",
    header: "State",
    type: "text",
    sortable: true,
    format: (raw, row) => raw || stateNameOf(row),
    getSortValue: stateNameOf
  },
  {
    key: "postal_code",
    header: "Postal Code",
    type: "text",
    sortable: true,
    format: (raw, row) => raw || postalCodeOf(row),
    getSortValue: postalCodeOf
  },
  {
    key: "zone_name",
    header: "Zone",
    type: "text",
    sortable: true,
    format: (raw, row) => raw || zoneNameOf(row),
    getSortValue: zoneNameOf
  },
  { key: "rmp_price_type_name", header: "Price Type", type: "text", sortable: true },
  { key: "registered_by", header: "Registered By", type: "text", sortable: true },
  { key: "dealer_name", header: "Dealer Name", type: "text", sortable: true },
  { key: "sc_name", header: "SC Name", type: "text", sortable: true },
  { key: "last_order_date", header: "Last Order Date", type: "date", sortable: true },
  // Raw Scott Yes/No strings — kept as their own columns even though `status` is derived
  // from them, because "approved but not onboarded" is a real, actionable state.
  { key: "approved", header: "Approved", type: "text", sortable: true },
  { key: "onboarded", header: "Onboarded", type: "text", sortable: true },
  { key: "status", header: "Status", type: "badge", sortable: true, options: STATUS_OPTIONS }
]);

/** 19 data columns + the Actions cell. */
export const CUSTOMERS_TABLE_COLUMN_COUNT = CUSTOMERS_TABLE_COLUMNS.length + 1;

// ---------------------------------------------------------------------------
// Filter columns (explicit — enums would otherwise collapse to free text)
// ---------------------------------------------------------------------------
//
// ENUM VALUES ARE COMPARED CASE-SENSITIVELY. `filterEngine.testEnumCondition` does
// `String(option) === String(cell)` with no normalization, so every `value` below must be
// byte-identical to what `normalizeCustomer` puts on the row:
//   status      -> 'active' | 'inactive'   (derived, lower-case)
//   approved    -> 'Yes' | 'No'            (Scott's raw string, trimmed, verbatim)
//   onboarded   -> 'Yes' | 'No'            (same)
//   registered_by / rmp_price_type_name    (raw Scott strings, e.g. 'SalesCoordinator')
// Note the asymmetry this creates with the status DERIVATION, which lowercases before
// comparing: a row whose `approved` were 'YES' would still be active but would not match
// the 'Yes' filter option. Scott sends title case; labels may be prettified freely, values
// may not.

export const CUSTOMERS_FILTER_COLUMNS = Object.freeze([
  { key: "customer_code", name: "Customer Code", type: "text" },
  { key: "company_name", name: "Company Name", type: "text" },
  { key: "contact_person", name: "Contact Person", type: "text" },
  { key: "email", name: "Email", type: "text" },
  { key: "phone", name: "Phone", type: "text" },
  { key: "gst", name: "GST", type: "text" },
  { key: "address_line", name: "Address", type: "text" },
  { key: "city_name", name: "City", type: "text" },
  { key: "state_name", name: "State", type: "text" },
  { key: "postal_code", name: "Postal Code", type: "text" },
  { key: "zone_name", name: "Zone", type: "text" },
  {
    key: "rmp_price_type_name",
    name: "Price Type",
    type: "enum",
    options: CUSTOMER_PRICE_TYPE_FILTER_OPTIONS
  },
  {
    key: "registered_by",
    name: "Registered By",
    type: "enum",
    options: CUSTOMER_REGISTERED_BY_OPTIONS
  },
  { key: "dealer_name", name: "Dealer Name", type: "text" },
  { key: "sc_name", name: "SC Name", type: "text" },
  { key: "last_order_date", name: "Last Order", type: "date" },
  // The spec's prose list stops at Status, but its test asserts that EVERY table column is
  // filterable — these two are the difference. Enum rather than text: the values are
  // exactly Scott's "Yes"/"No".
  { key: "approved", name: "Approved", type: "enum", options: YES_NO_OPTIONS },
  { key: "onboarded", name: "Onboarded", type: "enum", options: YES_NO_OPTIONS },
  { key: "status", name: "Status", type: "enum", options: STATUS_OPTIONS },
  // Type is INFERRED (`readCustomerType`: explicit column, else the RMP price-type name), so
  // it can only ever be evaluated on the client — Scott has no `customer_type` column to
  // query. Values are byte-identical to what `normalizeCustomer` writes on the row.
  {
    key: "customer_type",
    name: "Customer Type",
    type: "enum",
    options: CUSTOMER_TYPE_OPTIONS
  }
]);

/** Cycling chips for the filter bar. */
export const CUSTOMERS_QUICK_FILTERS = Object.freeze([
  { key: "status", label: "Status", options: STATUS_OPTIONS },
  { key: "customer_type", label: "Type", options: CUSTOMER_TYPE_OPTIONS },
  { key: "approved", label: "Approved", options: YES_NO_OPTIONS },
  { key: "onboarded", label: "Onboarded", options: YES_NO_OPTIONS }
]);

/**
 * Flatten a `Customer` for client-side filtering / search.
 * Every key here must exist in `CUSTOMERS_FILTER_COLUMNS`, and vice versa.
 * @param {object} customer
 */
export function customerToFilterRow(customer) {
  const row = customer ?? {};
  return {
    ...row,
    address_line: addressLineOf(row),
    postal_code: postalCodeOf(row),
    city_name: cityNameOf(row),
    state_name: stateNameOf(row),
    zone_name: zoneNameOf(row)
  };
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

/**
 * Build the create/edit field list.
 *
 * Option lists are injected because they come from other services: RMP price types from
 * the masters registry, and the state list from `customerLocationCatalogue` (a static
 * all-India name list — this repo has no states/cities master). `cityOptions` is a plain
 * array of city NAMES used as a hint on the free-text City field, not a dropdown.
 *
 * @param {object} [options]
 * @param {boolean} [options.isEdit=false] locks `customer_code` (it is the upstream key)
 * @param {boolean} [options.isOwnerDistributor=false] surfaces the owner-distributor warning
 * @param {Array<{value:string,label:string}>} [options.priceTypeOptions]
 * @param {Array<{value:string,label:string}>} [options.stateOptions] state NAMES as values
 * @param {string[]} [options.cityOptions] city-name SUGGESTIONS (the field is free text)
 * @returns {Array<object>} `ScottEntityDialog` field configs
 */
export function buildCustomerFields({
  isEdit = false,
  priceTypeOptions = [],
  stateOptions = [],
  cityOptions = [],
  isOwnerDistributor = false
} = {}) {
  return [
    {
      key: "customer_code",
      label: "Customer Code",
      type: "text",
      required: true,
      placeholder: "e.g. P-1598",
      maxLength: CUSTOMER_FIELD_LIMITS.customer_code,
      // Scott keys the customer on its code; changing it upstream orphans orders.
      disabled: isEdit,
      validate: validateCustomerCode
    },
    {
      key: "company_name",
      label: "Company Name",
      type: "text",
      required: true,
      maxLength: CUSTOMER_FIELD_LIMITS.company_name,
      validate: validateCompanyName
    },
    {
      key: "contact_person",
      label: "Contact Person",
      type: "text",
      required: true,
      maxLength: CUSTOMER_FIELD_LIMITS.contact_person,
      validate: validateContactPerson
    },
    {
      key: "email",
      label: "Email",
      type: "text",
      inputType: "email",
      required: true,
      validate: validateEmail
    },
    {
      key: "phone",
      label: "Phone",
      type: "text",
      required: true,
      placeholder: "9876543210",
      validate: validatePhone
    },
    {
      key: "gst",
      label: "GST",
      type: "text",
      placeholder: "27AABCU9603R1ZX",
      maxLength: CUSTOMER_FIELD_LIMITS.gst,
      uppercase: true,
      hint: "Optional. 15-character GSTIN.",
      validate: validateGstin
    },
    {
      key: "customer_type",
      label: "Customer Type",
      type: "select",
      required: true,
      defaultValue: "retail",
      options: CUSTOMER_TYPE_OPTIONS,
      // The owner / direct-deal distributor warning (`CustomerDialogNew.tsx:83-87,367-375`).
      // Moving THIS customer off `distributor` re-prices every customer sitting under it, so
      // the notice rides on the field that triggers it — and `ScottCustomersDirectoryTab`
      // additionally makes the first submit stop and ask for confirmation.
      hint: isOwnerDistributor
        ? OWNER_DISTRIBUTOR_TYPE_WARNING
        : "Changing this should also re-pick the default price type.",
      validate: validateCustomerType
    },
    {
      key: "price_type_id",
      label: "Price Type",
      type: "select",
      options: priceTypeOptions,
      // Wire name differs from the UI name — see customerTypes.js.
      wire: "rmp_price_type_id",
      hint: "Defaults from the customer type and zone."
    },
    // STATE / CITY CARRY NAMES, NOT IDS — see customerLocationCatalogue.js. The keys are
    // deliberately `*_name`: there is no states/cities master reachable from this repo, so
    // an id is attached only when one has actually been observed for that name, and the
    // FK is otherwise omitted from the payload rather than filled with a human name.
    {
      key: "state_name",
      label: "State",
      type: "select",
      required: true,
      options: stateOptions,
      maxLength: CUSTOMER_FIELD_LIMITS.state_name,
      validate: validateStateName
    },
    {
      // FREE TEXT, never disabled. No city master exists; blocking the field (the old
      // `disabled: cityOptions.length === 0`) made creating a customer outside the loaded
      // page impossible, because City is also required.
      key: "city_name",
      label: "City",
      type: "text",
      required: true,
      maxLength: CUSTOMER_FIELD_LIMITS.city_name,
      placeholder: cityOptions.length > 0 ? `e.g. ${cityOptions[0]}` : "e.g. Nagpur",
      hint:
        cityOptions.length > 0
          ? `Known in this state: ${cityOptions.slice(0, 6).join(", ")}${cityOptions.length > 6 ? "…" : ""}`
          : undefined,
      validate: validateCityName
    },
    {
      key: "postal_code",
      label: "Postal Code",
      type: "text",
      required: true,
      maxLength: CUSTOMER_FIELD_LIMITS.postal_code,
      validate: validatePostalCode
    },
    {
      key: "address",
      label: "Street Address",
      type: "textarea",
      required: true,
      rows: 3,
      colSpan: 2,
      maxLength: CUSTOMER_FIELD_LIMITS.address,
      validate: validateAddressLine
    },
    {
      key: "status",
      label: "Status",
      type: "select",
      defaultValue: "active",
      options: STATUS_OPTIONS
    }
  ];
}

/**
 * `Customer` -> dialog form values.
 *
 * State and City prefill to NAMES, which both customer shapes always carry: the nested
 * address object exposes `state.name` / `city.name`, and the flat production row exposes
 * `state_name` / `city_name`. The upstream ids are NOT put on the form — they are resolved
 * back out of `customerLocationCatalogue` at submit time, so an unknown name degrades to an
 * omitted FK instead of a corrupted one.
 *
 * @param {object} customer
 */
export function customerToFormValues(customer) {
  const c = customer ?? {};
  const address = Array.isArray(c.addresses) ? (c.addresses[0] ?? {}) : {};

  return {
    customer_code: c.customer_code ?? "",
    company_name: c.company_name ?? "",
    contact_person: c.contact_person ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    gst: c.gst ?? "",
    customer_type: c.customer_type === "distributor" ? "distributor" : "retail",
    price_type_id: c.price_type_id ?? "",
    state_name: text(address.state?.name) || text(c.state_name),
    city_name: text(address.city?.name) || text(c.city_name),
    postal_code: address.postal_code ?? "",
    address: address.address ?? "",
    status: c.status === "inactive" ? "inactive" : "active"
  };
}

/**
 * Dialog form values -> the `customerData` shape `createCustomer` / `updateCustomer` take.
 * The single edited address becomes the customer's one primary office address.
 * @param {Record<string, unknown>} form
 * @param {object} [record] the customer being edited — supplies the existing address id
 */
export function customerFormToCustomerData(form, record) {
  const f = form ?? {};
  const existing = Array.isArray(record?.addresses) ? record.addresses[0] : undefined;
  // The normalized record is the usual source; the flat aliases cover a raw Scott row that
  // never went through `normalizeCustomer`. Without an id the PATCH body omits
  // `addresses[0][id]` and Scott treats the edit as a NEW address.
  const addressId =
    text(existing?.id) || text(record?.address_id) || text(record?.customer_address_id);

  // NAMES -> upstream ids, or `''` when the name has never been observed with one. An
  // empty id makes `customerFormToScottBody` OMIT `addresses[i][state_id]`/`[city_id]`
  // entirely, which leaves the value Scott already holds untouched. Writing the NAME into
  // those keys (what this used to do) made Rails coerce it to 0/nil and either 422 the save
  // or silently erase the address's city and state — on every PATCH, because the update is
  // read-merge-write over the whole form.
  const stateName = text(f.state_name);
  const cityName = text(f.city_name);
  const ids = resolveLocationIds({ state_name: stateName, city_name: cityName });

  const address = {
    label: "Primary",
    type: "office",
    address: text(f.address),
    city_id: ids.city_id,
    state_id: ids.state_id,
    postal_code: text(f.postal_code),
    is_primary: true,
    // Carried for the client-side round trip (table columns, filter row, re-open of the
    // dialog). Scott's form has no name field, so these never reach the wire.
    city: cityName ? { id: ids.city_id, name: cityName } : undefined,
    state: stateName ? { id: ids.state_id, name: stateName } : undefined
  };
  if (addressId) address.id = addressId;

  return {
    customer_code: text(f.customer_code),
    company_name: text(f.company_name),
    contact_person: text(f.contact_person),
    email: text(f.email),
    phone: text(f.phone),
    customer_type: f.customer_type === "distributor" ? "distributor" : "retail",
    // Spec §7.4: `'' -> undefined`. `updateCustomer` only overrides `price_type_id` when it
    // is `!== undefined`, so an EMPTY field means "leave the current price type alone", not
    // "clear it" — deliberate, because Scott 422s on an empty `rmp_price_type_id`. Only a
    // caller that passes `''` directly to `updateCustomer` can clear it.
    price_type_id: text(f.price_type_id) || undefined,
    status: f.status === "inactive" ? "inactive" : "active",
    gst: text(f.gst) || undefined,
    addresses: [address]
  };
}

// ---------------------------------------------------------------------------
// The config
// ---------------------------------------------------------------------------

/**
 * Customers entity config, in the shared CONFIG SHAPE.
 * `normalize` / `toCreatePayload` / `toUpdatePayload` delegate to `customersService.js` —
 * customers are NOT served by the generic masters factory.
 */
export const customersConfig = Object.freeze({
  key: "customers",
  resource: "customers",
  label: "Customers",
  singularLabel: "customer",
  labelSingular: "customer",
  group: "Customers",
  idField: "id",

  // list
  listParams: {},
  pageSize: 20,
  // Matches CUSTOMERS_FETCH_ALL — Scott times out on larger customer pages.
  fetchAllOptions: { pageSize: 500, maxPages: 40 },
  // Server-side search only; status/type/zone are filtered client-side by this screen.
  supportsSearch: true,

  columns: CUSTOMERS_TABLE_COLUMNS,
  filterColumns: CUSTOMERS_FILTER_COLUMNS,
  quickFilters: CUSTOMERS_QUICK_FILTERS,
  toFilterRow: customerToFilterRow,

  fields: buildCustomerFields(),
  buildFields: buildCustomerFields,

  normalize: normalizeCustomer,
  // Async, like every other payload builder in this layer.
  toCreatePayload: (form) => customerFormToScottBody(customerFormToCustomerData(form)),
  toUpdatePayload: (form, prev) => customerFormToScottBody(customerFormToCustomerData(form, prev)),

  // Customers are hard-deleted (no `is_deleted` column) and Scott exposes no
  // `customers/bulk_delete`.
  softDelete: false,
  supportsBulkDelete: false,
  relations: [],

  // Bespoke service bindings, so a page never has to import both modules.
  service: {
    fetchPage: fetchCustomersPaginated,
    fetchAll: fetchCustomers,
    create: createCustomer,
    update: updateCustomer,
    remove: deleteCustomer
  }
});

export default customersConfig;
