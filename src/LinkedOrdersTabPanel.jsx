import { dispatchRowHighlightClass } from "./orderTabUtils";
import { formatDeliveryDate, splitOrderIds, STAGE_LABEL } from "./orderViewUtils";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";

/**
 * Shared list UI for Production Tracker, Billing, and Dispatch tabs.
 */
export default function LinkedOrdersTabPanel({
  tabTitle,
  summaryLabel,
  orders,
  loadingOrders,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
  extraColumn,
  emptyMessage,
  onViewOrder,
  renderStageIcon,
  paginationKey: paginationKeyProp
}) {
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
  const safeOrders = Array.isArray(orders) ? orders : [];
  const totalQty = safeOrders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
  const filterBits = [tabTitle];
  if (dateFrom && dateTo) filterBits.push(`${dateFrom} → ${dateTo}`);
  else if (dateFrom) filterBits.push(`From ${dateFrom}`);
  else if (dateTo) filterBits.push(`To ${dateTo}`);

  const storageKey = paginationKeyProp || `linked-${tabTitle || "list"}`;
  const {
    visible: visibleOrders,
    total: totalFiltered,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(safeOrders, storageKey, `${dateFrom}|${dateTo}`);

  return (
    <>
      <div className="table-filters linked-tab-filters">
        <label>
          From
          <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} />
        </label>
        <button type="button" onClick={onClearDates}>
          Clear
        </button>
        <OrdersPerPageControl
          idPrefix={`${storageKey}-orders-per-page`}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      </div>
      {loadingOrders ? (
        <p>Loading orders…</p>
      ) : (
        <>
          <div className="orders-processed-summary" role="status">
            <div className="orders-processed-summary-main">
              <span className="orders-processed-label">{summaryLabel}</span>
              <span className="orders-processed-count">{totalFiltered}</span>
            </div>
            <div className="orders-processed-summary-meta">
              <span className="orders-processed-qty">
                Total qty: <strong>{totalQty}</strong>
              </span>
              <span className="orders-processed-filters">{filterBits.join(" · ")}</span>
            </div>
          </div>
          <div className="table-wrap table-wrap--compact">
            <table className="orders-table-compact">
              <thead>
                <tr>
                  <th />
                  <th>Order number</th>
                  <th>Customer</th>
                  <th>Product name</th>
                  <th>Status</th>
                  <th>Coordinator</th>
                  <th>Delivery date</th>
                  {extraColumn ? <th>{extraColumn.header}</th> : null}
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => (
                  <tr key={order.id} className={dispatchRowHighlightClass(order) || undefined}>
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
                      {renderOrderIdBadges(order.order_id)}
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
                    <td>{order.coordinator_name || "—"}</td>
                    <td>{formatDeliveryDate(order.due_date)}</td>
                    {extraColumn ? (
                      <td>{extraColumn.render(order)}</td>
                    ) : null}
                    <td>{order.qty}</td>
                  </tr>
                ))}
                {totalFiltered === 0 && (
                  <tr>
                    <td colSpan={extraColumn ? 9 : 8}>{emptyMessage}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <OrdersPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={totalFiltered}
            pageSize={pageSize}
          />
        </>
      )}
    </>
  );
}
