// Save executor for the bulk-edit grid.
//
// There is NO batch create/update endpoint on Scott. A bulk-edit save is N individual
// POST / PATCH / DELETE calls with client-side concurrency, in this exact order:
//
//   Phase 1 — DELETES   parallel, batches of 5
//   Phase 2 — UPDATES   parallel, batches of 5
//   Phase 3 — CREATES   STRICTLY SEQUENTIAL (one at a time)
//
// Creates are sequential on purpose: several masters carry `position` / `sort_position`
// semantics and the insertion order must be preserved. Do not parallelise them.
//
// Note that bulk edit does NOT use the `bulk_delete` endpoint even for masters that
// have one — it deletes one row at a time. Only the list-page bulk bar uses the
// one-call endpoint (see `bulkDeleteService.js`).
//
// This function NEVER throws: every per-row failure is collected as
// `{ rowId, rowKey, operation, error }` and returned in `result.errors`, so the grid
// can stay open and surface the failures inline.
//
// It also reports the other half of the ledger — `result.succeeded`, one
// `{ rowKey, rowId, operation, record }` per row that DID go through. The grid needs it:
// after a partial failure it must retire exactly the rows that were persisted (a create
// that succeeded must never be POSTed a second time) while leaving the failures dirty and
// retryable. See `reconcileRowsAfterSave` in `bulkEditState.js`.

/** Concurrency for phase 1 and phase 2. Phase 3 is always serial. */
export const BULK_SAVE_BATCH_SIZE = 5;

/** Human-readable message from anything a mutation may reject with. */
export function errorMessage(error) {
  if (error instanceof Error) return error.message || "Request failed";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message || "Request failed";
  }
  return "Request failed";
}

function chunk(list, size) {
  const step = Math.max(1, Math.trunc(Number(size) || 1));
  const chunks = [];
  for (let i = 0; i < list.length; i += step) chunks.push(list.slice(i, i + step));
  return chunks;
}

/**
 * Accept both shapes for every phase list:
 *   delete: `"id"`            or `{ id, rowKey }`
 *   update: `{ id, row }`     or `{ id, rowKey, row }`  (also tolerates `updates`)
 *   create: `row`             or `{ rowKey, row }`
 */
function readDeleteEntry(entry) {
  if (entry && typeof entry === "object") {
    return { id: String(entry.id ?? ""), rowKey: entry.rowKey ?? String(entry.id ?? "") };
  }
  return { id: String(entry ?? ""), rowKey: String(entry ?? "") };
}

function readUpdateEntry(entry) {
  const id = String(entry?.id ?? "");
  return { id, rowKey: entry?.rowKey ?? id, row: entry?.row ?? entry?.updates ?? entry };
}

function readCreateEntry(entry) {
  if (entry && typeof entry === "object" && "row" in entry) {
    // `rowId: 'new'` is what the original recorded for every create failure, which made
    // them impossible to tell apart. When a rowKey is supplied we use it instead — the
    // grid relies on that to highlight the right row.
    return { rowKey: entry.rowKey ?? "new", row: entry.row };
  }
  return { rowKey: "new", row: entry };
}

/**
 * Run one bulk-edit save.
 *
 * @param {object} params
 * @param {Array} [params.toCreate] rows (or `{rowKey,row}`) to POST — run sequentially
 * @param {Array} [params.toUpdate] `{id,row}` (or `{id,rowKey,row}`) to PATCH
 * @param {Array} [params.toDelete] ids (or `{id,rowKey}`) to DELETE
 * @param {(row: object) => Promise<unknown>} [params.createMutation]
 * @param {(args: { id: string, updates: object }) => Promise<unknown>} [params.updateMutation]
 * @param {(id: string) => Promise<unknown>} [params.deleteMutation]
 * @param {string} [params.entityName="Records"] used by `summarizeBatchSave`
 * @param {(completed: number, total: number) => void} [params.onProgress] fires after EACH row
 * @param {number} [params.batchSize=5] concurrency for deletes and updates
 * @returns {Promise<{ created:number, updated:number, deleted:number, failed:number,
 *   errors: Array<{ rowId: string, rowKey: string, operation: "create"|"update"|"delete", error: string }>,
 *   succeeded: Array<{ rowId: string, rowKey: string, operation: "create"|"update"|"delete", record: unknown }> }>}
 */
