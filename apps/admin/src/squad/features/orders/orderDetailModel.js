// Flutter SCOrderDetailHeader / ScOrderDetailsView parity for the web order detail (pure, tested).
const DESTINATIONS = { customer: "Customer", ho: "Head office", makali_factory: "Makali factory", not_defined: "Not defined" };
export const FLUTTER_ACTION_LABELS = { edit: "EDIT ORDER", cancel: "CANCEL ORDER", due: "EDIT DUE DATE" };
const FLUTTER_ACTION_ORDER = ["edit", "cancel", "due"];

/** Header fields in Flutter order. Money/assignment rows appear only when the server sent them for this role. */
export function headerRows(order, state, { date, money }) {
  const rows = [
    ["Order No", `#${order.id}`], ["Created", date(order.created_on ?? order.created_at)], ["Due on", date(order.due_on)],
    ["Dispatch to", DESTINATIONS[order.dispatch_destination?.mode ?? "not_defined"] ?? "Not defined"], ["Order Status", state],
    ["Total Quantity", order.total_quantity], ["DELIVERED", order.dispatched_quantity ?? 0],
  ];
  if (order.total_amount !== undefined) rows.push(["Total Order Value", money(order.total_amount)]);
  if ("factory_manager_id" in order) rows.push(["FACTORY MANAGER", order.factory_manager_id ? "Assigned" : "Yet to be assigned"]);
  if ("worker_id" in order) rows.push(["JOB WORKER", order.worker_id ? "Assigned" : "Yet to be assigned"]);
  return rows;
}
/** Flutter buttons first (EDIT ORDER, CANCEL ORDER, EDIT DUE DATE), then the web-only actions. */
export function orderedActions(rights) {
  const allowed = Object.entries(rights).filter(([, ok]) => ok).map(([name]) => name);
  return [...FLUTTER_ACTION_ORDER.filter((n) => allowed.includes(n)), ...allowed.filter((n) => !FLUTTER_ACTION_ORDER.includes(n))];
}
export const actionLabel = (name, fallback, persona) => (persona && FLUTTER_ACTION_LABELS[name]) || fallback;
