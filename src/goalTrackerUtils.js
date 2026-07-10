import { supabase } from "./supabaseClient";
import { insertGoalTaskNotification } from "./goalTaskNotificationUtils";
export const GOAL_STATUSES = ["not_started", "in_progress", "completed", "on_hold"];
export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

export const GOAL_STATUS_LABEL = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold"
};

export const TASK_STATUS_LABEL = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled"
};

export const TASK_PRIORITIES = ["P0", "P1", "P2"];

export const TASK_PRIORITY_LABEL = {
  P0: "Top priority",
  P1: "Medium priority",
  P2: "Less priority"
};

const TASK_PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2 };

export function normalizeTaskPriority(priority) {
  const p = String(priority ?? "P2").toUpperCase();
  return TASK_PRIORITIES.includes(p) ? p : "P2";
}

export function taskPriorityRank(priority) {
  return TASK_PRIORITY_ORDER[normalizeTaskPriority(priority)] ?? 2;
}

/** Sort tasks P0 first; optional active-before-completed for goal cards. */
export function sortTasksByPriority(tasks, { groupActiveFirst = false } = {}) {
  return [...(tasks ?? [])]
    .filter((t) => t.status !== "cancelled")
    .sort((a, b) => {
      const pr = taskPriorityRank(a.priority) - taskPriorityRank(b.priority);
      if (pr !== 0) return pr;
      if (groupActiveFirst) {
        const aDone = a.status === "completed" ? 1 : 0;
        const bDone = b.status === "completed" ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
      }
      return String(a.deadline_date ?? "").localeCompare(String(b.deadline_date ?? ""));
    });
}

export function sortGoalCardTasks(tasks) {
  return sortTasksByPriority(tasks, { groupActiveFirst: true });
}

