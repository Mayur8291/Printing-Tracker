// Per-report call conventions, in one place.
//
// Every report service takes its filters slightly differently — `fetchAllTotalInventory`
// wants `(filters, daysInPeriod)` positionally, the breakdown endpoints are unpaginated,
// Order Tracking's `oos` type has no server flag, RMP Sales' customer filter is documented
// as client-side. Rather than smear those exceptions through the components, each one is
// encoded ONCE below and every report ends up exposing the same three things:
//
//   apiFilters   what actually goes on the wire (also the drain cache key)
//   fetchPage    `useScottList`-shaped `{page, items, search} -> ScottPaginatedResult`
//   fetchAll     the whole dataset for stats + CSV export
//
// Reports whose filtering cannot happen on the server (`oos`, RMP Sales customers, the
// unpaginated breakdown tabs) get a `fetchPage` that drains and slices locally, which is
// exactly what `totalInventoryService` already does upstream. That keeps `useScottList`
// untouched: it still just calls `fetchPage`, and the pagination meta stays exact.

import { getMastersService } from "@/scott/data/masterConfigs";
import {
  buildOrderTrackingApiFilters,
  filterOosOrderTrackingRows
} from "@/scott/data/reports/orderTrackingService";
import {
  buildRmpSalesApiFilters,
  filterOrdersByCustomers,
  toBreakdownRows
} from "@/scott/data/reports/rmpSalesService";
import {
  buildTotalInventoryApiFilters,
  fetchAllTotalInventory,
  inventoryDaysInPeriod
} from "@/scott/data/reports/totalInventoryService";

// ---------------------------------------------------------------------------
// Drain cache
// ---------------------------------------------------------------------------
//
// A fetch-all report calls `fetchAll` twice on first paint — once for the rows, once for
// the stat tiles — and export calls it a third time. Sharing the in-flight promise for
// 30 s collapses those into ONE upstream request without any component coordination.

const DRAIN_TTL_MS = 30_000;
/** @type {Map<string, {at: number, promise: Promise<object[]>}>} */
const drainCache = new Map();

/**
 * Drop every cached drain — call before a manual Refresh so it actually refetches.
 *
 * The memoised RMP brand/class masters (`mastersCache`, below) are cleared with it: they
 * have no TTL, so without this a brand renamed in Masters would keep its old breakdown
 * label — in the table AND in the CSV — until a full page reload.
 */
export function resetReportDrainCache() {
  drainCache.clear();
  mastersCache.clear();
}

function cachedDrain(cacheKey, run) {
  const hit = drainCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DRAIN_TTL_MS) return hit.promise;

  const promise = Promise.resolve()
    .then(run)
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch((error) => {
      drainCache.delete(cacheKey); // never cache a rejection
      throw error;
    });

  drainCache.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

// ---------------------------------------------------------------------------
// RMP masters, for the breakdown labels
// ---------------------------------------------------------------------------
//
// The aggregate `brand_orders` / `class_orders` endpoints frequently return ids WITHOUT
// `brand_name`/`class_name`, and the entity column is the sticky-left column of the table
// and the first column of the CSV. Upstream loads all RMP brands/classes
// (`useAllRmpBrands`/`useAllRmpClasses`) and maps id -> master name before falling back to
// `-` (spec §11 / `RmpSalesReportPage.tsx`). Without them the whole column can read `-`.
//
// Cached for the lifetime of the tab and NEVER allowed to reject: a masters outage must
// degrade the labels to `-`, exactly as before, not break the report.

/** @type {Map<string, Promise<Array<object>>>} */
const mastersCache = new Map();

export function resetReportMastersCache() {
  mastersCache.clear();
}

function loadBreakdownMasters(masterKey) {
  const hit = mastersCache.get(masterKey);
  if (hit) return hit;

  const promise = Promise.resolve()
    .then(() => getMastersService(masterKey).listAll())
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => {
      mastersCache.delete(masterKey); // never cache a rejection
      return [];
    });

  mastersCache.set(masterKey, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Client-side pagination (for the reports the server cannot page)
// ---------------------------------------------------------------------------

function sliceResult(rows, page, pageSize) {
  const list = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, Number(pageSize) || 20);
  const current = Math.max(1, Number(page) || 1);
  const start = (current - 1) * size;
  return {
    data: list.slice(start, start + size),
    page: current,
    pageSize: size,
    totalCount: list.length,
    totalPages: Math.max(1, Math.ceil(list.length / size)),
    totalCountIsExact: true
  };
}

// ---------------------------------------------------------------------------
// RMP Sales Overview: the Status fallback
// ---------------------------------------------------------------------------
//
// Spec §11 (and `RmpSalesReportPage.tsx`) render the Status badge as
// `row.status || applied reportType` — upstream NEVER reads `row.report_type` and never
// rewrites `row.status`. The fallback therefore lives in the COLUMN, not in the rows:
// `buildRmpSalesOverviewColumns(appliedReportType)` (registry `buildColumns`) and
// `overviewExportFieldMap(appliedReportType)` are handed the same applied filter value by
// `ReportView`, so the table cell and the CSV cell are identical by construction — including
// with `reportType: "all"`, where Scott may echo a per-order `report_type` the UI must ignore.
//
// (An earlier attempt stamped `report_type` onto rows instead; it left rows that carried
// their own `report_type` drifting between table and CSV, and diverged from upstream.)

