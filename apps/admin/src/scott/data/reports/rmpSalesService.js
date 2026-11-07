// RMP Sales Report (Readymade Product Sales) — reports spec §11. FOUR tabs, one resource.
//
//   Overview     GET {base}/api/dashboard/v1/orders               (paginated)
//   Brand Sales  GET {base}/api/dashboard/v1/orders/brand_orders  (unpaginated)
//   Class / DRR  GET {base}/api/dashboard/v1/orders/class_orders  (unpaginated)
//   Coordinator  GET {base}/api/dashboard/v1/orders/sc_orders     (unpaginated)
//
// Three behaviours that look like bugs and are NOT:
//
//   1. CUSTOMER FILTERING IS CLIENT-SIDE. `customer_id` (only when exactly one is selected)
//      and `customer_ids[]` (whenever any are selected) are sent for forward compatibility,
//      but Scott does not document or reliably honour them — `orderMatchesCustomerFilter` is
//      the authority, and it applies to the OVERVIEW tab only (spec §15.8).
//   2. `quantity`/`qty` ON AGGREGATE ENDPOINTS OFTEN MEANS ORDER COUNT, not units. Hence
//      `pickAggregateMetrics`: order_count = explicit count ?? quantity/qty ?? unit qty.
//   3. THE OVERVIEW "TOTAL ORDERS" TILE DOES NOT COME FROM THE STATS AGGREGATE. It shows the
//      LIST's pagination total, which can disagree with the fetched-all stats count whenever
//      pagy is absent and totals degrade to lower bounds. Reproduced by
//      `resolveRmpSalesOverviewTotalOrders` — do not "fix" it to use stats.totalCount.

import { callScottDashboard, normalizeId } from "../../scottClient";
import { fetchAllScottPages } from "../../scottPagination";
import {
  buildScottDateParams,
  createDefaultReportPeriod,
  enrichRowsByOrderId,
  formatReportCurrency,
  formatReportDate,
  formatReportNumber,
  isIncompleteOrderId,
  isPlainObject,
  parseScottNumber,
  pickField,
  pickNumber,
  pickObject,
  pickString,
  resolveReportPeriodRange
} from "./reportShared";
import {
  extractOrderTrackingRecords,
  extractOrdersPageMeta,
  extractOrdersListRecords
} from "./orderTrackingService";

export const RMP_SALES_RESOURCE = "orders";

/** Extraction plumbing is shared with Order Tracking — same `orders` envelope. */
export { extractOrderTrackingRecords, extractOrdersListRecords, extractOrdersPageMeta };

export const RMP_SALES_TABS = Object.freeze([
  { key: "overview", label: "Overview", pathSuffix: null },
  { key: "brand", label: "Brand Sales", pathSuffix: "brand_orders" },
  { key: "class", label: "Class / DRR", pathSuffix: "class_orders" },
  { key: "coordinator", label: "Coordinator Sales", pathSuffix: "sc_orders" }
]);

export const RMP_SALES_SERVER_REPORT_TYPES = Object.freeze([
  "pending",
  "completed",
  "overdue",
  "failed"
]);

export const RMP_SALES_REPORT_TYPE_OPTIONS = Object.freeze([
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "overdue", label: "Overdue" },
  { value: "failed", label: "Failed" }
]);

/** Fetch-all caps for the `orders` endpoint (spec §15.13). */
export const RMP_SALES_FETCH_ALL = Object.freeze({ pageSize: 100, maxPages: 100 });

// ---------------------------------------------------------------------------
// Defaults + query building
// ---------------------------------------------------------------------------

/** Default report type: `completed` (Order Tracking defaults to `pending` — they differ). */
export function createDefaultRmpSalesReportType() {
  return "completed";
}

/** Default period: `date` mode, today minus one year -> today (modes `date | month | year`). */
export function createDefaultPeriodConfig() {
  return createDefaultReportPeriod();
}

export function resolveRmpSalesPeriodRange(config) {
  return resolveReportPeriodRange(config);
}

/**
 * Applied filters -> query params.
 *
 * `customer_id` is sent ONLY when exactly one customer is selected; `customer_ids[]` is sent
 * whenever at least one is. Both are forward-compatibility only (see file header).
 *
 * @param {{reportType?: string, period?: object, customerIds?: Array<string|number>,
 *          brandId?: string|number, classId?: string|number, userId?: string|number}} applied
 * @returns {Record<string, string|string[]>}
 */
export function buildRmpSalesApiFilters(applied) {
  const filters = { ...buildScottDateParams(applied?.period ?? createDefaultPeriodConfig()) };

  const reportType = String(applied?.reportType ?? createDefaultRmpSalesReportType());
  if (RMP_SALES_SERVER_REPORT_TYPES.includes(reportType)) filters.report_type = reportType;

  const customerIds = (applied?.customerIds ?? []).map(normalizeId).filter(Boolean);
  if (customerIds.length === 1) filters.customer_id = customerIds[0];
  if (customerIds.length > 0) filters["customer_ids[]"] = customerIds;

  if (applied?.brandId) filters.brand_id = normalizeId(applied.brandId);
  if (applied?.classId) filters.class_id = normalizeId(applied.classId);
  if (applied?.userId) filters.user_id = normalizeId(applied.userId);

  return filters;
}

/** Client-side customer filter — the authoritative one. Empty selection = pass-through. */
export function orderMatchesCustomerFilter(row, customerIds) {
  const ids = (customerIds ?? []).map(normalizeId).filter(Boolean);
  if (ids.length === 0) return true;
  return ids.includes(normalizeId(row?.customer_id));
}

