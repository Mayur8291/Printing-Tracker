import { useEffect, useState } from "react";
import InventoryIcon from "./inventory/InventoryIcon";
import {
  PRINTING_DEPT_MATERIALS,
  PRINTING_UTILIZATION_MATERIAL_KEYS
} from "./printingDeptInventoryUtils";

function emptyQuantitiesMap(materials) {
  return Object.fromEntries(materials.map((item) => [item.key, ""]));
}

export default function RefillPrintingInventoryModal({
  open,
  onClose,
  onSubmit,
  defaultMaterialKey = "",
  mode = "refill"
}) {
  const isIssue = mode === "issue";
  const materialOptions = isIssue
    ? PRINTING_DEPT_MATERIALS.filter((m) => PRINTING_UTILIZATION_MATERIAL_KEYS.has(m.key))
    : PRINTING_DEPT_MATERIALS;

  const inkMaterials = materialOptions.filter((m) => m.group === "Ink");
  const otherMaterials = materialOptions.filter((m) => m.group !== "Ink");

  const [materialKey, setMaterialKey] = useState(() => materialOptions[0]?.key || "");
  const [quantities, setQuantities] = useState(() => emptyQuantitiesMap(materialOptions));
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const allowed = isIssue
      ? PRINTING_DEPT_MATERIALS.filter((m) => PRINTING_UTILIZATION_MATERIAL_KEYS.has(m.key))
      : PRINTING_DEPT_MATERIALS;
    const preferred = defaultMaterialKey && allowed.some((m) => m.key === defaultMaterialKey)
      ? defaultMaterialKey
      : allowed[0]?.key || "";
    setMaterialKey(preferred);
    setQuantities(emptyQuantitiesMap(allowed));
    setQuantity("");
    setNote("");
    setSubmitting(false);
    setError("");
  }, [open, defaultMaterialKey, mode]);

  if (!open) return null;

  const material = materialOptions.find((m) => m.key === materialKey) ?? materialOptions[0];

  function setBulkQty(key, value) {
    setQuantities((prev) => ({ ...prev, [key]: value }));
  }

  function renderBulkRows(items) {
    return items.map((item) => (
      <div className="printing-dept-bulk-refill-row" key={item.key}>
        <label className="printing-dept-bulk-refill-label" htmlFor={`printing-inv-qty-${item.key}`}>
          {item.label}
        </label>
        <input
          id={`printing-inv-qty-${item.key}`}
          type="number"
          min="0"
          step="any"
          className="printing-dept-bulk-refill-input"
          value={quantities[item.key] ?? ""}
          onChange={(e) => setBulkQty(item.key, e.target.value)}
          placeholder="—"
        />
      </div>
    ));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (isIssue) {
      const amount = Number(quantity);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError("Enter how much was used (must be greater than 0).");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        await onSubmit?.({ materialKey, quantity: amount, note, mode });
        onClose?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const bulkRefills = materialOptions
      .map((item) => ({
        materialKey: item.key,
        quantity: Number(quantities[item.key])
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!bulkRefills.length) {
      setError("Enter at least one amount to refill. Blank rows are skipped.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.({ bulkRefills, note, mode });
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={onClose}>
      <div
        className={`modal${isIssue ? "" : " wide"}`}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{isIssue ? "Record usage" : "Refill inventory"}</h3>
            {!isIssue ? (
              <p className="printing-dept-refill-sub">
                Fill any materials you received. Leave blank what you are not refilling.
              </p>
            ) : null}
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

            {isIssue ? (
              <>
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
                        {item.label}
                        {item.unit ? ` (${item.unit})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="printing-inv-qty">
                    Amount used
                    {material?.unit ? ` (${material.unit})` : ""}
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
              </>
            ) : (
              <div className="printing-dept-bulk-refill">
                {inkMaterials.length ? (
                  <div className="printing-dept-bulk-refill-group">
                    <p className="printing-dept-bulk-refill-heading">Ink</p>
                    <div className="printing-dept-bulk-refill-grid">{renderBulkRows(inkMaterials)}</div>
                  </div>
                ) : null}
                {otherMaterials.length ? (
                  <div className="printing-dept-bulk-refill-group">
                    <p className="printing-dept-bulk-refill-heading">Materials</p>
                    <div className="printing-dept-bulk-refill-grid">{renderBulkRows(otherMaterials)}</div>
                  </div>
                ) : null}
              </div>
            )}

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
