import { useEffect, useState } from "react";
import {
  filterPrintingDepartmentOrders,
  printingPriorityUrgency,
  sortOrdersByPrintingPriority
} from "./orderTabUtils";
import { dispatchRowHighlightClass } from "./orderTabUtils";
import { formatDeliveryDate, splitOrderIds, STAGE_LABEL } from "./orderViewUtils";
import StickerOrderIdBadge from "./StickerOrderIdBadge";
import {
  formatStickerQtyDisplay,
  formatStickerSizeDisplay,
  isStickerOrder,
  stageLabelForOrder
} from "./stickerOrderUtils";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";
import PrintingDeptInventoryPanel from "./PrintingDeptInventoryPanel";
import PrintingUtilizationPanel from "./PrintingUtilizationPanel";

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
  renderStageIcon,
  sessionUserId,
  canEdit = false,
  isAdmin = false,
  teamProfiles = [],
  initialSubview = null,
  onNavigateConsumed,
  embedded = false
}) {
  const [subTab, setSubTab] = useState("queue");

  useEffect(() => {
    if (!initialSubview) return;
    setSubTab(initialSubview);
    onNavigateConsumed?.();
  }, [initialSubview, onNavigateConsumed]);

  function renderOrderIdBadges(orderId) {
    const ids = splitOrderIds(orderId);
    if (!ids.length) return "—";
    if (ids.length === 1) return ids[0];
    return (
      <span className="order-id-badges" aria-label="Order IDs">
        {ids.map((id) => (
          <span key={id} className="order-id-badge" title={id}>
            {id}
          </span>
        ))}
      </span>
    );
  }
  const queue = sortOrdersByPrintingPriority(filterPrintingDepartmentOrders(orders));
  const totalQty = queue.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);

  const {
    visible: visibleQueue,
    total: totalQueue,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(queue, "printing-department", `${queue.length}`);

  const pageStartIndex = (page - 1) * pageSize;

  return (
    <>
      {!embedded ? (
      <header className="dashboard-panel-head printing-dept-head">
        <h2 className="dashboard-section-title">Print Queue</h2>
      </header>
      ) : null}

      <div className={`orders-tabs printing-dept-tabs${embedded ? " printing-dept-tabs--embedded" : ""}`} role="tablist" aria-label="Print Queue views">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "queue"}
          className={subTab === "queue" ? "orders-tab is-active" : "orders-tab"}
          onClick={() => setSubTab("queue")}
        >
          Queue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "inventory"}
          className={subTab === "inventory" ? "orders-tab is-active" : "orders-tab"}
          onClick={() => setSubTab("inventory")}
        >
          Inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "utilization"}
          className={subTab === "utilization" ? "orders-tab is-active" : "orders-tab"}
          onClick={() => setSubTab("utilization")}
        >
          Printing Utilization
        </button>
      </div>

      {subTab === "inventory" ? (
        <PrintingDeptInventoryPanel
          sessionUserId={sessionUserId}
          canEdit={canEdit}
          isAdmin={isAdmin}
          teamProfiles={teamProfiles}
        />
      ) : subTab === "utilization" ? (
        <PrintingUtilizationPanel sessionUserId={sessionUserId} canEdit={canEdit} isAdmin={isAdmin} />
      ) : loadingOrders ? (
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
            </div>
          </div>
          <div className="printing-dept-toolbar">
            <OrdersPerPageControl
              idPrefix="printing-dept-orders-per-page"
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
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
                {visibleQueue.map((order, index) => {
                  const absoluteIndex = pageStartIndex + index;
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
                        <span className="printing-dept-rank">#{absoluteIndex + 1}</span>
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
                        {isStickerOrder(order) ? (
                          <StickerOrderIdBadge />
                        ) : (
                          renderOrderIdBadges(order.order_id)
                        )}
                      </td>
                      <td className="orders-compact-customer">
                        {order.customer_name?.trim() ? order.customer_name : "—"}
                      </td>
                      <td className="orders-compact-product">
                        {isStickerOrder(order)
                          ? formatStickerSizeDisplay(order.product_name)
                          : order.product_name?.trim()
                            ? order.product_name
                            : "—"}
                      </td>
                      <td>
                        <span
                          className={`status-pill status-pill--compact status-${order.status ?? "new"}`}
                        >
                          {renderStageIcon?.(order.status, stageLabelForOrder(order, order.status))}{" "}
                          {stageLabelForOrder(order, order.status)}
                        </span>
                      </td>
                      <td className="printing-dept-due">{formatDeliveryDate(order.due_date)}</td>
                      <td className="printing-dept-placed">{formatOrderPlacedAt(order.created_at)}</td>
                      <td>
                        {isStickerOrder(order) ? formatStickerQtyDisplay(order.qty) : order.qty}
                      </td>
                    </tr>
                  );
                })}
                {totalQueue === 0 && (
                  <tr>
                    <td colSpan={9}>No printing department jobs in the queue.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <OrdersPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={totalQueue}
            pageSize={pageSize}
          />
        </>
      )}
    </>
  );
}
