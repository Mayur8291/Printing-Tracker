import { DASHBOARD_SIDEBAR } from "./dashboardSidebarConfig";

export default function SidebarTabPermissionFields({
  tabFlags,
  editFlags,
  onViewChange,
  onEditChange,
  idPrefix
}) {
  return (
    <div className="viewer-sidebar-tabs">
      <p className="viewer-sidebar-tabs-title">Dashboard tabs</p>
      <div className="viewer-sidebar-tabs-table">
        <div className="viewer-sidebar-tabs-table-head" aria-hidden="true">
          <span>Tab</span>
          <span>View</span>
          <span>Edit</span>
        </div>
        {DASHBOARD_SIDEBAR.map((item) => {
          const canView = Boolean(tabFlags?.[item.id]);
          return (
            <div className="viewer-sidebar-tabs-row" key={`${idPrefix}-${item.id}`}>
              <span className="viewer-sidebar-tabs-row-label">{item.label}</span>
              <label className="viewer-sidebar-tabs-check">
                <input
                  type="checkbox"
                  checked={canView}
                  onChange={(e) => onViewChange(item.id, e.target.checked)}
                />
                <span className="sr-only">View {item.label}</span>
              </label>
              <label className={`viewer-sidebar-tabs-check${canView ? "" : " is-disabled"}`}>
                <input
                  type="checkbox"
                  checked={canView && Boolean(editFlags?.[item.id])}
                  disabled={!canView}
                  onChange={(e) => onEditChange(item.id, e.target.checked)}
                />
                <span className="sr-only">Edit {item.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
