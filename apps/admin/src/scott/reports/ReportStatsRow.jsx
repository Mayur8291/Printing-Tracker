// Stat tiles for a report.
//
// The registry is explicit that `stats.compute` runs over the FULL dataset, never over one
// page — a "Total Value" that only counted the visible 20 rows would be wrong. So the tiles
// own their own drain (`request.fetchAll`, which is cached and shared with the table and the
// CSV export inside `reportRequests.js`) and load independently of the table: the rows paint
// immediately and the tiles fill in behind them.
//
// COUNT TILES DO NOT COME FROM THE AGGREGATE. Any tile may declare `source:
// "paginationTotal"`, which reads the LIST's pagination total instead — reproduced upstream
// behaviour (`resolveRmpSalesOverviewTotalOrders`, `useSortedScottList.ts`), not an
// oversight: when pagy is missing the two figures legitimately disagree and the pagination
// number is the one the original dashboard showed.
//
// That is also why such a tile MUST NOT depend on the drain. RMP Order Reports is ~95k rows;
// its drain can time out, and before this every tile — including a count that page 1 already
// knew exactly — collapsed into a single "Summary unavailable" card. Now the drain-free
// tiles render on their own while the aggregate is still loading, and survive its failure.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolveRmpSalesOverviewTotalOrders } from "@/scott/data/reports/rmpSalesService";
import ScottStatCards from "@/scott/ui/ScottStatCards";
import { formatScottCurrency } from "@/scott/ui/ScottTable";

/**
 * Drain the report's dataset and run its `compute`.
 *
 * @param {object} args
 * @param {object} [args.stats] `{ tiles, compute }` from the registry (null = no tiles).
 * @param {{cacheKey: string, fetchAll: () => Promise<object[]>}} args.request
 * @param {number} [args.reloadToken] bump to force a refetch.
 */
