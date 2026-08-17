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
  ENQUIRY_SOURCES,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABEL,
  assignEnquiry,
  profileDisplayName,
  updateEnquiryFields,
  updateEnquiryStatus
} from "./enquiryUtils";
import { viewerIsActive } from "./viewerUserListUtils";

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
  onUpdated
}) {
  const [assigneeId, setAssigneeId] = useState("");
  const [statusDraft, setStatusDraft] = useState("new");
  const [priorityDraft, setPriorityDraft] = useState("normal");
  const [notesDraft, setNotesDraft] = useState("");
  const [productDraft, setProductDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");

  const mayAssign = isAdmin;
  const mayEditDetails = isAdmin || canEdit;
  const isAssignee = enquiry?.assignee_id === sessionUserId;
  const mayUpdateStatus = isAdmin || isAssignee;

  useEffect(() => {
    if (!open || !enquiry) return;
    setAssigneeId(enquiry.assignee_id || "");
    setStatusDraft(enquiry.status || "new");
    setPriorityDraft(enquiry.priority || "normal");
    setNotesDraft(enquiry.notes || "");
    setProductDraft(enquiry.product_details || "");
    setError("");
  }, [open, enquiry]);

  const activeProfiles = useMemo(
    () =>
      [...(teamProfiles ?? [])]
        .filter((p) => viewerIsActive(p))
        .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b))),
    [teamProfiles]
  );

  if (!enquiry) return null;

  async function handleAssign() {
    if (!mayAssign) return;
    if (!assigneeId) {
      setError("Pick a team member to assign.");
      return;
    }
    setAssigning(true);
    setError("");
    try {
      const updated = await assignEnquiry({
        enquiry,
        assigneeId,
        assignedByUserId: sessionUserId
      });
      onUpdated?.(updated);
    } catch (e) {
      setError(e.message || "Could not assign enquiry.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleSaveDetails() {
    if (!mayEditDetails) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateEnquiryFields(enquiry.id, {
        product_details: productDraft.trim() || null,
        notes: notesDraft.trim() || null,
        priority: priorityDraft
      });
      onUpdated?.(updated);
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
        sessionUserId
      });
      onUpdated?.(updated);
    } catch (e) {
      setError(e.message || "Could not update status.");
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
              </dd>
            </div>
          ) : null}
        </dl>

        {mayEditDetails ? (
          <div className="space-y-3 border-t pt-4">
            <div className="space-y-2">
              <Label htmlFor="enquiry-product">Product / requirement</Label>
              <Textarea
                id="enquiry-product"
                value={productDraft}
                onChange={(e) => setProductDraft(e.target.value)}
                rows={3}
                placeholder="What the customer asked for…"
              />
            </div>
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
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleSaveDetails()}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 border-t pt-4 text-sm">
            <p>
              <span className="text-muted-foreground">Product: </span>
              {enquiry.product_details || "—"}
            </p>
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
        ) : assigneeProfile ? (
          <p className="border-t pt-4 text-sm">
            <span className="text-muted-foreground">Assigned to: </span>
            {profileDisplayName(assigneeProfile)}
          </p>
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
