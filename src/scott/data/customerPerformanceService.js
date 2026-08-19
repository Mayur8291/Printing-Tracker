// Customer performance report — `GET customers/performance` + `GET customers/unique_customers`.
//
// ---------------------------------------------------------------------------
// THREE THINGS THAT ARE NOT OBVIOUS FROM THE ENDPOINT NAMES
// ---------------------------------------------------------------------------
// 1. DATES ARE `DD-MM-YYYY`. These two endpoints are the ONLY Scott calls that take dates,
//    and they reject the ISO form the rest of the app uses. `formatDateForScott` is the
//    only place that conversion happens.
//
// 2. THE COMPARISON IS BUILT CLIENT-SIDE FROM TWO SEPARATE CALLS. Each response carries
//    both `current_period` and `previous_period`, but `previous_period` IS NEVER READ:
//    the report asks for period A and period B independently and merges the two
//    `current_period` blocks. Reading `previous_period` instead would silently ignore the
//    user's chosen baseline.
//
// 3. EVERY FIELD IS KEY-PROBED. Scott renames these keys between deploys and nests them
//    inconsistently, so each value is looked up through an alias list at the nested level
//    first and then at the top level. Shortening a list is how this report goes blank.
//
// Growth percentages are deliberately UNDEFINED rather than 0 or Infinity when a side is
// missing or the baseline is 0 — "no data" and "no change" must not look alike.
//
// ---------------------------------------------------------------------------
// DELIBERATE DIVERGENCES FROM THE ORIGINAL (do not "restore" these)
// ---------------------------------------------------------------------------
// * NO DEV MOCK DATA. The original substituted `MOCK_PERIOD_A/B` whenever both periods came
//   back empty in a dev build, and `MOCK_UNIQUE_CUSTOMERS {80,50,50}` whenever the KPI
//   summary had no numeric field or the call threw. Both are omitted here: fake numbers
//   that appear exactly when the integration is broken hide the breakage, which is the
//   failure mode a migration can least afford. Empty is rendered as empty. The two sites
//   are marked inline below.
// * NO API LOG RING BUFFER. `withCustomerPerformanceApiLog` (50-entry buffer, styled
//   console output, `window.__customerPerformanceApiLogs()`) was a dev-only debugging
//   affordance with no user-facing behaviour, so it is not ported.

import {
  buildScottPaginatedMeta,
  callScottDashboard,
  extractRecords,
  normalizeId,
  normalizeScottPageParams
} from "../scottClient";
import { fetchAllScottPages } from "../scottPagination";
import { fetchCustomers } from "./customersService";
import {
  buildZoneLookupFromCustomers,
  resolveCustomerDisplayType,
  resolveZoneDisplayLabel
} from "./customerTypes";

export const CUSTOMERS_RESOURCE = "customers";

/** `period` query values Scott accepts (the growth window used for its own bucketing). */
export const CUSTOMER_PERFORMANCE_PERIODS = Object.freeze([
  "weekly",
  "monthly",
  "quarterly",
  "yearly"
]);

/** Growth-type labels for the report's period selector. */
export const CUSTOMER_PERFORMANCE_PERIOD_OPTIONS = Object.freeze([
  { value: "weekly", label: "WoW Growth" },
  { value: "monthly", label: "MoM Growth" },
  { value: "quarterly", label: "Quarterly Growth" },
  { value: "yearly", label: "Yearly Growth" }
]);

/**
 * `customers/performance` rejects very large page sizes — 100 x 50 pages (5,000 rows) is
 * the documented budget, NOT the transport default of 10,000 x 250.
 */
export const CUSTOMER_PERFORMANCE_FETCH_ALL = Object.freeze({ pageSize: 100, maxPages: 50 });

/** Order-history filter modes for the comparison table. */
export const ORDER_HISTORY_MODES = Object.freeze(["all", "has_orders", "no_orders_yet"]);

// --- alias lists (§10.2) — every one of these has been seen in the wild ---------------

const QTY_KEYS = Object.freeze(["qty", "quantity", "total_qty", "ordered_qty", "units", "order_qty"]);

