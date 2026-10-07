import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ENQUIRY_PRIORITY_LABEL,
  ENQUIRY_STATUS_LABEL,
  ENQUIRY_STATUSES,
  enquiryStatusCounts,
  filterEnquiries,
  profileDisplayName
} from "./enquiryUtils";
import { isEnquiryUnpicked } from "./enquiryConciergeUtils";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";
import { Bell, RefreshCw } from "lucide-react";

const STATUS_FILTERS = [{ id: "all", label: "All" }, ...ENQUIRY_STATUSES.map((id) => ({
  id,
  label: ENQUIRY_STATUS_LABEL[id]
}))];

const STATUS_BADGE_CLASS = {
  new: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
  assigned: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-700",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-700",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-700",
  closed: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600"
};

const PRIORITY_BADGE_CLASS = {
  low: "bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600",
  normal: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
  high: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700",
  urgent: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-700"
};

/** Whole-row tint for Enquiry and Complaints desks (admin and staff). */
const PRIORITY_ROW_CLASS = {
  urgent:
    "bg-red-50 text-foreground hover:bg-red-100/90 border-l-4 border-l-red-500 dark:bg-red-950/55 dark:hover:bg-red-900/50 dark:text-foreground",
  high:
    "bg-amber-50 text-foreground hover:bg-amber-100/90 border-l-4 border-l-amber-500 dark:bg-amber-950/55 dark:hover:bg-amber-900/50 dark:text-foreground",
  normal:
    "bg-sky-50 text-foreground hover:bg-sky-100/90 border-l-4 border-l-sky-400 dark:bg-sky-950/55 dark:hover:bg-sky-900/50 dark:text-foreground",
  low:
    "bg-zinc-50 text-foreground hover:bg-zinc-100/90 border-l-4 border-l-zinc-400 dark:bg-zinc-900/70 dark:hover:bg-zinc-800/80 dark:text-foreground"
};

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

/**
 * Shared Support list: status pills, search, refresh, table.
 * Used by Enquiry and Complaints with the same columns and role rules.
 */
