// Custom Order Reports — reports spec §7.
//
//   GET {base}/api/dashboard/v1/order_reports          (v1 fallback handled by the edge fn)
//   GET {base}/api/dashboard/v1/order_reports/{id}
//
// The Scott `order_reports` list API IGNORES `search` (and every other filter param), so the
// list page sends none of them and ALL filtering/sorting happens client-side over the
// fetched-all dataset. The `filters` argument here exists only because the endpoint documents
// the params — pass them and Scott will quietly return the unfiltered list.
//
// Two derived fields carry real logic:
//   * `total_amount` — Scott often omits it; it is rebuilt from the cost breakdown.
//   * `status`       — Scott often omits it; it is inferred from the delivery dates.

import { buildScottPaginatedMeta, callScottDashboard, extractRecords, normalizeId } from "../../scottClient";
import { fetchAllScottPages } from "../../scottPagination";
import {
  buildReportExportConfig,
  enrichRowsByOrderId,
  formatReportOrderIdCell,
  formatReportPercent,
  mergeNestedPayload,
  nowIsoTimestamp,
  pickField,
  pickNumber,
  pickString,
  reportExportFieldMap,
  reportExportHeaders,
  sumBy
} from "./reportShared";

export const ORDER_REPORTS_RESOURCE = "order_reports";

/** Cross-filled per page: Scott populates these on one line per order only (spec §15.2). */
export const ORDER_REPORT_ENRICH_FIELDS = Object.freeze([
  "customer_name",
  "customer_code",
  "order_date",
  "status"
]);

// ---------------------------------------------------------------------------
// Derived fields
// ---------------------------------------------------------------------------

const UNIT_COST_KEYS = Object.freeze([
  "fabric_rate",
  "trims_cost",
  "overhead",
  "add_on_cost",
  "branding_cost"
]);

/**
 * Order amount, direct or derived.
 *
 * Direct: `total_amount | amount | grand_total`.
 * Derived: `(fabric_rate + trims_cost + overhead + add_on_cost + branding_cost) × quantity`,
 * quantity from `total_quantity | quantity | qty` (default 1).
 *
 * Returns `undefined` when the unit cost sums to 0 or less — an order with no cost breakdown
 * must show `-`, not `₹0.00`.
 *
 * @param {Record<string, unknown>} row
 * @returns {number|undefined}
 */
export function computeCustomOrderAmount(row) {
  const direct = pickNumber(row, ["total_amount", "amount", "grand_total"]);
  if (direct !== undefined) return direct;

  let unitCost = 0;
  for (const key of UNIT_COST_KEYS) {
    const value = pickNumber(row, [key]);
    if (value !== undefined) unitCost += value;
  }
  if (unitCost <= 0) return undefined;

  const quantity = pickNumber(row, ["total_quantity", "quantity", "qty"]) ?? 1;
  return unitCost * quantity;
}

/**
 * Order status, explicit or inferred from the delivery timeline.
 * Explicit `order_status | status`; else DELIVERED when an actual delivery date exists;
 * else PENDING when an expected delivery date exists; else `''`.
 * @returns {string}
 */
