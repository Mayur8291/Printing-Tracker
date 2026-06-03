import { useEffect } from "react";

const TOAST_LIFETIME_MS = 7000;

export default function AssignmentToastStack({ toasts, onDismiss }) {
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => onDismiss(toast.id), TOAST_LIFETIME_MS)
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;

  return (
    <div className="assignment-toast-stack" role="region" aria-label="Order assignments" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="assignment-toast" role="status">
          <p className="assignment-toast__title">New order assigned to you</p>
          <p className="assignment-toast__body">
            {toast.orderDisplayId ? (
              <>
                Order <strong>{toast.orderDisplayId}</strong>
              </>
            ) : (
              "A new order"
            )}{" "}
            was assigned as coordinator.
          </p>
          <button
            type="button"
            className="assignment-toast__dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
