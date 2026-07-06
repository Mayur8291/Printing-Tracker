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
import JobSheetOrderIdBadge from "./JobSheetOrderIdBadge";
import { isJobSheetOrder } from "./jobSheetUtils";
import OrderListStatusCell from "./components/orders/OrderListStatusCell";
import { orderListRowClassName } from "./components/orders/orderTableUtils";
import OrderViewActionCell from "./components/orders/OrderViewActionCell";
import { formatDeliveryDate } from "./orderViewUtils";
import { OrdersPagination, usePagination } from "./orderPagination";
import { cn } from "@/lib/utils";

/**
 * Shared list UI for Production Tracker and similar linked-order tabs.
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
  paginationKey: paginationKeyProp,
  onCreateJobSheet,
  canCreateJobSheet = false,
  canEditStatus = false,
  isAdmin = false,
  statusUpdates = {},
  onStatusChange
}) {
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

  const colSpan = extraColumn ? 9 : 8;

  return (
    <div className="space-y-4">
      <OrdersListFilters
        idPrefix={storageKey}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        onClearDates={onClearDates}
        clearDatesLabel="Clear"
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        extraActions={
          canCreateJobSheet && onCreateJobSheet ? (
            <Button type="button" variant="outline" size="sm" onClick={onCreateJobSheet}>
              Create Job sheet
            </Button>
          ) : null
        }
      />
      {loadingOrders ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <OrdersListSummary
            label={summaryLabel}
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
                  <TableHead className="min-w-[11rem]">Status</TableHead>
                  <TableHead>Coordinator</TableHead>
                  <TableHead>Delivery date</TableHead>
                  {extraColumn ? <TableHead>{extraColumn.header}</TableHead> : null}
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOrders.map((order) => {
                  return (
                    <TableRow
                      key={order.clientKey ?? order.id}
                      className={cn(orderListRowClassName(order), order._isPending && "opacity-70")}
                    >
                      <TableCell>
                        <OrderViewActionCell order={order} onViewOrder={onViewOrder} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isJobSheetOrder(order) ? <JobSheetOrderIdBadge /> : null}
                          <OrderIdBadges orderId={order.order_id} />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate">
                        {order.customer_name?.trim() ? order.customer_name : "—"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate">
                        {order.product_name?.trim() ? order.product_name : "—"}
                      </TableCell>
                      <TableCell>
                        <OrderListStatusCell
                          order={order}
                          canEdit={canEditStatus}
                          isAdmin={isAdmin}
                          statusUpdates={statusUpdates}
                          renderStageIcon={renderStageIcon}
                          onStatusChange={onStatusChange}
                        />
                      </TableCell>
                      <TableCell>{order.coordinator_name || "—"}</TableCell>
                      <TableCell>{formatDeliveryDate(order.due_date)}</TableCell>
                      {extraColumn ? <TableCell>{extraColumn.render(order)}</TableCell> : null}
                      <TableCell className="text-right tabular-nums">{order.qty}</TableCell>
                    </TableRow>
                  );
                })}
                {totalFiltered === 0 && (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                      {emptyMessage}
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