/** Sort goals P0 first within an ownership group. */
export function sortGoalsByPriority(goals) {
  return [...(goals ?? [])].sort((a, b) => {
    const pr = taskPriorityRank(a.priority) - taskPriorityRank(b.priority);
    if (pr !== 0) return pr;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

export function topGoalPriorityRank(goals) {
  const ranks = (goals ?? []).map((g) => taskPriorityRank(g.priority));
  return ranks.length ? Math.min(...ranks) : 2;
}

/** Filter task list by priority; `all` or empty = no filter. */
export function filterTasksByPriority(tasks, priorityFilter) {
  const list = tasks ?? [];
  if (!priorityFilter || priorityFilter === "all") return list;
  const wanted = normalizeTaskPriority(priorityFilter);
  return list.filter((t) => normalizeTaskPriority(t.priority) === wanted);
}

export function currentGoalYear() {
  return new Date().getFullYear();
}

/** Shown in UI when ownership column is null (legacy goals). */
export const GOAL_OWNERSHIP_UNASSIGNED_LABEL = "Uncategorized";

export function normalizeGoalOwnership(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function goalOwnershipLabel(goal) {
  return normalizeGoalOwnership(goal?.ownership) || GOAL_OWNERSHIP_UNASSIGNED_LABEL;
}

export function formatGoalWithOwnership(goal) {
  const ownership = normalizeGoalOwnership(goal?.ownership);
  if (!ownership) return goal?.title ?? "";
  return `${ownership} · ${goal.title}`;
}

export function collectOwnershipLabelsFromGoals(goals) {
  const labels = new Set();
  for (const goal of goals ?? []) {
    const ownership = normalizeGoalOwnership(goal.ownership);
    if (ownership) labels.add(ownership);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/** Group goals under ownership headings (uncategorized first). */
export function groupGoalsByOwnership(goals) {
  const groups = new Map();
  for (const goal of goals ?? []) {
    const key = goalOwnershipLabel(goal);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(goal);
  }
  return [...groups.entries()]
    .map(([ownership, list]) => ({
      ownership,
      goals: list,
      isUnassigned: ownership === GOAL_OWNERSHIP_UNASSIGNED_LABEL
    }))
    .sort((a, b) => {
      if (a.isUnassigned && !b.isUnassigned) return -1;
      if (!a.isUnassigned && b.isUnassigned) return 1;
      return a.ownership.localeCompare(b.ownership);
    });
}

export function profileDisplayName(profile) {
  if (!profile) return "—";
  const name = String(profile.full_name ?? "").trim();
  if (name) return name;
  return String(profile.email ?? "").trim() || "User";
}

export function isTaskOverdue(task) {
  if (!task?.deadline_date || task.status === "completed" || task.status === "cancelled") {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(`${task.deadline_date}T00:00:00`);
  return deadline < today;
}

export function formatGoalDeadline(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatRemarkTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const GOAL_SELECT =
  "id, user_id, year, title, description, ownership, priority, status, created_by, created_at, updated_at, completed_at, admin_verified_at, admin_verified_by";

const TASK_SELECT =
  "id, goal_id, assignee_id, assigned_by, title, description, deadline_date, priority, status, created_at, updated_at, completed_at, admin_verified_at, admin_verified_by";

const REMARK_SELECT =
  "id, goal_id, task_id, author_id, previous_status, new_status, remark, created_at";

export async function fetchGoalsForUser(userId, year) {
  const { data, error } = await supabase
    .from("user_annual_goals")
    .select(GOAL_SELECT)
    .eq("user_id", userId)
    .eq("year", year)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Goals for assign-task "Link to goal" — uses RPC so assigners can read assignee goals. */
export async function fetchGoalsForTaskAssignment(assigneeId, year) {
  if (!assigneeId || !year) return [];
  const { data, error } = await supabase.rpc("get_goals_for_task_assignment", {
    p_assignee_id: assigneeId,
    p_year: year
  });
  if (error) throw error;
  return data ?? [];
}

/** Admin overview — all goals for a year (RLS: admin only). */
export async function fetchAllGoalsForYear(year) {
  const { data, error } = await supabase
    .from("user_annual_goals")
    .select(GOAL_SELECT)
    .eq("year", year)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Admin overview — all tasks (RLS: admin sees all). Optional year filter via joined goals. */
export async function fetchAllTasksForYear(year) {
  const { data, error } = await supabase
    .from("user_goal_tasks")
    .select(
      `${TASK_SELECT}, goal:user_annual_goals(id, year, title, user_id), assignee:profiles!user_goal_tasks_assignee_id_fkey(full_name, email, job_role, department), assigner:profiles!user_goal_tasks_assigned_by_fkey(full_name, email)`
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (!year) return rows;
  return rows.filter((t) => !t.goal || t.goal.year === year || t.goal_id == null);
}

export async function fetchMyAssignedTasks(userId, year) {
  let query = supabase
    .from("user_goal_tasks")
    .select(`${TASK_SELECT}, goal:user_annual_goals(id, year, title, user_id)`)
    .eq("assignee_id", userId)
    .order("deadline_date", { ascending: true, nullsFirst: false });

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  if (!year) return rows;
  return rows.filter((t) => !t.goal || t.goal.year === year || t.goal_id == null);
}

export async function fetchTasksAssignedByUser(userId, year) {
  const { data, error } = await supabase
    .from("user_goal_tasks")
    .select(`${TASK_SELECT}, goal:user_annual_goals(id, year, title, user_id)`)
    .eq("assigned_by", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (!year) return rows;
  return rows.filter((t) => !t.goal || t.goal.year === year || t.goal_id == null);
}

export async function fetchTasksForGoal(goalId) {
  const { data, error } = await supabase
    .from("user_goal_tasks")
    .select(TASK_SELECT)
    .eq("goal_id", goalId)
    .order("deadline_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchRemarksForGoal(goalId) {
  const { data, error } = await supabase
    .from("user_goal_status_remarks")
    .select(`${REMARK_SELECT}, author:profiles!user_goal_status_remarks_author_id_fkey(full_name, email)`)
    .eq("goal_id", goalId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchRemarksForTask(taskId) {
  const { data, error } = await supabase
    .from("user_goal_status_remarks")
    .select(`${REMARK_SELECT}, author:profiles!user_goal_status_remarks_author_id_fkey(full_name, email)`)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createAnnualGoal({ userId, year, title, description, ownership, priority = "P2", createdBy }) {
  const { data, error } = await supabase
    .from("user_annual_goals")
    .insert({
      user_id: userId,
      year,
      title: title.trim(),
      description: description?.trim() || null,
      ownership: normalizeGoalOwnership(ownership),
      priority: normalizeTaskPriority(priority),
      created_by: createdBy,
      status: "not_started"
    })
    .select(GOAL_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateGoalOwnership(goalId, ownership) {
  const { data, error } = await supabase
    .from("user_annual_goals")
    .update({
      ownership: normalizeGoalOwnership(ownership),
      updated_at: new Date().toISOString()
    })
    .eq("id", goalId)
    .select(GOAL_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateGoalPriority(goalId, priority) {
  const { data, error } = await supabase
    .from("user_annual_goals")
    .update({
      priority: normalizeTaskPriority(priority),
      updated_at: new Date().toISOString()
    })
    .eq("id", goalId)
    .select(GOAL_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function createGoalTask({
  goalId,
  assigneeId,
  assignedBy,
  title,
  description,
  deadlineDate,
  priority = "P2",
  goalTitle
}) {
  const { data, error } = await supabase
    .from("user_goal_tasks")
    .insert({
      goal_id: goalId || null,
      assignee_id: assigneeId,
      assigned_by: assignedBy,
      title: title.trim(),
      description: description?.trim() || null,
      deadline_date: deadlineDate || null,
      priority: normalizeTaskPriority(priority),
      status: "pending"
    })
    .select(TASK_SELECT)
    .single();
  if (error) throw error;

  await insertGoalTaskNotification({
    taskId: data.id,
    taskTitle: data.title,
    goalId: data.goal_id,
    goalTitle,
    assigneeId: data.assignee_id,
    assignedByUserId: assignedBy,
    deadlineDate: data.deadline_date
  });

  return data;
}

export async function updateGoalStatusWithRemark({
  goalId,
  newStatus,
  remark,
  authorId,
  previousStatus,
  requireRemark = true
}) {
  const trimmed = String(remark ?? "").trim();
  if (requireRemark && !trimmed) {
    throw new Error("Remark is required when updating status.");
  }

  const { error: updateError } = await supabase
    .from("user_annual_goals")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", goalId);
  if (updateError) throw updateError;

  if (trimmed) {
    const { error: remarkError } = await supabase.from("user_goal_status_remarks").insert({
      goal_id: goalId,
      author_id: authorId,
      previous_status: previousStatus ?? null,
      new_status: newStatus,
      remark: trimmed
    });
    if (remarkError) throw remarkError;
  }
}

export async function updateTaskStatusWithRemark({
  taskId,
  newStatus,
  remark,
  authorId,
  previousStatus,
  requireRemark = true
}) {
  const trimmed = String(remark ?? "").trim();
  if (requireRemark && !trimmed) {
    throw new Error("Remark is required when updating status.");
  }

  const { error: updateError } = await supabase
    .from("user_goal_tasks")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (updateError) throw updateError;

  if (trimmed) {
    const { error: remarkError } = await supabase.from("user_goal_status_remarks").insert({
      task_id: taskId,
      author_id: authorId,
      previous_status: previousStatus ?? null,
      new_status: newStatus,
      remark: trimmed
    });
    if (remarkError) throw remarkError;
  }
}

export async function deleteAnnualGoal(goalId) {
  const { error } = await supabase.from("user_annual_goals").delete().eq("id", goalId);
  if (error) throw error;
}

export async function deleteGoalTask(taskId) {
  const { error } = await supabase.from("user_goal_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export function isGoalCompleted(goal) {
  return goal?.status === "completed";
}

export function isTaskCompleted(task) {
  return task?.status === "completed";
}

export function isGoalAdminVerified(goal) {
  return Boolean(goal?.admin_verified_at);
}

export function isTaskAdminVerified(task) {
  return Boolean(task?.admin_verified_at);
}

/** @deprecated use isGoalAdminVerified — column stores any verifier */
export const isGoalVerified = isGoalAdminVerified;

/** @deprecated use isTaskAdminVerified */
export const isTaskVerified = isTaskAdminVerified;

/** Who must verify a completed task (assigner who created the task). */
export function getTaskVerifierId(task) {
  return task?.assigned_by ?? null;
}

/** Who must verify a completed goal (goal owner / assignee of the goal). */
export function getGoalVerifierId(goal) {
  return goal?.user_id ?? null;
}

export function canUserVerifyTask(task, userId) {
  if (!userId || !isTaskCompleted(task) || isTaskAdminVerified(task)) return false;
  return getTaskVerifierId(task) === userId;
}

export function canUserVerifyGoal(goal, userId) {
  if (!userId || !isGoalCompleted(goal) || isGoalAdminVerified(goal)) return false;
  return getGoalVerifierId(goal) === userId;
}

export function taskNeedsVerification(task) {
  return isTaskCompleted(task) && !isTaskAdminVerified(task) && Boolean(getTaskVerifierId(task));
}

export function goalNeedsVerification(goal) {
  return isGoalCompleted(goal) && !isGoalAdminVerified(goal) && Boolean(getGoalVerifierId(goal));
}

export function partitionGoalsByCompletion(goals) {
  const list = goals ?? [];
  return {
    active: list.filter((g) => g.status !== "completed"),
    completed: list.filter((g) => g.status === "completed")
  };
}

export function partitionTasksByCompletion(tasks) {
  const list = tasks ?? [];
  return {
    active: list.filter((t) => t.status !== "completed" && t.status !== "cancelled"),
    completed: list.filter((t) => t.status === "completed")
  };
}

export async function setTaskCompleted(taskId, completed, taskRow = null) {
  const now = new Date().toISOString();
  let row = taskRow;
  if (!row) {
    const { data } = await supabase.from("user_goal_tasks").select(TASK_SELECT).eq("id", taskId).maybeSingle();
    row = data;
  }

  const payload = completed
    ? {
        status: "completed",
        completed_at: now,
        admin_verified_at: null,
        admin_verified_by: null,
        updated_at: now
      }
    : {
        status: "in_progress",
        completed_at: null,
        admin_verified_at: null,
        admin_verified_by: null,
        updated_at: now
      };
  const { error } = await supabase.from("user_goal_tasks").update(payload).eq("id", taskId);
  if (error) throw error;

  if (completed && row?.assigned_by) {
    let goalTitle = null;
    if (row.goal_id) {
      const { data: goal } = await supabase
        .from("user_annual_goals")
        .select("title")
        .eq("id", row.goal_id)
        .maybeSingle();
      goalTitle = goal?.title ?? null;
    }
    await insertTaskCompletionVerifyNotification({
      task: { ...row, status: "completed" },
      goalTitle
    });
  }
}

export async function setGoalCompleted(goalId, completed, goalRow = null) {
  const now = new Date().toISOString();
  let row = goalRow;
  if (!row) {
    const { data } = await supabase.from("user_annual_goals").select(GOAL_SELECT).eq("id", goalId).maybeSingle();
    row = data;
  }

  const payload = completed
    ? {
        status: "completed",
        completed_at: now,
        admin_verified_at: null,
        admin_verified_by: null,
        updated_at: now
      }
    : {
        status: "in_progress",
        completed_at: null,
        admin_verified_at: null,
        admin_verified_by: null,
        updated_at: now
      };
  const { error } = await supabase.from("user_annual_goals").update(payload).eq("id", goalId);
  if (error) throw error;

  if (completed && row && getGoalVerifierId(row)) {
    await insertGoalCompletionVerifyNotification({ goal: row });
  }
}

export async function verifyTaskCompletion(taskId, verifierId, { verified, remark = "" }) {
  const now = new Date().toISOString();
  if (verified) {
    const { error } = await supabase
      .from("user_goal_tasks")
      .update({
        admin_verified_at: now,
        admin_verified_by: verifierId,
        updated_at: now
      })
      .eq("id", taskId);
    if (error) throw error;
    return;
  }

  const trimmed = String(remark ?? "").trim();
  if (!trimmed) {
    throw new Error("Remark is required when marking a task as not complete.");
  }

  const { error: updateError } = await supabase
    .from("user_goal_tasks")
    .update({
      status: "in_progress",
      completed_at: null,
      admin_verified_at: null,
      admin_verified_by: null,
      updated_at: now
    })
    .eq("id", taskId);
  if (updateError) throw updateError;

  const { error: remarkError } = await supabase.from("user_goal_status_remarks").insert({
    task_id: taskId,
    author_id: verifierId,
    previous_status: "completed",
    new_status: "in_progress",
    remark: trimmed
  });
  if (remarkError) throw remarkError;
}

export async function verifyGoalCompletion(goalId, verifierId, { verified, remark = "" }) {
  const now = new Date().toISOString();
  if (verified) {
    const { error } = await supabase
      .from("user_annual_goals")
      .update({
        admin_verified_at: now,
        admin_verified_by: verifierId,
        updated_at: now
      })
      .eq("id", goalId);
    if (error) throw error;
    return;
  }

  const trimmed = String(remark ?? "").trim();
  if (!trimmed) {
    throw new Error("Remark is required when marking a goal as not complete.");
  }

  const { error: updateError } = await supabase
    .from("user_annual_goals")
    .update({
      status: "in_progress",
      completed_at: null,
      admin_verified_at: null,
      admin_verified_by: null,
      updated_at: now
    })
    .eq("id", goalId);
  if (updateError) throw updateError;

  const { error: remarkError } = await supabase.from("user_goal_status_remarks").insert({
    goal_id: goalId,
    author_id: verifierId,
    previous_status: "completed",
    new_status: "in_progress",
    remark: trimmed
  });
  if (remarkError) throw remarkError;
}

/** @deprecated use verifyTaskCompletion */
export async function adminVerifyTask(taskId, adminId, verified) {
  if (verified) {
    await verifyTaskCompletion(taskId, adminId, { verified: true });
  } else {
    throw new Error("Use verifyTaskCompletion with a remark to reject.");
  }
}

/** @deprecated use verifyGoalCompletion */
export async function adminVerifyGoal(goalId, adminId, verified) {
  if (verified) {
    await verifyGoalCompletion(goalId, adminId, { verified: true });
  } else {
    throw new Error("Use verifyGoalCompletion with a remark to reject.");
  }
}

async function insertTaskCompletionVerifyNotification({ task, goalTitle }) {
  const verifierId = getTaskVerifierId(task);
  if (!verifierId) {
    return { ok: true, skipped: true };
  }
  return insertGoalTaskNotification({
    taskId: task.id,
    taskTitle: `Review completion: ${String(task.title ?? "").trim() || "Task"}`,
    goalId: task.goal_id,
    goalTitle,
    assigneeId: verifierId,
    assignedByUserId: task.assignee_id ?? verifierId,
    deadlineDate: task.deadline_date
  });
}

async function insertGoalCompletionVerifyNotification({ goal }) {
  const verifierId = getGoalVerifierId(goal);
  if (!verifierId) return { ok: true, skipped: true };
  const { error } = await supabase.from("user_goal_task_notifications").insert({
    recipient_user_id: verifierId,
    task_id: null,
    task_title: `Confirm goal completion: ${String(goal.title ?? "").trim() || "Goal"}`,
    goal_id: goal.id,
    goal_title: goal.title,
    assigned_by_user_id: goal.created_by ?? goal.user_id,
    deadline_date: null
  });
  if (error) {
    console.warn("Goal completion verify notification:", error.message);
    return { ok: false, error };
  }
  return { ok: true };
}

export function summarizeHomeGoals(goals, tasks) {
  const activeGoals = goals.filter((g) => g.status !== "completed");
  const openTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const overdue = openTasks.filter(isTaskOverdue);
  const upcoming = [...openTasks]
    .filter((t) => t.deadline_date && !isTaskOverdue(t))
    .sort((a, b) => String(a.deadline_date).localeCompare(String(b.deadline_date)))
    .slice(0, 5);
  return {
    goalCount: goals.length,
    activeGoalCount: activeGoals.length,
    openTaskCount: openTasks.length,
    overdueCount: overdue.length,
    upcoming
  };
}

const GOAL_STATUS_PROGRESS = {
  not_started: 0,
  on_hold: 25,
  in_progress: 50,
  completed: 100
};

/** Progress 0–100 for one goal from its tasks, else from goal status. */
export function goalProgressPercent(goal, tasks = []) {
  const activeTasks = (tasks ?? []).filter((t) => t.status !== "cancelled");
  if (activeTasks.length > 0) {
    const done = activeTasks.filter((t) => t.status === "completed").length;
    return Math.round((done / activeTasks.length) * 100);
  }
  return GOAL_STATUS_PROGRESS[goal?.status] ?? 0;
}

/** Aggregate progress for a user's goals in a year. */
export function userGoalsProgressSummary(goals, tasksByGoalId = {}) {
  if (!goals?.length) {
    return { percent: 0, completedGoals: 0, totalGoals: 0, openTasks: 0, totalTasks: 0 };
  }
  let totalPct = 0;
  let completedGoals = 0;
  let openTasks = 0;
  let totalTasks = 0;
  for (const goal of goals) {
    const tasks = tasksByGoalId[goal.id] ?? [];
    totalPct += goalProgressPercent(goal, tasks);
    if (goal.status === "completed") completedGoals += 1;
    const active = tasks.filter((t) => t.status !== "cancelled");
    totalTasks += active.length;
    openTasks += active.filter((t) => t.status !== "completed").length;
  }
  return {
    percent: Math.round(totalPct / goals.length),
    completedGoals,
    totalGoals: goals.length,
    openTasks,
    totalTasks
  };
}

export function groupGoalsByUserId(goals) {
  const map = new Map();
  for (const goal of goals ?? []) {
    if (!map.has(goal.user_id)) map.set(goal.user_id, []);
    map.get(goal.user_id).push(goal);
  }
  return map;
}
