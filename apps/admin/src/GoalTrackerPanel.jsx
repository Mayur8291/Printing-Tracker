import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Plus,
  Target,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";
import TaskPriorityBadge from "./components/goals/TaskPriorityBadge";
import GoalOwnershipField from "./components/goals/GoalOwnershipField";
import {
  collectOwnershipLabelsFromGoals,
  createAnnualGoal,
  createGoalTask,
  currentGoalYear,
  canUserVerifyGoal,
  canUserVerifyTask,
  deleteAnnualGoal,
  deleteGoalTask,
  fetchAllTasksForYear,
  fetchGoalsForTaskAssignment,
  fetchGoalsForUser,
  fetchMyAssignedTasks,
  fetchRemarksForGoal,
  fetchRemarksForTask,
  fetchTasksAssignedByUser,
  fetchTasksForGoal,
  filterTasksByPriority,
  formatGoalDeadline,
  formatGoalWithOwnership,
  formatRemarkTimestamp,
  GOAL_OWNERSHIP_UNASSIGNED_LABEL,
  GOAL_STATUSES,
  GOAL_STATUS_LABEL,
  groupGoalsByOwnership,
  isGoalAdminVerified,
  isGoalCompleted,
  isTaskAdminVerified,
  isTaskCompleted,
  isTaskOverdue,
  normalizeGoalOwnership,
  partitionGoalsByCompletion,
  profileDisplayName,
  sortGoalCardTasks,
  sortGoalsByPriority,
  sortTasksByPriority,
  setGoalCompleted,
  setTaskCompleted,
  topGoalPriorityRank,
  updateGoalOwnership,
  updateGoalPriority,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  updateGoalStatusWithRemark,
  updateTaskStatusWithRemark,
  verifyGoalCompletion,
  verifyTaskCompletion
} from "./goalTrackerUtils";
import { subscribePostgresChanges } from "./realtimeUtils";

function StatusBadge({ kind, status }) {
  const label = kind === "goal" ? GOAL_STATUS_LABEL[status] : TASK_STATUS_LABEL[status];
  const variant =
    status === "completed"
      ? "secondary"
      : status === "cancelled" || status === "on_hold"
        ? "outline"
        : status === "in_progress"
          ? "default"
          : "outline";
  return <Badge variant={variant}>{label ?? status}</Badge>;
}

function VerificationBadge({ item }) {
  if (!isGoalCompleted(item) && !isTaskCompleted(item)) return null;
  if (isGoalAdminVerified(item) || isTaskAdminVerified(item)) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="size-3" />
        Verified
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-amber-500/50 text-amber-800">
      Pending verification
    </Badge>
  );
}

function VerifierControls({ onVerify, onReject }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => onVerify?.()}>
        Verify complete
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onReject?.()}>
        Not complete
      </Button>
    </div>
  );
}

function RejectVerificationDialog({ open, onOpenChange, targetLabel, onConfirm }) {
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setRemark("");
      setError("");
    }
  }, [open]);

  async function handleSubmit() {
    setSaving(true);
    setError("");
    try {
      await onConfirm?.(remark);
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not save remark.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Not complete — add remark</DialogTitle>
          <DialogDescription>
            Describe what is still missing or must change before this can count as complete.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-remark">Remark (required)</Label>
          <Textarea
            id="reject-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={4}
            placeholder="What is missing or needs to be corrected?"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Saving…" : "Send back with remark"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskCompleteCheckbox({ task, canToggle, onToggle, disabled }) {
  const checked = isTaskCompleted(task);
  if (!canToggle) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onToggle?.(task, value === true)}
        aria-label={checked ? "Mark task incomplete" : "Mark task complete"}
      />
      <span className="text-muted-foreground">
        {checked ? "Completed — pending verification" : "Mark complete"}
      </span>
    </label>
  );
}

function RemarkHistory({ remarks, profilesById }) {
  if (!remarks?.length) {
    return <p className="text-xs text-muted-foreground">No status remarks yet.</p>;
  }
  return (
    <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
      {remarks.map((r) => (
        <li key={r.id} className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{profileDisplayName(profilesById.get(r.author_id) ?? r.author)}</span>
            <span>{formatRemarkTimestamp(r.created_at)}</span>
          </div>
          <p className="mt-1">
            {r.previous_status ? (
              <span className="text-muted-foreground">
                {GOAL_STATUS_LABEL[r.previous_status] ?? TASK_STATUS_LABEL[r.previous_status] ?? r.previous_status}
                {" → "}
              </span>
            ) : null}
            <strong>
              {GOAL_STATUS_LABEL[r.new_status] ?? TASK_STATUS_LABEL[r.new_status] ?? r.new_status}
            </strong>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{r.remark}</p>
        </li>
      ))}
    </ul>
  );
}

