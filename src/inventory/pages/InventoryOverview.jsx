import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ColorSwatch from "../components/ColorSwatch";
import Sparkline from "../components/Sparkline";
import StackedBar from "../components/StackedBar";
import { useInventory } from "../InventoryDataContext";
import { buildInventoryOverviewKpis } from "../inventoryKpiUtils";
import { exportAllSkusCsv } from "../inventorySkuExportUtils";
import { MovementTypeBadge, PageHeader } from "../inventoryUiUtils";
import { formatRelative, inrFmt } from "../inventoryUtils";

const KPI_ABBREVS = ["₹", "SKU", "!", "PO"];

export default function InventoryOverview({ setActive, openSku, openNewSku, openCreatePO }) {
  const { fabrics, trims, apparel, alerts, movements, kpiMovements, pos, suppliers, warehouses, skus, settings, availabilityBySku } =
    useInventory();
  const [exporting, setExporting] = useState(false);
  const availableQty = (sku, fallback) => {
    const entry = availabilityBySku?.[sku.id];
    return entry ? Number(entry.available) || 0 : fallback;
  };
  const inventoryValueNum =
    fabrics.reduce((s, f) => s + availableQty(f, f.stock) * f.cost, 0) +
    trims.reduce((s, t) => s + availableQty(t, t.stock) * t.cost, 0) +
    apparel.reduce((s, a) => s + availableQty(a, a.totalStock) * a.cost, 0);

  const openPOValue = pos.filter((p) => p.status !== "Received").reduce((s, p) => s + p.value, 0);
  const openPOCount = pos.filter((p) => p.status !== "Received").length;

  const kpis = useMemo(
    () =>
      buildInventoryOverviewKpis({
        skus,
        movements: kpiMovements,
        settings,
        pos,
        inventoryValue: inrFmt(inventoryValueNum),
        openPOCount,
        openPOValue: inrFmt(openPOValue),
        alertCount: alerts.length,
        availabilityBySku
      }),
    [skus, kpiMovements, settings, pos, inventoryValueNum, openPOCount, openPOValue, alerts.length, availabilityBySku]
  );

  const fabricBy = fabrics.reduce((acc, f) => {
    const cat = f.tags?.includes("denim")
      ? "Denim"
      : f.tags?.includes("knit")
        ? "Knit"
        : f.tags?.includes("linen")
          ? "Linen"
          : f.tags?.includes("wool")
            ? "Wool"
            : f.tags?.includes("shirting")
              ? "Shirting"
              : "Other Wovens";
    acc[cat] = (acc[cat] || 0) + f.stock;
    return acc;
  }, {});

  const fabricBars = Object.entries(fabricBy)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      segments: [
        {
          label,
          value,
          color: {
            Denim: "#3a4b8a",
            Knit: "#5b4ce5",
            Linen: "#a14a2a",
            Wool: "#5e2330",
            Shirting: "#1c66d6",
            "Other Wovens": "#6c7252"
          }[label]
        }
      ]
    }));

  const recentMoves = movements.slice(0, 7);
  const topAlerts = alerts.filter((a) => a.severity === "critical").slice(0, 5);

  async function handleExportSkus() {
    setExporting(true);
    try {
      await exportAllSkusCsv({ suppliers, warehouses });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not export SKUs.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={
          <>
            {warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"} · Live from database{" "}
            <span className="ml-1.5 inline-block size-2 animate-pulse rounded-full bg-emerald-500 align-middle" />
          </>
        }
        actions={
          <>
            <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={handleExportSkus}>
              {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button type="button" size="sm" onClick={() => openNewSku("fabric")}>
              New SKU
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k, i) => (
          <Card key={k.label}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardDescription>{k.label}</CardDescription>
              <div className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {KPI_ABBREVS[i]}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                {k.delta ? (
                  <span className={cn("font-medium", k.dir === "up" ? "text-emerald-600" : "text-red-600")}>
                    {k.dir === "up" ? "↑" : "↓"} {k.delta}
                  </span>
                ) : null}
                <span>{k.sub || "vs last 14d"}</span>
              </div>
              <div className="mt-3 h-8">
                <Sparkline data={k.spark} color={k.sparkColor || "hsl(var(--primary))"} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Fabric stock by category</CardTitle>
                <CardDescription>Total meters in 5 warehouses</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActive("fabrics")}>
                View all
              </Button>
            </CardHeader>
            <CardContent>
              <StackedBar rows={fabricBars} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent stock movements</CardTitle>
                <CardDescription>Live feed across all warehouses</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActive("movements")}>
                View all
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentMoves.map((m) => {
                const sign = m.qty > 0 ? "+" : "";
                return (
                  <div key={m.id} className="flex items-center gap-3 border-b py-2.5 last:border-0">
                    <MovementTypeBadge type={m.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.skuName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.reason} · {m.user} · {formatRelative(new Date(m.ts))} · ref {m.ref}
                      </p>
                    </div>
                    <div className={cn("shrink-0 text-sm font-medium tabular-nums", m.qty > 0 ? "text-emerald-600" : "text-red-600")}>
                      {sign}
                      {m.qty.toLocaleString()} {m.unit}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base text-red-600">Critical reorder alerts</CardTitle>
                <CardDescription>{topAlerts.length} items need attention</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActive("alerts")}>
                All alerts
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {topAlerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Badge variant="destructive" className="mt-0.5 shrink-0">
                    Critical
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      <ColorSwatch color={a.color} hex={a.hex} size="xs" />
                      {a.name}
                      {a.color ? ` · ${a.color}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.id} · {a.message} · on hand <strong>{a.stock.toLocaleString()}</strong> / reorder at{" "}
                      <strong>{a.reorder.toLocaleString()}</strong>
                    </p>
                  </div>
                  <Button type="button" size="sm" onClick={() => openCreatePO()}>
                    Reorder
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Incoming shipments</CardTitle>
              <CardDescription>{openPOCount} POs · arriving next 30 days</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              {pos
                .filter((p) => p.status === "In Transit")
                .slice(0, 4)
                .map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplier);
                  return (
                    <div key={p.id} className="flex items-center gap-3 border-b py-3 last:border-0">
                      <Badge variant="outline" className="shrink-0">
                        In transit
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{p.id}</p>
                        <p className="text-xs text-muted-foreground">
                          {sup?.name} · {sup?.city} · {p.qty.toLocaleString()} units
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium">{inrFmt(p.value)}</p>
                        <p className="text-xs text-muted-foreground">ETA {p.eta}</p>
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