export function useReportStats({ stats, request, reloadToken = 0 }) {
  const [value, setValue] = useState(null);
  const [rowCount, setRowCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(stats?.compute));
  const [error, setError] = useState("");

  const compute = stats?.compute;
  const cacheKey = request?.cacheKey ?? "";
  const fetchAll = request?.fetchAll;

  useEffect(() => {
    if (typeof compute !== "function" || typeof fetchAll !== "function") {
      setValue(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const rows = await fetchAll();
        if (cancelled) return;
        setRowCount(Array.isArray(rows) ? rows.length : 0);
        setValue(compute(rows));
      } catch (err) {
        if (cancelled) return;
        setValue(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `cacheKey` encodes report + tab + applied filters, so it is the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, compute, reloadToken]);

  return { stats: value, rowCount, loading, error };
}

/** A tile whose value comes from somewhere other than the drained aggregate. */
export function isDrainFreeTile(tile) {
  return tile?.source === "paginationTotal";
}

/** True when at least one tile can be resolved without draining the dataset. */
export function hasDrainFreeTiles(tiles) {
  return (Array.isArray(tiles) ? tiles : []).some((tile) => isDrainFreeTile(tile));
}

/**
 * One tile's value. `source` is the general mechanism — a tile either reads the aggregate
 * (the default) or a drain-free context field.
 */
export function resolveStatTileValue(tile, stats, context = {}) {
  if (isDrainFreeTile(tile)) {
    // Same rule as upstream: pagination total, falling back to the rows actually in hand.
    return resolveRmpSalesOverviewTotalOrders(
      { totalCount: context.paginationTotal },
      context.rows ?? []
    );
  }
  return stats?.[tile.key];
}

/**
 * Registry tiles + a computed stats object -> `ScottStatCards` tiles.
 * @param {Array<object>} tiles
 * @param {object|null} stats
 * @param {{paginationTotal?: number, rows?: object[], pending?: boolean}} context
 *   `pending` marks the aggregate as still loading: drain-free tiles keep their real value,
 *   the rest render blank with a "Loading…" subtitle.
 */
export function buildStatTiles(tiles, stats, context = {}) {
  return (Array.isArray(tiles) ? tiles : []).filter(Boolean).map((tile) => {
    const value = resolveStatTileValue(tile, stats, context);
    const pending = context.pending === true && !isDrainFreeTile(tile);

    return {
      key: tile.key,
      label: tile.label,
      format: tile.format,
      decimals: tile.decimals,
      // `ScottStatCards` already renders `—` for null/undefined/''.
      value: pending || value === undefined ? null : value,
      sub: pending ? "Loading…" : undefined
    };
  });
}

/**
 * The "Customer Type Sales" card grid under the RMP Sales Overview tiles.
 *
 * `computeCustomerTypeBreakdown` has always run on every Overview drain; before this it fed
 * nothing, so the card the spec documents (reports.md §11 "Also renders a 'Customer Type
 * Sales' breakdown card grid (type → units · ₹amount)") never appeared. Rendering is driven
 * purely by the presence of `stats.customerTypeBreakdown`, so no other report is affected.
 *
 * @param {object} props
 * @param {Array<{type: string, qty: number, amount: number}>} [props.rows]
 * @param {string} [props.title]
 */
export function ReportBreakdownCards({ rows, title = "Customer Type Sales" }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (list.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">{title}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((entry) => (
            <div key={String(entry.type)} className="rounded-lg border p-3 text-sm">
              <p className="font-medium capitalize">{String(entry.type)}</p>
              <p className="text-muted-foreground tabular-nums">
                {Number(entry.qty ?? 0).toLocaleString("en-IN")} units ·{" "}
                {formatScottCurrency(entry.amount ?? 0)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * @param {object} props
 * @param {Array<object>} [props.tiles] registry tile descriptors.
 * @param {object|null} [props.stats] the computed stats object.
 * @param {boolean} [props.loading]
 * @param {string} [props.error]
 * @param {number} [props.paginationTotal] the list's total, for `source: "paginationTotal"`.
 * @param {object[]} [props.rows] current page rows, the fallback for that same tile.
 * @param {() => void} [props.onRetry]
 */
export default function ReportStatsRow({
  tiles = [],
  stats = null,
  loading = false,
  error = "",
  paginationTotal,
  rows = [],
  onRetry
}) {
  const list = Array.isArray(tiles) ? tiles.filter(Boolean) : [];
  const retry = useCallback(() => onRetry?.(), [onRetry]);

  if (list.length === 0) return null;

  const drainFree = hasDrainFreeTiles(list);
  const columns = Math.min(6, Math.max(2, list.length));

  // Drain failed. The aggregate tiles are genuinely unavailable, but a `paginationTotal`
  // tile never needed the drain, so it still renders — with the failure reported beneath it
  // rather than in place of the whole row.
  if (error) {
    const failed = (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-destructive">
            {drainFree ? "Totals unavailable" : "Summary unavailable"} — {error}
          </p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );

    if (!drainFree) return failed;

    return (
      <div className="space-y-4">
        <ScottStatCards
          stats={buildStatTiles(
            list.filter((tile) => isDrainFreeTile(tile)),
            null,
            { paginationTotal, rows }
          )}
          columns={Math.min(6, Math.max(2, list.filter((tile) => isDrainFreeTile(tile)).length))}
        />
        {failed}
      </div>
    );
  }

  // While the drain is in flight, a row that contains a drain-free tile is rendered for real
  // (that tile is already exact) with the aggregate tiles marked "Loading…"; a row with no
  // drain-free tile keeps the plain skeleton.
  if (loading && drainFree) {
    return (
      <ScottStatCards
        stats={buildStatTiles(list, stats, { paginationTotal, rows, pending: true })}
        columns={columns}
      />
    );
  }

  return (
    <ScottStatCards
      stats={buildStatTiles(list, stats, { paginationTotal, rows })}
      loading={loading}
      columns={columns}
      skeletonCount={list.length}
    />
  );
}
