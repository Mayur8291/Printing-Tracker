// Total Inventory Report — reports spec §13. The ONLY report that POSTs.
//
//   POST {base}/api/v1/ready_made_products/get_inventory     (multipart FormData)
//   body: optional start_date / end_date, DD-MM-YYYY
//
// There is NO dashboard-namespace fallback for this path and NO server pagination: one call
// returns the whole catalogue, the normalized rows are cached in-module for 30 s keyed by the
// filter JSON, and paging is done client-side with exact totals.
//
// Response shapes tolerated, in order of how often they show up:
//   1. { success: true, data: { inventory: [ { sku, stock } ] } }        <- the live shape
//   2. rows with flat metric fields (drr, days_of_cover, sales_loss…)     <- pre-computed
//   3. rows with a `warehouses[]` breakdown                               <- per-WH quantities
//   4. rmp_skus CATALOG rows carrying `rmp_prices[]` and no stock at all  <- see the guards
//
// Shape 4 is the trap: it looks like a successful inventory response but has no inventory in
// it. `rowHasInventoryMetrics` / `isScottSkuCatalogOnlyResponse` exist to detect it so the UI
// can say "Scott returned a SKU catalogue, not inventory" instead of rendering a wall of zeros.

import { buildScottPaginatedMeta, callScottDashboard, extractRecords } from "../../scottClient";
import { fetchAllScottPages } from "../../scottPagination";
import {
  buildReportExportConfig,
  buildScottDateParams,
  daysInPeriod as periodDays,
  enrichRowsByOrderId,
  isPlainObject,
  monthRange,
  parseScottNumber,
  pickField,
  pickNumber,
  pickString,
  reportExportFieldMap,
  reportExportHeaders,
  resolveReportPeriodRange
} from "./reportShared";
import {
  RMP_ORDER_REPORTS_RESOURCE,
  buildRmpOrderReportsQuery,
  normalizeRmpOrderReport
} from "./rmpOrderReportsService";
import {
  buildInventoryDrrWindow,
  buildOrderQuantityBySku,
  enrichInventoryWithOrderDemand,
  enrichInventoryWithQuantityMap
} from "./inventoryDemand";

export { buildInventoryDrrWindow, enrichInventoryWithOrderDemand } from "./inventoryDemand";

export const TOTAL_INVENTORY_RESOURCE = "ready_made_products";
export const TOTAL_INVENTORY_PATH_SUFFIX = "get_inventory";

/** Vite injects `import.meta.env`; guarded so this module also loads under plain node. */
const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

/** Feature flag — only an explicit `'false'` disables the live call. */
export const INVENTORY_REPORT_API_ENABLED = ENV.VITE_INVENTORY_REPORT_API_ENABLED !== "false";

/** Optional warehouse names for the per-WH split. Client-side only — never sent to Scott. */
export const WH1_NAME = String(ENV.VITE_INVENTORY_REPORT_WH1_NAME ?? "").trim();
export const WH2_NAME = String(ENV.VITE_INVENTORY_REPORT_WH2_NAME ?? "").trim();

/** Below this many days of cover a SKU counts as out of stock. */
export const OOS_DAYS_OF_COVER_THRESHOLD = 3;

/** Sales-window length the DRR is derived over. */
export const DRR_WINDOW_DAYS = 90;

/** Default period: `month` mode, the CURRENT month (not the year-back default of §10/§11). */
export function createDefaultInventoryPeriod() {
  const now = new Date();
  const { startDate, endDate } = monthRange(now.getFullYear(), now.getMonth() + 1);
  return {
    mode: "month",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    // `date` mode remembers a 3-months-back start so switching modes keeps a sane range.
    startDate: threeMonthsBackIso(now),
    endDate,
    resolvedStartDate: startDate
  };
}

