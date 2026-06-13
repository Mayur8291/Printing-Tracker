import { useEffect, useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

export default function InventoryThresholdSettingsModal({ onClose }) {
  const { settings, skus, updateAlertSettings, saveSkuReorder, refresh } = useInventory();
  const [criticalPct, setCriticalPct] = useState(50);
  const [lowEnabled, setLowEnabled] = useState(true);
  const [oosCritical, setOosCritical] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skuDrafts, setSkuDrafts] = useState({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settings) return;
    setCriticalPct(Math.round((Number(settings.critical_ratio) || 0.5) * 100));
    setLowEnabled(settings.low_stock_enabled !== false);
    setOosCritical(settings.out_of_stock_critical !== false);
  }, [settings]);

  useEffect(() => {
    const drafts = {};
    skus.forEach((s) => {
      drafts[s._uuid] = String(s.reorder ?? 0);
    });
    setSkuDrafts(drafts);
  }, [skus]);

  const saveGlobal = async () => {
    setSaving(true);
    setMessage("");
    try {
      await updateAlertSettings({
        critical_ratio: Math.min(100, Math.max(1, criticalPct)) / 100,
        low_stock_enabled: lowEnabled,
        out_of_stock_critical: oosCritical
      });
      setMessage("Global thresholds saved.");
    } catch (err) {
      setMessage(err?.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const saveSkuRow = async (sku) => {
    setMessage("");
    try {
      await saveSkuReorder(sku._uuid, skuDrafts[sku._uuid]);
      setMessage(`Reorder point saved for ${sku.id}.`);
    } catch (err) {
      setMessage(err?.message || "Could not save SKU threshold.");
    }
  };

  const saveAllSkus = async () => {
    setSaving(true);
    setMessage("");
    try {
      for (const sku of skus) {
        await saveSkuReorder(sku._uuid, skuDrafts[sku._uuid]);
      }
      await refresh();
      setMessage("All SKU reorder points saved.");
    } catch (err) {
      setMessage(err?.message || "Could not save SKU thresholds.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Alert & reorder thresholds</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Alerts only appear for SKUs you add. Set a reorder point per SKU; the app compares on-hand stock to that
              number.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <InventoryIcon name="x" size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row" style={{ marginBottom: 20 }}>
            <div className="field">
              <label>Critical level (% of reorder point)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={criticalPct}
                onChange={(e) => setCriticalPct(Number(e.target.value))}
              />
              <div className="field-hint">
                Stock below this % of reorder point = critical (e.g. 50% means half of reorder qty).
              </div>
            </div>
            <div className="field">
              <label>Options</label>
              <label className="inv-threshold-check">
                <input type="checkbox" checked={lowEnabled} onChange={(e) => setLowEnabled(e.target.checked)} />
                Show low-stock warnings when below reorder point
              </label>
              <label className="inv-threshold-check">
                <input type="checkbox" checked={oosCritical} onChange={(e) => setOosCritical(e.target.checked)} />
                Treat out of stock (0) as critical
              </label>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button type="button" className="btn primary" disabled={saving} onClick={saveGlobal}>
              Save global rules
            </button>
          </div>

          <h4 style={{ marginBottom: 8 }}>Per-SKU reorder points</h4>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            SKUs with reorder point 0 are ignored in alerts until you set a value.
          </p>

          {skus.length === 0 ? (
            <div className="inv-empty-hint">No SKUs yet. Add fabrics, trims, or apparel first.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th className="right">On hand</th>
                    <th className="right">Reorder at</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map((sku) => {
                    const onHand = sku.stock ?? sku.totalStock ?? 0;
                    return (
                      <tr key={sku._uuid}>
                        <td className="mono">{sku.id}</td>
                        <td>{sku.name}</td>
                        <td className="num">
                          {onHand.toLocaleString()} {sku.unit || "pc"}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            min={0}
                            className="inv-threshold-input"
                            value={skuDrafts[sku._uuid] ?? "0"}
                            onChange={(e) =>
                              setSkuDrafts((d) => ({ ...d, [sku._uuid]: e.target.value }))
                            }
                          />
                        </td>
                        <td>
                          <button type="button" className="btn sm" onClick={() => saveSkuRow(sku)}>
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {skus.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn" disabled={saving} onClick={saveAllSkus}>
                Save all SKU reorder points
              </button>
            </div>
          )}

          {message && (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>{message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
