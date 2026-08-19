import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribePostgresChanges } from "./realtimeUtils";
import EnquiryDetailDialog from "./EnquiryDetailDialog";
import {
  EMPTY_ENQUIRY_DESK_FORM,
  EMPTY_ENQUIRY_FORM,
  ENQUIRY_PRIORITIES,
  ENQUIRY_PRIORITY_LABEL,
  ENQUIRY_SOURCES,
  createEnquiryWithPhotos,
  fetchEnquiries,
  friendlyEnquiryDbError,
  profileDisplayName
} from "./enquiryUtils";
import {
  ENQUIRY_ORDER_TYPE_LABEL,
  ENQUIRY_ORDER_TYPES,
  fetchEnquirySlaEscalations,
  isComplaintsHelpPath,
  isEnquiryHelpPath,
  isEnquiryUnpicked,
  listWaitingAlerts,
  lookupOrderForEnquiry,
  ownershipFromLookup,
  runEnquirySlaPass
} from "./enquiryConciergeUtils";
import { validateEnquiryPhotoFile } from "./enquiryAttachmentUtils";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import EnquiryWhatsAppSimulator from "./EnquiryWhatsAppSimulator";
import SupportDelayAlertCard from "./SupportDelayAlertCard";
import SupportProductionStatusCard from "./SupportProductionStatusCard";
import SupportTicketDesk from "./SupportTicketDesk";
import { viewerIsActive } from "./viewerUserListUtils";
import { Headphones, MessageCircle, Plus } from "lucide-react";

const SUPPORT_SUBTABS = [
  { id: "enquiry", label: "Enquiry" },
  { id: "complaints", label: "Complaints" },
  { id: "delay_alert", label: "Delay alert" },
  { id: "order_status", label: "Order status" },
  { id: "report", label: "Report" }
];

function emptyFormForDesk(deskKind) {
  return deskKind === "enquiry" ? { ...EMPTY_ENQUIRY_DESK_FORM } : { ...EMPTY_ENQUIRY_FORM };
}

