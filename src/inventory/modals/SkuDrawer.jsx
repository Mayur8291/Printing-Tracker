import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import ColorSwatch from "../components/ColorSwatch";
import { useInventory } from "../InventoryDataContext";
import { INVENTORY_DRR_LOOKBACK_DAYS, formatDrr } from "../inventoryDrrUtils";
import { MovementTypeBadge, StockStatusBadge } from "../inventoryUiUtils";
import { formatInr, formatRelative, isApparelSku, statusOf } from "../inventoryUtils";

function KvGrid({ children }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>;
}

function KvLabel({ children }) {
  return <dt className="text-muted-foreground">{children}</dt>;
}

function KvValue({ children, className }) {
  return <dd className={cn("font-medium", className)}>{children}</dd>;
}

export default function SkuDrawer({ sku, onClose, onAdjust, onReorder, onDelete, deleting, movements: drawerMovements, detailLoading = false }) {
  const { suppliers, warehouses, settings, saveSkuFields } = useInventory();
  const [metricsDraft, setMetricsDraft] = useState(null);
  const [savingMetrics, setSavingMetrics] = useState(false);

  const isApparel = sku ? isApparelSku(sku) : false;
  const stock = sku?.stock ?? sku?.totalStock;
  const supplier = sku ? suppliers.find((s) => s.id === sku.supplier) : null;
  const wh = sku ? warehouses.find((w) => w.id === sku.wh) : null;
  const status = sku ? statusOf(sku, settings) : null;
  const metrics = metricsDraft || {
    reorder: String(sku?.reorder ?? 0),
    doc: String(sku?.doc ?? 0),
    cost: String(sku?.cost ?? 0),
    retail: String(sku?.retail ?? 0)
  };
  const history = sku ? (drawerMovements ?? []).slice(0, 6) : [];

  const setMetric = (key, value) => {
    setMetricsDraft((prev) => ({ ...(prev || metrics), [key]: value }));
  };

  const saveMetrics = async () => {
    if (!sku?._uuid) return;
    setSavingMetrics(true);
    try {
      await saveSkuFields(sku._uuid, {
        reorder: metrics.reorder,
        doc: metrics.doc,
        cost: metrics.cost,
        retail: metrics.retail
      });
      setMetricsDraft(null);
    } finally {
      setSavingMetrics(false);
    }
  };

  return (
    <Sheet open={!!sku} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        {sku ? (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-start gap-3 pr-6">
                <ColorSwatch color={sku.color} hex={sku.hex} size="lg" title={sku.color} />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">{sku.name}</SheetTitle>
                  <SheetDescription>
                    <span className="font-mono">{sku.id}</span>
                    {sku.color && <> · {sku.color}</>}
                  </SheetDescription>
                  <div className="mt-2">
                    <StockStatusBadge status={status} />
                  </div>
                </div>
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-6 pb-4">
                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Specifications</h4>
                  <KvGrid>
                    {isApparel ? (
                      <>
                        <KvLabel>Category</KvLabel>
                        <KvValue>{sku.category}</KvValue>
                        <KvLabel>Season</KvLabel>
                        <KvValue>{sku.season}</KvValue>
                        <KvLabel>Colorway</KvLabel>
                        <KvValue>
                          <span className="inline-flex items-center gap-1.5">
                            <ColorSwatch color={sku.color} hex={sku.hex} />
                            {sku.color}
                          </span>
                        </KvValue>
                        <KvLabel>Unit cost</KvLabel>
                        <KvValue>{formatInr(sku.cost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</KvValue>
                        <KvLabel>Sale price</KvLabel>
                        <KvValue>{formatInr(sku.retail, { maximumFractionDigits: 0 })}</KvValue>
                        {sku.retail > 0 ? (
                          <>
                            <KvLabel>Margin</KvLabel>
                            <KvValue>{Math.round((1 - sku.cost / sku.retail) * 100)}%</KvValue>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <KvLabel>Composition</KvLabel>
                        <KvValue>{sku.composition || "—"}</KvValue>
                        {sku.gsm ? (
                          <>
                            <KvLabel>Weight</KvLabel>
                            <KvValue>{sku.gsm} g/m²</KvValue>
                          </>
                        ) : null}
                        {sku.width ? (
                          <>
                            <KvLabel>Width</KvLabel>
                            <KvValue>{sku.width} cm</KvValue>
                          </>
                        ) : null}
                        {sku.type ? (
                          <>
                            <KvLabel>Type</KvLabel>
                            <KvValue>{sku.type}</KvValue>
                          </>
                        ) : null}
                        {sku.size ? (
                          <>
                            <KvLabel>Size</KvLabel>
                            <KvValue>{sku.size}</KvValue>
                          </>
                        ) : null}
                        <KvLabel>Color</KvLabel>
                        <KvValue>
                          <span className="inline-flex items-center gap-1.5">
                            <ColorSwatch color={sku.color} hex={sku.hex} />
                            {sku.color}
                          </span>
                        </KvValue>
                        <KvLabel>Unit cost</KvLabel>
                        <KvValue>
                          {formatInr(sku.cost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {sku.unit}
                        </KvValue>
                        <KvLabel>Sale price</KvLabel>
                        <KvValue>{formatInr(sku.retail, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</KvValue>
                      </>
                    )}
                  </KvGrid>
                </section>

                {isApparel && (
                  <section>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock by size</h4>
                    <div
                      className="grid gap-px overflow-hidden rounded-md border text-center text-sm"
                      style={{ gridTemplateColumns: `repeat(${Object.keys(sku.sizes).length}, 1fr)` }}
                    >
                      {Object.keys(sku.sizes).map((s) => (
                        <div key={`h${s}`} className="bg-muted px-2 py-1.5 text-xs font-medium">
                          {s}
                        </div>
                      ))}
                      {Object.entries(sku.sizes).map(([s, v]) => (
                        <div
                          key={s}
                          className={cn(
                            "px-2 py-2 tabular-nums",
                            v === 0 && "text-muted-foreground",
                            v > 0 && v < 50 && "text-amber-600"
                          )}
                        >
                          {v.toLocaleString()}
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Total <strong>{sku.totalStock.toLocaleString()}</strong> units · reorder threshold{" "}
                      {sku.reorder.toLocaleString()}
                    </p>
                  </section>
                )}

                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing & replenishment</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Unit cost (₹)</Label>
                      <Input type="number" min={0} step="0.01" className="h-8" value={metrics.cost} onChange={(e) => setMetric("cost", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Sale price (₹)</Label>
                      <Input type="number" min={0} step="0.01" className="h-8" value={metrics.retail} onChange={(e) => setMetric("retail", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Reorder point</Label>
                      <Input type="number" min={0} className="h-8" value={metrics.reorder} onChange={(e) => setMetric("reorder", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">DOC</Label>
                      <Input type="number" min={0} step="0.01" className="h-8" value={metrics.doc} onChange={(e) => setMetric("doc", e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">DRR</Label>
                      <p className="text-sm font-medium tabular-nums">{formatDrr(sku?.drr)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Auto from order transactions (last {INVENTORY_DRR_LOOKBACK_DAYS} days)
                      </p>
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="mt-3" disabled={savingMetrics} onClick={saveMetrics}>
                    {savingMetrics ? "Saving…" : "Save pricing & metrics"}
                  </Button>
                </section>

                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock & location</h4>
                  <KvGrid>
                    <KvLabel>On hand</KvLabel>
                    <KvValue>
                      {stock.toLocaleString()} {sku.unit || "units"}
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {formatInr(stock * sku.cost, { maximumFractionDigits: 0 })} value
                      </span>
                    </KvValue>
                    <KvLabel>Warehouse</KvLabel>
                    <KvValue>
                      {wh?.name}
                      <span className="ml-1 font-normal text-muted-foreground">
                        · <span className="font-mono">{sku.wh}</span>
                      </span>
                    </KvValue>
                    {sku.bin ? (
                      <>
                        <KvLabel>Bin</KvLabel>
                        <KvValue className="font-mono">{sku.bin}</KvValue>
                      </>
                    ) : null}
                    <KvLabel>Last received</KvLabel>
                    <KvValue>{sku.lastIn || "—"}</KvValue>
                  </KvGrid>
                </section>

                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supplier</h4>
                  {supplier ? (
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                      <Avatar className="size-9">
                        <AvatarFallback>{supplier.name?.[0] || "?"}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{supplier.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{supplier.id}</span> · {supplier.city}, {supplier.country} ·{" "}
                          {supplier.leadDays}d lead · ★ {supplier.rating}
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm">
                        View
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No supplier linked.</p>
                  )}
                </section>

                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h4>
                  {detailLoading ? (
                    <p className="text-sm text-muted-foreground">Loading activity…</p>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No movements logged yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {history.map((m) => {
                        const sign = m.qty > 0 ? "+" : "";
                        return (
                          <div key={m.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                            <MovementTypeBadge type={m.type} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm">{m.reason}</p>
                              <p className="text-xs text-muted-foreground">
                                {m.user} · {formatRelative(new Date(m.ts))} · ref {m.ref}
                              </p>
                            </div>
                            <span className={cn("text-sm tabular-nums", m.qty > 0 ? "text-emerald-600" : "text-red-600")}>
                              {sign}
                              {m.qty.toLocaleString()} {m.unit}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </ScrollArea>

            <Separator />

            <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 sm:justify-between">
              <div>
                {onDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleting || !sku._uuid}
                    onClick={() => onDelete(sku)}
                  >
                    {deleting ? "Deleting…" : "Delete SKU"}
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button type="button" variant="outline" onClick={() => onAdjust(sku)}>
                  Adjust stock
                </Button>
                <Button type="button" onClick={() => onReorder(sku)}>
                  Reorder
                </Button>
              </div>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
