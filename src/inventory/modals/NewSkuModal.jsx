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

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { cn } from "@/lib/utils";

import { useInventory } from "../InventoryDataContext";
import MasterListSelectField from "@/components/admin/MasterListSelectField";



const SWATCH_PRESETS = [

  "#fafaf6",

  "#e9e1cf",

  "#c9b48a",

  "#2e2e33",

  "#111114",

  "#1a2742",

  "#3a4b8a",

  "#5e2330",

  "#a14a2a",

  "#6c7252",

  "#2f4a37",

  "#c79c9a",

  "#bccfde",

  "#5b4ce5"

];



const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];



function nextId(prefix, pool) {

  const nums = pool

    .map((p) => parseInt((p.id.split("-")[1] || "").replace(/\D/g, ""), 10))

    .filter((n) => !Number.isNaN(n));

  const next = Math.max(...nums, 0) + 1;

  if (prefix === "APP") return `APP-X${next}`;

  return `${prefix}-${next}`;

}



function makeBlank(k, { fabrics, trims, apparel, suppliers, warehouses }) {

  const defaultSupplier = "";

  const defaultWh = warehouses[0]?.id || "";

  const today = new Date().toISOString().slice(0, 10);

  if (k === "fabric") {

    return {

      id: nextId("FAB", fabrics),

      name: "",

      composition: "",

      gsm: "",

      width: "",

      color: "",

      hex: "#cccccc",

      supplier: defaultSupplier,

      stock: 0,

      reorder: 500,

      doc: 0,

      drr: 0,

      unit: "m",

      cost: 0,

      retail: 0,

      wh: defaultWh,

      bin: "",

      lastIn: today,

      tags: []

    };

  }

  if (k === "trim") {

    return {

      id: nextId("TRM", trims),

      name: "",

      type: "Button",

      size: "",

      color: "",

      hex: "#cccccc",

      supplier: defaultSupplier,

      stock: 0,

      reorder: 1000,

      doc: 0,

      drr: 0,

      unit: "pc",

      cost: 0,

      retail: 0,

      wh: defaultWh,

      bin: "",

      lastIn: today

    };

  }

  return {

    id: nextId("APP", apparel),

    name: "",

    category: "Tee",

    season: "SS26",

    color: "",

    hex: "#cccccc",

    supplier: defaultSupplier,

    totalStock: 0,

    reorder: 300,

    doc: 0,

    drr: 0,

    cost: 0,

    retail: 0,

    sizes: Object.fromEntries(APPAREL_SIZES.map((s) => [s, 0])),

    wh: defaultWh,

    bin: ""

  };

}



function ColorSwatchField({ hex, onChange }) {

  return (

    <div className="space-y-2">

      <Label>Color swatch</Label>

      <div className="flex items-center gap-2">

        <div className="size-8 shrink-0 rounded-md border" style={{ background: hex }} aria-hidden />

        <Input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="h-8 w-12 p-0.5" aria-label="Pick color" />

        <Input value={hex} onChange={(e) => onChange(e.target.value)} className="font-mono" />

      </div>

      <div className="flex flex-wrap gap-1.5">

        {SWATCH_PRESETS.map((h) => (

          <button

            key={h}

            type="button"

            className={cn("size-6 rounded border-2", hex === h ? "border-foreground" : "border-transparent")}

            style={{ background: h }}

            onClick={() => onChange(h)}

            aria-label={`Set color ${h}`}

          />

        ))}

      </div>

    </div>

  );

}