function TaskRemarksBelow({ remarks, profilesById }) {
  if (!remarks?.length) return null;
  return (
    <div className="mt-2 space-y-2 border-t border-dashed pt-2">
      {remarks.map((r) => (
        <div key={r.id} className="rounded-md bg-muted/40 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{profileDisplayName(profilesById.get(r.author_id) ?? r.author)}</span>
            <span>{formatRemarkTimestamp(r.created_at)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{r.remark}</p>
        </div>
      ))}
    </div>
  );
}

function StatusUpdateDialog({ open, onOpenChange, target, isAdmin, authorId, onSaved }) {
  const [newStatus, setNewStatus] = useState("");
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && target) {
      setNewStatus(target.status);
      setRemark("");
      setError("");
    }
  }, [open, target]);

  if (!target) return null;

  const statuses = target.kind === "goal" ? GOAL_STATUSES : TASK_STATUSES;
  const requireRemark = !isAdmin;

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      if (target.kind === "goal") {
        await updateGoalStatusWithRemark({
          goalId: target.id,
          newStatus,
          remark,
          authorId,
          previousStatus: target.status,
          requireRemark
        });
      } else {
        await updateTaskStatusWithRemark({
          taskId: target.id,
          newStatus,
          remark,
          authorId,
          previousStatus: target.status,
          requireRemark
        });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not update status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update status</DialogTitle>
          <DialogDescription>{target.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New status</Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {target.kind === "goal" ? GOAL_STATUS_LABEL[s] : TASK_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status-remark">
              Remark{requireRemark ? " (required)" : " (optional for admin)"}
            </Label>
            <Textarea
              id="status-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={4}
              placeholder="What changed and why?"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignTaskDialog({
  open,
  onOpenChange,
  teamProfiles,
  sessionUserId,
  year,
  defaultAssigneeId,
  defaultGoalId,
  onSaved
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [goalId, setGoalId] = useState("__none__");
  const [priority, setPriority] = useState("P2");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [assigneeGoals, setAssigneeGoals] = useState([]);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setAssigneeId(defaultAssigneeId || sessionUserId || "");
      setGoalId(defaultGoalId || "__none__");
      setPriority("P2");
      setDeadlineDate("");
      setError("");
    }
  }, [open, defaultAssigneeId, defaultGoalId, sessionUserId]);

  useEffect(() => {
    if (!open || !assigneeId || !year) {
      setAssigneeGoals([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingGoals(true);
    void fetchGoalsForTaskAssignment(assigneeId, year)
      .then((rows) => {
        if (cancelled) return;
        setAssigneeGoals((rows ?? []).filter((g) => g.status !== "completed"));
      })
      .catch((e) => {
        if (!cancelled) {
          setAssigneeGoals([]);
          setError(e.message || "Could not load goals for this user.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingGoals(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, assigneeId, year]);

  useEffect(() => {
    if (!open || goalId === "__none__") return;
    if (!assigneeGoals.some((g) => g.id === goalId)) {
      setGoalId("__none__");
    }
  }, [open, assigneeId, assigneeGoals, goalId]);

  useEffect(() => {
    if (!open || !defaultGoalId || defaultGoalId === "__none__") return;
    if (assigneeGoals.some((g) => g.id === defaultGoalId)) {
      setGoalId(defaultGoalId);
    }
  }, [open, defaultGoalId, assigneeGoals]);

  function handleAssigneeChange(nextId) {
    setAssigneeId(nextId);
    setGoalId("__none__");
  }

  const activeProfiles = useMemo(
    () =>
      [...(teamProfiles ?? [])].sort((a, b) =>
        profileDisplayName(a).localeCompare(profileDisplayName(b))
      ),
    [teamProfiles]
  );

  async function handleSave() {
    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }
    if (!assigneeId) {
      setError("Pick who to assign.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const linkedGoal =
        goalId && goalId !== "__none__" ? assigneeGoals.find((g) => g.id === goalId) : null;
      await createGoalTask({
        goalId: goalId === "__none__" ? null : goalId,
        assigneeId,
        assignedBy: sessionUserId,
        title,
        description,
        deadlineDate: deadlineDate || null,
        priority,
        goalTitle: linkedGoal?.title
      });
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not assign task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign task</DialogTitle>
          <DialogDescription>Assign a task to anyone with an optional deadline.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Assign to</Label>
              <Select value={assigneeId} onValueChange={handleAssigneeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {activeProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {profileDisplayName(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Link to goal (optional)</Label>
              <Select value={goalId} onValueChange={setGoalId} disabled={!assigneeId || loadingGoals}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingGoals
                        ? "Loading goals…"
                        : assigneeGoals.length
                          ? "No goal"
                          : "No goals for this user"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No goal</SelectItem>
                  {assigneeGoals.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {formatGoalWithOwnership(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-9 w-auto min-w-[7rem]">
                <TaskPriorityBadge priority={priority} />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2">
                      <TaskPriorityBadge priority={p} compact />
                      {TASK_PRIORITY_LABEL[p]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Deadline</Label>
            <DatePicker value={deadlineDate} onChange={setDeadlineDate} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Assigning…" : "Assign task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditGoalOwnershipDialog({ open, onOpenChange, goal, ownershipSuggestions = [], onSaved }) {
  const [ownership, setOwnership] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setOwnership(normalizeGoalOwnership(goal?.ownership) ?? "");
      setError("");
    }
  }, [open, goal]);

  async function handleSave() {
    if (!normalizeGoalOwnership(ownership)) {
      setError("Ownership is required (e.g. Sales, Operations, Personal).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateGoalOwnership(goal.id, ownership);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not update ownership.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set goal ownership</DialogTitle>
          <DialogDescription>
            Group goals under an ownership area. Format: <strong>Ownership → Goal → Tasks</strong>.
            {goal?.title ? ` Goal: ${goal.title}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal-ownership-edit">Ownership</Label>
            <GoalOwnershipField
              id="goal-ownership-edit"
              value={ownership}
              onChange={setOwnership}
              suggestions={ownershipSuggestions}
            />
            <p className="text-xs text-muted-foreground">
              Existing goals without ownership appear under <strong>{GOAL_OWNERSHIP_UNASSIGNED_LABEL}</strong> until
              you assign one here.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save ownership"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateGoalDialog({
  open,
  onOpenChange,
  userId,
  year,
  createdBy,
  selfCreate = false,
  ownershipSuggestions = [],
  onSaved
}) {
  const [ownership, setOwnership] = useState("");
  const [priority, setPriority] = useState("P2");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setOwnership("");
      setPriority("P2");
      setTitle("");
      setDescription("");
      setError("");
    }
  }, [open]);

  async function handleSave() {
    if (!normalizeGoalOwnership(ownership)) {
      setError("Ownership is required (e.g. Sales, Operations, Personal).");
      return;
    }
    if (!title.trim()) {
      setError("Goal title is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createAnnualGoal({ userId, year, title, description, ownership, priority, createdBy });
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not create goal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{selfCreate ? "Create my goal" : "Create annual goal"}</DialogTitle>
          <DialogDescription>
            {selfCreate
              ? "Pick ownership, priority, then your goal. Add tasks after creating."
              : "Set ownership, priority, and yearly goal for this user."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal-ownership">Ownership</Label>
            <GoalOwnershipField
              id="goal-ownership"
              value={ownership}
              onChange={setOwnership}
              suggestions={ownershipSuggestions}
            />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-9 w-auto min-w-[7rem]">
                <TaskPriorityBadge priority={priority} />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2">
                      <TaskPriorityBadge priority={p} compact />
                      {TASK_PRIORITY_LABEL[p]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-title">Title</Label>
            <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-desc">Description</Label>
            <Textarea id="goal-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Creating…" : selfCreate ? "Create my goal" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnershipOverviewGrid({ groups, goalTasksMap, onSelect }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map(({ ownership, goals, isUnassigned }) => {
        const taskCount = goals.reduce(
          (sum, goal) => sum + (goalTasksMap[goal.id]?.filter((t) => t.status !== "cancelled").length ?? 0),
          0
        );
        const openTasks = goals.reduce(
          (sum, goal) =>
            sum +
            (goalTasksMap[goal.id]?.filter((t) => t.status !== "completed" && t.status !== "cancelled").length ?? 0),
          0
        );
        const topRank = topGoalPriorityRank(goals);
        const topPriority = TASK_PRIORITIES[topRank] ?? "P2";

        return (
          <button
            key={ownership}
            type="button"
            className="rounded-xl border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(ownership)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-tight">{ownership}</p>
                {isUnassigned ? (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Needs ownership labels on goals</p>
                ) : null}
              </div>
              <TaskPriorityBadge priority={topPriority} compact />
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>
                {goals.length} goal{goals.length === 1 ? "" : "s"}
              </span>
              <span>
                {taskCount} task{taskCount === 1 ? "" : "s"}
              </span>
              {openTasks > 0 ? <span>{openTasks} open</span> : null}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Click to view goals and tasks</p>
          </button>
        );
      })}
    </div>
  );
}

function OwnershipGoalsDetailView({ group, onBack, toolbar, renderGoalFull }) {
  const sortedGoals = sortGoalsByPriority(group.goals);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div>
            <h3 className="text-lg font-semibold">{group.ownership}</h3>
            <p className="text-sm text-muted-foreground">
              {group.goals.length} goal{group.goals.length === 1 ? "" : "s"} · Ownership → Goal → Tasks
            </p>
          </div>
          {group.isUnassigned ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-800 dark:text-amber-200">
              Set ownership on goals below
            </Badge>
          ) : null}
        </div>
        {toolbar}
      </div>
      <div className="space-y-8">{sortedGoals.map((goal) => renderGoalFull(goal))}</div>
    </div>
  );
}

function GoalsOwnershipNavigator({ groups, goalTasksMap, detailKey, onSelectDetail, onBack, toolbar, renderGoalFull }) {
  if (!groups.length) return null;

  if (detailKey) {
    const group = groups.find((g) => g.ownership === detailKey);
    if (!group) {
      onBack();
      return null;
    }
    return (
      <OwnershipGoalsDetailView
        group={group}
        onBack={onBack}
        toolbar={toolbar}
        renderGoalFull={renderGoalFull}
      />
    );
  }

  return <OwnershipOverviewGrid groups={groups} goalTasksMap={goalTasksMap} onSelect={onSelectDetail} />;
}

function GoalCard({
  goal,
  tasks,
  remarks,
  taskRemarksMap,
  isAdmin,
  isOwner,
  sessionUserId,
  teamProfiles,
  fullView = false,
  onAssignTask,
  onUpdateStatus,
  onEditOwnership,
  onUpdateGoalPriority,
  onDeleteGoal,
  onDeleteTask,
  onToggleGoalComplete,
  onToggleTaskComplete,
  onRequestRejectGoal,
  onVerifyGoal,
  onRequestRejectTask,
  onVerifyTask
}) {
  const [expanded, setExpanded] = useState(fullView || true);
  const canUpdateGoalStatus = isAdmin || isOwner;
  const canToggleGoal = isAdmin || isOwner;
  const canEditOwnership = isAdmin || isOwner;
  const canEditPriority = isAdmin || isOwner;
  const ownershipSet = Boolean(normalizeGoalOwnership(goal.ownership));
  const visibleTasks = sortGoalCardTasks(tasks);
  const goalCompleted = isGoalCompleted(goal);
  const profilesById = useMemo(() => new Map(teamProfiles.map((p) => [p.id, p])), [teamProfiles]);

  const shellClass = cn(
    fullView ? "rounded-xl border bg-card shadow-sm" : "shadow-sm",
    goalCompleted && "border-muted bg-muted/20"
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {canToggleGoal ? (
            <Checkbox
              checked={goalCompleted}
              onCheckedChange={(value) => onToggleGoalComplete?.(goal, value === true)}
              aria-label={goalCompleted ? "Mark goal incomplete" : "Mark goal complete"}
            />
          ) : null}
          {fullView ? (
            <h4 className={cn("text-lg font-semibold", fullView && "text-xl")}>{goal.title}</h4>
          ) : (
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <CardTitle className="text-base">{goal.title}</CardTitle>
            </button>
          )}
        </div>
        {goal.description ? (
          <p className={cn("mt-2 text-sm text-muted-foreground", !fullView && "pl-6")}>{goal.description}</p>
        ) : null}
        {canEditOwnership ? (
          <div className={cn("mt-2", !fullView && "pl-6")}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onEditOwnership?.(goal)}
            >
              {ownershipSet ? "Change ownership" : "Set ownership"}
            </Button>
          </div>
        ) : ownershipSet ? (
          <p className={cn("mt-1 text-xs text-muted-foreground", !fullView && "pl-6")}>{goal.ownership}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canEditPriority ? (
          <Select
            value={goal.priority ?? "P2"}
            onValueChange={(value) => onUpdateGoalPriority?.(goal.id, value)}
          >
            <SelectTrigger className="h-8 w-auto min-w-[3.25rem] border-0 bg-transparent p-0 shadow-none focus:ring-0">
              <TaskPriorityBadge priority={goal.priority} compact />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  <TaskPriorityBadge priority={p} compact />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <TaskPriorityBadge priority={goal.priority} compact />
        )}
        <StatusBadge kind="goal" status={goal.status} />
        <VerificationBadge item={goal} sessionUserId={sessionUserId} teamProfiles={teamProfiles} />
        {canUserVerifyGoal(goal, sessionUserId) ? (
          <VerifierControls
            onVerify={() => onVerifyGoal?.(goal.id)}
            onReject={() => onRequestRejectGoal?.(goal)}
          />
        ) : null}
        {!goalCompleted && canUpdateGoalStatus ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onUpdateStatus({ kind: "goal", ...goal })}>
            Update status
          </Button>
        ) : null}
        {!goalCompleted && (isAdmin || isOwner) ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onAssignTask(goal)}>
            Add task
          </Button>
        ) : null}
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void onDeleteGoal(goal.id)}
            title="Delete goal and its tasks"
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );

  const body = (
    <div className={cn("space-y-4", fullView ? "p-6 pt-0" : "p-4 pt-0")}>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks</p>
            {visibleTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks on this goal yet.</p>
            ) : (
              <ul className="space-y-2">
                {visibleTasks.map((task) => {
                  const assignee = teamProfiles.find((p) => p.id === task.assignee_id);
                  const canUpdate = isAdmin || task.assignee_id === sessionUserId;
                  const canToggleTask = isAdmin || task.assignee_id === sessionUserId;
                  const taskCompleted = isTaskCompleted(task);
                  const taskVerified = isTaskAdminVerified(task);
                  const taskRemarks = taskRemarksMap?.[task.id] ?? [];
                  return (
                    <li
                      key={task.id}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        isTaskOverdue(task) && "border-destructive/40 bg-destructive/5",
                        taskCompleted && !taskVerified && "border-amber-500/30 bg-amber-500/5",
                        taskVerified && "border-muted bg-muted/20"
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <TaskCompleteCheckbox
                            task={task}
                            canToggle={canToggleTask && !taskVerified}
                            onToggle={onToggleTaskComplete}
                          />
                          <TaskPriorityBadge priority={task.priority} compact />
                          <p
                            className={cn(
                              "font-medium",
                              taskVerified && "text-muted-foreground line-through decoration-2"
                            )}
                          >
                            {task.title}
                          </p>
                        </div>
                        {task.description ? (
                          <p
                            className={cn(
                              "mt-0.5 text-xs text-muted-foreground",
                              taskVerified && "line-through decoration-1"
                            )}
                          >
                            {task.description}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {profileDisplayName(assignee)} · {formatGoalDeadline(task.deadline_date)}
                        </p>
                        {!taskVerified ? (
                          <TaskRemarksBelow remarks={taskRemarks} profilesById={profilesById} />
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge kind="task" status={task.status} />
                        <VerificationBadge item={task} sessionUserId={sessionUserId} teamProfiles={teamProfiles} />
                        {canUserVerifyTask(task, sessionUserId) ? (
                          <VerifierControls
                            onVerify={() => onVerifyTask?.(task.id)}
                            onReject={() => onRequestRejectTask?.(task)}
                          />
                        ) : null}
                        {!taskCompleted && canUpdate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onUpdateStatus({ kind: "task", ...task })}
                          >
                            Update
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void onDeleteTask(task.id)}
                            title="Delete task"
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        ) : null}
                      </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MessageSquareText className="size-3.5" />
              Goal status remarks
            </p>
            <RemarkHistory remarks={remarks} profilesById={profilesById} />
          </div>
    </div>
  );

  if (fullView) {
    return (
      <section className={shellClass}>
        <div className="p-6 pb-4">{header}</div>
        {body}
      </section>
    );
  }

  return (
    <Card className={shellClass}>
      <CardHeader className="p-4 pb-2">{header}</CardHeader>
      {expanded ? <CardContent>{body}</CardContent> : null}
    </Card>
  );
}

function TaskPriorityFilterSelect({ value, onChange, className }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Label className="shrink-0 text-sm text-muted-foreground">Priority</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[12rem]">
          {value && value !== "all" ? (
            <TaskPriorityBadge priority={value} />
          ) : (
            <SelectValue placeholder="All priorities" />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All priorities</SelectItem>
          {TASK_PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              <span className="flex items-center gap-2">
                <TaskPriorityBadge priority={p} compact />
                {TASK_PRIORITY_LABEL[p]}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TaskList({
  tasks,
  teamProfiles,
  sessionUserId,
  isAdmin,
  onUpdateStatus,
  onDeleteTask,
  onToggleTaskComplete,
  onRequestRejectTask,
  onVerifyTask,
  taskRemarksMap,
  emptyLabel,
  goalTitleById = null,
  sortMode = "goalCard",
  priorityFilter = "all"
}) {
  const profilesById = useMemo(() => new Map(teamProfiles.map((p) => [p.id, p])), [teamProfiles]);
  const filteredTasks = useMemo(
    () => filterTasksByPriority(tasks, priorityFilter),
    [tasks, priorityFilter]
  );
  const visibleTasks =
    sortMode === "priority" ? sortTasksByPriority(filteredTasks) : sortGoalCardTasks(filteredTasks);

  const emptyMessage =
    priorityFilter && priorityFilter !== "all"
      ? `No ${priorityFilter} tasks match this filter.`
      : emptyLabel;

  if (!visibleTasks.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2">
      {visibleTasks.map((task) => {
        const assignee = teamProfiles.find((p) => p.id === task.assignee_id);
        const assigner = teamProfiles.find((p) => p.id === task.assigned_by);
        const canUpdate = isAdmin || task.assignee_id === sessionUserId;
        const canToggleTask = isAdmin || task.assignee_id === sessionUserId;
        const taskCompleted = isTaskCompleted(task);
        const taskVerified = isTaskAdminVerified(task);
        const taskRemarks = taskRemarksMap?.[task.id] ?? [];
        const goalTitle =
          task.goal?.title || (task.goal_id && goalTitleById?.get(task.goal_id)) || null;
        return (
          <li
            key={task.id}
            className={cn(
              "rounded-md border px-3 py-3 text-sm",
              isTaskOverdue(task) && "border-destructive/40 bg-destructive/5",
              taskCompleted && !taskVerified && "border-amber-500/30 bg-amber-500/5",
              taskVerified && "border-muted bg-muted/20"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <TaskCompleteCheckbox
                    task={task}
                    canToggle={canToggleTask && !taskVerified}
                    onToggle={onToggleTaskComplete}
                  />
                  <TaskPriorityBadge priority={task.priority} compact />
                  <p
                    className={cn(
                      "font-medium",
                      taskVerified && "text-muted-foreground line-through decoration-2"
                    )}
                  >
                    {task.title}
                  </p>
                </div>
                {task.description ? (
                  <p
                    className={cn(
                      "mt-0.5 text-xs text-muted-foreground",
                      taskVerified && "line-through decoration-1"
                    )}
                  >
                    {task.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  To: {profileDisplayName(assignee)} · By: {profileDisplayName(assigner)}
                  {goalTitle ? ` · Goal: ${goalTitle}` : ""}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5" />
                  {formatGoalDeadline(task.deadline_date)}
                </p>
                {!taskVerified ? (
                  <TaskRemarksBelow remarks={taskRemarks} profilesById={profilesById} />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="task" status={task.status} />
                <VerificationBadge item={task} sessionUserId={sessionUserId} teamProfiles={teamProfiles} />
                {canUserVerifyTask(task, sessionUserId) ? (
                  <VerifierControls
                    onVerify={() => onVerifyTask?.(task.id)}
                    onReject={() => onRequestRejectTask?.(task)}
                  />
                ) : null}
                {!taskCompleted && canUpdate ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdateStatus({ kind: "task", ...task })}
                  >
                    Update status
                  </Button>
                ) : null}
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void onDeleteTask(task.id)}
                    title="Delete task"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CompletedPanel({
  completedGoals,
  goalTasksMap,
  goalRemarksMap,
  taskRemarksMap,
  isAdmin,
  sessionUserId,
  teamProfiles,
  detailKey,
  onSelectDetail,
  onBack,
  onToggleGoalComplete,
  onToggleTaskComplete,
  onRequestRejectGoal,
  onVerifyGoal,
  onRequestRejectTask,
  onVerifyTask,
  onEditOwnership,
  onUpdateGoalPriority,
  onDeleteGoal,
  onDeleteTask,
  year
}) {
  if (!completedGoals.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No completed goals for {year} yet. Mark a goal complete with the checkbox — it moves here.
          Tasks stay on their goal card with pending verification until confirmed.
        </CardContent>
      </Card>
    );
  }

  const groups = groupGoalsByOwnership(completedGoals);

  return (
    <GoalsOwnershipNavigator
      groups={groups}
      goalTasksMap={goalTasksMap}
      detailKey={detailKey}
      onSelectDetail={onSelectDetail}
      onBack={onBack}
      renderGoalFull={(goal) => (
        <GoalCard
          key={goal.id}
          fullView
          goal={goal}
          tasks={goalTasksMap[goal.id] ?? []}
          remarks={goalRemarksMap[goal.id] ?? []}
          taskRemarksMap={taskRemarksMap}
          isAdmin={isAdmin}
          isOwner={goal.user_id === sessionUserId}
          sessionUserId={sessionUserId}
          teamProfiles={teamProfiles}
          onAssignTask={() => {}}
          onUpdateStatus={() => {}}
          onEditOwnership={onEditOwnership}
          onUpdateGoalPriority={onUpdateGoalPriority}
          onDeleteGoal={onDeleteGoal}
          onDeleteTask={onDeleteTask}
          onToggleGoalComplete={onToggleGoalComplete}
          onToggleTaskComplete={onToggleTaskComplete}
          onRequestRejectGoal={onRequestRejectGoal}
          onVerifyGoal={onVerifyGoal}
          onRequestRejectTask={onRequestRejectTask}
          onVerifyTask={onVerifyTask}
        />
      )}
    />
  );
}

export default function GoalTrackerPanel({ sessionUserId, isAdmin, teamProfiles, adminProfiles = [] }) {
  const [year, setYear] = useState(currentGoalYear());
  const [tab, setTab] = useState("my_tasks");
  const [manageUserId, setManageUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [myGoals, setMyGoals] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [assignedByMe, setAssignedByMe] = useState([]);
  const [managedGoals, setManagedGoals] = useState([]);
  const [goalTasksMap, setGoalTasksMap] = useState({});
  const [goalRemarksMap, setGoalRemarksMap] = useState({});
  const [taskRemarksMap, setTaskRemarksMap] = useState({});
  const [statusTarget, setStatusTarget] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignGoalId, setAssignGoalId] = useState(null);
  const [assignDefaultUserId, setAssignDefaultUserId] = useState(null);
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [createGoalUserId, setCreateGoalUserId] = useState(null);
  const [createGoalSelf, setCreateGoalSelf] = useState(false);
  const [editOwnershipGoal, setEditOwnershipGoal] = useState(null);
  const [myGoalsOwnershipDetail, setMyGoalsOwnershipDetail] = useState(null);
  const [manageOwnershipDetail, setManageOwnershipDetail] = useState(null);
  const [completedOwnershipDetail, setCompletedOwnershipDetail] = useState(null);
  const [allTeamTasks, setAllTeamTasks] = useState([]);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [myTasksPriorityFilter, setMyTasksPriorityFilter] = useState("all");
  const [assignedByMePriorityFilter, setAssignedByMePriorityFilter] = useState("all");
  const [teamTasksPriorityFilter, setTeamTasksPriorityFilter] = useState("all");

  const yearOptions = useMemo(() => {
    const y = currentGoalYear();
    return [y - 1, y, y + 1];
  }, []);

  const manageProfiles = useMemo(() => {
    const map = new Map((teamProfiles ?? []).map((p) => [p.id, { ...p }]));
    for (const profile of adminProfiles ?? []) {
      map.set(profile.id, { ...map.get(profile.id), ...profile });
    }
    return [...map.values()]
      .filter((profile) => profile.is_active !== false)
      .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b)));
  }, [teamProfiles, adminProfiles]);

  const profilesById = useMemo(
    () => new Map(manageProfiles.map((p) => [p.id, p])),
    [manageProfiles]
  );

  const loadGoalDetails = useCallback(async (goals) => {
    const tasksEntries = await Promise.all(
      goals.map(async (g) => [g.id, await fetchTasksForGoal(g.id)])
    );
    const remarksEntries = await Promise.all(
      goals.map(async (g) => [g.id, await fetchRemarksForGoal(g.id)])
    );
    setGoalTasksMap((prev) => ({ ...prev, ...Object.fromEntries(tasksEntries) }));
    setGoalRemarksMap((prev) => ({ ...prev, ...Object.fromEntries(remarksEntries) }));
    return tasksEntries.flatMap(([, taskRows]) => taskRows ?? []);
  }, []);

  const loadTaskRemarks = useCallback(async (tasks) => {
    const ids = [...new Set((tasks ?? []).map((t) => t.id).filter(Boolean))];
    if (!ids.length) {
      setTaskRemarksMap({});
      return;
    }
    const entries = await Promise.all(ids.map(async (id) => [id, await fetchRemarksForTask(id)]));
    setTaskRemarksMap(Object.fromEntries(entries));
  }, []);

  const reload = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!sessionUserId) return;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const [goals, tasks, byMe] = await Promise.all([
        fetchGoalsForUser(sessionUserId, year),
        fetchMyAssignedTasks(sessionUserId, year),
        fetchTasksAssignedByUser(sessionUserId, year)
      ]);
      setMyGoals(goals);
      setMyTasks(tasks);
      setAssignedByMe(byMe);

      const allTasks = [...tasks, ...byMe];
      const goalLinkedTasks = await loadGoalDetails(goals);
      allTasks.push(...goalLinkedTasks);

      let teamTasks = [];
      if (isAdmin) {
        teamTasks = await fetchAllTasksForYear(year);
        setAllTeamTasks(teamTasks);
        allTasks.push(...teamTasks);
      } else {
        setAllTeamTasks([]);
      }

      if (isAdmin && manageUserId) {
        const managed = await fetchGoalsForUser(manageUserId, year);
        setManagedGoals(managed);
        const managedGoalTasks = await loadGoalDetails(managed);
        allTasks.push(...managedGoalTasks);
      } else {
        setManagedGoals([]);
      }

      await loadTaskRemarks(allTasks);
    } catch (e) {
      setError(e.message || "Could not load goals.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sessionUserId, year, isAdmin, manageUserId, loadGoalDetails, loadTaskRemarks]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!sessionUserId) return undefined;
    return subscribePostgresChanges({
      channelName: `goals-live-${sessionUserId}`,
      tables: ["user_annual_goals", "user_goal_tasks", "user_goal_status_remarks"],
      onEvent: () => {
        void reload({ silent: true });
      }
    });
  }, [sessionUserId, reload]);

  useEffect(() => {
    if (isAdmin && !manageUserId && manageProfiles.length) {
      const first = manageProfiles.find((p) => p.id !== sessionUserId) ?? manageProfiles[0];
      if (first) setManageUserId(first.id);
    }
  }, [isAdmin, manageUserId, manageProfiles, sessionUserId]);

  useEffect(() => {
    setManageOwnershipDetail(null);
  }, [manageUserId]);

  useEffect(() => {
    setMyGoalsOwnershipDetail(null);
    setManageOwnershipDetail(null);
    setCompletedOwnershipDetail(null);
  }, [tab, year]);

  async function handleUpdateGoalPriority(goalId, priority) {
    try {
      await updateGoalPriority(goalId, priority);
      void reload({ silent: true });
    } catch (e) {
      alert(e.message || "Could not update goal priority.");
    }
  }

  async function handleDeleteGoal(goalId) {
    if (
      !window.confirm(
        "Delete this goal and all its tasks?\n\nThis removes it for the user. Cannot be undone."
      )
    ) {
      return;
    }
    try {
      await deleteAnnualGoal(goalId);
      void reload();
    } catch (e) {
      alert(e.message || "Could not delete goal.");
    }
  }

  async function handleDeleteTask(taskId) {
    if (!window.confirm("Delete this task?\n\nThis removes it for the assignee. Cannot be undone.")) {
      return;
    }
    try {
      await deleteGoalTask(taskId);
      void reload();
    } catch (e) {
      alert(e.message || "Could not delete task.");
    }
  }

  async function handleToggleTaskComplete(task, completed) {
    try {
      await setTaskCompleted(task.id, completed, task);
      void reload();
    } catch (e) {
      alert(e.message || "Could not update task.");
    }
  }

  async function handleToggleGoalComplete(goal, completed) {
    try {
      await setGoalCompleted(goal.id, completed, goal);
      void reload();
    } catch (e) {
      alert(e.message || "Could not update goal.");
    }
  }

  async function handleVerifyTask(taskId) {
    try {
      await verifyTaskCompletion(taskId, sessionUserId, { verified: true });
      void reload();
    } catch (e) {
      alert(e.message || "Could not verify task.");
    }
  }

  async function handleVerifyGoal(goalId) {
    try {
      await verifyGoalCompletion(goalId, sessionUserId, { verified: true });
      void reload();
    } catch (e) {
      alert(e.message || "Could not verify goal.");
    }
  }

  async function handleRejectVerification(remark) {
    if (!rejectTarget) return;
    try {
      if (rejectTarget.kind === "goal") {
        await verifyGoalCompletion(rejectTarget.id, sessionUserId, { verified: false, remark });
      } else {
        await verifyTaskCompletion(rejectTarget.id, sessionUserId, { verified: false, remark });
      }
      setRejectTarget(null);
      void reload();
    } catch (e) {
      throw e;
    }
  }

  const { active: myGoalsActive, completed: myGoalsCompleted } = useMemo(
    () => partitionGoalsByCompletion(myGoals),
    [myGoals]
  );
  const { completed: managedGoalsCompleted } = useMemo(
    () => partitionGoalsByCompletion(managedGoals),
    [managedGoals]
  );

  const ownershipSuggestions = useMemo(
    () => collectOwnershipLabelsFromGoals([...myGoals, ...managedGoals]),
    [myGoals, managedGoals]
  );

  const myGoalsActiveGroups = useMemo(() => groupGoalsByOwnership(myGoalsActive), [myGoalsActive]);
  const managedGoalsAllGroups = useMemo(
    () => groupGoalsByOwnership(managedGoals),
    [managedGoals]
  );

  const goalCardHandlers = {
    onToggleGoalComplete: handleToggleGoalComplete,
    onToggleTaskComplete: handleToggleTaskComplete,
    onVerifyGoal: handleVerifyGoal,
    onVerifyTask: handleVerifyTask,
    onRequestRejectGoal: (goal) => setRejectTarget({ kind: "goal", id: goal.id, title: goal.title }),
    onRequestRejectTask: (task) => setRejectTarget({ kind: "task", id: task.id, title: task.title })
  };

  function renderGoalCard(goal, { isOwner = false, isAdminView = false, fullView = false } = {}) {
    return (
      <GoalCard
        key={goal.id}
        fullView={fullView}
        goal={goal}
        tasks={goalTasksMap[goal.id] ?? []}
        remarks={goalRemarksMap[goal.id] ?? []}
        taskRemarksMap={taskRemarksMap}
        isAdmin={isAdminView || isAdmin}
        isOwner={isOwner}
        sessionUserId={sessionUserId}
        teamProfiles={teamProfiles}
        onAssignTask={(g) => {
          setAssignGoalId(g.id);
          setAssignDefaultUserId(g.user_id);
          setAssignOpen(true);
        }}
        onUpdateStatus={setStatusTarget}
        onEditOwnership={setEditOwnershipGoal}
        onUpdateGoalPriority={handleUpdateGoalPriority}
        onDeleteGoal={handleDeleteGoal}
        onDeleteTask={handleDeleteTask}
        {...goalCardHandlers}
      />
    );
  }

  const goalTitleById = useMemo(() => {
    const map = new Map();
    for (const goal of [...myGoals, ...managedGoals]) {
      map.set(goal.id, goal.title);
    }
    return map;
  }, [myGoals, managedGoals]);

  const completedGoalsAll = useMemo(() => {
    const map = new Map();
    for (const goal of [...myGoalsCompleted, ...managedGoalsCompleted]) {
      map.set(goal.id, goal);
    }
    return [...map.values()];
  }, [myGoalsCompleted, managedGoalsCompleted]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Goals & Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Goals group as <strong>Ownership → Goal → Tasks</strong>. Mark complete for verification; done
            goals move to <strong>Completed</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[7rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() => {
              setAssignGoalId(null);
              setAssignDefaultUserId(null);
              setAssignOpen(true);
            }}
          >
            <Plus className="size-4" />
            Assign task
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="my_tasks">My tasks</TabsTrigger>
          <TabsTrigger value="my_goals">My goals</TabsTrigger>
          <TabsTrigger value="assigned_by_me">Assigned by me</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          {isAdmin ? <TabsTrigger value="team_tasks">All team tasks</TabsTrigger> : null}
          {isAdmin ? <TabsTrigger value="manage">Manage User Goals</TabsTrigger> : null}
        </TabsList>

        {loading ? (
          <div className="space-y-3 pt-4">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : (
          <>
            <TabsContent value="my_goals" className="space-y-4 pt-4">
              {!myGoalsOwnershipDetail ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCreateGoalUserId(sessionUserId);
                      setCreateGoalSelf(true);
                      setCreateGoalOpen(true);
                    }}
                  >
                    <Plus className="size-4" />
                    Create my goal
                  </Button>
                </div>
              ) : null}
              {myGoalsActive.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                    <Target className="size-8 opacity-40" />
                    No active annual goals for {year}. Completed goals are under{" "}
                    <strong>Completed</strong>.
                  </CardContent>
                </Card>
              ) : (
                <GoalsOwnershipNavigator
                  groups={myGoalsActiveGroups}
                  goalTasksMap={goalTasksMap}
                  detailKey={myGoalsOwnershipDetail}
                  onSelectDetail={setMyGoalsOwnershipDetail}
                  onBack={() => setMyGoalsOwnershipDetail(null)}
                  toolbar={
                    !myGoalsOwnershipDetail ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCreateGoalUserId(sessionUserId);
                          setCreateGoalSelf(true);
                          setCreateGoalOpen(true);
                        }}
                      >
                        <Plus className="size-4" />
                        Create my goal
                      </Button>
                    )
                  }
                  renderGoalFull={(goal) => renderGoalCard(goal, { isOwner: true, fullView: true })}
                />
              )}
            </TabsContent>

            <TabsContent value="my_tasks" className="pt-4 space-y-4">
              <TaskPriorityFilterSelect
                value={myTasksPriorityFilter}
                onChange={setMyTasksPriorityFilter}
              />
              <TaskList
                tasks={myTasks}
                teamProfiles={teamProfiles}
                sessionUserId={sessionUserId}
                isAdmin={isAdmin}
                onUpdateStatus={setStatusTarget}
                onDeleteTask={handleDeleteTask}
                onToggleTaskComplete={handleToggleTaskComplete}
                onRequestRejectTask={(task) =>
                  setRejectTarget({ kind: "task", id: task.id, title: task.title })
                }
                onVerifyTask={handleVerifyTask}
                taskRemarksMap={taskRemarksMap}
                goalTitleById={goalTitleById}
                sortMode="priority"
                priorityFilter={myTasksPriorityFilter}
                emptyLabel={`No tasks assigned to you for ${year}.`}
              />
            </TabsContent>

            <TabsContent value="assigned_by_me" className="pt-4 space-y-4">
              <TaskPriorityFilterSelect
                value={assignedByMePriorityFilter}
                onChange={setAssignedByMePriorityFilter}
              />
              <TaskList
                tasks={assignedByMe}
                teamProfiles={teamProfiles}
                sessionUserId={sessionUserId}
                isAdmin={isAdmin}
                onUpdateStatus={setStatusTarget}
                onDeleteTask={handleDeleteTask}
                onToggleTaskComplete={handleToggleTaskComplete}
                onRequestRejectTask={(task) =>
                  setRejectTarget({ kind: "task", id: task.id, title: task.title })
                }
                onVerifyTask={handleVerifyTask}
                taskRemarksMap={taskRemarksMap}
                goalTitleById={goalTitleById}
                sortMode="priority"
                priorityFilter={assignedByMePriorityFilter}
                emptyLabel="No tasks you assigned."
              />
            </TabsContent>

            <TabsContent value="completed" className="pt-4">
              <CompletedPanel
                completedGoals={completedGoalsAll}
                goalTasksMap={goalTasksMap}
                goalRemarksMap={goalRemarksMap}
                taskRemarksMap={taskRemarksMap}
                isAdmin={isAdmin}
                sessionUserId={sessionUserId}
                teamProfiles={teamProfiles}
                detailKey={completedOwnershipDetail}
                onSelectDetail={setCompletedOwnershipDetail}
                onBack={() => setCompletedOwnershipDetail(null)}
                onToggleGoalComplete={handleToggleGoalComplete}
                onToggleTaskComplete={handleToggleTaskComplete}
                onRequestRejectGoal={(goal) =>
                  setRejectTarget({ kind: "goal", id: goal.id, title: goal.title })
                }
                onVerifyGoal={handleVerifyGoal}
                onRequestRejectTask={(task) =>
                  setRejectTarget({ kind: "task", id: task.id, title: task.title })
                }
                onVerifyTask={handleVerifyTask}
                onEditOwnership={setEditOwnershipGoal}
                onUpdateGoalPriority={handleUpdateGoalPriority}
                onDeleteGoal={handleDeleteGoal}
                onDeleteTask={handleDeleteTask}
                year={year}
              />
            </TabsContent>

            {isAdmin ? (
              <TabsContent value="team_tasks" className="pt-4 space-y-4">
                <TaskPriorityFilterSelect
                  value={teamTasksPriorityFilter}
                  onChange={setTeamTasksPriorityFilter}
                />
                <TaskList
                  tasks={allTeamTasks}
                  teamProfiles={teamProfiles}
                  sessionUserId={sessionUserId}
                  isAdmin
                  onUpdateStatus={setStatusTarget}
                  onDeleteTask={handleDeleteTask}
                  onToggleTaskComplete={handleToggleTaskComplete}
                  onRequestRejectTask={(task) =>
                    setRejectTarget({ kind: "task", id: task.id, title: task.title })
                  }
                  onVerifyTask={handleVerifyTask}
                  taskRemarksMap={taskRemarksMap}
                  goalTitleById={goalTitleById}
                  sortMode="priority"
                  priorityFilter={teamTasksPriorityFilter}
                  emptyLabel={`No team tasks for ${year}.`}
                />
              </TabsContent>
            ) : null}

            {isAdmin ? (
              <TabsContent value="manage" className="space-y-4 pt-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-2">
                    <Label>User</Label>
                    <Select value={manageUserId} onValueChange={setManageUserId}>
                      <SelectTrigger className="w-[16rem]">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        {manageProfiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {profileDisplayName(p)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    disabled={!manageUserId}
                    onClick={() => {
                      setCreateGoalUserId(manageUserId);
                      setCreateGoalSelf(false);
                      setCreateGoalOpen(true);
                    }}
                  >
                    <Plus className="size-4" />
                    Create goal for user
                  </Button>
                </div>
                {managedGoals.length === 0 ? (
                  <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      No goals for {profileDisplayName(profilesById.get(manageUserId))} in {year}.
                    </CardContent>
                  </Card>
                ) : (
                  <GoalsOwnershipNavigator
                    groups={managedGoalsAllGroups}
                    goalTasksMap={goalTasksMap}
                    detailKey={manageOwnershipDetail}
                    onSelectDetail={setManageOwnershipDetail}
                    onBack={() => setManageOwnershipDetail(null)}
                    toolbar={
                      manageOwnershipDetail ? (
                        <Button
                          type="button"
                          disabled={!manageUserId}
                          onClick={() => {
                            setCreateGoalUserId(manageUserId);
                            setCreateGoalSelf(false);
                            setCreateGoalOpen(true);
                          }}
                        >
                          <Plus className="size-4" />
                          Create goal for user
                        </Button>
                      ) : null
                    }
                    renderGoalFull={(goal) =>
                      renderGoalCard(goal, {
                        isOwner: goal.user_id === sessionUserId,
                        isAdminView: true,
                        fullView: true
                      })
                    }
                  />
                )}
              </TabsContent>
            ) : null}
          </>
        )}
      </Tabs>

      <RejectVerificationDialog
        open={Boolean(rejectTarget)}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        targetLabel={rejectTarget?.title}
        onConfirm={handleRejectVerification}
      />

      <StatusUpdateDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        target={statusTarget}
        isAdmin={isAdmin}
        authorId={sessionUserId}
        onSaved={reload}
      />

      <AssignTaskDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        teamProfiles={teamProfiles}
        sessionUserId={sessionUserId}
        year={year}
        defaultAssigneeId={assignDefaultUserId}
        defaultGoalId={assignGoalId}
        onSaved={() => {
          setAssignGoalId(null);
          setAssignDefaultUserId(null);
          void reload();
        }}
      />

      <CreateGoalDialog
        open={createGoalOpen}
        onOpenChange={setCreateGoalOpen}
        userId={createGoalUserId || sessionUserId}
        year={year}
        createdBy={sessionUserId}
        selfCreate={createGoalSelf}
        ownershipSuggestions={ownershipSuggestions}
        onSaved={reload}
      />

      <EditGoalOwnershipDialog
        open={Boolean(editOwnershipGoal)}
        onOpenChange={(open) => !open && setEditOwnershipGoal(null)}
        goal={editOwnershipGoal}
        ownershipSuggestions={ownershipSuggestions}
        onSaved={reload}
      />
    </div>
  );
}
