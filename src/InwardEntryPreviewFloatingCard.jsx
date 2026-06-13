import { useState } from "react";
import {
  buildInwardEntryLabelRows,
  buildInwardGrnLabelRows,
  formatGrnCreatedAt,
  getInwardGrnEntries,
  inwardBillPhotoPath,
  inwardPackagePhotoPath,
  inwardStoragePhotoPublicUrl
} from "./inwardEntryUtils";
import { printInwardGrnLabel } from "./inwardGrnPrint";

export default function InwardEntryPreviewFloatingCard({
  open,
  record,
  onClose,
  canDelete = false,
  onDelete
}) {
  const [deleting, setDeleting] = useState(false);
  const [printingId, setPrintingId] = useState(null);

  if (!open || !record) return null;

  const rows = buildInwardEntryLabelRows(record);
  const grnEntries = getInwardGrnEntries(record);
  const billUrl = inwardStoragePhotoPublicUrl(inwardBillPhotoPath(record));
  const packageUrl = inwardStoragePhotoPublicUrl(inwardPackagePhotoPath(record));

  async function handleDelete() {
    if (!canDelete || !onDelete || deleting) return;
    const grn = grnEntries.length
      ? `${grnEntries.length} GRN(s)`
      : `#${record.id}`;
    if (!window.confirm(`Delete inward entry ${grn}?\n\nThis cannot be undone.`)) {
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

  async function handlePrint(grnRecord) {
    if (printingId != null) return;
    setPrintingId(grnRecord.id);
    try {
      await printInwardGrnLabel(grnRecord, record);
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <div className="oc-preview-backdrop" role="presentation" onClick={onClose}>
      <div
        className="oc-preview-floating-card inward-entry-preview-card"
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

        {grnEntries.length > 0 ? (
          <section className="inward-preview-grn-section" aria-labelledby="inward-preview-grn-heading">
            <h3 id="inward-preview-grn-heading" className="inward-preview-grn-heading">
              GRN entries ({grnEntries.length})
            </h3>
            <div className="inward-preview-grn-list">
              {grnEntries.map((grn) => {
                const grnRows = buildInwardGrnLabelRows(grn, record);
                return (
                  <article key={grn.id} className="inward-preview-grn-card">
                    <div className="inward-preview-grn-card-head">
                      <strong>{String(grn.grn_no ?? "").trim() || "—"}</strong>
                      <span>{formatGrnCreatedAt(grn)}</span>
                    </div>
                    <dl className="create-oc-label-grid inward-preview-grn-grid">
                      {grnRows.slice(4, 12).map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      type="button"
                      className="inward-grn-print-btn"
                      disabled={printingId === grn.id || deleting}
                      onClick={() => void handlePrint(grn)}
                    >
                      {printingId === grn.id ? "Preparing…" : "Print label"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {billUrl || packageUrl ? (
          <div className="create-inward-preview-photos">
            {billUrl ? (
              <div className="oc-preview-packaging">
                <span className="create-oc-field-label">Bill image</span>
                <a href={billUrl} target="_blank" rel="noopener noreferrer">
                  <img src={billUrl} alt="Bill" />
                </a>
              </div>
            ) : null}
            {packageUrl ? (
              <div className="oc-preview-packaging">
                <span className="create-oc-field-label">Package photo</span>
                <a href={packageUrl} target="_blank" rel="noopener noreferrer">
                  <img src={packageUrl} alt="Package" />
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="oc-preview-actions">
          {canDelete ? (
            <button
              type="button"
              className="oc-preview-delete-btn"
              disabled={deleting || printingId != null}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Delete entry"}
            </button>
          ) : null}
          <button
            type="button"
            className="oc-preview-done-btn"
            disabled={deleting || printingId != null}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
