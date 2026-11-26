import { useMemo, useState } from "react";
import { MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { productReceiptState } from "../../orderTabUtils";
import {
  formatDeliveryDate,
  formatSizeBreakdownSummary,
  STAGE_LABEL
} from "../../orderViewUtils";
import OrderStatusBadge from "./OrderStatusBadge";
import ProductReceiptControl from "./ProductReceiptControl";

const PAGE_STEP = 20;

const TABS = [
  { id: "active", label: "All Orders" },
  { id: "complete", label: "Complete" },
  { id: "cancelled", label: "Cancelled" },
  { id: "on_hold", label: "On Hold" },
  { id: "pending", label: "Pending" },
  { id: "print_queue", label: "Print Queue" }
];

const ORDER_STATUS_FILTERS = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "Pending" },
  { id: "on_hold", label: "On Hold" },
  { id: "in_production", label: "In Production" },
  { id: "ready", label: "Ready to Dispatch" },
  { id: "sent_to_dispatch", label: "Sent to Dispatch" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" }
];

const PRODUCT_STATUS_FILTERS = [
  { id: "all", label: "All product statuses" },
  { id: "missing", label: "Not received" },
  { id: "match", label: "Received" },
  { id: "short", label: "Short" },
  { id: "extra", label: "Extra" },
  { id: "rejected", label: "No picklist" },
  { id: "issue", label: "Issue" }
];

const PRODUCT_STATUS_META = {
  missing: { label: "Not received", dot: "bg-amber-500" },
  match: { label: "Received", dot: "bg-green-600" },
  short: { label: "Short", dot: "bg-red-600" },
  extra: { label: "Extra", dot: "bg-yellow-500" },
  rejected: { label: "No picklist", dot: "bg-red-600" },
  issue: { label: "Issue", dot: "bg-red-600" }
};

