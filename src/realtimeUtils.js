import { supabase } from "./supabaseClient";

/** Debounce burst postgres_changes events into one refetch. */
export const REALTIME_DEBOUNCE_MS = 400;

/**
 * Subscribe to INSERT/UPDATE/DELETE on one or more public tables.
 * @returns {() => void} cleanup
 */
export function subscribePostgresChanges({
  channelName,
  tables,
  onEvent,
  debounceMs = REALTIME_DEBOUNCE_MS
}) {
  if (!channelName || !tables?.length || typeof onEvent !== "function") {
    return () => {};
  }

  let debounceTimer = null;

  const schedule = () => {
    if (debounceMs <= 0) {
      onEvent();
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      onEvent();
    }, debounceMs);
  };

  const channel = supabase.channel(channelName);
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
  }
  channel.subscribe();

  return () => {
    clearTimeout(debounceTimer);
    supabase.removeChannel(channel);
  };
}

/** Tables enabled for live dashboard sync (also listed in migration publication). */
export const DASHBOARD_REALTIME_TABLES = [
  "orders",
  "order_customer_assets",
  "owners",
  "coordinators",
  "sales_incharges",
  "profiles",
  "profile_order_permissions",
  "outward_challans",
  "inward_entries",
  "inward_grn_entries",
  "contact_book_entries",
  "shared_resource_links",
  "dealers",
  "dealer_daily_reports",
  "inventory_skus",
  "inventory_stock_movements",
  "inventory_alert_settings",
  "inventory_suppliers",
  "inventory_warehouses",
  "printing_dept_inventory_state",
  "printing_dept_refill_log",
  "printing_dept_inventory_thresholds",
  "printing_utilization_entries",
  "user_annual_goals",
  "user_goal_tasks",
  "user_goal_status_remarks"
];
