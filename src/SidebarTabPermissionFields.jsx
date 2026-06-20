import { useEffect, useRef } from "react";
import { DASHBOARD_SIDEBAR, DASHBOARD_TAB_PARENT } from "./dashboardSidebarConfig";

export default function SidebarTabPermissionFields({
  tabFlags,
  editFlags,
  onViewChange,
  onEditChange,
  idPrefix
}) {
  const viewAllRef = useRef(null);
  const editAllRef = useRef(null);

  const allViewChecked = DASHBOARD_SIDEBAR.every((item) => Boolean(tabFlags?.[item.id]));
  const someViewChecked = DASHBOARD_SIDEBAR.some((item) => Boolean(tabFlags?.[item.id]));
  const viewIndeterminate = someViewChecked && !allViewChecked;

  const viewableTabs = DASHBOARD_SIDEBAR.filter((item) => Boolean(tabFlags?.[item.id]));
  const allEditChecked =
    viewableTabs.length > 0 && viewableTabs.every((item) => Boolean(editFlags?.[item.id]));
  const someEditChecked = viewableTabs.some((item) => Boolean(editFlags?.[item.id]));
  const editIndeterminate = someEditChecked && !allEditChecked;

  useEffect(() => {
    if (viewAllRef.current) viewAllRef.current.indeterminate = viewIndeterminate;
  }, [viewIndeterminate]);

  useEffect(() => {
    if (editAllRef.current) editAllRef.current.indeterminate = editIndeterminate;
  }, [editIndeterminate]);

  function setAllView(checked) {
    DASHBOARD_SIDEBAR.forEach((item) => onViewChange(item.id, checked));
  }

  function setAllEdit(checked) {
    DASHBOARD_SIDEBAR.forEach((item) => {
      if (Boolean(tabFlags?.[item.id])) onEditChange(item.id, checked);
    });
  }

  return (
    <div className="viewer-sidebar-tabs">
      <p className="viewer-sidebar-tabs-title">Dashboard tabs</p>
      <div className="viewer-sidebar-tabs-table">
        <div className="viewer-sidebar-tabs-table-head">
          <span>Tab</span>
          <div className="viewer-sidebar-tabs-head-col">
            <label className="viewer-sidebar-tabs-check viewer-sidebar-tabs-check--head">
              <input
                ref={viewAllRef}
                type="checkbox"
                checked={allViewChecked}
                onChange={(e) => setAllView(e.target.checked)}
                aria-label={allViewChecked ? "Deselect all view access" : "Select all view access"}
              />
              <span className="sr-only">Select or deselect all view</span>
            </label>
            <span className="viewer-sidebar-tabs-head-text">View</span>
          </div>
          <div className="viewer-sidebar-tabs-head-col">
            <label
              className={`viewer-sidebar-tabs-check viewer-sidebar-tabs-check--head${
                viewableTabs.length === 0 ? " is-disabled" : ""
              }`}
            >
              <input
                ref={editAllRef}
                type="checkbox"
                checked={allEditChecked}
                disabled={viewableTabs.length === 0}
                onChange={(e) => setAllEdit(e.target.checked)}
                aria-label={allEditChecked ? "Deselect all edit access" : "Select all edit access"}
              />
              <span className="sr-only">Select or deselect all edit</span>
            </label>
            <span className="viewer-sidebar-tabs-head-text">Edit</span>
          </div>
        </div>
        {DASHBOARD_SIDEBAR.map((item) => {
          const canView = Boolean(tabFlags?.[item.id]);
          return (
            <div
              className={`viewer-sidebar-tabs-row${DASHBOARD_TAB_PARENT[item.id] ? " viewer-sidebar-tabs-row--nested" : ""}`}
              key={`${idPrefix}-${item.id}`}
            >
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
