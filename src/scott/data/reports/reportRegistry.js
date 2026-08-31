// Report registry — one descriptor per Scott report, consumed by the Reports UI.
//
// This is to reports what `masterConfigs.*.js` is to masters: the UI reads a descriptor and
// renders the page (filters -> table -> stat tiles -> export) without knowing which service it
// is talking to. Everything report-specific lives in the service modules; this file only wires
// them together.
//
// Descriptor shape:
//   key            internal id, used for routing + state
//   label/group    left-rail grouping and heading
//   module         source path (documentation, and the only thing a placeholder entry carries)
//   implemented    false => the entry is a stub owned elsewhere; `service` is null
//   resource       Scott resource the service talks to
//   pageSize       default server page size
//   fetchAll       per-endpoint drain caps ({pageSize, maxPages}) — undefined = generic 250/10000
//   service        { fetchPage, fetchAll, fetchById? } live function refs
//   filters        REPORT-LEVEL controls (report-type select, period picker, customer picker)
//   columns        table column defs (also drive CSV formatting and client sort)
//   filterColumns  column-derived advanced/quick filter descriptors (filterEngine shape)
//   stats          { tiles, compute } — compute runs over the FULL dataset, never a page
//   export         { entityName, headers, fieldMap(), filename() }
//   tabs           only for multi-tab reports (RMP Sales)

import { buildReportFilterColumns } from "../../list/filterEngine";

import {
  ORDER_REPORT_COLUMNS,
  ORDER_REPORT_EXPORT_HEADERS,
  ORDER_REPORT_STAT_TILES,
  ORDER_REPORTS_RESOURCE,
  computeOrderReportStats,
  fetchOrderReportById,
  fetchOrderReports,
  fetchOrderReportsPage,
  orderReportExportFieldMap
} from "./orderReportsService";

import {
  RMP_ORDER_REPORT_COLUMNS,
  RMP_ORDER_REPORT_EXPORT_HEADERS,
  RMP_ORDER_REPORT_STAT_TILES,
  RMP_ORDER_REPORTS_RESOURCE,
  computeRmpOrderReportStats,
  fetchRmpOrderReportById,
  fetchRmpOrderReports,
  fetchRmpOrderReportsPage,
  rmpOrderReportExportFieldMap
} from "./rmpOrderReportsService";

import {
  TAILOR_REPORT_COLUMNS,
  TAILOR_REPORT_EXPORT_HEADERS,
  TAILOR_REPORT_STAT_TILES,
  TAILOR_REPORTS_RESOURCE,
  computeTailorReportStats,
  fetchTailorReportById,
  fetchTailorReports,
  fetchTailorReportsPage,
  tailorReportExportFieldMap
} from "./tailorReportsService";

import {
  ORDER_TRACKING_COLUMNS,
  ORDER_TRACKING_EXPORT_HEADERS,
  ORDER_TRACKING_FETCH_ALL,
  ORDER_TRACKING_REPORT_TYPE_OPTIONS,
  ORDER_TRACKING_RESOURCE,
  createDefaultOrderTrackingPeriod,
  createDefaultOrderTrackingReportType,
  fetchAllOrderTracking,
  fetchOrderTrackingPage,
  orderTrackingExportFieldMap
} from "./orderTrackingService";

import {
  COORDINATOR_EXPORT_HEADERS,
  RMP_SALES_EXPORT_NAMES,
  RMP_SALES_FETCH_ALL,
  RMP_SALES_OVERVIEW_COLUMNS,
  RMP_SALES_OVERVIEW_EXPORT_HEADERS,
  RMP_SALES_REPORT_TYPE_OPTIONS,
  RMP_SALES_RESOURCE,
  RMP_SALES_TABS,
  breakdownExportFieldMap,
  buildBreakdownExportHeaders,
  buildRmpBreakdownTableColumns,
  buildRmpCoordinatorTableColumns,
  buildRmpSalesOverviewColumns,
  computeRmpBrandStats,
  computeRmpClassStats,
  computeRmpCoordinatorStats,
  computeRmpSalesOverviewStats,
  coordinatorExportFieldMap,
  createDefaultPeriodConfig,
  createDefaultRmpSalesReportType,
  fetchBrandOrders,
  fetchClassOrders,
  fetchRmpOrders,
  fetchRmpOrdersPage,
  fetchScOrders,
  getRmpSalesFilterColumnsForTab,
  overviewExportFieldMap
} from "./rmpSalesService";

