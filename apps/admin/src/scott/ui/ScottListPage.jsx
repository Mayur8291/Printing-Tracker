// The generic Scott list screen.
//
//   PageHeader → ScottFilterBar → bulk-action bar (when rows are selected)
//              → ScottTable → ScottPagination
//
// Purely presentational: it owns no data. Hand it a `config` and the whole return value of
// `useScottList`, plus the handlers you want enabled. Write actions are hidden — not just
// disabled — when `mayEdit` is false.

import { useEffect, useRef, useState } from "react";
import { Download, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/inventory/inventoryUiUtils";
import { createEmptyFilterGroup } from "@/scott/list/filterEngine";
import { QUICK_FILTER_ALL_VALUE } from "@/scott/list/quickFilters";
import ScottFilterBar from "@/scott/ui/ScottFilterBar";
import ScottPagination from "@/scott/ui/ScottPagination";
import ScottTable from "@/scott/ui/ScottTable";
import { ScottToasts, useScottToast } from "@/scott/ui/useScottToast";

/** Selection may arrive as a Set or an array — read both, emit the shape we were given. */
function selectionArray(selection) {
  if (selection instanceof Set) return [...selection];
  if (Array.isArray(selection)) return selection;
  return [];
}

function emptySelection(selection) {
  return selection instanceof Set ? new Set() : [];
}

function labelFor(row, config) {
  const idField = config?.idField || "id";
  const name = row?.name ?? row?.title ?? row?.label ?? row?.code ?? "";
  const id = row?.[idField] ?? row?.id ?? "";
  if (name && id) return `${name} (#${id})`;
  return String(name || id || "this record");
}

/**
 * Generic Scott list screen.
 *
 * @param {object} props
 * @param {object} props.config entity config — `label`, `columns`, `idField`, `supportsBulkDelete`, `pageSize`.
 * @param {object} props.list the full return value of `useScottList`:
 *        `{ rows, total, loading, error, page, setPage, pageSize, setPageSize, search, setSearch,
 *           filters, setFilters, filterColumns, clearAllFilters, sort, toggleSort, mode, refresh,
 *           selection, setSelection }`. `filters` is the engine group `{ logic, conditions }`.
 * @param {string} [props.title] overrides `config.label`.
 * @param {string} [props.subtitle]
 * @param {import("react").ReactNode} [props.actions] extra header buttons, rendered before the built-ins.
 * @param {import("react").ReactNode} [props.toolbarActions] extra controls on the right of the filter bar.
 * @param {import("react").ReactNode} [props.children] rendered between the header and the table card (stat cards, banners…).
 * @param {(config: object) => void} [props.onCreate] shows the "New …" button when set and `mayEdit`.
 * @param {(row: object) => void} [props.onEdit] shows the row Edit button and makes rows clickable.
 * @param {(row: object) => Promise<void>|void} [props.onDelete] shows the row Delete button (confirms first).
 * @param {(ids: Array<string>) => Promise<void>|void} [props.onBulkDelete] shows bulk delete (confirms first).
 * @param {() => Promise<void>|void} [props.onExport] shows the Export button — allowed for read-only users.
 * @param {(row: object) => import("react").ReactNode} [props.renderRowActions] replaces the built-in Edit/Delete cell.
 * @param {boolean} [props.mayEdit=false] gate for every write action.
 * @param {boolean} [props.selectable] defaults to true when bulk delete is available.
 * @param {Array<object>} [props.quickFilters] cycling chips for `ScottFilterBar`.
 * @param {(key: string, value: string) => void} [props.onQuickFilterChange]
 * @param {string} [props.searchPlaceholder]
 * @param {string} [props.emptyMessage]
 * @param {(message: string) => void} [props.onError]
 *   Announcement channel for a LOAD failure (`list.error`), called once per distinct message.
 *   Omit it and this component toasts on its own stack instead.
 * @param {boolean} [props.fullHeight=true] fill the panel and scroll inside, per the app shell.
 * @param {string} [props.className]
 */
export default function ScottListPage({
  config = {},
  list = {},
  title,
  subtitle,
  actions = null,
  toolbarActions = null,
  children = null,
  onCreate,
  onEdit,
  onDelete,
  onBulkDelete,
  onExport,
  renderRowActions,
  mayEdit = false,
  selectable,
  quickFilters = [],
  onQuickFilterChange,
  searchPlaceholder,
  emptyMessage,
  onError,
  fullHeight = true,
  className
}) {
  const {
    rows = [],
    total = 0,
    loading = false,
    error = "",
    page = 1,
    setPage,
    pageSize = config.pageSize || 20,
    setPageSize,
    search = "",
    setSearch,
    filters = null,
    setFilters,
    sort = null,
    toggleSort,
    mode = "server",
    refresh,
    selection,
    setSelection,
    // `useScottList` already derives the exact `FilterableColumn[]` it feeds to
    // `applyFilterGroup` — reuse it rather than re-deriving, so the builder can never offer
    // a field the engine would then evaluate under a different type.
    filterColumns,
    clearAllFilters,
    // Pagination truth. `total` is only a LOWER BOUND when `totalCountIsExact` is false, so
    // the footer needs all three to avoid re-deriving a page count from a guess.
    totalPages,
    totalCountIsExact,
    hasNextPage,
    // Selection beyond the visible page.
    selectPage,
    selectAllMatching,
    isResolvingAll = false
  } = list;

  const [deletingId, setDeletingId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const idField = config.idField || "id";
  const entityLabel = config.label || "records";
  const selected = selectionArray(selection);
  const canBulkDelete = Boolean(mayEdit && onBulkDelete && config.supportsBulkDelete !== false);
  const showSelection = selectable ?? canBulkDelete;
  const errorText = error instanceof Error ? error.message : error ? String(error) : "";

  /**
   * LOAD FAILURES ARE ANNOUNCED, NOT JUST PRINTED.
   *
   * `callScottDashboard` already turns an edge-function non-2xx into a readable message
   * (`"Invalid credentials (Scott host: leaderboard.sagarfab.com)… (ref: …)"`), so the card
   * below is never empty — but a fetch can fail while the user is looking at the filter bar
   * or has scrolled past it. Every screen therefore also gets a toast:
   *
   *   `onError` given  the owning panel's toast stack (masters);
   *   `onError` absent this component's own stack, so the reports and the customer directory
   *                    surface the same message without every caller re-implementing it.
   */
  const fallbackToast = useScottToast();
  const announceError = onError ?? fallbackToast.toastError;
  const announceRef = useRef(announceError);
  announceRef.current = announceError;
  const lastErrorRef = useRef("");
  useEffect(() => {
    if (!errorText) {
      lastErrorRef.current = "";
      return;
    }
    if (lastErrorRef.current === errorText) return;
    lastErrorRef.current = errorText;
    announceRef.current?.(errorText);
  }, [errorText]);

  async function handleDelete(row) {
    if (!onDelete || deletingId != null) return;
    const id = row?.[idField] ?? row?.id;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${labelFor(row, config)} from ${entityLabel}?\n\nThis cannot be undone.`)
    ) {
      return;
    }
    setDeletingId(id);
    try {
      await onDelete(row);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    if (!onBulkDelete || selected.length === 0 || bulkBusy) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete ${selected.length.toLocaleString("en-IN")} selected ${entityLabel}?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      await onBulkDelete(selected);
      setSelection?.(emptySelection(selection));
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleExport() {
    if (!onExport || exporting) return;
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  }

  function clearAll() {
    // The hook's own reset also clears its quick-filter values and snaps back to page 1.
    if (typeof clearAllFilters === "function") clearAllFilters();
    else {
      setSearch?.("");
      setFilters?.(createEmptyFilterGroup());
    }
    (quickFilters || []).forEach((chip) => onQuickFilterChange?.(chip.key, QUICK_FILTER_ALL_VALUE));
  }

  const rowActions =
    renderRowActions ||
    (onEdit || (mayEdit && onDelete)
      ? (row) => {
          const id = row?.[idField] ?? row?.id;
          return (
            <>
              {onEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(row)}>
                  {mayEdit ? "Edit" : "View"}
                </Button>
              ) : null}
              {mayEdit && onDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deletingId === id}
                  onClick={() => handleDelete(row)}
                >
                  {deletingId === id ? "Deleting…" : "Delete"}
                </Button>
              ) : null}
            </>
          );
        }
      : undefined);

  const headerActions = (
    <>
      {actions}
      {mode === "full" ? (
        <Badge variant="secondary" className="font-normal" title="Filters or sorting are active — all pages were fetched.">
          Fetched all
        </Badge>
      ) : null}
      {refresh ? (
        <Button type="button" variant="outline" size="sm" onClick={() => refresh()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      ) : null}
      {onExport ? (
        <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading}>
          <Download className="size-4" aria-hidden />
          {exporting ? "Exporting…" : "Export"}
        </Button>
      ) : null}
      {mayEdit && onCreate ? (
        <Button type="button" size="sm" onClick={() => onCreate(config)}>
          <Plus className="size-4" aria-hidden />
          New {config.singularLabel || entityLabel}
        </Button>
      ) : null}
    </>
  );

  return (
    <div className={cn("flex flex-col space-y-6", fullHeight && "h-full min-h-0", className)}>
      <PageHeader title={title || entityLabel} subtitle={subtitle} actions={headerActions} />

      {children}

      {errorText ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive">{errorText}</p>
            {refresh ? (
              <Button type="button" variant="outline" size="sm" onClick={() => refresh()}>
                Retry
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className={cn("flex flex-col border shadow-sm", fullHeight && "min-h-0 flex-1")}>
        <CardContent className={cn("flex flex-col p-0", fullHeight && "min-h-0 flex-1")}>
          <ScottFilterBar
            config={config}
            columns={filterColumns}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={searchPlaceholder || `Search ${String(entityLabel).toLowerCase()}…`}
            quickFilters={quickFilters}
            onQuickFilterChange={onQuickFilterChange}
            filters={filters}
            onFiltersChange={setFilters}
            onClearAll={clearAll}
            resultCount={total}
            selectedCount={selected.length}
            loading={loading}
            actions={toolbarActions}
            idPrefix={config.key || "scott"}
          />

          {/* The bulk bar is what makes a bulk delete reach past the visible page: without
              "Select all N matching" the one-call `bulk_delete` endpoint could only ever be
              handed the ~20 ids on screen. It shows whenever selection is enabled and there
              are rows, so the affordance is reachable before anything is selected. */}
          {showSelection && (selected.length > 0 || rows.length > 0) ? (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
              <span className={cn("text-sm", selected.length > 0 ? "font-medium" : "text-muted-foreground")}>
                {selected.length > 0
                  ? `${selected.length.toLocaleString("en-IN")} selected`
                  : "Select rows to delete in bulk"}
              </span>

              {typeof selectPage === "function" && rows.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectPage()}
                  disabled={bulkBusy || isResolvingAll}
                >
                  Select this page
                </Button>
              ) : null}
              {typeof selectAllMatching === "function" && total > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllMatching()}
                  disabled={bulkBusy || isResolvingAll || loading}
                >
                  {isResolvingAll
                    ? "Selecting…"
                    : totalCountIsExact === false
                      ? "Select all matching"
                      : `Select all ${total.toLocaleString("en-IN")} matching`}
                </Button>
              ) : null}

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {canBulkDelete && selected.length > 0 ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={bulkBusy}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {bulkBusy ? "Deleting…" : "Delete selected"}
                  </Button>
                ) : null}
                {selected.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelection?.(emptySelection(selection))}
                    disabled={bulkBusy}
                  >
                    <X className="size-4" aria-hidden />
                    Clear selection
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className={cn("p-3", fullHeight && "min-h-0 flex-1 overflow-auto")}>
            <ScottTable
              columns={config.columns}
              rows={rows}
              sort={sort}
              onToggleSort={toggleSort}
              loading={loading}
              emptyMessage={
                emptyMessage ||
                (String(search || "").trim()
                  ? "No matches."
                  : `No ${String(entityLabel).toLowerCase()} yet.`)
              }
              selectable={showSelection}
              selection={selection}
              onSelectionChange={setSelection}
              idField={idField}
              rowActions={rowActions}
              onRowClick={onEdit}
              skeletonRows={Math.min(10, Math.max(3, Number(pageSize) || 10))}
            />
          </div>

          <ScottPagination
            className="shrink-0"
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            totalCountIsExact={totalCountIsExact}
            hasNextPage={hasNextPage}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            loading={loading}
            idPrefix={config.key || "scott"}
            itemLabel={String(entityLabel).toLowerCase()}
          />
        </CardContent>
      </Card>

      {/* Only when nobody upstream owns a stack — the panels that pass `onError` render
          their own, and two fixed stacks would sit on top of each other. */}
      {onError ? null : (
        <ScottToasts toasts={fallbackToast.toasts} onDismiss={fallbackToast.dismiss} />
      )}
    </div>
  );
}