const STATUS_CHOICES = [
  { id: "pending", label: "Pending" },
  { id: "on_hold", label: "On Hold" },
  { id: "in_production", label: "In Production" },
  { id: "ready", label: "Ready to Dispatch" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" }
];

function displayStatus(order, statusUpdates) {
  return statusUpdates?.[order.id] ?? order.status;
}

function countStats(orders) {
  let pending = 0;
  let ready = 0;
  let completed = 0;
  for (const order of orders) {
    const cancelled = order.status === "cancelled";
    if (order.is_complete && !cancelled) completed += 1;
    if (!order.is_complete && !cancelled && order.status === "pending") pending += 1;
    if (!cancelled && !order.is_complete && (order.status === "ready" || order.status === "sent_to_dispatch")) {
      ready += 1;
    }
  }
  return { total: orders.length, pending, ready, completed };
}

function orderStatusLabel(order, statusUpdates) {
  if (order.is_complete && order.status !== "cancelled") return "Completed";
  const status = displayStatus(order, statusUpdates);
  return STAGE_LABEL[status] || status || "—";
}

export default function PrintingOrdersMobile({
  statsOrders,
  orders,
  loading,
  error,
  ordersTab,
  onOrdersTabChange,
  canAccessPrintQueue,
  searchQuery,
  onSearchQueryChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
  coordinatorFilter,
  onCoordinatorFilterChange,
  coordinatorOptions,
  statusUpdates,
  coordinatorUpdates,
  onOpenOrder,
  onOpenHistory,
  onRequestChange,
  onCancel,
  onRepeat,
  canRepeat,
  canEditStatus,
  canCancelOrder,
  canEditRemarks,
  isAdmin,
  onApplyStatus,
  productReceipt,
  showList,
  statusOrder,
  onStatusOrderChange
}) {
  const [pendingOnly, setPendingOnly] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [productStatusFilter, setProductStatusFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const [actionOrder, setActionOrder] = useState(null);

  const pendingActive = pendingOnly && ordersTab === "active";
  const activeTab = pendingActive ? "pending" : ordersTab;
  const stats = useMemo(() => countStats(statsOrders), [statsOrders]);
  const filtersActive =
    Boolean(dateFrom || dateTo) ||
    coordinatorFilter !== "none" ||
    orderStatusFilter !== "all" ||
    productStatusFilter !== "all" ||
    Boolean(String(searchQuery ?? "").trim());

  const visibleOrders = useMemo(() => {
    let rows = orders;
    if (pendingActive) rows = rows.filter((order) => order.status === "pending");
    if (orderStatusFilter === "completed") {
      rows = rows.filter((order) => order.is_complete && order.status !== "cancelled");
    } else if (orderStatusFilter !== "all") {
      rows = rows.filter((order) => displayStatus(order, statusUpdates) === orderStatusFilter);
    }
    if (productStatusFilter !== "all") {
      rows = rows.filter((order) => productReceiptState(order) === productStatusFilter);
    }
    return rows;
  }, [orders, pendingActive, orderStatusFilter, productStatusFilter, statusUpdates]);

  const shown = visibleOrders.slice(0, visibleCount);

  function selectTab(id) {
    setVisibleCount(PAGE_STEP);
    if (id === "pending") {
      setPendingOnly(true);
      onOrdersTabChange("active");
      return;
    }
    setPendingOnly(false);
    onOrdersTabChange(id);
  }

  function clearFilters() {
    onClearDates();
    onCoordinatorFilterChange("none");
    onSearchQueryChange("");
    setOrderStatusFilter("all");
    setProductStatusFilter("all");
    setVisibleCount(PAGE_STEP);
  }

  return (
    <div className="space-y-3 md:hidden">
      <div className="grid grid-cols-4 gap-1.5">
        <StatCard label="Total" detail="Total Orders" value={stats.total} />
        <StatCard label="Pending" detail="Pending Orders" value={stats.pending} />
        <StatCard label="Ready" detail="Ready to Dispatch" value={stats.ready} />
        <StatCard label="Complete" detail="Completed Orders" value={stats.completed} />
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={searchQuery}
          onChange={(event) => {
            setVisibleCount(PAGE_STEP);
            onSearchQueryChange(event.target.value);
          }}
          placeholder="Order number, customer, or coordinator"
          aria-label="Search orders"
          className="min-h-11 h-11"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 min-h-11 min-w-11 shrink-0"
          aria-label="Open filters"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal className="size-5" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div className="flex w-max gap-2 pb-1" role="tablist" aria-label="Printing order status">
          {TABS.filter((tab) => tab.id !== "print_queue" || canAccessPrintQueue).map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                variant={selected ? "default" : "outline"}
                className={selected ? "min-h-11 h-11 shrink-0 bg-red-700 text-white hover:bg-red-800" : "min-h-11 h-11 shrink-0"}
                onClick={() => selectTab(tab.id)}
              >
                {tab.label}
              </Button>
            );
          })}
        </div>
      </div>

      {showList ? (
        <>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Orders could not load</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border bg-card px-4 py-10 text-center text-base text-muted-foreground shadow-sm">
              {filtersActive ? "No orders match these filters." : "No orders in this view."}
            </div>
          ) : (
            <div className="space-y-3">
              {shown.map((order) => (
                <MobileOrderCard
                  key={order.clientKey ?? order.id}
                  order={order}
                  statusUpdates={statusUpdates}
                  coordinatorName={coordinatorUpdates?.[order.id] ?? order.coordinator_name}
                  onOpen={() => onOpenOrder(order)}
                  onMenu={() => setActionOrder(order)}
                  productReceipt={productReceipt}
                />
              ))}
              {visibleCount < visibleOrders.length ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 h-11 w-full"
                  onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
                >
                  Show more ({visibleOrders.length - visibleCount} left)
                </Button>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-8">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Date, status, product status, and coordinator use the live order list.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mobile-orders-from">From</Label>
                <DatePicker id="mobile-orders-from" value={dateFrom} onChange={onDateFromChange} className="min-h-11 h-11 w-full" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mobile-orders-to">To</Label>
                <DatePicker id="mobile-orders-to" value={dateTo} onChange={onDateToChange} className="min-h-11 h-11 w-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile-order-status">Order status</Label>
              <Select
                value={orderStatusFilter}
                onValueChange={(value) => {
                  setVisibleCount(PAGE_STEP);
                  setOrderStatusFilter(value);
                }}
              >
                <SelectTrigger id="mobile-order-status" className="min-h-11 h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUS_FILTERS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile-product-status">Product status</Label>
              <Select
                value={productStatusFilter}
                onValueChange={(value) => {
                  setVisibleCount(PAGE_STEP);
                  setProductStatusFilter(value);
                }}
              >
                <SelectTrigger id="mobile-product-status" className="min-h-11 h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUS_FILTERS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile-coordinator">Coordinator</Label>
              <Select value={coordinatorFilter} onValueChange={onCoordinatorFilterChange}>
                <SelectTrigger id="mobile-coordinator" className="min-h-11 h-11">
                  <SelectValue placeholder="All coordinators" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All coordinators</SelectItem>
                  {coordinatorOptions.map((name) => (
                    <SelectItem key={name} value={`coord:${name}`}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-h-11 h-11 flex-1" onClick={clearFilters}>
                Clear
              </Button>
              <Button type="button" className="min-h-11 h-11 flex-1 bg-red-700 text-white hover:bg-red-800" onClick={() => setFiltersOpen(false)}>
                Show orders
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <OrderActionSheet
        order={actionOrder}
        onClose={() => setActionOrder(null)}
        canEditStatus={canEditStatus}
        canCancel={actionOrder ? canCancelOrder(actionOrder) : false}
        canRepeat={canRepeat}
        onOpen={() => {
          const order = actionOrder;
          setActionOrder(null);
          onOpenOrder(order);
        }}
        onEdit={() => {
          const order = actionOrder;
          setActionOrder(null);
          onOpenOrder(order);
        }}
        onStatus={() => {
          const order = actionOrder;
          setActionOrder(null);
          onStatusOrderChange(order);
        }}
        onRequest={() => {
          const order = actionOrder;
          setActionOrder(null);
          onRequestChange(order);
        }}
        onHistory={() => {
          const order = actionOrder;
          setActionOrder(null);
          onOpenHistory(order);
        }}
        onFiles={() => {
          const order = actionOrder;
          setActionOrder(null);
          onOpenOrder(order);
        }}
        onRepeat={() => {
          setActionOrder(null);
          onRepeat();
        }}
        onCancel={() => {
          const order = actionOrder;
          setActionOrder(null);
          onCancel(order);
        }}
      />

      <StatusSheet
        key={statusOrder?.id ?? "status-closed"}
        order={statusOrder}
        statusUpdates={statusUpdates}
        canEditRemarks={canEditRemarks}
        isAdmin={isAdmin}
        onClose={() => onStatusOrderChange(null)}
        onApply={onApplyStatus}
      />
    </div>
  );
}

function StatCard({ label, detail, value }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-2 py-2 shadow-sm" title={detail}>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function MobileOrderCard({ order, statusUpdates, coordinatorName, onOpen, onMenu, productReceipt }) {
  const status = displayStatus(order, statusUpdates);
  const product = PRODUCT_STATUS_META[productReceiptState(order)] ?? PRODUCT_STATUS_META.missing;
  const sizes = formatSizeBreakdownSummary(order.size_breakdown);
  const pending = Boolean(order._isPending);
  return (
    <article
      className="rounded-xl border bg-card p-3 shadow-sm"
      onClick={pending ? undefined : onOpen}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-semibold text-foreground">{order.order_id || "—"}</p>
          <p className="mt-1 break-words text-base text-foreground">{order.customer_name?.trim() || "—"}</p>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">{order.product_name?.trim() || "—"}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 min-h-11 min-w-11 shrink-0"
          aria-label={`Actions for ${order.order_id || "order"}`}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation();
            onMenu();
          }}
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <span className={`size-2.5 rounded-full ${product.dot}`} aria-hidden />
            {product.label}
          </span>
          <OrderStatusBadge
            status={order.is_complete && order.status !== "cancelled" ? "ready" : status}
            label={orderStatusLabel(order, statusUpdates)}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <div>
            <dt className="text-muted-foreground">Coordinator</dt>
            <dd className="font-medium text-foreground">{coordinatorName?.trim() || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="font-medium text-foreground">{formatDeliveryDate(order.due_date)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Quantity</dt>
            <dd className="font-medium tabular-nums text-foreground">{order.qty ?? "—"}</dd>
          </div>
          {sizes !== "—" ? (
            <div>
              <dt className="text-muted-foreground">Sizes</dt>
              <dd className="font-medium text-foreground">{sizes}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {!pending && productReceipt ? (
        <div
          className="mt-3 flex items-center justify-between gap-2 border-t pt-3"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="text-sm text-muted-foreground">Product status</span>
          <ProductReceiptControl
            order={order}
            coordinatorName={coordinatorName}
            canEdit={productReceipt.canEdit(order)}
            userId={productReceipt.userId}
            onSaved={productReceipt.onSaved}
          />
        </div>
      ) : null}
    </article>
  );
}

function OrderActionSheet({
  order,
  onClose,
  canEditStatus,
  canCancel,
  canRepeat,
  onOpen,
  onEdit,
  onStatus,
  onRequest,
  onHistory,
  onFiles,
  onRepeat,
  onCancel
}) {
  return (
    <Sheet open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader>
          <SheetTitle>{order?.order_id || "Order"}</SheetTitle>
          <SheetDescription>{order?.customer_name?.trim() || "Order actions"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-2">
          <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onOpen}>
            View order
          </Button>
          <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onEdit}>
            Edit order
          </Button>
          {canEditStatus && order?.status !== "cancelled" ? (
            <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onStatus}>
              Change order status
            </Button>
          ) : null}
          {order?.status !== "cancelled" ? (
            <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onRequest}>
              Request change
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onHistory}>
            View order history
          </Button>
          <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onFiles}>
            View mockup / files
          </Button>
          {canRepeat ? (
            <Button type="button" variant="outline" className="min-h-11 h-11 justify-start" onClick={onRepeat}>
              Repeat order
            </Button>
          ) : null}
          {canCancel ? (
            <Button type="button" variant="destructive" className="min-h-11 h-11 justify-start" onClick={onCancel}>
              Cancel order
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatusSheet({ order, statusUpdates, canEditRemarks, isAdmin, onClose, onApply }) {
  const current = order ? displayStatus(order, statusUpdates) : "";
  const [selected, setSelected] = useState(order?.is_complete ? "completed" : current);
  const [remarks, setRemarks] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const choice = STATUS_CHOICES.find((item) => item.id === selected);
  const needsReason = selected === "on_hold" || selected === "cancelled";
  const unchanged =
    (selected === "completed" && order?.is_complete) ||
    (selected !== "completed" && selected === current && !String(remarks).trim());
  const completedBlocked = selected === "completed" && !isAdmin;

  async function confirmUpdate() {
    if (!order || saving || unchanged || completedBlocked || !selected) return;
    setSaving(true);
    try {
      const saved = await onApply(order, selected, needsReason ? "" : remarks);
      if (saved) onClose();
      else setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={Boolean(order)}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-8">
        <SheetHeader>
          <SheetTitle>Change order status</SheetTitle>
          <SheetDescription>
            {order?.order_id || "Order"}
            {current ? ` is ${STAGE_LABEL[current] || current}` : ""}
          </SheetDescription>
        </SheetHeader>
        {confirming ? (
          <div className="mt-4 space-y-4">
            <p className="text-base text-foreground">
              {needsReason
                ? `Continue to ${choice?.label || "the next step"} for ${order?.order_id || "this order"}? A reason is required next.`
                : `Update ${order?.order_id || "this order"} to ${choice?.label || "the selected status"}?`}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-h-11 h-11 flex-1" disabled={saving} onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button
                type="button"
                className="min-h-11 h-11 flex-1 bg-red-700 text-white hover:bg-red-800"
                disabled={saving}
                onClick={confirmUpdate}
              >
                {saving ? "Saving…" : "Confirm update"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {STATUS_CHOICES.map((item) => {
              const disabled =
                (item.id === "completed" && !isAdmin) ||
                (item.id === "completed" && order?.is_complete) ||
                (item.id === "cancelled" && order?.status === "cancelled");
              const selectedItem = selected === item.id;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant={selectedItem ? "default" : "outline"}
                  className={selectedItem ? "min-h-11 h-11 w-full justify-start bg-red-700 text-white hover:bg-red-800" : "min-h-11 h-11 w-full justify-start"}
                  disabled={disabled}
                  onClick={() => setSelected(item.id)}
                >
                  {item.label}
                  {item.id === "completed" && !isAdmin ? " (admin only)" : ""}
                </Button>
              );
            })}
            {canEditRemarks && !needsReason ? (
              <div className="space-y-1.5">
                <Label htmlFor="mobile-status-remarks">Remarks (optional)</Label>
                <Textarea
                  id="mobile-status-remarks"
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  rows={3}
                  placeholder="Add a note with this status change"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">On hold and cancel ask for a reason on the next step.</p>
            )}
            {completedBlocked ? (
              <p className="text-sm text-muted-foreground">Only an admin can mark an order completed.</p>
            ) : null}
            <Button
              type="button"
              className="min-h-11 h-11 w-full bg-red-700 text-white hover:bg-red-800"
              disabled={!selected || unchanged || completedBlocked}
              onClick={() => setConfirming(true)}
            >
              Confirm update
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
