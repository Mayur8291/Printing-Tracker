// Bulk delete for Scott list pages.
//
// Two strategies, in priority order:
//
//   1. ONE server call — `DELETE {resource}/bulk_delete` with repeated `ids[]` form
//      fields. Only the ten masters in `BULK_DELETE_RESOURCES` expose it in this app
//      (Scott exposes it for many more; the app deliberately uses only these ten).
//      All-or-nothing from the client's point of view: the call either succeeds or
//      throws, there is no per-id result.
//
//   2. Fallback — individual `DELETE {resource}/{id}` calls, run in sequential
//      batches of `DEFAULT_DELETE_BATCH_SIZE` (20) parallel requests, collecting
//      per-id failures instead of aborting the run.
//
// QUIRKS REPRODUCED (do not "fix"):
//   * Scott's delete is a SOFT delete (`is_deleted` flag). Rows come back on a list
//     that passes `is_deleted=true`/`includeInactive`, and bulk-import matching
//     deliberately fetches them so a re-import reactivates instead of colliding.
//     Callers must not assume the record is gone.
//   * `profit_margins` NAMESPACE EXCEPTION: its CRUD lives at `/api/v1/profit_margins`
//     but `bulk_delete` only exists in the dashboard namespace. The edge function
//     special-cases `pathSuffix === "bulk_delete"` for the v1 masters, so this module
//     MUST route through `callScottBulkDelete` (which always sets that pathSuffix).
//     Hand-rolling the call with a different suffix silently 404s. See
//     `supabase/functions/scott-dashboard-masters/index.ts` (V1_MASTERS).
//   * Upstream also accepts `delete_all=true` on `bulk_delete`. The app never sends
//     it — only `ids[]` — and neither do we.

import { callScottBulkDelete, normalizeId } from "../scottClient";

/** Batch size for the individual-delete fallback (20 parallel calls per batch). */
export const DEFAULT_DELETE_BATCH_SIZE = 20;

/**
 * The ten masters wired to the one-call bulk delete endpoint in the original app.
 * Everything else falls back to batched individual deletes.
 */
export const BULK_DELETE_RESOURCES = Object.freeze([
  "parts",
  "profit_margins",
  "rmp_categories",
  "rmp_brands",
  "rmp_skus",
  "rmp_price_types",
  "rmp_sizes",
  "rmp_colors",
  "rmp_prices",
  "rmp_classes"
]);

const BULK_DELETE_RESOURCE_SET = new Set(BULK_DELETE_RESOURCES);

/**
 * Masters whose normal CRUD is routed to `/api/v1/…` by the edge function while
 * `bulk_delete` stays on `/api/dashboard/v1/…`. Kept here purely as documentation +
 * a guard: only `profit_margins` of these three is bulk-delete wired in this app.
 */
export const V1_NAMESPACE_RESOURCES = Object.freeze(["profit_margins", "promotions", "size_types"]);

/**
 * Resources the edge function never attaches a DELETE body to — `ids[]` would be
 * dropped silently, so the one-call path must never be used for them.
 * @see callScottBulkDelete in ../scottClient.js
 */
export const BULK_DELETE_BODY_UNSAFE_RESOURCES = Object.freeze(["base_product_types"]);

/**
 * Does this resource support the single-call `bulk_delete` endpoint in this app?
 * @param {string} resource
 * @returns {boolean}
 */
export function supportsScottBulkDelete(resource) {
  const key = String(resource ?? "");
  if (BULK_DELETE_BODY_UNSAFE_RESOURCES.includes(key)) return false;
  return BULK_DELETE_RESOURCE_SET.has(key);
}

/** Human-readable message from anything a mutation may reject with. */
export function errorMessage(error) {
  if (error instanceof Error) return error.message || "Request failed";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message || "Request failed";
  }
  return "Request failed";
}

