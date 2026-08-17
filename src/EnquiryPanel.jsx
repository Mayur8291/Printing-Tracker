import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribePostgresChanges } from "./realtimeUtils";
import EnquiryDetailDialog from "./EnquiryDetailDialog";
import {
  EMPTY_ENQUIRY_FORM,
  ENQUIRY_PRIORITIES,
  ENQUIRY_PRIORITY_LABEL,
  ENQUIRY_SOURCES,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABEL,
  createEnquiry,
  enquiryStatusCounts,
  fetchEnquiries,
  filterEnquiries,
  profileDisplayName
} from "./enquiryUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { viewerIsActive } from "./viewerUserListUtils";
import { MailQuestion, Plus, RefreshCw } from "lucide-react";

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

function CreateEnquiryDialog({ open, onOpenChange, sessionUserId, onCreated }) {
  const [form, setForm] = useState({ ...EMPTY_ENQUIRY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_ENQUIRY_FORM });
      setError("");
    }
  }, [open]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const row = await createEnquiry({ createdBy: sessionUserId, form });
      onCreated?.(row);
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not create enquiry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New enquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-enquiry-customer">Customer name *</Label>
            <Input
              id="new-enquiry-customer"
              value={form.customer_name}
              onChange={(e) => setField("customer_name", e.target.value)}
              placeholder="Customer or company"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-enquiry-phone">Phone</Label>
              <Input
                id="new-enquiry-phone"
                value={form.customer_phone}
                onChange={(e) => setField("customer_phone", e.target.value)}
                placeholder="+91…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-enquiry-email">Email</Label>
              <Input
                id="new-enquiry-email"
                type="email"
                value={form.customer_email}
                onChange={(e) => setField("customer_email", e.target.value)}
                placeholder="email@example.com"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setField("source", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setField("priority", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {ENQUIRY_PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-enquiry-product">Product / requirement</Label>
            <Textarea
              id="new-enquiry-product"
              value={form.product_details}
              onChange={(e) => setField("product_details", e.target.value)}
              rows={3}
              placeholder="What they asked for…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-enquiry-notes">Notes</Label>
            <Textarea
              id="new-enquiry-notes"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={2}
              placeholder="Extra context…"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Create enquiry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Enquiry tab — admin monitors customer enquiries and assigns team members.
 * Assignees see enquiries assigned to them; creators see what they logged.
 */
export default function EnquiryPanel({ isAdmin, canEdit = false, sessionUserId, teamProfiles }) {
  const mayCreate = isAdmin || canEdit;
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [selectedEnquiry, setSelectedEnquiry] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const profileById = useMemo(() => {
    const map = {};
    for (const p of teamProfiles ?? []) {
      if (p?.id) map[p.id] = p;
    }
    return map;
  }, [teamProfiles]);

  const activeProfiles = useMemo(
    () =>
      [...(teamProfiles ?? [])]
        .filter((p) => viewerIsActive(p))
        .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b))),
    [teamProfiles]
  );

  const loadEnquiries = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const rows = await fetchEnquiries();
      setEnquiries(rows);
      setError("");
    } catch (e) {
      const msg = e.message || "Could not load enquiries.";
      if (msg.includes("Could not find the table")) {
        setError("Enquiry tables not on database yet — apply migration 20260817130922_add_enquiries_dashboard.sql on staging.");
      } else {
        setError(msg);
      }
      setEnquiries([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEnquiries();
  }, [loadEnquiries]);

  useEffect(() => {
    return subscribePostgresChanges({
      channelName: "enquiries-live",
      tables: ["enquiries"],
      onEvent: () => {
        void loadEnquiries({ silent: true });
      }
    });
  }, [loadEnquiries]);

  const counts = useMemo(() => enquiryStatusCounts(enquiries), [enquiries]);

  const visibleEnquiries = useMemo(
    () =>
      filterEnquiries(enquiries, {
        statusFilter,
        searchQuery,
        assigneeFilter: isAdmin ? assigneeFilter : "all"
      }),
    [enquiries, statusFilter, searchQuery, assigneeFilter, isAdmin]
  );

  function openDetail(row) {
    setSelectedEnquiry(row);
    setDetailOpen(true);
  }

  function handleEnquiryUpdated(updated) {
    setEnquiries((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedEnquiry(updated);
  }

  function handleEnquiryCreated(row) {
    setEnquiries((prev) => [row, ...prev]);
    openDetail(row);
  }

  return (
    <section className="panel table-panel dashboard-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="dashboard-section-title flex items-center gap-2">
            <MailQuestion className="h-5 w-5" aria-hidden />
            Enquiry
          </h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Monitor customer enquiries and assign team members to follow up."
              : "Enquiries assigned to you or logged by you."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadEnquiries()}>
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
            Refresh
          </Button>
          {mayCreate ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              New enquiry
            </Button>
          ) : null}
        </div>
      </div>

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
          placeholder="Search code, customer, product…"
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
                <TableHead>Product</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEnquiries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No enquiries match this filter.
                  </TableCell>
                </TableRow>
              ) : (
                visibleEnquiries.map((row) => {
                  const assignee = row.assignee_id ? profileById[row.assignee_id] : null;
                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDetail(row)}
                    >
                      <TableCell className="font-medium">{row.enquiry_code}</TableCell>
                      <TableCell>{row.customer_name}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.product_details || "—"}</TableCell>
                      <TableCell>{row.source || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(STATUS_BADGE_CLASS[row.status])}>
                          {ENQUIRY_STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
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

      <CreateEnquiryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        sessionUserId={sessionUserId}
        onCreated={handleEnquiryCreated}
      />

      <EnquiryDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        enquiry={selectedEnquiry}
        teamProfiles={teamProfiles}
        profileById={profileById}
        isAdmin={isAdmin}
        canEdit={canEdit}
        sessionUserId={sessionUserId}
        onUpdated={handleEnquiryUpdated}
      />
    </section>
  );
}
