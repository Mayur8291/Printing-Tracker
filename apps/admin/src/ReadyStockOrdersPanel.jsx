import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { subscribePostgresChanges } from "./realtimeUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ChevronDown, RefreshCw } from "lucide-react";
import ReadyStockOrderDetailDialog from "./ReadyStockOrderDetailDialog";
import { readyStockChannelCode, readyStockChannelLabel } from "./readyStockChannelUtils";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "PENDING", label: "Pending" },
  { id: "PROCESSING", label: "Processing" },
  { id: "COMPLETE", label: "Complete" },
  { id: "CANCELLED", label: "Cancelled" },
  { id: "FAILED", label: "Failed" }
];

const STATUS_BADGE_CLASS = {
  PENDING: "bg-muted text-muted-foreground",
  PROCESSING: "bg-secondary text-secondary-foreground",
  COMPLETE: "bg-secondary text-secondary-foreground",
  CANCELLED: "bg-muted text-muted-foreground",
  FAILED: "bg-muted text-muted-foreground"
};

function formatInr(n) {
  const v = Number(n) || 0;
  return `INR ${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function orderAmount(items) {
  return items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
}

/**
 * Ready Stock Order tab: live list of Scott International RMP orders created
 * through the Dashboard Order API (scott_orders / scott_order_items).
 * Click order code for detail + picklist generation (PROCESSING status).
 */
export default function ReadyStockOrdersPanel() {
  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [skuMeta, setSkuMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [utilization, setUtilization] = useState([]);
  const [showUtilization, setShowUtilization] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  const loadOrders = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const { data: orderRows, error: orderErr } = await supabase
        .from("scott_orders")
        .select(
          "id, order_code, facility_code, status, due_on, customer, shipping_address, payment, comment, cancel_reason, created_at, updated_at, cancelled_at, dispatched_at, picklist_no, picklist_generated_at, channel_id, channel_code, channel_name, channel_type"
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (orderErr) throw orderErr;

      const ids = (orderRows ?? []).map((o) => o.id);
      let itemRows = [];
      if (ids.length) {
        const { data, error: itemErr } = await supabase
          .from("scott_order_items")
          .select("order_id, item_code, sku_code, quantity, unit_price, dispatched_quantity")
          .in("order_id", ids);
        if (itemErr) throw itemErr;
        itemRows = data ?? [];
      }

      const grouped = {};
      for (const item of itemRows) {
        (grouped[item.order_id] ??= []).push(item);
      }

      const skuCodes = [...new Set(itemRows.map((i) => i.sku_code))];
      let meta = {};
      if (skuCodes.length) {
        const { data: skuRows } = await supabase
          .from("inventory_skus")
          .select("sku_code, name, bin_location")
          .in("sku_code", skuCodes);
        meta = Object.fromEntries(
          (skuRows ?? []).map((s) => [
            s.sku_code,
            { name: s.name, bin: s.bin_location || "" }
          ])
        );
      }

      const { data: utilRows, error: utilErr } = await supabase
        .from("rpt_ready_stock_channel_utilization")
        .select(
          "channel_code, channel_name, channel_type, sku_code, ordered_qty, dispatched_qty, order_count"
        )
        .order("channel_name", { ascending: true });
      if (utilErr) {
        console.warn("Ready Stock utilization load", utilErr);
      }

      setOrders(orderRows ?? []);
      setItemsByOrder(grouped);
      setSkuMeta(meta);
      setUtilization(utilRows ?? []);
      setError("");
    } catch (e) {
      console.warn("Ready Stock orders load", e);
      setError(e?.message || "Failed to load orders.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    return subscribePostgresChanges({
      channelName: "ready-stock-orders-live",
      tables: ["scott_orders", "scott_order_items"],
      onEvent: () => {
        void loadOrders({ silent: true });
      }
    });
  }, [loadOrders]);

  const statusCounts = useMemo(() => {
    const counts = { all: orders.length };
    for (const o of orders) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
    }
    return counts;
  }, [orders]);

  const channelOptions = useMemo(() => {
    const byCode = new Map();
    for (const o of orders) {
      const code = readyStockChannelCode(o);
      if (!byCode.has(code)) {
        byCode.set(code, { id: code, label: readyStockChannelLabel(o) });
      }
    }
    return [...byCode.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (channelFilter !== "all" && readyStockChannelCode(o) !== channelFilter) return false;
      if (!q) return true;
      const items = itemsByOrder[o.id] ?? [];
      const hay = [
        o.order_code,
        o.id,
        o.facility_code,
        o.channel_code,
        o.channel_name,
        o.channel_type,
        o.customer?.name,
        o.customer?.email,
        o.customer?.phone,
        ...items.map((i) => i.sku_code),
        ...items.map((i) => skuMeta[i.sku_code]?.name)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, itemsByOrder, skuMeta, statusFilter, channelFilter, searchQuery]);

  const channelSummaries = useMemo(() => {
    const byCode = new Map();
    for (const row of utilization) {
      const code = row.channel_code || "UNKNOWN";
      const current = byCode.get(code) ?? {
        channel_code: code,
        channel_name: row.channel_name || code,
        channel_type: row.channel_type || "OTHER",
        ordered_qty: 0,
        dispatched_qty: 0,
        order_count: 0
      };
      current.ordered_qty += Number(row.ordered_qty) || 0;
      current.dispatched_qty += Number(row.dispatched_qty) || 0;
      current.order_count += Number(row.order_count) || 0;
      byCode.set(code, current);
    }
    return [...byCode.values()].sort((a, b) => a.channel_name.localeCompare(b.channel_name));
  }, [utilization]);

  const utilizationOrderedTotal = useMemo(
    () => channelSummaries.reduce((sum, row) => sum + (Number(row.ordered_qty) || 0), 0),
    [channelSummaries]
  );

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const selectedItems = selectedOrder ? itemsByOrder[selectedOrder.id] ?? [] : [];

  function handleOrderUpdated(patch) {
    setOrders((prev) => prev.map((o) => (o.id === patch.id ? { ...o, ...patch } : o)));
    void loadOrders({ silent: true });
  }

  return (
    <>
    <Card>
      <CardHeader className="flex flex-col gap-2 space-y-0 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="min-w-0 text-base">Ready Stock Orders</CardTitle>
          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All channels</SelectItem>
                  {channelOptions.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search order, channel, SKU…"
              className="h-8 w-56 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadOrders()}
              disabled={loading}
            >
              <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
        <CardDescription>
          RMP orders from partner apps and channels (live via Order API)
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            aria-expanded={showUtilization}
            onClick={() => setShowUtilization((open) => !open)}
          >
            Channel utilization
            {utilizationOrderedTotal > 0 ? (
              <span className="text-muted-foreground">{utilizationOrderedTotal} ordered</span>
            ) : null}
            <ChevronDown
              data-icon="inline-end"
              className={cn("transition-transform", showUtilization && "rotate-180")}
            />
          </Button>
          {showUtilization ? (
            !utilization.length ? (
              <p className="text-sm text-muted-foreground">
                No utilization yet — new Ready Stock orders will group here by channel and SKU.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {channelSummaries.map((summary) => {
                  const rows = utilization.filter((row) => row.channel_code === summary.channel_code);
                  return (
                    <div key={summary.channel_code} className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">
                        {summary.channel_name} · {Number(summary.ordered_qty)} ordered ·{" "}
                        {Number(summary.dispatched_qty)} dispatched
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead className="text-right">Orders</TableHead>
                            <TableHead className="text-right">Ordered qty</TableHead>
                            <TableHead className="text-right">Dispatched qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                            <TableRow key={`${row.channel_code}-${row.sku_code}`}>
                              <TableCell>
                                <p className="text-xs font-medium">
                                  {skuMeta[row.sku_code]?.name || row.sku_code}
                                </p>
                                <p className="font-mono text-[10px] text-muted-foreground">
                                  {row.sku_code}
                                </p>
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {Number(row.order_count)}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {Number(row.ordered_qty)}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {Number(row.dispatched_qty)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </div>

        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="h-8">
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="h-6 px-2.5 text-xs">
                {f.label}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {statusCounts[f.id] ?? 0}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : !visibleOrders.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {orders.length
              ? "No orders match the current filter."
              : "No app orders yet — orders created through the Order API will appear here instantly."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Order</TableHead>
                <TableHead className="w-36">Placed</TableHead>
                <TableHead className="w-28">Facility</TableHead>
                <TableHead className="w-32">Channel</TableHead>
                <TableHead className="w-52">Customer</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-44">Payment</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="w-36">Due / Dispatched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleOrders.map((order) => {
                const items = itemsByOrder[order.id] ?? [];
                const payment = order.payment ?? {};
                return (
                  <TableRow key={order.id} className="align-top">
                    <TableCell>
                      <button
                        type="button"
                        className="text-left text-sm font-semibold text-primary underline-offset-2 hover:underline"
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        {order.order_code}
                      </button>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{order.id}</p>
                      {order.picklist_no ? (
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {order.picklist_no}
                        </p>
                      ) : null}
                      {items.length > 1 ? (
                        <Badge variant="secondary" className="mt-1 text-[10px] font-normal">
                          +{items.length} ITEMS
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(order.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {order.facility_code}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {readyStockChannelLabel(order)}
                      </Badge>
                      {order.channel_code && order.channel_name && order.channel_name !== order.channel_code ? (
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {order.channel_code}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs font-medium uppercase">{order.customer?.name || "—"}</p>
                      {order.customer?.email ? (
                        <p className="text-[11px] text-muted-foreground">{order.customer.email}</p>
                      ) : null}
                      {order.customer?.phone ? (
                        <p className="text-[11px] text-muted-foreground">{order.customer.phone}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", STATUS_BADGE_CLASS[order.status])}
                      >
                        {order.status}
                      </Badge>
                      {order.status === "CANCELLED" && order.cancel_reason ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">{order.cancel_reason}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      <p>
                        <span className="italic text-muted-foreground">Method:</span>{" "}
                        {payment.instrument || "—"}
                      </p>
                      <p>
                        <span className="italic text-muted-foreground">Amount:</span>{" "}
                        {formatInr(orderAmount(items))}
                      </p>
                      <p>
                        <span className="italic text-muted-foreground">COD:</span>{" "}
                        {payment.cash_on_delivery ? "Yes" : "No"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        {items.map((item) => (
                          <div key={`${item.order_id}-${item.sku_code}`} className="text-[11px] leading-tight">
                            <p className="font-medium">
                              Name: {skuMeta[item.sku_code]?.name || item.sku_code}
                            </p>
                            <p className="text-muted-foreground">
                              SKU: <span className="font-mono italic">{item.sku_code}</span>
                            </p>
                            <p className="text-muted-foreground">
                              Quantity: {Number(item.quantity)}
                              {Number(item.dispatched_quantity) > 0
                                ? ` (dispatched ${Number(item.dispatched_quantity)})`
                                : ""}
                            </p>
                          </div>
                        ))}
                        {!items.length ? (
                          <p className="text-[11px] text-muted-foreground">No items</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {order.dispatched_at
                        ? `Dispatched ${formatDateTime(order.dispatched_at)}`
                        : order.due_on
                          ? `Due ${formatDateTime(order.due_on)}`
                          : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

      <ReadyStockOrderDetailDialog
        open={Boolean(selectedOrder)}
        onOpenChange={(next) => {
          if (!next) setSelectedOrderId(null);
        }}
        order={selectedOrder}
        items={selectedItems}
        skuMeta={skuMeta}
        onOrderUpdated={handleOrderUpdated}
      />
    </>
  );
}