/** The top level carries three extra qty spellings the nested block never uses. */
const QTY_KEYS_TOP_LEVEL = Object.freeze([...QTY_KEYS, "item_qty", "total_quantity", "units_sold"]);

const VALUE_KEYS = Object.freeze([
  "value",
  "order_value",
  "total_amount",
  "sales_value",
  "amount",
  "revenue",
  "total_sales",
  "grand_total",
  "net_value",
  "sales"
]);

const LAST_PURCHASED_KEYS = Object.freeze([
  "last_purchased_date",
  "last_purchase_date",
  "last_order_date",
  "last_order",
  "most_recent_order_date",
  "latest_order_date",
  "recent_order_date"
]);

const TOTAL_UNIQUE_KEYS = Object.freeze([
  "total_unique_customers",
  "total_unique",
  "total",
  "count",
  "unique_customers",
  "unique_customer_count"
]);

const CUSTOM_ORDER_KEYS = Object.freeze([
  "custom_order_customers",
  "unique_custom_order",
  "custom_order_count",
  "unique_custom_orders",
  "custom_orders",
  "unique_customer_custom_order",
  "custom_order"
]);

const READYMADE_KEYS = Object.freeze([
  "rmp_order_customers",
  "unique_readymade",
  "readymade_count",
  "unique_rmp",
  "rmp_count",
  "readymade",
  "unique_customer_readymade",
  "unique_customer_rmp"
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstStr(...values) {
  for (const value of values) {
    const text = trimmed(value);
    if (text) return text;
  }
  return "";
}

/**
 * Tolerant metric parser: `"₹ 1,23,456.50"` -> `123456.5`.
 * Returns undefined (never 0) when there is no usable number.
 */
export function parsePerformanceNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === null || value === undefined) return undefined;
  const text = String(value).replace(/[₹,\s]/g, "");
  if (!text) return undefined;
  const num = Number(text);
  return Number.isFinite(num) ? num : undefined;
}

