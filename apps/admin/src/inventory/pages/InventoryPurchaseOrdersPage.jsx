import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";
import { PageHeader, PoStatusBadge } from "../inventoryUiUtils";
import { formatInr, inrFmt } from "../inventoryUtils";

export default function InventoryPurchaseOrdersPage({ openCreatePO }) {
  const { pos, suppliers, warehouses } = useInventory();
  const [filter, setFilter] = useState("all");
  const statuses = ["all", "Draft", "Awaiting Approval", "Approved", "In Production", "In Transit", "Received"];
  const filtered = filter === "all" ? pos : pos.filter((p) => p.status === filter);

  const totalValue = filtered.reduce((s, p) => s + p.value, 0);
  const totalQty = filtered.reduce((s, p) => s + p.qty, 0);
  const openValue = pos.filter((p) => p.status !== "Received").reduce((s, p) => s + p.value, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        subtitle={`${pos.filter((p) => p.status !== "Received").length} open · ${inrFmt(openValue)} on order across ${suppliers.length} suppliers.`}
        actions={
          <>
            <Button type="button" variant="outline" size="sm">
              Export
            </Button>
            <Button type="button" size="sm" onClick={() => openCreatePO()}>
              New PO
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <Tabs value={filter} onValueChange={setFilter}>
              <ScrollArea className="w-full">
                <TabsList className="h-auto w-max">
                  {statuses.map((s) => (
                    <TabsTrigger key={s} value={s} className="gap-1.5">
                      {s === "all" ? "All" : s}
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                        {s === "all" ? pos.length : pos.filter((p) => p.status === s).length}
                      </Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </Tabs>
            <div className="lg:w-56">
              <Input placeholder="Search PO, supplier, SKU…" />
            </div>
            <div className="text-xs text-muted-foreground lg:ml-auto">
              <strong className="text-foreground">{filtered.length}</strong> POs ·{" "}
              <strong className="text-foreground">{totalQty.toLocaleString()}</strong> units ·{" "}
              <strong className="text-foreground">{formatInr(totalValue, { maximumFractionDigits: 0 })}</strong>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplier);
                  const wh = warehouses.find((w) => w.id === p.warehouse);
                  const isLate = new Date(p.eta) < new Date("2026-06-10") && p.status !== "Received";
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">{sup?.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {sup?.city}, {sup?.country}
                        </div>
                      </TableCell>
                      <TableCell>
                        <PoStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.items}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatInr(p.value, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell>{wh?.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.created}</TableCell>
                      <TableCell>
                        <span className={cn(isLate && "text-red-600")}>{p.eta}</span>
                        {isLate && (
                          <Badge variant="destructive" className="ml-2">
                            Late
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="sm">
                          Actions
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
