import { useEffect, useMemo, useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

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
  const defaultSupplier = suppliers[0]?.id || "";
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
      unit: "m",
      cost: 0,
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
      unit: "pc",
      cost: 0,
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
    cost: 0,
    retail: 0,
    sizes: Object.fromEntries(APPAREL_SIZES.map((s) => [s, 0])),
    wh: defaultWh
  };
}

function ColorSwatchField({ hex, onChange }) {
  return (
    <div className="field new-sku-swatch-field">
      <label>Color swatch</label>
      <div className="new-sku-swatch-row">
        <div className="new-sku-swatch-preview" style={{ background: hex }} aria-hidden />
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Pick color"
          style={{ width: 36, height: 32, padding: 2, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
        />
        <input value={hex} onChange={(e) => onChange(e.target.value)} className="mono new-sku-swatch-hex" />
      </div>
      <div className="new-sku-swatch-presets">
        {SWATCH_PRESETS.map((h) => (
          <button
            key={h}
            type="button"
            className={`new-sku-swatch-preset${hex === h ? " is-active" : ""}`}
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
  const { fabrics, trims, apparel, suppliers, warehouses } = useInventory();
  const [kind, setKind] = useState(initialKind);
  const [form, setForm] = useState(() =>
    makeBlank(initialKind, { fabrics, trims, apparel, suppliers, warehouses })
  );

  useEffect(() => {
    setForm(makeBlank(kind, { fabrics, trims, apparel, suppliers, warehouses }));
  }, [kind, fabrics, trims, apparel, suppliers, warehouses]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const apparelTotal = useMemo(
    () => Object.values(form.sizes || {}).reduce((s, v) => s + Number(v || 0), 0),
    [form.sizes]
  );

  const submit = (e) => {
    e?.preventDefault();
    const record = {
      ...form,
      stock: Number(form.stock) || 0,
      totalStock: Number(form.totalStock) || 0,
      reorder: Number(form.reorder) || 0,
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
    kind === "apparel" ? "Style name" : kind === "trim" ? "Trim name" : "Material name";
  const namePlaceholder =
    kind === "fabric"
      ? "e.g. Combed Cotton Jersey"
      : kind === "trim"
        ? "e.g. YKK #5 Metal Zipper"
        : "e.g. Essential Crew Tee";

  return (
    <div className="modal-backdrop open" onClick={onClose}>
      <div className="modal wide new-sku-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Create new SKU</h3>
            <p className="modal-subtitle">
              Adds a master record + opening stock. Movement type <strong>IN</strong> will be logged.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <InventoryIcon name="x" size={14} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field">
              <label>Type</label>
              <div className="seg">
                {[
                  ["fabric", "Fabric"],
                  ["trim", "Trim"],
                  ["apparel", "Finished apparel"]
                ].map(([k, l]) => (
                  <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>SKU code</label>
                <input value={form.id} onChange={(e) => set({ id: e.target.value })} className="mono" required />
                <div className="field-hint">Auto-generated — edit if you need a custom code.</div>
              </div>
              <div className="field">
                <label>{nameLabel}</label>
                <input
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder={namePlaceholder}
                  required
                />
              </div>
            </div>

            {kind === "fabric" && (
              <div className="field-row three">
                <div className="field">
                  <label>Composition</label>
                  <input value={form.composition} onChange={(e) => set({ composition: e.target.value })} placeholder="100% Cotton" />
                </div>
                <div className="field">
                  <label>GSM</label>
                  <input type="number" value={form.gsm} onChange={(e) => set({ gsm: e.target.value })} placeholder="180" />
                </div>
                <div className="field">
                  <label>Width (cm)</label>
                  <input type="number" value={form.width} onChange={(e) => set({ width: e.target.value })} placeholder="150" />
                </div>
              </div>
            )}

            {kind === "trim" && (
              <div className="field-row">
                <div className="field">
                  <label>Trim type</label>
                  <select value={form.type} onChange={(e) => set({ type: e.target.value })}>
                    {["Button", "Zipper", "Thread", "Label", "Hangtag", "Cord", "Hardware", "Elastic", "Velcro", "Other"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Size / spec</label>
                  <input value={form.size} onChange={(e) => set({ size: e.target.value })} placeholder="e.g. 18L, 22cm, 5000m" />
                </div>
              </div>
            )}

            {kind === "apparel" && (
              <div className="field-row">
                <div className="field">
                  <label>Category</label>
                  <select value={form.category} onChange={(e) => set({ category: e.target.value })}>
                    {["Tee", "Hoodie", "Pant", "Denim", "Shirt", "Outer", "Dress", "Skirt", "Accessory"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Season</label>
                  <select value={form.season} onChange={(e) => set({ season: e.target.value })}>
                    {["SS26", "AW26", "SS27", "AW27", "Core"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label>Color name</label>
                <input value={form.color} onChange={(e) => set({ color: e.target.value })} placeholder="e.g. Charcoal" />
              </div>
              <ColorSwatchField hex={form.hex} onChange={(hex) => set({ hex })} />
            </div>

            <div className="field-row three">
              <div className="field">
                <label>Supplier</label>
                <select value={form.supplier} onChange={(e) => set({ supplier: e.target.value })}>
                  {suppliers.length === 0 ? (
                    <option value="">No suppliers yet</option>
                  ) : (
                    suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="field">
                <label>Warehouse</label>
                <select value={form.wh} onChange={(e) => set({ wh: e.target.value })}>
                  {warehouses.length === 0 ? (
                    <option value="">No warehouses yet</option>
                  ) : (
                    warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              {kind === "apparel" ? (
                <div className="field">
                  <label>Retail price</label>
                  <input type="number" step="0.01" min="0" value={form.retail} onChange={(e) => set({ retail: e.target.value })} />
                </div>
              ) : (
                <div className="field">
                  <label>Bin location</label>
                  <input value={form.bin} onChange={(e) => set({ bin: e.target.value })} placeholder="A-12-03" className="mono" />
                </div>
              )}
            </div>

            <div className={kind === "apparel" ? "field-row" : "field-row three"}>
              {kind !== "apparel" && (
                <div className="field">
                  <label>Opening stock</label>
                  <input type="number" min="0" value={form.stock} onChange={(e) => set({ stock: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label>Reorder point</label>
                <input type="number" min="0" value={form.reorder} onChange={(e) => set({ reorder: e.target.value })} />
              </div>
              {kind !== "apparel" && (
                <div className="field">
                  <label>Unit</label>
                  <select value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
                    {["m", "pc", "cone", "roll", "set", "kg"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Unit cost ($)</label>
                <input type="number" step="0.01" min="0" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
              </div>
            </div>

            {kind === "apparel" && form.sizes && (
              <div className="field">
                <label>Opening stock by size</label>
                <div className="new-sku-size-grid">
                  {APPAREL_SIZES.map((s) => (
                    <div key={`h-${s}`} className="size-head">
                      {s}
                    </div>
                  ))}
                  {APPAREL_SIZES.map((s) => (
                    <div key={s} className="size-cell">
                      <input
                        type="number"
                        min="0"
                        value={form.sizes[s] ?? 0}
                        onChange={(e) => set({ sizes: { ...form.sizes, [s]: Number(e.target.value) || 0 } })}
                      />
                    </div>
                  ))}
                </div>
                <div className="field-hint">
                  Total opening stock: <strong>{apparelTotal.toLocaleString()}</strong> units
                </div>
              </div>
            )}

            <div className="new-sku-info-box">
              <InventoryIcon name="info" size={14} />
              <span>
                Saving will create the master SKU, post opening stock as an IN movement, and link the item to its
                supplier &amp; warehouse. You can adjust quantities later from the row&apos;s edit menu.
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn accent">
              <InventoryIcon name="check" size={12} /> Create SKU
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