export default function NewSkuModal({ initialKind = "fabric", onClose, onSubmit }) {

  const { fabrics, trims, apparel, suppliers, warehouses, quickCreateSupplier, quickCreateWarehouse } =

    useInventory();

  const [kind, setKind] = useState(initialKind);

  const [form, setForm] = useState(() => makeBlank(initialKind, { fabrics, trims, apparel, suppliers, warehouses }));



  useEffect(() => {

    setForm(makeBlank(kind, { fabrics, trims, apparel, suppliers, warehouses }));

  }, [kind, fabrics, trims, apparel, suppliers, warehouses]);



  const set = (patch) => setForm((f) => ({ ...f, ...patch }));



  const apparelTotal = useMemo(() => Object.values(form.sizes || {}).reduce((s, v) => s + Number(v || 0), 0), [form.sizes]);



  const submit = (e) => {

    e?.preventDefault();

    const record = {

      ...form,

      stock: Number(form.stock) || 0,

      totalStock: Number(form.totalStock) || 0,

      reorder: Number(form.reorder) || 0,

      doc: Number(form.doc) || 0,

      drr: Number(form.drr) || 0,

      cost: Number(form.cost) || 0,

      retail: Number(form.retail) || 0,

      gsm: form.gsm ? Number(form.gsm) : undefined,

      width: form.width ? Number(form.width) : undefined

    };

    if (kind === "apparel") {

      record.totalStock = apparelTotal;

    }

    onSubmit(kind, record);

  };



  const nameLabel =

    kind === "apparel"

      ? "Style name"

      : kind === "trim"

        ? "Trim name"

        : "Material name";

  const namePlaceholder =

    kind === "fabric" ? "e.g. Combed Cotton Jersey" : kind === "trim" ? "e.g. YKK #5 Metal Zipper" : "e.g. Essential Crew Tee";



  return (

    <Dialog open onOpenChange={(open) => !open && onClose()}>

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">

        <DialogHeader>

          <DialogTitle>Create new SKU</DialogTitle>

          <DialogDescription>

            Adds a master record + opening stock. Movement type <strong>IN</strong> will be logged.

          </DialogDescription>

        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">

          <div className="space-y-2">

            <Label>Type</Label>

            <div className="inline-flex rounded-lg border p-0.5">

              {[

                ["fabric", "Fabric"],

                ["trim", "Trim"],

                ["apparel", "Finished apparel"]

              ].map(([k, l]) => (

                <Button key={k} type="button" variant={kind === k ? "secondary" : "ghost"} size="sm" onClick={() => setKind(k)}>

                  {l}

                </Button>

              ))}

            </div>

          </div>



          <div className="grid gap-4 sm:grid-cols-2">

            <div className="space-y-2">

              <Label>SKU code</Label>

              <Input value={form.id} onChange={(e) => set({ id: e.target.value })} className="font-mono" required />

              <p className="text-xs text-muted-foreground">Auto-generated — edit if you need a custom code.</p>

            </div>

            <div className="space-y-2">

              <Label>{nameLabel}</Label>

              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={namePlaceholder} required />

            </div>

          </div>



          {kind === "fabric" && (

            <div className="grid gap-4 sm:grid-cols-3">

              <div className="space-y-2">

                <Label>Composition</Label>

                <Input value={form.composition} onChange={(e) => set({ composition: e.target.value })} placeholder="100% Cotton" />

              </div>

              <div className="space-y-2">

                <Label>GSM</Label>

                <Input type="number" value={form.gsm} onChange={(e) => set({ gsm: e.target.value })} placeholder="180" />

              </div>

              <div className="space-y-2">

                <Label>Width (cm)</Label>

                <Input type="number" value={form.width} onChange={(e) => set({ width: e.target.value })} placeholder="150" />

              </div>

            </div>

          )}



          {kind === "trim" && (

            <div className="grid gap-4 sm:grid-cols-2">

              <div className="space-y-2">

                <Label>Trim type</Label>

                <Select value={form.type} onValueChange={(v) => set({ type: v })}>

                  <SelectTrigger>

                    <SelectValue />

                  </SelectTrigger>

                  <SelectContent>

                    {["Button", "Zipper", "Thread", "Label", "Hangtag", "Cord", "Hardware", "Elastic", "Velcro", "Other"].map((t) => (

                      <SelectItem key={t} value={t}>

                        {t}

                      </SelectItem>

                    ))}

                  </SelectContent>

                </Select>

              </div>

              <div className="space-y-2">

                <Label>Size / spec</Label>

                <Input value={form.size} onChange={(e) => set({ size: e.target.value })} placeholder="e.g. 18L, 22cm, 5000m" />

              </div>

            </div>

          )}



          {kind === "apparel" && (

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

          )}



          <div className="grid gap-4 sm:grid-cols-2">

            <div className="space-y-2">

              <Label>Color name</Label>

              <Input value={form.color} onChange={(e) => set({ color: e.target.value })} placeholder="e.g. Charcoal" />

            </div>

            <ColorSwatchField hex={form.hex} onChange={(hex) => set({ hex })} />

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



          <div className="grid gap-4 sm:grid-cols-3">

            <div className="space-y-2">

              <Label>Reorder point</Label>

              <Input type="number" min="0" value={form.reorder} onChange={(e) => set({ reorder: e.target.value })} />

            </div>

            <div className="space-y-2">

              <Label>DOC</Label>

              <Input type="number" min="0" step="0.01" value={form.doc} onChange={(e) => set({ doc: e.target.value })} />

              <p className="text-xs text-muted-foreground">Days of cover</p>

            </div>

          </div>



          <div className="grid gap-4 sm:grid-cols-3">

            <MasterListSelectField

              label="Supplier"

              id="new-sku-supplier"

              value={form.supplier}

              onValueChange={(v) => set({ supplier: v })}

              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}

              onAdd={async (name) => {

                const row = await quickCreateSupplier(name);

                return { value: row.id, name: row.name };

              }}

              placeholder="— None —"

              addPlaceholder="Supplier name"

              allowEmptyOption

              emptyOptionLabel="— None —"

            />

            <MasterListSelectField

              label="Warehouse"

              id="new-sku-warehouse"

              value={form.wh}

              onValueChange={(v) => set({ wh: v })}

              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}

              onAdd={async (name) => {

                const row = await quickCreateWarehouse(name);

                return { value: row.id, name: row.name };

              }}

              placeholder="Select warehouse"

              addPlaceholder="Warehouse name"

              required

            />

            <div className="space-y-2">

              <Label>Storage location</Label>

              <Input
                value={form.bin}
                onChange={(e) => set({ bin: e.target.value })}
                placeholder="e.g. A-12-03"
                className="font-mono"
              />

            </div>

          </div>



          <div className={cn("grid gap-4", kind === "apparel" ? "sm:grid-cols-1" : "sm:grid-cols-2")}>

            {kind !== "apparel" && (

              <>

                <div className="space-y-2">

                  <Label>Opening stock</Label>

                  <Input type="number" min="0" value={form.stock} onChange={(e) => set({ stock: e.target.value })} />

                </div>

                <div className="space-y-2">

                  <Label>Unit</Label>

                  <Select value={form.unit} onValueChange={(v) => set({ unit: v })}>

                    <SelectTrigger>

                      <SelectValue />

                    </SelectTrigger>

                    <SelectContent>

                      {["m", "pc", "cone", "roll", "set", "kg"].map((u) => (

                        <SelectItem key={u} value={u}>

                          {u}

                        </SelectItem>

                      ))}

                    </SelectContent>

                  </Select>

                </div>

              </>

            )}

          </div>



          {kind === "apparel" && form.sizes && (

            <div className="space-y-2">

              <Label>Opening stock by size</Label>

              <div className="grid grid-cols-6 gap-px overflow-hidden rounded-md border">

                {APPAREL_SIZES.map((s) => (

                  <div key={`h-${s}`} className="bg-muted px-2 py-1.5 text-center text-xs font-medium">

                    {s}

                  </div>

                ))}

                {APPAREL_SIZES.map((s) => (

                  <div key={s} className="p-1">

                    <Input

                      type="number"

                      min="0"

                      className="h-8 text-center"

                      value={form.sizes[s] ?? 0}

                      onChange={(e) => set({ sizes: { ...form.sizes, [s]: Number(e.target.value) || 0 } })}

                    />

                  </div>

                ))}

              </div>

              <p className="text-xs text-muted-foreground">

                Total opening stock: <strong>{apparelTotal.toLocaleString()}</strong> units

              </p>

            </div>

          )}



          <Alert>

            <AlertDescription>

              Saving will create the master SKU, post opening stock as an IN movement, and link the item to its supplier

              &amp; warehouse. You can adjust quantities later from the row&apos;s edit menu.

            </AlertDescription>

          </Alert>



          <DialogFooter>

            <Button type="button" variant="ghost" onClick={onClose}>

              Cancel

            </Button>

            <Button type="submit">Create SKU</Button>

          </DialogFooter>

        </form>

      </DialogContent>

    </Dialog>

  );

}

