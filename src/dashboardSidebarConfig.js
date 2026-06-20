export const PRINTING_ORDERS_TAB = { id: "printing", label: "Printing Orders" };

/** Sub-tab inside Printing Orders; permission id stays `printing_department`. */
export const PRINTING_QUEUE_SUBTAB = {
  id: "print_queue",
  permissionId: "printing_department",
  label: "Print Queue"
};

export const DASHBOARD_SIDEBAR_MAIN = [
  { id: "home", label: "Home" },
  PRINTING_ORDERS_TAB,
  { id: "billing", label: "Billing" },
  { id: "dispatch", label: "Dispatch" },
  { id: "inventory", label: "Inventory" },
  { id: "regular", label: "Ready Stock Order" },
  { id: "production_tracker", label: "Production tracker" },
  { id: "distributor", label: "Distributor" }
];

export const DASHBOARD_SIDEBAR_MAIN_SECTIONS = [
  {
    label: "Workspace",
    ids: ["home", "printing", "billing", "dispatch"]
  },
  {
    label: "Inventory",
    ids: ["inventory", "regular", "production_tracker", "distributor"]
  }
];

export const DASHBOARD_SIDEBAR_FOOTER = [
  { id: "shared_links", label: "Shared Links" },
  { id: "contact_book", label: "Contact Book" },
  { id: "chat", label: "Chat" },
  { id: "asset_management", label: "Asset Management" },
  { id: "audit", label: "Audit" }
];

export const ADMIN_DASHBOARD_TAB = { id: "admin", label: "Admin Panel" };

export const DASHBOARD_SIDEBAR_SOON_TAB_IDS = new Set(["regular", "asset_management", "audit"]);

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

export function dashboardTabLabel(tabId) {
  return DASHBOARD_SIDEBAR.find((item) => item.id === tabId)?.label ?? "Menu";
}

export function isPrintingOrdersSubTab(tab) {
  return tab === "active" || tab === "complete" || tab === PRINTING_QUEUE_SUBTAB.id;
}