export function filterOrdersByCustomers(rows, customerIds) {
  const ids = (customerIds ?? []).map(normalizeId).filter(Boolean);
  if (ids.length === 0) return rows ?? [];
  return (rows ?? []).filter((row) => ids.includes(normalizeId(row?.customer_id)));
}

// ---------------------------------------------------------------------------
// Alias lists
// ---------------------------------------------------------------------------

/** Wide amount list — Scott names the money field differently on nearly every endpoint. */
export const AMOUNT_KEYS = Object.freeze([
  "total_amount",
  "sales_value",
  "amount",
  "revenue",
  "total_sales",
  "grand_total",
  "total",
  "order_total",
  "bill_amount",
  "net_amount",
  "sales_amount",
  "price",
  "value",
  "total_price",
  "order_amount",
  "net_value",
  "total_value"
]);

/** UNIT quantities only — deliberately excludes `quantity`/`qty` (see pickAggregateMetrics). */
export const UNIT_QTY_KEYS = Object.freeze([
  "total_qty",
  "total_quantity",
  "units_sold",
  "total_units",
  "unit_count"
]);

/** Overview quantity list = unit keys + the ambiguous `quantity`/`qty` tail. */
export const OVERVIEW_QTY_KEYS = Object.freeze([...UNIT_QTY_KEYS, "quantity", "qty"]);

export const ITEM_QTY_KEYS = Object.freeze([
  "item_qty",
  "ordered_qty",
  "order_qty",
  "total_qty",
  "total_quantity",
  "quantity",
  "qty"
]);

export const ORDER_VALUE_KEYS = Object.freeze([
  "order_value",
  "total_amount",
  "sales_value",
  "amount",
  "revenue",
  "value",
  "grand_total",
  "total",
  "total_sales"
]);

export const CLOSED_QTY_KEYS = Object.freeze([
  "closed_ordered_qty",
  "closed_qty",
  "completed_qty",
  "delivered_qty",
  "closed_order_qty",
  "closed_quantity"
]);

export const CLOSED_VALUE_KEYS = Object.freeze([
  "closed_ordered_value",
  "closed_value",
  "completed_value",
  "delivered_value",
  "closed_order_value",
  "closed_amount"
]);

// The eight lists below are TRANSCRIBED VERBATIM from the upstream source the spec cites
// (`ScottOne/src/services/reports/rmpSalesReportService.ts`, `DISTRIBUTOR_*` /
// `OTHER_CUSTOMER_*`) — same keys, same PRIORITY ORDER, nothing added. An earlier revision
// reconstructed them by analogy and lost five real aliases (`other_customer_ordered_qty`,
// `other_order_qty`, `other_customer_order_value`, `other_customer_closed_ordered_qty`,
// `other_customer_closed_ordered_value`), which blanked 4 of the 16 breakdown columns and
// degraded Other Fill Rate to `N/A` whenever Scott used those spellings. Order matters:
// `pickNumber` takes the FIRST key present, so inserting a key changes which value wins.
export const DISTRIBUTOR_QTY_KEYS = Object.freeze([
  "distributor_qty",
  "distributor_ordered_qty",
  "distributor_order_qty",
  "distributor_quantity"
]);

export const DISTRIBUTOR_VALUE_KEYS = Object.freeze([
  "distributor_value",
  "distributor_order_value",
  "distributor_amount",
  "distributor_sales_value"
]);

export const DISTRIBUTOR_CLOSED_QTY_KEYS = Object.freeze([
  "distributor_closed_qty",
  "distributor_closed_ordered_qty",
  "distributor_completed_qty",
  "distributor_delivered_qty"
]);

export const DISTRIBUTOR_CLOSED_VALUE_KEYS = Object.freeze([
  "distributor_closed_value",
  "distributor_closed_ordered_value",
  "distributor_completed_value"
]);

export const OTHER_QTY_KEYS = Object.freeze([
  "other_customer_qty",
  "other_qty",
  "other_ordered_qty",
  "other_customer_ordered_qty",
  "retail_qty",
  "other_order_qty"
]);

export const OTHER_VALUE_KEYS = Object.freeze([
  "other_customer_value",
  "other_value",
  "other_order_value",
  "other_customer_order_value",
  "retail_value"
]);

export const OTHER_CLOSED_QTY_KEYS = Object.freeze([
  "other_customer_closed_qty",
  "other_closed_qty",
  "other_closed_ordered_qty",
  "other_customer_closed_ordered_qty",
  "retail_closed_qty"
]);

export const OTHER_CLOSED_VALUE_KEYS = Object.freeze([
  "other_customer_closed_value",
  "other_closed_value",
  "other_closed_ordered_value",
  "other_customer_closed_ordered_value",
  "retail_closed_value"
]);

const ORDER_COUNT_KEYS = Object.freeze([
  "order_count",
  "orders_count",
  "total_orders",
  "no_of_orders",
  "orderCount",
  "ordersCount",
  "totalOrders"
]);

// ---------------------------------------------------------------------------
// Overview row normalization
// ---------------------------------------------------------------------------

const CUSTOMER_OBJECT_KEYS = Object.freeze(["customer", "Customer"]);

/** A customer code is a code, not a bare numeric id — letters or hyphens must be present. */
function looksLikeCustomerCode(value) {
  const text = String(value ?? "").trim();
  return text !== "" && /[A-Za-z-]/.test(text);
}

