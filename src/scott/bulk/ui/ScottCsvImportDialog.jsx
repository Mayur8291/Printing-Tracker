// 4-step CSV import wizard: upload -> configure -> review -> complete.
//
// Driven by the same column configs as the bulk-edit grid. Two modes:
//   * CLIENT UPSERT (default) — rows are matched against existing records and executed
//     as individual create/update calls with tiered concurrency (20 / 40 / 80).
//   * SERVER UPLOAD (`serverBulkImport` prop, RMP Prices only) — the whole CSV is posted
//     to Scott and the client polls a status endpoint. The configure step still runs so
//     the file can be validated locally before it is shipped, but matching is Scott's job.
//
// This repo has no `Progress`, `RadioGroup` or `Command` component, so the progress bar
// is two divs and the strategy picker is the house segmented-control (Buttons in a
// bordered strip) — both are documented shadcn-compatible patterns for this codebase.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  IMPORT_STRATEGIES,
  LARGE_IMPORT_WARNING_THRESHOLD,
  buildDuplicatesCsv,
  buildErrorsCsv,
  buildExistingIndex,
  buildFailuresCsv,
  buildReferenceValuesCsv,
  buildTemplateCsv,
  classifyParsedRows,
  csvTimestamp,
  downloadCsv,
  keyEligibleColumns,
  parseCsvFileText,
  resolveDefaultMatchKeys,
  resolveImportConcurrency,
  runCsvImport,
  summarizeImport
} from "../csvImportService";

const STEPS = [
  { id: "upload", label: "Upload" },
  { id: "configure", label: "Match" },
  { id: "review", label: "Review" },
  { id: "complete", label: "Done" }
];

const HEAD = "h-9 whitespace-nowrap px-3 text-xs font-medium text-muted-foreground";
const CELL = "px-3 py-2 align-middle text-xs";

/** Two-div progress bar — this repo ships no `Progress` component. */
function ProgressBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct}>
      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StepRail({ current }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, i) => (
        <span key={step.id} className="flex items-center gap-2">
          <Badge
            variant={i === index ? "default" : i < index ? "secondary" : "outline"}
            className="font-normal"
          >
            {i + 1}. {step.label}
          </Badge>
          {i < STEPS.length - 1 ? <span className="text-muted-foreground">·</span> : null}
        </span>
      ))}
    </div>
  );
}

function SummaryBadge({ tone = "outline", children }) {
  return (
    <Badge variant={tone} className="font-normal">
      {children}
    </Badge>
  );
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 5) return "";
  if (seconds < 60) return `~${Math.round(seconds)}s remaining`;
  return `~${Math.round(seconds / 60)} min remaining`;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {string} [props.title]
 * @param {string} [props.filenameStem="import"] e.g. "rmp-brands" -> rmp-brands-template.csv
 * @param {Array<object>} props.columns bulk-edit column configs
 * @param {boolean} [props.columnsLoading] blocks upload while enum options load
 * @param {() => object} [props.createEmptyRow]
 * @param {(row: object) => object} [props.toCreatePayload]
 * @param {(row: object) => object} [props.toUpdatePayload]
 * @param {(row: object) => string} [props.getRowId]
 * @param {(payload: object) => Promise<unknown>} [props.createMutation]
 * @param {(args: {id: string, updates: object}) => Promise<unknown>} [props.updateMutation]
 * @param {() => Promise<object[]>} [props.fetchAll] existing rows for matching
 * @param {(rows: object[]) => Promise<object[]>} [props.fetchAllForMatching] targeted alternative
 * @param {string[]} [props.defaultKeyFields]
 * @param {boolean} [props.matchEnumKeysByValueId] match enum keys by resolved id, not display name
 * @param {{ importFile: (file: File, opts: object) => Promise<object> }} [props.serverBulkImport]
 * @param {(result: object) => void} [props.onComplete]
 */
