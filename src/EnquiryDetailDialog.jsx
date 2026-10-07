import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ENQUIRY_PRIORITIES,
  ENQUIRY_PRIORITY_LABEL,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABEL,
  assignEnquiry,
  friendlyEnquiryDbError,
  profileDisplayName,
  updateEnquiryFields,
  updateEnquiryStatus
} from "./enquiryUtils";
import {
  ENQUIRY_FALLBACK_MANAGER_NAME,
  UNKNOWN_ACCOUNT_MANAGER_VALUE,
  findFallbackManagerProfile,
  isEnquiryHelpPath,
  isEnquiryUnpicked,
  markEnquiryOpened,
  markEnquiryReachedOut,
  pickEnquiry
} from "./enquiryConciergeUtils";
import { normalizeEnquiryAttachments } from "./enquiryAttachmentUtils";
import { describeEnquiryActivity, fetchEnquiryActivity, logEnquiryActivity } from "./enquiryActivityUtils";
import { notifyEnquiryWatchers } from "./enquiryNotificationUtils";
import { fetchEnquiryOutbound } from "./enquiryCloseNotify";
import { viewerIsActive } from "./viewerUserListUtils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, CheckCircle2, History } from "lucide-react";

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

export default function EnquiryDetailDialog({
  open,
  onOpenChange,
  enquiry,
  teamProfiles,
  profileById,
  isAdmin,
  canEdit: _canEdit,
  sessionUserId,
  onUpdated,
  tags = [],
  sessionTagIds
}) {
  const [assigneeId, setAssigneeId] = useState("");
  const [statusDraft, setStatusDraft] = useState("new");
  const [priorityDraft, setPriorityDraft] = useState("normal");
  const [notesDraft, setNotesDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [reachOutDraft, setReachOutDraft] = useState("");
  const [contactDraft, setContactDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [outbound, setOutbound] = useState([]);

  const mayAssign = isAdmin;
  const mayEditDetails = isAdmin;
  const isStaffView = !isAdmin;
  const isAssignee = enquiry?.assignee_id === sessionUserId;
  const isSlaFallback = enquiry?.escalated_to_id === sessionUserId;
  const isTagMember = Boolean(enquiry?.tag_id && sessionTagIds?.has?.(enquiry.tag_id));
  const mayUpdateStatus = isAdmin || isAssignee || isSlaFallback || isTagMember;
  const isEnquiryKind = isEnquiryHelpPath(enquiry);
  const requirementLabel = isEnquiryKind ? "Enquiry requirement" : "Concerns";
  const tagName = enquiry?.tag_id ? tags.find((t) => t.id === enquiry.tag_id)?.name ?? "" : "";
  const mayPick = isAdmin && enquiry && enquiry.status !== "closed";
  const customerVerified = activity.some((row) => row.action === "verified");

  useEffect(() => {
    if (!open || !enquiry) return;
    setAssigneeId(enquiry.assignee_id || "");
    setStatusDraft(enquiry.status || "new");
    setPriorityDraft(enquiry.priority || "normal");
    setNotesDraft(enquiry.notes || "");
    setTagDraft(enquiry.tag_id || "");
    setReachOutDraft("");
    setContactDraft("");
    setActivityOpen(false);
    setError("");
    void fetchEnquiryActivity(enquiry.id)
      .then(setActivity)
      .catch(() => setActivity([]));
    void fetchEnquiryOutbound(enquiry.id)
      .then(setOutbound)
      .catch(() => setOutbound([]));
  }, [open, enquiry]);

  // Worker (not admin) opened a new/assigned ticket → status "opened" so admin sees it was seen.
  useEffect(() => {
    if (!open || !enquiry || isAdmin) return;
    let cancelled = false;
    void markEnquiryOpened({ enquiry, sessionUserId, isAdmin, isTagMember })
      .then((updated) => {
        if (!cancelled && updated) onUpdated?.(updated);
      })
      .catch((e) => console.warn("enquiry opened mark:", e?.message || e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enquiry?.id, enquiry?.status, enquiry?.picked_at, isAdmin, isTagMember, sessionUserId]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (activityOpen) return;
      onOpenChange?.(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange, activityOpen]);

  const activeProfiles = useMemo(
    () =>
      [...(teamProfiles ?? [])]
        .filter((p) => viewerIsActive(p))
        .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b))),
    [teamProfiles]
  );

  if (!open || !enquiry) return null;

  async function emitUpdated(updated) {
    onUpdated?.(updated);
    const id = updated?.id || enquiry.id;
    try {
      setActivity(await fetchEnquiryActivity(id));
    } catch {
      setActivity([]);
    }
    try {
      setOutbound(await fetchEnquiryOutbound(id));
    } catch {
      setOutbound([]);
    }
  }

  async function handleAssign() {
    if (!mayAssign) return;
    if (!assigneeId) {
      setError("Pick a team member to assign.");
      return;
    }
    setAssigning(true);
    setError("");
    try {
      const unknown = assigneeId === UNKNOWN_ACCOUNT_MANAGER_VALUE;
      const fallback = findFallbackManagerProfile(teamProfiles);
      const nextAssignee = unknown ? fallback?.id : assigneeId;
      if (!nextAssignee) {
        setError(
          unknown
            ? `No ${ENQUIRY_FALLBACK_MANAGER_NAME} user in the team list. Add that profile first.`
            : "Pick a team member to assign."
        );
        return;
      }
      const updated = await assignEnquiry({
        enquiry,
        assigneeId: nextAssignee,
        assignedByUserId: sessionUserId,
        assignedBecauseUnknown: unknown,
        isAdmin: true
      });
      await emitUpdated(updated);
    } catch (e) {
      setError(e.message || "Could not assign enquiry.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleReachOut() {
    if (!mayPick) return;
    const note = reachOutDraft.trim();
    if (!note) {
      setError("Add a comment about what you told the customer.");
      return;
    }
    setPicking(true);
    setError("");
    try {
      const updated = await markEnquiryReachedOut({
        enquiry,
        comment: note,
        sessionUserId,
        isAdmin,
        isTagMember
      });
      setReachOutDraft("");
      await emitUpdated(updated);
    } catch (e) {
      setError(friendlyEnquiryDbError(e) || e.message || "Could not save reach-out.");
    } finally {
      setPicking(false);
    }
  }

  async function handleAddContactEvent() {
    if (!mayUpdateStatus) return;
    const note = contactDraft.trim();
    if (!note) {
      setError("Write what you told the customer.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await logEnquiryActivity({
        enquiryId: enquiry.id,
        actorId: sessionUserId,
        action: "contact",
        detail: note
      });
      await notifyEnquiryWatchers({
        enquiryId: enquiry.id,
        kind: "details",
        summary: "Contact history added"
      });
      setContactDraft("");
      await emitUpdated(enquiry);
    } catch (e) {
      setError(friendlyEnquiryDbError(e) || e.message || "Could not save contact history.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePick(action) {
    if (!mayPick) return;
    setPicking(true);
    setError("");
    try {
      const updated = await pickEnquiry({
        enquiry,
        action,
        sessionUserId,
        isAdmin,
        isTagMember
      });
      await emitUpdated(updated);
      if (action === "closed" && !String(updated.customer_phone ?? "").trim()) {
        setError("Case closed. No customer phone — survey text not sent.");
      }
    } catch (e) {
      setError(friendlyEnquiryDbError(e));
    } finally {
      setPicking(false);
    }
  }

  async function handleSaveDetails() {
    if (!mayEditDetails) return;
    setSaving(true);
    setError("");
    try {
      const patch = {
        notes: notesDraft.trim() || null,
        priority: priorityDraft
      };
      if (isAdmin && isEnquiryKind) patch.tag_id = tagDraft || null;
      const updated = await updateEnquiryFields(enquiry.id, patch);
      await logEnquiryActivity({
        enquiryId: enquiry.id,
        actorId: sessionUserId,
        action: "details",
        detail: enquiry.enquiry_code
      });
      await notifyEnquiryWatchers({
        enquiryId: enquiry.id,
        kind: "details",
        summary: "Notes / priority / tag updated"
      });
      await emitUpdated(updated);
    } catch (e) {
      setError(e.message || "Could not save enquiry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveStatus() {
    if (!mayUpdateStatus) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateEnquiryStatus({
        enquiryId: enquiry.id,
        status: statusDraft,
        isAdmin,
        assigneeId: enquiry.assignee_id,
        sessionUserId,
        enquiry,
        isTagMember
      });
      await emitUpdated(updated);
    } catch (e) {
      setError(friendlyEnquiryDbError(e));
    } finally {
      setSaving(false);
    }
  }

  const assigneeProfile = enquiry.assignee_id ? profileById?.[enquiry.assignee_id] : null;
  const assignedByProfile = enquiry.assigned_by ? profileById?.[enquiry.assigned_by] : null;
  const creatorProfile = enquiry.created_by ? profileById?.[enquiry.created_by] : null;

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onOpenChange?.(false)}
      >
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span>{enquiry.enquiry_code}</span>
                <Badge variant="outline" className={cn(STATUS_BADGE_CLASS[enquiry.status])}>
                  {ENQUIRY_STATUS_LABEL[enquiry.status] ?? enquiry.status}
                </Badge>
                <Badge variant="outline" className={cn(PRIORITY_BADGE_CLASS[enquiry.priority])}>
                  {ENQUIRY_PRIORITY_LABEL[enquiry.priority] ?? enquiry.priority}
                </Badge>
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <span>{enquiry.customer_name}</span>
                {customerVerified ? (
                  <CheckCircle2
                    className="size-4 text-emerald-600 dark:text-emerald-400"
                    aria-label="Customer verified"
                  />
                ) : null}
                {isStaffView ? null : enquiry.source ? <span>· {enquiry.source}</span> : null}
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setActivityOpen(true)}>
              <History data-icon="inline-start" />
              Activity
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">

        {isStaffView ? (
          <div className="flex w-full max-w-md flex-col gap-4">
            <dl className="grid gap-2 text-sm">
              <div className="grid grid-cols-[9.5rem_1fr] gap-2">
                <dt className="text-muted-foreground">Phone</dt>
                <dd>
                  {enquiry.customer_phone ? (
                    <a className="underline underline-offset-2" href={`tel:${enquiry.customer_phone}`}>
                      {enquiry.customer_phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {isEnquiryKind ? null : (
                <div className="grid grid-cols-[9.5rem_1fr] gap-2">
                  <dt className="text-muted-foreground">Order ID</dt>
                  <dd>{enquiry.order_id || "—"}</dd>
                </div>
              )}
              <div className="grid grid-cols-[9.5rem_1fr] gap-2">
                <dt className="text-muted-foreground">{requirementLabel}</dt>
                <dd className="whitespace-pre-wrap">{enquiry.product_details || "—"}</dd>
              </div>
            </dl>

            <Separator />

            <FieldGroup>
              <Field>
                <FieldLabel>Contact history</FieldLabel>
                {activity.length ? (
                  <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto text-sm">
                    {activity.map((row) => {
                      const described = describeEnquiryActivity(
                        row,
                        profileDisplayName(profileById?.[row.actor_id])
                      );
                      return (
                        <li key={row.id} className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{described.title}</span>
                          <span className="text-muted-foreground">{described.body}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No contact events yet.</p>
                )}
              </Field>
              {mayUpdateStatus && enquiry.status !== "closed" ? (
                <Field>
                  <FieldLabel htmlFor="enquiry-contact-event">Add contact event</FieldLabel>
                  <Textarea
                    id="enquiry-contact-event"
                    value={contactDraft}
                    onChange={(e) => setContactDraft(e.target.value)}
                    rows={3}
                    placeholder="What you said / next step…"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || !contactDraft.trim()}
                    onClick={() => void handleAddContactEvent()}
                  >
                    {saving ? "Saving…" : "Add to history"}
                  </Button>
                </Field>
              ) : null}
            </FieldGroup>

            {mayUpdateStatus ? (
              <>
                <Separator />
                <FieldGroup>
                  <Field>
                    <FieldLabel>Status</FieldLabel>
                    <Select value={statusDraft} onValueChange={setStatusDraft}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ENQUIRY_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {ENQUIRY_STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" disabled={saving} onClick={() => void handleSaveStatus()}>
                      {saving ? "Updating…" : "Update status"}
                    </Button>
                  </Field>
                </FieldGroup>
              </>
            ) : null}
          </div>
        ) : null}

        {isStaffView ? null : (
        <>
        <dl className="grid gap-2 text-sm">
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Phone</dt>
            <dd>{enquiry.customer_phone || "—"}</dd>
          </div>
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{enquiry.customer_email || "—"}</dd>
          </div>
          {enquiry.customer_city || enquiry.customer_state ? (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">Location</dt>
              <dd>{[enquiry.customer_city, enquiry.customer_state].filter(Boolean).join(", ")}</dd>
            </div>
          ) : null}
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(enquiry.created_at)}</dd>
          </div>
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Logged by</dt>
            <dd>{profileDisplayName(creatorProfile)}</dd>
          </div>
          {enquiry.assigned_at ? (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">Assigned</dt>
              <dd>
                {formatDateTime(enquiry.assigned_at)}
                {assignedByProfile ? ` by ${profileDisplayName(assignedByProfile)}` : ""}
                {enquiry.assigned_because_unknown
                  ? ` (customer did not know AM — assigned to ${ENQUIRY_FALLBACK_MANAGER_NAME})`
                  : ""}
              </dd>
            </div>
          ) : null}
          {isEnquiryKind ? (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">Tag</dt>
              <dd>
                {tagName ? <Badge variant="secondary">{tagName}</Badge> : "—"}
              </dd>
            </div>
          ) : (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">Order ID</dt>
              <dd>{enquiry.order_id || "—"}</dd>
            </div>
          )}
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">{requirementLabel}</dt>
            <dd className="whitespace-pre-wrap">
              {enquiry.product_details || "—"}
              <span className="mt-1 block text-xs text-muted-foreground">Locked after receive. Not editable.</span>
            </dd>
          </div>
          {enquiry.opened_at ? (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">Opened</dt>
              <dd>
                {formatDateTime(enquiry.opened_at)}
                {enquiry.status === "opened" ? " — seen, no action yet" : ""}
              </dd>
            </div>
          ) : null}
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Picked</dt>
            <dd>
              {enquiry.picked_at
                ? formatDateTime(enquiry.picked_at)
                : "Not picked yet — Verified / Contacted / Reached out / Close counts as pick"}
            </dd>
          </div>
          {enquiry.last_reached_out_at ? (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">Reached out</dt>
              <dd>
                {formatDateTime(enquiry.last_reached_out_at)}
                {enquiry.last_reached_out_by && profileById?.[enquiry.last_reached_out_by]
                  ? ` · ${profileDisplayName(profileById[enquiry.last_reached_out_by])}`
                  : ""}
                {enquiry.last_reached_out_comment ? (
                  <span className="mt-1 block whitespace-pre-wrap">{enquiry.last_reached_out_comment}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {enquiry.sla_escalated_at ? (
            <div className="grid grid-cols-[9.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">SLA</dt>
              <dd>
                Escalated {formatDateTime(enquiry.sla_escalated_at)}
                {isEnquiryUnpicked(enquiry) ? " — still pending pick" : ""}
              </dd>
            </div>
          ) : null}
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Photos</dt>
            <dd>{normalizeEnquiryAttachments(enquiry.attachments).length} image(s)</dd>
          </div>
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">Feedback</dt>
            <dd>
              {enquiry.feedback_rating
                ? `${enquiry.feedback_rating}${enquiry.feedback_comment ? ` — ${enquiry.feedback_comment}` : ""}`
                : enquiry.status === "closed"
                  ? outbound.length
                    ? "Survey text queued — waiting for customer"
                    : String(enquiry.customer_phone ?? "").trim()
                      ? "Closed — waiting for survey send"
                      : "No customer phone — survey text not sent"
                  : "Not asked yet"}
              <span className="mt-1 block text-xs text-muted-foreground">
                Customer feedback is locked after receive. Not editable.
              </span>
            </dd>
          </div>
        </dl>

        {enquiry.status === "closed" && outbound.length ? (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Customer message sent</p>
            {outbound.map((row) => (
              <p key={row.id} className="whitespace-pre-wrap text-muted-foreground">
                {row.text}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Shows in WhatsApp simulator for this phone. Live Meta WhatsApp is not sent from this dashboard.
            </p>
          </div>
        ) : null}

        {normalizeEnquiryAttachments(enquiry.attachments).length ? (
          <div className="flex flex-wrap gap-2">
            {normalizeEnquiryAttachments(enquiry.attachments).map((file) => (
              <a key={file.path} href={file.url} target="_blank" rel="noreferrer">
                <img
                  src={file.url}
                  alt={file.name}
                  className="h-20 w-20 rounded-md border object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}

        {mayPick ? (
          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={picking || customerVerified}
                onClick={() => void handlePick("verified")}
              >
                {customerVerified ? "Verified" : "Mark verified"}
              </Button>
              <Button type="button" variant="secondary" disabled={picking} onClick={() => void handlePick("contacted")}>
                Mark contacted
              </Button>
              <Button type="button" variant="outline" disabled={picking} onClick={() => void handlePick("closed")}>
                Close
              </Button>
            </div>
            <div className="w-full max-w-md">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="enquiry-reach-out">Reached out to customer</FieldLabel>
                  <Textarea
                    id="enquiry-reach-out"
                    value={reachOutDraft}
                    onChange={(e) => setReachOutDraft(e.target.value)}
                    rows={2}
                    placeholder="What you said / next step… required"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={picking || !reachOutDraft.trim()}
                    onClick={() => void handleReachOut()}
                  >
                    {picking ? "Saving…" : "Save reach-out"}
                  </Button>
                </Field>
              </FieldGroup>
            </div>
          </div>
        ) : null}

        <div className="w-full max-w-md">
        {mayEditDetails ? (
          <FieldGroup className="border-t pt-4">
            <Field>
              <FieldLabel htmlFor="enquiry-notes">Notes</FieldLabel>
              <Textarea
                id="enquiry-notes"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                placeholder="Internal notes…"
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select value={priorityDraft} onValueChange={setPriorityDraft}>
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
              </Field>
              {isAdmin && isEnquiryKind ? (
                <Field>
                  <FieldLabel>Tag</FieldLabel>
                  <Select value={tagDraft || "__none__"} onValueChange={(v) => setTagDraft(v === "__none__" ? "" : v)}>
                    <SelectTrigger aria-label="Enquiry tag">
                      <SelectValue placeholder="No tag" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No tag</SelectItem>
                      {tags
                        .filter((t) => t.is_active !== false || t.id === enquiry.tag_id)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Changing the tag changes who can see this enquiry.</FieldDescription>
                </Field>
              ) : null}
            </div>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleSaveDetails()}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          </FieldGroup>
        ) : (
          <p className="border-t pt-4 text-sm">
            <span className="text-muted-foreground">Notes: </span>
            {enquiry.notes || "—"}
          </p>
        )}

        {mayAssign ? (
          <FieldGroup className="border-t pt-4">
            <Field>
              <FieldLabel>Assign to</FieldLabel>
              <Select value={assigneeId || "__none__"} onValueChange={(v) => setAssigneeId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick team member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  <SelectItem value={UNKNOWN_ACCOUNT_MANAGER_VALUE}>
                    I don't know my Account manager → {ENQUIRY_FALLBACK_MANAGER_NAME}
                  </SelectItem>
                  {activeProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {profileDisplayName(p)}
                      {p.department ? ` · ${p.department}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Current: {assigneeProfile ? profileDisplayName(assigneeProfile) : "Nobody assigned yet"}
              </FieldDescription>
            </Field>
            <Button type="button" disabled={assigning || !assigneeId} onClick={() => void handleAssign()}>
              {assigning ? "Assigning…" : "Assign user"}
            </Button>
          </FieldGroup>
        ) : (
          <p className="border-t pt-4 text-sm">
            <span className="text-muted-foreground">Assigned to: </span>
            {assigneeProfile ? profileDisplayName(assigneeProfile) : "Waiting for admin to assign"}
          </p>
        )}

        {mayUpdateStatus ? (
          <FieldGroup className="border-t pt-4">
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={statusDraft} onValueChange={setStatusDraft}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {ENQUIRY_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void handleSaveStatus()}>
              {saving ? "Updating…" : "Update status"}
            </Button>
          </FieldGroup>
        ) : null}
        </div>
        </>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Sheet open={activityOpen} onOpenChange={setActivityOpen}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>Activity</SheetTitle>
            <SheetDescription>
              What changed on {enquiry.enquiry_code}. Newest first.
            </SheetDescription>
          </SheetHeader>
          {activity.length ? (
            <ScrollArea className="h-72">
              <ul className="flex flex-col gap-3 pr-4">
                {activity.map((row) => {
                  const described = describeEnquiryActivity(row, profileDisplayName(profileById?.[row.actor_id]));
                  return (
                    <li key={row.id} className="flex flex-col gap-0.5 border-b pb-3 last:border-b-0">
                      <p className="text-sm font-medium">{described.title}</p>
                      <p className="text-sm text-muted-foreground">{described.body}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</p>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
