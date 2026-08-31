import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, Clock, FileSpreadsheet, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { cn } from "@/lib/utils";
import { OrdersPagination, usePagination } from "@/orderPagination";
import PurchaseOrderHistoryFilters from "./PurchaseOrderHistoryFilters";
import PurchaseOrderPrintSheet from "./PurchaseOrderPrintSheet";
import {
  PO_HISTORY_STATUS_COMPLETED,
  PO_HISTORY_STATUS_ORDER,
  PO_HISTORY_STATUS_PENDING,
  PO_HISTORY_STATUS_PO_APPROVED,
  PO_HISTORY_STATUS_PO_SENT,
  PO_HISTORY_VISIBLE_STATUSES,
  PO_OPEN_STATUSES,
  filterPurchaseOrderHistoryRows,
  listGeneratedPurchaseOrders,
  purchaseOrderHistoryStatusMeta,
  uniquePurchaseOrderHistoryCoordinators,
  updatePurchaseOrderHistoryStatus
} from "./purchaseOrderHistoryUtils";
import { formatPurchaseOrderC42Display } from "./purchaseOrderLayout";
import { subscribePostgresChanges } from "./realtimeUtils";

const STATUS_ICONS = {
  [PO_HISTORY_STATUS_PENDING]: Clock,
  [PO_HISTORY_STATUS_PO_SENT]: Send,
  [PO_HISTORY_STATUS_PO_APPROVED]: BadgeCheck,
  [PO_HISTORY_STATUS_COMPLETED]: CheckCircle2
};

function PurchaseOrderStatusBadge({ status }) {
  const meta = purchaseOrderHistoryStatusMeta(status);
  const Icon = STATUS_ICONS[status] || Clock;
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", meta.className)}>
      <Icon aria-hidden />
      {meta.label}
    </Badge>
  );
}

