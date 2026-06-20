import { useEffect, useState } from "react";
import InventoryIcon from "./inventory/InventoryIcon";
import {
  fetchPrintingDeptThresholds,
  formatQtyWithUnit,
  inventoryItemsFromState,
  PRINTING_DEPT_MATERIALS,
  savePrintingDeptThresholds
} from "./printingDeptInventoryUtils";

export default function PrintingDeptThresholdModal({ open, onClose, state, sessionUserId, isAdmin = false }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setError("");
    setMessage("");
    void fetchPrintingDeptThresholds()
      .then((thresholds) => {
        const next = {};
        for (const material of PRINTING_DEPT_MATERIALS) {
          next[material.key] = String(thresholds[material.key] ?? 0);
        }
        setDrafts(next);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [open]);

  if (!open) return null;

  const items = inventoryItemsFromState(state);

  async function handleSave(e) {
    e.preventDefault();
    if (!isAdmin) {
      setError("Only admins can set printing inventory thresholds.");
      return;
    }
    if (!sessionUserId) {
      setError("You must be signed in to save thresholds.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {};
      for (const material of PRINTING_DEPT_MATERIALS) {
        const raw = drafts[material.key] ?? "0";
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Enter a valid threshold for ${material.label}.`);
        }
        payload[material.key] = value;
      }
      await savePrintingDeptThresholds({ thresholds: payload, userId: sessionUserId, isAdmin });
      setMessage("Thresholds saved.");
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={onClose}>
      <div className="modal wide" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Low-stock thresholds</h3>
            <p className="printing-dept-threshold-sub">
              Set minimum stock per material. Admins get a notification when stock drops below the threshold.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <InventoryIcon name="x" size={14} />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body">
            {error ? (
              <p className="printing-dept-inv-error" role="alert">
                {error}
              </p>
            ) : null}
            {message ? <p className="printing-dept-threshold-msg">{message}</p> : null}
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th className="right">Current stock</th>
                    <th className="right">Alert below</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key}>
                      <td>{item.label}</td>
                      <td className="right mono">
                        {formatQtyWithUnit(item.quantity, item.unit)}
                      </td>
                      <td className="right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="printing-dept-threshold-input"
                          value={drafts[item.key] ?? "0"}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                        />
                        {item.unit ? (
                          <span className="printing-dept-threshold-unit">{item.unit}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : "Save thresholds"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
