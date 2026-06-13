import { useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";
import { formatRelative, isApparelSku, statusOf } from "../inventoryUtils";

export default function SkuDrawer({ sku, onClose, onAdjust, onReorder }) {
  const { suppliers, warehouses, movements, settings, saveSkuReorder } = useInventory();
  const [reorderDraft, setReorderDraft] = useState("");
  const [savingReorder, setSavingReorder] = useState(false);
  const open = !!sku;

  if (!sku) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <div className="drawer" />
      </>
    );
  }

  const isApparel = isApparelSku(sku);
  const stock = sku.stock ?? sku.totalStock;
  const supplier = suppliers.find((s) => s.id === sku.supplier);
  const wh = warehouses.find((w) => w.id === sku.wh);
  const status = statusOf(sku, settings);
  const reorderValue = reorderDraft !== "" ? reorderDraft : String(sku.reorder ?? 0);

  const history = movements.filter((m) => m.sku === sku.id).slice(0, 6);

  const saveReorder = async () => {
    if (!sku._uuid) return;
    setSavingReorder(true);
    try {
      await saveSkuReorder(sku._uuid, reorderValue);
      setReorderDraft("");
    } finally {
      setSavingReorder(false);
    }
  };

  return (
    <>
      <div className={`drawer-backdrop${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`drawer${open ? " open" : ""}`}>
        <div className="drawer-header">
          <div className="drawer-header-main">
            <div className="drawer-swatch" style={{ background: sku.hex }} />
            <div className="drawer-header-text">
              <h3 className="drawer-title">{sku.name}</h3>
              <div className="drawer-subtitle">
                <span className="mono">{sku.id}</span>
                {sku.color && <> · {sku.color}</>}
              </div>
              <div className="drawer-status">
                <span className={`badge ${status.kind}`}>
                  <span className="dot" />
                  {status.label}
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <InventoryIcon name="x" size={14} />
          </button>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <h4>Specifications</h4>
            <dl className="kv">
              {isApparel ? (
                <>
                  <dt>Category</dt>
                  <dd>{sku.category}</dd>
                  <dt>Season</dt>
                  <dd>{sku.season}</dd>
                  <dt>Colorway</dt>
                  <dd>
                    <span className="cell-with-swatch">
                      <span className="swatch" style={{ background: sku.hex }} />
                      {sku.color}
                    </span>
                  </dd>
                  <dt>Unit cost</dt>
                  <dd>${sku.cost.toFixed(2)}</dd>
                  <dt>Retail price</dt>
                  <dd>${sku.retail}</dd>
                  <dt>Margin</dt>
                  <dd>
                    <b>{Math.round((1 - sku.cost / sku.retail) * 100)}%</b>
                  </dd>
                </>
              ) : (
                <>
                  <dt>Composition</dt>
                  <dd>{sku.composition || "—"}</dd>
                  {sku.gsm && (
                    <>
                      <dt>Weight</dt>
                      <dd>{sku.gsm} g/m²</dd>
                    </>
                  )}
                  {sku.width && (
                    <>
                      <dt>Width</dt>
                      <dd>{sku.width} cm</dd>
                    </>
                  )}
                  {sku.type && (
                    <>
                      <dt>Type</dt>
                      <dd>{sku.type}</dd>
                    </>
                  )}
                  {sku.size && (
                    <>
                      <dt>Size</dt>
                      <dd>{sku.size}</dd>
                    </>
                  )}
                  <dt>Color</dt>
                  <dd>
                    <span className="cell-with-swatch">
                      <span className="swatch" style={{ background: sku.hex }} />
                      {sku.color}
                    </span>
                  </dd>
                  <dt>Unit cost</dt>
                  <dd>
                    ${sku.cost.toFixed(2)} / {sku.unit}
                  </dd>
                </>
              )}
            </dl>
          </div>

          {isApparel && (
            <div className="drawer-section">
              <h4>Stock by size</h4>
              <div
                className="size-matrix"
                style={{ gridTemplateColumns: `repeat(${Object.keys(sku.sizes).length}, 1fr)` }}
              >
                {Object.keys(sku.sizes).map((s) => (
                  <div key={`h${s}`} className="head">
                    {s}
                  </div>
                ))}
                {Object.entries(sku.sizes).map(([s, v]) => (
                  <div key={s} className={`val${v === 0 ? " zero" : v < 50 ? " low" : ""}`}>
                    {v.toLocaleString()}
                  </div>
                ))}
              </div>
              <div className="drawer-size-summary">
                Total <b>{sku.totalStock.toLocaleString()}</b> units · reorder threshold{" "}
                {sku.reorder.toLocaleString()}
              </div>
            </div>
          )}

          <div className="drawer-section">
            <h4>Stock & location</h4>
            <dl className="kv">
              <dt>On hand</dt>
              <dd>
                <b>{stock.toLocaleString()}</b> {sku.unit || "units"}
                <span className="kv-secondary">
                  {" "}
                  · ${(stock * sku.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })} value
                </span>
              </dd>
              <dt>Reorder point</dt>
              <dd className="drawer-reorder">
                <input
                  type="number"
                  min={0}
                  className="inv-threshold-input"
                  value={reorderValue}
                  onChange={(e) => setReorderDraft(e.target.value)}
                />
                <span className="kv-unit">{sku.unit || "units"}</span>
                <button type="button" className="btn sm" disabled={savingReorder} onClick={saveReorder}>
                  Save
                </button>
              </dd>
              <dt>Warehouse</dt>
              <dd>
                {wh?.name}
                <span className="kv-secondary">
                  {" "}
                  · <span className="mono">{sku.wh}</span>
                </span>
              </dd>
              {sku.bin && (
                <>
                  <dt>Bin</dt>
                  <dd className="mono">{sku.bin}</dd>
                </>
              )}
              <dt>Last received</dt>
              <dd>{sku.lastIn || "—"}</dd>
            </dl>
          </div>

          <div className="drawer-section">
            <h4>Supplier</h4>
            <div className="drawer-supplier-card">
              <div className="drawer-supplier-avatar">{supplier?.name?.[0] || "?"}</div>
              <div className="drawer-supplier-info">
                <div className="drawer-supplier-name">{supplier?.name}</div>
                <div className="drawer-supplier-meta">
                  <span className="mono">{supplier?.id}</span> · {supplier?.city}, {supplier?.country} ·{" "}
                  {supplier?.leadDays}d lead · ★ {supplier?.rating}
                </div>
              </div>
              <button type="button" className="btn sm">
                View
              </button>
            </div>
          </div>

          <div className="drawer-section">
            <h4>Recent activity</h4>
            <div>
              {history.length === 0 && (
                <div className="inv-empty-hint" style={{ padding: "8px 0" }}>
                  No movements logged yet.
                </div>
              )}
              {history.map((m) => {
                const cls = m.type === "IN" ? "in" : m.type === "ADJUST" ? "adj" : "out";
                const sign = m.qty > 0 ? "+" : "";
                return (
                  <div className="history-row" key={m.id}>
                    <div className={`h-icon ${cls}`}>
                      <InventoryIcon
                        name={m.type === "IN" ? "arrow_d" : m.type === "OUT" ? "arrow_u" : m.type === "TRANSFER" ? "swap" : "edit"}
                        size={11}
                        stroke={2}
                      />
                    </div>
                    <div className="h-text">
                      <span>{m.reason}</span>
                      <small>
                        {m.user} · {formatRelative(new Date(m.ts))} · ref {m.ref}
                      </small>
                    </div>
                    <div className={`h-qty ${m.qty > 0 ? "pos" : "neg"}`}>
                      {sign}
                      {m.qty.toLocaleString()} {m.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="drawer-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
          <div className="drawer-footer-actions">
            <button type="button" className="btn" onClick={() => onAdjust(sku)}>
              <InventoryIcon name="edit" size={12} /> Adjust stock
            </button>
            <button type="button" className="btn primary" onClick={() => onReorder(sku)}>
              <InventoryIcon name="cart" size={12} /> Reorder
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
