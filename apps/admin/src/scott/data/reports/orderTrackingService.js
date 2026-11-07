// Order Tracking Report — reports spec §10.
//
//   GET {base}/api/dashboard/v1/orders   ?items&page&report_type?&start_date?&end_date?
//
// The `orders` envelope is the awkward one in the whole API:
//
//   { data: { orders:      { data: [ …rows… ], pagy: { count, page, items, pages } },
//             order_items: { data: [ … ] } } }
//
// Extraction MUST target the `orders` wrapper specifically — the generic `extractRecords`
// walk would happily return `order_items` depending on key order — and the pagination meta
// must come from THAT wrapper's pagy (spec §15.3).
//
// Defaults: report type `pending`, period `date` mode covering today minus 1 year -> today.
// `oos` is NOT a server report_type: selecting it drops `report_type` from the query, forces a
// full fetch and filters `is_oos === true` client-side (spec §15.7).
//
// Fetch-all here is capped at pageSize 100 / maxPages 100 — the `orders` endpoint rejects the
// 10000-row pages the generic default would ask for (spec §15.13).

import { buildScottPaginatedMeta, callScottDashboard, extractRecords, normalizeId } from "../../scottClient";
import { fetchAllScottPages } from "../../scottPagination";
import {
  EMPTY_REPORT_CELL,
  buildReportExportConfig,
  buildScottDateParams,
  createDefaultReportPeriod,
  enrichRowsByOrderId,
  isPlainObject,
  parseScottNumber,
  pickBoolean,
  pickField,
  pickNumber,
  pickObject,
  pickString,
  reportExportFieldMap,
  reportExportHeaders,
  resolveReportPeriodRange
} from "./reportShared";

export const ORDER_TRACKING_RESOURCE = "orders";

/** Server-side report types. `all` omits the param; `oos` is client-side only. */
export const ORDER_TRACKING_SERVER_REPORT_TYPES = Object.freeze([
  "pending",
  "completed",
  "overdue",
  "failed"
]);

/** Toolbar options, in UI order. */
export const ORDER_TRACKING_REPORT_TYPE_OPTIONS = Object.freeze([
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "failed", label: "Failed" },
  { value: "oos", label: "OOS" },
  { value: "completed", label: "Completed" }
]);

/** Fetch-all caps for the `orders` endpoint. */
export const ORDER_TRACKING_FETCH_ALL = Object.freeze({ pageSize: 100, maxPages: 100 });

/** Same donor fields as the RMP Sales overview — both read the same `orders` resource. */
export const ORDER_TRACKING_ENRICH_FIELDS = Object.freeze([
  "order_number",
  "customer_code",
  "customer_name",
  "customer_type"
]);

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default report type: `pending`. */
export function createDefaultOrderTrackingReportType() {
  return "pending";
}

/** Default period: `date` mode, today minus one year -> today. */
export function createDefaultOrderTrackingPeriod() {
  return createDefaultReportPeriod();
}

/** Period config -> ISO range (modes `date | week | month | year`). */
export function resolveOrderTrackingPeriodRange(config) {
  return resolveReportPeriodRange(config);
}

/**
 * UI selection -> API filters.
 * @param {{reportType?: string, period?: object}} applied
 * @returns {{report_type?: string, start_date?: string, end_date?: string}}
 */
export function buildOrderTrackingApiFilters(applied) {
  const filters = { ...buildScottDateParams(applied?.period ?? createDefaultOrderTrackingPeriod()) };
  const reportType = String(applied?.reportType ?? createDefaultOrderTrackingReportType());
  if (ORDER_TRACKING_SERVER_REPORT_TYPES.includes(reportType)) filters.report_type = reportType;
  return filters;
}

/** OOS forces full-dataset mode: there is no server-side flag for it. */
export function orderTrackingNeedsFullDataset(reportType) {
  return String(reportType ?? "") === "oos";
}

// ---------------------------------------------------------------------------
// Extraction (shared with rmpSalesService.js)
// ---------------------------------------------------------------------------

/**
 * The paginated `orders` wrapper, and ONLY that wrapper.
 * @returns {Record<string, unknown>[]|null} null when the body is not the paginated shape
 */
export function extractOrdersListRecords(body) {
  if (!isPlainObject(body)) return null;
  if (isPlainObject(body.orders) && Array.isArray(body.orders.data)) return body.orders.data;
  const data = body.data;
  if (isPlainObject(data) && isPlainObject(data.orders) && Array.isArray(data.orders.data)) {
    return data.orders.data;
  }
  return null;
}

/** Keys the deep walk will follow when the response is neither paginated nor a known list. */
const ORDER_WALK_KEYS = Object.freeze([
  "class_orders",
  "brand_orders",
  "sc_orders",
  "orders",
  "data",
  "records",
  "items",
  "results"
]);

