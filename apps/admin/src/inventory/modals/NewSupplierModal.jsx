import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useInventory } from "../InventoryDataContext";

const SUPPLIER_TYPES = [
  { id: "fabric", label: "Fabric" },
  { id: "trim", label: "Trims" },
  { id: "other", label: "Other materials" }
];

function nextSupplierId(suppliers) {
  const nums = suppliers
    .map((s) => parseInt((s.id || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(...nums, 0) + 1;
  return `SUP-${String(next).padStart(3, "0")}`;
}

export default function NewSupplierModal({ onClose, onSubmit }) {
  const { suppliers } = useInventory();
  const [form, setForm] = useState(() => ({
    id: nextSupplierId(suppliers),
    name: "",
    gstin: "",
    address: "",
    contact: "",
    supplierType: "fabric",
    city: "",
    country: "India",
    leadDays: "14",
    paymentTerms: "Net 30"
  }));
  const [saving, setSaving] = useState(false);

  const typeLabel = useMemo(
    () => SUPPLIER_TYPES.find((t) => t.id === form.supplierType)?.label || "Other materials",
    [form.supplierType]
  );

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        id: form.id.trim(),
        name: form.name.trim(),
        gstin: form.gstin.trim(),
        address: form.address.trim(),
        contact: form.contact.trim(),
        supplierType: form.supplierType,
        city: form.city.trim(),
        country: form.country.trim(),
        leadDays: Number(form.leadDays) || 0,
        paymentTerms: form.paymentTerms.trim()
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
          <DialogDescription>Vendor master for fabrics, trims, and other materials.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Supplier code</Label>
              <Input value={form.id} onChange={(e) => set({ id: e.target.value })} className="font-mono" required />
              <p className="text-xs text-muted-foreground">Auto-generated — edit if needed.</p>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Gujarat Textiles Pvt Ltd"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>GSTIN</Label>
              <Input
                value={form.gstin}
                onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
                placeholder="22AAAAA0000A1Z5"
                className="font-mono"
                maxLength={15}
              />
            </div>
            <div className="space-y-2">
              <Label>Contact number</Label>
              <Input
                value={form.contact}
                onChange={(e) => set({ contact: e.target.value })}
                placeholder="+91 98765 43210"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea
              rows={3}
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="Street, area, city, state, PIN"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Surat" />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Input value={form.country} onChange={(e) => set({ country: e.target.value })} placeholder="India" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Supplier type</Label>
            <div className="inline-flex rounded-lg border p-0.5">
              {SUPPLIER_TYPES.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant={form.supplierType === t.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => set({ supplierType: t.id })}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">What you trade from this supplier — {typeLabel}.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Lead time (days)</Label>
              <Input type="number" min="0" value={form.leadDays} onChange={(e) => set({ leadDays: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Payment terms</Label>
              <Input value={form.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="Net 30" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