/** Dedupe + stringify a caller-supplied id list. */
export function normalizeIdList(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of ids ?? []) {
    const id = normalizeId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Split a list into fixed-size chunks. */
export function chunkList(list, size) {
  const step = Math.max(1, Math.trunc(Number(size) || 1));
  const chunks = [];
  for (let i = 0; i < list.length; i += step) chunks.push(list.slice(i, i + step));
  return chunks;
}

/**
 * The documented one-call bulk delete.
 *
 * @param {string} resource a Scott resource that appears in `BULK_DELETE_RESOURCES`
 * @param {Array<string|number>} ids
 * @returns {Promise<void>} resolves on success, throws on any failure (all-or-nothing)
 */
export async function bulkDeleteScottRecords(resource, ids) {
  const key = String(resource ?? "");
  if (!supportsScottBulkDelete(key)) {
    throw new Error(`Bulk delete is not supported for "${key}"`);
  }
  const list = normalizeIdList(ids);
  if (list.length === 0) return;
  // Always via callScottBulkDelete: it pins `pathSuffix: "bulk_delete"`, which is what
  // makes the edge function keep profit_margins in the dashboard namespace.
  await callScottBulkDelete(key, list);
}

/**
 * Delete many records, preferring the one-call endpoint and falling back to batched
 * individual deletes.
 *
 * @param {Array<string|number>} ids
 * @param {(id: string) => Promise<unknown>} deleteOne per-record delete (used by the fallback)
 * @param {object} [options]
 * @param {number} [options.batchSize=20] parallel deletes per batch in the fallback
 * @param {(ids: string[]) => Promise<unknown>} [options.bulkDeleteAll] the one-call path;
 *   when supplied it is used exclusively and its rejection bubbles up
 * @param {(completed: number, total: number) => void} [options.onProgress] fallback only
 * @returns {Promise<{ deleted: number, failures: Array<{ id: string, error: string }>, mode: "bulk"|"batched" }>}
 */
export async function runBulkDeletes(ids, deleteOne, options = {}) {
  const { batchSize = DEFAULT_DELETE_BATCH_SIZE, bulkDeleteAll, onProgress } = options;
  const list = normalizeIdList(ids);
  if (list.length === 0) return { deleted: 0, failures: [], mode: bulkDeleteAll ? "bulk" : "batched" };

  // --- Strategy 1: one server call. Throws bubble up by design. ---
  if (typeof bulkDeleteAll === "function") {
    await bulkDeleteAll(list);
    try {
      onProgress?.(list.length, list.length);
    } catch {
      /* progress reporting must never break a delete */
    }
    return { deleted: list.length, failures: [], mode: "bulk" };
  }

  if (typeof deleteOne !== "function") {
    throw new Error("runBulkDeletes: deleteOne is required when bulkDeleteAll is not supplied");
  }

  // --- Strategy 2: sequential batches of parallel individual deletes. ---
  const failures = [];
  let deleted = 0;
  let completed = 0;

  for (const batch of chunkList(list, batchSize)) {
    const settled = await Promise.allSettled(batch.map((id) => deleteOne(id)));
    settled.forEach((result, index) => {
      completed += 1;
      if (result.status === "fulfilled") deleted += 1;
      else failures.push({ id: batch[index], error: errorMessage(result.reason) });
    });
    try {
      onProgress?.(completed, list.length);
    } catch {
      /* ignore */
    }
  }

  return { deleted, failures, mode: "batched" };
}

/**
 * Convenience wrapper for a master service built by `createMastersService`.
 * Uses the one-call endpoint when the config declares `supportsBulkDelete`, else the
 * batched fallback over `service.remove`.
 *
 * @param {{ resource: string, config?: { supportsBulkDelete?: boolean }, remove: Function }} service
 * @param {Array<string|number>} ids
 * @param {{ batchSize?: number, onProgress?: Function }} [options]
 */
export async function runMasterBulkDelete(service, ids, options = {}) {
  if (!service) throw new Error("runMasterBulkDelete: service is required");
  const resource = String(service.resource ?? service.config?.resource ?? "");
  const canBulk = Boolean(service.config?.supportsBulkDelete) && supportsScottBulkDelete(resource);

  return runBulkDeletes(ids, (id) => service.remove(id), {
    ...options,
    bulkDeleteAll: canBulk ? (list) => bulkDeleteScottRecords(resource, list) : undefined
  });
}

/**
 * House toast copy for a completed bulk delete.
 * @param {{ deleted: number, failures: Array<{ id: string, error: string }> }} result
 * @param {string} entityPlural e.g. "RMP colours"
 */
export function summarizeBulkDelete(result, entityPlural = "records") {
  const deleted = result?.deleted ?? 0;
  const failures = result?.failures ?? [];
  if (failures.length === 0) return `Deleted ${deleted} ${entityPlural}.`;
  const first = failures[0]?.error ? ` First error: ${failures[0].error}` : "";
  return `Deleted ${deleted}; ${failures.length} failed.${first}`;
}
