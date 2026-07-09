import { supabase } from "./supabaseClient";

/** Postgres table → sidebar tab ids that should show an activity dot. */
export const SIDEBAR_ACTIVITY_TABLE_TABS = {
  orders: ["printing", "home"],
  user_annual_goals: ["goals", "home"],
  user_goal_tasks: ["goals", "home"],
  user_goal_status_remarks: ["goals", "home"],
  outward_challans: ["dispatch"],
  inward_entries: ["dispatch"],
  inward_grn_entries: ["dispatch"],
  inventory_skus: ["inventory"],
  inventory_style_parents: ["inventory"],
  inventory_stock_movements: ["inventory"],
  inventory_alert_settings: ["inventory"],
  inventory_suppliers: ["inventory"],
  inventory_warehouses: ["inventory"],
  printing_dept_inventory_state: ["production_tracker"],
  printing_dept_refill_log: ["production_tracker"],
  printing_dept_inventory_thresholds: ["production_tracker"],
  printing_utilization_entries: ["production_tracker"],
  dealers: ["distributor"],
  dealer_daily_reports: ["distributor"],
  contact_book_entries: ["contact_book"],
  shared_resource_links: ["shared_links"],
  profiles: ["admin"],
  profile_order_permissions: ["admin"],
  owners: ["admin"],
  coordinators: ["admin"],
  sales_incharges: ["admin"]
};

export function markSidebarTabsForTable(setMarkers, table, currentTab) {
  const tabs = SIDEBAR_ACTIVITY_TABLE_TABS[table];
  if (!tabs?.length) return;
  setMarkers((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const tabId of tabs) {
      if (tabId === currentTab) continue;
      if (!next[tabId]) {
        next[tabId] = true;
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

export function clearSidebarTabMarker(setMarkers, tabId) {
  setMarkers((prev) => {
    if (!prev[tabId]) return prev;
    const next = { ...prev };
    delete next[tabId];
    return next;
  });
}

/**
 * Live sidebar activity dots when data changes on another tab.
 * @param {() => string} getCurrentTab - active dashboard tab id
 */
export function subscribeSidebarTabActivity({ channelName, getCurrentTab, setMarkers }) {
  const tables = Object.keys(SIDEBAR_ACTIVITY_TABLE_TABS);
  if (!channelName || !tables.length) return () => {};

  const channel = supabase.channel(channelName);
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
      markSidebarTabsForTable(setMarkers, table, getCurrentTab());
    });
  }
  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
