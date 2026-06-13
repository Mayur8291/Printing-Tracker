export const DASHBOARD_SIDEBAR_MAIN = [
  { id: "home", label: "Home" },
  { id: "printing", label: "Printing Orders" },
  { id: "printing_department", label: "Printing department" },
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
    ids: ["home", "printing", "printing_department", "billing", "dispatch"]
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

export const DASHBOARD_SIDEBAR = [...DASHBOARD_SIDEBAR_MAIN, ...DASHBOARD_SIDEBAR_FOOTER];
