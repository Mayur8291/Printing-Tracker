import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInventory } from "../InventoryDataContext";

const WAREHOUSE_TYPES = ["Raw materials", "Finished goods", "Mixed", "Transit"];

function nextWarehouseId(warehouses) {
  const nums = warehouses
    .map((w) => parseInt((w.id || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(...nums, 0) + 1;
  return `WH-${String(next).padStart(2, "0")}`;
}

export default function NewWarehouseModal({ onClose, onSubmit }) {
  const { warehouses } = useInventory();
  const [form, setForm] = useState(() => ({
    id: nextWarehouseId(warehouses),
    name: "",
    city: "",
    type: WAREHOUSE_TYPES[0],
    capacity: "1000",
    facilityCode: ""
  }));
  const [saving, setSaving] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        id: form.id.trim(),
        name: form.name.trim(),
        city: form.city.trim(),
        type: form.type,
        capacity: Number(form.capacity) || 0,
        facilityCode: form.facilityCode.trim()
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add warehouse</DialogTitle>
          <DialogDescription>Storage facility for inventory SKUs.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Warehouse code</Label>
              <Input value={form.id} onChange={(e) => set({ id: e.target.value })} className="font-mono" required />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Unit 2 — RM Store"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Mumbai" required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => set({ type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAREHOUSE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Capacity (units)</Label>
            <Input type="number" min="0" value={form.capacity} onChange={(e) => set({ capacity: e.target.value })} required />
            <p className="text-xs text-muted-foreground">Used for utilization % on the warehouse dashboard.</p>
          </div>

          <div className="space-y-2">
            <Label>Facility code (external)</Label>
            <Input
              value={form.facilityCode}
              onChange={(e) =>
                set({ facilityCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").trim() })
              }
              placeholder="SCOTT_1DAY_01"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Used by the Scott International stock API. Must match their facility code exactly.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add warehouse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