/**
 * Overview order row.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeOrderRow(raw) {
  const row = isPlainObject(raw) ? raw : {};
  const customer = pickObject(row, CUSTOMER_OBJECT_KEYS);

  const orderId = pickString(row, ["order_id", "orderId", "id"]);
  const explicitNumber = pickString(row, [
    "order_number",
    "order_no",
    "number",
    "invoice_no",
    "ref_no",
    "reference_number",
    "po_number",
    "order_code",
    "jobsheet_number"
  ]);

  const customerId =
    pickString(row, ["customer_id", "customerId"]) ||
    pickString(customer, ["id", "customer_id", "customerId"]);

  const customerCode =
    pickString(row, ["customer_code", "code", "customerCode", "dealer_code"]) ||
    pickString(customer, ["customer_code", "code"]) ||
    (looksLikeCustomerCode(customerId) ? customerId : "");

  return {
    ...row,
    id: normalizeId(pickField(row, ["id", "order_id", "orderId"], "")),
    order_id: orderId,
    order_number: explicitNumber || (orderId && !isIncompleteOrderId(orderId) ? orderId : ""),
    customer_id: customerId,
    customer_name:
      pickString(row, ["customer_name", "customer", "company_name", "name"]) ||
      pickString(customer, ["company_name", "customer_name", "name"]),
    customer_code: customerCode,
    customer_type:
      pickString(row, ["customer_type", "type"]) || pickString(customer, ["customer_type", "type"]),
    order_date: pickString(row, ["order_date", "date", "created_at", "order_created_at", "placed_at"]),
    total_amount: pickNumber(row, AMOUNT_KEYS),
    total_qty: pickNumber(row, OVERVIEW_QTY_KEYS),
    ordered_qty: pickNumber(row, ["ordered_qty", "ordered_quantity", "order_qty"]),
    delivered_qty: pickNumber(row, ["delivered_qty", "delivered_quantity", "closed_qty", "completed_qty"]),
    status: pickString(row, ["status", "report_type", "order_status"]),
    report_type: pickString(row, ["report_type"])
  };
}

const RMP_ORDER_ENRICH_FIELDS = Object.freeze([
  "order_number",
  "customer_code",
  "customer_name",
  "customer_type"
]);

export function normalizeOrderRows(rawRows) {
  return enrichRowsByOrderId(
    (rawRows ?? []).map((row) => normalizeOrderRow(row)),
    RMP_ORDER_ENRICH_FIELDS
  );
}

/** Display resolver (test-locked): order_number -> non-truncated order_id -> id -> `-`. */
export function resolveRmpOrderNumber(row) {
  const orderNumber = String(row?.order_number ?? "").trim();
  if (orderNumber) return orderNumber;
  const orderId = String(row?.order_id ?? "").trim();
  if (orderId && !isIncompleteOrderId(orderId)) return orderId;
  const id = String(row?.id ?? "").trim();
  return id || "-";
}

/** Display resolver (test-locked): trimmed customer_code, else `-`. */
export function resolveRmpOrderCustomerCode(row) {
  const code = String(row?.customer_code ?? "").trim();
  return code || "-";
}

// ---------------------------------------------------------------------------
// Customer-code enrichment (dependency-injected)
// ---------------------------------------------------------------------------

let customerLoader = null;
let customerCachePromise = null;
let customerCacheAt = 0;
const CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Register the customers-master loader (`fetchCustomers` from the customers service).
 * Injected rather than imported so this module has no hard dependency on a sibling that a
 * different worker owns — and so tests can supply a stub.
 * @param {() => Promise<Array<Record<string, unknown>>>} loader
 */
export function configureRmpCustomerLoader(loader) {
  customerLoader = typeof loader === "function" ? loader : null;
  resetRmpCustomerCache();
}

export function resetRmpCustomerCache() {
  customerCachePromise = null;
  customerCacheAt = 0;
}

function loadCustomersCached(loader) {
  const fn = loader ?? customerLoader;
  if (!fn) return null;
  const fresh = customerCachePromise && Date.now() - customerCacheAt < CUSTOMER_CACHE_TTL_MS;
  if (!fresh) {
    customerCacheAt = Date.now();
    customerCachePromise = Promise.resolve()
      .then(() => fn())
      .catch((error) => {
        // Enrichment is best-effort: a customers-master failure must not fail the report.
        console.warn("enrichRmpOrdersWithCustomerCodes: customers master unavailable", error);
        customerCachePromise = null;
        return [];
      });
  }
  return customerCachePromise;
}

/**
 * Fill `customer_code` from the customers master for rows that have a `customer_id` but no code.
 * No-ops when every row already has a code, or when no loader is configured.
 * @param {Record<string, unknown>[]} rows
 * @param {() => Promise<Array<Record<string, unknown>>>} [loader]
 */
export async function enrichRmpOrdersWithCustomerCodes(rows, loader) {
  const list = rows ?? [];
  const needsCode = list.some(
    (row) => !String(row?.customer_code ?? "").trim() && String(row?.customer_id ?? "").trim()
  );
  if (!needsCode) return list;

  const promise = loadCustomersCached(loader);
  if (!promise) return list;

  const customers = await promise;
  const byId = new Map();
  for (const customer of customers ?? []) {
    const id = normalizeId(customer?.id ?? customer?.customer_id);
    const code = String(customer?.customer_code ?? customer?.code ?? "").trim();
    if (id && code) byId.set(id, code);
  }
  if (byId.size === 0) return list;

  return list.map((row) => {
    if (String(row?.customer_code ?? "").trim()) return row;
    const code = byId.get(normalizeId(row?.customer_id));
    return code ? { ...row, customer_code: code } : row;
  });
}

