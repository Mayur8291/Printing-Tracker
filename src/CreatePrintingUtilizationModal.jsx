import { useEffect, useState } from "react";
import InventoryIcon from "./inventory/InventoryIcon";
import { createPrintingUtilizationEntry } from "./printingUtilizationUtils";

export default function CreatePrintingUtilizationModal({ open, onClose, sessionUserId, onCreated }) {
  const [printingMetres, setPrintingMetres] = useState("");
  const [pcsFused, setPcsFused] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrintingMetres("");
    setPcsFused("");
    setSubmitting(false);
    setError("");
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const entry = await createPrintingUtilizationEntry({
        printingMetres,
        pcsFused,
        userId: sessionUserId
      });
      onCreated?.(entry);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Make entry</h3>
            <p className="modal-subtitle">Record metres printed and pcs fused for today.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <InventoryIcon name="x" size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error ? (
              <p className="printing-dept-inv-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="printing-util-metres">Printing mtrs</label>
              <input
                id="printing-util-metres"
                type="number"
                min="0.01"
                step="any"
                value={printingMetres}
                onChange={(e) => setPrintingMetres(e.target.value)}
                placeholder="e.g. 120"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="printing-util-pcs">Number of pcs fused</label>
              <input
                id="printing-util-pcs"
                type="number"
                min="1"
                step="1"
                value={pcsFused}
                onChange={(e) => setPcsFused(e.target.value)}
                placeholder="e.g. 48"
                required
              />
            </div>
            <p className="field-hint">Entries cannot be edited after saving.</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
