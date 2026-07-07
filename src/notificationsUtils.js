import { supabase } from "./supabaseClient";
import { jobSheetProductionStageLabel } from "./jobSheetProductionStages";
import { STAGE_LABEL } from "./orderViewUtils";

export const NOTIFICATIONS_DASHBOARD_TAB = { id: "notifications", label: "Notifications" };
export const NOTIFICATIONS_SEEN_STORAGE_PREFIX = "printing-tracker-notifications-seen-";

export function formatNotificationWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function normalizeAssignmentNotification(row) {
  return {
    id: `assignment-${row.id}`,
    rawId: row.id,
    kind: "assignment",
    created_at: row.created_at,
    order_id: row.order_id,
    order_display_id: row.order_display_id,
    coordinator_name: row.coordinator_name
  };
}

export function normalizeInwardNotification(row) {
  return {
    id: `inward-${row.id}`,
    rawId: row.id,
    kind: "inward",
    created_at: row.created_at,
    inward_entry_id: row.inward_entry_id,
    product_material: row.product_material,
    department: row.department,
    grn_no: row.grn_no
  };
}

export function normalizePrintingInventoryNotification(row) {
  return {
    id: `printing-inv-${row.id}`,
    rawId: row.id,
    kind: "printing_inventory",
    created_at: row.created_at,
    material_key: row.material_key,
    material_label: row.material_label,
    current_stock: row.current_stock,
    threshold_qty: row.threshold_qty
  };
}

export function normalizeGoalTaskNotification(row) {
  return {
    id: `goal-task-${row.id}`,
    rawId: row.id,
    kind: "goal_task",
    created_at: row.created_at,
    task_id: row.task_id,
    task_title: row.task_title,
    goal_id: row.goal_id,
    goal_title: row.goal_title,
    deadline_date: row.deadline_date,
    assigned_by_user_id: row.assigned_by_user_id
  };
}

export function normalizeOrderStatusNotification(row) {
  return {
    id: `order-status-${row.id}`,
    rawId: row.id,
    kind: "order_status",
    created_at: row.created_at,
    order_id: row.order_id,
    order_display_id: row.order_display_id,
    previous_status: row.previous_status,
    new_status: row.new_status,
    changed_by_user_id: row.changed_by_user_id
  };
}

function orderStatusLabel(code) {
  const key = String(code ?? "").trim();
  if (!key) return "—";
  return jobSheetProductionStageLabel(key) || STAGE_LABEL[key] || key;
}

export function formatOrderStatusCode(code) {
  return orderStatusLabel(code);
}

export function notificationTitle(item) {
  if (item?.kind === "inward") return "Tagged on inward entry";
  if (item?.kind === "printing_inventory") return "Printing inventory low stock";
  if (item?.kind === "goal_task") return "Task assigned to you";
  if (item?.kind === "order_status") return "Order status updated";
  return "Order assigned to you";
}

