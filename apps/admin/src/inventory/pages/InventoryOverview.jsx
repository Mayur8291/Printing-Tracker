import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import ColorSwatch from "../components/ColorSwatch";
import Sparkline from "../components/Sparkline";
import StackedBar from "../components/StackedBar";
import { useInventory } from "../InventoryDataContext";
import {
  computeInventoryValue,
  movementMatchesWarehouse,
  onHandAtWarehouse,
  poMatchesWarehouse,
  skusWithScopedAvailability,
  warehouseLabelForMovement
} from "../inventoryFacilityUtils";
import { buildInventoryOverviewKpis } from "../inventoryKpiUtils";
import { deriveAlerts } from "../inventoryDbUtils";
import { exportAllSkusCsv } from "../inventorySkuExportUtils";
import { MovementTypeBadge, PageHeader } from "../inventoryUiUtils";
import { formatRelative, inrFmt } from "../inventoryUtils";

const KPI_ABBREVS = ["₹", "SKU", "!", "PO"];

export default function InventoryOverview({ setActive, openSku, openNewSku, openCreatePO }) {
  const { fabrics, movements, kpiMovements, pos, suppliers, warehouses, skus, settings, availabilityBySku } =
    useInventory();
  const [exporting, setExporting] = useState(false);
  const [warehouseFilter, setWarehouseFilter] = useState("all");

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseFilter) || null;
  const isAllWarehouses = warehouseFilter === "all";

  const allInventoryValueNum = useMemo(
    () => computeInventoryValue(skus, availabilityBySku, warehouses, "all"),
    [skus, availabilityBySku, warehouses]
  );

  const filteredInventoryValueNum = useMemo(() => {
    if (isAllWarehouses) return allInventoryValueNum;
    return computeInventoryValue(skus, availabilityBySku, warehouses, warehouseFilter);
  }, [skus, availabilityBySku, warehouses, warehouseFilter, allInventoryValueNum, isAllWarehouses]);

  const scopedAlerts = useMemo(() => {
    const adjusted = skusWithScopedAvailability(skus, selectedWarehouse, availabilityBySku);
    return deriveAlerts(adjusted, settings);
  }, [skus, selectedWarehouse, availabilityBySku, settings]);

  const openPOs = useMemo(
    () => pos.filter((p) => p.status !== "Received" && poMatchesWarehouse(p, warehouseFilter)),
    [pos, warehouseFilter]
  );
  const openPOValue = openPOs.reduce((s, p) => s + p.value, 0);
  const openPOCount = openPOs.length;

  const kpis = useMemo(
    () =>
      buildInventoryOverviewKpis({
        skus,
        movements: kpiMovements,
        settings,
        pos,
        inventoryValue: inrFmt(filteredInventoryValueNum),
        openPOCount,
        openPOValue: inrFmt(openPOValue),
        alertCount: scopedAlerts.length,
        availabilityBySku,
        warehouseId: warehouseFilter,
        warehouses
      }),
    [
      skus,
      kpiMovements,
      settings,
      pos,
      filteredInventoryValueNum,
      openPOCount,
      openPOValue,
      scopedAlerts.length,
      availabilityBySku,
      warehouseFilter,
      warehouses
    ]
  );

  const fabricBy = useMemo(() => {
    return fabrics.reduce((acc, f) => {
      const stock = selectedWarehouse
        ? onHandAtWarehouse(f, selectedWarehouse, availabilityBySku)
        : Number(f.stock) || 0;
      if (stock <= 0) return acc;
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
      acc[cat] = (acc[cat] || 0) + stock;
      return acc;
    }, {});
  }, [fabrics, selectedWarehouse, availabilityBySku]);

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

  const recentMoves = useMemo(
    () => movements.filter((m) => movementMatchesWarehouse(m, warehouseFilter)).slice(0, 7),
    [movements, warehouseFilter]
  );

  const topAlerts = scopedAlerts.filter((a) => a.severity === "critical").slice(0, 5);

  const incomingShipments = useMemo(
    () => openPOs.filter((p) => p.status === "In Transit").slice(0, 4),
    [openPOs]
  );

  const warehouseScopeLabel = isAllWarehouses
    ? `all ${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"}`
    : selectedWarehouse?.name || "warehouse";

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
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger className="h-9 w-[11rem]" aria-label="Warehouse filter">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <CardDescription>
                {k.label}
                {!isAllWarehouses && selectedWarehouse ? (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{selectedWarehouse.name}</span>
                ) : null}
              </CardDescription>
              <div className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {KPI_ABBREVS[i]}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
              {i === 0 && !isAllWarehouses ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Total all warehouses: <strong className="text-foreground">{inrFmt(allInventoryValueNum)}</strong>
                </p>
              ) : null}
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
                <CardDescription>
                  {isAllWarehouses
                    ? `Total meters across ${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"}`
                    : `Total meters at ${selectedWarehouse?.name || "warehouse"}`}
                </CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActive("fabrics")}>
                View all
              </Button>
            </CardHeader>
            <CardContent>
              {fabricBars.length ? (
                <StackedBar rows={fabricBars} />
              ) : (
                <p className="text-sm text-muted-foreground">No fabric stock{isAllWarehouses ? "" : " at this warehouse"}.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent stock movements</CardTitle>
                <CardDescription>
                  {isAllWarehouses ? "Live feed across all warehouses" : `Live feed · ${selectedWarehouse?.name} only`}
                </CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActive("movements")}>
                View all
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentMoves.length ? (
                recentMoves.map((m) => {
                  const sign = m.qty > 0 ? "+" : "";
                  const whLabel = isAllWarehouses ? warehouseLabelForMovement(m, warehouses) : null;
                  return (
                    <div key={m.id} className="flex items-center gap-3 border-b py-2.5 last:border-0">
                      <MovementTypeBadge type={m.type} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.skuName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.reason} · {m.user} · {formatRelative(new Date(m.ts))} · ref {m.ref}
                          {whLabel ? (
                            <>
                              {" "}
                              · <span className="font-medium text-foreground">{whLabel}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className={cn("shrink-0 text-sm font-medium tabular-nums", m.qty > 0 ? "text-emerald-600" : "text-red-600")}>
                        {sign}
                        {m.qty.toLocaleString()} {m.unit}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  No recent movements{isAllWarehouses ? "" : ` for ${selectedWarehouse?.name || "this warehouse"}`}.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base text-red-600">Critical reorder alerts</CardTitle>
                <CardDescription>
                  {topAlerts.length} items need attention · {warehouseScopeLabel}
                </CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActive("alerts")}>
                All alerts
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {topAlerts.length ? (
                topAlerts.map((a) => (
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
                        {!isAllWarehouses && selectedWarehouse ? (
                          <>
                            {" "}
                            · <strong>{selectedWarehouse.name}</strong>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <Button type="button" size="sm" onClick={() => openCreatePO()}>
                      Reorder
                    </Button>
                  </div>
                ))
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  No critical alerts{isAllWarehouses ? "" : ` for ${selectedWarehouse?.name || "this warehouse"}`}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Incoming shipments</CardTitle>
              <CardDescription>
                {openPOCount} POs · arriving next 30 days · {warehouseScopeLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              {incomingShipments.length ? (
                incomingShipments.map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplier);
                  const poWh = warehouses.find((w) => w.id === p.warehouse);
                  return (
                    <div key={p.id} className="flex items-center gap-3 border-b py-3 last:border-0">
                      <Badge variant="outline" className="shrink-0">
                        In transit
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{p.id}</p>
                        <p className="text-xs text-muted-foreground">
                          {sup?.name} · {sup?.city} · {p.qty.toLocaleString()} units
                          {poWh ? (
                            <>
                              {" "}
                              · <span className="font-medium">{poWh.name}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium">{inrFmt(p.value)}</p>
                        <p className="text-xs text-muted-foreground">ETA {p.eta}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  No incoming shipments{isAllWarehouses ? "" : ` for ${selectedWarehouse?.name || "this warehouse"}`}.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
