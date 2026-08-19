// The three `customers/unique_customers` KPI cards, shown above the comparison table.
//
// This is a SEPARATE endpoint from the comparison itself, covering the union of period A and
// period B, which is why it does not come out of `stats.compute` like every other report's
// tiles. It fails independently too: a broken KPI call leaves the comparison table intact.
//
// NO MOCK FALLBACK. The upstream original substituted `{80, 50, 50}` whenever this call threw
// or returned nothing numeric — silently, so a broken integration looked healthy. An empty
// summary renders as empty here (`ScottStatCards` prints an em dash per tile).

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchUniqueCustomersSummary } from "@/scott/data/customerPerformanceService";
import ScottStatCards from "@/scott/ui/ScottStatCards";
import { buildCustomerPerformanceFilters } from "@/scott/reports/customerPerformanceConfig";

/**
 * @param {object} props
 * @param {Record<string, unknown>} props.values current report filter values.
 */
export default function CustomerPerformanceKpis({ values }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const { kpi_start: kpiStart, kpi_end: kpiEnd } = buildCustomerPerformanceFilters(values);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const result = await fetchUniqueCustomersSummary(kpiStart, kpiEnd);
        if (!cancelled) setSummary(result ?? null);
      } catch (err) {
        if (!cancelled) {
          setSummary(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kpiStart, kpiEnd, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-destructive">Unique-customer KPIs unavailable — {error}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Unique customers · {kpiStart || "—"} → {kpiEnd || "—"}
      </p>
      <ScottStatCards
        columns={3}
        loading={loading}
        skeletonCount={3}
        stats={[
          {
            key: "totalUniqueCustomers",
            label: "Total Unique Customers",
            format: "number",
            value: summary?.totalUniqueCustomers ?? null
          },
          {
            key: "uniqueCustomOrder",
            label: "Custom Order Customers",
            format: "number",
            value: summary?.uniqueCustomOrder ?? null
          },
          {
            key: "uniqueReadymade",
            label: "Readymade Customers",
            format: "number",
            value: summary?.uniqueReadymade ?? null
          }
        ]}
      />
    </div>
  );
}
