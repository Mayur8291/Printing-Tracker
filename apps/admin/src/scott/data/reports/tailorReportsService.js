// Tailor Reports — reports spec §9.
//
//   GET {base}/api/dashboard/v1/tailor_reports
//   GET {base}/api/dashboard/v1/tailor_reports/{id}    <- body.data, sometimes wrapped again
//
// Two things make this report different from every other one:
//
//   1. SHELL ROWS. Scott pre-creates a jobsheet row before a tailor is assigned, so a large
//      share of rows come back with `tailor_name: ""`, `total_quantity: 0`, `order_date: ""`.
//      They are real records, not errors — `auditTailorReportFields` counts them separately.
//   2. NO INVENTED TIMESTAMPS. Unlike §7/§8 this normalizer must NOT default created_at /
//      updated_at to `new Date()`: shell rows are expected to keep them `undefined`
//      (test-locked upstream). Dates also arrive as `DD/MM/YYYY` / `DD/MM/YYYY hh:mmAM`.

import { buildScottPaginatedMeta, callScottDashboard, extractRecords, normalizeId } from "../../scottClient";
import { fetchAllScottPages } from "../../scottPagination";
import {
  buildReportExportConfig,
  isPlainObject,
  mergeNestedPayload,
  parseScottNumber,
  pickField,
  pickNumber,
  pickString,
  reportExportFieldMap,
  reportExportHeaders,
  sumBy
} from "./reportShared";

export const TAILOR_REPORTS_RESOURCE = "tailor_reports";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeTailorReport(raw) {
  const row = mergeNestedPayload(raw, ["tailor_report", "tailorReport"]);

  const orderNumber = pickString(row, ["jobsheet_number", "order_number", "order_no"]);
  const totalQuantity = pickNumber(row, ["total_quantity", "items_count", "quantity", "qty"]);
  const totalAmount = pickNumber(row, ["total_amount", "total_value", "amount"]);
  const paymentStatus = pickString(row, ["payment_status", "status"]);
  const orderDate = pickString(row, ["order_date"]);
  const updatedOn = pickString(row, ["updated_on", "updated_at"]);

  return {
    ...row,
    id: normalizeId(pickField(row, ["id", "tailor_report_id"], "")),
    jobsheet_number: pickString(row, ["jobsheet_number"]) || orderNumber,
    order_number: orderNumber,
    tailor_name: pickString(row, ["tailor_name"]),
    order_date: orderDate,
    base_of: pickNumber(row, ["base_of"]),
    base_sn: pickNumber(row, ["base_sn"]),
    add_on_of: pickNumber(row, ["add_on_of"]),
    add_on_sn: pickNumber(row, ["add_on_sn"]),
    of_rate: pickNumber(row, ["of_rate"]),
    sn_rate: pickNumber(row, ["sn_rate"]),
    size_breakup: pickString(row, ["size_breakup"]),
    total_quantity: totalQuantity,
    of_amount: pickNumber(row, ["of_amount"]),
    sn_amount: pickNumber(row, ["sn_amount"]),
    total_amount: totalAmount,
    chotu: pickString(row, ["chotu"]),
    picking_date_time: pickString(row, ["picking_date_time"]),
    week_number: pickNumber(row, ["week_number"]),
    updated_on: updatedOn,
    payment_status: paymentStatus,
    airtable_order_report_id: pickString(row, ["airtable_order_report_id"]),
    airtable_tailor_report_id: pickString(row, ["airtable_tailor_report_id"]),

    // Legacy aliases kept so older column/filter configs keep resolving.
    items_count: totalQuantity,
    total_value: totalAmount,
    status: paymentStatus,

    // Deliberately possibly-undefined: see the file header.
    created_at: orderDate || updatedOn || undefined,
    updated_at: updatedOn || undefined
  };
}

export function normalizeTailorReports(rawRows) {
  return (rawRows ?? []).map((row) => normalizeTailorReport(row));
}

// ---------------------------------------------------------------------------
// Columns — exactly 18 (test-locked upstream)
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_OPTIONS = Object.freeze(
  ["Pending", "Paid", "Partial"].map((value) => ({ value, label: value }))
);

/** @type {import('./reportShared').ReportColumnDef[]} */
export const TAILOR_REPORT_COLUMNS = Object.freeze([
  { label: "Jobsheet Number", keys: ["order_number", "jobsheet_number"] },
  { label: "Tailor Name", keys: ["tailor_name"] },
  { label: "Order Date", keys: ["order_date", "created_at"], format: "date" },
  { label: "Total Quantity", keys: ["total_quantity", "items_count"], format: "number" },
  { label: "Base OF", keys: ["base_of"], format: "number" },
  { label: "Base SN", keys: ["base_sn"], format: "number" },
  { label: "Add-on OF", keys: ["add_on_of"], format: "number" },
  { label: "Add-on SN", keys: ["add_on_sn"], format: "number" },
  { label: "OF Rate", keys: ["of_rate"], format: "currency" },
  { label: "SN Rate", keys: ["sn_rate"], format: "currency" },
  { label: "OF Amount", keys: ["of_amount"], format: "currency" },
  { label: "SN Amount", keys: ["sn_amount"], format: "currency" },
  { label: "Total Amount", keys: ["total_amount", "total_value"], format: "currency" },
  { label: "Size Breakup", keys: ["size_breakup"] },
  {
    label: "Payment Status",
    keys: ["payment_status", "status"],
    badge: true,
    type: "enum",
    options: PAYMENT_STATUS_OPTIONS
  },
  { label: "Picking Date", keys: ["picking_date_time"], format: "date" },
  { label: "Updated On", keys: ["updated_on", "updated_at"], format: "date" },
  { label: "Week Number", keys: ["week_number"], format: "number" }
]);

