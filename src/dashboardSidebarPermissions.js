/** Sidebar tab access helpers (stored on profile_order_permissions.allowed_dashboard_tabs). */

export function allDashboardTabIds(sidebarItems) {
  return sidebarItems.map((item) => item.id);
}

export function defaultSidebarTabFlags(sidebarItems) {
  return Object.fromEntries(allDashboardTabIds(sidebarItems).map((id) => [id, true]));
}

/** null in DB means all tabs allowed. */
export function hydrateSidebarTabFlagsFromPermission(permissionRow, sidebarItems) {
  const ids = allDashboardTabIds(sidebarItems);
  const allowed = permissionRow?.allowed_dashboard_tabs;
  if (allowed == null) {
    return defaultSidebarTabFlags(sidebarItems);
  }
  const set = new Set(Array.isArray(allowed) ? allowed : []);
  return Object.fromEntries(ids.map((id) => [id, set.has(id)]));
}

export function allowedDashboardTabsFromFlags(flags, sidebarItems) {
  const ids = allDashboardTabIds(sidebarItems);
  const selected = ids.filter((id) => flags[id]);
  if (selected.length === ids.length) return null;
  return selected;
}

export function viewerCanAccessDashboardTab(permissions, tabId) {
  const allowed = permissions?.allowed_dashboard_tabs;
  if (allowed == null) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(tabId);
}

export function filterSidebarItemsForViewer(items, permissions, isAdmin) {
  if (isAdmin) return items;
  return items.filter((item) => viewerCanAccessDashboardTab(permissions, item.id));
}

export function firstAllowedDashboardTabId(sidebarItems, permissions, isAdmin) {
  const visible = filterSidebarItemsForViewer(sidebarItems, permissions, isAdmin);
  return visible[0]?.id ?? null;
}
