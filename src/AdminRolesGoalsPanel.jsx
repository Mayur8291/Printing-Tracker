import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Briefcase, Target, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import GoalTaskDetailGrid from "./components/goals/GoalTaskDetailGrid";
import TaskPriorityBadge from "./components/goals/TaskPriorityBadge";
import {
  currentGoalYear,
  deleteAnnualGoal,
  deleteGoalTask,
  fetchAllGoalsForYear,
  fetchAllTasksForYear,
  fetchRemarksForGoal,
  fetchTasksForGoal,
  GOAL_STATUS_LABEL,
  goalOwnershipLabel,
  goalProgressPercent,
  groupGoalsByUserId,
  isTaskAdminVerified,
  isTaskCompleted,
  profileDisplayName,
  TASK_STATUS_LABEL,
  userGoalsProgressSummary
} from "./goalTrackerUtils";
import { subscribePostgresChanges } from "./realtimeUtils";

function ProgressBar({ value, className }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

function AdminDeleteButton({ label, onClick, disabled }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={label}
    >
      <Trash2 className="size-4" />
      Delete
    </Button>
  );
}

function UserGoalCard({ goal, tasks, onSelect, onDeleteGoal }) {
  const pct = goalProgressPercent(goal, tasks);
  return (
    <div className="relative rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40">
      <button type="button" className="w-full text-left" onClick={() => onSelect?.(goal)}>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {goalOwnershipLabel(goal)}
          </p>
          <p className="font-medium">{goal.title}</p>
          {goal.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{goal.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <TaskPriorityBadge priority={goal.priority} compact />
            <Badge variant="outline">{GOAL_STATUS_LABEL[goal.status] ?? goal.status}</Badge>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Progress · {pct}%
          </p>
          <ProgressBar value={pct} />
          <p className="text-xs text-muted-foreground">
            {tasks.filter((t) => t.status === "completed").length}/{tasks.length} tasks done
          </p>
        </div>
      </button>
      {onDeleteGoal ? (
        <div className="mt-3 flex justify-end border-t pt-3">
          <AdminDeleteButton label="Delete goal" onClick={() => onDeleteGoal(goal.id)} />
        </div>
      ) : null}
    </div>
  );
}

function UserRolesGoalsDetail({
  profile,
  year,
  goals,
  tasksByGoalId,
  allTasks,
  onBack,
  selectedGoalId,
  onSelectGoal,
  goalRemarks,
  onDeleteGoal,
  onDeleteTask
}) {
  const assignedToUser = allTasks.filter((t) => t.assignee_id === profile.id);
  const assignedByUser = allTasks.filter((t) => t.assigned_by === profile.id);
  const selectedGoal = goals.find((g) => g.id === selectedGoalId);
  const selectedTasks = selectedGoal ? tasksByGoalId[selectedGoal.id] ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          All users
        </Button>
        <div>
          <h4 className="text-lg font-semibold">{profileDisplayName(profile)}</h4>
          <p className="text-sm text-muted-foreground">
            {[profile.job_role, profile.department].filter(Boolean).join(" · ") || "—"}
            {profile.role ? ` · ${profile.role}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Goals ({year})</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-bold tabular-nums">{goals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Tasks assigned to them</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-bold tabular-nums">{assignedToUser.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Tasks they created</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-bold tabular-nums">{assignedByUser.length}</p>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h5 className="text-sm font-semibold">Annual goals & progress</h5>
        {goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No goals for {year}.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {goals.map((goal) => (
              <UserGoalCard
                key={goal.id}
                goal={goal}
                tasks={tasksByGoalId[goal.id] ?? []}
                onSelect={(g) => onSelectGoal(g.id === selectedGoalId ? null : g.id)}
                onDeleteGoal={onDeleteGoal}
              />
            ))}
          </div>
        )}
      </section>

      {selectedGoal ? (
        <Card className="border-primary/30">
          <CardHeader className="p-4 pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{selectedGoal.title}</CardTitle>
                <CardDescription>{GOAL_STATUS_LABEL[selectedGoal.status]}</CardDescription>
              </div>
              {onDeleteGoal ? (
                <AdminDeleteButton
                  label="Delete goal and its tasks"
                  onClick={() => onDeleteGoal(selectedGoal.id)}
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            <ProgressBar value={goalProgressPercent(selectedGoal, selectedTasks)} />
            <ul className="space-y-3 text-sm">
              {selectedTasks.map((task) => (
                <li key={task.id} className="rounded-md border px-4 py-3">
                  <GoalTaskDetailGrid
                    task={task}
                    assignee={task.assignee || profile}
                    goalTitle={selectedGoal.title}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                    {isTaskCompleted(task) && !isTaskAdminVerified(task) ? (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-800">
                        Awaiting assigner verification
                      </Badge>
                    ) : null}
                    {isTaskAdminVerified(task) ? (
                      <Badge variant="secondary">Confirmed complete</Badge>
                    ) : null}
                    {onDeleteTask ? (
                      <AdminDeleteButton label="Delete task" onClick={() => onDeleteTask(task.id)} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {(goalRemarks[selectedGoal.id] ?? []).length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">Recent remarks</p>
                <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                  {goalRemarks[selectedGoal.id].slice(0, 5).map((r) => (
                    <li key={r.id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                      {r.remark}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {assignedToUser.length > 0 ? (
        <section className="space-y-3">
          <h5 className="text-sm font-semibold">Tasks assigned to them</h5>
          <ul className="space-y-3 text-sm">
            {assignedToUser.map((task) => (
              <li
                key={task.id}
                className="rounded-md border px-4 py-3"
              >
                <GoalTaskDetailGrid task={task} assignee={task.assignee || profile} />
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                  {onDeleteTask ? (
                    <AdminDeleteButton label="Delete task" onClick={() => onDeleteTask(task.id)} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {assignedByUser.length > 0 ? (
        <section className="space-y-3">
          <h5 className="text-sm font-semibold">Tasks they assigned to others</h5>
          <ul className="space-y-3 text-sm">
            {assignedByUser.map((task) => (
              <li
                key={task.id}
                className="rounded-md border px-4 py-3"
              >
                <GoalTaskDetailGrid
                  task={task}
                  assignee={task.assignee}
                  goalTitle={task.goal?.title}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                  {onDeleteTask ? (
                    <AdminDeleteButton label="Delete task" onClick={() => onDeleteTask(task.id)} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function AdminRolesGoalsPanel({ profiles, teamProfiles = [] }) {
  const [year, setYear] = useState(currentGoalYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allGoals, setAllGoals] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [tasksByGoalId, setTasksByGoalId] = useState({});
  const [goalRemarks, setGoalRemarks] = useState({});
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedGoalId, setSelectedGoalId] = useState(null);

  const mergedProfiles = useMemo(() => {
    const map = new Map((teamProfiles ?? []).map((p) => [p.id, { ...p }]));
    for (const p of profiles ?? []) {
      map.set(p.id, { ...map.get(p.id), ...p });
    }
    return [...map.values()]
      .filter((p) => p.is_active !== false)
      .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b)));
  }, [profiles, teamProfiles]);

  const goalsByUser = useMemo(() => groupGoalsByUserId(allGoals), [allGoals]);

  const load = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const [goals, tasks] = await Promise.all([fetchAllGoalsForYear(year), fetchAllTasksForYear(year)]);
      setAllGoals(goals);
      setAllTasks(tasks);
      const taskEntries = await Promise.all(goals.map(async (g) => [g.id, await fetchTasksForGoal(g.id)]));
      setTasksByGoalId(Object.fromEntries(taskEntries));
    } catch (e) {
      setError(e.message || "Could not load roles and goals.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribePostgresChanges({
      channelName: "admin-roles-goals-live",
      tables: ["user_annual_goals", "user_goal_tasks", "user_goal_status_remarks"],
      onEvent: () => {
        void load({ silent: true });
      }
    });
  }, [load]);

  useEffect(() => {
    if (!selectedGoalId) return;
    void fetchRemarksForGoal(selectedGoalId).then((rows) => {
      setGoalRemarks((prev) => ({ ...prev, [selectedGoalId]: rows }));
    });
  }, [selectedGoalId]);

  const selectedProfile = mergedProfiles.find((p) => p.id === selectedUserId);
  const selectedGoals = selectedUserId ? goalsByUser.get(selectedUserId) ?? [] : [];

  const completedTasksAll = useMemo(
    () =>
      (allTasks ?? [])
        .filter((task) => isTaskCompleted(task))
        .sort((a, b) =>
          String(b.completed_at ?? b.updated_at).localeCompare(String(a.completed_at ?? a.updated_at))
        ),
    [allTasks]
  );

  const goalTitleById = useMemo(() => {
    const map = new Map();
    for (const goal of allGoals ?? []) {
      map.set(goal.id, goal.title);
    }
    return map;
  }, [allGoals]);

  async function handleDeleteGoal(goalId) {
    if (!window.confirm("Delete this goal and all its tasks for this user?\n\nThis cannot be undone.")) {
      return;
    }
    try {
      await deleteAnnualGoal(goalId);
      if (selectedGoalId === goalId) setSelectedGoalId(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete goal.");
    }
  }

  async function handleDeleteTask(taskId) {
    if (!window.confirm("Delete this task for this user?\n\nThis cannot be undone.")) {
      return;
    }
    try {
      await deleteGoalTask(taskId);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete task.");
    }
  }

  const yearOptions = [currentGoalYear() - 1, currentGoalYear(), currentGoalYear() + 1];

  if (selectedProfile) {
    return (
      <UserRolesGoalsDetail
        profile={selectedProfile}
        year={year}
        goals={selectedGoals}
        tasksByGoalId={tasksByGoalId}
        allTasks={allTasks}
        onBack={() => {
          setSelectedUserId(null);
          setSelectedGoalId(null);
        }}
        selectedGoalId={selectedGoalId}
        onSelectGoal={setSelectedGoalId}
        goalRemarks={goalRemarks}
        onDeleteGoal={handleDeleteGoal}
        onDeleteTask={handleDeleteTask}
      />
    );
  }

  return (
    <section className="admin-user-mgmt-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="admin-user-mgmt-title">Roles &amp; goals</h4>
          <p className="text-sm text-muted-foreground">
            Click a user to see their role, annual goals, task progress, and assigned work.
          </p>
        </div>
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
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading && completedTasksAll.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          <div>
            <h5 className="text-sm font-semibold">Completed tasks</h5>
            <p className="text-xs text-muted-foreground">
              Goal title, task title, description, and assignee name for admin review.
            </p>
          </div>
          <ul className="space-y-3">
            {completedTasksAll.map((task) => (
              <li key={task.id} className="rounded-md border px-4 py-3">
                <GoalTaskDetailGrid
                  task={task}
                  assignee={task.assignee}
                  goalTitle={task.goal?.title || goalTitleById.get(task.goal_id)}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                  {!isTaskAdminVerified(task) ? (
                    <Badge variant="outline" className="border-amber-500/50 text-amber-800">
                      Awaiting assigner verification
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Confirmed complete</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mergedProfiles.map((profile) => {
            const goals = goalsByUser.get(profile.id) ?? [];
            const summary = userGoalsProgressSummary(goals, tasksByGoalId);
            return (
              <button
                key={profile.id}
                type="button"
                className="rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40"
                onClick={() => setSelectedUserId(profile.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-0.5">
                      <p className="truncate font-semibold">{profileDisplayName(profile)}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Briefcase className="size-3 shrink-0" />
                        {profile.job_role?.trim() || profile.role || "—"}
                      </p>
                      {profile.department ? (
                        <p className="text-xs text-muted-foreground">{profile.department}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Target className="size-3 shrink-0" />
                        {summary.totalGoals} goal{summary.totalGoals === 1 ? "" : "s"} · {summary.percent}%
                      </p>
                      <ProgressBar value={summary.percent} />
                      <p className="text-xs text-muted-foreground">
                        {summary.openTasks} open task{summary.openTasks === 1 ? "" : "s"}
                        {summary.completedGoals > 0 ? ` · ${summary.completedGoals} goal done` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
