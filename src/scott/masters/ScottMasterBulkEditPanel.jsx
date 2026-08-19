// Bulk-edit mode for one master: the whole dataset in `ScottBulkEditGrid`.
//
// The grid owns the editing session end to end — once it is handed the master's columns and
// its three mutations it runs `batchSave` (deletes, then updates, then sequential creates),
// pushes per-row failures back onto the rows with `applyServerErrors` and toasts
// `summarizeBatchSave` itself. This panel adds only what the grid cannot know about:
//
//   * the DATA — `service.listAll()`, drained with the config's own page-size overrides
//     (rmp_skus 100/page, rmp_prices 1000/page), with loading / empty / error states;
//   * the MUTATIONS — `service.create` / `service.update` / `service.remove`, which run the
//     config's async payload builders, read-merge-write and soft-delete rules for us;
//   * the ROW <-> FORM mapping (`bulkRowToWriteForm`), which re-homes picked image files;
//   * what happens AFTER a clean save — a panel-level `summarizeBatchSave` toast, then back
//     to the list, which refreshes.
//
// A save that fails on some rows keeps the grid open with those rows highlighted; only a
// fully clean save closes it. The grid reconciles itself first, so what stays pending after a
// partial failure is exactly the set of rows that failed — pressing Save again retries those
// and nothing else, and can never re-create a record that already went through. "Reload rows"
// is still there for anyone who would rather start from server truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { summarizeBatchSave } from "@/scott/bulk/bulkSaveService";
import ScottBulkEditGrid from "@/scott/bulk/ui/ScottBulkEditGrid";
import {
  bulkRowIdFor,
  bulkRowToWriteForm,
  createEmptyBulkRow
} from "@/scott/masters/mastersBulkColumns";
import { confirmDiscardBulkEdits } from "@/scott/masters/mastersBulkGuard";

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * @param {object} props
 * @param {object} props.config the master config (already carrying `singularLabel`).
 * @param {object} props.service the master's CRUD service from `getMastersService`.
 * @param {Array<object>} props.columns bulk columns from `bulkColumnsFor`.
 * @param {boolean} [props.columnsLoading] relation option lists are still draining.
 * @param {() => void} props.onClose leave bulk mode (already confirmed by the caller).
 * @param {(result: object) => void} [props.onSaved] fired only after a save with no failures.
 * @param {(message: string) => void} [props.onToast]
 * @param {(error: unknown) => void} [props.onError]
 */
export default function ScottMasterBulkEditPanel({
  config,
  service,
  columns = [],
  columnsLoading = false,
  onClose,
  onSaved,
  onToast,
  onError
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const seqRef = useRef(0);

  const entityName = config?.label || "Records";

  useEffect(() => {
    const seq = (seqRef.current += 1);
    let cancelled = false;
    setLoading(true);
    setError("");

    service
      .listAll()
      .then((data) => {
        if (cancelled || seq !== seqRef.current) return;
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (cancelled || seq !== seqRef.current) return;
        const message = messageOf(err);
        setError(message);
        onError?.(message);
      })
      .finally(() => {
        if (cancelled || seq !== seqRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `onError` is the panel's toast channel and is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, reloadToken]);

  const getRowId = useMemo(() => bulkRowIdFor(config), [config]);

  const createEmptyRow = useCallback(
    () => createEmptyBulkRow(config, columns),
    [config, columns]
  );

  const toWritePayload = useCallback(
    (row) => bulkRowToWriteForm(config, row, columns),
    [config, columns]
  );

  const createMutation = useCallback((form) => service.create(form), [service]);
  const updateMutation = useCallback(({ id, updates }) => service.update(id, updates), [service]);
  const deleteMutation = useCallback((id) => service.remove(id), [service]);

  const handleSaved = useCallback(
    (result) => {
      onToast?.(summarizeBatchSave(result, entityName).message);
      onSaved?.(result);
    },
    [entityName, onSaved, onToast]
  );

  const handleReload = useCallback(() => {
    if (!confirmDiscardBulkEdits()) return;
    setReloadToken((token) => token + 1);
  }, []);

  /**
   * The grid's own Discard button (and Esc) already confirms and then calls `onClose`, so
   * `onClose` must never confirm again — but this button bypasses the grid entirely, so it
   * asks here.
   */
  const handleBack = useCallback(() => {
    if (!confirmDiscardBulkEdits()) return;
    onClose?.();
  }, [onClose]);

  const noColumns = columns.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={handleBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to list
        </Button>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">Bulk edit · {entityName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {loading
              ? "Loading every row from Scott…"
              : `${rows.length.toLocaleString("en-IN")} row${rows.length === 1 ? "" : "s"} loaded · ${config.resource}`}
          </p>
        </div>

        {columnsLoading ? (
          <Badge variant="secondary" className="font-normal">
            Loading dropdown options…
          </Badge>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={handleReload}
          disabled={loading}
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
          Reload rows
        </Button>
      </div>

      {noColumns ? (
        <Alert>
          <AlertDescription>
            {entityName} has no bulk-editable fields — its form is made up of relation lists or
            multi-image slots, which are written one record at a time. Use the row dialog instead.
          </AlertDescription>
        </Alert>
      ) : (
        <ScottBulkEditGrid
          className="min-h-0 flex-1"
          // The panel header above already says "Bulk edit · {master}"; the grid's own strip
          // only needs to name the entity.
          title={entityName}
          columns={columns}
          data={rows}
          loading={loading}
          error={error}
          getRowId={getRowId}
          createEmptyRow={createEmptyRow}
          toCreatePayload={toWritePayload}
          toUpdatePayload={toWritePayload}
          createMutation={createMutation}
          updateMutation={updateMutation}
          deleteMutation={deleteMutation}
          entityName={entityName}
          onClose={onClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