// ---------------------------------------------------------------------------
// Breakdown normalization
// ---------------------------------------------------------------------------

/**
 * The 12 shared breakdown metrics (4 totals + 4 distributor + 4 other-customer).
 * @param {Record<string, unknown>} row
 */
export function normalizeBreakdownMetrics(row) {
  return {
    item_qty: pickNumber(row, ITEM_QTY_KEYS),
    order_value: pickNumber(row, ORDER_VALUE_KEYS),
    closed_ordered_qty: pickNumber(row, CLOSED_QTY_KEYS),
    closed_ordered_value: pickNumber(row, CLOSED_VALUE_KEYS),
    distributor_qty: pickNumber(row, DISTRIBUTOR_QTY_KEYS),
    distributor_value: pickNumber(row, DISTRIBUTOR_VALUE_KEYS),
    distributor_closed_qty: pickNumber(row, DISTRIBUTOR_CLOSED_QTY_KEYS),
    distributor_closed_value: pickNumber(row, DISTRIBUTOR_CLOSED_VALUE_KEYS),
    other_customer_qty: pickNumber(row, OTHER_QTY_KEYS),
    other_customer_value: pickNumber(row, OTHER_VALUE_KEYS),
    other_customer_closed_qty: pickNumber(row, OTHER_CLOSED_QTY_KEYS),
    other_customer_closed_value: pickNumber(row, OTHER_CLOSED_VALUE_KEYS)
  };
}

/** Explicit count keys -> an `orders` array length -> any key matching /order.*count/i. */
export function pickOrderCount(row) {
  const explicit = pickNumber(row, ORDER_COUNT_KEYS);
  if (explicit !== undefined) return explicit;
  if (Array.isArray(row?.orders)) return row.orders.length;
  if (!isPlainObject(row)) return undefined;
  for (const [key, value] of Object.entries(row)) {
    if (!/order.*count|count.*order/i.test(key)) continue;
    const num = parseScottNumber(value);
    if (num !== undefined) return num;
  }
  return undefined;
}

/**
 * QUIRK: on aggregate endpoints `quantity`/`qty` usually means ORDER COUNT, not units.
 *   order_count = explicit count ?? quantity/qty ?? unit qty
 *   total_qty   = unit-qty keys ?? quantity/qty
 * @returns {{order_count: number|undefined, total_qty: number|undefined}}
 */
export function pickAggregateMetrics(row) {
  const ambiguous = pickNumber(row, ["quantity", "qty"]);
  const unitQty = pickNumber(row, UNIT_QTY_KEYS);
  const explicitCount = pickOrderCount(row);

  return {
    order_count: explicitCount ?? ambiguous ?? unitQty,
    total_qty: unitQty ?? ambiguous
  };
}

function embeddedEntity(row, keys) {
  return pickObject(row, keys);
}

/** Brand breakdown row. */
export function normalizeBrandOrderRow(raw) {
  const row = isPlainObject(raw) ? raw : {};
  const embedded = embeddedEntity(row, ["rmp_brand", "RmpBrand"]);
  const metrics = normalizeBreakdownMetrics(row);
  const aggregate = pickAggregateMetrics(row);

  const brandId =
    pickString(row, ["brand_id", "rmp_brand_id", "rmpBrandId", "BrandId"]) ||
    pickString(embedded, ["id", "brand_id", "rmp_brand_id"]);

  return {
    ...row,
    ...metrics,
    id: brandId,
    brand_id: brandId,
    rmp_brand_id: brandId,
    brand_name:
      pickString(row, ["brand_name", "rmp_brand_name", "brand", "title", "name"]) ||
      pickString(embedded, ["name", "brand_name", "title"]),
    order_count: pickOrderCount(row) ?? aggregate.order_count,
    // Deprecated mirrors kept for older column configs.
    total_qty: metrics.item_qty ?? aggregate.total_qty,
    total_amount: metrics.order_value ?? pickNumber(row, AMOUNT_KEYS)
  };
}

/** Class breakdown row — same as brand plus the daily run rate. */
export function normalizeClassOrderRow(raw) {
  const row = isPlainObject(raw) ? raw : {};
  const embedded = embeddedEntity(row, ["rmp_class", "RmpClass"]);
  const metrics = normalizeBreakdownMetrics(row);
  const aggregate = pickAggregateMetrics(row);

  const classId =
    pickString(row, ["class_id", "rmp_class_id", "rmpClassId", "ClassId"]) ||
    pickString(embedded, ["id", "class_id", "rmp_class_id"]);

  return {
    ...row,
    ...metrics,
    id: classId,
    class_id: classId,
    rmp_class_id: classId,
    class_name:
      pickString(row, ["class_name", "rmp_class_name", "class", "title", "name"]) ||
      pickString(embedded, ["name", "class_name", "title"]),
    drr: pickNumber(row, ["drr", "daily_run_rate", "run_rate", "daily_rate"]),
    order_count: pickOrderCount(row) ?? aggregate.order_count,
    total_qty: metrics.item_qty ?? aggregate.total_qty,
    total_amount: metrics.order_value ?? pickNumber(row, AMOUNT_KEYS)
  };
}

