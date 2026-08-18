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
  profileDisplayName,
  updateEnquiryFields
} from "./enquiryUtils";
import {
  ENQUIRY_ORDER_TYPE_LABEL,
  ENQUIRY_ORDER_TYPES,
  fetchEnquirySlaEscalations,
  isComplaintsHelpPath,
  isEnquiryUnpicked,
  listWaitingAlerts,
  lookupOrderForEnquiry,
  ownershipFromLookup,
  runEnquirySlaPass
} from "./enquiryConciergeUtils";
import { uploadEnquiryPhotos, validateEnquiryPhotoFile } from "./enquiryAttachmentUtils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import EnquiryWhatsAppSimulator from "./EnquiryWhatsAppSimulator";
import SupportDelayAlertCard from "./SupportDelayAlertCard";
import { viewerIsActive } from "./viewerUserListUtils";
import { AlertCircle, Clock, Headphones, MessageCircle, Plus, RefreshCw } from "lucide-react";

const SUPPORT_SUBTABS = [
  { id: "enquiry", label: "Enquiry" },
  { id: "complaints", label: "Complaints" },
  { id: "report", label: "Report" }
];

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
  const [photoFiles, setPhotoFiles] = useState([]);
  const [ownershipHint, setOwnershipHint] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_ENQUIRY_FORM });
      setError("");
      setPhotoFiles([]);
      setOwnershipHint("");
    }
  }, [open]);

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "order_type") {
        if (value === "regular") next.help_topic = "regular";
        else if (prev.help_topic === "regular") next.help_topic = "product_issue";
      }
      return next;
    });
  }

  async function checkOwnership() {
    const code = String(form.order_id ?? "").trim();
    if (!code) {
      setOwnershipHint("");
      setField("ownership_verified", false);
      return;
    }
    try {
      const lookup = await lookupOrderForEnquiry(code);
      const ownership = ownershipFromLookup(lookup, form.customer_phone);
      setField("ownership_verified", ownership.verified);
      if (lookup.found && lookup.customerName && !form.customer_name) {
        setForm((prev) => ({
          ...prev,
          customer_name: prev.customer_name || lookup.customerName,
          ownership_verified: ownership.verified
        }));
      }
      setOwnershipHint(ownership.label);
    } catch (e) {
      setOwnershipHint(e.message || "Could not look up order.");
      setField("ownership_verified", false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      let ownershipVerified = Boolean(form.ownership_verified);
      if (String(form.order_id ?? "").trim()) {
        const lookup = await lookupOrderForEnquiry(form.order_id);
        const ownership = ownershipFromLookup(lookup, form.customer_phone);
        ownershipVerified = ownership.verified;
      }
      const row = await createEnquiry({
        createdBy: sessionUserId,
        form: { ...form, ownership_verified: ownershipVerified }
      });
      if (photoFiles.length) {
        const uploaded = await uploadEnquiryPhotos({
          userId: sessionUserId,
          enquiryId: row.id,
          files: photoFiles
        });
        const updated = await updateEnquiryFields(row.id, {
          attachments: uploaded.map(({ path, name, mime, size }) => ({ path, name, mime, size }))
        });
        onCreated?.(updated);
      } else {
        onCreated?.(row);
      }
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
            <Label htmlFor="new-enquiry-product">Concerns</Label>
            <Textarea
              id="new-enquiry-product"
              value={form.product_details}
              onChange={(e) => setField("product_details", e.target.value)}
              rows={3}
              placeholder="What the customer said on Help with order…"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-enquiry-order">Order ID</Label>
              <Input
                id="new-enquiry-order"
                value={form.order_id}
                onChange={(e) => setField("order_id", e.target.value)}
                onBlur={() => void checkOwnership()}
                placeholder="SC123456"
              />
            </div>
            <div className="space-y-2">
              <Label>Order type</Label>
              <Select value={form.order_type} onValueChange={(v) => setField("order_type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_ORDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ENQUIRY_ORDER_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Help path</Label>
            {form.order_type === "regular" ? (
              <p className="text-sm text-muted-foreground">Help with order → Regular Order</p>
            ) : (
              <Select value={form.help_topic} onValueChange={(v) => setField("help_topic", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enquiry">Help with order → Customized → Enquiries</SelectItem>
                  <SelectItem value="product_issue">Help with order → Customized → Concerns</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {ownershipHint ? <p className="text-xs text-muted-foreground">{ownershipHint}</p> : null}
          <div className="space-y-2">
            <Label htmlFor="new-enquiry-photos">Photos (product issues)</Label>
            <Input
              id="new-enquiry-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                const bad = files.map(validateEnquiryPhotoFile).find(Boolean);
                if (bad) {
                  setError(bad);
                  e.target.value = "";
                  return;
                }
                setError("");
                setPhotoFiles(files);
              }}
            />
            {photoFiles.length ? (
              <p className="text-xs text-muted-foreground">{photoFiles.length} photo(s) ready</p>
            ) : null}
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
 * Support tab — sub-tabs Enquiry (blank), Complaints (current desk), Report (blank).
 * Assignees see tickets assigned to them; creators see what they logged.
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
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [slaEscalations, setSlaEscalations] = useState([]);
  const [supportSubTab, setSupportSubTab] = useState("complaints");

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
      let rows = await fetchEnquiries();
      const map = {};
      for (const p of teamProfiles ?? []) {
        if (p?.id) map[p.id] = p;
      }
      const canWrite = Boolean(
        isAdmin || rows.some((r) => r.assignee_id === sessionUserId || r.created_by === sessionUserId)
      );
      rows = await runEnquirySlaPass({
        enquiries: rows,
        teamProfiles,
        profileById: map,
        canWrite
      });
      setEnquiries(rows);
      try {
        setSlaEscalations(await fetchEnquirySlaEscalations());
      } catch (slaErr) {
        console.warn("enquiry SLA fetch:", slaErr.message || slaErr);
        setSlaEscalations([]);
      }
      setError("");
    } catch (e) {
      const msg = e.message || "Could not load enquiries.";
      if (msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column")) {
        setError(
          "Enquiry Concierge columns not on database yet — apply migration 20260818082754_enquiry_concierge_desk.sql on staging."
        );
      } else {
        setError(msg);
      }
      setEnquiries([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isAdmin, sessionUserId, teamProfiles]);

  useEffect(() => {
    void loadEnquiries();
  }, [loadEnquiries]);

  useEffect(() => {
    return subscribePostgresChanges({
      channelName: "enquiries-live",
      tables: ["enquiries", "enquiry_sla_escalations", "enquiry_activity_log", "enquiry_outbound_messages"],
      onEvent: () => {
        void loadEnquiries({ silent: true });
      }
    });
  }, [loadEnquiries]);

  const complaintRows = useMemo(() => enquiries.filter(isComplaintsHelpPath), [enquiries]);

  const counts = useMemo(() => enquiryStatusCounts(complaintRows), [complaintRows]);

  const waitingAlerts = useMemo(
    () => (isAdmin ? listWaitingAlerts(complaintRows) : []),
    [complaintRows, isAdmin]
  );
  const openEscalations = useMemo(
    () =>
      (slaEscalations ?? []).filter((row) => {
        const enquiry = complaintRows.find((e) => e.id === row.enquiry_id);
        return enquiry ? isEnquiryUnpicked(enquiry) : false;
      }),
    [slaEscalations, complaintRows]
  );

  const visibleEnquiries = useMemo(
    () =>
      filterEnquiries(complaintRows, {
        statusFilter,
        searchQuery,
        assigneeFilter: isAdmin ? assigneeFilter : "all"
      }),
    [complaintRows, statusFilter, searchQuery, assigneeFilter, isAdmin]
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
      <h2 className="dashboard-section-title flex items-center gap-2">
        <Headphones className="h-5 w-5" aria-hidden />
        Support
      </h2>

      <SupportDelayAlertCard sessionUserId={sessionUserId} />

      <Tabs value={supportSubTab} onValueChange={setSupportSubTab}>
        <TabsList aria-label="Support views">
          {SUPPORT_SUBTABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="enquiry">
          <div className="min-h-[12rem]" />
        </TabsContent>

        <TabsContent value="complaints" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? "Assign team members. Staff pick, notes, and close show here live."
                : "Work complaints assigned to you. You cannot assign. Admin sees your updates."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadEnquiries()}>
                <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
                Refresh
              </Button>
              {mayCreate ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setSimulatorOpen(true)}>
                  <MessageCircle className="mr-1 h-4 w-4" aria-hidden />
                  WhatsApp simulator
                </Button>
              ) : null}
              {mayCreate ? (
                <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  New enquiry
                </Button>
              ) : null}
            </div>
          </div>

      {openEscalations.map((row) => (
        <Alert
          key={row.id}
          variant="destructive"
          className="cursor-pointer"
          onClick={() => {
            const match = enquiries.find((e) => e.id === row.enquiry_id);
            if (match) openDetail(match);
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
                const match = enquiries.find((e) => e.id === row.enquiryId);
                if (match) openDetail(match);
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
              {visibleEnquiries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    No complaints from Help with order → Regular Order or Customized order.
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
        </TabsContent>

        <TabsContent value="report">
          <div className="min-h-[12rem]" />
        </TabsContent>
      </Tabs>

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
      <EnquiryWhatsAppSimulator
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
        sessionUserId={sessionUserId}
        teamProfiles={teamProfiles}
        isAdmin={isAdmin}
        onCreated={(row) => {
          setEnquiries((prev) => [row, ...prev]);
        }}
      />
    </section>
  );
}
