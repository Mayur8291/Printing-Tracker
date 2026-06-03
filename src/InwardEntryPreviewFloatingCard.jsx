import { useState } from "react";
import { buildInwardEntryLabelRows, packagePhotoPublicUrl } from "./inwardEntryUtils";

export default function InwardEntryPreviewFloatingCard({
  open,
  record,
  onClose,
  canDelete = false,
  onDelete
}) {
  const [deleting, setDeleting] = useState(false);

  if (!open || !record) return null;

  const rows = buildInwardEntryLabelRows(record);
  const packageUrl = packagePhotoPublicUrl(record.package_photo_path);

  async function handleDelete() {
    if (!canDelete || !onDelete || deleting) return;
    const grn = String(record.grn_no ?? "").trim() || `#${record.id}`;
    if (!window.confirm(`Delete GRN ${grn} from Inward entries?\n\nThis cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(record);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="oc-preview-backdrop" role="presentation" onClick={onClose}>
      <div
        className="oc-preview-floating-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inward-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="oc-preview-close" aria-label="Close preview" onClick={onClose}>
          ×
        </button>

        <h2 id="inward-preview-title" className="oc-preview-title">
          Inward entry
        </h2>

        <dl className="create-oc-label-grid oc-preview-detail-grid">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        {packageUrl ? (
          <div className="oc-preview-packaging">
            <span className="create-oc-field-label">Package photo</span>
            <a href={packageUrl} target="_blank" rel="noopener noreferrer">
              <img src={packageUrl} alt="Package" />
            </a>
          </div>
        ) : null}

        <div className="oc-preview-actions">
          {canDelete ? (
            <button
              type="button"
              className="oc-preview-delete-btn"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Delete entry"}
            </button>
          ) : null}
          <button type="button" className="oc-preview-done-btn" disabled={deleting} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