/** Sales-coordinator breakdown row (only 4 metrics + the fill rate on this tab). */
export function normalizeScOrderRow(raw) {
  const row = isPlainObject(raw) ? raw : {};
  const embedded = embeddedEntity(row, ["user", "sales_coordinator", "sc_user"]);

  const userId =
    pickString(row, ["user_id", "sc_user_id", "coordinator_id", "employee_id"]) ||
    pickString(embedded, ["id", "user_id"]);

  const userName =
    pickString(row, [
      "coordinator_name",
      "user_name",
      "sc_name",
      "employee_name",
      "sales_coordinator_name",
      "name"
    ]) || pickString(embedded, ["name", "user_name", "full_name"]);

  return {
    ...row,
    id: userId,
    user_id: userId,
    user_name: userName,
    coordinator_name: userName,
    ordered_qty: pickNumber(row, ITEM_QTY_KEYS),
    order_value: pickNumber(row, ORDER_VALUE_KEYS),
    closed_ordered_qty: pickNumber(row, CLOSED_QTY_KEYS),
    closed_ordered_value: pickNumber(row, CLOSED_VALUE_KEYS),
    order_count: pickOrderCount(row)
  };
}

/**
 * Attach the display label, mapping ids through the RMP masters when the row has no name.
 * @param {Record<string, unknown>[]} rows
 * @param {{idField: string, nameField: string, masters?: Array<{id: unknown, name: unknown}>}} options
 */
export function toBreakdownRows(rows, { idField, nameField, masters }) {
  const byId = new Map((masters ?? []).map((master) => [normalizeId(master?.id), master?.name]));
  return (rows ?? []).map((row) => {
    const id = normalizeId(row?.[idField]);
    const name = String(row?.[nameField] ?? "").trim() || String(byId.get(id) ?? "").trim();
    return { ...row, id, label: name || "-" };
  });
}

// ---------------------------------------------------------------------------
// Fill rates
// ---------------------------------------------------------------------------

/**
 * `((n / d) * 100).toFixed(1) + '%'`, or `'N/A'` when either operand is missing or the
 * denominator is 0.
 */
export function formatFillRate(numerator, denominator) {
  const n = parseScottNumber(numerator);
  const d = parseScottNumber(denominator);
  if (n === undefined || d === undefined || d === 0) return "N/A";
  return `${((n / d) * 100).toFixed(1)}%`;
}

export function fillRateTotal(row) {
  return formatFillRate(row?.closed_ordered_qty, row?.item_qty ?? row?.ordered_qty);
}

/**
 * The same ratio as `formatFillRate`, as a NUMBER (or `undefined` for the `'N/A'` case).
 *
 * The fill-rate columns are `computed: true` — they have no backing field — so without an
 * explicit sort accessor the table header was inert. `undefined` is what `tableSort` treats
 * as empty, so `N/A` rows sink to the bottom in both directions like every other blank cell.
 */
export function fillRateValue(numerator, denominator) {
  const n = parseScottNumber(numerator);
  const d = parseScottNumber(denominator);
  if (n === undefined || d === undefined || d === 0) return undefined;
  return (n / d) * 100;
}

export function fillRateTotalValue(row) {
  return fillRateValue(row?.closed_ordered_qty, row?.item_qty ?? row?.ordered_qty);
}

export function distributorFillRateValue(row) {
  return fillRateValue(row?.distributor_closed_qty, row?.distributor_qty);
}

export function otherFillRateValue(row) {
  return fillRateValue(row?.other_customer_closed_qty, row?.other_customer_qty);
}

export function distributorFillRate(row) {
  return formatFillRate(row?.distributor_closed_qty, row?.distributor_qty);
}

export function otherFillRate(row) {
  return formatFillRate(row?.other_customer_closed_qty, row?.other_customer_qty);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function buildRmpOrdersQuery(pageParams, filters) {
  const query = { items: pageParams.items, page: pageParams.page };
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    query[key] = value;
  }
  return query;
}

/** Overview, one server page. */
export async function fetchRmpOrdersPage(params = {}) {
  const { page = 1, pageSize, items, ...filters } = params ?? {};
  const pageParams = { page: Math.max(1, Number(page) || 1), items: Number(items ?? pageSize ?? 20) };

  const { body } = await callScottDashboard({
    resource: RMP_SALES_RESOURCE,
    method: "GET",
    query: buildRmpOrdersQuery(pageParams, filters)
  });

  const records = extractOrderTrackingRecords(body);
  return {
    data: normalizeOrderRows(records),
    ...extractOrdersPageMeta(body, pageParams, records.length)
  };
}

/** Overview, every page (100 x 100), then customer-code enrichment. */
export async function fetchRmpOrders(filters = {}, loader) {
  const rows = await fetchAllScottPages(
    (pp) => fetchRmpOrdersPage({ page: pp.page, items: pp.items, ...filters }),
    RMP_SALES_FETCH_ALL
  );
  const enriched = enrichRowsByOrderId(rows, RMP_ORDER_ENRICH_FIELDS);
  return enrichRmpOrdersWithCustomerCodes(enriched, loader);
}

/** One unpaginated breakdown endpoint. */
async function fetchBreakdown(pathSuffix, filters, normalize) {
  const { body } = await callScottDashboard({
    resource: RMP_SALES_RESOURCE,
    method: "GET",
    pathSuffix,
    query: buildRmpOrdersQuery({ items: undefined, page: undefined }, filters)
  });
  return extractOrderTrackingRecords(body).map((row) => normalize(row));
}

