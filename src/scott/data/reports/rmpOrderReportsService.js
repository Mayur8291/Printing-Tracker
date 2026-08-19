// RMP Order Reports — reports spec §8.
//
//   GET {base}/api/dashboard/v1/rmp_order_reports
//   GET {base}/api/dashboard/v1/rmp_order_reports/{id}
//
// Rows are PER-SKU LINE ITEMS: several rows share one `order_id`, and Scott populates the
// order-level fields (customer, dates, status, coordinator) on only one of them. That is why
// the enrich list here is much longer than the Custom Order Reports one.
//
// Like §7, the page sends no server filters — Scott ignores them.

import { buildScottPaginatedMeta, callScottDashboard, extractRecords, normalizeId } from "../../scottClient";
import { fetchAllScottPages } from "../../scottPagination";
import {
  buildReportExportConfig,
  enrichRowsByOrderId,
  formatReportOrderIdCell,
  isIncompleteOrderId,
  mergeNestedPayload,
  nowIsoTimestamp,
  parseScottNumber,
  pickField,
  pickNumber,
  pickString,
  reportExportFieldMap,
  reportExportHeaders,
  sumBy
} from "./reportShared";

export const RMP_ORDER_REPORTS_RESOURCE = "rmp_order_reports";

/** Order-level fields a sibling line item may donate (spec §8). */
export const RMP_ORDER_REPORT_ENRICH_FIELDS = Object.freeze([
  "customer_name",
  "customer_code",
  "customer_type",
  "order_date",
  "status",
  "order_status",
  "order_id",
  "order_number",
  "sales_coordinator",
  "rmp_sku_id",
  "rmp_sku_name"
]);

// ---------------------------------------------------------------------------
// Derived fields
// ---------------------------------------------------------------------------

/**
 * RMP status derivation — note it differs from the Custom Order one: a dispatch date means
 * DISPATCHED (not DELIVERED), and `delivery_required_on` is an accepted PENDING signal.
 * @returns {string}
 */
export function deriveOrderStatus(row) {
  const explicit = pickString(row, ["order_status", "status"]);
  if (explicit) return explicit;
  if (pickField(row, ["dispatch_date", "actual_delivery_date"]) !== undefined) return "DISPATCHED";
  if (pickField(row, ["delivery_required_on", "expected_delivery_date"]) !== undefined) return "PENDING";
  return "";
}

/** Per-piece price: explicit, else `total_amount / quantity` when BOTH are present. */
export function deriveRmpUnitPrice(row) {
  const explicit = pickNumber(row, ["per_piece_amount", "price", "unit_price"]);
  if (explicit !== undefined) return explicit;
  const totalAmount = pickNumber(row, ["total_amount", "amount"]);
  const quantity = pickNumber(row, ["quantity", "total_quantity", "qty"]);
  if (totalAmount === undefined || quantity === undefined || quantity === 0) return undefined;
  return totalAmount / quantity;
}

