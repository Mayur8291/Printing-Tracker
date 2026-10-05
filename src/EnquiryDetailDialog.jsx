import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  complaintsHelpPathLabel,
  findFallbackManagerProfile,
  isEnquiryUnpicked,
  markEnquiryOpened,
  markEnquiryReachedOut,
  pickEnquiry
} from "./enquiryConciergeUtils";
import { normalizeEnquiryAttachments } from "./enquiryAttachmentUtils";
import { ENQUIRY_ACTIVITY_LABEL, fetchEnquiryActivity, logEnquiryActivity } from "./enquiryActivityUtils";
import { notifyEnquiryWatchers } from "./enquiryNotificationUtils";
import { fetchEnquiryOutbound } from "./enquiryCloseNotify";
import { viewerIsActive } from "./viewerUserListUtils";

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
  canEdit,
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
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState([]);
  const [outbound, setOutbound] = useState([]);

  const mayAssign = isAdmin;
  const mayEditDetails = isAdmin || canEdit;
  const isAssignee = enquiry?.assignee_id === sessionUserId;
  const isSlaFallback = enquiry?.escalated_to_id === sessionUserId;
  const isTagMember = Boolean(enquiry?.tag_id && sessionTagIds?.has?.(enquiry.tag_id));
  const mayUpdateStatus = isAdmin || isAssignee || isSlaFallback || isTagMember;
  const isEnquiryKind = String(enquiry?.ticket_kind ?? "") === "enquiry";
  const tagName = enquiry?.tag_id ? tags.find((t) => t.id === enquiry.tag_id)?.name ?? "" : "";
  const mayPick = mayUpdateStatus && enquiry && enquiry.status !== "closed";

  useEffect(() => {
    if (!open || !enquiry) return;
    setAssigneeId(enquiry.assignee_id || "");
    setStatusDraft(enquiry.status || "new");
    setPriorityDraft(enquiry.priority || "normal");
    setNotesDraft(enquiry.notes || "");
    setTagDraft(enquiry.tag_id || "");
    setReachOutDraft("");
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

  const activeProfiles = useMemo(
    () =>
      [...(teamProfiles ?? [])]
        .filter((p) => viewerIsActive(p))
        .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b))),
    [teamProfiles]
  );

  if (!enquiry) return null;

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{enquiry.enquiry_code}</span>
            <Badge variant="outline" className={cn(STATUS_BADGE_CLASS[enquiry.status])}>
              {ENQUIRY_STATUS_LABEL[enquiry.status] ?? enquiry.status}
            </Badge>
            <Badge variant="outline" className={cn(PRIORITY_BADGE_CLASS[enquiry.priority])}>
              {ENQUIRY_PRIORITY_LABEL[enquiry.priority] ?? enquiry.priority}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {enquiry.customer_name}
            {enquiry.source ? ` · ${enquiry.source}` : ""}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-2 text-sm">
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Phone</dt>
            <dd>{enquiry.customer_phone || "—"}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{enquiry.customer_email || "—"}</dd>
          </div>
          {enquiry.customer_city || enquiry.customer_state ? (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">Location</dt>
              <dd>{[enquiry.customer_city, enquiry.customer_state].filter(Boolean).join(", ")}</dd>
            </div>
          ) : null}
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(enquiry.created_at)}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Logged by</dt>
            <dd>{profileDisplayName(creatorProfile)}</dd>
          </div>
          {enquiry.assigned_at ? (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
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
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">Tag</dt>
              <dd>
                {tagName ? <Badge variant="secondary">{tagName}</Badge> : "—"}
              </dd>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[7rem_1fr] gap-2">
                <dt className="text-muted-foreground">Order ID</dt>
                <dd>{enquiry.order_id || "—"}</dd>
              </div>
              <div className="grid grid-cols-[7rem_1fr] gap-2">
                <dt className="text-muted-foreground">Help path</dt>
                <dd>{complaintsHelpPathLabel(enquiry)}</dd>
              </div>
            </>
          )}
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">
              {String(enquiry.ticket_kind ?? "") === "enquiry" ? "Enquiry details" : "Concerns"}
            </dt>
            <dd className="whitespace-pre-wrap">
              {enquiry.product_details || "—"}
              <span className="mt-1 block text-xs text-muted-foreground">Locked after receive. Not editable.</span>
            </dd>
          </div>
          {isEnquiryKind ? null : (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">Ownership</dt>
              <dd>
                {enquiry.ownership_verified
                  ? "Verified — phone matched the order"
                  : "Not verified — do not assume this customer owns the order"}
              </dd>
            </div>
          )}
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Received</dt>
            <dd>{formatDateTime(enquiry.created_at)}</dd>
          </div>
          {enquiry.opened_at ? (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">Opened</dt>
              <dd>
                {formatDateTime(enquiry.opened_at)}
                {enquiry.status === "opened" ? " — seen, no action yet" : ""}
              </dd>
            </div>
          ) : null}
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Picked</dt>
            <dd>
              {enquiry.picked_at
                ? formatDateTime(enquiry.picked_at)
                : "Not picked yet — Verified / Contacted / Reached out / Close counts as pick"}
            </dd>
          </div>
          {enquiry.last_reached_out_at ? (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
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
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">SLA</dt>
              <dd>
                Escalated {formatDateTime(enquiry.sla_escalated_at)}
                {isEnquiryUnpicked(enquiry) ? " — still pending pick" : ""}
              </dd>
            </div>
          ) : null}
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">Photos</dt>
            <dd>{normalizeEnquiryAttachments(enquiry.attachments).length} image(s)</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
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
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Close queues the Concierge feedback text to this customer phone. Keep WhatsApp simulator
              open with the same number to see it. Live Meta WhatsApp is not sent from this dashboard.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={picking} onClick={() => void handlePick("verified")}>
                Mark verified
              </Button>
              <Button type="button" variant="secondary" disabled={picking} onClick={() => void handlePick("contacted")}>
                Mark contacted
              </Button>
              <Button type="button" variant="outline" disabled={picking} onClick={() => void handlePick("closed")}>
                Close
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="enquiry-reach-out">Reached out to customer</Label>
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
            </div>
          </div>
        ) : null}

        {mayEditDetails ? (
          <div className="space-y-3 border-t pt-4">
            <div className="space-y-2">
              <Label htmlFor="enquiry-notes">Notes</Label>
              <Textarea
                id="enquiry-notes"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={2}
                placeholder="Internal notes…"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
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
            </div>
            {isAdmin && isEnquiryKind ? (
              <div className="space-y-2">
                <Label>Tag</Label>
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
                <p className="text-xs text-muted-foreground">
                  Changing the tag changes who can see this enquiry.
                </p>
              </div>
            ) : null}
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleSaveDetails()}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 border-t pt-4 text-sm">
            <p>
              <span className="text-muted-foreground">Notes: </span>
              {enquiry.notes || "—"}
            </p>
          </div>
        )}

        {mayAssign ? (
          <div className="space-y-2 border-t pt-4">
            <Label>Assign to</Label>
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
            <p className="text-xs text-muted-foreground">
              Current: {assigneeProfile ? profileDisplayName(assigneeProfile) : "Nobody assigned yet"}
            </p>
            <Button type="button" disabled={assigning || !assigneeId} onClick={() => void handleAssign()}>
              {assigning ? "Assigning…" : "Assign user"}
            </Button>
          </div>
        ) : (
          <p className="border-t pt-4 text-sm">
            <span className="text-muted-foreground">Assigned to: </span>
            {assigneeProfile ? profileDisplayName(assigneeProfile) : "Waiting for admin to assign"}
          </p>
        )}

        {activity.length ? (
          <div className="space-y-2 border-t pt-4">
            <Label>Activity</Label>
            <p className="text-xs text-muted-foreground">
              {isAdmin ? "Every staff action shows here." : "Your updates also show to admin."}
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {activity.map((row) => {
                const actor = profileById?.[row.actor_id];
                return (
                  <li key={row.id} className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {ENQUIRY_ACTIVITY_LABEL[row.action] ?? row.action}
                    </span>
                    {" · "}
                    {profileDisplayName(actor)}
                    {row.detail ? ` · ${row.detail}` : ""}
                    {" · "}
                    {formatDateTime(row.created_at)}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {mayUpdateStatus ? (
          <div className="space-y-2 border-t pt-4">
            <Label>Status</Label>
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
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
