import { useEffect, useState } from "react";
import InventoryIcon from "./inventory/InventoryIcon";
import {
  PRINTING_DEPT_MATERIALS,
  PRINTING_UTILIZATION_MATERIAL_KEYS
} from "./printingDeptInventoryUtils";

export default function RefillPrintingInventoryModal({
  open,
  onClose,
  onSubmit,
  defaultMaterialKey = "",
  mode = "refill"
}) {
  const isIssue = mode === "issue";
  const [materialKey, setMaterialKey] = useState(
    () => PRINTING_DEPT_MATERIALS[0]?.key || ""
  );
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const materialOptions = isIssue
    ? PRINTING_DEPT_MATERIALS.filter((m) => PRINTING_UTILIZATION_MATERIAL_KEYS.has(m.key))
    : PRINTING_DEPT_MATERIALS;

  useEffect(() => {
    if (!open) return;
    const allowed = isIssue
      ? PRINTING_DEPT_MATERIALS.filter((m) => PRINTING_UTILIZATION_MATERIAL_KEYS.has(m.key))
      : PRINTING_DEPT_MATERIALS;
    const preferred = defaultMaterialKey && allowed.some((m) => m.key === defaultMaterialKey)
      ? defaultMaterialKey
      : allowed[0]?.key || "";
    setMaterialKey(preferred);
    setQuantity("");
    setNote("");
    setSubmitting(false);
    setError("");
  }, [open, defaultMaterialKey, mode]);

  if (!open) return null;

  const material = materialOptions.find((m) => m.key === materialKey) ?? materialOptions[0];

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(isIssue ? "Enter how much was used (must be greater than 0)." : "Enter how much you are adding (must be greater than 0).");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.({ materialKey, quantity, note, mode });
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
          <h3 className="modal-title">{isIssue ? "Record usage" : "Refill inventory"}</h3>
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
              <label htmlFor="printing-inv-material">Material</label>
              <select
                id="printing-inv-material"
                value={materialKey}
                onChange={(e) => setMaterialKey(e.target.value)}
                required
              >
                {materialOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label} ({item.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="printing-inv-qty">
                {isIssue ? "Amount used" : "Amount to add"}
                {material ? ` (${material.unit})` : ""}
              </label>
              <input
                id="printing-inv-qty"
                type="number"
                min="0.01"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 5"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="printing-inv-note">Note (optional)</label>
              <input
                id="printing-inv-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isIssue ? "Job, order, reason…" : "Supplier, batch, etc."}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className={`btn ${isIssue ? "danger" : "primary"}`} disabled={submitting}>
              {submitting ? "Saving…" : isIssue ? "Record usage" : "Record refill"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