export default function SupportTicketDesk({
  rows,
  profileById,
  activeProfiles,
  isAdmin,
  loading,
  error,
  emptyMessage,
  description,
  headerActions,
  waitingAlerts = [],
  openEscalations = [],
  onRefresh,
  onOpenDetail,
  showTag = false,
  showOrderId = true,
  detailsColumnLabel = "Concerns",
  pageSizeKey = "support-tickets"
}) {
  const columnCount = 8 + (showTag ? 1 : 0) + (showOrderId ? 1 : 0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  const counts = useMemo(() => enquiryStatusCounts(rows), [rows]);
  const slaItems = useMemo(() => {
    const escalated = (openEscalations ?? []).map((row) => ({
      id: `esc-${row.id}`,
      tone: "destructive",
      title: "SLA escalation",
      body: `${row.enquiry_code || "Enquiry"} · ${row.customer_name || "Customer"} — not picked. Customer is not told.`,
      enquiryId: row.enquiry_id
    }));
    const waiting = (waitingAlerts ?? []).map((row) => ({
      id: `wait-${row.enquiryId}`,
      tone: "wait",
      title: "Waiting over 1 hour",
      body: `${row.enquiryCode || "Enquiry"} · ${row.customerName || "Customer"}`,
      enquiryId: row.enquiryId
    }));
    const seen = new Set();
    return [...escalated, ...waiting].filter((item) => {
      if (seen.has(item.enquiryId)) return false;
      seen.add(item.enquiryId);
      return true;
    });
  }, [openEscalations, waitingAlerts]);
  const visibleRows = useMemo(
    () =>
      filterEnquiries(rows, {
        statusFilter,
        searchQuery,
        assigneeFilter: isAdmin ? assigneeFilter : "all"
      }),
    [rows, statusFilter, searchQuery, assigneeFilter, isAdmin]
  );
  const paginationKey = `${statusFilter}|${searchQuery}|${assigneeFilter}`;
  const {
    visible: pageRows,
    total: pageTotal,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(visibleRows, pageSizeKey, paginationKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="relative"
                aria-label={slaItems.length ? `SLA alerts, ${slaItems.length}` : "SLA alerts"}
              >
                <Bell data-icon="inline-start" aria-hidden />
                {slaItems.length ? (
                  <Badge
                    variant="destructive"
                    className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
                  >
                    {slaItems.length > 99 ? "99+" : slaItems.length}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              collisionPadding={12}
              className="w-80 overflow-hidden p-0"
            >
              <div className="border-b px-3 py-2">
                <p className="text-sm font-medium">SLA alerts</p>
                <p className="text-xs text-muted-foreground">Unpicked enquiries. Customer is not told.</p>
              </div>
              {slaItems.length ? (
                <ScrollArea type="always" className="h-72">
                  <ul className="p-1">
                    {slaItems.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="w-full rounded-sm px-2 py-2 text-left hover:bg-accent"
                          onClick={() => {
                            const match = rows.find((e) => e.id === item.enquiryId);
                            if (match) onOpenDetail?.(match);
                          }}
                        >
                          <p
                            className={cn(
                              "text-xs font-medium",
                              item.tone === "destructive" ? "text-destructive" : "text-foreground"
                            )}
                          >
                            {item.title}
                          </p>
                          <p className="text-xs text-muted-foreground">{item.body}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No waiting or escalated tickets.
                </p>
              )}
            </PopoverContent>
          </Popover>
          <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh?.()}>
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
            Refresh
          </Button>
          {headerActions}
        </div>
      </div>

      {isAdmin ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { key: "new", label: "New" },
            { key: "assigned", label: "Assigned" },
            { key: "opened", label: "Opened" },
            { key: "in_progress", label: "In progress" },
            { key: "resolved", label: "Resolved" },
            { key: "closed", label: "Closed" }
          ].map(({ key, label }) => (
            <Card key={key}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="pb-4 text-2xl font-semibold">{counts[key] ?? 0}</CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="h-auto flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="text-xs sm:text-sm">
                {f.label}
                {f.id !== "all" && counts[f.id] != null ? ` (${counts[f.id]})` : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search code, customer, order ID, concerns…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {isAdmin ? (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All assignees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {activeProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {profileDisplayName(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Customer</TableHead>
                {showOrderId ? <TableHead>Order ID</TableHead> : null}
                <TableHead>{detailsColumnLabel}</TableHead>
                <TableHead>Source</TableHead>
                {showTag ? <TableHead>Tag</TableHead> : null}
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row) => {
                  const assignee = row.assignee_id ? profileById[row.assignee_id] : null;
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "cursor-pointer",
                        PRIORITY_ROW_CLASS[row.priority] || PRIORITY_ROW_CLASS.normal
                      )}
                      title={`Priority: ${ENQUIRY_PRIORITY_LABEL[row.priority] ?? row.priority}`}
                      onClick={() => onOpenDetail?.(row)}
                    >
                      <TableCell className="font-medium">{row.enquiry_code}</TableCell>
                      <TableCell>{row.customer_name}</TableCell>
                      {showOrderId ? (
                        <TableCell className="whitespace-nowrap font-medium">{row.order_id || "—"}</TableCell>
                      ) : null}
                      <TableCell className="max-w-[220px] truncate" title={row.product_details || ""}>
                        {row.product_details || "—"}
                      </TableCell>
                      <TableCell>{row.source || "—"}</TableCell>
                      {showTag ? (
                        <TableCell>
                          {row.tag_name ? (
                            <Badge variant="secondary" className="whitespace-nowrap">
                              {row.tag_name}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={cn(STATUS_BADGE_CLASS[row.status])}>
                            {ENQUIRY_STATUS_LABEL[row.status] ?? row.status}
                          </Badge>
                          {isEnquiryUnpicked(row) ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700">
                              Pending
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(PRIORITY_BADGE_CLASS[row.priority])}>
                          {ENQUIRY_PRIORITY_LABEL[row.priority] ?? row.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>{assignee ? profileDisplayName(assignee) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <OrdersPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={pageTotal}
            pageSize={pageSize}
          />
          <OrdersPerPageControl
            idPrefix={`${pageSizeKey}-per-page`}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        </div>
      ) : null}
    </div>
  );
}