function threeMonthsBackIso(from) {
  const d = new Date(from.getFullYear(), from.getMonth() - 3, from.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Period config -> `{ start_date, end_date }` in DD-MM-YYYY (both optional upstream). */
export function buildTotalInventoryApiFilters(period) {
  return buildScottDateParams(period ?? createDefaultInventoryPeriod());
}

/** Inclusive day count of the applied period — the sales-loss multiplier. */
export function inventoryDaysInPeriod(period) {
  return periodDays(period ?? createDefaultInventoryPeriod());
}

export function resolveInventoryPeriodRange(config) {
  return resolveReportPeriodRange(config);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const WAREHOUSE_LIST_KEYS = Object.freeze([
  "warehouses",
  "Warehouses",
  "warehouse_inventories",
  "warehouse_stocks",
  "warehouse_details"
]);

const WAREHOUSE_QTY_KEYS = Object.freeze([
  "qty",
  "quantity",
  "available_qty",
  "available_quantity",
  "stock",
  "inventory",
  "total_quantity",
  "current_inventory"
]);

const WAREHOUSE_NAME_KEYS = Object.freeze(["warehouse_name", "name", "warehouse", "title", "label"]);

const INVENTORY_KEYS = Object.freeze([
  "inventory",
  "total_inventory",
  "total_qty",
  "total_stock",
  "current_inventory",
  "available_inventory",
  "stock_qty",
  "stock",
  "quantity",
  "qty"
]);

const DRR_KEYS = Object.freeze(["drr", "daily_run_rate", "daily_rate"]);
const DAYS_OF_COVER_KEYS = Object.freeze(["days_of_cover", "daysOfCover", "doc", "cover_days"]);
const SALES_LOSS_KEYS = Object.freeze([
  "sales_loss_due_to_oos",
  "salesLossDueToOos",
  "sales_loss",
  "oos_sales_loss",
  "lost_sales_value"
]);
const THREE_MONTH_SALES_KEYS = Object.freeze([
  "three_month_sales",
  "three_months_sales",
  "sales_qty_90d",
  "sales_90d",
  "three_month_qty",
  "avg_sales_90d",
  "last_90_days_sales",
  "sales_quantity_90_days"
]);

/** Price-type preference for the catalogue join, in order. */
export const RMP_PRICE_TYPE_PREFERENCE = Object.freeze(["Regular", "End Customer", "Distributor"]);

/**
 * Price from an `rmp_prices[]` catalogue join.
 *
 * Preference order is by the NESTED `rmp_price_type.name`: Regular -> End Customer ->
 * Distributor; if none of those match, the first entry carrying a numeric price wins.
 * String prices (`"135.0"`) are accepted — Scott returns decimals as strings here.
 *
 * @param {Record<string, unknown>} row
 * @returns {number|undefined}
 */
export function pickPriceFromRmpPrices(row) {
  const entries = collectRmpPrices(row);
  if (entries.length === 0) return undefined;

  for (const preferred of RMP_PRICE_TYPE_PREFERENCE) {
    for (const entry of entries) {
      const typeName =
        pickString(entry?.rmp_price_type, ["name"]) ||
        pickString(entry, ["rmp_price_type_name", "price_type_name", "price_type"]);
      if (typeName.toLowerCase() !== preferred.toLowerCase()) continue;
      const price = readRmpPriceValue(entry);
      if (price !== undefined) return price;
    }
  }

  for (const entry of entries) {
    const price = readRmpPriceValue(entry);
    if (price !== undefined) return price;
  }
  return undefined;
}

function readRmpPriceValue(entry) {
  return pickNumber(entry, ["price", "amount", "value", "rate", "mrp", "selling_price"]);
}

/** `rmp_prices[]` on the row, or on any one nested object (Scott nests it under the SKU). */
function collectRmpPrices(row) {
  if (!isPlainObject(row)) return [];
  if (Array.isArray(row.rmp_prices)) return row.rmp_prices.filter(isPlainObject);
  if (Array.isArray(row.prices)) return row.prices.filter(isPlainObject);
  for (const value of Object.values(row)) {
    if (isPlainObject(value) && Array.isArray(value.rmp_prices)) {
      return value.rmp_prices.filter(isPlainObject);
    }
  }
  return [];
}

/**
 * Per-warehouse quantities.
 * Direct `wh1_qty`-style fields first; otherwise the named warehouse entries are matched
 * against the configured WH names. With no names configured, both stay undefined and the
 * caller falls back to the total (or the sum of every warehouse).
 * @returns {{wh1_qty: number|undefined, wh2_qty: number|undefined, warehouses: object[]}}
 */
export function resolveWarehouseQuantities(row) {
  const direct1 = pickNumber(row, [
    "wh1_qty",
    "wh1Qty",
    "warehouse_1_qty",
    "warehouse1_qty",
    "first_warehouse_qty"
  ]);
  const direct2 = pickNumber(row, [
    "wh2_qty",
    "wh2Qty",
    "warehouse_2_qty",
    "warehouse2_qty",
    "second_warehouse_qty"
  ]);

  const warehouses = findWarehouseList(row);
  if (direct1 !== undefined || direct2 !== undefined) {
    return { wh1_qty: direct1, wh2_qty: direct2, warehouses };
  }

  const matchByName = (name) => {
    if (!name) return undefined;
    const entry = warehouses.find(
      (item) => pickString(item, WAREHOUSE_NAME_KEYS).toLowerCase() === name.toLowerCase()
    );
    return entry ? pickNumber(entry, WAREHOUSE_QTY_KEYS) : undefined;
  };

  return { wh1_qty: matchByName(WH1_NAME), wh2_qty: matchByName(WH2_NAME), warehouses };
}

function findWarehouseList(row) {
  if (!isPlainObject(row)) return [];
  for (const key of WAREHOUSE_LIST_KEYS) {
    if (Array.isArray(row[key])) return row[key].filter(isPlainObject);
  }
  return [];
}

/** Sum of every warehouse entry — the last resort before defaulting inventory to 0. */
export function sumAllWarehouseQuantities(warehouses) {
  let total = 0;
  let seen = false;
  for (const entry of warehouses ?? []) {
    const qty = pickNumber(entry, WAREHOUSE_QTY_KEYS);
    if (qty === undefined) continue;
    total += qty;
    seen = true;
  }
  return seen ? total : undefined;
}

/**
 * API row -> `TotalInventoryRawRow` (pre-metrics).
 * @param {Record<string, unknown>} raw
 */
export function normalizeTotalInventoryRow(raw) {
  const row = isPlainObject(raw) ? raw : {};
  const { wh1_qty, wh2_qty, warehouses } = resolveWarehouseQuantities(row);

  const id =
    pickString(row, ["id", "sku_id", "rmp_sku_id", "inventory_report_id"]) ||
    pickString(row, ["sku", "sku_code"]);
  const sku =
    pickString(row, ["sku", "sku_code", "rmp_sku_name", "rmp_sku_code", "name", "product_name"]) || id;

  const direct = pickNumber(row, INVENTORY_KEYS);
  let inventory = direct;
  if (inventory === undefined && (wh1_qty !== undefined || wh2_qty !== undefined)) {
    inventory = (wh1_qty ?? 0) + (wh2_qty ?? 0);
  }
  if (inventory === undefined) inventory = sumAllWarehouseQuantities(warehouses);
  if (inventory === undefined) inventory = 0;

  const price =
    pickNumber(row, ["price", "unit_price", "mrp", "selling_price", "rate", "rmp_price", "product_price"]) ??
    pickPriceFromRmpPrices(row);

  const apiStatus = pickString(row, ["status", "stock_status", "inventory_status"]);

  return {
    ...row,
    id: id || sku,
    sku,
    wh1_qty,
    wh2_qty,
    inventory,
    price,
    three_month_sales: pickNumber(row, THREE_MONTH_SALES_KEYS),
    sales_qty_90d: pickNumber(row, ["sales_qty_90d", "sales_90d", "last_90_days_sales"]),
    drr: pickNumber(row, DRR_KEYS),
    drr_value: pickNumber(row, ["drr_value", "drrValue", "daily_run_rate_value"]),
    days_of_cover: pickNumber(row, DAYS_OF_COVER_KEYS),
    sales_loss_due_to_oos: pickNumber(row, SALES_LOSS_KEYS),
    // Left undefined (not "In Stock") when Scott says nothing: the metrics step decides.
    status: apiStatus || (inventory === 0 ? "Out of Stock" : undefined)
  };
}

const INVENTORY_METRIC_KEYS = Object.freeze([
  ...INVENTORY_KEYS,
  ...DRR_KEYS,
  ...DAYS_OF_COVER_KEYS,
  ...SALES_LOSS_KEYS,
  ...THREE_MONTH_SALES_KEYS,
  "wh1_qty",
  "wh2_qty",
  "warehouse_1_qty",
  "warehouse_2_qty",
  ...WAREHOUSE_LIST_KEYS
]);

/** Does this RAW row carry anything inventory-shaped at all? */
export function rowHasInventoryMetrics(row) {
  if (!isPlainObject(row)) return false;
  return INVENTORY_METRIC_KEYS.some((key) => row[key] !== undefined && row[key] !== null);
}

/**
 * True when Scott answered with a bare SKU CATALOGUE (rmp_skus-style rows, often with
 * `rmp_prices[]`) instead of inventory. Non-empty response, zero inventory signals.
 */
export function isScottSkuCatalogOnlyResponse(rawRows) {
  const list = rawRows ?? [];
  if (list.length === 0) return false;
  return !list.some((row) => rowHasInventoryMetrics(row));
}

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

function normalizeStatusLabel(status) {
  const text = String(status ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (/out.?of.?stock|^oos$/.test(text)) return "Out of Stock";
  if (/in.?stock/.test(text)) return "In Stock";
  return undefined;
}

/**
 * Raw row + period length -> the computed row the table renders.
 *
 *   drr           = API drr (when >= 0) else round((three_month_sales / 90) * 10) / 10
 *   drrValue      = API drr_value else drr × price          (0 when either is missing)
 *   daysOfCover   = API value else inventory / drr          (null when drr is 0)
 *   status        = API status else Out of Stock when daysOfCover < 3
 *   salesLoss     = API value else drrValue × daysInPeriod when OOS, else 0
 *
 * `daysOfCover === null` (no sales at all) is NOT treated as "< 3": a SKU nobody buys is in
 * stock, not out of it.
 *
 * @param {Record<string, unknown>} raw normalized raw row
 * @param {number} [daysInPeriod] inclusive days in the applied period
 */
export function computeInventoryReportMetrics(raw, daysInPeriod = 30) {
  const row = isPlainObject(raw) ? raw : {};

  const wh1 = parseScottNumber(row.wh1_qty);
  const wh2 = parseScottNumber(row.wh2_qty);
  const inventory =
    parseScottNumber(row.inventory) ?? (wh1 !== undefined || wh2 !== undefined ? (wh1 ?? 0) + (wh2 ?? 0) : 0);

  const apiDrr = parseScottNumber(row.drr);
  const threeMonthSales = parseScottNumber(row.three_month_sales) ?? parseScottNumber(row.sales_qty_90d);
  const drr =
    apiDrr !== undefined && apiDrr >= 0
      ? apiDrr
      : threeMonthSales !== undefined && threeMonthSales > 0
        ? threeMonthSales / DRR_WINDOW_DAYS
        : 0;

  const price = parseScottNumber(row.price);
  const apiDrrValue = parseScottNumber(row.drr_value);
  const drrValue = apiDrrValue !== undefined ? apiDrrValue : drr && price !== undefined ? drr * price : 0;

  const apiDaysOfCover = parseScottNumber(row.days_of_cover);
  const daysOfCover = apiDaysOfCover !== undefined ? apiDaysOfCover : drr > 0 ? inventory / drr : null;

  const status =
    normalizeStatusLabel(row.status) ??
    (daysOfCover !== null && daysOfCover < OOS_DAYS_OF_COVER_THRESHOLD ? "Out of Stock" : "In Stock");

  const apiSalesLoss = parseScottNumber(row.sales_loss_due_to_oos);
  const salesLossDueToOos =
    apiSalesLoss !== undefined ? apiSalesLoss : status === "Out of Stock" ? drrValue * (daysInPeriod || 1) : 0;

  return {
    id: String(row.id ?? row.sku ?? ""),
    sku: String(row.sku ?? row.id ?? ""),
    wh1_qty: wh1,
    wh2_qty: wh2,
    inventory,
    price,
    three_month_sales: threeMonthSales,
    drr,
    drrValue,
    daysOfCover,
    status,
    salesLossDueToOos
  };
}

/** Normalize + compute in one pass; `id` falls back to the row index. */
export function toTotalInventoryRows(rawRows, daysInPeriod = 30) {
  return (rawRows ?? []).map((raw, index) => {
    const normalized = normalizeTotalInventoryRow(raw);
    const computed = computeInventoryReportMetrics(normalized, daysInPeriod);
    return { ...computed, id: computed.id || String(index) };
  });
}

/** `12.3` / `-`; cover is undefined when the row has no positive demand rate. */
export function formatDaysOfCover(value, drr) {
  const rate = parseScottNumber(drr);
  if (drr !== undefined && (rate === undefined || rate <= 0)) return "-";
  const num = parseScottNumber(value);
  if (num === undefined || value === null) return "-";
  return num.toFixed(1);
}

/** Up to two decimal places / `-` (a DRR of 0 or less is not a rate). */
export function formatDrr(value) {
  const num = parseScottNumber(value);
  if (num === undefined || num <= 0) return "-";
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Transport (POST + 30 s cache + client-side paging)
// ---------------------------------------------------------------------------

/** DEV-only stand-in used when the feature flag is off. Prod serves an empty list. */
export const MOCK_INVENTORY_RAW_ROWS = Object.freeze([
  { sku: "classica-bl-m", stock: 100, three_month_sales: 180, price: 450 },
  { sku: "classica-bl-l", stock: 4, three_month_sales: 270, price: 450 },
  { sku: "golfer-by-xl", stock: 0, three_month_sales: 90, price: 620 }
]);

const inventoryFetchCache = new Map();
const INVENTORY_CACHE_TTL_MS = 30 * 1000;
const demandFetchCache = new Map();
const DEMAND_CACHE_TTL_MS = 5 * 60 * 1000;
export const INVENTORY_DEMAND_READY_EVENT = "scott:inventory-demand-ready";
const INVENTORY_DEMAND_ORDER_FIELDS = Object.freeze([
  "order_date",
  "status",
  "order_status",
  "order_id",
  "order_number",
  "dispatch_date",
  "actual_delivery_date"
]);

export function resetInventoryFetchCache() {
  inventoryFetchCache.clear();
  demandFetchCache.clear();
}

export function inventoryRowsNeedDemand(rows) {
  return (rows ?? []).some(
    (row) =>
      (row?.drr === undefined || row?.drr === null) &&
      (row?.three_month_sales === undefined || row?.three_month_sales === null) &&
      (row?.sales_qty_90d === undefined || row?.sales_qty_90d === null)
  );
}

function demandCacheKey(window) {
  return `${window.startDate}|${window.endDate}`;
}

/** Return a completed, fresh demand map without waiting for an in-flight drain. */
export function getCachedInventoryDemand(window) {
  const cached = demandFetchCache.get(demandCacheKey(window));
  if (!cached || Date.now() - cached.at >= DEMAND_CACHE_TTL_MS) return null;
  return cached.value instanceof Map ? cached.value : null;
}

function announceInventoryDemandReady(key) {
  // The service also loads under SSR/test runners, where `window` does not exist.
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(INVENTORY_DEMAND_READY_EVENT, { detail: { key } }));
}

async function fetchInventoryDemand(window) {
  const key = demandCacheKey(window);
  const cached = demandFetchCache.get(key);
  if (cached && Date.now() - cached.at < DEMAND_CACHE_TTL_MS) return cached.promise;

  const filters = { start_date: window.start_date, end_date: window.end_date };
  const promise = fetchAllScottPages(
    async ({ page, items }) => {
      const { body } = await callScottDashboard({
        resource: RMP_ORDER_REPORTS_RESOURCE,
        method: "GET",
        query: buildRmpOrderReportsQuery({ page, items }, filters)
      });
      const records = extractRecords(body);
      return {
        data: records.map((record) => normalizeRmpOrderReport(record)),
        ...buildScottPaginatedMeta(body, { page, items }, records.length)
      };
    },
    // Ten-thousand-row pages are heavy. Serializing them avoids exhausting the Edge
    // Function's compute pool while still finishing the ~95k-row history in about ten calls.
    { concurrency: 1 }
  )
    // Order-level date/status fields may be present on only one sibling line. SKU fields are
    // deliberately not donated: each line's own SKU is essential to an accurate DRR join.
    .then((rows) => enrichRowsByOrderId(rows, INVENTORY_DEMAND_ORDER_FIELDS))
    .then((rows) => buildOrderQuantityBySku(rows, window))
    .then((quantityBySku) => {
      const entry = demandFetchCache.get(key);
      if (entry?.promise === promise) entry.value = quantityBySku;
      // Initial inventory rows may already be cached without DRR. Drop only that short cache;
      // the completed demand map stays hot for the automatic refresh and later visits.
      inventoryFetchCache.clear();
      announceInventoryDemandReady(key);
      return quantityBySku;
    })
    .catch((error) => {
      demandFetchCache.delete(key);
      throw error;
    });

  demandFetchCache.set(key, { at: Date.now(), promise, value: null });
  return promise;
}

/** Start the expensive order drain without holding up the inventory endpoint. */
function preloadInventoryDemand(window) {
  void fetchInventoryDemand(window).catch((error) => {
    console.warn("[total-inventory] DRR demand data is unavailable; stock remains usable.", error);
  });
}

/**
 * Every inventory row for the applied filters (one POST, cached 30 s).
 * @param {{start_date?: string, end_date?: string}} [filters]
 * @param {number} [daysInPeriod]
 * @returns {Promise<object[]>}
 */
export async function fetchAllTotalInventory(filters = {}, daysInPeriod = 30) {
  const cacheKey = `${JSON.stringify(filters ?? {})}|${daysInPeriod}`;
  const cached = inventoryFetchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < INVENTORY_CACHE_TTL_MS) return cached.promise;

  const promise = (async () => {
    if (!INVENTORY_REPORT_API_ENABLED) {
      return ENV.DEV ? toTotalInventoryRows(MOCK_INVENTORY_RAW_ROWS, daysInPeriod) : [];
    }

    const body = {};
    if (filters?.start_date) body.start_date = filters.start_date;
    if (filters?.end_date) body.end_date = filters.end_date;

    const drrWindow = buildInventoryDrrWindow(filters?.end_date);
    // Fetch stock before starting the very large order drain. Launching both together lets
    // the multi-page demand requests monopolize the connection pool and delays this snapshot.
    const response = await callScottDashboard({
      resource: TOTAL_INVENTORY_RESOURCE,
      method: "POST",
      pathSuffix: TOTAL_INVENTORY_PATH_SUFFIX,
      body
    });
    const records = extractRecords(response.body);
    if (isScottSkuCatalogOnlyResponse(records)) {
      console.warn(
        "[total-inventory] Scott returned SKU catalogue rows with no inventory metrics — " +
          "check that get_inventory is enabled for this environment."
      );
    }
    const normalized = records.map((record) => normalizeTotalInventoryRow(record));
    if (inventoryRowsNeedDemand(normalized)) preloadInventoryDemand(drrWindow);
    const quantityBySku = getCachedInventoryDemand(drrWindow);
    const enriched = quantityBySku ? enrichInventoryWithQuantityMap(normalized, quantityBySku) : normalized;
    return enriched.map((row, index) => {
      const computed = computeInventoryReportMetrics(row, daysInPeriod);
      return { ...computed, id: computed.id || String(index) };
    });
  })().catch((error) => {
    inventoryFetchCache.delete(cacheKey);
    throw error;
  });

  inventoryFetchCache.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

export function paginateRows(rows, page, pageSize) {
  const list = rows ?? [];
  const size = Math.max(1, Number(pageSize) || 20);
  const current = Math.max(1, Number(page) || 1);
  const start = (current - 1) * size;
  return list.slice(start, start + size);
}

/** Exact client-side pagination meta (there is no server pagination on this endpoint). */
export function buildClientPaginatedMeta(rows, page, pageSize) {
  const list = rows ?? [];
  const size = Math.max(1, Number(pageSize) || 20);
  const current = Math.max(1, Number(page) || 1);
  return {
    page: current,
    pageSize: size,
    totalCount: list.length,
    totalPages: Math.max(1, Math.ceil(list.length / size)),
    totalCountIsExact: true
  };
}

/** One "page" — fetch-all then slice. */
export async function fetchTotalInventoryPage(params = {}) {
  const { page = 1, pageSize = 20, items, daysInPeriod = 30, ...filters } = params ?? {};
  const size = Number(items ?? pageSize ?? 20);
  const rows = await fetchAllTotalInventory(filters, daysInPeriod);
  return { data: paginateRows(rows, page, size), ...buildClientPaginatedMeta(rows, page, size) };
}

/** Informational helpers the page surfaces as banners. */
export function isInventoryReportApiPending() {
  return !INVENTORY_REPORT_API_ENABLED;
}

export function isWhConfigPending() {
  return WH1_NAME === "" && WH2_NAME === "";
}

// ---------------------------------------------------------------------------
// Columns + export
// ---------------------------------------------------------------------------

const STOCK_STATUS_OPTIONS = Object.freeze([
  { value: "In Stock", label: "In Stock" },
  { value: "Out of Stock", label: "Out of Stock" }
]);

/** @type {import('./reportShared').ReportColumnDef[]} */
export const TOTAL_INVENTORY_TABLE_COLUMNS = Object.freeze([
  { label: "SKU", keys: ["sku"] },
  { label: "Inventory", keys: ["inventory"], format: "number" },
  { label: "DRR", keys: ["drr"], format: "number", formatValue: (row) => formatDrr(row?.drr) },
  {
    label: "Days of Cover",
    keys: ["daysOfCover"],
    format: "number",
    formatValue: (row) => formatDaysOfCover(row?.daysOfCover, row?.drr)
  },
  {
    label: "Status",
    keys: ["status"],
    badge: true,
    type: "enum",
    options: STOCK_STATUS_OPTIONS,
    tones: { "out of stock": "destructive" }
  }
]);

export const TOTAL_INVENTORY_FILTER_SOURCES = TOTAL_INVENTORY_TABLE_COLUMNS;

/** Export mirrors the five visible report columns. */
export const TOTAL_INVENTORY_EXPORT_HEADERS = Object.freeze(
  reportExportHeaders(TOTAL_INVENTORY_TABLE_COLUMNS)
);

/**
 * The richer 7-column set the upstream export used to have. Spec §13 records a STALE upstream
 * test still asserting 7 headers against the slimmed 3-column component; reconciled here by
 * keeping the visible set as the shipped export and exposing value/loss fields separately.
 */
export const TOTAL_INVENTORY_EXTENDED_COLUMNS = Object.freeze([
  ...TOTAL_INVENTORY_TABLE_COLUMNS,
  { label: "DRR Value", keys: ["drrValue"], format: "currency" },
  { label: "Sales Loss Due to OOS", keys: ["salesLossDueToOos"], format: "currency" }
]);

export const TOTAL_INVENTORY_EXTENDED_EXPORT_HEADERS = Object.freeze(
  reportExportHeaders(TOTAL_INVENTORY_EXTENDED_COLUMNS)
);

export function totalInventoryExportFieldMap() {
  return reportExportFieldMap(TOTAL_INVENTORY_TABLE_COLUMNS);
}

export function totalInventoryExtendedExportFieldMap() {
  return reportExportFieldMap(TOTAL_INVENTORY_EXTENDED_COLUMNS);
}

/** `total-inventory-report-YYYY-MM-DD.csv` */
export const TOTAL_INVENTORY_EXPORT = buildReportExportConfig(
  TOTAL_INVENTORY_TABLE_COLUMNS,
  "total-inventory-report"
);

/** Stat tiles are not part of the shipped page; these are the aggregates a caller can show. */
export function computeTotalInventoryStats(rows) {
  const list = rows ?? [];
  const outOfStock = list.filter((row) => row?.status === "Out of Stock").length;
  return {
    totalCount: list.length,
    totalUnits: list.reduce((sum, row) => sum + (parseScottNumber(row?.inventory) ?? 0), 0),
    outOfStockCount: outOfStock,
    salesLoss: list.reduce((sum, row) => sum + (parseScottNumber(row?.salesLossDueToOos) ?? 0), 0)
  };
}

/** Dev audit: fill % for sku/inventory/status (a `-` sku and 0 non-inventory numbers count unfilled). */
export function auditInventoryReportFields(rows) {
  const list = rows ?? [];
  const total = list.length;
  const count = (predicate) => list.filter(predicate).length;
  return {
    total,
    sku: count((row) => String(row?.sku ?? "").trim() !== "" && row?.sku !== "-"),
    inventory: count((row) => pickField(row, ["inventory"]) !== undefined),
    status: count((row) => String(row?.status ?? "").trim() !== "")
  };
}
