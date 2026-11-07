// Scott API → Reports.
//
// The panel is a router, not a report: it picks one of the seven descriptors in
// `reportsCatalog.js` and hands it to `ReportView`, which builds the whole screen (filters →
// stat tiles → table → pagination → CSV) from that descriptor alone. RMP Sales is the only
// report with sub-tabs, and those are four more descriptors handed to the same component.
//
// READ-ONLY BY CONSTRUCTION. `ReportView` hard-codes `mayEdit={false}`, so no report can grow
// a create/edit/delete affordance. Export is deliberately NOT gated on `canEdit`: taking a
// CSV of a report you are already allowed to read is a read, so anyone with view access to
// this tab can export.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/inventory/inventoryUiUtils";
import ScottEnvBadge from "@/scott/ui/ScottEnvBadge";
// All-named import: scripts/check-ui-gate.mjs only records the FIRST binding of a mixed
// `import Default, { Named }` statement and would report `ScottToasts` as missing.
import { ScottToasts, useScottToast } from "@/scott/ui/useScottToast";
import CustomerPerformanceKpis from "@/scott/reports/CustomerPerformanceKpis";
import ReportView from "@/scott/reports/ReportView";
import { installScottReportsBootstrap } from "@/scott/reports/reportsBootstrap";
import {
  getGroupedReports,
  getReport,
  loadSelectedReportKey,
  loadSelectedTabKey,
  saveSelectedReportKey,
  saveSelectedTabKey
} from "@/scott/reports/reportsCatalog";

// Register the customers-master loader with `rmpSalesService` exactly once, at import time.
// The service asks for it via `configureRmpCustomerLoader` precisely so that it does not
// have to import a sibling module itself; this is the composition root that answers.
installScottReportsBootstrap();

/** "Custom Order Reports" -> "Custom Order": the pills have to fit on one row. */
function shortLabel(label) {
  return String(label ?? "").replace(/\s+Reports?$/i, "");
}

/**
 * Report picker. A `Tabs` pill row on desktop (the house sub-tab idiom) and a grouped
 * `Select` on mobile, where seven pills would never fit. Both are driven by the registry's
 * own grouping, and both write the same state.
 */
function ReportSelector({ groups, value, onChange, currentGroup }) {
  const flat = groups.flatMap((entry) => entry.reports);

  return (
    <div className="space-y-2">
      <div className="sm:hidden">
        <Label htmlFor="scott-report-picker" className="text-xs font-medium text-muted-foreground">
          Report
        </Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id="scott-report-picker" className="mt-1.5 h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((entry) => (
              <SelectGroup key={entry.group}>
                <SelectLabel>{entry.group}</SelectLabel>
                {entry.reports.map((report) => (
                  <SelectItem key={report.key} value={report.key}>
                    {report.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden sm:block">
        {currentGroup ? (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {currentGroup}
          </p>
        ) : null}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Tabs value={value} onValueChange={onChange}>
            <TabsList aria-label="Scott reports">
              {flat.map((report) => (
                <TabsTrigger key={report.key} value={report.key} title={report.label}>
                  {shortLabel(report.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} [props.isAdmin] unused: reports carry no write actions to gate.
 * @param {boolean} [props.canEdit] unused: read access implies export access.
 * @param {string} [props.sessionUserId]
 */
export default function ScottReportsTabPanel() {
  const groups = useMemo(() => getGroupedReports(), []);
  const [reportKey, setReportKey] = useState(() => loadSelectedReportKey());
  const [tabKey, setTabKey] = useState(() => loadSelectedTabKey(loadSelectedReportKey()));
  const { toasts, toast, toastError, dismiss } = useScottToast();

  const report = getReport(reportKey);
  const tabs = Array.isArray(report?.tabs) && report.tabs.length > 0 ? report.tabs : null;

  // Keep the remembered sub-tab valid whenever the report changes.
  useEffect(() => {
    setTabKey(loadSelectedTabKey(reportKey));
  }, [reportKey]);

  const handleReportChange = useCallback((next) => {
    if (!getReport(next)) return;
    setReportKey(next);
    saveSelectedReportKey(next);
  }, []);

  const handleTabChange = useCallback(
    (next) => {
      setTabKey(next);
      saveSelectedTabKey(reportKey, next);
    },
    [reportKey]
  );

  const renderExtras = useCallback(
    (values) =>
      reportKey === "customer_performance" ? <CustomerPerformanceKpis values={values} /> : null,
    [reportKey]
  );

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <PageHeader
          title="Reports"
          subtitle="Scott API — orders, tailor, tracking, sales, inventory and customer performance."
          actions={<ScottEnvBadge showBaseUrl />}
        />

        <div className="space-y-6">
          <ReportSelector
            groups={groups}
            value={reportKey}
            onChange={handleReportChange}
            currentGroup={report?.group}
          />

          {report ? (
            <ReportView
              // Remounting on report change resets filter state to that report's own
              // documented defaults instead of leaking the previous report's period.
              key={report.key}
              report={report}
              tabs={tabs}
              activeTab={tabKey}
              onTabChange={handleTabChange}
              toast={toast}
              toastError={toastError}
              renderExtras={renderExtras}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              That report is no longer available. Pick another from the list above.
            </p>
          )}
        </div>
      </div>

      <ScottToasts toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}