function PurchaseOrderViewDialog({ row, open, onOpenChange }) {
  const snapshot = row?.snapshot || {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-po-view-dialog=""
        className="flex max-h-[95vh] w-auto max-w-[min(100vw-1.5rem,230mm)] flex-col gap-3 overflow-hidden p-3 pt-10 sm:max-w-[min(100vw-1.5rem,230mm)]"
      >
        <DialogHeader data-po-no-print="" className="sr-only">
          <DialogTitle>View PO</DialogTitle>
          <DialogDescription>Print of {row?.voucherCode || "this purchase order"}.</DialogDescription>
        </DialogHeader>
        {row ? (
          <div data-po-view-scroll="" className="min-h-0 flex-1 overflow-auto">
            <PurchaseOrderPrintSheet
              snapshot={snapshot}
              voucherCode={row.voucherCode || snapshot.voucherCode || ""}
              datedLabel={row.poDate || snapshot.datedLabel || ""}
              supplierName={row.supplierName || snapshot.supplierName || ""}
            />
          </div>
        ) : null}
        <DialogFooter data-po-no-print="">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PurchaseOrderHistoryTable({ list = "open", isAdmin = false }) {
  const isHistory = list === "history";
  const canChangeStatus = Boolean(isAdmin) && !isHistory;
  const statuses = isHistory ? PO_HISTORY_VISIBLE_STATUSES : PO_OPEN_STATUSES;
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [coordinator, setCoordinator] = useState("all");

  const coordinatorOptions = useMemo(() => {
    const names = uniquePurchaseOrderHistoryCoordinators(rows);
    if (coordinator && coordinator !== "all" && !names.includes(coordinator)) {
      return [coordinator, ...names].sort((a, b) => a.localeCompare(b));
    }
    return names;
  }, [rows, coordinator]);

  const filteredRows = useMemo(
    () =>
      filterPurchaseOrderHistoryRows(rows, {
        dateFrom,
        dateTo,
        searchQuery,
        coordinator,
        statuses
      }),
    [rows, dateFrom, dateTo, searchQuery, coordinator, statuses]
  );

  const filterResetSignal = `${list}|${dateFrom}|${dateTo}|${searchQuery}|${coordinator}`;
  const pagination = usePagination(filteredRows, isHistory ? "po-history" : "po-open", filterResetSignal);
  const visibleRows = pagination.visible;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await listGeneratedPurchaseOrders();
        if (!cancelled) {
          setRows(next);
          setLoadError("");
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message || "Could not load purchase orders.");
      }
    }
    void load();
    const unsub = subscribePostgresChanges({
      channelName: "purchase-order-history",
      tables: ["dashboard_purchase_orders"],
      onEvent: () => {
        void load();
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function handleStatusChange(id, status) {
    if (!canChangeStatus) return;
    const previous = rows;
    setRows((curr) => curr.map((row) => (row.id === id ? { ...row, status } : row)));
    try {
      await updatePurchaseOrderHistoryStatus(id, status);
    } catch (e) {
      setRows(previous);
      setLoadError(e.message || "Could not update status.");
    }
  }

  const hasFilters = Boolean(dateFrom || dateTo || searchQuery.trim() || coordinator !== "all");
  const emptyNone = isHistory
    ? "No completed purchase orders yet. Backend marks Completed, then they show here."
    : "No open purchase orders. Use Generate PO on Create new PO.";
  const emptyCopy = hasFilters && rows.some((row) => statuses.includes(row.status))
    ? "No purchase orders match these filters."
    : emptyNone;

  return (
    <Card className="shadow-sm">
      <CardContent className="p-0">
        <PurchaseOrderHistoryFilters
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onClearDates={() => {
            setDateFrom("");
            setDateTo("");
          }}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          coordinator={coordinator}
          coordinatorOptions={coordinatorOptions}
          onCoordinatorChange={setCoordinator}
          pageSize={pagination.pageSize}
          onPageSizeChange={pagination.setPageSize}
        />
        {loadError ? (
          <p className="px-4 pt-3 text-sm text-destructive">{loadError}</p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO</TableHead>
              <TableHead>PO Number</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Coordinator</TableHead>
              <TableHead>PO date</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-12 shrink-0 items-center justify-center rounded-sm border bg-background shadow-sm"
                        aria-hidden
                      >
                        <FileSpreadsheet />
                      </div>
                      <Button type="button" variant="link" className="h-auto px-0" onClick={() => setViewRow(row)}>
                        View PO
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{row.voucherCode || "—"}</TableCell>
                  <TableCell className="font-bold">{row.supplierName || "—"}</TableCell>
                  <TableCell>
                    {canChangeStatus ? (
                      <Select
                        value={row.status}
                        onValueChange={(value) => void handleStatusChange(row.id, value)}
                      >
                        <SelectTrigger className="h-8 w-[11.5rem] bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {PO_HISTORY_STATUS_ORDER.map((value) => (
                              <SelectItem key={value} value={value}>
                                <PurchaseOrderStatusBadge status={value} />
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <PurchaseOrderStatusBadge
                        status={isHistory ? PO_HISTORY_STATUS_COMPLETED : row.status}
                      />
                    )}
                  </TableCell>
                  <TableCell>{row.coordinatorName || "—"}</TableCell>
                  <TableCell>{row.poDate || "—"}</TableCell>
                  <TableCell className="text-right">
                    {formatPurchaseOrderC42Display(row.quantity) || "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {emptyCopy}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {filteredRows.length ? (
          <div className="border-t px-4 py-3">
            <OrdersPagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.setPage}
              total={pagination.total}
              pageSize={pagination.pageSize}
            />
          </div>
        ) : null}
        <PurchaseOrderViewDialog
          row={viewRow}
          open={Boolean(viewRow)}
          onOpenChange={(open) => {
            if (!open) setViewRow(null);
          }}
        />
      </CardContent>
    </Card>
  );
}
