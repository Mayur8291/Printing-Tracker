import { useCallback, useEffect, useMemo, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { OrdersPagination, usePagination } from "@/orderPagination";
import InternalSupportHistoryFilters from "./InternalSupportHistoryFilters";
import {
  INTERNAL_SUPPORT_FLOOR_OPTIONS,
  INTERNAL_SUPPORT_ISSUE_OPTIONS,
  INTERNAL_SUPPORT_STATUSES,
  filterInternalSupportHistoryRows,
  formatInternalSupportIssueDate,
  formatInternalSupportIssueSummary,
  formatInternalSupportIssueTypes,
  insertInternalSupportIssue,
  internalSupportNeedsFloor,
  isInternalSupportResolved,
  listInternalSupportIssues,
  partitionInternalSupportIssues,
  uniqueInternalSupportHistoryNames,
  updateInternalSupportIssueStatus
} from "./internalSupportIssueUtils";

const INTERNAL_SUPPORT_STATUS_ICON = {
  Open: "📂",
  "In Progress": "⏳",
  Resolved: "✅",
  Closed: "🔒"
};

function InternalSupportStatusIcon({ status }) {
  const icon = INTERNAL_SUPPORT_STATUS_ICON[status] || INTERNAL_SUPPORT_STATUS_ICON.Open;
  return (
    <span className="stage-icon" title={status}>
      {icon}
    </span>
  );
}

function InternalSupportStatusMark({ status, truncate = false }) {
  return (
    <span className={cn("flex items-center gap-1.5", truncate && "truncate")}>
      <InternalSupportStatusIcon status={status} />
      {status}
    </span>
  );
}

function InternalSupportIssuesCard({
  title,
  headerAction = null,
  emptyLabel,
  sourceRows,
  pagedRows,
  loading,
  error,
  isAdmin,
  canChangeStatus,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
  searchQuery,
  onSearchQueryChange,
  nameFilter,
  nameOptions,
  onNameFilterChange,
  showNameFilter,
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
  onPageSizeChange,
  onViewRow,
  onStatusChange
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <InternalSupportHistoryFilters
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
          onClearDates={onClearDates}
          searchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
          nameFilter={nameFilter}
          nameOptions={nameOptions}
          onNameFilterChange={onNameFilterChange}
          showNameFilter={showNameFilter}
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      {sourceRows.length === 0 ? emptyLabel : "No matching issues."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.raised_by_name || "—"}</TableCell>
                      <TableCell>
                        {canChangeStatus && isAdmin && !isInternalSupportResolved(row.status) ? (
                          <Select
                            value={row.status}
                            onValueChange={(status) => onStatusChange?.(row.id, status)}
                          >
                            <SelectTrigger
                              aria-label="Status"
                              className="h-8 min-w-[10rem] max-w-[14rem] text-xs"
                            >
                              <SelectValue placeholder="Status">
                                <InternalSupportStatusMark status={row.status} truncate />
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectGroup>
                                {INTERNAL_SUPPORT_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    <InternalSupportStatusMark status={status} />
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">
                            <InternalSupportStatusMark status={row.status} />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm">{formatInternalSupportIssueSummary(row)}</span>
                          <span className="text-muted-foreground" aria-hidden>
                            →
                          </span>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto px-0 underline"
                            onClick={() => onViewRow?.(row)}
                          >
                            View Issue
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{formatInternalSupportIssueDate(row.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <OrdersPagination
              page={page}
              totalPages={totalPages}
              onPageChange={onPageChange}
              total={total}
              pageSize={pageSize}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ViewIssueDialog({ row, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>View Issue</DialogTitle>
          <DialogDescription>
            Clear note of what they raised, including comments.
          </DialogDescription>
        </DialogHeader>
        {row ? (
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel>Issue</FieldLabel>
              <p className="text-sm">{formatInternalSupportIssueTypes(row.issue_types)}</p>
            </Field>
            {row.floor ? (
              <Field>
                <FieldLabel>Floor</FieldLabel>
                <p className="text-sm">{row.floor}</p>
              </Field>
            ) : null}
            <Field>
              <FieldLabel>Comment</FieldLabel>
              <p className="whitespace-pre-wrap text-sm">{row.comment}</p>
            </Field>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <p className="text-sm">{row.raised_by_name || "—"}</p>
            </Field>
            <Field>
              <FieldLabel>Date</FieldLabel>
              <p className="text-sm">{formatInternalSupportIssueDate(row.created_at)}</p>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <InternalSupportStatusMark status={row.status} />
            </Field>
          </FieldGroup>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RaiseIssueDialog({
  open,
  onOpenChange,
  selectedIssues,
  selectedFloor,
  comment,
  issueInvalid,
  floorInvalid,
  commentInvalid,
  didSubmit,
  submitError,
  submitting,
  floorRequired,
  canShowComment,
  onToggleIssue,
  onSelectFloor,
  onCommentChange,
  onSubmit
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Raise an Issue</DialogTitle>
            <DialogDescription>
              Facing an issue? Select the option below that best describes your problem.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={issueInvalid || undefined}>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Issue types">
                {INTERNAL_SUPPORT_ISSUE_OPTIONS.map((label) => {
                  const isSelected = selectedIssues.includes(label);
                  return (
                    <Button
                      key={label}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      aria-pressed={isSelected}
                      onClick={() => onToggleIssue(label)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              {issueInvalid ? <FieldError>Pick at least one issue.</FieldError> : null}
            </Field>
            {floorRequired ? (
              <FieldSet className="gap-3">
                <FieldLegend>Select your Floor</FieldLegend>
                <Field data-invalid={floorInvalid || undefined}>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Floor">
                    {INTERNAL_SUPPORT_FLOOR_OPTIONS.map((label) => {
                      const isSelected = selectedFloor === label;
                      return (
                        <Button
                          key={label}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          aria-pressed={isSelected}
                          onClick={() => onSelectFloor(label)}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                  {floorInvalid ? <FieldError>Pick a floor.</FieldError> : null}
                </Field>
              </FieldSet>
            ) : null}
            {canShowComment ? (
              <Field data-invalid={commentInvalid || undefined}>
                <FieldLabel htmlFor="internal-support-comment">Comment</FieldLabel>
                <Textarea
                  id="internal-support-comment"
                  name="comment"
                  rows={5}
                  placeholder="Explain the issue in detail"
                  value={comment}
                  aria-invalid={commentInvalid || undefined}
                  onChange={onCommentChange}
                />
                {commentInvalid ? (
                  <FieldError>Write a comment that explains the issue.</FieldError>
                ) : null}
              </Field>
            ) : null}
          </FieldGroup>
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          {didSubmit ? (
            <Alert>
              <AlertDescription>
                Thank you. Your issue has been submitted and the concerned team will look into it shortly.
              </AlertDescription>
            </Alert>
          ) : null}
          {canShowComment ? (
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                Submit
              </Button>
            </DialogFooter>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Tools → Internal Support Platform. Open Tickets + Resolved. Raise an Issue is a button. */
export default function InternalSupportPlatformPanel({
  isAdmin = false,
  sessionUserId = "",
  raiserName = ""
}) {
  const [activeTab, setActiveTab] = useState("open_tickets");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState([]);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [comment, setComment] = useState("");
  const [issueInvalid, setIssueInvalid] = useState(false);
  const [floorInvalid, setFloorInvalid] = useState(false);
  const [commentInvalid, setCommentInvalid] = useState(false);
  const [didSubmit, setDidSubmit] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [viewRow, setViewRow] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [nameFilter, setNameFilter] = useState("all");
  const [resolvedDateFrom, setResolvedDateFrom] = useState("");
  const [resolvedDateTo, setResolvedDateTo] = useState("");
  const [resolvedSearchQuery, setResolvedSearchQuery] = useState("");
  const [resolvedNameFilter, setResolvedNameFilter] = useState("all");

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const rows = await listInternalSupportIssues({ sessionUserId, isAdmin });
      setHistoryRows(rows);
    } catch (err) {
      setHistoryError(err?.message || "Could not load history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [sessionUserId, isAdmin]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function resetRaiseForm() {
    setSelectedIssues([]);
    setSelectedFloor("");
    setComment("");
    setIssueInvalid(false);
    setFloorInvalid(false);
    setCommentInvalid(false);
    setDidSubmit(false);
    setSubmitError("");
  }

  function handleRaiseOpenChange(open) {
    setRaiseOpen(open);
    if (!open) resetRaiseForm();
  }

  function toggleIssue(label) {
    const next = selectedIssues.includes(label)
      ? selectedIssues.filter((item) => item !== label)
      : [...selectedIssues, label];
    setSelectedIssues(next);
    setIssueInvalid(false);
    setDidSubmit(false);
    setSubmitError("");
    if (next.length === 0 || !internalSupportNeedsFloor(next)) {
      setFloorInvalid(false);
    }
    if (next.length === 0) {
      setCommentInvalid(false);
    }
  }

  function selectFloor(label) {
    setSelectedFloor((current) => (current === label ? "" : label));
    setFloorInvalid(false);
    setDidSubmit(false);
    setSubmitError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedComment = comment.trim();
    const noIssues = selectedIssues.length === 0;
    const floorRequired = internalSupportNeedsFloor(selectedIssues);
    const noFloor = floorRequired && selectedFloor.length === 0;
    const noComment = trimmedComment.length === 0;
    setIssueInvalid(noIssues);
    setFloorInvalid(noFloor);
    setCommentInvalid(noComment);
    if (noIssues || noFloor || noComment) {
      console.warn("[internal-support] submit blocked", {
        noIssues,
        noFloor,
        noComment,
        floorRequired
      });
      setDidSubmit(false);
      return;
    }
    if (!sessionUserId) {
      setSubmitError("Sign in to submit an issue.");
      setDidSubmit(false);
      return;
    }
    const name = String(raiserName || "").trim() || "Unknown";
    setSubmitting(true);
    setSubmitError("");
    try {
      await insertInternalSupportIssue({
        raisedBy: sessionUserId,
        raisedByName: name,
        issueTypes: selectedIssues,
        floor: selectedFloor,
        comment: trimmedComment
      });
      console.info("[internal-support] submit saved", {
        issues: selectedIssues,
        floor: selectedFloor,
        comment: trimmedComment
      });
      setSelectedIssues([]);
      setSelectedFloor("");
      setComment("");
      setIssueInvalid(false);
      setFloorInvalid(false);
      setCommentInvalid(false);
      setDidSubmit(true);
      await loadHistory();
    } catch (err) {
      setSubmitError(err?.message || "Could not save the issue.");
      setDidSubmit(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(id, status) {
    const current = historyRows.find((row) => row.id === id);
    if (!isAdmin || isInternalSupportResolved(current?.status)) return;
    const previous = historyRows;
    setHistoryRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, status } : row))
    );
    try {
      const updated = await updateInternalSupportIssueStatus(id, status, {
        isAdmin,
        currentStatus: current?.status
      });
      setHistoryRows((rows) =>
        rows.map((row) => (row.id === id ? updated : row))
      );
      setViewRow((current) => (current?.id === id ? updated : current));
    } catch (err) {
      setHistoryRows(previous);
      setHistoryError(err?.message || "Could not update status.");
    }
  }

  const { open: openRows, resolved: resolvedRows } = useMemo(
    () => partitionInternalSupportIssues(historyRows),
    [historyRows]
  );
  const historyNameOptions = useMemo(
    () => uniqueInternalSupportHistoryNames(openRows),
    [openRows]
  );
  const resolvedNameOptions = useMemo(
    () => uniqueInternalSupportHistoryNames(resolvedRows),
    [resolvedRows]
  );
  const filteredHistoryRows = useMemo(
    () =>
      filterInternalSupportHistoryRows(openRows, {
        dateFrom,
        dateTo,
        searchQuery,
        nameFilter: isAdmin ? nameFilter : "all"
      }),
    [openRows, dateFrom, dateTo, searchQuery, nameFilter, isAdmin]
  );
  const filteredResolvedRows = useMemo(
    () =>
      filterInternalSupportHistoryRows(resolvedRows, {
        dateFrom: resolvedDateFrom,
        dateTo: resolvedDateTo,
        searchQuery: resolvedSearchQuery,
        nameFilter: isAdmin ? resolvedNameFilter : "all"
      }),
    [resolvedRows, resolvedDateFrom, resolvedDateTo, resolvedSearchQuery, resolvedNameFilter, isAdmin]
  );
  const historyFilterKey = `${dateFrom}|${dateTo}|${searchQuery}|${nameFilter}|${filteredHistoryRows.length}`;
  const resolvedFilterKey = `${resolvedDateFrom}|${resolvedDateTo}|${resolvedSearchQuery}|${resolvedNameFilter}|${filteredResolvedRows.length}`;
  const {
    visible: pagedHistoryRows,
    total: historyTotal,
    page: historyPage,
    setPage: setHistoryPage,
    pageSize: historyPageSize,
    setPageSize: setHistoryPageSize,
    totalPages: historyTotalPages
  } = usePagination(filteredHistoryRows, "internal-support-history", historyFilterKey);
  const {
    visible: pagedResolvedRows,
    total: resolvedTotal,
    page: resolvedPage,
    setPage: setResolvedPage,
    pageSize: resolvedPageSize,
    setPageSize: setResolvedPageSize,
    totalPages: resolvedTotalPages
  } = usePagination(filteredResolvedRows, "internal-support-resolved", resolvedFilterKey);

  const hasIssuePick = selectedIssues.length > 0;
  const floorRequired = internalSupportNeedsFloor(selectedIssues);
  const canShowComment =
    hasIssuePick && (!floorRequired || selectedFloor.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="open_tickets">Open Tickets</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>
        <TabsContent value="open_tickets">
          <InternalSupportIssuesCard
            title="Open Tickets"
            emptyLabel="No open tickets yet."
            headerAction={
              <Button type="button" onClick={() => setRaiseOpen(true)}>
                <LifeBuoy data-icon="inline-start" />
                Raise an Issue
              </Button>
            }
            sourceRows={openRows}
            pagedRows={pagedHistoryRows}
            loading={historyLoading}
            error={historyError}
            isAdmin={isAdmin}
            canChangeStatus
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
            nameFilter={nameFilter}
            nameOptions={historyNameOptions}
            onNameFilterChange={setNameFilter}
            showNameFilter={isAdmin}
            page={historyPage}
            totalPages={historyTotalPages}
            onPageChange={setHistoryPage}
            total={historyTotal}
            pageSize={historyPageSize}
            onPageSizeChange={setHistoryPageSize}
            onViewRow={setViewRow}
            onStatusChange={handleStatusChange}
          />
        </TabsContent>
        <TabsContent value="resolved">
          <InternalSupportIssuesCard
            title="Resolved"
            emptyLabel="No resolved issues yet."
            sourceRows={resolvedRows}
            pagedRows={pagedResolvedRows}
            loading={historyLoading}
            error={historyError}
            isAdmin={isAdmin}
            canChangeStatus={false}
            dateFrom={resolvedDateFrom}
            dateTo={resolvedDateTo}
            onDateFromChange={setResolvedDateFrom}
            onDateToChange={setResolvedDateTo}
            onClearDates={() => {
              setResolvedDateFrom("");
              setResolvedDateTo("");
            }}
            searchQuery={resolvedSearchQuery}
            onSearchQueryChange={setResolvedSearchQuery}
            nameFilter={resolvedNameFilter}
            nameOptions={resolvedNameOptions}
            onNameFilterChange={setResolvedNameFilter}
            showNameFilter={isAdmin}
            page={resolvedPage}
            totalPages={resolvedTotalPages}
            onPageChange={setResolvedPage}
            total={resolvedTotal}
            pageSize={resolvedPageSize}
            onPageSizeChange={setResolvedPageSize}
            onViewRow={setViewRow}
          />
        </TabsContent>
        <ViewIssueDialog
          row={viewRow}
          open={Boolean(viewRow)}
          onOpenChange={(open) => {
            if (!open) setViewRow(null);
          }}
        />
        <RaiseIssueDialog
          open={raiseOpen}
          onOpenChange={handleRaiseOpenChange}
          selectedIssues={selectedIssues}
          selectedFloor={selectedFloor}
          comment={comment}
          issueInvalid={issueInvalid}
          floorInvalid={floorInvalid}
          commentInvalid={commentInvalid}
          didSubmit={didSubmit}
          submitError={submitError}
          submitting={submitting}
          floorRequired={floorRequired}
          canShowComment={canShowComment}
          onToggleIssue={toggleIssue}
          onSelectFloor={selectFloor}
          onCommentChange={(event) => {
            setComment(event.target.value);
            setCommentInvalid(false);
            setDidSubmit(false);
            setSubmitError("");
          }}
          onSubmit={handleSubmit}
        />
      </Tabs>
    </div>
  );
}