export default function ScottCsvImportDialog({
  open,
  onOpenChange,
  title = "Bulk import",
  filenameStem = "import",
  columns = [],
  columnsLoading = false,
  createEmptyRow = () => ({}),
  toCreatePayload = (row) => row,
  toUpdatePayload = (row) => row,
  getRowId = (row) => String(row?.id ?? ""),
  createMutation,
  updateMutation,
  fetchAll,
  fetchAllForMatching,
  defaultKeyFields,
  matchEnumKeysByValueId = false,
  serverBulkImport,
  onComplete
}) {
  const serverMode = Boolean(serverBulkImport?.importFile);
  const safeColumns = useMemo(() => (Array.isArray(columns) ? columns.filter((c) => c?.key) : []), [columns]);
  const eligible = useMemo(() => keyEligibleColumns(safeColumns), [safeColumns]);

  const [step, setStep] = useState("upload");
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [keys, setKeys] = useState([]);
  const [strategy, setStrategy] = useState("update");
  const [existingRows, setExistingRows] = useState([]);
  const [matching, setMatching] = useState(false);
  const [classified, setClassified] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, startedAt: 0 });
  const [result, setResult] = useState(null);
  const [replaceAll, setReplaceAll] = useState(false);
  const [error, setError] = useState("");

  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const abortControllerRef = useRef(null);

  const resetAll = useCallback(() => {
    setStep("upload");
    setFile(null);
    setParsed(null);
    setKeys(resolveDefaultMatchKeys(safeColumns, defaultKeyFields));
    setStrategy("update");
    setExistingRows([]);
    setClassified(null);
    setResult(null);
    setReplaceAll(false);
    setError("");
    setProgress({ completed: 0, total: 0, startedAt: 0 });
    abortRef.current = false;
  }, [safeColumns, defaultKeyFields]);

  // Reset when the dialog opens — deliberately keyed on `open` alone so a parent that
  // passes `columns={[...]}` inline (a new array every render) cannot loop the reset.
  useEffect(() => {
    if (open) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- Step 1: parse ------------------------------------------------------

  const processFile = useCallback(
    async (nextFile) => {
      if (!nextFile) return;
      setParsing(true);
      setError("");
      try {
        const text = await nextFile.text();
        const output = await parseCsvFileText(text, safeColumns, { createEmptyRow });
        setParsed(output);
        setStep("configure");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
      }
    },
    [safeColumns, createEmptyRow]
  );

  // Enum options that finish loading AFTER the file was uploaded must trigger a re-parse,
  // so enum cells re-validate against the populated options instead of failing. Keyed on
  // a stable signature rather than on `processFile`'s identity, which would otherwise
  // re-parse on every render when the parent passes inline props.
  const enumOptionsSignature = useMemo(
    () => safeColumns.map((column) => `${column.key}:${column.options?.length ?? 0}`).join("|"),
    [safeColumns]
  );
  const reparseSignatureRef = useRef(enumOptionsSignature);

  useEffect(() => {
    if (!file || columnsLoading || !parsed) return;
    if (reparseSignatureRef.current === enumOptionsSignature) return;
    reparseSignatureRef.current = enumOptionsSignature;
    processFile(file);
  }, [enumOptionsSignature, file, columnsLoading, parsed, processFile]);

  function handleFilePicked(event) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setFile(picked);
    processFile(picked);
  }

  // ---- Step 2: configure --------------------------------------------------

  const runMatching = useCallback(async () => {
    if (!parsed) return;
    setMatching(true);
    setError("");
    try {
      let rows = [];
      if (!serverMode && strategy !== "create_new") {
        if (typeof fetchAllForMatching === "function") {
          rows = (await fetchAllForMatching(parsed.rows.map((row) => row.data))) ?? [];
        } else if (typeof fetchAll === "function") {
          // NB: services expose a bulk-import variant that fetches SOFT-DELETED rows too
          // (`listAllForImport`), so a previously bulk-deleted record classifies as an
          // update (reactivation) instead of colliding on create. Pass that one in.
          rows = (await fetchAll()) ?? [];
        }
      }
      setExistingRows(rows);
      const { index } = buildExistingIndex(rows, keys, safeColumns, { matchEnumKeysByValueId });
      setClassified(
        classifyParsedRows(parsed.rows, index, {
          strategy: serverMode ? "create_new" : strategy,
          keys,
          columns: safeColumns,
          matchEnumKeysByValueId
        })
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMatching(false);
    }
  }, [parsed, serverMode, strategy, fetchAll, fetchAllForMatching, keys, safeColumns, matchEnumKeysByValueId]);

  // ---- Step 4: commit -----------------------------------------------------

  const confirmImport = useCallback(async () => {
    if (!classified) return;
    setImporting(true);
    setError("");
    abortRef.current = false;
    const startedAt = Date.now();
    setProgress({ completed: 0, total: 0, startedAt });

    let outcome = null;
    try {
      if (serverMode) {
        abortControllerRef.current = new AbortController();
        outcome = await serverBulkImport.importFile(file, {
          signal: abortControllerRef.current.signal,
          replaceAll
        });
        setResult(outcome);
      } else {
        outcome = await runCsvImport({
          rows: classified.rows,
          columns: safeColumns,
          keys,
          strategy,
          existingRows,
          fetchExisting: typeof fetchAll === "function" ? fetchAll : undefined,
          createMutation,
          updateMutation,
          toCreatePayload,
          toUpdatePayload,
          getRowId,
          matchEnumKeysByValueId,
          onProgress: (completed, total) => setProgress({ completed, total, startedAt }),
          shouldAbort: () => abortRef.current
        });
        setResult(outcome);
      }
      setStep("complete");
      onComplete?.(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      abortControllerRef.current = null;
    }
  }, [
    classified,
    serverMode,
    serverBulkImport,
    file,
    replaceAll,
    safeColumns,
    keys,
    strategy,
    existingRows,
    fetchAll,
    createMutation,
    updateMutation,
    toCreatePayload,
    toUpdatePayload,
    getRowId,
    matchEnumKeysByValueId,
    onComplete
  ]);

  function cancelImport() {
    abortRef.current = true;
    abortControllerRef.current?.abort();
  }

  // ---- Derived ------------------------------------------------------------

  const summary = classified?.summary ?? { create: 0, update: 0, skip: 0, error: 0, duplicate: 0 };
  const actionable = summary.create + summary.update;
  const totalRows = parsed?.totalRows ?? 0;
  const validRows = parsed?.rows.filter((row) => row.valid).length ?? 0;

  const elapsed = progress.startedAt ? (Date.now() - progress.startedAt) / 1000 : 0;
  const rate = progress.completed > 0 && elapsed > 0 ? progress.completed / elapsed : 0;
  const eta = rate > 0 && progress.total > progress.completed ? (progress.total - progress.completed) / rate : 0;
  const pct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  const stamp = csvTimestamp();

  return (
    <Dialog open={open} onOpenChange={(next) => !importing && onOpenChange?.(next)}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-2 border-b px-6 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {serverMode
              ? "Validate the CSV locally, then send the whole file to Scott in one upload."
              : "Match rows against existing records, then create or update them one row at a time."}
          </DialogDescription>
          <StepRail current={step} />
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {/* ---------------- Step 1 — upload ---------------- */}
          {step === "upload" ? (
            <div className="space-y-4">
              <div className="space-y-2 rounded-lg border p-4">
                <p className="text-sm font-medium">Step 1 — download the template</p>
                <p className="text-xs text-muted-foreground">
                  Headers may be the display names below or the raw field keys.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => downloadCsv(`${filenameStem}-template.csv`, buildTemplateCsv(safeColumns))}
                  >
                    <Download className="size-4" />
                    Template CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadCsv(`${filenameStem}-reference-values.csv`, buildReferenceValuesCsv(safeColumns))
                    }
                  >
                    <Download className="size-4" />
                    Export dropdown values
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {safeColumns.map((column) => (
                    <Badge
                      key={column.key}
                      variant={column.required ? "secondary" : "outline"}
                      className="font-normal"
                      title={column.required ? "Required column" : "Optional column"}
                    >
                      {column.name ?? column.key}
                      {column.required ? " *" : ""}
                    </Badge>
                  ))}
                </div>
              </div>

              {safeColumns.some((column) => column.type === "enum" && column.options?.length) ? (
                <div className="space-y-2 rounded-lg border p-4">
                  <p className="text-sm font-medium">Valid values for dropdown columns</p>
                  {safeColumns
                    .filter((column) => column.type === "enum" && column.options?.length)
                    .map((column) => (
                      <div key={column.key} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{column.name ?? column.key}</p>
                        <div className="flex flex-wrap gap-1">
                          {column.options.slice(0, 8).map((option) => (
                            <Badge
                              key={String(option.value)}
                              variant="outline"
                              className="font-normal"
                              title={`ID: ${option.value}`}
                            >
                              {option.label}
                            </Badge>
                          ))}
                          {column.options.length > 8 ? (
                            <Badge variant="outline" className="font-normal">
                              +{column.options.length - 8} more
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}

              {serverMode ? (
                <Alert>
                  <AlertDescription className="text-xs">
                    After validation, your CSV is sent to Scott in one upload and processed there. Progress is
                    polled every 2 seconds.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2 rounded-lg border border-dashed p-6 text-center">
                <FileUp className="mx-auto size-6 text-muted-foreground" />
                <p className="text-sm font-medium">Step 2 — upload your CSV</p>
                <p className="text-xs text-muted-foreground">
                  {columnsLoading ? "Loading dropdown options…" : ".csv files only"}
                </p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFilePicked}
                />
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  disabled={columnsLoading || parsing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {parsing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {parsing ? "Parsing…" : "Choose CSV"}
                </Button>
              </div>
            </div>
          ) : null}

          {/* ---------------- Step 2 — configure ---------------- */}
          {step === "configure" && parsed ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <SummaryBadge tone="secondary">{totalRows.toLocaleString()} rows parsed</SummaryBadge>
                <SummaryBadge>{validRows.toLocaleString()} valid</SummaryBadge>
                {parsed.unknownHeaders.length > 0 ? (
                  <SummaryBadge>{parsed.unknownHeaders.length} ignored headers</SummaryBadge>
                ) : null}
                {parsed.missingRequiredLabels.length > 0 ? (
                  <Badge variant="destructive" className="font-normal">
                    Missing: {parsed.missingRequiredLabels.join(", ")}
                  </Badge>
                ) : null}
              </div>

              {serverMode ? (
                <Alert>
                  <AlertDescription className="text-xs">
                    Scott performs the matching for this import — key and strategy settings below are not sent.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2 rounded-lg border p-4">
                <Label className="text-sm">Match key</Label>
                <p className="text-xs text-muted-foreground">
                  Rows are matched to existing records on these column(s), combined into one key.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  {eligible.map((column) => (
                    <Label
                      key={column.key}
                      className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-normal"
                    >
                      <Checkbox
                        checked={keys.includes(column.key)}
                        onCheckedChange={() =>
                          setKeys((current) =>
                            current.includes(column.key)
                              ? current.filter((key) => key !== column.key)
                              : [...current, column.key]
                          )
                        }
                      />
                      {column.name ?? column.key}
                    </Label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-4">
                <Label className="text-sm">When a row already exists</Label>
                <div className="inline-flex flex-wrap rounded-lg border p-0.5">
                  {IMPORT_STRATEGIES.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={strategy === option.value ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setStrategy(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {IMPORT_STRATEGIES.find((option) => option.value === strategy)?.hint}
                </p>
              </div>
            </div>
          ) : null}

          {/* ---------------- Step 3 — review ---------------- */}
          {step === "review" && classified ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <SummaryBadge tone="secondary">{summary.create.toLocaleString()} create</SummaryBadge>
                <SummaryBadge tone="secondary">{summary.update.toLocaleString()} update</SummaryBadge>
                <SummaryBadge>{summary.skip.toLocaleString()} skip</SummaryBadge>
                {summary.duplicate > 0 ? (
                  <Badge variant="destructive" className="font-normal">
                    {summary.duplicate} duplicates in file
                  </Badge>
                ) : null}
                {summary.error > 0 ? (
                  <Badge variant="destructive" className="font-normal">
                    {summary.error} need fixing
                  </Badge>
                ) : null}
              </div>

              {summary.error > 0 ? (
                <div className="space-y-2 rounded-lg border border-destructive/40 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="size-4" />
                    {summary.error} row{summary.error === 1 ? "" : "s"} need fixing
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                    {classified.rows
                      .filter((row) => row.action === "error")
                      .slice(0, 50)
                      .map((row) => (
                        <li key={row.rowNumber}>
                          Row {row.rowNumber}:{" "}
                          {Object.entries(row.errors)
                            .map(([column, message]) => `${column} — ${message}`)
                            .join("; ")}
                        </li>
                      ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadCsv(
                          `${filenameStem}-import-errors-${stamp}.csv`,
                          buildErrorsCsv(classified.rows, parsed?.headers ?? [])
                        )
                      }
                    >
                      <Download className="size-4" />
                      Export errors CSV
                    </Button>
                    {summary.duplicate > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          downloadCsv(
                            `${filenameStem}-import-duplicates-${stamp}.csv`,
                            buildDuplicatesCsv(classified.rows, parsed?.headers ?? [])
                          )
                        }
                      >
                        <Download className="size-4" />
                        Export duplicates CSV
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!serverMode && actionable > LARGE_IMPORT_WARNING_THRESHOLD ? (
                <Alert>
                  <AlertDescription className="text-xs">
                    Each row requires an individual API call — {actionable.toLocaleString()} rows may take 10–20
                    minutes at concurrency {resolveImportConcurrency(actionable)}. Consider splitting the file
                    into chunks under 10,000 rows.
                  </AlertDescription>
                </Alert>
              ) : null}

              {serverMode ? (
                <div
                  className={cn(
                    "space-y-2 rounded-lg border p-4",
                    replaceAll && "border-destructive/50 bg-destructive/5"
                  )}
                >
                  <Label className="text-sm">Import mode</Label>
                  <Label className="flex cursor-pointer items-start gap-2 text-xs font-normal leading-relaxed">
                    <Checkbox checked={replaceAll} onCheckedChange={(next) => setReplaceAll(next === true)} />
                    <span>
                      <span className="font-medium">Replace all existing prices</span>
                      <br />
                      Scott deletes every existing price row, then imports this file from scratch. Without this,
                      the file is merged into the existing data.
                    </span>
                  </Label>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {!serverMode ? <TableHead className={HEAD}>Action</TableHead> : null}
                      <TableHead className={HEAD}>Row</TableHead>
                      {safeColumns.slice(0, 5).map((column) => (
                        <TableHead key={column.key} className={HEAD}>
                          {column.name ?? column.key}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classified.rows
                      .filter((row) => (serverMode ? row.valid : row.action === "create" || row.action === "update"))
                      .slice(0, 6)
                      .map((row) => (
                        <TableRow key={row.rowNumber}>
                          {!serverMode ? (
                            <TableCell className={CELL}>
                              <Badge
                                variant={row.action === "create" ? "secondary" : "outline"}
                                className="font-normal"
                              >
                                {row.action}
                              </Badge>
                            </TableCell>
                          ) : null}
                          <TableCell className={cn(CELL, "tabular-nums text-muted-foreground")}>
                            {row.rowNumber}
                          </TableCell>
                          {safeColumns.slice(0, 5).map((column) => (
                            <TableCell key={column.key} className={CELL}>
                              {String(row.data?.[column.key] ?? "") || "—"}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {importing ? (
                <div className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" />
                      {serverMode
                        ? "Importing on Scott…"
                        : `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} rows`}
                    </span>
                    <span className="text-muted-foreground">{formatEta(eta)}</span>
                  </div>
                  {!serverMode ? <ProgressBar value={pct} /> : null}
                  <Button type="button" variant="outline" size="sm" onClick={cancelImport}>
                    Cancel import
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ---------------- Step 4 — complete ---------------- */}
          {step === "complete" && result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {result.failed > 0 ? (
                  <AlertTriangle className="size-5 text-amber-600" />
                ) : (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                )}
                <p className="text-sm font-medium">{summarizeImport(result).message}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <SummaryBadge tone="secondary">{(result.created ?? 0).toLocaleString()} created</SummaryBadge>
                <SummaryBadge tone="secondary">{(result.updated ?? 0).toLocaleString()} updated</SummaryBadge>
                <SummaryBadge>{(result.skipped ?? 0).toLocaleString()} skipped</SummaryBadge>
                {result.failed > 0 ? (
                  <Badge variant="destructive" className="font-normal">
                    {result.failed.toLocaleString()} failed
                  </Badge>
                ) : null}
                {result.aborted ? <SummaryBadge>cancelled</SummaryBadge> : null}
              </div>

              {result.failures?.length > 0 ? (
                <div className="space-y-2 rounded-lg border p-4">
                  <p className="text-sm font-medium">Failures</p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                    {result.failures.map((failure, index) => (
                      <li key={`${failure.rowNumber ?? "?"}-${index}`}>
                        Row {failure.rowNumber ?? "?"}: {failure.error}
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadCsv(
                        `${filenameStem}-failures-${stamp}.csv`,
                        buildFailuresCsv(result.failures, parsed?.headers ?? [])
                      )
                    }
                  >
                    <Download className="size-4" />
                    Export failures
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t bg-muted/30 px-6 py-4">
          {step === "configure" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep("upload")} disabled={matching}>
                Back
              </Button>
              <Button type="button" onClick={runMatching} disabled={matching || keys.length === 0}>
                {matching ? <Loader2 className="size-4 animate-spin" /> : null}
                {matching ? "Matching…" : "Match & preview"}
              </Button>
            </>
          ) : null}

          {step === "review" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep("configure")} disabled={importing}>
                Back
              </Button>
              <Button
                type="button"
                variant={serverMode && replaceAll ? "destructive" : "default"}
                onClick={confirmImport}
                disabled={importing || (serverMode ? validRows === 0 : actionable === 0)}
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : null}
                {serverMode
                  ? replaceAll
                    ? `Replace all & import ${validRows.toLocaleString()} rows`
                    : `Upload ${validRows.toLocaleString()} rows`
                  : `Import ${actionable.toLocaleString()} rows`}
              </Button>
            </>
          ) : null}

          {step === "complete" ? (
            <>
              <Button type="button" variant="outline" onClick={resetAll}>
                Import another file
              </Button>
              <Button type="button" onClick={() => onOpenChange?.(false)}>
                Done
              </Button>
            </>
          ) : null}

          {step === "upload" ? (
            <Button type="button" variant="ghost" onClick={() => onOpenChange?.(false)}>
              Cancel
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
