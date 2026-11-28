// Scott API → Customers.
//
// Panel shell only: header + env badge + the Tier-B sub-tab pill row. The two sub-views own
// their own data.
//
// Sub-tab idiom (house style, `App.jsx` / `DispatchTabPanel.jsx`): `Tabs` renders the TRIGGER
// ROW ONLY — `TabsContent` is not used, the active view is chosen by a plain conditional
// below. Both views are unmounted when inactive, which is what keeps the customers drain and
// the two performance calls from running side by side.

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ScottCustomerPerformanceTab from "@/scott/customers/ScottCustomerPerformanceTab";
import ScottCustomersDirectoryTab from "@/scott/customers/ScottCustomersDirectoryTab";
import CantoTargetSwitcher from "@/canto/CantoTargetSwitcher";
import { ScottToasts, useScottToast } from "@/scott/ui/useScottToast";

const SUB_TABS = Object.freeze([
  { value: "directory", label: "Directory" },
  { value: "performance", label: "Performance" }
]);

/**
 * @param {object} props
 * @param {boolean} [props.isAdmin=false]
 * @param {boolean} [props.canEdit=false]
 * @param {string} [props.sessionUserId] unused here — writes are authorized upstream.
 */
export default function ScottCustomersTabPanel({ isAdmin = false, canEdit = false }) {
  const mayEdit = isAdmin || canEdit;
  const [subTab, setSubTab] = useState("directory");
  const { toasts, toast, toastError, dismiss } = useScottToast();

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Customer pricing directory and performance.
              {mayEdit ? null : " You have read-only access to this tab."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3"><a className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href="/squad/customers">Manage customers and distributors</a><CantoTargetSwitcher /></div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">Account approval, coordinator assignments and distributor accounts are managed in Squad One with your staff sign-in. Pricing tiers here do not define account roles.</p>
        <Tabs value={subTab} onValueChange={setSubTab} className="mt-4" aria-label="Scott customers views">
          <TabsList>
            {SUB_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        {subTab === "directory" ? (
          <ScottCustomersDirectoryTab mayEdit={mayEdit} toast={toast} toastError={toastError} />
        ) : null}
        {subTab === "performance" ? <ScottCustomerPerformanceTab /> : null}
      </div>

      <ScottToasts toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}
