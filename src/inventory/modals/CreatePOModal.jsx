import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useInventory } from "../InventoryDataContext";
import MasterListSelectField from "@/components/admin/MasterListSelectField";
import { formatInr } from "../inventoryUtils";

export default function CreatePOModal({ initialSku, onClose, onSubmit }) {
  const { skus, fabrics, trims, suppliers, warehouses, pos, quickCreateSupplier, quickCreateWarehouse } =
    useInventory();
  const [supplier, setSupplier] = useState(initialSku?.supplier || suppliers[0]?.id || "");
  const [lines, setLines] = useState(
    initialSku ? [{ skuId: initialSku.id, qty: initialSku.reorder * 2, cost: initialSku.cost }] : [{ skuId: "", qty: 0, cost: 0 }]
  );
  const [eta, setEta] = useState("2026-07-15");
  const [warehouse, setWarehouse] = useState(initialSku?.wh || warehouses[0]?.id || "");
  const [notes, setNotes] = useState("");

  const allSku = skus;

  const updateLine = (i, patch) => {
    setLines((ls) =>
      ls.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        if (patch.skuId) {
          const sku = allSku.find((s) => s.id === patch.skuId);
          if (sku) next.cost = sku.cost;
        }
        return next;
      })
    );
  };

  const addLine = () => setLines((ls) => [...ls, { skuId: "", qty: 0, cost: 0 }]);
  const rmLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const sup = suppliers.find((s) => s.id === supplier);
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  const shipping = subtotal > 0 ? 480 : 0;
  const total = subtotal + shipping;
  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  const submit = (e) => {
    e?.preventDefault();
    onSubmit({ supplier, lines, eta, warehouse, notes, total, totalQty });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create purchase order</DialogTitle>
          <p className="text-sm text-muted-foreground">
            PO-2026-{(pos.length + 1418).toString().padStart(4, "0")} · Draft
          </p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <MasterListSelectField
                label="Supplier"
                id="po-supplier"
                value={supplier}
                onValueChange={setSupplier}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: `${s.name} — ${s.city}, ${s.country}`
                }))}
                onAdd={async (name) => {
                  const row = await quickCreateSupplier(name);
                  return { value: row.id, name: row.name };
                }}
                placeholder="Select supplier"
                addPlaceholder="Supplier name"
                required
              />
              {sup ? (
                <p className="text-xs text-muted-foreground">
                  {sup.leadDays}-day lead · {sup.paymentTerms} · ★ {sup.rating}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <MasterListSelectField
                label="Deliver to"
                id="po-warehouse"
                value={warehouse}
                onValueChange={setWarehouse}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                onAdd={async (name) => {
                  const row = await quickCreateWarehouse(name);
                  return { value: row.id, name: row.name };
                }}
                placeholder="Select warehouse"
                addPlaceholder="Warehouse name"
                required
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Requested ETA:</span>
                <DatePicker className="h-8 w-auto min-w-[10rem]" value={eta} onChange={setEta} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items</Label>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="w-24 text-right">Qty</TableHead>
                    <TableHead className="w-28 text-right">Unit cost</TableHead>
                    <TableHead className="w-28 text-right">Line total</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => {
                    const sku = allSku.find((s) => s.id === l.skuId);
                    const lineTotal = (Number(l.qty) || 0) * (Number(l.cost) || 0);
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={l.skuId || undefined} onValueChange={(v) => updateLine(i, { skuId: v })}>
                            <SelectTrigger className="h-8 border-0 bg-transparent shadow-none">
                              <SelectValue placeholder="Choose SKU…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Fabrics</SelectLabel>
                                {fabrics.filter((f) => f.supplier === supplier).map((f) => (
                                  <SelectItem key={f.id} value={f.id}>
                                    {f.id} — {f.name} · {f.color}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel>Trims</SelectLabel>
                                {trims.filter((t) => t.supplier === supplier).map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.id} — {t.name} · {t.color}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {sku && (
                            <p className="pl-1 text-[11px] text-muted-foreground">
                              {sku.unit} · reorder at {sku.reorder.toLocaleString()}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="h-8 border-0 bg-transparent text-right shadow-none"
                            value={l.qty}
                            onChange={(e) => updateLine(i, { qty: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 border-0 bg-transparent text-right shadow-none"
                            value={l.cost}
                            onChange={(e) => updateLine(i, { cost: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatInr(lineTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="sm" onClick={() => rmLine(i)}>
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={addLine}>
              Add line
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label>Internal notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Spec sheets, color approvals, special handling…" />
            </div>
            <div className="min-w-[200px] rounded-md bg-muted p-3 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatInr(subtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Shipping (est.)</span>
                <span className="tabular-nums">{formatInr(shipping, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Qty</span>
                <span className="tabular-nums">{totalQty.toLocaleString()}</span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatInr(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="outline">
              Save draft
            </Button>
            <Button type="submit">
              Send to {sup?.name.split(" ")[0]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
