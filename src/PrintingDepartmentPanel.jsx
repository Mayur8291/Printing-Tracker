import {
  filterPrintingDepartmentOrders,
  printingPriorityUrgency,
  sortOrdersByPrintingPriority
} from "./orderTabUtils";
import { dispatchRowHighlightClass } from "./orderTabUtils";
import { formatDeliveryDate, STAGE_LABEL } from "./orderViewUtils";

function formatOrderPlacedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const URGENCY_LABEL = {
  overdue: "Overdue",
  today: "Due today",
  tomorrow: "Due tomorrow",
  upcoming: "",
  none: ""
};

export default function PrintingDepartmentPanel({
  orders,
  loadingOrders,
  onViewOrder,
  renderStageIcon
}) {
  const queue = sortOrdersByPrintingPriority(filterPrintingDepartmentOrders(orders));
  const totalQty = queue.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);

  return (
    <>
      <header className="dashboard-panel-head printing-dept-head">
        <h2 className="dashboard-section-title">Printing department</h2>
        <p className="printing-dept-lead linked-tab-lead">
          Priority queue: earliest <strong>delivery date</strong> first. Same delivery day → job placed
          first goes first (24h window by order time).
        </p>
      </header>
      {loadingOrders ? (
        <p>Loading orders…</p>
      ) : (
        <>
          <div className="orders-processed-summary" role="status">
            <div className="orders-processed-summary-main">
              <span className="orders-processed-label">In queue</span>
              <span className="orders-processed-count">{queue.length}</span>
            </div>
            <div className="orders-processed-summary-meta">
              <span className="orders-processed-qty">
                Total qty: <strong>{totalQty}</strong>
              </span>
              <span className="orders-processed-filters">Sorted by delivery priority</span>
            </div>
          </div>
          <div className="table-wrap table-wrap--compact">
            <table className="orders-table-compact printing-dept-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th />
                  <th>Order number</th>
                  <th>Customer</th>
                  <th>Product name</th>
                  <th>Status</th>
                  <th>Delivery date</th>
                  <th>Order placed</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((order, index) => {
                  const urgency = printingPriorityUrgency(order.due_date);
                  const urgencyLabel = URGENCY_LABEL[urgency];
                  return (
                    <tr
                      key={order.id}
                      className={
                        dispatchRowHighlightClass(order) ||
                        (urgency ? `printing-dept-row--${urgency}` : undefined)
                      }
                    >
                      <td className="printing-dept-priority">
                        <span className="printing-dept-rank">#{index + 1}</span>
                        {urgencyLabel ? (
                          <span className={`printing-dept-urgency printing-dept-urgency--${urgency}`}>
                            {urgencyLabel}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-view-order"
                          onClick={() => onViewOrder(order)}
                        >
                          View order
                        </button>
                      </td>
                      <td className="orders-compact-id">
                        {order.order_id?.trim() ? order.order_id : "—"}
                      </td>
                      <td className="orders-compact-customer">
                        {order.customer_name?.trim() ? order.customer_name : "—"}
                      </td>
                      <td className="orders-compact-product">
                        {order.product_name?.trim() ? order.product_name : "—"}
                      </td>
                      <td>
                        <span
                          className={`status-pill status-pill--compact status-${order.status ?? "new"}`}
                        >
                          {renderStageIcon?.(order.status, STAGE_LABEL[order.status])}{" "}
                          {STAGE_LABEL[order.status] ?? order.status ?? "—"}
                        </span>
                      </td>
                      <td className="printing-dept-due">{formatDeliveryDate(order.due_date)}</td>
                      <td className="printing-dept-placed">{formatOrderPlacedAt(order.created_at)}</td>
                      <td>{order.qty}</td>
                    </tr>
                  );
                })}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan={9}>No printing department jobs in the queue.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