import {
  TOTAL_INVENTORY_EXPORT_HEADERS,
  TOTAL_INVENTORY_RESOURCE,
  TOTAL_INVENTORY_TABLE_COLUMNS,
  computeTotalInventoryStats,
  createDefaultInventoryPeriod,
  fetchAllTotalInventory,
  fetchTotalInventoryPage,
  totalInventoryExportFieldMap
} from "./totalInventoryService";

import { generateExportFilename } from "./reportShared";

/** Left-rail groups, in display order. */
export const REPORT_GROUPS = Object.freeze(["Orders", "Sales", "Production", "Inventory", "Customers"]);

const PERIOD_FILTER = Object.freeze({
  key: "period",
  type: "period",
  label: "Period",
  modes: ["date", "week", "month", "year"]
});

/** @type {ReadonlyArray<Record<string, unknown>>} */
export const REPORT_REGISTRY = Object.freeze([
  {
    key: "order_reports",
    label: "Custom Order Reports",
    group: "Orders",
    description: "Job-sheet level custom order costing, 48 columns.",
    module: "src/scott/data/reports/orderReportsService.js",
    implemented: true,
    resource: ORDER_REPORTS_RESOURCE,
    pageSize: 20,
    fetchAll: undefined, // generic 250 pages x 10000 rows
    detailRoute: true,
    service: {
      fetchPage: fetchOrderReportsPage,
      fetchAll: fetchOrderReports,
      fetchById: fetchOrderReportById
    },
    // The Scott order_reports list API ignores every filter param, so there are no
    // report-level server controls: search + filters are client-side over the full dataset.
    filters: [],
    columns: ORDER_REPORT_COLUMNS,
    filterColumns: buildReportFilterColumns(ORDER_REPORT_COLUMNS),
    stats: { tiles: ORDER_REPORT_STAT_TILES, compute: computeOrderReportStats },
    export: {
      entityName: "custom-order-reports",
      headers: ORDER_REPORT_EXPORT_HEADERS,
      fieldMap: orderReportExportFieldMap,
      filename: () => generateExportFilename("custom-order-reports")
    }
  },

  {
    key: "rmp_order_reports",
    label: "RMP Order Reports",
    group: "Orders",
    description: "Ready-made product orders, one row per SKU line item.",
    module: "src/scott/data/reports/rmpOrderReportsService.js",
    implemented: true,
    resource: RMP_ORDER_REPORTS_RESOURCE,
    pageSize: 20,
    fetchAll: undefined,
    detailRoute: true,
    service: {
      fetchPage: fetchRmpOrderReportsPage,
      fetchAll: fetchRmpOrderReports,
      fetchById: fetchRmpOrderReportById
    },
    filters: [],
    columns: RMP_ORDER_REPORT_COLUMNS,
    filterColumns: buildReportFilterColumns(RMP_ORDER_REPORT_COLUMNS),
    stats: { tiles: RMP_ORDER_REPORT_STAT_TILES, compute: computeRmpOrderReportStats },
    export: {
      entityName: "rmp-order-reports",
      headers: RMP_ORDER_REPORT_EXPORT_HEADERS,
      fieldMap: rmpOrderReportExportFieldMap,
      filename: () => generateExportFilename("rmp-order-reports")
    }
  },

  {
    key: "tailor_reports",
    label: "Tailor Reports",
    group: "Production",
    description: "Per-jobsheet tailor payouts; shell rows are unassigned jobsheets.",
    module: "src/scott/data/reports/tailorReportsService.js",
    implemented: true,
    resource: TAILOR_REPORTS_RESOURCE,
    pageSize: 20,
    fetchAll: undefined,
    detailRoute: true,
    service: {
      fetchPage: fetchTailorReportsPage,
      fetchAll: fetchTailorReports,
      fetchById: fetchTailorReportById
    },
    filters: [],
    columns: TAILOR_REPORT_COLUMNS,
    filterColumns: buildReportFilterColumns(TAILOR_REPORT_COLUMNS),
    stats: { tiles: TAILOR_REPORT_STAT_TILES, compute: computeTailorReportStats },
    export: {
      entityName: "tailor-reports",
      headers: TAILOR_REPORT_EXPORT_HEADERS,
      fieldMap: tailorReportExportFieldMap,
      filename: () => generateExportFilename("tailor-reports")
    }
  },

  {
    key: "order_tracking",
    label: "Order Tracking Report",
    group: "Orders",
    description: "Live order pipeline by report type; OOS is a client-side filter.",
    module: "src/scott/data/reports/orderTrackingService.js",
    implemented: true,
    resource: ORDER_TRACKING_RESOURCE,
    pageSize: 20,
    fetchAll: ORDER_TRACKING_FETCH_ALL,
    service: { fetchPage: fetchOrderTrackingPage, fetchAll: fetchAllOrderTracking },
    filters: [
      {
        key: "reportType",
        type: "select",
        label: "Report Type",
        options: ORDER_TRACKING_REPORT_TYPE_OPTIONS,
        default: createDefaultOrderTrackingReportType(),
        // `oos` is not a server report_type: selecting it forces full-dataset mode.
        forcesFullDataset: ["oos"]
      },
      { ...PERIOD_FILTER, default: createDefaultOrderTrackingPeriod() }
    ],
    columns: ORDER_TRACKING_COLUMNS,
    filterColumns: buildReportFilterColumns(ORDER_TRACKING_COLUMNS),
    stats: null, // no stat cards on this page
    export: {
      entityName: "order-tracking-report",
      headers: ORDER_TRACKING_EXPORT_HEADERS,
      fieldMap: orderTrackingExportFieldMap,
      filename: () => generateExportFilename("order-tracking-report")
    }
  },

  {
    key: "rmp_sales",
    label: "RMP Sales Report",
    group: "Sales",
    description: "Readymade product sales: overview plus brand, class/DRR and coordinator breakdowns.",
    module: "src/scott/data/reports/rmpSalesService.js",
    implemented: true,
    resource: RMP_SALES_RESOURCE,
    pageSize: 20,
    fetchAll: RMP_SALES_FETCH_ALL,
    service: { fetchPage: fetchRmpOrdersPage, fetchAll: fetchRmpOrders },
    filters: [
      {
        key: "reportType",
        type: "select",
        label: "Report Type",
        options: RMP_SALES_REPORT_TYPE_OPTIONS,
        default: createDefaultRmpSalesReportType()
      },
      // `perTab`: upstream holds FOUR independent period states (overviewPeriod /
      // brandPeriod / classPeriod / coordinatorPeriod in `RmpSalesReportPage.tsx`), so
      // narrowing the Brand tab to one month does not silently re-scope the Overview.
      {
        ...PERIOD_FILTER,
        modes: ["date", "month", "year"],
        perTab: true,
        default: createDefaultPeriodConfig()
      },
      {
        key: "customerIds",
        type: "multiselect",
        label: "Customers",
        // Sent as customer_id (when exactly 1) / customer_ids[] for forward compatibility,
        // but the authoritative filtering is client-side and OVERVIEW-ONLY.
        clientSide: true,
        appliesToTabs: ["overview"],
        default: []
      }
    ],
    columns: RMP_SALES_OVERVIEW_COLUMNS,
    // The Status cell falls back to the APPLIED report type, exactly like the CSV field map.
    buildColumns: (values) => buildRmpSalesOverviewColumns(values?.reportType),
    filterColumns: buildReportFilterColumns(getRmpSalesFilterColumnsForTab("overview")),
    stats: { tiles: null, compute: computeRmpSalesOverviewStats },
    export: {
      entityName: RMP_SALES_EXPORT_NAMES.overview,
      headers: RMP_SALES_OVERVIEW_EXPORT_HEADERS,
      fieldMap: overviewExportFieldMap,
      filename: () => generateExportFilename(RMP_SALES_EXPORT_NAMES.overview)
    },
    tabs: [
      {
        key: "overview",
        label: RMP_SALES_TABS[0].label,
        paginated: true,
        service: { fetchPage: fetchRmpOrdersPage, fetchAll: fetchRmpOrders },
        columns: RMP_SALES_OVERVIEW_COLUMNS,
        // Same status fallback as `overviewExportFieldMap(values.reportType)` in `export`.
        buildColumns: (values) => buildRmpSalesOverviewColumns(values?.reportType),
        filterColumns: buildReportFilterColumns(getRmpSalesFilterColumnsForTab("overview")),
        stats: {
          compute: computeRmpSalesOverviewStats,
          // Upstream order (`ReportStatCardGrid` in `RmpSalesReportPage.tsx`): units, sales,
          // fill rate, then the count — the same shape as the three breakdown tabs.
          tiles: [
            { key: "totalUnits", label: "Total Units", format: "number" },
            { key: "salesValue", label: "Sales Value", format: "currency" },
            { key: "fillRate", label: "Fill Rate", format: "text" },
            // Total Orders deliberately reads the LIST pagination total, not stats.totalCount.
            { key: "totalOrders", label: "Total Orders", format: "number", source: "paginationTotal" }
          ]
        },
        export: {
          entityName: RMP_SALES_EXPORT_NAMES.overview,
          headers: RMP_SALES_OVERVIEW_EXPORT_HEADERS,
          fieldMap: overviewExportFieldMap
        }
      },
      {
        key: "brand",
        label: RMP_SALES_TABS[1].label,
        paginated: false,
        entityLabel: "Brand",
        service: { fetchAll: fetchBrandOrders },
        columns: buildRmpBreakdownTableColumns("Brand"),
        filterColumns: buildReportFilterColumns(getRmpSalesFilterColumnsForTab("brand")),
        stats: {
          compute: computeRmpBrandStats,
          // Upstream computes these from the DISPLAYED rows (`displayBrandRows` etc.), so a
          // brand filter re-totals the tiles. `ReportView` therefore recomputes over the
          // client-filtered set whenever one is active, instead of over the raw drain.
          overFilteredRows: true,
          tiles: [
            { key: "itemQty", label: "Item Qty (brands)", format: "number" },
            { key: "orderValue", label: "Order Value (brands)", format: "currency" },
            { key: "fillRate", label: "Fill Rate (total)", format: "text" },
            { key: "entityCount", label: "Brands", format: "number" }
          ]
        },
        export: {
          entityName: RMP_SALES_EXPORT_NAMES.brand,
          headers: buildBreakdownExportHeaders("Brand"),
          fieldMap: () => breakdownExportFieldMap("Brand")
        }
      },
      {
        key: "class",
        label: RMP_SALES_TABS[2].label,
        paginated: false,
        entityLabel: "Class",
        service: { fetchAll: fetchClassOrders },
        // `includeDrr`: the tab is named for the Daily Run Rate but neither this port nor
        // ScottOne ever showed the column. Added (not preserved as a defect).
        columns: buildRmpBreakdownTableColumns("Class", { includeDrr: true }),
        filterColumns: buildReportFilterColumns(getRmpSalesFilterColumnsForTab("class")),
        stats: {
          compute: computeRmpClassStats,
          // Upstream computes these from the DISPLAYED rows (`displayBrandRows` etc.), so a
          // brand filter re-totals the tiles. `ReportView` therefore recomputes over the
          // client-filtered set whenever one is active, instead of over the raw drain.
          overFilteredRows: true,
          tiles: [
            { key: "itemQty", label: "Item Qty (classes)", format: "number" },
            { key: "orderValue", label: "Order Value (classes)", format: "currency" },
            { key: "fillRate", label: "Fill Rate (total)", format: "text" },
            { key: "entityCount", label: "Classes", format: "number" }
          ]
        },
        export: {
          entityName: RMP_SALES_EXPORT_NAMES.class,
          headers: buildBreakdownExportHeaders("Class", { includeDrr: true }),
          fieldMap: () => breakdownExportFieldMap("Class", { includeDrr: true })
        }
      },
      {
        key: "coordinator",
        label: RMP_SALES_TABS[3].label,
        paginated: false,
        entityLabel: "Sales Coordinator",
        service: { fetchAll: fetchScOrders },
        columns: buildRmpCoordinatorTableColumns(),
        filterColumns: buildReportFilterColumns(getRmpSalesFilterColumnsForTab("coordinator")),
        stats: {
          compute: computeRmpCoordinatorStats,
          // Upstream computes these from the DISPLAYED rows (`displayBrandRows` etc.), so a
          // brand filter re-totals the tiles. `ReportView` therefore recomputes over the
          // client-filtered set whenever one is active, instead of over the raw drain.
          overFilteredRows: true,
          tiles: [
            { key: "orderedQty", label: "Ordered Qty", format: "number" },
            { key: "orderValue", label: "Order Value", format: "currency" },
            { key: "fillRate", label: "Fill Rate (total)", format: "text" },
            { key: "coordinatorCount", label: "Coordinators", format: "number" }
          ]
        },
        export: {
          entityName: RMP_SALES_EXPORT_NAMES.coordinator,
          headers: COORDINATOR_EXPORT_HEADERS,
          fieldMap: coordinatorExportFieldMap
        }
      }
    ]
  },

  {
    key: "total_inventory",
    label: "Total Inventory Report",
    group: "Inventory",
    description:
      "Current Scott stock. DRR uses qualifying RMP order quantities from the trailing 90 days ending on the applied period end date; Days of Cover is inventory divided by DRR.",
    module: "src/scott/data/reports/totalInventoryService.js",
    implemented: true,
    resource: TOTAL_INVENTORY_RESOURCE,
    pageSize: 20,
    // No server pagination: one POST returns everything, cached 30 s, paged client-side.
    serverPaginated: false,
    service: { fetchPage: fetchTotalInventoryPage, fetchAll: fetchAllTotalInventory },
    filters: [
      { ...PERIOD_FILTER, default: createDefaultInventoryPeriod(), showDateFilters: false }
    ],
    columns: TOTAL_INVENTORY_TABLE_COLUMNS,
    filterColumns: buildReportFilterColumns(TOTAL_INVENTORY_TABLE_COLUMNS),
    stats: {
      tiles: [
        { key: "totalCount", label: "SKUs", format: "number" },
        { key: "totalUnits", label: "Total Inventory", format: "number" },
        { key: "outOfStockCount", label: "Out of Stock", format: "number" },
        { key: "salesLoss", label: "Sales Loss (OOS)", format: "currency" }
      ],
      compute: computeTotalInventoryStats
    },
    export: {
      entityName: "total-inventory-report",
      headers: TOTAL_INVENTORY_EXPORT_HEADERS,
      fieldMap: totalInventoryExportFieldMap,
      filename: () => generateExportFilename("total-inventory-report")
    }
  },

  {
    // PLACEHOLDER — owned by a parallel worker. Nothing here imports the module, so the
    // registry loads whether or not it exists yet; wire `service`/`columns`/`stats`/`export`
    // from that module when it lands.
    key: "customer_performance",
    label: "Customer Performance Report",
    group: "Customers",
    description: "Period-A vs period-B customer qty/value comparison with growth percentages.",
    module: "src/scott/data/customerPerformanceService.js",
    implemented: false,
    resource: "customers",
    pageSize: 20,
    fetchAll: { pageSize: 100, maxPages: 50 },
    serverPaginated: false,
    service: null,
    filters: [
      {
        key: "growthPeriod",
        type: "select",
        label: "Growth Period",
        options: [
          { value: "weekly", label: "WoW Growth" },
          { value: "monthly", label: "MoM Growth" },
          { value: "quarterly", label: "Quarterly" },
          { value: "yearly", label: "Yearly" }
        ],
        default: "monthly"
      },
      { key: "periodA", type: "period", label: "Baseline period" },
      { key: "periodB", type: "period", label: "Comparison period" },
      {
        key: "orderHistoryFilter",
        type: "select",
        label: "Order history",
        options: [
          { value: "all", label: "All customers" },
          { value: "has_orders", label: "Orders > 0" },
          { value: "no_orders_yet", label: "No Orders Yet" }
        ],
        default: "all"
      }
    ],
    columns: null,
    filterColumns: null,
    stats: null,
    export: null
  }
]);

/** @returns {Record<string, unknown>|null} */
export function getReportConfig(key) {
  return REPORT_REGISTRY.find((report) => report.key === key) ?? null;
}

/** Only the reports this module actually implements (excludes the placeholder). */
export function getImplementedReports() {
  return REPORT_REGISTRY.filter((report) => report.implemented);
}

/** `{ [group]: report[] }` in `REPORT_GROUPS` order. */
export function getReportsByGroup() {
  const grouped = {};
  for (const group of REPORT_GROUPS) {
    const reports = REPORT_REGISTRY.filter((report) => report.group === group);
    if (reports.length > 0) grouped[group] = reports;
  }
  return grouped;
}

/** Tab descriptor lookup for multi-tab reports. */
export function getReportTab(reportKey, tabKey) {
  const report = getReportConfig(reportKey);
  if (!report?.tabs) return null;
  return report.tabs.find((tab) => tab.key === tabKey) ?? null;
}

export default REPORT_REGISTRY;
