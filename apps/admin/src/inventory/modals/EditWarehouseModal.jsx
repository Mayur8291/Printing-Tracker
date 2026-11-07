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

const WAREHOUSE_TYPES = ["Raw materials", "Finished goods", "Mixed", "Transit"];

function cleanFacilityCode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
}

/**
 * Edit warehouse fields (name, city, type, capacity, facility code).
 * Internal warehouse id is read-only — it is the FK used by SKUs.
 * Changing facility_code is propagated by the DB trigger to facility stock,
 * open reservations, open Scott orders, and channel defaults — Stock/Order
 * API contracts stay unchanged.
 */
export default function EditWarehouseModal({ warehouse, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({
    name: warehouse?.name ?? "",
    city: warehouse?.city ?? "",
    type: warehouse?.type || WAREHOUSE_TYPES[0],
    capacity: String(warehouse?.capacity ?? 1000),
    facilityCode: warehouse?.facilityCode ?? ""
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const facilityChanged =
    cleanFacilityCode(form.facilityCode) !== cleanFacilityCode(warehouse?.facilityCode ?? "");

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        name: form.name.trim(),
        city: form.city.trim(),
        type: form.type,
        capacity: Number(form.capacity) || 0,
        facilityCode: cleanFacilityCode(form.facilityCode)
      });
    } catch (err) {
      setError(
        err?.message?.includes("duplicate") || err?.code === "23505"
          ? `Facility code "${cleanFacilityCode(form.facilityCode)}" is already used by another warehouse.`
          : err?.message || "Could not save warehouse."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit warehouse</DialogTitle>
          <DialogDescription>
            Update storage details. Changing the external facility code updates stock, open
            reservations, and open app orders to keep the Stock &amp; Order APIs in sync.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Warehouse code</Label>
              <Input value={warehouse?.id ?? ""} className="font-mono" disabled readOnly />
              <p className="text-xs text-muted-foreground">Internal id — cannot change (used by SKUs).</p>
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
          </div>

          <div className="space-y-2">
            <Label>Facility code (external)</Label>
            <Input
              value={form.facilityCode}
              onChange={(e) => set({ facilityCode: cleanFacilityCode(e.target.value) })}
              placeholder="SCOTT_1DAY_01"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Used by the Scott International stock &amp; order APIs. Must match their facility code exactly.
            </p>
            {facilityChanged ? (
              <p className="text-xs text-amber-700">
                Renaming will update facility stock, open reservations, open Ready Stock orders, and
                channel defaults that used the old code.
              </p>
            ) : null}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
