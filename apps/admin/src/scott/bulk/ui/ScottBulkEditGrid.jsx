// Excel-like bulk edit grid for Scott masters.
//
// DOCUMENTED DEVIATION — NO GRID LIBRARY.
//   The original was built on `react-data-grid`. That package is NOT installed in this
//   repo and no new npm dependency may be added, so the grid is hand-built from the
//   shadcn `Table` + `Input` / `Select` / `Checkbox` / `Popover` primitives. Everything
//   the original grid did is reproduced (inline editors per cell type, sticky header,
//   pinned Name column, multi-row selection, dirty/new/deleted row styling, per-cell
//   invalid tint, clipboard paste, Cmd+S / Esc, beforeunload guard) except library-level
//   row virtualisation, which is replaced by page-based windowing (the row STATE always
//   covers every row; only the rendered slice is windowed).
//
// PASTE WORKS HERE — the original shipped it inert.
//   Its handler read `data-row-id` / `data-column-key` off the cell under the cursor,
//   but nothing in the codebase ever emitted those attributes, so `handlePaste` was
//   unreachable despite the "Paste from Excel/Sheets supported" footer hint. This grid
//   emits both attributes, so the documented paste pipeline actually runs. `data-row-id`
//   carries the internal row key rather than `getRowId(row)`, because unsaved rows all
//   share the id `''` (see the empty-id quirk in `bulkEditState.js`).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { proxifyScottImageUrl } from "@/scott/scottImage";
import { ScottToasts, useScottToast } from "@/scott/ui/useScottToast";
import {
  addNewRow,
  applyPaste,
  applyServerErrors,
  buildRowStates,
  clearServerErrors,
  computeGridStats,
  getChanges,
  isDeepEqual,
  markRowsDeleted,
  parseClipboardMatrix,
  reconcileRowsAfterSave,
  setCellValue,
  validateCellValue
} from "../bulkEditState";
import { batchSave, summarizeBatchSave } from "../bulkSaveService";

const HEAD_CLASS = "h-11 whitespace-nowrap px-3 text-xs font-medium text-muted-foreground";
const CELL_CLASS = "px-3 py-1.5 align-middle text-sm";
const DEFAULT_COLUMN_WIDTH = 150;
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_IMAGES = 5;
const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000];
/** Radix Select forbids an empty string item value. */
const NONE_SENTINEL = "__none__";

function columnWidth(column) {
  return column?.width || DEFAULT_COLUMN_WIDTH;
}

function isReadonlyColumn(column) {
  return Boolean(column?.readonly) || column?.type === "readonly";
}

function optionLabel(column, value) {
  const option = (column?.options ?? []).find((entry) => String(entry.value) === String(value));
  return option ? option.label : "";
}

function formatBytes(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------

function TextCellView({ value }) {
  const text = String(value ?? "").trim();
  if (!text) return <span className="text-muted-foreground">-</span>;
  return <span className="block truncate">{text}</span>;
}

function NumberCellView({ value }) {
  return <span className="block text-right tabular-nums">{value ?? 0}</span>;
}

function EnumCellView({ column, value }) {
  const text = String(value ?? "").trim();
  if (!text) {
    return <span className="text-muted-foreground">{column.emptyLabel ?? "-"}</span>;
  }
  return (
    <Badge variant="outline" className="max-w-full truncate font-normal">
      {optionLabel(column, text) || text}
    </Badge>
  );
}

function HexCellView({ value }) {
  const hex = String(value ?? "").trim() || "#000000";
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block size-4 shrink-0 rounded-sm border shadow-sm"
        style={{ backgroundColor: hex }}
        aria-hidden
      />
      <span className="font-mono text-xs uppercase">{hex}</span>
    </span>
  );
}

function BooleanCellView({ value }) {
  const flag = value === true || value === "true";
  return (
    <span
      className={cn(
        "block text-center text-xs font-medium",
        flag ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
      )}
    >
      {flag ? "Yes" : "No"}
    </span>
  );
}

function UrlCellView({ value }) {
  const text = String(value ?? "").trim();
  if (!text) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="block truncate text-blue-600 underline-offset-2 dark:text-blue-400">
      {text.length > 30 ? `${text.slice(0, 30)}…` : text}
    </span>
  );
}

