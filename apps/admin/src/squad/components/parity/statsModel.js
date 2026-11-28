// Flutter orders_counter.dart / jobworker_orders_counter.dart parity. Pure and unit-tested.
// Tile order matches Flutter. A tile appears only when the server supplied its value
// (money and earnings are withheld server-side per role), so the UI never guesses permissions.
export const COUNTERS = Object.freeze([
  { key: "pending_criteria", label: "Pending Order Criteria", drill: { criteria: 0 }, optional: true },
  { key: "completed", label: "Completed Orders", drill: { state: "completed" } },
  { key: "pending", label: "Pending Orders", drill: { state: "pending" } },
  { key: "critical", label: "Critical Pending Orders", drill: { state: "critical" } },
  { key: "overdue", label: "Overdue Orders", drill: { state: "overdue" } },
  { key: "total_value", label: "Total Order Value", money: true },
  { key: "amount_earned", label: "Amount Earned", money: true },
  { key: "total_orders", label: "Total Order" },
]);

/** Flutter Utils.convertToKilo: 1.2K style for large counts. */
export function kilo(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (Math.abs(n) >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (Math.abs(n) >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.trunc(n));
}
export const padCount = (n) => String(n ?? 0).padStart(2, "0");

/** @param options.criteria show Pending Order Criteria only where Flutter passed it (PC, FM, dispatch, SC detail). */
export function visibleCounters(stats, { criteria = false } = {}) {
  if (!stats) return [];
  return COUNTERS.filter((c) => stats[c.key] !== undefined && stats[c.key] !== null && (!c.optional || criteria))
    .map((c) => ({ ...c, raw: stats[c.key], value: c.money ? `₹${kilo(stats[c.key])}` : c.key === "total_orders" ? kilo(stats[c.key]) : padCount(stats[c.key]),
      hint: c.key === "completed" && stats.cancelled > 0 ? `incl. ${stats.cancelled} cancelled` : undefined }));
}

/** Filters for the drill-down list opened by tapping a tile; null = tile is informational. */
export function drillFilters(key) { return COUNTERS.find((c) => c.key === key)?.drill ?? null; }

export const STATE_CHIPS = Object.freeze([["pending", "Pending"], ["critical", "Critical"], ["overdue", "Overdue"], ["completed", "Completed"], ["cancelled", "Cancelled"]]);

const SUBJECT_KINDS = ["sales_coordinator", "production_coordinator", "factory", "customer", "job_worker"];
const STATES = STATE_CHIPS.map(([k]) => k);
/** Parse /squad/filtered-orders query. Invalid links return {error} instead of silently showing all orders. */
export function filteredOrdersContext(search = "") {
  const q = new URLSearchParams(search);
  const state = q.get("state"), criteria = q.get("criteria"), kind = q.get("subject_kind"), id = q.get("subject_id");
  const customer = q.get("customer_id"), placed = q.get("placed_for_me");
  if ((customer != null && !/^[1-9]\d{0,18}$/.test(customer)) || (placed != null && placed !== "true")) return { error: "This filter link is not valid." };
  if (state && !STATES.includes(state)) return { error: "This filter link is not valid." };
  if (criteria && !["0", "1"].includes(criteria)) return { error: "This filter link is not valid." };
  if ((kind == null) !== (id == null) || (kind && (!SUBJECT_KINDS.includes(kind) || !/^[1-9]\d{0,18}$/.test(id)))) return { error: "This person link is not valid." };
  return { filters: { ...(state ? { state } : {}), ...(criteria != null ? { criteria: Number(criteria) } : {}), ...(customer != null ? { customer_id: customer } : {}), ...(placed ? { placed_for_me: true } : {}) }, subject: kind ? { kind, id } : null, title: q.get("title")?.slice(0, 60) || "Orders" };
}
export function filteredOrdersHref(drill, { subject, title } = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(drill ?? {})) q.set(k, String(v));
  if (subject) { q.set("subject_kind", subject.kind); q.set("subject_id", String(subject.id)); }
  if (title) q.set("title", title);
  return `/squad/filtered-orders?${q}`;
}

const LIST_KEY = { sales_coordinator: "coordinator_id", production_coordinator: "producer_id", factory: "manager_id", job_worker: "worker_id", customer: "customer_id" };
/** v1_orders_list person filter for a stats subject. production_coordinator uses producer_id (migration 20261121100000). */
export function subjectListFilter(subject) {
  if (!subject) return {};
  const key = LIST_KEY[subject.kind];
  return key ? { [key]: String(subject.id) } : null;
}
