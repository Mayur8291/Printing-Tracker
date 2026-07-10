import { createPortal } from "react-dom";
import { formatReceivedAtDisplay } from "../orderViewUtils";
import { getOrderHistoryEventLabel, getOrderHistoryTitle } from "../orderHistoryUtils";

/**
 * Order activity timeline. Portaled to document.body so it stacks above Radix View order Dialog (z-50).
 */
export default function OrderHistoryModal({
  order,
  entries,
  loading,
  error,
  onClose,
  onRefresh
}) {
  if (!order) return null;

  return createPortal(
    <div
      className="image-modal-backdrop image-modal-backdrop--stack-top"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="order-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="order-history-head">
          <div>
            <h3 id="order-history-title">{getOrderHistoryTitle(order)}</h3>
            <p className="order-history-sub">
              {order.customer_name}
              {order.order_id?.trim() ? ` · ${order.order_id}` : ""} · Job #{order.id}
            </p>
          </div>
          <div className="order-history-head-actions">
            <button type="button" onClick={onRefresh} disabled={loading}>
              Refresh
            </button>
            <button type="button" onClick={onClose} aria-label="Close order history">
              x
            </button>
          </div>
        </div>
        {error ? (
          <p className="order-history-error">{error}</p>
        ) : loading ? (
          <p className="order-history-loading">Loading activity…</p>
        ) : entries.length === 0 ? (
          <p className="order-history-empty">No activity yet.</p>
        ) : (
          <ul className="order-history-timeline">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={`order-history-item order-history-item--${entry.event_type}`}
              >
                <div className="order-history-item-head">
                  <span className="order-history-event">
                    {getOrderHistoryEventLabel(entry.event_type, order)}
                  </span>
                  <time className="order-history-time" dateTime={entry.created_at}>
                    {formatReceivedAtDisplay(entry.created_at)}
                  </time>
                </div>
                <p className="order-history-message">{entry.message}</p>
                <p className="order-history-actor">By {entry.actor_label || "System"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
