import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const PRODUCTION_SUBTAB = "production";
export const SAMPLING_SUBTAB = "sampling";
export const TRACKER_LIST_ACTIVE = "active";
export const TRACKER_LIST_COMPLETE = "complete";

/**
 * Production / Sampling switch uses the same muted pill as All orders / Complete orders.
 */
export default function ProductionTrackerPanel({
  children,
  samplingContent,
  subTab = PRODUCTION_SUBTAB,
  onSubTabChange,
  listTab = TRACKER_LIST_ACTIVE,
  onListTabChange
}) {
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={subTab} onValueChange={onSubTabChange} aria-label="Production or Sampling tracker">
        <TabsList>
          <TabsTrigger value={PRODUCTION_SUBTAB}>Production Tracker</TabsTrigger>
          <TabsTrigger value={SAMPLING_SUBTAB}>Sampling Tracker</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={listTab} onValueChange={onListTabChange} aria-label="Open or complete tracker orders">
        <TabsList>
          <TabsTrigger value={TRACKER_LIST_ACTIVE}>All orders</TabsTrigger>
          <TabsTrigger value={TRACKER_LIST_COMPLETE}>Complete orders</TabsTrigger>
        </TabsList>
      </Tabs>
      {subTab === PRODUCTION_SUBTAB ? children : samplingContent}
    </div>
  );
}