export const TAILOR_REPORT_FILTER_SOURCES = TAILOR_REPORT_COLUMNS;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function buildTailorReportsQuery(pageParams, filters) {
  const query = { items: pageParams.items, page: pageParams.page };
  const search = String(filters?.search ?? "").trim();
  if (search) query.search = search;
  const startDate = filters?.start_date ?? filters?.startDate;
  const endDate = filters?.end_date ?? filters?.endDate;
  if (startDate) query.start_date = startDate;
  if (endDate) query.end_date = endDate;
  if (filters?.status) query.status = filters.status;
  const tailorId = filters?.tailor_id ?? filters?.tailorId;
  if (tailorId) query.tailor_id = tailorId;
  return query;
}

export async function fetchTailorReportsPage(params = {}) {
  const { page = 1, pageSize, items, ...filters } = params ?? {};
  const pageParams = { page: Math.max(1, Number(page) || 1), items: Number(items ?? pageSize ?? 20) };

  const { body } = await callScottDashboard({
    resource: TAILOR_REPORTS_RESOURCE,
    method: "GET",
    query: buildTailorReportsQuery(pageParams, filters)
  });

  const records = extractRecords(body);
  return {
    data: normalizeTailorReports(records),
    ...buildScottPaginatedMeta(body, pageParams, records.length)
  };
}

/** Every page — generic 250-page / 10000-row defaults (spec §15.13). */
export async function fetchTailorReports(filters = {}) {
  return fetchAllScottPages((pp) =>
    fetchTailorReportsPage({ page: pp.page, items: pp.items, ...filters })
  );
}

/**
 * Detail show response -> the record.
 * Scott returns `{ data: {...} }` for this endpoint, but SOMETIMES nests one level deeper
 * as `{ data: { tailor_report: {...} } }`. Both shapes must unwrap to the same row.
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
export function extractTailorReportDetail(body) {
  const data = isPlainObject(body) ? body.data : null;
  if (!isPlainObject(data)) return null;
  if (isPlainObject(data.tailor_report)) return data.tailor_report;
  if (isPlainObject(data.tailorReport)) return data.tailorReport;
  return data;
}

/** GET tailor_reports/{id}. */
export async function fetchTailorReportById(id) {
  const rid = normalizeId(id);
  if (!rid) return null;
  const { body } = await callScottDashboard({
    resource: TAILOR_REPORTS_RESOURCE,
    method: "GET",
    pathSuffix: rid
  });
  const raw = extractTailorReportDetail(body);
  return raw ? normalizeTailorReport(raw) : null;
}

// ---------------------------------------------------------------------------
// Stats + export + dev audit
// ---------------------------------------------------------------------------

/**
 * 3 stat tiles. The `?? legacy` fallbacks matter: rows normalized by an older build (or
 * fetched from a differently-shaped endpoint) carry `items_count` / `total_value` instead.
 * @returns {{totalCount: number, totalItems: number, totalValue: number}}
 */
export function computeTailorReportStats(rows) {
  const list = rows ?? [];
  const totalItems = sumBy(list, (row) =>
    parseScottNumber(row?.total_quantity) ?? parseScottNumber(row?.items_count)
  );
  const totalValue = sumBy(list, (row) =>
    parseScottNumber(row?.total_amount) ?? parseScottNumber(row?.total_value)
  );
  return { totalCount: list.length, totalItems, totalValue };
}

export const TAILOR_REPORT_STAT_TILES = Object.freeze([
  // COUNT TILE — pagination total, never the drain (see `orderReportsService.js`).
  { key: "totalCount", label: "Total Records", format: "number", source: "paginationTotal" },
  { key: "totalItems", label: "Total Items", format: "number" },
  { key: "totalValue", label: "Total Value", format: "currency" }
]);

/** Fields the fill-rate audit reports on (numeric 0 counts as UNFILLED here). */
export const TAILOR_AUDIT_FIELDS = Object.freeze([
  "jobsheet_number",
  "tailor_name",
  "order_date",
  "total_quantity",
  "total_amount",
  "base_of",
  "base_sn",
  "size_breakup",
  "picking_date_time",
  "payment_status"
]);

function isFilledAuditValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  return String(value).trim() !== "";
}

/**
 * Dev observability: per-field fill rates plus the shell/assigned split.
 * A row is "assigned" when tailor_name OR total_quantity OR total_amount is filled;
 * everything else is a jobsheet placeholder Scott created ahead of the work.
 * Pure — the caller decides whether to log it.
 */
export function auditTailorReportFields(rows) {
  const list = rows ?? [];
  const total = list.length;
  const fields = {};
  for (const field of TAILOR_AUDIT_FIELDS) {
    const filled = list.filter((row) => isFilledAuditValue(row?.[field])).length;
    fields[field] = { filled, total, pct: total ? Math.round((filled / total) * 100) : 0 };
  }
  const assigned = list.filter(
    (row) =>
      isFilledAuditValue(row?.tailor_name) ||
      isFilledAuditValue(row?.total_quantity) ||
      isFilledAuditValue(row?.total_amount)
  ).length;
  return { total, assigned, shells: total - assigned, fields };
}

export const TAILOR_REPORT_EXPORT_HEADERS = Object.freeze(reportExportHeaders(TAILOR_REPORT_COLUMNS));

export function tailorReportExportFieldMap() {
  return reportExportFieldMap(TAILOR_REPORT_COLUMNS);
}

/** `tailor-reports-YYYY-MM-DD.csv` */
export const TAILOR_REPORT_EXPORT = buildReportExportConfig(TAILOR_REPORT_COLUMNS, "tailor-reports");
