// Server-side CSV bulk upload — RMP Prices only.
//
// The whole CSV is POSTed to Scott, Scott processes it asynchronously, and the client
// polls a status endpoint until the job reaches a terminal phase.
//
//   POST /api/dashboard/v1/rmp_prices/bulk_upload      multipart: file, replace_all
//   GET  /api/dashboard/v1/rmp_prices/bulk_upload_status
//
// There is ONE global job — no job id is passed, and no other resource has a bulk
// upload endpoint.
//
// Polling: every 2 s, timeout 30 min. An `idle` status is IGNORED on the first poll
// (the job may not have registered upstream yet) and only treated as "finished" from
// poll #2 onwards — `minPollsBeforeIdleTerminal: 2`.
//
// `replace_all=true` is DESTRUCTIVE: Scott deletes every existing RMP price and then
// imports the CSV from scratch. The UI must treat it as such.
//
// The status normaliser is deliberately tolerant: the upstream keys drift between
// deploys, so every documented alias is accepted. See `statusAliases` on
// `rmpPricesConfig.bulkUpload` in `src/scott/data/masterConfigs.rmp.js` — this module
// reads that table when it is present and falls back to the local copy below otherwise.

import { callScottDashboard, extractScottEntity, fileToScottPayload } from "../scottClient";
import { rmpPricesConfig } from "../data/masterConfigs.rmp";

export const RMP_PRICES_RESOURCE = "rmp_prices";
export const RMP_PRICES_BULK_UPLOAD_PATH = "bulk_upload";
export const RMP_PRICES_BULK_UPLOAD_STATUS_PATH = "bulk_upload_status";

/** Poll cadence and ceiling. */
export const RMP_PRICES_POLL_INTERVAL_MS = 2000;
export const RMP_PRICES_POLL_TIMEOUT_MS = 30 * 60 * 1000;
/** `idle` is ignored until this many polls have come back. */
export const RMP_PRICES_MIN_POLLS_BEFORE_IDLE_TERMINAL = 2;

/** Terminal phases. Everything else keeps the poll loop alive. */
export const TERMINAL_PHASES = Object.freeze(["completed", "failed"]);

/** Local fallback for the alias table declared on the master config. */
const LOCAL_STATUS_ALIASES = Object.freeze({
  phase: ["status", "state", "job_status", "upload_status"],
  total: ["total", "total_rows", "count", "row_count"],
  processed: ["processed", "processed_rows", "completed", "completed_rows", "imported"],
  created: ["created", "created_count", "inserted", "inserted_count"],
  updated: ["updated", "updated_count"],
  failed: ["failed", "failed_count", "errors_count", "failure_count"],
  skipped: ["skipped", "skipped_count"],
  progress: ["progress", "percentage", "percent"],
  failures: ["failures", "errors", "error_rows", "failed_rows"],
  failureRowNumber: ["row", "row_number", "line", "line_number"]
});

/** The full phase alias table. First match wins, longest-lived synonyms included. */
const PHASE_ALIASES = Object.freeze({
  completed: ["completed", "complete", "success", "successful", "succeeded", "done", "finished", "ok"],
  failed: ["failed", "failure", "error", "errored", "aborted"],
  idle: ["idle", "none", "not_found", "notfound", "no_job", "unknown"],
  pending: ["pending", "queued", "waiting", "starting", "scheduled", "enqueued"],
  processing: ["processing", "in_progress", "inprogress", "running", "started", "working"]
});

function bulkUploadSpec() {
  return rmpPricesConfig?.bulkUpload ?? {};
}

