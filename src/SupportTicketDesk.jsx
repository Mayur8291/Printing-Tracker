import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { AlertCircle, Clock, RefreshCw } from "lucide-react";

const STATUS_FILTERS = [{ id: "all", label: "All" }, ...ENQUIRY_STATUSES.map((id) => ({
  id,
  label: ENQUIRY_STATUS_LABEL[id]
}))];

const STATUS_BADGE_CLASS = {
  new: "bg-slate-100 text-slate-700 border-slate-200",
  assigned: "bg-violet-50 text-violet-700 border-violet-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-zinc-100 text-zinc-600 border-zinc-200"
};

const PRIORITY_BADGE_CLASS = {
  low: "bg-zinc-50 text-zinc-600 border-zinc-200",
  normal: "bg-slate-50 text-slate-700 border-slate-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  urgent: "bg-red-50 text-red-700 border-red-200"
};

/** Whole-row tint for Enquiry and Complaints desks (admin and staff). */
const PRIORITY_ROW_CLASS = {
  urgent: "bg-red-50 hover:bg-red-100/90 border-l-4 border-l-red-500",
  high: "bg-amber-50 hover:bg-amber-100/90 border-l-4 border-l-amber-500",
  normal: "bg-sky-50 hover:bg-sky-100/90 border-l-4 border-l-sky-400",
  low: "bg-zinc-50 hover:bg-zinc-100/90 border-l-4 border-l-zinc-400"
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
  onOpenDetail
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  const counts = useMemo(() => enquiryStatusCounts(rows), [rows]);
  const visibleRows = useMemo(
    () =>
      filterEnquiries(rows, {
        statusFilter,
        searchQuery,
        assigneeFilter: isAdmin ? assigneeFilter : "all"
      }),
    [rows, statusFilter, searchQuery, assigneeFilter, isAdmin]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh?.()}>
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
            Refresh
          </Button>
          {headerActions}
        </div>
      </div>

      {openEscalations.map((row) => (
        <Alert
          key={row.id}
          variant="destructive"
          className="cursor-pointer"
          onClick={() => {
            const match = rows.find((e) => e.id === row.enquiry_id);
            if (match) onOpenDetail?.(match);
          }}
        >
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertTitle>SLA escalation</AlertTitle>
          <AlertDescription>
            {row.message} Customer {row.customer_name}
            {row.order_id ? ` · Order ${row.order_id}` : ""}. Customer is not told.
          </AlertDescription>
        </Alert>
      ))}

      {isAdmin
        ? waitingAlerts.map((row) => (
            <Alert
              key={`wait-${row.enquiryId}`}
              className="cursor-pointer"
              onClick={() => {
                const match = rows.find((e) => e.id === row.enquiryId);
                if (match) onOpenDetail?.(match);
              }}
            >
              <Clock className="h-4 w-4" aria-hidden />
              <AlertTitle>Waiting over 1 hour (ops)</AlertTitle>
              <AlertDescription>
                {row.message} {row.customerName}
                {row.orderId ? ` · Order ${row.orderId}` : ""}. Not shown to the assignee desk copy.
              </AlertDescription>
            </Alert>
          ))
        : null}

      {isAdmin ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { key: "new", label: "New" },
            { key: "assigned", label: "Assigned" },
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
                <TableHead>Order ID</TableHead>
                <TableHead>Concerns</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => {
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
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.order_id || "—"}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate" title={row.product_details || ""}>
                        {row.product_details || "—"}
                      </TableCell>
                      <TableCell>{row.source || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={cn(STATUS_BADGE_CLASS[row.status])}>
                            {ENQUIRY_STATUS_LABEL[row.status] ?? row.status}
                          </Badge>
                          {isEnquiryUnpicked(row) ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
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
    </div>
  );
}
