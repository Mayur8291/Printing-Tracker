import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import OrdersListFilters from "./components/orders/OrdersListFilters";
import OrdersListSummary from "./components/orders/OrdersListSummary";
import OrderIdBadges from "./components/orders/OrderIdBadges";
import OrderStatusBadge from "./components/orders/OrderStatusBadge";
import { orderListRowClassName } from "./components/orders/orderTableUtils";
import {
  filterOrdersBySearch,
  isDispatchVerificationFailed,
  paymentMethodLabel
} from "./orderTabUtils";
import { formatDeliveryDate, STAGE_LABEL } from "./orderViewUtils";
import { supabase } from "./supabaseClient";
import { OrdersPagination, usePagination } from "./orderPagination";
import { Badge } from "@/components/ui/badge";

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
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept="image/*,application/pdf"
        aria-hidden
        tabIndex={-1}
        onChange={handleInvoiceFileChange}
      />
      <OrdersListFilters
        idPrefix="billing"
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        onClearDates={onClearDates}
        showSearch
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onClearSearch={() => setSearchQuery("")}
        searchPlaceholder="Order #, customer, coordinator…"
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />
      {loadingOrders ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <OrdersListSummary
            label="Billing"
            count={totalFiltered}
            totalQty={totalQty}
            filterBits={filterBits}
          />
          <div className="rounded-xl border bg-card shadow-sm">
            <Table data-orders-table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[7rem]" />
                  <TableHead>Order number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Coordinator</TableHead>
                  <TableHead>Delivery date</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOrders.map((order) => {
                  const uploading = uploadingInvoiceFor === order.id;
                  const statusLabel = STAGE_LABEL[order.status] ?? order.status ?? "—";
                  return (
                    <TableRow key={order.id} className={orderListRowClassName(order)}>
                      <TableCell>
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto px-0"
                          onClick={() => onViewOrder(order)}
                        >
                          View order
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <OrderIdBadges orderId={order.order_id} />
                          {isDispatchVerificationFailed(order) ? (
                            <Badge variant="destructive" className="text-[10px] uppercase">
                              Fail
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate">
                        {order.customer_name?.trim() ? order.customer_name : "—"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate">
                        {order.product_name?.trim() ? order.product_name : "—"}
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge
                          status={order.status}
                          label={statusLabel}
                          icon={renderStageIcon?.(order.status, statusLabel)}
                        />
                      </TableCell>
                      <TableCell>{order.coordinator_name || "—"}</TableCell>
                      <TableCell>{formatDeliveryDate(order.due_date)}</TableCell>
                      <TableCell>{paymentMethodLabel(order.payment_method)}</TableCell>
                      <TableCell>
                        {order.invoice_url ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="link" className="h-auto px-0" asChild>
                              <a href={order.invoice_url} target="_blank" rel="noopener noreferrer">
                                View invoice
                              </a>
                            </Button>
                            {canEdit ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={uploading}
                                onClick={() => openInvoicePicker(order.id)}
                              >
                                {uploading ? "Uploading…" : "Replace"}
                              </Button>
                            ) : null}
                          </div>
                        ) : canEdit ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => openInvoicePicker(order.id)}
                          >
                            {uploading ? "Uploading…" : "Upload invoice"}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{order.qty}</TableCell>
                    </TableRow>
                  );
                })}
                {visibleOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                      {searchTrimmed
                        ? "No orders match your search in the selected date range."
                        : "No orders in the selected date range."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
    </div>
  );
}
