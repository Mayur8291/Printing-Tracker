export const PRINTING_ORDERS_TAB = { id: "printing", label: "Printing Orders" };

/** Sub-tab inside Printing Orders; permission id stays `printing_department`. */
export const PRINTING_QUEUE_SUBTAB = {
  id: "print_queue",
  permissionId: "printing_department",
  label: "Print Queue"
};

export const DASHBOARD_SIDEBAR_MAIN = [
  { id: "home", label: "Home" },
  { id: "goals", label: "Goals & Tasks" },
  PRINTING_ORDERS_TAB,
  { id: "billing", label: "Billing" },
  { id: "dispatch", label: "Dispatch" },
  { id: "inventory", label: "Inventory" },
  { id: "purchase_order", label: "Purchase Order" },
  { id: "regular", label: "Ready Stock Order" },
  { id: "production_tracker", label: "Production tracker" },
  { id: "distributor", label: "Distributor" },
  { id: "enquiry", label: "Support" },
  // --- Ops Platform (One Source of Truth roadmap; NOT the Scott API Masters tab) ---
  { id: "ops_masters", label: "Platform Masters" },
  { id: "ops_stock", label: "Stock Ledger" },
  { id: "ops_procurement", label: "Procurement" },
  { id: "ops_sales", label: "Sales Orders" },
  { id: "ops_ar", label: "Billing & AR" },
  // --- Scott API (migrated from the standalone ScottOne dashboard) ---
  { id: "scott_customers", label: "Customers" },
  { id: "scott_reports", label: "Reports" },
  { id: "scott_masters", label: "Masters" }
];

export const DASHBOARD_SIDEBAR_MAIN_SECTIONS = [
  {
    label: "Workspace",
    ids: ["home", "goals", "printing", "billing", "dispatch"]
  },
  {
    label: "Inventory",
    ids: ["inventory", "purchase_order", "regular", "production_tracker", "distributor", "enquiry"]
  },
  {
    label: "Ops Platform",
    ids: ["ops_masters", "ops_stock", "ops_procurement", "ops_sales", "ops_ar"]
  },
  {
    label: "Scott API",
    ids: ["scott_customers", "scott_reports", "scott_masters"]
  }
];

export const DASHBOARD_SIDEBAR_FOOTER = [
  { id: "shared_links", label: "Shared Links" },
  { id: "contact_book", label: "Contact Book" },
  { id: "chat", label: "Chat" },
  { id: "internal_support", label: "Internal Support Platform" },
  { id: "asset_management", label: "Asset Management" },
  { id: "audit", label: "Audit" }
];

export const ADMIN_DASHBOARD_TAB = { id: "admin", label: "Admin Panel" };

export const DASHBOARD_SIDEBAR_SOON_TAB_IDS = new Set(["audit"]);

/**
 * Tabs that require an admin account regardless of per-viewer grants.
 *
 * The Scott API proxy (`scott-dashboard-masters`) authorizes callers with
 * `profiles.role === 'admin'` OR an `admin_emails` match and 403s everyone else — the
 * same admin gate the original ScottOne dashboard used. Showing these tabs to a
 * non-admin would render a wall of "Forbidden" errors, so they are hidden instead.
 * Relax this only if the edge function's gate is relaxed to match.
 */
export const DASHBOARD_ADMIN_ONLY_TAB_IDS = new Set([
  "scott_customers",
  "scott_reports",
  "scott_masters",
  // Ops Platform (Steps 0–4): master-data, stock-ledger, procurement,
  // sales-order and billing writes are admin-only in RLS; the screens are
  // for admin during the build-out.
  "ops_masters",
  "ops_stock",
  "ops_procurement",
  "ops_sales",
  "ops_ar"
]);

export function isAdminOnlyDashboardTab(tabId) {
  return DASHBOARD_ADMIN_ONLY_TAB_IDS.has(tabId);
}

/** Permission-only tab (Print Queue sub-view inside Printing Orders). */
export const DASHBOARD_PRINTING_QUEUE_PERMISSION_TAB = {
  id: "printing_department",
  label: "Print Queue"
};

export const DASHBOARD_TAB_PARENT = {
  printing_department: "printing"
};

export const DASHBOARD_SIDEBAR = [
  ...DASHBOARD_SIDEBAR_MAIN,
  DASHBOARD_PRINTING_QUEUE_PERMISSION_TAB,
  ...DASHBOARD_SIDEBAR_FOOTER
];

/**
 * Tabs an admin can actually grant to a viewer — the permission universe minus admin-only
 * tabs. Use this everywhere permission flags are built, hydrated, saved OR rendered; using
 * the full DASHBOARD_SIDEBAR in one place and a filtered list in another writes phantom
 * grants for tabs that can never be granted.
 */
export const DASHBOARD_GRANTABLE_SIDEBAR = DASHBOARD_SIDEBAR.filter(
  (item) => !isAdminOnlyDashboardTab(item.id)
);

export function dashboardTabLabel(tabId) {
  return DASHBOARD_SIDEBAR.find((item) => item.id === tabId)?.label ?? "Menu";
}

export function isPrintingOrdersSubTab(tab) {
  return tab === "active" || tab === "complete" || tab === PRINTING_QUEUE_SUBTAB.id;
}
