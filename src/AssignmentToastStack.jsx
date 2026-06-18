import { useEffect } from "react";

const TOAST_LIFETIME_MS = 7000;

function toastTitle(toast) {
  if (toast.kind === "inward") return "Tagged on inward entry";
  if (toast.kind === "printing_inventory") return "Printing inventory low stock";
  return "New order assigned to you";
}

function toastBody(toast) {
  if (toast.kind === "inward") {
    const product = String(toast.productMaterial ?? "").trim() || "Inward entry";
    const dept = String(toast.department ?? "").trim();
    return dept ? `${product} · ${dept}` : product;
  }
  if (toast.kind === "printing_inventory") {
    const label = String(toast.materialLabel ?? "").trim() || "Material";
    const stock = Number(toast.currentStock);
    const threshold = Number(toast.thresholdQty);
    const stockText = Number.isFinite(stock) ? stock.toLocaleString() : "—";
    const thresholdText = Number.isFinite(threshold) ? threshold.toLocaleString() : "—";
    return `${label} · ${stockText} left (threshold ${thresholdText})`;
  }
  if (toast.orderDisplayId) {
    return (
      <>
        Order <strong>{toast.orderDisplayId}</strong> was assigned as coordinator.
      </>
    );
  }
  return "A new order was assigned as coordinator.";
}

export default function AssignmentToastStack({ toasts, onDismiss, onActivate }) {
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => onDismiss(toast.id), TOAST_LIFETIME_MS)
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;

  return (
    <div className="assignment-toast-stack" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`assignment-toast${toast.kind === "inward" ? " assignment-toast--inward" : ""}${toast.kind === "printing_inventory" ? " assignment-toast--printing-inv" : ""}${onActivate ? " assignment-toast--clickable" : ""}`}
          role="status"
          onClick={onActivate ? () => onActivate(toast) : undefined}
          onKeyDown={
            onActivate
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onActivate(toast);
                  }
                }
              : undefined
          }
          tabIndex={onActivate ? 0 : undefined}
        >
          <p className="assignment-toast__title">{toastTitle(toast)}</p>
          <p className="assignment-toast__body">{toastBody(toast)}</p>
          <button
            type="button"
            className="assignment-toast__dismiss"
            aria-label="Dismiss notification"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(toast.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
