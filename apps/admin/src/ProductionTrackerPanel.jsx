import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const PRODUCTION_SUBTAB = "production";
export const SAMPLING_SUBTAB = "sampling";
export const TRACKER_LIST_ACTIVE = "active";
export const TRACKER_LIST_COMPLETE = "complete";

export const TRACKER_MODULE_DASHBOARD = "dashboard";
export const TRACKER_MODULE_JOBSHEETS = "jobsheets";
export const TRACKER_MODULE_SAMPLES = "samples";
export const TRACKER_MODULE_PRODUCTION = "production";

/**
 * Modules inside Production tracker. Numbers skipped in the request stay skipped.
 * Each id must render a real screen in App.jsx.
 */
export const PRODUCTION_TRACKER_MODULES = [
  { id: TRACKER_MODULE_DASHBOARD, label: "Dashboard" },
  { id: TRACKER_MODULE_JOBSHEETS, label: "Jobsheets" },
  { id: TRACKER_MODULE_SAMPLES, label: "Sample Cards" },
  { id: TRACKER_MODULE_PRODUCTION, label: "Production" },
  { id: "procurement", label: "Procurement" },
  { id: "billing", label: "Billing & Invoices" },
  { id: "dispatch", label: "Dispatch & Logistics" },
  { id: "followups", label: "Follow-ups" },
  { id: "reports", label: "Reports & Analytics" },
  { id: "settings", label: "Settings" }
];

export default function ProductionTrackerPanel({
  module = TRACKER_MODULE_DASHBOARD,
  onModuleChange,
  modules = PRODUCTION_TRACKER_MODULES,
  showListTabs = false,
  listTab = TRACKER_LIST_ACTIVE,
  onListTabChange,
  children
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <nav
        className="flex w-full shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-visible"
        aria-label="Production tracker modules"
      >
        {modules.map((item) => {
          const selected = item.id === module;
          return (
            <Button
              key={item.id}
              type="button"
              variant={selected ? "secondary" : "ghost"}
              className="justify-start"
              aria-current={selected ? "page" : undefined}
              onClick={() => onModuleChange?.(item.id)}
            >
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1 space-y-4">
        {showListTabs ? (
          <Tabs value={listTab} onValueChange={onListTabChange} aria-label="Open or complete tracker orders">
            <TabsList>
              <TabsTrigger value={TRACKER_LIST_ACTIVE}>All orders</TabsTrigger>
              <TabsTrigger value={TRACKER_LIST_COMPLETE}>Complete orders</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {children}
      </div>
    </div>
  );
}
