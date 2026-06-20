/** Sidebar tab view + edit access (profile_order_permissions allowed_/editable_dashboard_tabs). */

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
  // Older permission rows may omit "home" — always show Home when other tabs are allowed.
  if (allowed != null && set.size > 0 && ids.includes("home")) {
    set.add("home");
  }
  return Object.fromEntries(ids.map((id) => [id, set.has(id)]));
}

/** null in DB means can edit all viewable tabs. */
export function hydrateSidebarEditTabFlagsFromPermission(permissionRow, sidebarItems) {
  const viewFlags = hydrateSidebarTabFlagsFromPermission(permissionRow, sidebarItems);
  const editable = permissionRow?.editable_dashboard_tabs;
  if (editable == null) {
    return { ...viewFlags };
  }
  const set = new Set(Array.isArray(editable) ? editable : []);
  return Object.fromEntries(
    allDashboardTabIds(sidebarItems).map((id) => [id, Boolean(viewFlags[id] && set.has(id))])
  );
}

export function allowedDashboardTabsFromFlags(flags, sidebarItems) {
  const ids = allDashboardTabIds(sidebarItems);
  const selected = ids.filter((id) => flags[id]);
  if (selected.length === ids.length) return null;
  return selected;
}

export function editableDashboardTabsFromFlags(editFlags, viewFlags, sidebarItems) {
  const ids = allDashboardTabIds(sidebarItems);
  const viewable = ids.filter((id) => viewFlags[id]);
  const selected = ids.filter((id) => editFlags[id] && viewFlags[id]);
  if (viewable.length === 0) return [];
  if (selected.length === viewable.length) return null;
  return selected;
}

export function viewerCanAccessDashboardTab(permissions, tabId) {
  const allowed = permissions?.allowed_dashboard_tabs;
  if (allowed == null) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(tabId);
}

export function viewerCanEditDashboardTab(permissions, tabId) {
  if (!viewerCanAccessDashboardTab(permissions, tabId)) return false;
  const editable = permissions?.editable_dashboard_tabs;
  if (editable == null) return true;
  if (!Array.isArray(editable) || editable.length === 0) return false;
  return editable.includes(tabId);
}

export function prepareVisibleMainSidebarItems(items, permissions, isAdmin) {
  return items
    .map((item) => {
      const visibleChildren = (item.children ?? []).filter(
        (child) => isAdmin || viewerCanAccessDashboardTab(permissions, child.id)
      );
      const showParent =
        isAdmin ||
        viewerCanAccessDashboardTab(permissions, item.id) ||
        visibleChildren.length > 0;
      if (!showParent) return null;
      return {
        ...item,
        children: visibleChildren.length ? visibleChildren : undefined
      };
    })
    .filter(Boolean);
}

export function filterSidebarItemsForViewer(items, permissions, isAdmin) {
  if (isAdmin) return items;
  return items.filter((item) => viewerCanAccessDashboardTab(permissions, item.id));
}

export function firstAllowedDashboardTabId(sidebarItems, permissions, isAdmin) {
  const visible = filterSidebarItemsForViewer(sidebarItems, permissions, isAdmin);
  const navigable = visible.filter((item) => item.id !== "printing_department");
  if (navigable.length) return navigable[0].id;
  if (visible.some((item) => item.id === "printing_department")) return "printing";
  return null;
}
