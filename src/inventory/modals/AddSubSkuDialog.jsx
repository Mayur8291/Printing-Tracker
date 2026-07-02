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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInventory } from "../InventoryDataContext";
import { nextSkuCode } from "../inventorySkuGrouping";

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

function blankForm(parent, kind, { apparel, fabrics, trims, warehouses }) {
  const pool = kind === "apparel" ? apparel : kind === "fabric" ? fabrics : trims;
  const defaultWh = warehouses[0]?.id || "";
  const today = new Date().toISOString().slice(0, 10);

  const base = {
    id: nextSkuCode(kind, pool),
    name: parent.styleName,
    color: "",
    hex: "#cccccc",
    supplier: "",
    wh: defaultWh,
    bin: "",
    lastIn: today,
    tags: [],
    reorder: kind === "apparel" ? 300 : kind === "fabric" ? 500 : 200,
    doc: 0,
    drr: 0,
    cost: 0,
    retail: 0,
    parentMode: "existing",
    parentStyleId: parent.id,
    parentStyleName: parent.styleName
  };

  if (kind === "fabric") {
    return { ...base, composition: "", gsm: "", width: "", stock: 0, unit: "m" };
  }
  if (kind === "trim") {
    return { ...base, type: "Button", size: "", stock: 0, unit: "pc" };
  }
  return {
    ...base,
    category: "Tee",
    season: "SS26",
    totalStock: 0,
    sizes: Object.fromEntries(APPAREL_SIZES.map((s) => [s, 0])),
    unit: "pc"
  };
}

export default function AddSubSkuDialog({ parent, kind, onClose, onCreated }) {
  const { apparel, fabrics, trims, warehouses, suppliers, createSku } = useInventory();
  const [form, setForm] = useState(() => blankForm(parent, kind, { apparel, fabrics, trims, warehouses }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const stockLabel = useMemo(() => {
    if (kind === "apparel") return "Opening stock (units)";
    if (kind === "fabric") return "Opening stock (metres)";
    return "Opening stock (pieces)";
  }, [kind]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.color.trim()) {
      setError("Color name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const record = {
        ...form,
        stock: Number(form.stock) || 0,
        totalStock: Number(form.totalStock ?? form.stock) || 0,
        reorder: Number(form.reorder) || 0,
        doc: Number(form.doc) || 0,
        drr: Number(form.drr) || 0,
        cost: Number(form.cost) || 0,
        retail: Number(form.retail) || 0,
        gsm: form.gsm ? Number(form.gsm) : undefined,
        width: form.width ? Number(form.width) : undefined
      };
      const created = await createSku(kind, record);
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err?.message || "Could not add sub SKU to inventory.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add sub SKU to inventory</DialogTitle>
          <DialogDescription>
            Creates an inventory record under{" "}
            <span className="font-mono text-xs">{parent.parentSkuCode}</span> · {parent.styleName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{parent.parentSkuCode}</span>
            <span className="ml-2 font-medium">{parent.styleName}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sub-sku-code">Sub SKU code</Label>
            <Input
              id="sub-sku-code"
              value={form.id}
              onChange={(e) => set({ id: e.target.value })}
              className="font-mono"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sub-color">Color name</Label>
              <Input
                id="sub-color"
                value={form.color}
                onChange={(e) => set({ color: e.target.value })}
                placeholder="e.g. Charcoal"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-hex">Hex color</Label>
              <Input id="sub-hex" value={form.hex} onChange={(e) => set({ hex: e.target.value })} className="font-mono" />
            </div>
          </div>

          {kind === "apparel" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => set({ category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Tee", "Hoodie", "Pant", "Denim", "Shirt", "Outer", "Dress", "Skirt", "Accessory"].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Season</Label>
                <Select value={form.season} onValueChange={(v) => set({ season: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["SS26", "AW26", "SS27", "AW27", "Core"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {kind === "fabric" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Composition</Label>
                <Input value={form.composition} onChange={(e) => set({ composition: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>GSM</Label>
                <Input type="number" value={form.gsm} onChange={(e) => set({ gsm: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Width (cm)</Label>
                <Input type="number" value={form.width} onChange={(e) => set({ width: e.target.value })} />
              </div>
            </div>
          ) : null}

          {kind === "trim" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Trim type</Label>
                <Select value={form.type} onValueChange={(v) => set({ type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Button", "Zipper", "Thread", "Label", "Hangtag", "Cord", "Hardware", "Elastic", "Velcro", "Other"].map(
                      (t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Size / spec</Label>
                <Input value={form.size} onChange={(e) => set({ size: e.target.value })} />
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{stockLabel}</Label>
              <Input
                type="number"
                min="0"
                value={kind === "apparel" ? form.totalStock : form.stock}
                onChange={(e) =>
                  kind === "apparel" ? set({ totalStock: e.target.value }) : set({ stock: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select value={form.wh} onValueChange={(v) => set({ wh: v })}>
                <SelectTrigger>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Unit cost (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Sale price (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.retail} onChange={(e) => set({ retail: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Supplier (optional)</Label>
            <Select value={form.supplier || "__none__"} onValueChange={(v) => set({ supplier: v === "__none__" ? "" : v })}>
              <SelectTrigger>
                <SelectValue placeholder="No supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No supplier</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add to inventory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
