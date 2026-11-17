import { isProductionTrackerOrder } from "./orderTabUtils";
import { isSampleJobSheetOrder } from "./sampleJobSheetUtils";
import { sampleJobSheetIsClosed } from "./sampleJobSheetStages";

const NEW_STATUSES = new Set(["new", "quotation_approval"]);
const SOURCING_STATUSES = new Set(["sourcing", "sourcing_in_transit"]);
const PRODUCTION_STATUSES = new Set(["inward", "cutting", "stitching", "trimming", "ironing", "qc"]);

export function filterTrackerJobsBySearch(orders, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return Array.isArray(orders) ? orders : [];
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    const hay = [
      order?.order_id,
      order?.customer_name,
      order?.product_name,
      order?.customer_po_number,
      order?.brand
    ]
      .map((value) => String(value ?? "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
}

function isCancelled(order) {
  return String(order?.status ?? "") === "cancelled";
}

function isDelayed(order, todayIso) {
  if (!order || order.is_complete || isCancelled(order)) return false;
  const due = String(order.due_date ?? "").slice(0, 10);
  return Boolean(due) && due < todayIso;
}

/**
 * Counts for the production tracker. Jobs are production job sheets.
 * Pending samples are open sample job sheets. Cancelled rows are left out.
 */
export function productionTrackerMetrics(orders, todayIso) {
  const list = Array.isArray(orders) ? orders : [];
  const jobs = list.filter((order) => isProductionTrackerOrder(order) && !isCancelled(order));
  const samples = list.filter(
    (order) => isSampleJobSheetOrder(order) && !sampleJobSheetIsClosed(order) && !isCancelled(order)
  );
  const countStatus = (set) =>
    jobs.filter((order) => !order.is_complete && set.has(String(order.status ?? ""))).length;

  return {
    total: jobs.length,
    newJobs: countStatus(NEW_STATUSES),
    inProduction: countStatus(PRODUCTION_STATUSES),
    pendingSamples: samples.length,
    sourcing: countStatus(SOURCING_STATUSES),
    packaging: countStatus(new Set(["packing"])),
    ready: jobs.filter((order) => !order.is_complete && order.status === "ready").length,
    completed: jobs.filter((order) => Boolean(order.is_complete)).length,
    delayed: jobs.filter((order) => isDelayed(order, todayIso)).length
  };
}