/** `order_number`, falling back to a NON-truncated `order_id` (never an `OD-P-` stub). */
export function deriveRmpOrderNumber(row) {
  const explicit = pickString(row, [
    "order_number",
    "order_no",
    "jobsheet_number",
    "invoice_no",
    "ref_no",
    "po_number"
  ]);
  if (explicit) return explicit;
  const orderId = pickString(row, ["order_id", "orderId"]);
  return orderId && !isIncompleteOrderId(orderId) ? orderId : "";
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeRmpOrderReport(raw) {
  const row = mergeNestedPayload(raw, ["rmp_order_report", "order_report"]);
  const status = deriveOrderStatus(row);

  return {
    ...row,
    id: normalizeId(pickField(row, ["id", "rmp_order_report_id", "order_id"], "")),
    order_id: pickString(row, ["order_id", "orderId"]),
    order_number: deriveRmpOrderNumber(row),
    customer_name: pickString(row, ["customer_name", "company_name", "name"]),
    customer_code: pickString(row, ["customer_code", "code"]),
    customer_type: pickString(row, ["customer_type", "type"]),
    order_date: pickString(row, ["order_date", "date"]),
    total_amount: pickNumber(row, ["total_amount", "amount"]),
    quantity: pickNumber(row, ["quantity", "total_quantity", "qty"]),
    price: deriveRmpUnitPrice(row),
    status,
    order_status: pickString(row, ["order_status"]) || status,
    sales_coordinator: pickString(row, ["sales_coordinator", "kam", "coordinator_name"]),
    dispatch_date: pickString(row, ["dispatch_date"]),
    delivery_required_on: pickString(row, ["delivery_required_on"]),
    expected_delivery_date: pickString(row, ["expected_delivery_date", "delivery_required_on"]),
    actual_delivery_date: pickString(row, ["actual_delivery_date", "dispatch_date"]),
    rmp_sku_id: pickString(row, ["rmp_sku_id", "sku", "sku_id"]),
    rmp_sku_name: pickString(row, ["rmp_sku_name", "product_name", "sku_name"]),
    created_at: pickField(row, ["created_at"]) ?? nowIsoTimestamp(),
    updated_at: pickField(row, ["updated_at"]) ?? nowIsoTimestamp()
  };
}

export function normalizeRmpOrderReports(rawRows) {
  return enrichRowsByOrderId(
    (rawRows ?? []).map((row) => normalizeRmpOrderReport(row)),
    RMP_ORDER_REPORT_ENRICH_FIELDS
  );
}

// ---------------------------------------------------------------------------
// Columns — 19 (upstream test asserts >= 18)
// ---------------------------------------------------------------------------

const RMP_ORDER_STATUS_OPTIONS = Object.freeze(
  ["DISPATCHED", "PENDING", "COMPLETED"].map((value) => ({ value, label: value }))
);

/** @type {import('./reportShared').ReportColumnDef[]} */
export const RMP_ORDER_REPORT_COLUMNS = Object.freeze([
  { label: "Order ID", keys: ["order_id"], formatValue: formatReportOrderIdCell },
  { label: "Order Number", keys: ["order_number", "order_no", "jobsheet_number", "invoice_no"] },
  { label: "Customer Name", keys: ["customer_name", "company_name"] },
  // `code` / `type` are the flat aliases upstream declares (rmpOrderReportTableConfig.ts);
  // Scott returns them on some payload shapes and only on those aliases.
  { label: "Customer Code", keys: ["customer_code", "code"] },
  { label: "Customer Type", keys: ["customer_type", "type"] },
  { label: "Order Date", keys: ["order_date"], format: "date" },
  { label: "SKU ID", keys: ["rmp_sku_id", "sku", "sku_id"] },
  { label: "SKU Name", keys: ["rmp_sku_name", "product_name", "sku_name"] },
  { label: "Quantity", keys: ["quantity", "total_quantity", "qty"], format: "number" },
  { label: "Unit Price", keys: ["price", "per_piece_amount", "unit_price"], format: "currency" },
  { label: "Total Amount", keys: ["total_amount", "amount"], format: "currency" },
  {
    label: "Order Status",
    keys: ["order_status", "status"],
    badge: true,
    type: "enum",
    options: RMP_ORDER_STATUS_OPTIONS
  },
  { label: "Sales Coordinator", keys: ["sales_coordinator", "kam", "coordinator_name"] },
  // Upstream `rmpOrderReportTableConfig.ts` marks all four dispatch/delivery columns
  // `format: 'date'`; without it they rendered and exported the raw ISO string.
  { label: "Dispatch Date", keys: ["dispatch_date"], format: "date" },
  { label: "Delivery Required On", keys: ["delivery_required_on"], format: "date" },
  { label: "Expected Delivery", keys: ["expected_delivery_date"], format: "date" },
  { label: "Actual Delivery", keys: ["actual_delivery_date"], format: "date" },
  { label: "Created", keys: ["created_at"], format: "date" },
  { label: "Updated", keys: ["updated_at"], format: "date" }
]);

export const RMP_ORDER_REPORT_FILTER_SOURCES = RMP_ORDER_REPORT_COLUMNS;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function buildRmpOrderReportsQuery(pageParams, filters) {
  const query = { items: pageParams.items, page: pageParams.page };
  const search = String(filters?.search ?? "").trim();
  if (search) query.search = search;
  const startDate = filters?.start_date ?? filters?.startDate;
  const endDate = filters?.end_date ?? filters?.endDate;
  if (startDate) query.start_date = startDate;
  if (endDate) query.end_date = endDate;
  if (filters?.status) query.status = filters.status;
  const skuId = filters?.rmp_sku_id ?? filters?.rmpSkuId;
  if (skuId) query.rmp_sku_id = skuId;
  return query;
}

export async function fetchRmpOrderReportsPage(params = {}) {
  const { page = 1, pageSize, items, ...filters } = params ?? {};
  const pageParams = { page: Math.max(1, Number(page) || 1), items: Number(items ?? pageSize ?? 20) };

  const { body } = await callScottDashboard({
    resource: RMP_ORDER_REPORTS_RESOURCE,
    method: "GET",
    query: buildRmpOrderReportsQuery(pageParams, filters)
  });

  const records = extractRecords(body);
  return {
    data: normalizeRmpOrderReports(records),
    ...buildScottPaginatedMeta(body, pageParams, records.length)
  };
}

/** Every page — generic 250-page / 10000-row defaults (spec §15.13). */
export async function fetchRmpOrderReports(filters = {}) {
  const rows = await fetchAllScottPages((pp) =>
    fetchRmpOrderReportsPage({ page: pp.page, items: pp.items, ...filters })
  );
  return enrichRowsByOrderId(rows, RMP_ORDER_REPORT_ENRICH_FIELDS);
}

export async function fetchRmpOrderReportById(id) {
  const rid = normalizeId(id);
  if (!rid) return null;
  const { body } = await callScottDashboard({
    resource: RMP_ORDER_REPORTS_RESOURCE,
    method: "GET",
    pathSuffix: rid
  });
  const raw = body?.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizeRmpOrderReport(raw);
}

// ---------------------------------------------------------------------------
// Stats + export
// ---------------------------------------------------------------------------

/**
 * 3 stat tiles. Total Value falls back to `price × quantity` per row when Scott omits
 * `total_amount` — the sum is per-row, so a mixed dataset still totals correctly.
 * @returns {{totalCount: number, totalQuantity: number, totalValue: number}}
 */
export function computeRmpOrderReportStats(rows) {
  const list = rows ?? [];
  const totalValue = sumBy(list, (row) => {
    const amount = parseScottNumber(row?.total_amount);
    if (amount !== undefined) return amount;
    const price = parseScottNumber(row?.price);
    const quantity = parseScottNumber(row?.quantity);
    if (price === undefined || quantity === undefined) return undefined;
    return price * quantity;
  });
  return { totalCount: list.length, totalQuantity: sumBy(list, "quantity"), totalValue };
}

export const RMP_ORDER_REPORT_STAT_TILES = Object.freeze([
  // COUNT TILE — pagination total, never the drain (see `orderReportsService.js`). This is
  // the 94k-row report whose drain times out; the count is exact from page 1 regardless.
  { key: "totalCount", label: "Total Orders", format: "number", source: "paginationTotal" },
  { key: "totalQuantity", label: "Total Quantity", format: "number" },
  { key: "totalValue", label: "Total Value", format: "currency" }
]);

export const RMP_ORDER_REPORT_EXPORT_HEADERS = Object.freeze(
  reportExportHeaders(RMP_ORDER_REPORT_COLUMNS)
);

export function rmpOrderReportExportFieldMap() {
  return reportExportFieldMap(RMP_ORDER_REPORT_COLUMNS);
}

/** `rmp-order-reports-YYYY-MM-DD.csv` */
export const RMP_ORDER_REPORT_EXPORT = buildReportExportConfig(
  RMP_ORDER_REPORT_COLUMNS,
  "rmp-order-reports"
);
