import { useEffect, useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

const REASON_OPTS = {
  IN: ["PO received", "Return from customer", "Production return"],
  OUT: ["Order shipped", "Production cut", "Sample sent", "Damaged write-off"],
  TRANSFER: ["Bin reorganization", "Move to finishing", "Distribution dispatch"],
  ADJUST: ["Cycle count", "Annual stocktake", "System correction"]
};

export default function AdjustStockModal({ sku, onClose, onSubmit }) {
  const { fabrics, trims, apparel, warehouses } = useInventory();
  const [type, setType] = useState("IN");
  const [qty, setQty] = useState(100);
  const [reason, setReason] = useState(REASON_OPTS.IN[0]);
  const [wh, setWh] = useState(sku?.wh || warehouses[0]?.id || "");
  const [skuId, setSkuId] = useState(sku?.id || "");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (sku) {
      setSkuId(sku.id);
      setWh(sku.wh);
    }
  }, [sku]);

  useEffect(() => {
    setReason(REASON_OPTS[type][0]);
  }, [type]);

  const submit = (e) => {
    e?.preventDefault();
    onSubmit({ type, qty: Number(qty), reason, wh, skuId, note });
  };

  return (
    <div className="modal-backdrop open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Adjust stock</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <InventoryIcon name="x" size={14} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field">
              <label>Movement type</label>
              <div className="seg">
                {["IN", "OUT", "TRANSFER", "ADJUST"].map((t) => (
                  <button key={t} type="button" className={type === t ? "active" : ""} onClick={() => setType(t)}>
                    {t === "IN" ? "Receive" : t === "OUT" ? "Issue" : t === "TRANSFER" ? "Transfer" : "Adjust"}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>SKU</label>
              <select value={skuId} onChange={(e) => setSkuId(e.target.value)} required>
                <option value="" disabled>
                  Choose SKU…
                </option>
                <optgroup label="Fabrics">
                  {fabrics.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.id} — {f.name} · {f.color}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Trims">
                  {trims.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} — {t.name} · {t.color}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Apparel">
                  {apparel.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} — {a.name} · {a.color}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Quantity</label>
                <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} required />
              </div>
              <div className="field">
                <label>Warehouse</label>
                <select value={wh} onChange={(e) => setWh(e.target.value)}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Reason</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASON_OPTS[type].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Note (optional)</label>
              <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any context for the audit log…" />
            </div>

            <div
              style={{
                background: "var(--bg-subtle)",
                padding: 10,
                borderRadius: "var(--radius-sm)",
                fontSize: 12,
                color: "var(--text-muted)"
              }}
            >
              <InventoryIcon name="info" size={12} /> This will be recorded in the immutable audit log as{" "}
              <b style={{ color: "var(--text)" }}>{type}</b> by <b style={{ color: "var(--text)" }}>Priya Mehta</b> at{" "}
              <b style={{ color: "var(--text)" }}>{new Date("2026-06-10T14:32").toLocaleString()}</b>.
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Record movement
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
