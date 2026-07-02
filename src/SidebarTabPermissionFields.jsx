import { DASHBOARD_SIDEBAR, DASHBOARD_TAB_PARENT } from "./dashboardSidebarConfig";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function SidebarTabPermissionFields({
  tabFlags,
  editFlags,
  onViewChange,
  onEditChange,
  idPrefix
}) {
  const allViewChecked = DASHBOARD_SIDEBAR.every((item) => Boolean(tabFlags?.[item.id]));
  const someViewChecked = DASHBOARD_SIDEBAR.some((item) => Boolean(tabFlags?.[item.id]));
  const viewIndeterminate = someViewChecked && !allViewChecked;

  const viewableTabs = DASHBOARD_SIDEBAR.filter((item) => Boolean(tabFlags?.[item.id]));
  const allEditChecked =
    viewableTabs.length > 0 && viewableTabs.every((item) => Boolean(editFlags?.[item.id]));
  const someEditChecked = viewableTabs.some((item) => Boolean(editFlags?.[item.id]));
  const editIndeterminate = someEditChecked && !allEditChecked;

  function setAllView(checked) {
    DASHBOARD_SIDEBAR.forEach((item) => onViewChange(item.id, checked));
  }

  function setAllEdit(checked) {
    DASHBOARD_SIDEBAR.forEach((item) => {
      if (Boolean(tabFlags?.[item.id])) onEditChange(item.id, checked);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dashboard tabs</p>
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tab</span>
          <div className="flex flex-col items-center gap-1">
            <Checkbox
              id={`${idPrefix}-view-all`}
              checked={viewIndeterminate ? "indeterminate" : allViewChecked}
              onCheckedChange={(checked) => setAllView(Boolean(checked))}
              aria-label={allViewChecked ? "Deselect all view access" : "Select all view access"}
            />
            <Label htmlFor={`${idPrefix}-view-all`} className="text-[10px] font-medium uppercase text-muted-foreground">
              View
            </Label>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Checkbox
              id={`${idPrefix}-edit-all`}
              checked={editIndeterminate ? "indeterminate" : allEditChecked}
              disabled={viewableTabs.length === 0}
              onCheckedChange={(checked) => setAllEdit(Boolean(checked))}
              aria-label={allEditChecked ? "Deselect all edit access" : "Select all edit access"}
            />
            <Label htmlFor={`${idPrefix}-edit-all`} className="text-[10px] font-medium uppercase text-muted-foreground">
              Edit
            </Label>
          </div>
        </div>
        {DASHBOARD_SIDEBAR.map((item) => {
          const canView = Boolean(tabFlags?.[item.id]);
          const viewId = `${idPrefix}-view-${item.id}`;
          const editId = `${idPrefix}-edit-${item.id}`;
          return (
            <div
              key={`${idPrefix}-${item.id}`}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 border-b px-3 py-2 last:border-b-0",
                DASHBOARD_TAB_PARENT[item.id] && "bg-muted/20"
              )}
            >
              <span
                className={cn(
                  "text-sm text-foreground",
                  DASHBOARD_TAB_PARENT[item.id] && "pl-4 text-muted-foreground"
                )}
              >
                {item.label}
              </span>
              <div className="flex justify-center">
                <Checkbox
                  id={viewId}
                  checked={canView}
                  onCheckedChange={(checked) => onViewChange(item.id, Boolean(checked))}
                />
                <Label htmlFor={viewId} className="sr-only">
                  View {item.label}
                </Label>
              </div>
              <div className={cn("flex justify-center", !canView && "opacity-50")}>
                <Checkbox
                  id={editId}
                  checked={canView && Boolean(editFlags?.[item.id])}
                  disabled={!canView}
                  onCheckedChange={(checked) => onEditChange(item.id, Boolean(checked))}
                />
                <Label htmlFor={editId} className="sr-only">
                  Edit {item.label}
                </Label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
