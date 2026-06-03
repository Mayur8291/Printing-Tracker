import { useMemo, useRef, useState } from "react";
import {
  dispatchRowHighlightClass,
  filterOrdersBySearch,
  isDispatchVerificationFailed,
  paymentMethodLabel
} from "./orderTabUtils";
import { formatDeliveryDate, splitOrderIds, STAGE_LABEL } from "./orderViewUtils";
import { supabase } from "./supabaseClient";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";

export default function BillingTabPanel({
  orders,
  loadingOrders,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
  onViewOrder,
  onInvoiceUpdated,
  renderStageIcon,
  canEdit = true
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
  const fileInputRef = useRef(null);
  const pendingOrderIdRef = useRef(null);
  const [uploadingInvoiceFor, setUploadingInvoiceFor] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOrders = useMemo(
    () => filterOrdersBySearch(orders, searchQuery),
    [orders, searchQuery]
  );
  const paginationKey = `${dateFrom}|${dateTo}|${searchQuery.trim()}`;
  const {
    visible: visibleOrders,
    total: totalFiltered,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(filteredOrders, "billing", paginationKey);

  const totalQty = filteredOrders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
  const filterBits = ["Billing", "All orders"];
  if (dateFrom && dateTo) filterBits.push(`${dateFrom} → ${dateTo}`);
  else if (dateFrom) filterBits.push(`From ${dateFrom}`);
  else if (dateTo) filterBits.push(`To ${dateTo}`);
  const searchTrimmed = searchQuery.trim();
  if (searchTrimmed) filterBits.push(`Search: “${searchTrimmed}”`);

  function openInvoicePicker(orderId) {
    pendingOrderIdRef.current = orderId;
    fileInputRef.current?.click();
  }

  async function handleInvoiceFileChange(e) {
    const file = e.target.files?.[0];
    const orderId = pendingOrderIdRef.current;
    e.target.value = "";
    pendingOrderIdRef.current = null;
    if (!file || !orderId) return;

    if (file.size <= 0) {
      alert("Choose a valid invoice file.");
      return;
    }

    setUploadingInvoiceFor(orderId);
    try {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
      const path = `${orderId}/${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("order-invoices")
        .upload(path, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from("order-invoices").getPublicUrl(path);
      const invoiceUrl = urlData?.publicUrl;
      if (!invoiceUrl) throw new Error("Could not get invoice URL.");

      const { error: updateError } = await supabase
        .from("orders")
        .update({ invoice_url: invoiceUrl })
        .eq("id", orderId);
      if (updateError) throw new Error(updateError.message);

      await onInvoiceUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingInvoiceFor(null);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="billing-invoice-file-input"
        accept="image/*,application/pdf"
        aria-hidden
        tabIndex={-1}
        onChange={handleInvoiceFileChange}
      />
      <p className="linked-tab-lead">
        All orders in the selected date range. Status shows the live workflow stage (New, Printing, Complete,
        etc.). Upload an invoice per order when ready.
      </p>
      {!canEdit ? (
        <p className="tab-readonly-notice" role="status">
          View only — you can browse billing orders but cannot upload or replace invoices.
        </p>
      ) : null}
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
          Clear dates
        </button>
        <label className="orders-search-field">
          Search
          <input
            type="search"
            className="orders-search-input"
            placeholder="Order #, customer, coordinator…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        {searchTrimmed ? (
          <button type="button" onClick={() => setSearchQuery("")}>
            Clear search
          </button>
        ) : null}
        <OrdersPerPageControl
          idPrefix="billing-orders-per-page"
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
              <span className="orders-processed-label">Billing</span>
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
            <table className="orders-table-compact billing-tab-table">
              <thead>
                <tr>
                  <th />
                  <th>Order number</th>
                  <th>Customer</th>
                  <th>Product name</th>
                  <th>Status</th>
                  <th>Coordinator</th>
                  <th>Delivery date</th>
                  <th>Payment</th>
                  <th>Invoice</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const uploading = uploadingInvoiceFor === order.id;
                  return (
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
                        {isDispatchVerificationFailed(order) ? (
                          <span className="dispatch-failed-badge">FAIL</span>
                        ) : null}
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
                      <td>{paymentMethodLabel(order.payment_method)}</td>
                      <td className="billing-invoice-cell">
                        {order.invoice_url ? (
                          <div className="billing-invoice-actions">
                            <a
                              href={order.invoice_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="billing-invoice-link"
                            >
                              View invoice
                            </a>
                            {canEdit ? (
                              <button
                                type="button"
                                className="btn-upload-invoice"
                                disabled={uploading}
                                onClick={() => openInvoicePicker(order.id)}
                              >
                                {uploading ? "Uploading…" : "Replace"}
                              </button>
                            ) : null}
                          </div>
                        ) : canEdit ? (
                          <button
                            type="button"
                            className="btn-upload-invoice"
                            disabled={uploading}
                            onClick={() => openInvoicePicker(order.id)}
                          >
                            {uploading ? "Uploading…" : "Upload invoice"}
                          </button>
                        ) : (
                          <span className="tab-readonly-inline">—</span>
                        )}
                      </td>
                      <td>{order.qty}</td>
                    </tr>
                  );
                })}
                {visibleOrders.length === 0 && (
                  <tr>
                    <td colSpan={10}>
                      {searchTrimmed
                        ? "No orders match your search in the selected date range."
                        : "No orders in the selected date range."}
                    </td>
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