export async function batchSave({
  toCreate = [],
  toUpdate = [],
  toDelete = [],
  createMutation,
  updateMutation,
  deleteMutation,
  entityName = "Records",
  onProgress,
  batchSize = BULK_SAVE_BATCH_SIZE
} = {}) {
  const deletes = (toDelete ?? []).map(readDeleteEntry);
  const updates = (toUpdate ?? []).map(readUpdateEntry);
  const creates = (toCreate ?? []).map(readCreateEntry);

  const total = deletes.length + updates.length + creates.length;
  const errors = [];
  const succeeded = [];
  let completed = 0;
  let created = 0;
  let updated = 0;
  let deleted = 0;

  const bump = () => {
    completed += 1;
    try {
      onProgress?.(completed, total);
    } catch {
      /* progress reporting must never break a save */
    }
  };

  /** Runs one mutation, converting any rejection into a collected error. Never throws. */
  async function runOne(operation, entry, invoke) {
    try {
      const record = await invoke();
      succeeded.push({
        rowId: entry.id ?? "new",
        rowKey: entry.rowKey,
        operation,
        record
      });
      return true;
    } catch (error) {
      errors.push({
        rowId: entry.id ?? "new",
        rowKey: entry.rowKey,
        operation,
        error: errorMessage(error)
      });
      return false;
    } finally {
      bump();
    }
  }

  // --- Phase 1: deletes, parallel batches of `batchSize` -------------------
  if (deletes.length > 0) {
    if (typeof deleteMutation !== "function") {
      for (const entry of deletes) {
        errors.push({
          rowId: entry.id,
          rowKey: entry.rowKey,
          operation: "delete",
          error: "No delete mutation configured"
        });
        bump();
      }
    } else {
      for (const batch of chunk(deletes, batchSize)) {
        const results = await Promise.all(
          batch.map((entry) => runOne("delete", entry, () => deleteMutation(entry.id)))
        );
        deleted += results.filter(Boolean).length;
      }
    }
  }

  // --- Phase 2: updates, parallel batches of `batchSize` -------------------
  if (updates.length > 0) {
    if (typeof updateMutation !== "function") {
      for (const entry of updates) {
        errors.push({
          rowId: entry.id,
          rowKey: entry.rowKey,
          operation: "update",
          error: "No update mutation configured"
        });
        bump();
      }
    } else {
      for (const batch of chunk(updates, batchSize)) {
        const results = await Promise.all(
          batch.map((entry) =>
            runOne("update", entry, () => updateMutation({ id: entry.id, updates: entry.row }))
          )
        );
        updated += results.filter(Boolean).length;
      }
    }
  }

  // --- Phase 3: creates, STRICTLY SEQUENTIAL to preserve insertion order ---
  if (creates.length > 0) {
    if (typeof createMutation !== "function") {
      for (const entry of creates) {
        errors.push({
          rowId: "new",
          rowKey: entry.rowKey,
          operation: "create",
          error: "No create mutation configured"
        });
        bump();
      }
    } else {
      for (const entry of creates) {
        // eslint-disable-next-line no-await-in-loop -- sequential is the requirement
        const ok = await runOne("create", entry, () => createMutation(entry.row));
        if (ok) created += 1;
      }
    }
  }

  return { created, updated, deleted, failed: errors.length, errors, succeeded };
}

/**
 * House toast copy for a finished save.
 * @param {{created:number,updated:number,deleted:number,failed:number}} result
 * @param {string} entityName
 * @returns {{ message: string, tone: "success"|"error" }}
 */
export function summarizeBatchSave(result, entityName = "Records") {
  const created = result?.created ?? 0;
  const updated = result?.updated ?? 0;
  const deleted = result?.deleted ?? 0;
  const failed = result?.failed ?? 0;

  const parts = [];
  if (created) parts.push(`${created} created`);
  if (updated) parts.push(`${updated} updated`);
  if (deleted) parts.push(`${deleted} deleted`);
  const detail = parts.length ? parts.join(", ") : "no changes";

  if (failed > 0) {
    return {
      tone: "error",
      message: `${entityName} bulk edit had ${failed} error${failed === 1 ? "" : "s"} · ${detail}. Check highlighted rows.`
    };
  }
  return { tone: "success", message: `${entityName} bulk edit saved · ${detail}.` };
}

export default batchSave;
