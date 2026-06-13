import { useMemo, useState } from "react";
import OcLabelBrandHeader from "./OcLabelBrandHeader";
import {
  buildOcBarcodeCaptionLine,
  buildOcBarcodeValue
} from "./outwardChallanBarcode";
import { printOutwardChallanLabel } from "./outwardChallanPrint";
import { buildOcLabelRows, packagingPhotoPublicUrl } from "./outwardChallanUtils";
import { renderCode128BarcodeSvg } from "./inwardGrnBarcode";

export default function OcPreviewFloatingCard({
  open,
  record,
  onClose,
  canDelete = false,
  onDelete
}) {
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const barcodeSvg = useMemo(() => {
    if (!open || !record) return "";
    return renderCode128BarcodeSvg(buildOcBarcodeValue(record));
  }, [open, record]);

  if (!open || !record) return null;

  const rows = buildOcLabelRows(record);
  const packagingUrl = packagingPhotoPublicUrl(record.packaging_photo_path);
  const barcodeCaption = buildOcBarcodeCaptionLine(record);

  async function handlePrint() {
    setPrinting(true);
    try {
      await printOutwardChallanLabel(record);
    } finally {
      setPrinting(false);
    }
  }

  async function handleDelete() {
    if (!canDelete || !onDelete || deleting) return;
    if (
      !window.confirm(
        `Delete OC #${record.id} from Outward challans?\n\nThis cannot be undone.`
      )
    ) {
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
    <div
      className="oc-preview-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="oc-preview-floating-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oc-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="oc-preview-close"
          aria-label="Close preview"
          onClick={onClose}
        >
          ×
        </button>

        <OcLabelBrandHeader />
        <h2 id="oc-preview-title" className="oc-preview-title">
          Outward challan
        </h2>

        <div className="oc-preview-qr-block oc-preview-barcode-block">
          {barcodeSvg ? (
            <>
              <div
                className="oc-preview-barcode-svg"
                dangerouslySetInnerHTML={{ __html: barcodeSvg }}
              />
              <p className="oc-preview-barcode-caption">{barcodeCaption}</p>
            </>
          ) : (
            <p className="oc-preview-qr-loading">Loading barcode…</p>
          )}
        </div>

        <dl className="create-oc-label-grid oc-preview-detail-grid">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        {packagingUrl ? (
          <div className="oc-preview-packaging">
            <span className="create-oc-field-label">Packaging photo</span>
            <a href={packagingUrl} target="_blank" rel="noopener noreferrer">
              <img src={packagingUrl} alt="Packaging" />
            </a>
          </div>
        ) : null}

        <div className="oc-preview-actions">
          {canDelete ? (
            <button
              type="button"
              className="oc-preview-delete-btn"
              disabled={deleting || printing}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Delete OC"}
            </button>
          ) : null}
          <button type="button" className="oc-preview-print-btn" disabled={printing || deleting} onClick={handlePrint}>
            {printing ? "Preparing…" : "Print label"}
          </button>
          <button type="button" className="oc-preview-done-btn" disabled={deleting} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
