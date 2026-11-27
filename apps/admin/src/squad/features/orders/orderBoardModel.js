// Flutter CoordinatorOrdersView / DealerOrdersView parity (pure, tested).
const CRITERIA_ROLES = [2, 4, 7];
/** scope: 'all' | 'own' (dealer My Orders) | 'placed' (dealer Placed Orders = customers' orders). */
export function boardScope(identity, search = "") {
  const requested = new URLSearchParams(search).get("scope");
  if (Number(identity.role) !== 10) return { scope: "all", filters: {} };
  return requested === "own" ? { scope: "own", filters: { customer_id: String(identity.id) } } : { scope: "placed", filters: { placed_for_me: true } };
}
export const boardCriteria = (role) => CRITERIA_ROLES.includes(Number(role));
/** Production Coordinator sees "Assigned (n)" instead of "Completed (n)" and a count-less title. */
export function boardLabels(role, stats) {
  const pc = Number(role) === 2;
  return {
    title: pc ? "Orders" : `Orders${stats?.total_orders != null ? ` (${stats.total_orders})` : ""}`,
    tabs: [{ key: "pending", label: "Pending", count: stats?.pending }, { key: "completed", label: pc ? "Assigned" : "Completed", count: stats?.completed_excl_cancelled }],
  };
}

/** Job workers progress by worker_status (own pipeline), everyone else by order status. */
export function boardTabFilter(role, tab) {
  return Number(role) === 11 ? { worker_status: tab === "pending" ? 0 : 1 } : { state: tab };
}
/** Job-worker counters count by worker_status, which the drill-down list cannot express; keep tiles informational there. */
export const boardDrillable = (role) => Number(role) !== 11;
export const boardOpenPath = (role, id) => (Number(role) === 11 ? `/squad/job-work/${id}` : `/squad/orders/${id}`);