/** First key on `source` that parses to a finite number. */
function probeNumber(source, keys) {
  if (!isPlainObject(source)) return undefined;
  for (const key of keys) {
    const parsed = parsePerformanceNumber(source[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/** First key on `source` with a trimmed-nonempty string value. */
function probeString(source, keys) {
  if (!isPlainObject(source)) return "";
  for (const key of keys) {
    const text = trimmed(source[key]);
    if (text) return text;
  }
  return "";
}

/**
 * Scott's date format for these two endpoints: `YYYY-MM-DD` (or a full ISO timestamp)
 * becomes `DD-MM-YYYY`. Anything unrecognised passes through untouched.
 * @param {string} iso
 * @returns {string}
 */
export function formatDateForScott(iso) {
  const text = trimmed(iso);
  if (!text) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

// ---------------------------------------------------------------------------
// Row / summary normalization
// ---------------------------------------------------------------------------

/**
 * One `customers/performance` row -> a flat report row.
 *
 * Metrics come from the nested `current_period` / `currentPeriod` block first and fall
 * back to the same keys at the top level. `previous_period` is intentionally ignored —
 * see the header note.
 *
 * @param {Record<string, unknown>} r
 * @returns {{customer_id:string, customer_code:string, customer_name:string,
 *   customer_type:string|undefined, qty:number|undefined, value:number|undefined,
 *   zone:string|undefined, last_purchased_date:string|null}}
 */
export function normalizeCustomerPerformanceRow(r) {
  const row = isPlainObject(r) ? r : {};
  const nested = isPlainObject(row.customer) ? row.customer : null;

  const customerCode = firstStr(row.customer_code, row.code);

  const customerId =
    firstStr(row.customer_id, row.customerId, row.id) ||
    firstStr(nested?.id, nested?.customer_id) ||
    customerCode ||
    // Last resort: a synthetic key so two id-less rows never collapse into one another.
    String(row.id ?? Math.random());

  const currentPeriod = isPlainObject(row.current_period)
    ? row.current_period
    : isPlainObject(row.currentPeriod)
      ? row.currentPeriod
      : null;

  const qty = probeNumber(currentPeriod, QTY_KEYS) ?? probeNumber(row, QTY_KEYS_TOP_LEVEL);
  const value = probeNumber(currentPeriod, VALUE_KEYS) ?? probeNumber(row, VALUE_KEYS);

  return {
    customer_id: customerId,
    customer_code: customerCode,
    customer_name:
      firstStr(row.customer_name, row.company_name, row.name) ||
      firstStr(nested?.customer_name, nested?.company_name, nested?.name),
    // Price-type name first — the same display rule the customers table uses.
    customer_type:
      resolveCustomerDisplayType([row]) ?? (nested ? resolveCustomerDisplayType([nested]) : undefined),
    qty,
    value,
    zone: resolveZoneDisplayLabel([row]) ?? (nested ? resolveZoneDisplayLabel([nested]) : undefined),
    // null (not '') means "No Orders Yet" to the table and the order-history filter.
    last_purchased_date: probeString(row, LAST_PURCHASED_KEYS) || null
  };
}

/**
 * `customers/unique_customers` -> the three KPI numbers.
 * Unwraps `body.data` and then an optional `data.unique_customers` envelope.
 * @param {unknown} body
 * @returns {{totalUniqueCustomers?:number, uniqueCustomOrder?:number, uniqueReadymade?:number}}
 */
export function normalizeUniqueCustomersSummary(body) {
  let source = isPlainObject(body) ? body : {};
  if (isPlainObject(source.data)) source = source.data;
  if (isPlainObject(source.unique_customers)) source = source.unique_customers;

  return {
    totalUniqueCustomers: probeNumber(source, TOTAL_UNIQUE_KEYS),
    uniqueCustomOrder: probeNumber(source, CUSTOM_ORDER_KEYS),
    uniqueReadymade: probeNumber(source, READYMADE_KEYS)
  };
}

/** A row with no `last_purchased_date` has never ordered. */
export function customerHasOrders(row) {
  return Boolean(trimmed(row?.last_purchased_date));
}

/**
 * @param {object[]} rows
 * @param {'all'|'has_orders'|'no_orders_yet'} mode
 */
export function filterByOrderHistory(rows, mode) {
  const list = Array.isArray(rows) ? rows : [];
  if (mode === "has_orders") return list.filter(customerHasOrders);
  if (mode === "no_orders_yet") return list.filter((row) => !customerHasOrders(row));
  return list;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Query for both endpoints: dates only when supplied, `period` only when in the enum.
 * @param {{startDate?:string, endDate?:string, period?:string}} filters
 */
function buildPerformanceQuery(filters) {
  const f = isPlainObject(filters) ? filters : {};
  const query = {};

  const start = formatDateForScott(f.startDate ?? f.start_date);
  if (start) query.start_date = start;

  const end = formatDateForScott(f.endDate ?? f.end_date);
  if (end) query.end_date = end;

  const period = trimmed(f.period);
  if (CUSTOMER_PERFORMANCE_PERIODS.includes(period)) query.period = period;

  return query;
}

/**
 * One page of `GET customers/performance`.
 * @param {{page?:number, items?:number}} [params]
 * @param {{startDate?:string, endDate?:string, period?:string}} [filters]
 */
export async function fetchCustomerPerformancePage(params = {}, filters = {}) {
  const pageParams = normalizeScottPageParams({
    page: params?.page,
    items: params?.items ?? CUSTOMER_PERFORMANCE_FETCH_ALL.pageSize
  });

  const { body } = await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "GET",
    pathSuffix: "performance",
    query: { items: pageParams.items, page: pageParams.page, ...buildPerformanceQuery(filters) }
  });

  const records = extractRecords(body);
  return {
    data: records.map(normalizeCustomerPerformanceRow),
    ...buildScottPaginatedMeta(body, pageParams, records.length)
  };
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------
//
// `customers/performance` frequently returns rows that carry an id and metrics but no
// name, type or zone. Without this join the report shows bare codes, so enrichment is
// functional, not cosmetic.

/**
 * Module-level PROMISE cache (not a value cache): the two period requests fire in
 * parallel, and caching the in-flight promise is what collapses them into ONE customer
 * drain instead of two. Lives for the session — call
 * `resetCustomerPerformanceEnrichmentCache()` after any customer mutation.
 * @type {Promise<object[]>|null}
 */
let customersEnrichmentCache = null;

/** Drop the cached customer list so the next enrichment re-fetches. */
export function resetCustomerPerformanceEnrichmentCache() {
  customersEnrichmentCache = null;
}

function loadCustomersForEnrichment() {
  if (!customersEnrichmentCache) {
    customersEnrichmentCache = fetchCustomers().catch((error) => {
      // Never cache a rejection — one bad fetch must not disable enrichment for the
      // rest of the session.
      customersEnrichmentCache = null;
      throw error;
    });
  }
  return customersEnrichmentCache;
}

/**
 * Backfill `customer_name`, `customer_type` and `zone` from the customers master.
 *
 * Rows are matched by id AND by customer_code, because `customers/performance` is
 * inconsistent about which one it sends. Only MISSING values are filled — anything the
 * report endpoint supplied itself wins.
 *
 * A failure here only warns: the rows are returned unenriched and the report still
 * renders its metrics.
 *
 * @param {object[]} rows normalized performance rows
 * @returns {Promise<object[]>}
 */
export async function enrichPerformanceRowsWithCustomers(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;

  let customers;
  try {
    customers = await loadCustomersForEnrichment();
  } catch (error) {
    console.warn("Customer performance enrichment skipped:", error);
    return list;
  }

  const byId = new Map();
  const byCode = new Map();
  for (const customer of Array.isArray(customers) ? customers : []) {
    const id = normalizeId(customer?.id);
    if (id && !byId.has(id)) byId.set(id, customer);
    const code = trimmed(customer?.customer_code);
    if (code && !byCode.has(code)) byCode.set(code, customer);
  }
  const zoneById = buildZoneLookupFromCustomers(customers);

  return list.map((row) => {
    const match = byId.get(trimmed(row.customer_id)) ?? byCode.get(trimmed(row.customer_code));
    if (!match) return row;
    return {
      ...row,
      // Price-type-name-first, exactly like the customers table.
      customer_type: row.customer_type ?? resolveCustomerDisplayType([match], match),
      customer_name: row.customer_name || firstStr(match.company_name, match.contact_person),
      zone: row.zone ?? resolveZoneDisplayLabel([match], match, zoneById)
    };
  });
}

/**
 * Every performance row for one period, enriched from the customers master.
 *
 * Errors are SWALLOWED and `[]` is returned — the report is meant to render empty rather
 * than fail the whole page (documented behaviour; the failure is still logged).
 *
 * DIVERGENCE: the original swapped in `MOCK_PERIOD_A/B` at the hook level when BOTH
 * periods came back empty in a dev build. Omitted on purpose — an empty report must look
 * empty. See the header note.
 *
 * @param {{startDate?:string, endDate?:string, period?:string}} [filters]
 * @param {{enrich?: boolean}} [options] `enrich: false` returns the raw report rows
 * @returns {Promise<object[]>}
 */
export async function fetchCustomerPerformance(filters = {}, { enrich = true } = {}) {
  let rows;
  try {
    rows = await fetchAllScottPages(
      (pp) => fetchCustomerPerformancePage({ page: pp.page, items: pp.items }, filters),
      CUSTOMER_PERFORMANCE_FETCH_ALL
    );
  } catch (error) {
    console.error("fetchCustomerPerformance failed:", error);
    return [];
  }
  return enrich ? enrichPerformanceRowsWithCustomers(rows) : rows;
}

/**
 * `GET customers/unique_customers` for the KPI cards.
 *
 * DIVERGENCE: the original returned `MOCK_UNIQUE_CUSTOMERS {80,50,50}` from this very
 * function in dev builds whenever the normalized summary had no numeric field OR the call
 * threw — silently, without even setting its `usedMockData` flag. Omitted on purpose: the
 * errors propagate and an empty summary stays empty. See the header note.
 *
 * @param {string} [startDate] ISO
 * @param {string} [endDate] ISO
 */
export async function fetchUniqueCustomersSummary(startDate, endDate) {
  const { body } = await callScottDashboard({
    resource: CUSTOMERS_RESOURCE,
    method: "GET",
    pathSuffix: "unique_customers",
    query: buildPerformanceQuery({ startDate, endDate })
  });
  return normalizeUniqueCustomersSummary(body);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Percent change from `baseline` to `current`.
 *
 * UNDEFINED — never 0, never Infinity — when either side is missing or the baseline is 0.
 * "Grew from nothing" is not a percentage, and rendering it as 0% or ∞ misleads.
 *
 * @param {number|undefined|null} baseline
 * @param {number|undefined|null} current
 * @returns {number|undefined}
 */
export function pctChange(baseline, current) {
  if (baseline === null || baseline === undefined) return undefined;
  if (current === null || current === undefined) return undefined;
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return undefined;
  if (baseline === 0) return undefined;
  return ((current - baseline) / baseline) * 100;
}

/** B − A, with a missing side treated as "all of the other side". */
function absoluteChange(a, b) {
  const hasA = a !== null && a !== undefined && Number.isFinite(a);
  const hasB = b !== null && b !== undefined && Number.isFinite(b);
  // `|| 0` normalizes the negative-zero cases: `0 - 0` and `-0` both render as "-0" / "₹-0.00"
  // otherwise, since Number(-0).toFixed(2) === "-0.00".
  if (hasA && hasB) return b - a || 0;
  if (hasB) return b;
  if (hasA) return -a || 0;
  return undefined;
}

/** The later of two nullable date strings. */
function laterDate(a, b) {
  const left = trimmed(a);
  const right = trimmed(b);
  if (!left) return right || null;
  if (!right) return left || null;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return leftTime >= rightTime ? left : right;
}

/** Rows are keyed by customer id, then code, then the synthetic id. */
function comparisonKey(row) {
  return firstStr(row?.customer_id, row?.customer_code, row?.id);
}

/**
 * Merge two independently fetched periods into one comparison row per customer.
 *
 * A customer present in only one period still produces a row: its missing side stays
 * undefined, the absolute change becomes the whole of the present side, and the percentage
 * stays undefined.
 *
 * @param {object[]} periodA baseline rows
 * @param {object[]} periodB comparison rows
 * @returns {object[]} CustomerComparisonRow[]
 */
export function mergeComparisonRows(periodA, periodB) {
  const merged = new Map();

  const upsert = (row, side) => {
    const key = comparisonKey(row);
    if (!key) return;
    const existing = merged.get(key) ?? {
      customer_id: row.customer_id ?? key,
      customer_code: row.customer_code ?? "",
      customer_name: row.customer_name ?? "",
      customer_type: row.customer_type,
      zone: row.zone,
      qtyA: undefined,
      valueA: undefined,
      qtyB: undefined,
      valueB: undefined,
      last_purchased_date: null
    };

    // Period B is the more recent view — let it fill in any label period A lacked.
    existing.customer_code = existing.customer_code || (row.customer_code ?? "");
    existing.customer_name = existing.customer_name || (row.customer_name ?? "");
    existing.customer_type = existing.customer_type ?? row.customer_type;
    existing.zone = existing.zone ?? row.zone;
    existing.last_purchased_date = laterDate(existing.last_purchased_date, row.last_purchased_date);

    if (side === "A") {
      existing.qtyA = row.qty;
      existing.valueA = row.value;
    } else {
      existing.qtyB = row.qty;
      existing.valueB = row.value;
    }

    merged.set(key, existing);
  };

  for (const row of Array.isArray(periodA) ? periodA : []) upsert(row, "A");
  for (const row of Array.isArray(periodB) ? periodB : []) upsert(row, "B");

  return [...merged.values()].map((row) => ({
    ...row,
    qtyChange: absoluteChange(row.qtyA, row.qtyB),
    valueChange: absoluteChange(row.valueA, row.valueB),
    qtyChangePct: pctChange(row.qtyA, row.qtyB),
    valueChangePct: pctChange(row.valueA, row.valueB)
  }));
}

/**
 * The whole comparison: TWO independent calls, merged locally.
 *
 * Both run in parallel and both enrich; the shared promise cache means that costs ONE
 * customer drain, not two.
 *
 * @param {{periodA?: {startDate?:string, endDate?:string},
 *          periodB?: {startDate?:string, endDate?:string},
 *          period?: string, enrich?: boolean}} args
 * @returns {Promise<object[]>}
 */
export async function fetchCustomerPerformanceComparison({
  periodA = {},
  periodB = {},
  period = "monthly",
  enrich = true
} = {}) {
  const [rowsA, rowsB] = await Promise.all([
    fetchCustomerPerformance({ ...periodA, period }, { enrich }),
    fetchCustomerPerformance({ ...periodB, period }, { enrich })
  ]);
  return mergeComparisonRows(rowsA, rowsB);
}

// ---------------------------------------------------------------------------
// Default periods
// ---------------------------------------------------------------------------

function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * The quarter before the current one.
 * Jan–Mar rolls back into Q4 of the PREVIOUS year.
 * @param {Date} [now]
 * @returns {{quarter: number, year: number}}
 */
export function previousQuarter(now = new Date()) {
  const quarter = Math.floor(now.getMonth() / 3) + 1; // 1..4
  if (quarter === 1) return { quarter: 4, year: now.getFullYear() - 1 };
  return { quarter: quarter - 1, year: now.getFullYear() };
}

/** `{ mode:'month', year, month }` for the month `offset` months before `now` (wraps 1..12). */
function monthPeriod(year, month) {
  return { mode: "month", year, month };
}

/**
 * Period B (the comparison side) defaults to the CURRENT month.
 * @param {Date} [now]
 */
export function defaultPeriodB(now = new Date()) {
  return monthPeriod(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Period A (the baseline) defaults to the month TWO months before now — but takes its YEAR
 * from `previousQuarter()`, i.e. the current year except in Jan–Mar, when it is year − 1.
 *
 * QUIRK (reproduced, not fixed): in MARCH the two-month rollback lands on January while
 * `previousQuarter()` still says "last year", so the baseline becomes January of the
 * PREVIOUS year — 14 months back instead of 2. Jan/Feb are correct (they genuinely need
 * the previous year) and Apr–Dec are correct. Deriving the year from the rolled-back month
 * would be the one-line fix if this is ever intentionally changed.
 *
 * @param {Date} [now]
 */
export function defaultPeriodA(now = new Date()) {
  const month = (((now.getMonth() - 2) % 12) + 12) % 12 + 1; // 1..12, wrapped
  const { year } = previousQuarter(now);
  return monthPeriod(year, month);
}

/**
 * ISO range covering a whole month.
 * @param {{year:number, month:number}} period `month` is 1-based
 * @returns {{start:string, end:string}} `YYYY-MM-DD`
 */
export function monthPeriodToRange(period) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return { start: "", end: "" };
  // Day 0 of the NEXT month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(lastDay)}` };
}

// ---------------------------------------------------------------------------
// The other three period modes
// ---------------------------------------------------------------------------
//
// The growth select has always offered WoW / MoM / Quarterly / Yearly, but only the MONTHLY
// range builder existed: picking "Yearly Growth" sent `period=yearly` with a ONE-MONTH
// start/end pair, so the screen showed month-sized numbers under a yearly label. These are
// the missing three, ported from `ScottOne/src/utils/customerPerformancePeriod.ts:121-177`
// (`weekRangeFromValue` / `quarterRange` / `yearRange`) so every option the UI offers is
// honoured by the request it produces.

/** `'weekly' | 'monthly' | 'quarterly' | 'yearly'` -> the picker mode it needs. */
export function growthPeriodToPeriodMode(growthPeriod) {
  switch (String(growthPeriod ?? "")) {
    case "weekly":
      return "week";
    case "quarterly":
      return "quarter";
    case "yearly":
      return "year";
    case "monthly":
    default:
      return "month";
  }
}

/** `YYYY-Www` -> the ISO week's Monday..Sunday. Anything unparseable collapses to today. */
export function weekValueToRange(weekValue) {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(String(weekValue ?? "").trim());
  if (!match) {
    const today = todayIsoDate();
    return { start: today, end: today };
  }
  const year = Number(match[1]);
  const week = Number(match[2]);

  // ISO-8601: week 1 is the week containing Jan 4th. Computed in UTC to match
  // `monthPeriodToRange`, which is the only builder the two callers ever shared.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Sunday (0) counts as 7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return { start: isoDate(monday), end: isoDate(sunday) };
}

/** Calendar quarter (1..4) of one year. */
export function quarterPeriodToRange(period) {
  const year = Number(period?.year);
  const quarter = Math.min(4, Math.max(1, Number(period?.quarter) || 1));
  if (!Number.isFinite(year)) return { start: "", end: "" };

  const startMonth = (quarter - 1) * 3 + 1; // 1-based
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    start: `${year}-${pad2(startMonth)}-01`,
    end: `${year}-${pad2(endMonth)}-${pad2(lastDay)}`
  };
}

/** A whole calendar year. */
export function yearPeriodToRange(period) {
  const year = Number(period?.year);
  if (!Number.isFinite(year)) return { start: "", end: "" };
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/**
 * The range for one picker period under the selected growth window.
 *
 * @param {{year?:number, month?:number, quarter?:number, weekValue?:string}} period
 * @param {string} [growthPeriod] `weekly` | `monthly` | `quarterly` | `yearly`
 * @returns {{start:string, end:string}}
 */
export function customerPerformancePeriodToRange(period, growthPeriod = "monthly") {
  switch (growthPeriodToPeriodMode(growthPeriod)) {
    case "week":
      return weekValueToRange(period?.weekValue);
    case "quarter":
      return quarterPeriodToRange(period);
    case "year":
      return yearPeriodToRange(period);
    case "month":
    default:
      return monthPeriodToRange(period);
  }
}

/** `YYYY-MM-DD` for a Date, in UTC. */
function isoDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function todayIsoDate() {
  return isoDate(new Date());
}

/** The ISO week a date falls in, as `YYYY-Www` — the seed for the week picker. */
export function isoWeekValue(now = new Date()) {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

/** Calendar quarter (1..4) containing `now`. */
export function quarterOf(now = new Date()) {
  return Math.floor(now.getMonth() / 3) + 1;
}

/**
 * The report's opening state: baseline period A, comparison period B, and the KPI range
 * (the union of the two).
 * @param {Date} [now]
 */
export function defaultCustomerPerformancePeriods(now = new Date()) {
  const periodA = defaultPeriodA(now);
  const periodB = defaultPeriodB(now);
  const rangeA = monthPeriodToRange(periodA);
  const rangeB = monthPeriodToRange(periodB);

  // Seeds for the non-month modes, so switching the growth window never lands the picker on
  // an empty control: A is one week / one quarter / one year BEFORE B, matching the
  // month-mode relationship the two defaults already have.
  const previous = previousQuarter(now);
  const weekB = isoWeekValue(now);
  const weekA = isoWeekValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));

  return {
    growthPeriod: "monthly",
    periodA: {
      ...periodA,
      ...rangeA,
      weekValue: weekA,
      quarter: previous.quarter
    },
    periodB: {
      ...periodB,
      ...rangeB,
      weekValue: weekB,
      quarter: quarterOf(now)
    },
    // KPI cards cover everything the table compares.
    kpiStart: [rangeA.start, rangeB.start].filter(Boolean).sort()[0] ?? "",
    kpiEnd: [rangeA.end, rangeB.end].filter(Boolean).sort().slice(-1)[0] ?? ""
  };
}