export async function fetchBrandOrders(filters = {}) {
  return fetchBreakdown("brand_orders", filters, normalizeBrandOrderRow);
}

export async function fetchClassOrders(filters = {}) {
  return fetchBreakdown("class_orders", filters, normalizeClassOrderRow);
}

export async function fetchScOrders(filters = {}) {
  return fetchBreakdown("sc_orders", filters, normalizeScOrderRow);
}

// ---------------------------------------------------------------------------
// Stats — per tab
// ---------------------------------------------------------------------------

function sumField(rows, key) {
  let total = 0;
  for (const row of rows ?? []) {
    const num = parseScottNumber(row?.[key]);
    if (num !== undefined) total += num;
  }
  return total;
}

/** `Σ delivered_qty / Σ ordered_qty × 100`, 1 decimal + `%`; `'N/A'` when ordered total is 0. */
export function computeOverviewFillRate(rows) {
  const delivered = sumField(rows, "delivered_qty");
  const ordered = sumField(rows, "ordered_qty");
  if (ordered === 0) return "N/A";
  return `${((delivered / ordered) * 100).toFixed(1)}%`;
}

/** Per `customer_type || 'Unknown'`: `{type, qty, amount}`, insertion-ordered. */
export function computeCustomerTypeBreakdown(rows) {
  const byType = new Map();
  for (const row of rows ?? []) {
    const type = String(row?.customer_type ?? "").trim() || "Unknown";
    const entry = byType.get(type) ?? { type, qty: 0, amount: 0 };
    entry.qty += parseScottNumber(row?.total_qty) ?? 0;
    entry.amount += parseScottNumber(row?.total_amount) ?? 0;
    byType.set(type, entry);
  }
  return [...byType.values()];
}

/**
 * Overview stats.
 * `totalCount` is returned for completeness but the Total Orders TILE must not use it —
 * see `resolveRmpSalesOverviewTotalOrders`.
 */
export function computeRmpSalesOverviewStats(rows) {
  const list = rows ?? [];
  return {
    totalCount: list.length,
    totalUnits: sumField(list, "total_qty"),
    salesValue: sumField(list, "total_amount"),
    fillRate: computeOverviewFillRate(list),
    customerTypeBreakdown: computeCustomerTypeBreakdown(list)
  };
}

/**
 * QUIRK REPRODUCED (spec §11): the Overview "Total Orders" tile reads the LIST's pagination
 * total — `activeOrdersPage?.totalCount ?? rows.length` — NOT `stats.totalCount`. When pagy is
 * missing the pagination total is a lower bound, so the two figures legitimately disagree.
 */
export function resolveRmpSalesOverviewTotalOrders(activeOrdersPage, rows) {
  return activeOrdersPage?.totalCount ?? (rows ?? []).length;
}

/** Brand/Class tabs: computed live from the DISPLAYED (already filtered) rows. */
export function computeRmpBreakdownStats(rows, entityLabel = "Brands") {
  const list = rows ?? [];
  const itemQty = sumField(list, "item_qty");
  return {
    itemQty,
    orderValue: sumField(list, "order_value"),
    fillRate: formatFillRate(sumField(list, "closed_ordered_qty"), itemQty),
    entityCount: list.length,
    entityLabel
  };
}

export function computeRmpBrandStats(rows) {
  return computeRmpBreakdownStats(rows, "Brands");
}

export function computeRmpClassStats(rows) {
  return computeRmpBreakdownStats(rows, "Classes");
}

/** Coordinator tab. */
export function computeRmpCoordinatorStats(rows) {
  const list = rows ?? [];
  const orderedQty = sumField(list, "ordered_qty");
  return {
    orderedQty,
    orderValue: sumField(list, "order_value"),
    fillRate: formatFillRate(sumField(list, "closed_ordered_qty"), orderedQty),
    coordinatorCount: list.length
  };
}

// ---------------------------------------------------------------------------
// Tables + exports
// ---------------------------------------------------------------------------

/** Overview table/export column labels (9). */
export const RMP_SALES_OVERVIEW_EXPORT_HEADERS = Object.freeze([
  "Order ID",
  "Order Number",
  "Customer",
  "Customer Code",
  "Customer Type",
  "Date",
  "Qty",
  "Amount",
  "Status"
]);

/**
 * @param {string} [fallbackStatus] the applied report type — the Status cell falls back to it
 *   when Scott omits a per-row status (same as the table badge).
 */
export function overviewExportFieldMap(fallbackStatus = "") {
  return {
    "Order ID": (row) => String(row?.order_id ?? row?.id ?? "-") || "-",
    "Order Number": (row) => resolveRmpOrderNumber(row),
    Customer: (row) => String(row?.customer_name ?? "-") || "-",
    "Customer Code": (row) => resolveRmpOrderCustomerCode(row),
    "Customer Type": (row) => String(row?.customer_type ?? "-") || "-",
    Date: (row) => formatReportDate(row?.order_date),
    Qty: (row) => String(parseScottNumber(row?.total_qty) ?? 0),
    Amount: (row) => formatReportCurrency(row?.total_amount),
    Status: (row) => String(row?.status ?? "").trim() || fallbackStatus || "-"
  };
}

