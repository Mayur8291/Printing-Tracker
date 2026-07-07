import { supabase } from "./supabaseClient";

/**
 * Notify assignee when a goal task is assigned to them (skip self-assign).
 */
export async function insertGoalTaskNotification({
  taskId,
  taskTitle,
  goalId,
  goalTitle,
  assigneeId,
  assignedByUserId,
  deadlineDate
}) {
  if (!taskId || !assigneeId || !assignedByUserId || assigneeId === assignedByUserId) {
    return { ok: true, skipped: true };
  }

  const { error } = await supabase.from("user_goal_task_notifications").insert({
    recipient_user_id: assigneeId,
    task_id: taskId,
    task_title: String(taskTitle ?? "").trim() || "Task",
    goal_id: goalId || null,
    goal_title: goalTitle ? String(goalTitle).trim() : null,
    assigned_by_user_id: assignedByUserId,
    deadline_date: deadlineDate || null
  });

  if (error) {
    if (error.message?.includes("Could not find the table")) {
      console.warn(
        "user_goal_task_notifications table missing — run migration 20260707130000_add_goal_task_and_order_status_notifications.sql"
      );
      return { ok: false, skipped: true, error };
    }
    console.error("Goal task notification:", error.message);
    return { ok: false, error };
  }

  return { ok: true };
}