// ---------------------------------------------------------------------------
// Per-report API filters
// ---------------------------------------------------------------------------

/**
 * Report-level filter state -> query params.
 *
 * Custom Order / RMP Order / Tailor send NOTHING: the Scott list APIs for those three
 * ignore every filter param (registry note), so their `filters` array is empty and search
 * plus advanced filters run client-side over the drained dataset.
 *
 * @param {object} report registry descriptor
 * @param {object} values current filter values, keyed by filter field
 * @returns {Record<string, unknown>}
 */
export function buildReportApiFilters(report, values) {
  const v = values ?? {};
  // Escape hatch for descriptors assembled outside the registry (Customer Performance,
  // whose two-period comparison does not fit any of the shapes below).
  if (typeof report?.buildApiFilters === "function") return report.buildApiFilters(v) ?? {};

  switch (report?.key) {
    case "order_tracking":
      return buildOrderTrackingApiFilters({ reportType: v.reportType, period: v.period });

    case "rmp_sales":
      return buildRmpSalesApiFilters({
        reportType: v.reportType,
        period: v.period,
        customerIds: v.customerIds
      });

    case "total_inventory":
      return buildTotalInventoryApiFilters(v.period);

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {object} args.report registry descriptor
 * @param {object} [args.tab] active tab descriptor (RMP Sales only)
 * @param {object} [args.values] report-level filter values
 * @returns {{
 *   cacheKey: string,
 *   apiFilters: Record<string, unknown>,
 *   serverPaged: boolean,
 *   fetchPage: (args: {page?: number, items?: number, search?: string}) => Promise<object>,
 *   fetchAll: () => Promise<object[]>
 * }}
 */
export function buildReportRequest({ report, tab, values }) {
  const reportKey = String(report?.key ?? "");
  const tabKey = String(tab?.key ?? "");
  const service = tab?.service ?? report?.service ?? {};
  const apiFilters = buildReportApiFilters(report, values);
  const cacheKey = `${reportKey}|${tabKey}|${JSON.stringify(apiFilters)}`;

  // --- the drain, with every per-report post-processing step applied -------
  const drain = () =>
    cachedDrain(cacheKey, async () => {
      if (reportKey === "total_inventory") {
        // Positional `(filters, daysInPeriod)` — DRR/cover use the fixed trailing 90-day
        // demand window; this selected-period length still drives the OOS sales-loss metric.
        return fetchAllTotalInventory(apiFilters, inventoryDaysInPeriod(values?.period));
      }

      if (typeof service.fetchAll !== "function") return [];
      const rows = await service.fetchAll(apiFilters);

      if (reportKey === "order_tracking" && String(values?.reportType ?? "") === "oos") {
        // `oos` is not a server report_type — it is a predicate over the full dataset.
        return filterOosOrderTrackingRows(rows);
      }

      if (reportKey === "rmp_sales") {
        // Breakdown rows MAY arrive with `brand_name`/`class_name`; when they carry only the
        // id, the RMP masters supply the name. The table and the CSV both read `label`,
        // which `toBreakdownRows` attaches.
        if (tabKey === "brand") {
          return toBreakdownRows(rows, {
            idField: "brand_id",
            nameField: "brand_name",
            masters: await loadBreakdownMasters("rmp_brands")
          });
        }
        if (tabKey === "class") {
          return toBreakdownRows(rows, {
            idField: "class_id",
            nameField: "class_name",
            masters: await loadBreakdownMasters("rmp_classes")
          });
        }
        if (tabKey === "coordinator") {
          return toBreakdownRows(rows, { idField: "user_id", nameField: "coordinator_name" });
        }
        // Overview: the customer filter is client-side and authoritative (spec §15.8).
        return filterOrdersByCustomers(rows, values?.customerIds);
      }

      return rows;
    });

  // --- does the server actually page this view? ----------------------------
  const oosSelected = reportKey === "order_tracking" && String(values?.reportType ?? "") === "oos";
  const customerFiltered =
    reportKey === "rmp_sales" && tabKey === "overview" && (values?.customerIds?.length ?? 0) > 0;
  const unpaginatedTab = Boolean(tab) && tab.paginated === false;
  const serverPaged =
    typeof service.fetchPage === "function" && !oosSelected && !customerFiltered && !unpaginatedTab;

  const fetchPage = async ({ page = 1, items = 20, search = "" } = {}) => {
    if (!serverPaged) {
      return sliceResult(await drain(), page, items);
    }
    const params = { page, items, ...apiFilters };
    // Only three report endpoints read `search`; the rest drop unknown params. Sending it
    // when empty would add a useless `search=` to every request.
    if (String(search ?? "").trim()) params.search = String(search).trim();
    if (reportKey === "total_inventory") params.daysInPeriod = inventoryDaysInPeriod(values?.period);

    return service.fetchPage(params);
  };

  return { cacheKey, apiFilters, serverPaged, fetchPage, fetchAll: drain };
}

export default buildReportRequest;
