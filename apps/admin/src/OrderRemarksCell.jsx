import { useState } from "react";
import { createPortal } from "react-dom";

function RemarksViewCard({ text, open, onClose }) {
  if (!open) return null;
  return createPortal(
    <div className="remarks-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="remarks-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Remarks"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="remarks-modal__header">
          <h3>Remarks</h3>
          <button type="button" className="remarks-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="remarks-modal__body">{text}</div>
      </div>
    </div>,
    document.body
  );
}

export default function OrderRemarksCell({ value, canEdit, onChange }) {
  const [modalOpen, setModalOpen] = useState(false);
  const text = String(value ?? "");
  const trimmed = text.trim();

  const viewModal = (
    <RemarksViewCard text={trimmed} open={modalOpen} onClose={() => setModalOpen(false)} />
  );

  if (canEdit) {
    return (
      <>
        <div className="remarks-card remarks-card--editable">
          <textarea
            className="remarks-card__textarea"
            value={text}
            placeholder="Remarks…"
            onChange={(e) => onChange?.(e.target.value)}
          />
          <button
            type="button"
            className="remarks-card__view-btn"
            disabled={!trimmed}
            onClick={() => setModalOpen(true)}
          >
            View
          </button>
        </div>
        {viewModal}
      </>
    );
  }

  if (!trimmed) {
    return <span className="remarks-card-empty">—</span>;
  }

  return (
    <>
      <div className="remarks-card">
        <div className="remarks-card__scroll">
          <p className="remarks-card__text">{trimmed}</p>
        </div>
        <button type="button" className="remarks-card__view-btn" onClick={() => setModalOpen(true)}>
          View
        </button>
      </div>
      {viewModal}
    </>
  );
}
