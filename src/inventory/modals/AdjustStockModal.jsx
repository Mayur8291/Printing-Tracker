import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";

const REASON_OPTS = {
  IN: ["PO received", "Return from customer", "Production return"],
  OUT: ["Order shipped", "Production cut", "Sample sent", "Damaged write-off"],
  TRANSFER: ["Bin reorganization", "Move to finishing", "Distribution dispatch"],
  ADJUST: ["Cycle count", "Annual stocktake", "System correction"]
};

const TYPE_LABELS = {
  IN: "Receive",
  OUT: "Issue",
  TRANSFER: "Transfer",
  ADJUST: "Adjust"
};

function skuLabel(row) {
  return `${row.id} — ${row.name}${row.color ? ` · ${row.color}` : ""}`;
}

export default function AdjustStockModal({ sku, onClose, onSubmit }) {
  const { fabrics, trims, apparel, warehouses, userDisplayName } = useInventory();
  const [type, setType] = useState("IN");
  const [qty, setQty] = useState(100);
  const [reason, setReason] = useState(REASON_OPTS.IN[0]);
  const [wh, setWh] = useState("");
  const [skuId, setSkuId] = useState("");
  const [note, setNote] = useState("");

  const warehouseName = useMemo(() => warehouses.find((w) => w.id === wh)?.name || wh, [warehouses, wh]);
  const recordedAt = useMemo(() => new Date().toLocaleString(), []);

  useEffect(() => {
    if (sku) {
      setSkuId(sku.id);
      setWh(sku.wh || warehouses[0]?.id || "");
    } else if (!wh && warehouses[0]?.id) {
      setWh(warehouses[0].id);
    }
  }, [sku, warehouses, wh]);

  useEffect(() => {
    setReason(REASON_OPTS[type][0]);
  }, [type]);

  const submit = (e) => {
    e?.preventDefault();
    onSubmit({ type, qty: Number(qty), reason, wh, skuId, note });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="space-y-1.5 border-b px-6 py-5">
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>Record a stock movement in the audit log.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label>Movement type</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["IN", "OUT", "TRANSFER", "ADJUST"].map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={type === t ? "secondary" : "outline"}
                  size="sm"
                  className={cn("h-9 w-full", type === t && "border-foreground/20")}
                  onClick={() => setType(t)}
                >
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-sku">SKU</Label>
            <Select value={skuId || undefined} onValueChange={setSkuId} required>
              <SelectTrigger id="adjust-sku" className="h-10">
                <SelectValue placeholder="Choose SKU…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Fabrics</SelectLabel>
                  {fabrics.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {skuLabel(f)}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Trims</SelectLabel>
                  {trims.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {skuLabel(t)}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Apparel</SelectLabel>
                  {apparel.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {skuLabel(a)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjust-qty">Quantity</Label>
              <Input
                id="adjust-qty"
                type="number"
                min="1"
                className="h-10"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-wh">Warehouse</Label>
              <Select value={wh || undefined} onValueChange={setWh} required>
                <SelectTrigger id="adjust-wh" className="h-10">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="adjust-reason" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTS[type].map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-note">Note (optional)</Label>
            <Textarea
              id="adjust-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any context for the audit log…"
            />
          </div>

          <Alert>
            <AlertDescription className="leading-relaxed">
              This will be recorded in the audit log as <strong className="text-foreground">{type}</strong>
              {warehouseName ? (
                <>
                  {" "}
                  at <strong className="text-foreground">{warehouseName}</strong>
                </>
              ) : null}{" "}
              by <strong className="text-foreground">{userDisplayName}</strong> at{" "}
              <strong className="text-foreground">{recordedAt}</strong>.
            </AlertDescription>
          </Alert>

          <DialogFooter className="gap-2 border-t px-0 pb-0 pt-2 sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Record movement</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