export function deriveOrderStatus(row) {
  const explicit = pickString(row, ["order_status", "status"]);
  if (explicit) return explicit;
  if (pickField(row, ["actual_delivery_date"]) !== undefined) return "DELIVERED";
  if (pickField(row, ["expected_delivery_date"]) !== undefined) return "PENDING";
  return "";
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * API row -> UI row. Every raw field is spread through first, so the 48-column table can read
 * raw keys (`kam`, `factory`, `total_of`, `cogs`, `gst_amount`, `rating`, reviews, …) that the
 * normalizer never names explicitly.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeOrderReport(raw) {
  const row = mergeNestedPayload(raw, ["order_report"]);

  const totalAmount = computeCustomOrderAmount(row);
  const status = deriveOrderStatus(row);

  return {
    ...row,
    id: normalizeId(pickField(row, ["id", "order_report_id", "order_id"], "")),
    order_id: pickString(row, ["order_id", "orderId"]),
    order_number: pickString(row, ["order_number", "jobsheet_number", "order_no", "number"]),
    customer_name: pickString(row, ["customer_name", "company_name", "name"]),
    customer_code: pickString(row, ["customer_code", "code"]),
    product: pickString(row, ["product", "description"]),
    order_date: pickString(row, ["order_date", "date"]),
    total_amount: totalAmount,
    status,
    order_type: pickString(row, ["order_type", "item_type"]),
    created_at: pickField(row, ["created_at"]) ?? nowIsoTimestamp(),
    updated_at: pickField(row, ["updated_at"]) ?? nowIsoTimestamp()
  };
}

/** Normalize a page of rows, then cross-fill parent fields between sibling line items. */
export function normalizeOrderReports(rawRows) {
  return enrichRowsByOrderId(
    (rawRows ?? []).map((row) => normalizeOrderReport(row)),
    ORDER_REPORT_ENRICH_FIELDS
  );
}

// ---------------------------------------------------------------------------
// Columns — exactly 48, in wire order (test-locked upstream)
// ---------------------------------------------------------------------------

const ORDER_STATUS_OPTIONS = Object.freeze(
  ["COMPLETED", "PENDING", "DISPATCHED", "CANCELLED", "active", "inactive"].map((value) => ({
    value,
    label: value
  }))
);

const ITEM_TYPE_OPTIONS = Object.freeze(
  ["custom", "readymade", "RMP"].map((value) => ({ value, label: value }))
);

/** @type {import('./reportShared').ReportColumnDef[]} */
export const ORDER_REPORT_COLUMNS = Object.freeze([
  { label: "Jobsheet Number", keys: ["jobsheet_number", "order_number"] },
  { label: "Order Date", keys: ["order_date"], format: "date" },
  { label: "Order ID", keys: ["order_id"], formatValue: formatReportOrderIdCell },
  // Upstream `orderReportTableConfig.ts` marks BOTH delivery columns `format: 'date'`;
  // without it the cell (and the CSV) printed the raw `…T00:00:00.000Z` API string and the
  // column sorted as text. Restored to match.
  { label: "Expected Delivery Date", keys: ["expected_delivery_date"], format: "date" },
  { label: "Actual Delivery Date", keys: ["actual_delivery_date"], format: "date" },
  { label: "Key Account Manager (KAM)", keys: ["kam"] },
  {
    label: "Order Status",
    keys: ["order_status", "status"],
    badge: true,
    type: "enum",
    options: ORDER_STATUS_OPTIONS
  },
  { label: "Customer Name", keys: ["customer_name"] },
  { label: "Product", keys: ["product"] },
  { label: "Description", keys: ["description"], truncate: 220 },
  { label: "Factory", keys: ["factory"] },
  { label: "Total Quantity", keys: ["total_quantity"], format: "number" },
  { label: "Size Breakup", keys: ["size_breakup"], truncate: 220 },
  { label: "Base OF", keys: ["base_of"], format: "number" },
  { label: "Base SN", keys: ["base_sn"], format: "number" },
  { label: "Add-on OF", keys: ["add_on_of"], format: "number" },
  { label: "Add-on SN", keys: ["add_on_sn"], format: "number" },
  { label: "Total OF", keys: ["total_of"], format: "number" },
  { label: "Total SN", keys: ["total_sn"], format: "number" },
  { label: "Total Stitching Cost", keys: ["total_stitching_cost"], format: "currency" },
  { label: "Add-on Cost", keys: ["add_on_cost"], format: "currency" },
  { label: "Total Add-on Cost", keys: ["total_add_on_cost"], format: "currency" },
  { label: "Fabric Consumption", keys: ["fabric_consumption"] },
  { label: "Fabric Used (Kgs)", keys: ["fabric_used_kgs", "fabric_used"], format: "number" },
  { label: "Fabric Rate", keys: ["fabric_rate"], format: "currency" },
  { label: "Fabric Cost", keys: ["fabric_cost"], format: "currency" },
  {
    label: "Trims Cost/Pc",
    keys: ["trims_cost_pc", "trims_cost_per_pc", "trims_cost"],
    format: "currency"
  },
  { label: "Total Trims Cost", keys: ["total_trims_cost"], format: "currency" },
  { label: "Total Material Cost", keys: ["total_material_cost"], format: "currency" },
  { label: "Total Cost", keys: ["total_cost", "total_amount"], format: "currency" },
  { label: "Overhead", keys: ["overhead"], format: "currency" },
  { label: "C.O.G.S", keys: ["cogs"], format: "currency" },
  {
    label: "Margin %",
    keys: ["margin_percentage"],
    format: "percent",
    formatValue: (row) => formatReportPercent(pickField(row, ["margin_percentage"]))
  },
  {
    label: "Sales Value (Ex Taxes)",
    keys: ["sales_value_ex_taxes", "sales_value"],
    format: "currency"
  },
  { label: "SP", keys: ["sp"], format: "currency" },
  { label: "Branding Cost", keys: ["branding_cost"], format: "currency" },
  {
    label: "Total Sales (including Branding)",
    keys: ["total_sales_including_branding", "total_sales"],
    format: "currency"
  },
  {
    label: "GST%",
    keys: ["gst_percent", "gst_rate", "gst_percentage"],
    format: "percent",
    formatValue: (row) => formatReportPercent(pickField(row, ["gst_percent", "gst_rate", "gst_percentage"]))
  },
  { label: "GST Amount", keys: ["gst_amount"], format: "currency" },
  { label: "Total Sales (Including GST)", keys: ["total_sales_including_gst"], format: "currency" },
  { label: "Item Type", keys: ["item_type", "order_type"], type: "enum", options: ITEM_TYPE_OPTIONS },
  { label: "Rmp Category", keys: ["rmp_category"], relation: true, type: "text" },
  { label: "Rmp Class", keys: ["rmp_class"], relation: true, type: "text" },
  { label: "Rmp Brand", keys: ["rmp_brand"], relation: true, type: "text" },
  { label: "Created By", keys: ["created_by"] },
  { label: "Rating", keys: ["rating"] },
  { label: "Customer Positive Review", keys: ["customer_positive_review"], truncate: 220 },
  { label: "Customer Negative Review", keys: ["customer_negative_review"], truncate: 220 }
]);

/** Filter descriptors for `src/scott/list/filterEngine.js` (`buildReportFilterColumns` shape). */
export const ORDER_REPORT_FILTER_SOURCES = ORDER_REPORT_COLUMNS;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Optional server filters. Scott ignores them today (see file header) — they are built anyway
 * so switching them on later is a one-line change in the page.
 * @param {{search?: string, startDate?: string, endDate?: string, start_date?: string, end_date?: string, status?: string}} [filters]
 */
export function buildOrderReportsQuery(pageParams, filters) {
  const query = { items: pageParams.items, page: pageParams.page };
  const search = String(filters?.search ?? "").trim();
  if (search) query.search = search;
  const startDate = filters?.start_date ?? filters?.startDate;
  const endDate = filters?.end_date ?? filters?.endDate;
  if (startDate) query.start_date = startDate;
  if (endDate) query.end_date = endDate;
  if (filters?.status) query.status = filters.status;
  return query;
}

/**
 * One server page.
 * @returns {Promise<{data: object[], page: number, pageSize: number, totalCount: number, totalPages: number, totalCountIsExact: boolean}>}
 */
export async function fetchOrderReportsPage(params = {}) {
  const { page = 1, pageSize, items, ...filters } = params ?? {};
  const pageParams = { page: Math.max(1, Number(page) || 1), items: Number(items ?? pageSize ?? 20) };

  const { body } = await callScottDashboard({
    resource: ORDER_REPORTS_RESOURCE,
    method: "GET",
    query: buildOrderReportsQuery(pageParams, filters)
  });

  const records = extractRecords(body);
  return {
    data: normalizeOrderReports(records),
    ...buildScottPaginatedMeta(body, pageParams, records.length)
  };
}

/**
 * Every page. No options passed => the generic 250-page / 10000-row defaults from
 * `scottPagination.js` (spec §15.13).
 * @returns {Promise<object[]>}
 */
export async function fetchOrderReports(filters = {}) {
  const rows = await fetchAllScottPages((pp) =>
    fetchOrderReportsPage({ page: pp.page, items: pp.items, ...filters })
  );
  // Re-run the cross-fill over the WHOLE set: siblings can land on different pages.
  return enrichRowsByOrderId(rows, ORDER_REPORT_ENRICH_FIELDS);
}

/** GET order_reports/{id} — the detail page reads `body.data`. */
export async function fetchOrderReportById(id) {
  const rid = normalizeId(id);
  if (!rid) return null;
  const { body } = await callScottDashboard({
    resource: ORDER_REPORTS_RESOURCE,
    method: "GET",
    pathSuffix: rid
  });
  const raw = body?.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizeOrderReport(raw);
}

// ---------------------------------------------------------------------------
// Stats + export
// ---------------------------------------------------------------------------

/**
 * 2 stat tiles: Total Orders, Total Amount.
 * Computed client-side over the FULL unfiltered dataset, never from the current page.
 * @param {object[]} rows
 * @returns {{totalCount: number, totalAmount: number}}
 */
export function computeOrderReportStats(rows) {
  const list = rows ?? [];
  return { totalCount: list.length, totalAmount: sumBy(list, "total_amount") };
}

export const ORDER_REPORT_STAT_TILES = Object.freeze([
  // COUNT TILE: reads the LIST's pagination total (`source: "paginationTotal"`), exactly as
  // upstream did (`OrderReportsPage.tsx` -> `useSortedScottList`). It must NEVER need the
  // full-dataset drain: on a six-figure report the drain can time out, and a count that is
  // already exact on page 1 would then read "Summary unavailable".
  { key: "totalCount", label: "Total Orders", format: "number", source: "paginationTotal" },
  { key: "totalAmount", label: "Total Amount", format: "currency" }
]);

/** 48 export headers = the 48 column labels, in table order. */
export const ORDER_REPORT_EXPORT_HEADERS = Object.freeze(reportExportHeaders(ORDER_REPORT_COLUMNS));

export function orderReportExportFieldMap() {
  return reportExportFieldMap(ORDER_REPORT_COLUMNS);
}

/** `custom-order-reports-YYYY-MM-DD.csv` */
export const ORDER_REPORT_EXPORT = buildReportExportConfig(ORDER_REPORT_COLUMNS, "custom-order-reports");