function ImageThumb({ url, className }) {
  const src = proxifyScottImageUrl(url);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn("size-full object-cover", className)}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

/** Single-image cell — Airtable-style chip that opens a Popover editor. */
function ImageCellView({ column, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const maxSize = column.imageConfig?.maxSize ?? DEFAULT_MAX_IMAGE_BYTES;
  const accept = column.imageConfig?.accept ?? "image/*";
  const current = typeof value === "string" ? { existingUrl: value } : value ?? {};
  const [error, setError] = useState("");

  const previewUrl = current.previewUrl || current.existingUrl || "";
  const hasNewFile = Boolean(current.file);

  function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > maxSize) {
      setError(`Image must be under ${formatBytes(maxSize)}.`);
      return;
    }
    setError("");
    const objectUrl = typeof URL !== "undefined" ? URL.createObjectURL(file) : "";
    onChange({ ...current, file, previewUrl: objectUrl });
  }

  function remove() {
    if (current.previewUrl && typeof URL !== "undefined") URL.revokeObjectURL(current.previewUrl);
    setError("");
    onChange({ existingUrl: undefined, file: undefined, previewUrl: undefined });
  }

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "h-9 w-full justify-start gap-2 px-1 font-normal",
            !previewUrl && "border border-dashed text-muted-foreground"
          )}
          disabled={disabled}
        >
          {previewUrl ? (
            <span className="relative block size-8 shrink-0 overflow-hidden rounded-sm border bg-muted/40">
              <ImageThumb url={previewUrl} />
              {hasNewFile ? (
                <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="size-2.5" />
                </span>
              ) : null}
            </span>
          ) : (
            <ImagePlus className="size-4" />
          )}
          <span className="truncate text-xs">{previewUrl ? (hasNewFile ? "New" : "Edit") : "Add image"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {previewUrl ? (
            <ImageThumb url={previewUrl} className="object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No image</span>
          )}
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}
        <Input ref={inputRef} type="file" accept={accept} className="hidden" onChange={pick} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {previewUrl ? "Replace" : "Upload"}
          </Button>
          {previewUrl ? (
            <Button type="button" variant="outline" size="sm" onClick={remove}>
              Remove
            </Button>
          ) : null}
          <Button type="button" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Max {formatBytes(maxSize)} · changes apply immediately.</p>
      </PopoverContent>
    </Popover>
  );
}