const ID_MAP_INJECT_KEYS = Object.freeze([
  "class_id",
  "rmp_class_id",
  "brand_id",
  "rmp_brand_id",
  "user_id"
]);

/**
 * Aggregate endpoints sometimes answer with an object keyed by entity id instead of an array:
 *   { "12": {…}, "13": {…} }
 * The key is the only place the entity id appears, so it is injected onto each row.
 * @returns {Record<string, unknown>[]|null}
 */
export function extractIdMapRows(value) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  if (!entries.every(([key, row]) => /^\d+$/.test(key) && isPlainObject(row))) return null;

  return entries.map(([key, row]) => {
    const injected = { ...row };
    for (const idKey of ID_MAP_INJECT_KEYS) {
      if (injected[idKey] === undefined) injected[idKey] = key;
    }
    return injected;
  });
}

/**
 * Every order-ish response shape, in priority order:
 * paginated `orders` wrapper -> generic `extractRecords` -> depth-6 walk -> id-map.
 * @returns {Record<string, unknown>[]}
 */
export function extractOrderTrackingRecords(body, depth = 0) {
  const paginated = extractOrdersListRecords(body);
  if (paginated) return paginated;

  const generic = extractRecords(body);
  if (generic.length > 0) return generic;

  if (depth > 6 || !isPlainObject(body)) return [];

  for (const key of ORDER_WALK_KEYS) {
    const value = body[key];
    if (Array.isArray(value)) return value;
    if (isPlainObject(value)) {
      const nested = extractOrderTrackingRecords(value, depth + 1);
      if (nested.length > 0) return nested;
    }
  }

  return extractIdMapRows(body) ?? [];
}

/**
 * Pagination meta from the `orders` wrapper's own pagy, falling back to the generic builder.
 * The generic builder would otherwise pick up `order_items`' pagy and report the wrong totals.
 */