/**
 * 16 breakdown columns (17 with DRR); the entity column is sticky-left in the table.
 *
 * `includeDrr` adds the Daily Run Rate column used by the Class / DRR tab. The tab is NAMED
 * for that figure and `normalizeClassOrderRow` has always normalised `drr` — and the tab's
 * advanced-filter columns already offer it — but neither this port nor upstream ever put it
 * in the table. Added here rather than preserving the upstream omission.
 *
 * @param {string} [entityLabel]
 * @param {{includeDrr?: boolean}} [options]
 */
export function buildRmpBreakdownTableColumns(entityLabel = "Brand", options = {}) {
  return [
    { label: entityLabel, keys: ["label"], sticky: "left" },
    { label: "Item Qty", keys: ["item_qty"], format: "number" },
    { label: "Order Value", keys: ["order_value"], format: "currency" },
    ...(options?.includeDrr ? [{ label: "DRR", keys: ["drr"], format: "number" }] : []),
    { label: "Closed Ordered Qty", keys: ["closed_ordered_qty"], format: "number" },
    { label: "Closed Ordered Value", keys: ["closed_ordered_value"], format: "currency" },
    { label: "Distributor Qty", keys: ["distributor_qty"], format: "number" },
    { label: "Distributor Value", keys: ["distributor_value"], format: "currency" },
    { label: "Distributor Closed Qty", keys: ["distributor_closed_qty"], format: "number" },
    { label: "Distributor Closed Value", keys: ["distributor_closed_value"], format: "currency" },
    { label: "Other Customer Qty", keys: ["other_customer_qty"], format: "number" },
    { label: "Other Customer Value", keys: ["other_customer_value"], format: "currency" },
    { label: "Other Customer Closed Qty", keys: ["other_customer_closed_qty"], format: "number" },
    { label: "Other Customer Closed Value", keys: ["other_customer_closed_value"], format: "currency" },
    {
      label: "Fill Rate Total",
      keys: ["fill_rate_total"],
      formatValue: fillRateTotal,
      computed: true,
      sortable: true,
      sortType: "number",
      sortValue: fillRateTotalValue
    },
    {
      label: "Distributor Fill Rate",
      keys: ["distributor_fill_rate"],
      formatValue: distributorFillRate,
      computed: true,
      sortable: true,
      sortType: "number",
      sortValue: distributorFillRateValue
    },
    {
      label: "Other Fill Rate",
      keys: ["other_fill_rate"],
      formatValue: otherFillRate,
      computed: true,
      sortable: true,
      sortType: "number",
      sortValue: otherFillRateValue
    }
  ];
}

/** Export headers for the Brand and Class / DRR tabs — always the table's own labels. */
export function buildBreakdownExportHeaders(entityLabel = "Brand", options = {}) {
  return buildRmpBreakdownTableColumns(entityLabel, options).map((column) => column.label);
}

const BREAKDOWN_QTY_FIELDS = Object.freeze([
  ["Item Qty", "item_qty"],
  ["Closed Ordered Qty", "closed_ordered_qty"],
  ["Distributor Qty", "distributor_qty"],
  ["Distributor Closed Qty", "distributor_closed_qty"],
  ["Other Customer Qty", "other_customer_qty"],
  ["Other Customer Closed Qty", "other_customer_closed_qty"]
]);

const BREAKDOWN_VALUE_FIELDS = Object.freeze([
  ["Order Value", "order_value"],
  ["Closed Ordered Value", "closed_ordered_value"],
  ["Distributor Value", "distributor_value"],
  ["Distributor Closed Value", "distributor_closed_value"],
  ["Other Customer Value", "other_customer_value"],
  ["Other Customer Closed Value", "other_customer_closed_value"]
]);

/** Missing qty exports as `0`; missing currency exports as `-` (asymmetric, and deliberate). */
export function breakdownExportFieldMap(entityLabel = "Brand", options = {}) {
  const map = {
    [entityLabel]: (row) => String(row?.label ?? "-") || "-",
    "Fill Rate Total": fillRateTotal,
    "Distributor Fill Rate": distributorFillRate,
    "Other Fill Rate": otherFillRate
  };
  for (const [header, key] of BREAKDOWN_QTY_FIELDS) {
    map[header] = (row) => String(parseScottNumber(row?.[key]) ?? 0);
  }
  for (const [header, key] of BREAKDOWN_VALUE_FIELDS) {
    map[header] = (row) => formatReportCurrency(row?.[key]);
  }
  // Class / DRR only — the header exists solely when the DRR column does.
  if (options?.includeDrr) map.DRR = (row) => formatReportNumber(row?.drr);
  return map;
}

/** Coordinator tab columns/headers (6). */
export const COORDINATOR_EXPORT_HEADERS = Object.freeze([
  "Sales Coordinator",
  "Ordered Qty",
  "Order Value",
  "Closed Ordered Qty",
  "Closed Ordered Value",
  "Fill Rate Total"
]);

export function buildRmpCoordinatorTableColumns() {
  return [
    { label: "Sales Coordinator", keys: ["coordinator_name", "user_name"] },
    { label: "Ordered Qty", keys: ["ordered_qty"], format: "number" },
    { label: "Order Value", keys: ["order_value"], format: "currency" },
    { label: "Closed Ordered Qty", keys: ["closed_ordered_qty"], format: "number" },
    { label: "Closed Ordered Value", keys: ["closed_ordered_value"], format: "currency" },
    {
      label: "Fill Rate Total",
      keys: ["fill_rate_total"],
      formatValue: fillRateTotal,
      computed: true,
      sortable: true,
      sortType: "number",
      sortValue: fillRateTotalValue
    }
  ];
}