function CreateEnquiryDialog({ open, onOpenChange, sessionUserId, onCreated, deskKind = "complaint" }) {
  const isEnquiryDesk = deskKind === "enquiry";
  const [form, setForm] = useState(() => emptyFormForDesk(deskKind));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoFiles, setPhotoFiles] = useState([]);
  const [ownershipHint, setOwnershipHint] = useState("");

  useEffect(() => {
    if (open) {
      setForm(emptyFormForDesk(deskKind));
      setError("");
      setPhotoFiles([]);
      setOwnershipHint("");
    }
  }, [open, deskKind]);

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "order_type") {
        if (value === "regular") {
          next.help_topic = "regular";
          next.ticket_kind = "complaint";
        } else if (prev.help_topic === "regular") {
          next.help_topic = "product_issue";
          next.ticket_kind = "complaint";
        }
      }
      if (key === "help_topic") {
        next.ticket_kind = value === "enquiry" ? "enquiry" : "complaint";
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
      const row = await createEnquiryWithPhotos({
        createdBy: sessionUserId,
        files: photoFiles,
        form: {
          ...form,
          ownership_verified: ownershipVerified,
          ticket_kind: isEnquiryDesk ? "enquiry" : "complaint",
          help_topic: isEnquiryDesk
            ? "enquiry"
            : form.order_type === "customized"
              ? "product_issue"
              : "regular",
          order_type: isEnquiryDesk ? "customized" : form.order_type
        }
      });
      onCreated?.(row);
      onOpenChange(false);
    } catch (e) {
      setError(friendlyEnquiryDbError(e) || (isEnquiryDesk ? "Could not create enquiry." : "Could not create complaint."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEnquiryDesk ? "New enquiry" : "New complaint"}</DialogTitle>
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
            <Label htmlFor="new-enquiry-product">{isEnquiryDesk ? "Enquiry details" : "Concerns"}</Label>
            <Textarea
              id="new-enquiry-product"
              value={form.product_details}
              onChange={(e) => setField("product_details", e.target.value)}
              rows={3}
              placeholder={
                isEnquiryDesk
                  ? "What the customer asked on Customized → Enquiries…"
                  : "What the customer said on Help with order…"
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-enquiry-order">Order ID{isEnquiryDesk ? " (optional)" : ""}</Label>
              <Input
                id="new-enquiry-order"
                value={form.order_id}
                onChange={(e) => setField("order_id", e.target.value)}
                onBlur={() => void checkOwnership()}
                placeholder="SC123456"
              />
            </div>
            {isEnquiryDesk ? (
              <div className="space-y-2">
                <Label>Help path</Label>
                <p className="text-sm text-muted-foreground">Help with order → Customized → Enquiries</p>
              </div>
            ) : (
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
            )}
          </div>
          {isEnquiryDesk ? null : (
            <div className="space-y-2">
              <Label>Help path</Label>
              {form.order_type === "regular" ? (
                <p className="text-sm text-muted-foreground">Help with order → Regular Order</p>
              ) : (
                <p className="text-sm text-muted-foreground">Help with order → Customized → Concerns</p>
              )}
            </div>
          )}
          {ownershipHint ? <p className="text-xs text-muted-foreground">{ownershipHint}</p> : null}
          {isEnquiryDesk ? null : (
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
          )}
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
            {saving ? "Saving…" : isEnquiryDesk ? "Create enquiry" : "Create complaint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Support tab — Enquiry and Complaints desks share SupportTicketDesk (pills, search, table, roles).
 */
export default function EnquiryPanel({ isAdmin, canEdit = false, sessionUserId, teamProfiles }) {
  const mayCreate = isAdmin || canEdit;
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEnquiry, setSelectedEnquiry] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDeskKind, setCreateDeskKind] = useState("complaint");
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
      if (msg.includes("ticket_kind") || msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column")) {
        setError(
          "Support ticket columns not on database yet — apply migrations 20260818082754_enquiry_concierge_desk.sql and 20260819100000_enquiry_complaint_code_prefixes.sql on staging."
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
  const enquiryRows = useMemo(() => enquiries.filter(isEnquiryHelpPath), [enquiries]);

  const complaintWaiting = useMemo(
    () => (isAdmin ? listWaitingAlerts(complaintRows) : []),
    [complaintRows, isAdmin]
  );
  const enquiryWaiting = useMemo(
    () => (isAdmin ? listWaitingAlerts(enquiryRows) : []),
    [enquiryRows, isAdmin]
  );

  const complaintEscalations = useMemo(
    () =>
      (slaEscalations ?? []).filter((row) => {
        const enquiry = complaintRows.find((e) => e.id === row.enquiry_id);
        return enquiry ? isEnquiryUnpicked(enquiry) : false;
      }),
    [slaEscalations, complaintRows]
  );
  const enquiryEscalations = useMemo(
    () =>
      (slaEscalations ?? []).filter((row) => {
        const enquiry = enquiryRows.find((e) => e.id === row.enquiry_id);
        return enquiry ? isEnquiryUnpicked(enquiry) : false;
      }),
    [slaEscalations, enquiryRows]
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

  function deskActions(kind) {
    return (
      <>
        {mayCreate ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setSimulatorOpen(true)}>
            <MessageCircle className="mr-1 h-4 w-4" aria-hidden />
            WhatsApp simulator
          </Button>
        ) : null}
        {mayCreate ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCreateDeskKind(kind);
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            {kind === "enquiry" ? "New enquiry" : "New complaint"}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <section className="panel table-panel dashboard-card space-y-4">
      <h2 className="dashboard-section-title flex items-center gap-2">
        <Headphones className="h-5 w-5" aria-hidden />
        Support
      </h2>

      <Tabs value={supportSubTab} onValueChange={setSupportSubTab}>
        <TabsList aria-label="Support views" className="h-auto w-full flex-wrap justify-start">
          {SUPPORT_SUBTABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="enquiry" className="space-y-4">
          <SupportTicketDesk
            rows={enquiryRows}
            profileById={profileById}
            activeProfiles={activeProfiles}
            isAdmin={isAdmin}
            loading={loading}
            error={error}
            emptyMessage="No enquiries from Help with order → Customized → Enquiries."
            description={
              isAdmin
                ? "Assign team members. Staff pick, notes, and close show here live."
                : "Work enquiries assigned to you. You cannot assign. Admin sees your updates."
            }
            headerActions={deskActions("enquiry")}
            waitingAlerts={enquiryWaiting}
            openEscalations={enquiryEscalations}
            onRefresh={() => void loadEnquiries()}
            onOpenDetail={openDetail}
          />
        </TabsContent>

        <TabsContent value="complaints" className="space-y-4">
          <SupportTicketDesk
            rows={complaintRows}
            profileById={profileById}
            activeProfiles={activeProfiles}
            isAdmin={isAdmin}
            loading={loading}
            error={error}
            emptyMessage="No complaints from Help with order → Regular Order or Customized → Concerns."
            description={
              isAdmin
                ? "Assign team members. Staff pick, notes, and close show here live."
                : "Work complaints assigned to you. You cannot assign. Admin sees your updates."
            }
            headerActions={deskActions("complaint")}
            waitingAlerts={complaintWaiting}
            openEscalations={complaintEscalations}
            onRefresh={() => void loadEnquiries()}
            onOpenDetail={openDetail}
          />
        </TabsContent>

        <TabsContent value="delay_alert">
          <SupportDelayAlertCard sessionUserId={sessionUserId} />
        </TabsContent>

        <TabsContent value="order_status">
          <SupportProductionStatusCard />
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
        deskKind={createDeskKind}
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