function statusAliases() {
  return bulkUploadSpec().statusAliases ?? LOCAL_STATUS_ALIASES;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** First alias present on the object (regardless of value). */
function pickAlias(source, aliases = []) {
  for (const key of aliases) {
    if (isPlainObject(source) && source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function pickNumber(source, aliases = []) {
  const raw = pickAlias(source, aliases);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalise any upstream phase string into one of the five canonical phases. */
export function normalizeBulkUploadPhase(raw) {
  const text = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return undefined;
  for (const [phase, aliases] of Object.entries(PHASE_ALIASES)) {
    if (aliases.includes(text)) return phase;
  }
  return undefined;
}

/** Unwrap the many envelopes Scott wraps a status body in. */
function unwrapStatusBody(body) {
  if (!isPlainObject(body)) return {};
  const aliases = statusAliases();

  const candidates = [body, body.data, body.data?.bulk_upload, body.data?.status, body.bulk_upload];
  for (const candidate of candidates) {
    if (!isPlainObject(candidate)) continue;
    const hasPhase = pickAlias(candidate, aliases.phase) !== undefined;
    const hasNumbers =
      pickAlias(candidate, aliases.total) !== undefined ||
      pickAlias(candidate, aliases.processed) !== undefined ||
      pickAlias(candidate, aliases.created) !== undefined;
    if (hasPhase || hasNumbers) return candidate;
  }

  // Last resort — the deep record scan used everywhere else in this codebase.
  const entity = extractScottEntity(body);
  return isPlainObject(entity) ? entity : (isPlainObject(body.data) ? body.data : body);
}

/** Normalise a single failure entry: a bare string, or `{row?, message?}`. */
function normalizeFailure(item, aliases) {
  if (typeof item === "string") return { rowNumber: undefined, message: item };
  if (!isPlainObject(item)) return { rowNumber: undefined, message: String(item ?? "") };
  const rowRaw = pickAlias(item, aliases.failureRowNumber ?? LOCAL_STATUS_ALIASES.failureRowNumber);
  const rowNumber = rowRaw === undefined ? undefined : Number(rowRaw);
  const message = String(item.message ?? item.error ?? item.reason ?? "").trim() || "Row failed";
  return { rowNumber: Number.isFinite(rowNumber) ? rowNumber : undefined, message };
}

/**
 * Tolerant status parser.
 *
 * @param {unknown} body raw response body from upload or status
 * @returns {{ phase: "idle"|"pending"|"processing"|"completed"|"failed",
 *   total:number, processed:number, created:number, updated:number, failed:number,
 *   skipped:number, progress:number,
 *   failures: Array<{rowNumber?:number,message:string}>, message:string, raw:unknown }}
 */
export function parseRmpPricesBulkUploadStatus(body) {
  const aliases = statusAliases();
  const source = unwrapStatusBody(body);

  let phase = normalizeBulkUploadPhase(pickAlias(source, aliases.phase)) ?? "processing";

  // A bare `success` boolean upgrades an otherwise non-terminal phase.
  const success = source?.success;
  if (phase === "processing") {
    if (success === true || success === "true") phase = "completed";
    else if (success === false || success === "false") phase = "failed";
  }

  const total = pickNumber(source, aliases.total) ?? 0;
  const processed = pickNumber(source, aliases.processed) ?? 0;
  const created = pickNumber(source, aliases.created) ?? 0;
  const updated = pickNumber(source, aliases.updated) ?? 0;
  const failed = pickNumber(source, aliases.failed) ?? 0;
  const skipped = pickNumber(source, aliases.skipped) ?? 0;

  const explicitProgress = pickNumber(source, aliases.progress);
  const derived = total > 0 ? Math.round((processed / total) * 100) : 0;
  const progress = Math.max(0, Math.min(100, explicitProgress ?? derived));

  const rawFailures = pickAlias(source, aliases.failures);
  const failures = Array.isArray(rawFailures)
    ? rawFailures.map((item) => normalizeFailure(item, aliases))
    : [];

  const message = String(source?.message ?? source?.error ?? "").trim();

  return { phase, total, processed, created, updated, failed, skipped, progress, failures, message, raw: body };
}

/**
 * Convert a terminal status into the same result shape the client-side importer returns,
 * padding the failure list with generic entries when `failed` exceeds the enumerated ones.
 */
export function toBulkUploadSaveResult(status) {
  const failures = [...(status?.failures ?? [])].map((failure) => ({
    rowNumber: failure.rowNumber,
    error: failure.message,
    raw: {}
  }));

  const failedCount = status?.failed ?? 0;
  while (failures.length < failedCount) {
    failures.push({ rowNumber: undefined, error: "Row failed on Scott (no detail returned)", raw: {} });
  }

  return {
    created: status?.created ?? 0,
    updated: status?.updated ?? 0,
    skipped: status?.skipped ?? 0,
    failed: failedCount,
    total: status?.total ?? 0,
    aborted: false,
    failures
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Import cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Import cancelled"));
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/** POST the CSV. Returns the parsed status carried by the upload response. */
export async function uploadRmpPricesCsv(file, { replaceAll = false } = {}) {
  const spec = bulkUploadSpec();
  const filePayload = await fileToScottPayload(file);
  const buildBody =
    typeof spec.buildBody === "function"
      ? spec.buildBody
      : (payload, options) => ({ file: payload, replace_all: options?.replaceAll ? "true" : "false" });

  const { body } = await callScottDashboard({
    resource: RMP_PRICES_RESOURCE,
    method: spec.method ?? "POST",
    pathSuffix: spec.pathSuffix ?? RMP_PRICES_BULK_UPLOAD_PATH,
    body: buildBody(filePayload, { replaceAll })
  });

  return parseRmpPricesBulkUploadStatus(body);
}

/** GET the (single, global) job status. */
export async function fetchRmpPricesBulkUploadStatus() {
  const spec = bulkUploadSpec().status ?? {};
  const { body } = await callScottDashboard({
    resource: RMP_PRICES_RESOURCE,
    method: spec.method ?? "GET",
    pathSuffix: spec.pathSuffix ?? RMP_PRICES_BULK_UPLOAD_STATUS_PATH
  });
  return parseRmpPricesBulkUploadStatus(body);
}

/**
 * Upload a CSV and poll until the job finishes.
 *
 * @param {File} file the CSV
 * @param {object} [options]
 * @param {boolean} [options.replaceAll=false] DESTRUCTIVE — delete every price, then import
 * @param {AbortSignal} [options.signal] cancels the poll sleep and throws `Import cancelled`
 * @param {(status: object) => void} [options.onProgress] called with every parsed status
 * @param {number} [options.intervalMs=2000]
 * @param {number} [options.timeoutMs=1800000]
 * @param {number} [options.minPollsBeforeIdleTerminal=2]
 * @param {() => Promise<object>} [options.pollStatus] injectable for tests
 * @returns {Promise<ReturnType<typeof toBulkUploadSaveResult>>}
 * @throws on a terminal `failed` phase, on timeout, or on cancellation
 */
export async function runRmpPricesBulkImport(file, options = {}) {
  const poll = bulkUploadSpec().poll ?? {};
  const {
    replaceAll = false,
    signal,
    onProgress,
    intervalMs = poll.intervalMs ?? RMP_PRICES_POLL_INTERVAL_MS,
    timeoutMs = poll.timeoutMs ?? RMP_PRICES_POLL_TIMEOUT_MS,
    minPollsBeforeIdleTerminal = poll.minPollsBeforeIdleTerminal ?? RMP_PRICES_MIN_POLLS_BEFORE_IDLE_TERMINAL,
    uploadFile = uploadRmpPricesCsv,
    pollStatus = fetchRmpPricesBulkUploadStatus
  } = options;

  const report = (status) => {
    try {
      onProgress?.(status);
    } catch {
      /* ignore */
    }
  };

  // 1. Upload. The response may already be terminal.
  const uploaded = await uploadFile(file, { replaceAll });
  report(uploaded);
  if (uploaded.phase === "completed") return toBulkUploadSaveResult(uploaded);
  if (uploaded.phase === "failed") {
    throw new Error(uploaded.message || "Scott rejected the bulk upload");
  }

  // 2. Poll until terminal.
  const startedAt = Date.now();
  let polls = 0;

  for (;;) {
    if (signal?.aborted) throw new Error("Import cancelled");
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Bulk upload timed out after 30 minutes. Check the RMP Prices list for partial results.");
    }

    await sleep(intervalMs, signal);
    polls += 1;

    const status = await pollStatus();
    report(status);

    if (status.phase === "completed") return toBulkUploadSaveResult(status);
    if (status.phase === "failed") {
      throw new Error(status.message || "Bulk upload failed on Scott");
    }
    // `idle` before the job registers upstream is meaningless — ignore it on poll #1.
    if (status.phase === "idle" && polls >= minPollsBeforeIdleTerminal) {
      return toBulkUploadSaveResult(status);
    }
  }
}

export default runRmpPricesBulkImport;
