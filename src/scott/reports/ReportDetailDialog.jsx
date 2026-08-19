// Row detail for the reports that expose a `fetchById` (Tailor, Custom Order, RMP Order).
//
// Reports are read-only, so this is a viewer, not a form: it re-fetches the single record
// (Scott's show endpoints return fields the list endpoints omit) and renders it as a
// definition list. The clicked row is shown immediately as a fallback so the dialog is
// never blank while the detail request is in flight.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EMPTY_REPORT_CELL, getReportCellValue } from "@/scott/data/reports/reportShared";

/** Keys already shown by a column, so "Additional fields" does not repeat them. */
function coveredKeys(columns) {
  const keys = new Set();
  for (const column of columns ?? []) {
    for (const key of column?.keys ?? []) keys.add(String(key));
  }
  return keys;
}

/** Scalar leftovers worth showing under the mapped columns. */
function extraFields(record, columns) {
  if (!record || typeof record !== "object") return [];
  const covered = coveredKeys(columns);
  const out = [];
  for (const [key, value] of Object.entries(record)) {
    if (covered.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue; // nested payloads are noise in a viewer
    out.push([key, String(value)]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

function FieldRow({ label, value }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value}</dd>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {object|null} props.row the clicked list row (the immediate fallback).
 * @param {Array<object>} props.columns report column defs.
 * @param {(id: unknown) => Promise<object|null>} [props.fetchById]
 * @param {string} [props.title]
 * @param {string} [props.idField="id"]
 */
export default function ReportDetailDialog({
  open,
  onOpenChange,
  row,
  columns = [],
  fetchById,
  title = "Report detail",
  idField = "id"
}) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const rowId = row?.[idField] ?? row?.id ?? null;

  useEffect(() => {
    if (!open) {
      setRecord(null);
      setError("");
      setLoading(false);
      return undefined;
    }
    if (typeof fetchById !== "function" || rowId == null || rowId === "") {
      setRecord(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const detail = await fetchById(rowId);
        if (cancelled) return;
        setRecord(detail ?? null);
      } catch (err) {
        if (cancelled) return;
        setRecord(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Detail wins where it has a value; the list row backfills what the show endpoint omits.
  const merged = record ? { ...(row ?? {}), ...record } : (row ?? null);
  const extras = extraFields(merged, columns);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {rowId != null && rowId !== "" ? `Record #${rowId}` : "Read-only report record."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-destructive/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : null}

        {loading && !merged ? (
          <div className="space-y-3 py-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`detail-skeleton-${index}`} className="grid gap-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full max-w-sm" />
              </div>
            ))}
          </div>
        ) : !merged ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing to show for this record.</p>
        ) : (
          <ScrollArea className="min-h-0 flex-1 pr-3">
            {loading ? (
              <p className="pb-2 text-xs text-muted-foreground">Refreshing from Scott…</p>
            ) : null}

            <dl className="divide-y">
              {(columns ?? []).map((column) => (
                <FieldRow
                  key={column.label}
                  label={column.label}
                  value={getReportCellValue(merged, column) || EMPTY_REPORT_CELL}
                />
              ))}
            </dl>

            {extras.length > 0 ? (
              <>
                <Separator className="my-4" />
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Additional fields
                </p>
                <dl className="divide-y">
                  {extras.map(([key, value]) => (
                    <FieldRow key={key} label={key} value={value} />
                  ))}
                </dl>
              </>
            ) : null}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
