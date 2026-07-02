import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";
import { PageHeader } from "../inventoryUiUtils";

function buildBins(seed) {
  const bins = [];
  let r = seed;
  for (let i = 0; i < 80; i++) {
    r = (r * 9301 + 49297) % 233280;
    const fillType = r / 233280;
    bins.push(fillType < 0.15 ? "full" : fillType < 0.55 ? "filled" : "empty");
  }
  return bins;
}

function BinCell({ state, label }) {
  return (
    <div
      title={label}
      className={cn(
        "flex h-7 items-center justify-center rounded border text-[9px] font-mono",
        state === "empty" && "border-dashed bg-muted/30 text-muted-foreground/50",
        state === "filled" && "border-primary/30 bg-primary/10 text-primary",
        state === "full" && "border-primary bg-primary/20 font-medium text-primary"
      )}
    >
      {state === "empty" ? "" : label.replace("A-", "").replace("-", "")}
    </div>
  );
}

export default function InventoryWarehousesPage({ onAddWarehouse }) {
  const { warehouses, skus, pos } = useInventory();
  const [selected, setSelected] = useState(warehouses[0]?.id || "");
  const wh = warehouses.find((w) => w.id === selected) || warehouses[0];
  const skusHere = skus.filter((s) => s.wh === selected);
  const utilPct = wh?.capacity ? Math.round((wh.used / wh.capacity) * 100) : 0;
  const bins = useMemo(() => buildBins((selected || "x").length * 17), [selected]);

  if (!warehouses.length) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Warehouses"
          subtitle="No warehouses yet. Add a storage facility to assign SKUs and track utilization."
          actions={
            <Button type="button" onClick={onAddWarehouse}>Add warehouse</Button>
          }
        />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Set up raw material, finished goods, or mixed storage locations for your inventory.
            </p>
            <Button type="button" onClick={onAddWarehouse}>Add warehouse</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!wh) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouses"
        subtitle={`${warehouses.length} facilities · ${warehouses.reduce((s, w) => s + w.used, 0).toLocaleString()} of ${warehouses.reduce((s, w) => s + w.capacity, 0).toLocaleString()} pallets used.`}
        actions={
          <Button type="button" onClick={onAddWarehouse}>Add warehouse</Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {warehouses.map((w) => {
            const pct = Math.round((w.used / w.capacity) * 100);
            const isActive = w.id === selected;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelected(w.id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  isActive ? "border-foreground bg-muted/50" : "border-border bg-card hover:bg-muted/30"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{w.name}</p>
                    <p className="text-xs text-muted-foreground">{w.city}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {w.type}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {w.used.toLocaleString()} / {w.capacity.toLocaleString()} pallets · {pct}%
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", pct > 85 ? "bg-amber-500" : "bg-primary")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{wh.name}</CardTitle>
                <CardDescription>
                  <span className="font-mono">{wh.id}</span> · {wh.city} · {wh.type}
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm">
                Layout
              </Button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Utilization</p>
                <p className="text-2xl font-semibold">{utilPct}%</p>
                <p className="text-xs text-muted-foreground">
                  {wh.used.toLocaleString()} of {wh.capacity.toLocaleString()} pallets
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">SKUs stored</p>
                <p className="text-2xl font-semibold">{skusHere.length}</p>
                <p className="text-xs text-muted-foreground">
                  across {[...new Set(skusHere.map((s) => (s.bin || "").slice(0, 3)))].length} zones
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Inbound (next 14d)</p>
                <p className="text-2xl font-semibold">{pos.filter((p) => p.warehouse === wh?.id && p.status !== "Received").length}</p>
                <p className="text-xs text-muted-foreground">POs scheduled</p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="border-b py-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Bin map · zone A</p>
            <p className="mb-3 text-xs text-muted-foreground">Hover bins to see contents. Click an empty bin to assign a SKU.</p>
            <div className="grid grid-cols-10 gap-1">
              {bins.map((state, i) => {
                const col = (i % 10) + 1;
                const row = Math.floor(i / 10) + 1;
                const label = `A-${row.toString().padStart(2, "0")}-${col.toString().padStart(2, "0")}`;
                return <BinCell key={i} state={state} label={label} />;
              })}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-dashed bg-muted/30" /> Empty
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-primary/30 bg-primary/10" /> Partial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-primary bg-primary/20" /> Full
              </span>
            </div>
          </CardContent>

          <CardContent className="pt-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Top SKUs in this warehouse</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Bin</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skusHere.slice(0, 6).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell>
                      {s.name} · {s.color}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.bin || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(s.stock ?? s.totalStock).toLocaleString()} {s.unit || "pc"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
