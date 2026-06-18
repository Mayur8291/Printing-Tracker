import { supabase } from "./supabaseClient";

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

export function notificationTitle(item) {
  if (item?.kind === "inward") return "Tagged on inward entry";
  if (item?.kind === "printing_inventory") return "Printing inventory low stock";
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

export async function fetchUserNotifications(userId, limit = 50) {
  if (!userId) return [];
  const [assignmentRes, inwardRes, printingInvRes] = await Promise.all([
    supabase
      .from("order_assignment_notifications")
      .select("id, order_id, order_display_id, coordinator_name, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("inward_entry_notifications")
      .select("id, inward_entry_id, product_material, department, grn_no, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("printing_dept_inventory_notifications")
      .select("id, material_key, material_label, current_stock, threshold_qty, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit)
  ]);

  const printingRows =
    printingInvRes.error?.message?.includes("Could not find the table") ? [] : printingInvRes.data ?? [];
  if (printingInvRes.error && !printingInvRes.error.message?.includes("Could not find the table")) {
    console.warn("printing_dept_inventory_notifications:", printingInvRes.error.message);
  }

  return [
    ...(assignmentRes.data ?? []).map(normalizeAssignmentNotification),
    ...(inwardRes.data ?? []).map(normalizeInwardNotification),
    ...printingRows.map(normalizePrintingInventoryNotification)
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
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
