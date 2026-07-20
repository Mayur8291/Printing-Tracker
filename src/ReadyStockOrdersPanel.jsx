import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { subscribePostgresChanges } from "./realtimeUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "PENDING", label: "Pending" },
  { id: "PROCESSING", label: "Processing" },
  { id: "COMPLETE", label: "Complete" },
  { id: "CANCELLED", label: "Cancelled" },
  { id: "FAILED", label: "Failed" }
];

const STATUS_BADGE_CLASS = {
  PENDING: "bg-slate-100 text-slate-700 border-slate-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-200",
  FAILED: "bg-amber-50 text-amber-700 border-amber-200"
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
 * Read-only — orders are mutated by the dashboard-stock-api edge function.
 */
export default function ReadyStockOrdersPanel() {
  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [skuNames, setSkuNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadOrders = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const { data: orderRows, error: orderErr } = await supabase
        .from("scott_orders")
        .select(
          "id, order_code, facility_code, status, due_on, customer, shipping_address, payment, comment, cancel_reason, created_at, updated_at, cancelled_at, dispatched_at"
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
      let names = {};
      if (skuCodes.length) {
        const { data: skuRows } = await supabase
          .from("inventory_skus")
          .select("sku_code, name")
          .in("sku_code", skuCodes);
        names = Object.fromEntries((skuRows ?? []).map((s) => [s.sku_code, s.name]));
      }

      setOrders(orderRows ?? []);
      setItemsByOrder(grouped);
      setSkuNames(names);
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

  const visibleOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      const items = itemsByOrder[o.id] ?? [];
      const hay = [
        o.order_code,
        o.id,
        o.facility_code,
        o.customer?.name,
        o.customer?.email,
        o.customer?.phone,
        ...items.map((i) => i.sku_code),
        ...items.map((i) => skuNames[i.sku_code])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, itemsByOrder, skuNames, statusFilter, searchQuery]);

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Ready Stock Orders</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              RMP orders from the Scott International app (live via Order API)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search order, customer, SKU…"
              className="h-8 w-56 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => loadOrders()}
              disabled={loading}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
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
      </CardHeader>

      <CardContent className="pt-0">
        {error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : loading ? (
          <div className="space-y-2 py-2">
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
                      <p className="text-sm font-semibold text-primary">{order.order_code}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{order.id}</p>
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
                      <div className="space-y-1.5">
                        {items.map((item) => (
                          <div key={`${item.order_id}-${item.sku_code}`} className="text-[11px] leading-tight">
                            <p className="font-medium">
                              Name: {skuNames[item.sku_code] || item.sku_code}
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
  );
}
