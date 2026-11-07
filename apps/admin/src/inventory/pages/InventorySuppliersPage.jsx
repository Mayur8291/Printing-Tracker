import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";
import { PageHeader } from "../inventoryUiUtils";
import { inrFmt } from "../inventoryUtils";

const SUPPLIER_TYPE_LABELS = {
  fabric: "Fabric",
  trim: "Trims",
  other: "Other materials"
};

export default function InventorySuppliersPage({ onAddSupplier }) {
  const { suppliers } = useInventory();
  const [view, setView] = useState("grid");
  const countries = [...new Set(suppliers.map((s) => s.country).filter(Boolean))].length;

  if (!suppliers.length) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Suppliers"
          subtitle="No suppliers yet. Add your first vendor to link SKUs and purchase orders."
          actions={
            <Button type="button" onClick={onAddSupplier}>Add supplier</Button>
          }
        />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Capture name, GSTIN, address, contact, and what you trade — fabric, trims, or other materials.
            </p>
            <Button type="button" onClick={onAddSupplier}>Add supplier</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} active suppliers across ${countries || 1} ${countries === 1 ? "country" : "countries"}.`}
        actions={
          <>
            <div className="inline-flex rounded-lg border p-0.5">
              <Button
                type="button"
                variant={view === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("grid")}
              >
                Grid
              </Button>
              <Button
                type="button"
                variant={view === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("list")}
              >
                List
              </Button>
            </div>
            <Button type="button" onClick={onAddSupplier}>Add supplier</Button>
          </>
        }
      />

      {view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {s.city}
                    {s.country ? `, ${s.country}` : ""} · <span className="font-mono">{s.id}</span>
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {SUPPLIER_TYPE_LABELS[s.supplierType] || "Other materials"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.gstin ? <p className="font-mono text-xs text-muted-foreground">GSTIN {s.gstin}</p> : null}
                <p className="text-sm text-muted-foreground">{s.contact}</p>
                {s.address ? <p className="text-xs leading-relaxed text-muted-foreground/80">{s.address}</p> : null}
                <div className="grid grid-cols-3 gap-2 border-t pt-3">
                  <div>
                    <p className="text-lg font-semibold">{s.openPOs}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Open POs</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{s.leadDays}d</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Lead time</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{inrFmt(s.ytdSpend)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">YTD spend</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Lead time</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Open POs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{s.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{SUPPLIER_TYPE_LABELS[s.supplierType] || "Other"}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.gstin || "—"}</TableCell>
                    <TableCell>{s.contact || "—"}</TableCell>
                    <TableCell>
                      {s.city}
                      {s.country ? `, ${s.country}` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.leadDays}d</TableCell>
                    <TableCell>{s.paymentTerms || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.openPOs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
