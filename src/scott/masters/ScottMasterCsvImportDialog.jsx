// CSV import for one master — `ScottCsvImportDialog` wired to that master's config.
//
// TWO PATHS, chosen by the config alone:
//
//   CLIENT UPSERT (21 masters)
//     Rows are matched against `service.listAllForImport()` — the drain variant that also
//     returns SOFT-DELETED rows, so re-importing a bulk-deleted record classifies as an
//     update (reactivation) instead of colliding on create — then executed one row at a time
//     through `service.create` / `service.update` by `runCsvImport`.
//
//   SERVER UPLOAD (`rmp_prices` only — it is the one config that declares `bulkUpload`)
//     The whole CSV goes to Scott in a single `bulk_upload` POST and the client polls
//     `bulk_upload_status` every 2s for up to 30 minutes (`runRmpPricesBulkImport`). No
//     per-row calls, no client-side matching — Scott owns both. `replace_all` (the dialog's
//     "Replace all existing prices" checkbox) is DESTRUCTIVE and is surfaced as such there.
//
// RELATION COLUMNS ARE PLAIN TEXT ON THE SERVER PATH.
//   Scott resolves `rmp_sku` / `rmp_price_type` itself, so validating those cells against a
//   locally drained option list would (a) force a full `rmp_skus` drain before the user can
//   even pick a file and (b) reject rows Scott would happily accept. `relationsAsText` keeps
//   the local pass to shape/required checks, which is all the server path needs.

import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { runRmpPricesBulkImport } from "@/scott/bulk/rmpPricesBulkUpload";
import ScottCsvImportDialog from "@/scott/bulk/ui/ScottCsvImportDialog";
import {
  bulkColumnsFor,
  bulkFilenameStem,
  bulkMatchEnumKeysByValueId,
  bulkRelationResourcesFor,
  bulkRowIdFor,
  bulkRowToWriteForm,
  createEmptyBulkRow,
  defaultBulkMatchKeys,
  usesServerBulkUpload
} from "@/scott/masters/mastersBulkColumns";

const TERMINAL_PHASES = new Set(["completed", "failed"]);

const PHASE_LABELS = Object.freeze({
  idle: "Waiting for Scott",
  pending: "Queued on Scott",
  processing: "Processing on Scott",
  completed: "Completed",
  failed: "Failed"
});

/**
 * Live polling readout for the server upload. Fixed and above the dialog (`z-[110]` vs the
 * dialog's `z-50`), because the only place the poll result can usefully be read while the
 * modal is open is on top of it. Unmounts as soon as the job reaches a terminal phase.
 */
function ServerUploadStatusStrip({ status }) {
  if (!status || TERMINAL_PHASES.has(status.phase)) return null;
  const pct = Math.max(0, Math.min(100, Number(status.progress) || 0));

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[110] w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-background p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{PHASE_LABELS[status.phase] ?? "Uploading"}</span>
        <Badge variant="secondary" className="ml-auto font-normal tabular-nums">
          {pct}%
        </Badge>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs tabular-nums text-muted-foreground">
        {status.total > 0
          ? `${(status.processed ?? 0).toLocaleString("en-IN")} / ${status.total.toLocaleString("en-IN")} rows`
          : "Polling every 2s…"}
        {status.failed > 0 ? ` · ${status.failed.toLocaleString("en-IN")} failed` : ""}
      </p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.config master config (already carrying `singularLabel`).
 * @param {object} props.service the master's CRUD service.
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {Record<string, {options?: Array<{value:string,label:string}>}>} [props.optionsByResource]
 * @param {boolean} [props.optionsLoading]
 * @param {(result: object) => void} [props.onComplete] fired with the import/upload result.
 */
export default function ScottMasterCsvImportDialog({
  config,
  service,
  open,
  onOpenChange,
  optionsByResource = {},
  optionsLoading = false,
  onComplete
}) {
  const serverMode = usesServerBulkUpload(config);
  const [status, setStatus] = useState(null);

  const columns = useMemo(
    () => bulkColumnsFor(config, optionsByResource, { relationsAsText: serverMode, serverUpload: serverMode }),
    [config, optionsByResource, serverMode]
  );

  // Only block the upload step while options a column actually needs are still draining.
  const columnsLoading =
    optionsLoading && bulkRelationResourcesFor(config, { relationsAsText: serverMode }).length > 0;

  const getRowId = useMemo(() => bulkRowIdFor(config), [config]);
  const createEmptyRow = useCallback(() => createEmptyBulkRow(config, columns), [config, columns]);
  const toWritePayload = useCallback((row) => bulkRowToWriteForm(config, row, columns), [config, columns]);

  const createMutation = useCallback((form) => service.create(form), [service]);
  const updateMutation = useCallback(({ id, updates }) => service.update(id, updates), [service]);
  const fetchAll = useCallback(() => service.listAllForImport(), [service]);

  const serverBulkImport = useMemo(() => {
    if (!serverMode) return undefined;
    return {
      importFile: (file, options = {}) =>
        runRmpPricesBulkImport(file, {
          signal: options.signal,
          replaceAll: options.replaceAll === true,
          onProgress: (next) => setStatus(next)
        })
    };
  }, [serverMode]);

  const handleOpenChange = useCallback(
    (next) => {
      if (!next) setStatus(null);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const handleComplete = useCallback(
    (result) => {
      setStatus(null);
      onComplete?.(result);
    },
    [onComplete]
  );

  return (
    <>
      <ScottCsvImportDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={serverMode ? `Bulk upload ${config.label}` : `Import ${config.label} from CSV`}
        filenameStem={bulkFilenameStem(config)}
        columns={columns}
        columnsLoading={columnsLoading}
        createEmptyRow={createEmptyRow}
        toCreatePayload={toWritePayload}
        toUpdatePayload={toWritePayload}
        getRowId={getRowId}
        createMutation={createMutation}
        updateMutation={updateMutation}
        fetchAll={serverMode ? undefined : fetchAll}
        defaultKeyFields={defaultBulkMatchKeys(config)}
        matchEnumKeysByValueId={bulkMatchEnumKeysByValueId(config)}
        serverBulkImport={serverBulkImport}
        onComplete={handleComplete}
      />
      {open ? <ServerUploadStatusStrip status={status} /> : null}
    </>
  );
}