export function notificationBodyText(item) {
  if (item?.kind === "inward") {
    const product = String(item.product_material ?? "").trim() || "Inward entry";
    const dept = String(item.department ?? "").trim();
    return dept ? `${product} · ${dept}` : product;
  }
  if (item?.kind === "printing_inventory") {
    const label = String(item.material_label ?? item.material_key ?? "Material").trim();
    const stock = Number(item.current_stock);
    const threshold = Number(item.threshold_qty);
    const stockText = Number.isFinite(stock) ? stock.toLocaleString() : "—";
    const thresholdText = Number.isFinite(threshold) ? threshold.toLocaleString() : "—";
    return `${label} · ${stockText} left (threshold ${thresholdText})`;
  }
  if (item?.kind === "goal_task") {
    const title = String(item.task_title ?? "").trim() || "Task";
    const goal = String(item.goal_title ?? "").trim();
    const due = item.deadline_date
      ? ` · due ${new Date(`${item.deadline_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "";
    return goal ? `${title} · Goal: ${goal}${due}` : `${title}${due}`;
  }
  if (item?.kind === "order_status") {
    const orderRef = item.order_display_id ? `Order ${item.order_display_id}` : "Order";
    const from = orderStatusLabel(item.previous_status);
    const to = orderStatusLabel(item.new_status);
    return `${orderRef} · ${from} → ${to}`;
  }
  if (item?.order_display_id) {
    return `Order ${item.order_display_id} · coordinator`;
  }
  return "A new order was assigned as coordinator.";
}

export function readNotificationsSeenAt(userId) {
  if (!userId || typeof window === "undefined") return null;
  return window.localStorage.getItem(`${NOTIFICATIONS_SEEN_STORAGE_PREFIX}${userId}`);
}

export function writeNotificationsSeenAt(userId, iso = new Date().toISOString()) {
  if (!userId || typeof window === "undefined") return;
  window.localStorage.setItem(`${NOTIFICATIONS_SEEN_STORAGE_PREFIX}${userId}`, iso);
}

export function countUnreadNotifications(items, lastSeenAt) {
  if (!items.length) return 0;
  if (!lastSeenAt) return items.length;
  return items.filter((row) => row.created_at > lastSeenAt).length;
}

export async function fetchUserNotifications(userId, limit = 80) {
  if (!userId) return [];
  const perTable = Math.max(20, Math.ceil(limit / 5));
  const [assignmentRes, inwardRes, printingInvRes, goalTaskRes, orderStatusRes] = await Promise.all([
    supabase
      .from("order_assignment_notifications")
      .select("id, order_id, order_display_id, coordinator_name, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(perTable),
    supabase
      .from("inward_entry_notifications")
      .select("id, inward_entry_id, product_material, department, grn_no, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(perTable),
    supabase
      .from("printing_dept_inventory_notifications")
      .select("id, material_key, material_label, current_stock, threshold_qty, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(perTable),
    supabase
      .from("user_goal_task_notifications")
      .select("id, task_id, task_title, goal_id, goal_title, deadline_date, assigned_by_user_id, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(perTable),
    supabase
      .from("order_status_notifications")
      .select("id, order_id, order_display_id, previous_status, new_status, changed_by_user_id, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(perTable)
  ]);

  const printingRows =
    printingInvRes.error?.message?.includes("Could not find the table") ? [] : printingInvRes.data ?? [];
  if (printingInvRes.error && !printingInvRes.error.message?.includes("Could not find the table")) {
    console.warn("printing_dept_inventory_notifications:", printingInvRes.error.message);
  }

  const goalTaskRows =
    goalTaskRes.error?.message?.includes("Could not find the table") ? [] : goalTaskRes.data ?? [];
  if (goalTaskRes.error && !goalTaskRes.error.message?.includes("Could not find the table")) {
    console.warn("user_goal_task_notifications:", goalTaskRes.error.message);
  }

  const orderStatusRows =
    orderStatusRes.error?.message?.includes("Could not find the table") ? [] : orderStatusRes.data ?? [];
  if (orderStatusRes.error && !orderStatusRes.error.message?.includes("Could not find the table")) {
    console.warn("order_status_notifications:", orderStatusRes.error.message);
  }

  return [
    ...(assignmentRes.data ?? []).map(normalizeAssignmentNotification),
    ...(inwardRes.data ?? []).map(normalizeInwardNotification),
    ...printingRows.map(normalizePrintingInventoryNotification),
    ...goalTaskRows.map(normalizeGoalTaskNotification),
    ...orderStatusRows.map(normalizeOrderStatusNotification)
  ]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

export function subscribeUserNotifications(userId, onInsert) {
  if (!userId) return () => {};
  const channel = supabase
    .channel(`user-notifications-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "order_assignment_notifications",
        filter: `recipient_user_id=eq.${userId}`
      },
      (payload) => {
        const row = payload.new;
        if (row && typeof row === "object") {
          onInsert(normalizeAssignmentNotification(row));
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "inward_entry_notifications",
        filter: `recipient_user_id=eq.${userId}`
      },
      (payload) => {
        const row = payload.new;
        if (row && typeof row === "object") {
          onInsert(normalizeInwardNotification(row));
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "printing_dept_inventory_notifications",
        filter: `recipient_user_id=eq.${userId}`
      },
      (payload) => {
        const row = payload.new;
        if (row && typeof row === "object") {
          onInsert(normalizePrintingInventoryNotification(row));
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "user_goal_task_notifications",
        filter: `recipient_user_id=eq.${userId}`
      },
      (payload) => {
        const row = payload.new;
        if (row && typeof row === "object") {
          onInsert(normalizeGoalTaskNotification(row));
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "order_status_notifications",
        filter: `recipient_user_id=eq.${userId}`
      },
      (payload) => {
        const row = payload.new;
        if (row && typeof row === "object") {
          onInsert(normalizeOrderStatusNotification(row));
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
