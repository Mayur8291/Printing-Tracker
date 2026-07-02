import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Skeleton } from "@/components/ui/skeleton";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {

  Table,

  TableBody,

  TableCell,

  TableHead,

  TableHeader,

  TableRow

} from "@/components/ui/table";

import OrderIdBadges from "./components/orders/OrderIdBadges";

import OrderStatusBadge from "./components/orders/OrderStatusBadge";

import OrdersListSummary from "./components/orders/OrdersListSummary";

import {

  orderListRowClassName,

  PRINTING_URGENCY_LABEL,

  printingUrgencyBadgeClass

} from "./components/orders/orderTableUtils";

import {

  filterPrintingDepartmentOrders,

  printingPriorityUrgency,

  sortOrdersByPrintingPriority

} from "./orderTabUtils";

import { formatDeliveryDate } from "./orderViewUtils";

import StickerOrderIdBadge from "./StickerOrderIdBadge";

import SamplingOrderIdBadge from "./SamplingOrderIdBadge";

import {

  formatStickerQtyDisplay,

  formatStickerSizeDisplay,

  isSamplingOrder,

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

    <div className="space-y-4">

      {!embedded ? (

        <h2 className="text-lg font-semibold tracking-tight">Print Queue</h2>

      ) : null}



      <Tabs value={subTab} onValueChange={setSubTab} aria-label="Print Queue views">

        <TabsList>

          <TabsTrigger value="queue">Queue</TabsTrigger>

          <TabsTrigger value="inventory">Inventory</TabsTrigger>

          <TabsTrigger value="utilization">Printing Utilization</TabsTrigger>

        </TabsList>



        <TabsContent value="inventory" className="mt-4">

          <PrintingDeptInventoryPanel

            sessionUserId={sessionUserId}

            canEdit={canEdit}

            isAdmin={isAdmin}

            teamProfiles={teamProfiles}

          />

        </TabsContent>



        <TabsContent value="utilization" className="mt-4">

          <PrintingUtilizationPanel sessionUserId={sessionUserId} canEdit={canEdit} isAdmin={isAdmin} />

        </TabsContent>



        <TabsContent value="queue" className="mt-4 space-y-4">

          {loadingOrders ? (

            <div className="space-y-3">

              <Skeleton className="h-20 w-full rounded-xl" />

              <Skeleton className="h-64 w-full rounded-xl" />

            </div>

          ) : (

            <>

              <OrdersListSummary label="In queue" count={queue.length} totalQty={totalQty} />

              <OrdersPerPageControl

                idPrefix="printing-dept-orders-per-page"

                pageSize={pageSize}

                onPageSizeChange={setPageSize}

              />

              <div className="rounded-xl border bg-card shadow-sm">

                <Table data-orders-table>

                  <TableHeader>

                    <TableRow>

                      <TableHead className="w-[8rem]">Priority</TableHead>

                      <TableHead className="w-[7rem]" />

                      <TableHead>Order number</TableHead>

                      <TableHead>Customer</TableHead>

                      <TableHead>Product name</TableHead>

                      <TableHead>Status</TableHead>

                      <TableHead>Delivery date</TableHead>

                      <TableHead>Order placed</TableHead>

                      <TableHead className="text-right">Qty</TableHead>

                    </TableRow>

                  </TableHeader>

                  <TableBody>

                    {visibleQueue.map((order, index) => {

                      const absoluteIndex = pageStartIndex + index;

                      const urgency = printingPriorityUrgency(order.due_date);

                      const urgencyLabel = PRINTING_URGENCY_LABEL[urgency];

                      const statusLabel = stageLabelForOrder(order, order.status);

                      return (

                        <TableRow

                          key={order.id}

                          className={orderListRowClassName(order, { urgency })}

                        >

                          <TableCell>

                            <div className="flex flex-col gap-1">

                              <span className="text-sm font-semibold tabular-nums text-foreground">

                                #{absoluteIndex + 1}

                              </span>

                              {urgencyLabel ? (

                                <Badge

                                  variant="outline"

                                  className={printingUrgencyBadgeClass(urgency)}

                                >

                                  {urgencyLabel}

                                </Badge>

                              ) : null}

                            </div>

                          </TableCell>

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

                            {isStickerOrder(order) ? (

                              <StickerOrderIdBadge />

                            ) : isSamplingOrder(order) ? (

                              <SamplingOrderIdBadge orderId={order.order_id} />

                            ) : (

                              <OrderIdBadges orderId={order.order_id} />

                            )}

                          </TableCell>

                          <TableCell className="max-w-[12rem] truncate">

                            {order.customer_name?.trim() ? order.customer_name : "—"}

                          </TableCell>

                          <TableCell className="max-w-[12rem] truncate">

                            {isSamplingOrder(order)

                              ? order.product_name?.trim() || "—"

                              : isStickerOrder(order)

                                ? formatStickerSizeDisplay(order.product_name)

                                : order.product_name?.trim()

                                  ? order.product_name

                                  : "—"}

                          </TableCell>

                          <TableCell>

                            <OrderStatusBadge

                              status={order.status}

                              label={statusLabel}

                              icon={renderStageIcon?.(order.status, statusLabel)}

                            />

                          </TableCell>

                          <TableCell className="font-medium">

                            {formatDeliveryDate(order.due_date)}

                          </TableCell>

                          <TableCell className="text-muted-foreground">

                            {formatOrderPlacedAt(order.created_at)}

                          </TableCell>

                          <TableCell className="text-right tabular-nums">

                            {isStickerOrder(order) || isSamplingOrder(order)

                              ? formatStickerQtyDisplay(order.qty)

                              : order.qty}

                          </TableCell>

                        </TableRow>

                      );

                    })}

                    {totalQueue === 0 && (

                      <TableRow>

                        <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">

                          No printing department jobs in the queue.

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

                total={totalQueue}

                pageSize={pageSize}

              />

            </>

          )}

        </TabsContent>

      </Tabs>

    </div>

  );

}

