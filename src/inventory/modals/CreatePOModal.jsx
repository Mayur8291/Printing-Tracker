import { useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

export default function CreatePOModal({ initialSku, onClose, onSubmit }) {
  const { skus, fabrics, trims, suppliers, warehouses } = useInventory();
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
    <div className="modal-backdrop open" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Create purchase order</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              PO-2026-{(POS.length + 1418).toString().padStart(4, "0")} · Draft
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <InventoryIcon name="x" size={14} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field-row">
              <div className="field">
                <label>Supplier</label>
                <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.city}, {s.country}
                    </option>
                  ))}
                </select>
                {sup && (
                  <div className="field-hint">
                    {sup.leadDays}-day lead · {sup.paymentTerms} · ★ {sup.rating}
                  </div>
                )}
              </div>
              <div className="field">
                <label>Deliver to</label>
                <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <div className="field-hint">
                  Requested ETA:{" "}
                  <input
                    type="date"
                    style={{
                      display: "inline-block",
                      width: "auto",
                      padding: "2px 6px",
                      marginLeft: 4,
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      fontSize: 12,
                      background: "var(--bg-elevated)",
                      color: "var(--text)"
                    }}
                    value={eta}
                    onChange={(e) => setEta(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <label>Line items</label>
              <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <table className="t" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th style={{ width: 90 }} className="right">
                        Qty
                      </th>
                      <th style={{ width: 100 }} className="right">
                        Unit cost
                      </th>
                      <th style={{ width: 100 }} className="right">
                        Line total
                      </th>
                      <th style={{ width: 30 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const sku = allSku.find((s) => s.id === l.skuId);
                      const lineTotal = (Number(l.qty) || 0) * (Number(l.cost) || 0);
                      return (
                        <tr key={i} style={{ cursor: "default" }}>
                          <td>
                            <select
                              value={l.skuId}
                              onChange={(e) => updateLine(i, { skuId: e.target.value })}
                              style={{
                                width: "100%",
                                border: "none",
                                background: "transparent",
                                padding: 4,
                                fontSize: 12.5,
                                color: "var(--text)"
                              }}
                            >
                              <option value="">Choose SKU…</option>
                              <optgroup label="Fabrics">
                                {fabrics.filter((f) => f.supplier === supplier).map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.id} — {f.name} · {f.color}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Trims">
                                {trims.filter((t) => t.supplier === supplier).map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.id} — {t.name} · {t.color}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                            {sku && (
                              <div style={{ fontSize: 11, color: "var(--text-faint)", paddingLeft: 4 }}>
                                {sku.unit} · reorder at {sku.reorder.toLocaleString()}
                              </div>
                            )}
                          </td>
                          <td className="right">
                            <input
                              type="number"
                              value={l.qty}
                              onChange={(e) => updateLine(i, { qty: e.target.value })}
                              style={{
                                width: "100%",
                                textAlign: "right",
                                border: "none",
                                background: "transparent",
                                padding: 4,
                                fontSize: 12.5,
                                color: "var(--text)",
                                fontVariantNumeric: "tabular-nums"
                              }}
                            />
                          </td>
                          <td className="right">
                            <input
                              type="number"
                              step="0.01"
                              value={l.cost}
                              onChange={(e) => updateLine(i, { cost: e.target.value })}
                              style={{
                                width: "100%",
                                textAlign: "right",
                                border: "none",
                                background: "transparent",
                                padding: 4,
                                fontSize: 12.5,
                                color: "var(--text)",
                                fontVariantNumeric: "tabular-nums"
                              }}
                            />
                          </td>
                          <td className="num right" style={{ fontWeight: 500 }}>
                            ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td>
                            <button type="button" className="icon-btn" onClick={() => rmLine(i)} title="Remove">
                              <InventoryIcon name="x" size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={addLine}>
                <InventoryIcon name="plus" size={12} /> Add line
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "start" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Internal notes</label>
                <textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Spec sheets, color approvals, special handling…" />
              </div>
              <div
                style={{
                  minWidth: 200,
                  padding: 12,
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 12.5
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--text-muted)" }}>Subtotal</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--text-muted)" }}>Shipping (est.)</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>${shipping.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--text-muted)" }}>Qty</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{totalQty.toLocaleString()}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--border)",
                    fontWeight: 600,
                    fontSize: 14
                  }}
                >
                  <span>Total</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn">
              Save draft
            </button>
            <button type="submit" className="btn accent">
              Send to {sup?.name.split(" ")[0]}
              <InventoryIcon name="chev_r" size={12} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