export function extractOrdersPageMeta(body, requested, rowCount) {
  const wrapper = isPlainObject(body)
    ? (isPlainObject(body.orders) ? body.orders : isPlainObject(body.data?.orders) ? body.data.orders : null)
    : null;

  const pagy = wrapper?.pagy;
  if (isPlainObject(pagy) && typeof pagy.count === "number" && typeof pagy.pages === "number") {
    return {
      page: typeof pagy.page === "number" ? pagy.page : requested.page,
      pageSize: typeof pagy.items === "number" ? pagy.items : (pagy.limit ?? requested.items),
      totalCount: pagy.count,
      totalPages: Math.max(1, pagy.pages),
      totalCountIsExact: true
    };
  }
  return buildScottPaginatedMeta(body, requested, rowCount);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const CUSTOMER_OBJECT_KEYS = Object.freeze(["customer", "Customer"]);
const CLASS_OBJECT_KEYS = Object.freeze(["rmp_class", "RmpClass", "class"]);

const FAILURE_REASON_KEYS = Object.freeze([
  "uniware_reason",
  "uniwareReason",
  "error_reason",
  "failure_reason",
  "reason",
  "error_message",
  "fail_reason"
]);

/**
 * @param {Record<string, unknown>} raw
 * @param {string} [requestedReportType] the report_type this page was requested with — it is a
 *   legitimate signal for the derived booleans (a row from `report_type=overdue` IS overdue)
 * @returns {Record<string, unknown>}
 */
export function normalizeOrderTrackingRow(raw, requestedReportType) {
  const row = isPlainObject(raw) ? raw : {};
  const customer = pickObject(row, CUSTOMER_OBJECT_KEYS);
  const rmpClass = pickObject(row, CLASS_OBJECT_KEYS);

  const status = pickString(row, ["status", "order_status", "report_type"]);
  const statusText = status.toLowerCase();
  const requested = String(requestedReportType ?? "");
  const failureReason = pickString(row, FAILURE_REASON_KEYS);

  const explicitOverdue = pickBoolean(row, ["is_overdue", "isOverdue", "overdue"]);
  const explicitFailed = pickBoolean(row, ["is_failed", "isFailed", "failed"]);
  const explicitOos = pickBoolean(row, ["is_oos", "isOos", "oos", "out_of_stock", "is_out_of_stock"]);

  // Each derived flag stays `undefined` when there is NO signal, so the table shows `-`
  // instead of a confident (and wrong) "No" — spec §15.5.
  const isOverdue =
    explicitOverdue !== undefined
      ? explicitOverdue
      : /overdue/i.test(statusText) || requested === "overdue"
        ? true
        : undefined;

  const isFailed =
    explicitFailed !== undefined
      ? explicitFailed
      : /fail/i.test(statusText) || /cancel/i.test(statusText) || requested === "failed" || failureReason !== ""
        ? true
        : undefined;

  const isOos =
    explicitOos !== undefined
      ? explicitOos
      : /oos|out.?of.?stock/i.test(statusText)
        ? true
        : undefined;

  return {
    ...row,
    id: normalizeId(pickField(row, ["id", "order_id", "orderId"], "")),
    order_id: pickString(row, ["order_id", "orderId", "id"]),
    order_number: pickString(row, [
      "order_number",
      "order_no",
      "number",
      "invoice_no",
      "ref_no",
      "reference_number",
      "po_number",
      "order_code"
    ]),
    customer_id:
      pickString(row, ["customer_id", "customerId"]) ||
      pickString(customer, ["id", "customer_id", "customerId"]),
    customer_name:
      pickString(row, ["customer_name", "company_name", "name"]) ||
      pickString(customer, ["company_name", "customer_name", "name"]),
    customer_type:
      pickString(row, ["customer_type", "type"]) || pickString(customer, ["customer_type", "type"]),
    class_id:
      pickString(row, ["class_id", "rmp_class_id", "classId"]) ||
      pickString(rmpClass, ["id", "class_id", "rmp_class_id"]),
    class_name:
      pickString(row, ["class_name", "rmp_class_name", "class"]) ||
      pickString(rmpClass, ["name", "class_name", "title"]),
    order_date: pickString(row, ["order_date", "date", "created_at", "order_created_at", "placed_at"]),
    qty: pickNumber(row, [
      "qty",
      "quantity",
      "ordered_qty",
      "ordered_quantity",
      "order_qty",
      "total_qty",
      "total_quantity",
      "item_qty"
    ]),
    price: pickNumber(row, ["price", "unit_price", "rate", "mrp", "selling_price", "item_price", "unit_rate"]),
    value: pickNumber(row, [
      "value",
      "order_value",
      "total_amount",
      "amount",
      "total_value",
      "net_amount",
      "sales_value",
      "grand_total"
    ]),
    status,
    report_type: pickString(row, ["report_type", "ReportType"]),
    uniware_reason: failureReason,
    sla_date: pickString(row, ["sla_date", "slaDate", "expected_delivery_date", "due_date"]),
    is_overdue: isOverdue,
    is_failed: isFailed,
    is_oos: isOos
  };
}

export function normalizeOrderTrackingRows(rawRows, requestedReportType) {
  return enrichRowsByOrderId(
    (rawRows ?? []).map((row) => normalizeOrderTrackingRow(row, requestedReportType)),
    ORDER_TRACKING_ENRICH_FIELDS
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Status label.
 *
 * QUIRK REPRODUCED: Scott answers `report_type=failed` with status `CANCELLED` (verified
 * runtime 2026-06-07), so CANCELLED/CANCELED display as **Failed**. All-caps statuses are
 * title-cased (`PROCESSING` -> `Processing`); the normalized `status` field keeps the raw
 * `PROCESSING`. Upstream has a failing test asserting the DISPLAY value is `'PROCESSING'`
 * (spec §10) — reconciled here in favour of the formatter: the display value is `'Processing'`.
 */
export function formatOrderTrackingStatusLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return EMPTY_REPORT_CELL;
  if (/^cancell?ed$/i.test(text)) return "Failed";
  if (/[a-z]/.test(text)) return text; // already mixed case — leave it alone
  return text.replace(/\w\S*/g, (word) => word.charAt(0) + word.slice(1).toLowerCase());
}

/** Order ID cell: order_number -> order_id -> id -> `-`. */
export function resolveOrderTrackingOrderId(row) {
  return (
    pickString(row, ["order_number"]) ||
    pickString(row, ["order_id"]) ||
    pickString(row, ["id"]) ||
    EMPTY_REPORT_CELL
  );
}

/** Client-side OOS filter (the `oos` selection has no server equivalent). */
export function filterOosOrderTrackingRows(rows) {
  return (rows ?? []).filter((row) => row?.is_oos === true);
}

// ---------------------------------------------------------------------------
// Columns — exactly 17 (test-locked upstream)
// ---------------------------------------------------------------------------

/** @type {import('./reportShared').ReportColumnDef[]} */
export const ORDER_TRACKING_COLUMNS = Object.freeze([
  { label: "Order Date", keys: ["order_date"], format: "date" },
  { label: "Order ID", keys: ["order_number", "order_id", "id"], formatValue: resolveOrderTrackingOrderId },
  { label: "Order Number", keys: ["order_number", "order_no"] },
  { label: "Customer ID", keys: ["customer_id"] },
  { label: "Customer Type", keys: ["customer_type"] },
  { label: "Customer Name", keys: ["customer_name"] },
  { label: "Class ID", keys: ["class_id", "rmp_class_id"] },
  { label: "Class", keys: ["class_name", "rmp_class_name"] },
  { label: "Qty", keys: ["qty", "quantity"], format: "number" },
  { label: "Price", keys: ["price"], format: "currency" },
  { label: "Value", keys: ["value"], format: "currency" },
  {
    label: "Status",
    keys: ["status", "report_type"],
    badge: true,
    formatValue: (row) => formatOrderTrackingStatusLabel(pickField(row, ["status", "report_type"]))
  },
  { label: "SLA Date", keys: ["sla_date"], format: "date" },
  { label: "Is Overdue", keys: ["is_overdue"], format: "boolean", type: "text" },
  { label: "Is Failed", keys: ["is_failed"], format: "boolean", type: "text" },
  { label: "Is OOS", keys: ["is_oos"], format: "boolean", type: "text" },
  { label: "Uniware Reason", keys: ["uniware_reason"], truncate: 200 }
]);

/** Field-name list used by the dev field audit. */
export const ORDER_TRACKING_TABLE_COLUMNS = Object.freeze(
  ORDER_TRACKING_COLUMNS.map((column) => column.keys[0])
);

export const ORDER_TRACKING_FILTER_SOURCES = ORDER_TRACKING_COLUMNS;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function buildOrderTrackingQuery(pageParams, filters) {
  const query = { items: pageParams.items, page: pageParams.page };
  if (filters?.report_type) query.report_type = filters.report_type;
  if (filters?.start_date) query.start_date = filters.start_date;
  if (filters?.end_date) query.end_date = filters.end_date;
  return query;
}

export async function fetchOrderTrackingPage(params = {}) {
  const { page = 1, pageSize, items, ...filters } = params ?? {};
  const pageParams = { page: Math.max(1, Number(page) || 1), items: Number(items ?? pageSize ?? 20) };

  const { body } = await callScottDashboard({
    resource: ORDER_TRACKING_RESOURCE,
    method: "GET",
    query: buildOrderTrackingQuery(pageParams, filters)
  });

  const records = extractOrderTrackingRecords(body);
  return {
    data: normalizeOrderTrackingRows(records, filters?.report_type),
    ...extractOrdersPageMeta(body, pageParams, records.length)
  };
}

/** Every page — 100 rows per request, 100 requests max. */
export async function fetchAllOrderTracking(filters = {}) {
  const rows = await fetchAllScottPages(
    (pp) => fetchOrderTrackingPage({ page: pp.page, items: pp.items, ...filters }),
    ORDER_TRACKING_FETCH_ALL
  );
  return enrichRowsByOrderId(rows, ORDER_TRACKING_ENRICH_FIELDS);
}

// ---------------------------------------------------------------------------
// Export + dev audit (no stat cards on this report)
// ---------------------------------------------------------------------------

export const ORDER_TRACKING_EXPORT_HEADERS = Object.freeze(reportExportHeaders(ORDER_TRACKING_COLUMNS));

export function orderTrackingExportFieldMap() {
  return reportExportFieldMap(ORDER_TRACKING_COLUMNS);
}

/** `order-tracking-report-YYYY-MM-DD.csv` */
export const ORDER_TRACKING_EXPORT = buildReportExportConfig(
  ORDER_TRACKING_COLUMNS,
  "order-tracking-report"
);

/**
 * Dev observability: % of rows that render a real value per column.
 * Booleans count only when actually boolean; Order ID counts via `resolveOrderTrackingOrderId`.
 * The live API omits order_number, class_id, sla_date, uniware_reason and all three booleans —
 * a 0% column is expected, not a bug (spec §15.5).
 */
export function auditOrderTrackingFields(rows) {
  const list = rows ?? [];
  const total = list.length;
  const out = {};
  for (const column of ORDER_TRACKING_COLUMNS) {
    const key = column.keys[0];
    const filled = list.filter((row) => {
      if (column.format === "boolean") return typeof row?.[key] === "boolean";
      if (column.label === "Order ID") return resolveOrderTrackingOrderId(row) !== EMPTY_REPORT_CELL;
      const value = pickField(row, column.keys);
      if (value === undefined) return false;
      return typeof value === "number" ? Number.isFinite(value) : String(value).trim() !== "";
    }).length;
    out[column.label] = { filled, total, pct: total ? Math.round((filled / total) * 100) : 0 };
  }
  return out;
}

/** Convenience for stat-less pages that still want a row count + OOS tally. */
export function computeOrderTrackingSummary(rows) {
  const list = rows ?? [];
  return {
    totalCount: list.length,
    oosCount: list.filter((row) => row?.is_oos === true).length,
    failedCount: list.filter((row) => row?.is_failed === true).length,
    overdueCount: list.filter((row) => row?.is_overdue === true).length,
    totalValue: list.reduce((sum, row) => sum + (parseScottNumber(row?.value) ?? 0), 0)
  };
}
