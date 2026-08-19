// Stat tile row for Scott reports — the KPI-grid template from
// `src/inventory/pages/InventoryOverview.jsx`, generalised over a `stats` array.

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatScottCurrency,
  formatScottNumber,
  formatScottPercent,
  formatScottText
} from "@/scott/ui/ScottTable";

const GRID_COLUMNS = {
  2: "grid gap-4 sm:grid-cols-2",
  3: "grid gap-4 sm:grid-cols-2 xl:grid-cols-3",
  4: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
  5: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
};

function formatStatValue(stat) {
  if (stat?.value == null || stat.value === "") return "—";
  switch (stat.format) {
    case "currency":
      return formatScottCurrency(stat.value);
    case "number":
      return formatScottNumber(stat.value, stat.decimals ?? 2);
    case "percent":
      return formatScottPercent(stat.value);
    case "text":
      return formatScottText(stat.value);
    default:
      // Pre-formatted strings and React nodes pass straight through.
      return typeof stat.value === "number" ? formatScottNumber(stat.value, stat.decimals ?? 2) : stat.value;
  }
}

/**
 * Report stat tiles: label, value, optional delta + subtext.
 *
 * @param {object} props
 * @param {Array<{
 *   key?: string,
 *   label: string,
 *   value: unknown,
 *   format?: "currency" | "number" | "percent" | "text",
 *   decimals?: number,
 *   delta?: string | number,
 *   deltaDir?: "up" | "down",
 *   sub?: string,
 *   abbrev?: string
 * }>} [props.stats] tiles to render; `value` may be a pre-formatted string or a React node.
 * @param {boolean} [props.loading=false] renders Skeleton tiles instead.
 * @param {string} [props.error] renders a destructive-bordered Card instead of the tiles.
 * @param {number} [props.columns=4] tiles per row at `xl` (2–6).
 * @param {number} [props.skeletonCount] tile count while loading (defaults to `columns`).
 * @param {string} [props.emptyMessage] shown when there is nothing to display.
 * @param {string} [props.className] extra classes on the grid.
 */
export default function ScottStatCards({
  stats = [],
  loading = false,
  error = "",
  columns = 4,
  skeletonCount,
  emptyMessage = "No summary available.",
  className
}) {
  const gridClass = GRID_COLUMNS[columns] || GRID_COLUMNS[4];

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    const count = Math.max(1, skeletonCount ?? columns);
    return (
      <div className={cn(gridClass, className)}>
        {Array.from({ length: count }).map((_, i) => (
          <Card key={`scott-stat-skeleton-${i}`}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const list = Array.isArray(stats) ? stats.filter(Boolean) : [];
  if (list.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className={cn(gridClass, className)}>
      {list.map((stat, index) => (
        <Card key={stat.key || stat.label || index}>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardDescription>{stat.label}</CardDescription>
            {stat.abbrev ? (
              <div className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {stat.abbrev}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight tabular-nums">{formatStatValue(stat)}</div>
            {stat.delta != null || stat.sub ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {stat.delta != null && stat.delta !== "" ? (
                  <span
                    className={cn(
                      "font-medium",
                      stat.deltaDir === "down"
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {stat.deltaDir === "down" ? "↓" : "↑"} {stat.delta}
                  </span>
                ) : null}
                {stat.sub ? <span>{stat.sub}</span> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