/** Multi-image cell — stacked thumbnails + a Popover grid editor. */
function ImagesCellView({ column, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const maxFiles = column.imageConfig?.maxFiles ?? DEFAULT_MAX_IMAGES;
  const maxSize = column.imageConfig?.maxSize ?? DEFAULT_MAX_IMAGE_BYTES;
  const accept = column.imageConfig?.accept ?? "image/*";

  const current = value ?? {};
  const existingUrls = current.existingUrls ?? [];
  const files = current.files ?? [];
  const previewUrls = current.previewUrls ?? [];
  const total = existingUrls.length + files.length;
  const stacked = [...existingUrls, ...previewUrls].slice(0, 3);

  function pick(event) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = "";
    if (picked.length === 0) return;

    const messages = [];
    const accepted = [];
    for (const file of picked) {
      if (existingUrls.length + files.length + accepted.length >= maxFiles) {
        messages.push(`Only ${maxFiles} images allowed.`);
        break;
      }
      if (file.size > maxSize) {
        messages.push(`${file.name} is over ${formatBytes(maxSize)}.`);
        continue;
      }
      accepted.push(file);
    }
    setError(messages.join(" "));
    if (accepted.length === 0) return;

    const nextPreviews = accepted.map((file) =>
      typeof URL !== "undefined" ? URL.createObjectURL(file) : ""
    );
    onChange({
      ...current,
      existingUrls,
      files: [...files, ...accepted],
      previewUrls: [...previewUrls, ...nextPreviews]
    });
  }

  function removeExisting(index) {
    onChange({ ...current, existingUrls: existingUrls.filter((_, i) => i !== index), files, previewUrls });
  }

  function removeFile(index) {
    const url = previewUrls[index];
    if (url && typeof URL !== "undefined") URL.revokeObjectURL(url);
    onChange({
      ...current,
      existingUrls,
      files: files.filter((_, i) => i !== index),
      previewUrls: previewUrls.filter((_, i) => i !== index)
    });
  }

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn("h-9 w-full justify-start gap-2 px-1 font-normal", total === 0 && "border border-dashed text-muted-foreground")}
          disabled={disabled}
        >
          {total === 0 ? (
            <>
              <ImagePlus className="size-4" />
              <span className="text-xs">Add images</span>
            </>
          ) : (
            <>
              <span className="flex -space-x-2">
                {stacked.map((url, index) => (
                  <span
                    key={`${url}-${index}`}
                    className={cn(
                      "block size-7 overflow-hidden rounded-sm border bg-muted/40",
                      index >= existingUrls.length && "ring-1 ring-emerald-500"
                    )}
                  >
                    <ImageThumb url={url} />
                  </span>
                ))}
              </span>
              <span className="text-xs text-muted-foreground">
                {files.length > 0 ? `+${files.length} new` : null}
                {total > 3 ? ` +${total - 3}` : null}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {existingUrls.map((url, index) => (
            <div key={`existing-${url}-${index}`} className="relative overflow-hidden rounded-md border bg-muted/30">
              <span className="block aspect-square">
                <ImageThumb url={url} />
              </span>
              <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[10px]">{index + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-0.5 size-5"
                onClick={() => removeExisting(index)}
                aria-label={`Remove image ${index + 1}`}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
          {files.map((file, index) => (
            <div
              key={`new-${file.name}-${index}`}
              className="relative overflow-hidden rounded-md border bg-muted/30 ring-1 ring-emerald-500"
            >
              <span className="block aspect-square">
                <ImageThumb url={previewUrls[index]} />
              </span>
              <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[10px]">
                {existingUrls.length + index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-0.5 size-5"
                onClick={() => removeFile(index)}
                aria-label={`Remove new image ${index + 1}`}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}
        <Input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={pick} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Add files
          </Button>
          <Button type="button" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Up to {maxFiles} images · max {formatBytes(maxSize)} each.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Dispatch to the renderer for a column type. */
function CellView({ column, value, onChange, disabled }) {
  switch (column.type) {
    case "integer":
    case "decimal":
      return <NumberCellView value={value} />;
    case "enum":
      return <EnumCellView column={column} value={value} />;
    case "hex":
      return <HexCellView value={value} />;
    case "boolean":
      return <BooleanCellView value={value} />;
    case "url":
      return <UrlCellView value={value} />;
    case "image":
      return <ImageCellView column={column} value={value} onChange={onChange} disabled={disabled} />;
    case "images":
      return <ImagesCellView column={column} value={value} onChange={onChange} disabled={disabled} />;
    case "readonly":
      return <span className="block truncate text-muted-foreground">{String(value ?? "") || "-"}</span>;
    default:
      return <TextCellView value={value} />;
  }
}

// ---------------------------------------------------------------------------
// Cell editors
// ---------------------------------------------------------------------------

/** Text / number / hex / url editor: autofocus + select, Enter commits, Escape cancels. */
function InlineInputEditor({ column, value, onCommit, onCancel }) {
  const [draft, setDraft] = useState(() => (value === null || value === undefined ? "" : String(value)));
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  const commit = () => {
    const result = validateCellValue(column.type, draft, column);
    onCommit(result.valid ? result.parsedValue : draft);
  };

  const inputType = column.type === "integer" || column.type === "decimal" ? "number" : column.type === "url" ? "url" : "text";

  return (
    <span className="flex items-center gap-1.5">
      {column.type === "hex" ? (
        <span
          className="inline-block size-4 shrink-0 rounded-sm border"
          style={{ backgroundColor: draft || "#000000" }}
          aria-hidden
        />
      ) : null}
      <Input
        ref={inputRef}
        type={inputType}
        step={column.type === "integer" ? 1 : column.type === "decimal" ? "any" : undefined}
        value={draft}
        placeholder={column.type === "hex" ? "#RRGGBB" : column.type === "url" ? "https://…" : undefined}
        onChange={(event) =>
          setDraft(column.type === "hex" ? event.target.value.toUpperCase() : event.target.value)
        }
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-7 px-2 py-0 text-sm"
      />
    </span>
  );
}

/**
 * Enum editor. Opens immediately; selecting commits and closes. A value that is not in
 * `editorOptions` but exists in `options` (an inactive/legacy assignment) is prepended
 * as `"{label} (Inactive)"` so it is never silently dropped.
 */
function InlineEnumEditor({ column, value, onCommit, onCancel }) {
  const options = column.editorOptions ?? column.options ?? [];
  const current = String(value ?? "");
  const inEditor = options.some((option) => String(option.value) === current);
  const legacy = !inEditor && current ? (column.options ?? []).find((o) => String(o.value) === current) : null;
  const nullable = column.nullable !== undefined ? column.nullable : !column.required;

  return (
    <Select
      defaultOpen
      value={current || NONE_SENTINEL}
      onValueChange={(next) => onCommit(next === NONE_SENTINEL ? "" : next)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <SelectTrigger className="h-7 px-2 py-0 text-sm">
        <SelectValue placeholder={column.emptyLabel ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {nullable ? <SelectItem value={NONE_SENTINEL}>{column.emptyLabel ?? "None"}</SelectItem> : null}
        {legacy ? (
          <SelectItem value={String(legacy.value)}>{`${legacy.label} (Inactive)`}</SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem key={String(option.value)} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Boolean editor: a centred Checkbox that commits on change. */
function InlineBooleanEditor({ value, onCommit }) {
  return (
    <span className="flex justify-center">
      <Checkbox
        autoFocus
        checked={value === true || value === "true"}
        onCheckedChange={(next) => onCommit(next === true)}
        aria-label="Toggle value"
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {string} [props.title] shown in the header strip
 * @param {Array<object>} props.columns bulk-edit column configs (see `bulkEditState.js`)
 * @param {Array<object>} [props.data] rows from the list query
 * @param {boolean} [props.loading]
 * @param {string} [props.error] panel-level fetch error
 * @param {(row: object) => string} props.getRowId
 * @param {() => object} props.createEmptyRow
 * @param {(row: object) => object} [props.toCreatePayload]
 * @param {(row: object) => object} [props.toUpdatePayload]
 * @param {(payload: object) => Promise<unknown>} props.createMutation
 * @param {(args: {id: string, updates: object}) => Promise<unknown>} props.updateMutation
 * @param {(id: string) => Promise<unknown>} props.deleteMutation
 * @param {string} [props.entityName="Records"]
 * @param {() => void} [props.onClose]
 * @param {(result: object) => void} [props.onSaved] fired after a save with no failures
 * @param {string} [props.className]
 */
export default function ScottBulkEditGrid({
  title = "Bulk edit",
  columns = [],
  data = [],
  loading = false,
  error = "",
  getRowId = (row) => String(row?.id ?? ""),
  createEmptyRow = () => ({}),
  toCreatePayload = (row) => row,
  toUpdatePayload = (row) => row,
  createMutation,
  updateMutation,
  deleteMutation,
  entityName = "Records",
  onClose,
  onSaved,
  className
}) {
  const safeColumns = useMemo(() => (Array.isArray(columns) ? columns.filter((c) => c?.key) : []), [columns]);

  const [rows, setRows] = useState(() => buildRowStates(data, safeColumns));
  const [selection, setSelection] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // { rowKey, columnKey }
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const { toasts, toast, toastError, dismiss } = useScottToast();

  const stats = useMemo(() => computeGridStats(rows), [rows]);
  const hasChanges = stats.hasChanges;

  // The grid rebuilds whenever fresh query data lands (and only then).
  const dataRef = useRef(data);
  useEffect(() => {
    if (loading) return;
    if (dataRef.current === data) return;
    dataRef.current = data;
    setRows(buildRowStates(data, safeColumns));
    setSelection(new Set());
    setEditing(null);
  }, [data, loading, safeColumns]);

  // Unsaved-changes guard.
  useEffect(() => {
    if (!hasChanges) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize]
  );

  // While a multi-cell paste is being applied the open inline editor is torn down. Its
  // blur handler would otherwise fire afterwards and write its stale draft back over one
  // of the pasted cells, so commits are suppressed for the duration of the paste tick.
  const pastingRef = useRef(false);

  const commitCell = useCallback(
    (rowKey, columnKey, value) => {
      if (pastingRef.current) {
        setEditing(null);
        return;
      }
      setRows((current) => setCellValue(current, rowKey, columnKey, value, safeColumns));
      setEditing(null);
    },
    [safeColumns]
  );

  const handleAddRow = useCallback(() => {
    setRows((current) => addNewRow(current, createEmptyRow, safeColumns));
    setPage(Math.max(1, Math.ceil((rows.length + 1) / pageSize)));
  }, [createEmptyRow, safeColumns, rows.length, pageSize]);

  const handleSelectAll = useCallback(() => {
    setSelection(new Set(rows.filter((state) => !state.isDeleted).map((state) => state.rowKey)));
  }, [rows]);

  const handleDeleteSelected = useCallback(() => {
    if (selection.size === 0) return;
    setRows((current) => markRowsDeleted(current, selection));
    setSelection(new Set());
  }, [selection]);

  const handleDiscard = useCallback(() => {
    if (hasChanges && !window.confirm("Discard all changes?\n\nThis cannot be undone.")) return;
    setRows(buildRowStates(dataRef.current ?? [], safeColumns));
    setSelection(new Set());
    setEditing(null);
    onClose?.();
  }, [hasChanges, safeColumns, onClose]);

  const handlePaste = useCallback(
    (event) => {
      const cell = event.target?.closest?.('[role="gridcell"]');
      const rowKey = cell?.getAttribute?.("data-row-id");
      const columnKey = cell?.getAttribute?.("data-column-key");
      if (!rowKey || !columnKey) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;

      const matrix = parseClipboardMatrix(text);
      // A plain 1x1 paste belongs to whichever inline editor is open — let the browser
      // handle it so typing and pasting behave identically.
      if (matrix.length === 1 && matrix[0].length === 1) return;

      event.preventDefault();
      pastingRef.current = true;
      setEditing(null);
      setRows((current) =>
        applyPaste(current, {
          targetRowKey: rowKey,
          targetColumnKey: columnKey,
          matrix,
          columns: safeColumns,
          createEmptyRow
        })
      );
      setTimeout(() => {
        pastingRef.current = false;
      }, 0);
    },
    [safeColumns, createEmptyRow]
  );

  /**
   * Save, then RECONCILE — the grid must always end up describing what actually happened.
   *
   * `batchSave` itself never throws, but everything around it can: the injected payload
   * builders run here (`toCreatePayload` / `toUpdatePayload` execute the master config's
   * mappers), and a throw there used to strand `saving` at `true`, freezing the whole
   * toolbar and every cell over unsaved data with no non-destructive way out. Hence the
   * try/finally: `saving` is released on every path.
   *
   * On a partial failure the grid stays open, but only the rows that genuinely failed stay
   * pending — `reconcileRowsAfterSave` retires the ones that went through, so pressing Save
   * again (exactly what the error toast invites) can never re-create an already-created row.
   */
  const handleSave = useCallback(async () => {
    if (saving) return;
    if (stats.invalidCount > 0) {
      toastError(`Fix ${stats.invalidCount} invalid cell${stats.invalidCount === 1 ? "" : "s"} before saving.`);
      return;
    }
    const changes = getChanges(rows, getRowId);
    const total = changes.toCreate.length + changes.toUpdate.length + changes.toDelete.length;
    if (total === 0) {
      onClose?.();
      return;
    }

    setSaving(true);
    setProgress({ completed: 0, total });
    setRows((current) => clearServerErrors(current));

    let result;
    try {
      result = await batchSave({
        toCreate: changes.toCreate.map((entry) => ({ rowKey: entry.rowKey, row: toCreatePayload(entry.row) })),
        toUpdate: changes.toUpdate.map((entry) => ({
          id: entry.id,
          rowKey: entry.rowKey,
          row: toUpdatePayload(entry.row)
        })),
        toDelete: changes.toDelete,
        createMutation,
        updateMutation,
        deleteMutation,
        entityName,
        onProgress: (completed, all) => setProgress({ completed, total: all })
      });
    } catch (error) {
      // Nothing was dispatched (the throw came from a payload builder), so the rows are
      // still exactly as the user left them — dirty, valid and retryable.
      toastError(
        `${entityName} bulk edit could not start: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    } finally {
      setSaving(false);
    }

    // Runs on success AND on partial failure: succeeded creates lose `isNew` and adopt their
    // server id, succeeded updates go clean, succeeded deletes leave the grid.
    setRows((current) =>
      applyServerErrors(reconcileRowsAfterSave(current, result, getRowId), result.errors, getRowId)
    );

    const summary = summarizeBatchSave(result, entityName);
    if (result.failed > 0) {
      toastError(summary.message);
      return;
    }

    toast(summary.message);
    onSaved?.(result);
  }, [
    saving,
    stats.invalidCount,
    rows,
    getRowId,
    toCreatePayload,
    toUpdatePayload,
    createMutation,
    updateMutation,
    deleteMutation,
    entityName,
    onClose,
    onSaved,
    toast,
    toastError
  ]);

  // Cmd/Ctrl+S saves, Escape discards.
  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
        return;
      }
      if (event.key === "Escape" && !editing) {
        event.preventDefault();
        handleDiscard();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, handleDiscard, editing]);

  if (loading && rows.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const columnCount = safeColumns.length + 1;
  const saveDisabled = saving || stats.invalidCount > 0 || !hasChanges;

  return (
    <div className={cn("flex h-full min-h-0 flex-col space-y-4", className)}>
      <Card className="flex min-h-0 flex-1 flex-col border shadow-sm">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 p-3">
            <span className="mr-1 text-sm font-semibold tracking-tight">{title}</span>

            <Button type="button" variant="outline" size="sm" onClick={handleAddRow} disabled={saving}>
              <Plus className="size-4" />
              Add row
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleSelectAll} disabled={saving}>
              Select all
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={saving || selection.size === 0}
            >
              <Trash2 className="size-4" />
              Delete selected
            </Button>

            <span className="text-xs text-muted-foreground">
              {selection.size > 0 ? `${selection.size} selected` : "Click a cell to edit"}
            </span>

            {stats.invalidCount > 0 ? (
              <Badge variant="destructive" className="font-normal">
                {stats.invalidCount} invalid
              </Badge>
            ) : null}
            {hasChanges ? (
              <Badge variant="secondary" className="font-normal">
                {stats.dirtyCount} modified · {stats.newCount} new · {stats.deletedCount} deleted
              </Badge>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saveDisabled}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {progress.completed}/{progress.total}
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="shrink-0 border-b p-3">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {/* Grid */}
          <div className="min-h-0 flex-1 overflow-auto" onPaste={handlePaste}>
            {/* `data-scott-bulk-grid` opts this table out of the global
                `table[data-shadcn-table] td { background: transparent !important }`
                rule in index.css, which would otherwise erase the per-cell dirty /
                invalid tints and the pinned Name column's background. */}
            <Table data-scott-bulk-grid>
              <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className={cn(HEAD_CLASS, "w-10")}>
                    <span className="sr-only">Select</span>
                  </TableHead>
                  {safeColumns.map((column) => (
                    <TableHead
                      key={column.key}
                      style={{ width: columnWidth(column), minWidth: columnWidth(column) }}
                      className={cn(
                        HEAD_CLASS,
                        // The Name column is pinned, exactly as the original froze it.
                        column.key === "name" && "sticky left-0 z-10 bg-card"
                      )}
                    >
                      {column.name ?? column.key}
                      {column.required ? <span className="ml-0.5 text-destructive">*</span> : null}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody>
                {visibleRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columnCount} className="py-10 text-center text-sm text-muted-foreground">
                      No rows. Use “Add row” to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((state) => {
                    const serverError = state.validationErrors?._server;
                    return (
                      <Fragment key={state.rowKey}>
                        <TableRow
                          data-state={selection.has(state.rowKey) ? "selected" : undefined}
                          className={cn(
                            state.isNew && "bg-primary/5",
                            state.isDeleted && "opacity-50 line-through",
                            serverError && "bg-destructive/5"
                          )}
                        >
                          <TableCell className={cn(CELL_CLASS, "w-10")}>
                            <Checkbox
                              checked={selection.has(state.rowKey)}
                              disabled={saving}
                              onCheckedChange={() =>
                                setSelection((current) => {
                                  const next = new Set(current);
                                  if (next.has(state.rowKey)) next.delete(state.rowKey);
                                  else next.add(state.rowKey);
                                  return next;
                                })
                              }
                              aria-label="Select row"
                            />
                          </TableCell>

                          {safeColumns.map((column) => {
                            const value = state.current?.[column.key];
                            const cellError = state.validationErrors?.[column.key];
                            const dirty =
                              !state.isNew && !isDeepEqual(state.original?.[column.key], value);
                            const readonly = isReadonlyColumn(column) || state.isDeleted || saving;
                            const isEditing =
                              editing?.rowKey === state.rowKey && editing?.columnKey === column.key;
                            const inlineEditable =
                              column.type !== "image" && column.type !== "images" && !readonly;

                            return (
                              <TableCell
                                key={column.key}
                                role="gridcell"
                                data-row-id={state.rowKey}
                                data-column-key={column.key}
                                tabIndex={inlineEditable ? 0 : -1}
                                title={cellError || undefined}
                                style={{ width: columnWidth(column), minWidth: columnWidth(column) }}
                                onClick={inlineEditable && !isEditing
                                  ? () => setEditing({ rowKey: state.rowKey, columnKey: column.key })
                                  : undefined}
                                onKeyDown={
                                  inlineEditable && !isEditing
                                    ? (event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          setEditing({ rowKey: state.rowKey, columnKey: column.key });
                                        }
                                      }
                                    : undefined
                                }
                                className={cn(
                                  CELL_CLASS,
                                  inlineEditable && "cursor-cell",
                                  column.key === "name" && "sticky left-0 z-10 bg-card",
                                  dirty && "bg-amber-50 dark:bg-amber-500/10",
                                  cellError &&
                                    "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/40"
                                )}
                              >
                                {isEditing ? (
                                  column.type === "enum" ? (
                                    <InlineEnumEditor
                                      column={column}
                                      value={value}
                                      onCommit={(next) => commitCell(state.rowKey, column.key, next)}
                                      onCancel={() => setEditing(null)}
                                    />
                                  ) : column.type === "boolean" ? (
                                    <InlineBooleanEditor
                                      value={value}
                                      onCommit={(next) => commitCell(state.rowKey, column.key, next)}
                                    />
                                  ) : (
                                    <InlineInputEditor
                                      column={column}
                                      value={value}
                                      onCommit={(next) => commitCell(state.rowKey, column.key, next)}
                                      onCancel={() => setEditing(null)}
                                    />
                                  )
                                ) : (
                                  <CellView
                                    column={column}
                                    value={value}
                                    disabled={readonly}
                                    onChange={(next) => commitCell(state.rowKey, column.key, next)}
                                  />
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {serverError ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={columnCount}
                              className="border-0 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
                            >
                              <span className="flex items-center gap-1.5">
                                <AlertTriangle className="size-3.5 shrink-0" />
                                {serverError}
                              </span>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Footer */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span>
              {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"} · Click or press Enter to edit ·
              Paste from Excel/Sheets supported · Cmd/Ctrl+S saves · Esc discards
            </span>

            <span className="flex items-center gap-2">
              <Label htmlFor="scott-bulk-grid-page-size" className="text-xs font-normal text-muted-foreground">
                Rows
              </Label>
              <Select
                value={String(pageSize)}
                onValueChange={(next) => {
                  setPageSize(Number(next));
                  setPage(1);
                }}
              >
                <SelectTrigger id="scott-bulk-grid-page-size" className="h-7 w-[5.5rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums">
                {safePage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </span>
          </div>
        </CardContent>
      </Card>

      <ScottToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
