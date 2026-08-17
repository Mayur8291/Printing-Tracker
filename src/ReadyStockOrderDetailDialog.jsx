import { useState } from "react";
import { invokeAuthenticatedEdgeFunction } from "./edgeFunctionUtils";
import { mapScottOrderToPicklistData, openPicklistPdf } from "./picklist/picklistApiClient";
import {
  SCOTT_ORDER_STATUS_HINTS,
  SCOTT_ORDER_STATUS_LABELS,
  scottOrderStatusActions
} from "./readyStockOrderStatusUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ClipboardList, Copy, Loader2 } from "lucide-react";

const STATUS_BADGE_CLASS = {
  PENDING: "bg-slate-100 text-slate-700 border-slate-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-200",
  FAILED: "bg-amber-50 text-amber-700 border-amber-200"
};

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

function formatInr(n) {
  const v = Number(n) || 0;
  return `INR ${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function lineTotal(item) {
  return (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
}

export default function ReadyStockOrderDetailDialog({
  open,
  onOpenChange,
  order,
  items,
  skuMeta,
  onOrderUpdated
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  if (!order) return null;

  const payment = order.payment ?? {};
  const totalAmount = items.reduce((sum, i) => sum + lineTotal(i), 0);
  const canGeneratePicklist = !["COMPLETE", "CANCELLED", "FAILED"].includes(order.status);
  const statusActions = scottOrderStatusActions(order.status);
  const selectedAction = statusActions.find((a) => a.value === statusDraft) ?? null;

  async function applyStatusUpdate() {
    if (!selectedAction) return;
    if (selectedAction.confirm && !window.confirm(selectedAction.confirm)) return;

    setUpdatingStatus(true);
    setError("");
    try {
      const payload =
        selectedAction.action === "cancel"
          ? { order_id: order.id, action: "cancel", reason: "CUSTOMER_CANCELLED" }
          : { order_id: order.id, status: selectedAction.value };

      const data = await invokeAuthenticatedEdgeFunction("scott-order-update-status", payload);
      onOrderUpdated?.({
        id: order.id,
        status: data.status,
        updated_at: data.updated_at,
        dispatched_at: data.dispatched_at ?? order.dispatched_at,
        cancelled_at: data.cancelled_at ?? order.cancelled_at
      });
      setStatusDraft("");
    } catch (e) {
      setError(e?.message || "Failed to update order status.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleGeneratePicklist() {
    setGenerating(true);
    setError("");
    try {
      const data = await invokeAuthenticatedEdgeFunction("scott-order-generate-picklist", {
        order_id: order.id
      });
      const picklistData = mapScottOrderToPicklistData(data);
      await openPicklistPdf(picklistData);
      onOrderUpdated?.({
        id: order.id,
        status: data.status,
        picklist_no: data.picklist_no,
        picklist_generated_at: data.picklist_generated_at
      });
    } catch (e) {
      setError(e?.message || "Failed to generate picklist.");
    } finally {
      setGenerating(false);
    }
  }

  async function copyOrderCode() {
    try {
      await navigator.clipboard.writeText(order.order_code);
    } catch {
      /* ignore */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
        <DialogHeader className="space-y-0 border-b px-6 py-4 text-left">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <p className="text-xs text-muted-foreground">
                Orders &gt;{" "}
                <span className="font-semibold text-foreground">{order.order_code}</span>
              </p>
              <DialogTitle className="mt-1 flex items-center gap-2 text-xl">
                {order.order_code}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={copyOrderCode}
                  aria-label="Copy order code"
                >
                  <Copy className="size-3.5" />
                </Button>
              </DialogTitle>
              <DialogDescription className="font-mono text-[11px]">{order.id}</DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[10px]", STATUS_BADGE_CLASS[order.status])}
              >
                {order.status}
              </Badge>
              {order.picklist_no ? (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {order.picklist_no}
                </Badge>
              ) : null}
              {canGeneratePicklist ? (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleGeneratePicklist}
                  disabled={generating}
                >
                  {generating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ClipboardList className="size-3.5" />
                  )}
                  {order.picklist_no ? "Reprint Picklist" : "Generate Picklist"}
                </Button>
              ) : null}
            </div>
          </div>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          {statusActions.length ? (
            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="ready-stock-status-action" className="text-xs text-muted-foreground">
                    Update status (syncs to app)
                  </Label>
                  <Select value={statusDraft || undefined} onValueChange={setStatusDraft}>
                    <SelectTrigger id="ready-stock-status-action" className="h-9 bg-background">
                      <SelectValue placeholder="Choose next status…" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusActions.map((action) => (
                        <SelectItem key={action.value} value={action.value}>
                          {action.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedAction ? (
                    <p className="text-[11px] text-muted-foreground">{selectedAction.hint}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Current: <strong>{SCOTT_ORDER_STATUS_LABELS[order.status] ?? order.status}</strong>
                      {SCOTT_ORDER_STATUS_HINTS[order.status]
                        ? ` — ${SCOTT_ORDER_STATUS_HINTS[order.status]}`
                        : null}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedAction?.destructive ? "destructive" : "default"}
                  disabled={!selectedAction || updatingStatus}
                  onClick={() => void applyStatusUpdate()}
                >
                  {updatingStatus ? "Updating…" : "Apply status"}
                </Button>
              </div>
            </div>
          ) : order.status ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {SCOTT_ORDER_STATUS_LABELS[order.status] ?? order.status}
              {order.dispatched_at ? ` · Dispatched ${formatDateTime(order.dispatched_at)}` : null}
              {order.cancelled_at ? ` · Cancelled ${formatDateTime(order.cancelled_at)}` : null}
            </p>
          ) : null}
        </DialogHeader>

        <Tabs defaultValue="items" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-6">
            <TabsList className="h-9 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="items"
                className="rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                ORDER ITEMS
              </TabsTrigger>
              <TabsTrigger value="shipments" disabled className="rounded-none px-4 opacity-50">
                SHIPMENTS
              </TabsTrigger>
              <TabsTrigger value="invoices" disabled className="rounded-none px-4 opacity-50">
                INVOICES
              </TabsTrigger>
              <TabsTrigger value="returns" disabled className="rounded-none px-4 opacity-50">
                RETURNS
              </TabsTrigger>
              <TabsTrigger value="activities" disabled className="rounded-none px-4 opacity-50">
                ACTIVITIES
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="items" className="mt-0 min-h-0 flex-1 overflow-auto px-6 py-4">
            <div className="mb-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Facility</p>
                <p className="font-mono font-semibold">{order.facility_code}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Customer</p>
                <p className="font-semibold uppercase">{order.customer?.name || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Placed</p>
                <p>{formatDateTime(order.created_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Payment</p>
                <p>{payment.instrument || "—"} · {formatInr(totalAmount)}</p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Product Description</TableHead>
                  <TableHead className="w-24">Facility</TableHead>
                  <TableHead className="w-28 text-right">Price Info</TableHead>
                  <TableHead className="w-24 text-right">Total Units</TableHead>
                  <TableHead className="w-24 text-right">In Process</TableHead>
                  <TableHead className="w-28 text-right">Unfulfillable</TableHead>
                  <TableHead className="w-24 text-right">Dispatched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const meta = skuMeta[item.sku_code] ?? {};
                  const qty = Number(item.quantity) || 0;
                  const dispatched = Number(item.dispatched_quantity) || 0;
                  const inProcess =
                    order.status === "PROCESSING" ? Math.max(0, qty - dispatched) : 0;
                  const unfulfillable = order.status === "PENDING" ? qty : 0;
                  const description = meta.name || item.sku_code;

                  return (
                    <TableRow key={`${item.order_id}-${item.sku_code}`}>
                      <TableCell className="text-muted-foreground">&gt;</TableCell>
                      <TableCell>
                        <p className="text-xs font-medium">{description}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{item.sku_code}</p>
                        {meta.bin ? (
                          <p className="text-[10px] text-muted-foreground">Shelf: {meta.bin}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {order.facility_code}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs underline decoration-dotted">
                        {formatInr(lineTotal(item))}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">{qty}</TableCell>
                      <TableCell className="text-right text-sm">{inProcess}</TableCell>
                      <TableCell className="text-right text-sm">{unfulfillable}</TableCell>
                      <TableCell className="text-right text-sm">{dispatched}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