export function coordinatorExportFieldMap() {
  return {
    "Sales Coordinator": (row) => String(row?.coordinator_name ?? row?.user_name ?? "-") || "-",
    "Ordered Qty": (row) => String(parseScottNumber(row?.ordered_qty) ?? 0),
    "Order Value": (row) => formatReportCurrency(row?.order_value),
    "Closed Ordered Qty": (row) => String(parseScottNumber(row?.closed_ordered_qty) ?? 0),
    "Closed Ordered Value": (row) => formatReportCurrency(row?.closed_ordered_value),
    "Fill Rate Total": fillRateTotal
  };
}

/** Per-tab export filenames (spec §11). */
export const RMP_SALES_EXPORT_NAMES = Object.freeze({
  overview: "rmp-sales-overview",
  brand: "rmp-sales-brand",
  class: "rmp-sales-class-drr",
  coordinator: "rmp-sales-coordinator"
});

/**
 * Overview table columns (the inline table on the Overview tab).
 *
 * The Status cell is `row.status || <applied report type> || "-"` — the EXACT expression
 * `overviewExportFieldMap` uses, so the badge on screen and the CSV cell cannot drift. It
 * deliberately does NOT read `row.report_type`: upstream (`RmpSalesReportPage.tsx`, spec §11)
 * renders `{row.status || globalApplied.reportType}`, so a per-order `report_type` echoed
 * back under `reportType: "all"` must not win over the applied filter.
 *
 * @param {string} [fallbackStatus] the APPLIED report type (not `apiFilters.report_type`,
 *   which is dropped for types the server does not accept).
 */
export function buildRmpSalesOverviewColumns(fallbackStatus = "") {
  const fallback = String(fallbackStatus ?? "").trim();
  return [
    { label: "Order #", keys: ["order_number", "order_id", "id"], formatValue: resolveRmpOrderNumber },
    { label: "Customer", keys: ["customer_name"] },
    { label: "Type", keys: ["customer_type"] },
    { label: "Date", keys: ["order_date"], format: "date" },
    { label: "Qty", keys: ["total_qty"], format: "number" },
    { label: "Amount", keys: ["total_amount"], format: "currency" },
    {
      label: "Status",
      keys: ["status"],
      sortKey: "status",
      badge: true,
      formatValue: (row) => String(row?.status ?? "").trim() || fallback || "-"
    }
  ];
}

/** The static shape (no applied report type yet), for consumers without filter values. */
export const RMP_SALES_OVERVIEW_COLUMNS = Object.freeze(buildRmpSalesOverviewColumns());

/** Filter columns per tab (spec §11 "Filters"). */
export function getRmpSalesFilterColumnsForTab(tab) {
  switch (String(tab ?? "overview")) {
    case "brand":
      return [
        { label: "Brand Name", keys: ["label"] },
        { label: "Item Qty", keys: ["item_qty"], format: "number" },
        { label: "Order Value", keys: ["order_value"], format: "currency" },
        { label: "Closed Ordered Qty", keys: ["closed_ordered_qty"], format: "number" },
        { label: "Closed Ordered Value", keys: ["closed_ordered_value"], format: "currency" },
        { label: "Distributor Qty", keys: ["distributor_qty"], format: "number" },
        { label: "Distributor Value", keys: ["distributor_value"], format: "currency" },
        { label: "Other Customer Qty", keys: ["other_customer_qty"], format: "number" },
        { label: "Other Customer Value", keys: ["other_customer_value"], format: "currency" }
      ];
    case "class":
      return [
        { label: "Class Name", keys: ["label"] },
        { label: "Item Qty", keys: ["item_qty"], format: "number" },
        { label: "Order Value", keys: ["order_value"], format: "currency" },
        { label: "DRR", keys: ["drr"], format: "number" },
        { label: "Closed Ordered Qty", keys: ["closed_ordered_qty"], format: "number" },
        { label: "Closed Ordered Value", keys: ["closed_ordered_value"], format: "currency" },
        { label: "Distributor Qty", keys: ["distributor_qty"], format: "number" },
        { label: "Other Customer Qty", keys: ["other_customer_qty"], format: "number" }
      ];
    case "coordinator":
      return [
        { label: "Coordinator", keys: ["coordinator_name"] },
        { label: "Ordered Qty", keys: ["ordered_qty"], format: "number" },
        { label: "Order Value", keys: ["order_value"], format: "currency" },
        { label: "Closed Ordered Qty", keys: ["closed_ordered_qty"], format: "number" },
        { label: "Closed Ordered Value", keys: ["closed_ordered_value"], format: "currency" }
      ];
    default:
      return [
        { label: "Order ID", keys: ["order_id"] },
        { label: "Order Number", keys: ["order_number"] },
        { label: "Customer Name", keys: ["customer_name"] },
        { label: "Customer Code", keys: ["customer_code"] },
        { label: "Customer Type", keys: ["customer_type"] },
        { label: "Order Date", keys: ["order_date"], format: "date" },
        { label: "Total Qty", keys: ["total_qty"], format: "number" },
        { label: "Total Amount", keys: ["total_amount"], format: "currency" },
        {
          label: "Status",
          keys: ["status", "report_type"],
          type: "enum",
          options: RMP_SALES_SERVER_REPORT_TYPES.map((value) => ({ value, label: value }))
        }
      ];
  }
}
