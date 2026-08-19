// One master, fully wired: `useScottList` + `ScottListPage` + `ScottEntityDialog`, plus the
// three bulk affordances from `src/scott/bulk/**`.
//
// Everything entity-specific already lives in the config and its service, so this file only
// connects them:
//
//   list        config -> useScottList({ fetchPage: service.listPage, fetchAll: service.listAll })
//   create      ScottEntityDialog -> service.create -> relation PATCHes -> toast + refresh
//   edit        row -> service.getById (prefill) -> service.update -> relation PATCHes
//   delete      ScottListPage's window.confirm -> service.remove -> toast + refresh
//   bulk edit   header action -> ScottMasterBulkEditPanel (ScottBulkEditGrid + batchSave)
//   import CSV  header action -> ScottMasterCsvImportDialog (runCsvImport, or the
//               server-side bulk_upload + polling for rmp_prices)
//   bulk delete row selection -> runMasterBulkDelete -> toast + refresh
//   export      header Export -> mastersExport (filtered+sorted rows, house CSV writer)
//
// WIRE FILTERS beyond `search` live here, not in `useScottList`: "Show inactive"
// (`config.supportsIncludeInactive`) and every `config.serverFilters` key (rmp_prices'
// `rmp_sku_id`). Both go into `service.listPage`/`listAll`, where `buildListQuery` decides
// what they mean, and both ask for their own refetch when they change.
//
// RELATION MULTISELECTS (`fabric_ids`, `add_on_ids`, `rmp_category_ids`, …) are saved by a
// SECOND request after the record exists — see `mastersRelationWrites.js`. Body multiselects
// (fabrics `color_ids`) travel inside the create/update payload instead; `toWriteForm` is
// what tells the two apart.
//
// BULK DELETE IS HIDDEN, NOT DISABLED, where it does not exist. `supportsMasterBulkDelete`
// requires BOTH the config flag and `bulkDeleteService`'s own resource list, which drops
// `base_product_types` (its DELETE never carries a body, so `ids[]` would vanish). Passing
// no `onBulkDelete` also drops the row checkboxes — `ScottListPage` derives `selectable`
// from it — so a master without the endpoint offers no selection UI at all.
//
// `mayEdit === false` hides every write action: no create button, no delete, no bulk bar, no
// bulk edit / import actions, and the dialog opens read-only (`ScottListPage` already
// relabels its row button "View").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Table2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { runMasterBulkDelete, summarizeBulkDelete } from "@/scott/bulk/bulkDeleteService";
import { summarizeImport } from "@/scott/bulk/csvImportService";
import { getMastersService } from "@/scott/data/masterConfigs";
import { describeScottTruncation } from "@/scott/scottPagination";
import { useScottList } from "@/scott/list/useScottList";
import {
  bulkColumnsFor,
  supportsMasterBulkDelete,
  usesServerBulkUpload
} from "@/scott/masters/mastersBulkColumns";
import { dialogFieldsFor, toWriteForm } from "@/scott/masters/mastersDialogFields";
import { exportMasterCsv, resolveMasterExportRows } from "@/scott/masters/mastersExport";
import { columnOptionResourcesFor, decorateMasterColumns } from "@/scott/masters/mastersListColumns";
import {
  planRelationWrites,
  runRelationWrites,
  summarizeRelationFailures
} from "@/scott/masters/mastersRelationWrites";
import ScottMasterBulkEditPanel from "@/scott/masters/ScottMasterBulkEditPanel";
import ScottMasterCsvImportDialog from "@/scott/masters/ScottMasterCsvImportDialog";
import { useMasterRelationOptions } from "@/scott/masters/useMasterRelationOptions";
import ScottAirtableSyncControl from "@/scott/ui/ScottAirtableSyncControl";
import ScottEntityDialog from "@/scott/ui/ScottEntityDialog";
import ScottListPage from "@/scott/ui/ScottListPage";

/** Radix Select forbids an empty item value, so "no filter" needs a sentinel. */
const SERVER_FILTER_ALL = "__all__";

function idOf(row, config) {
  const value = row?.[config?.idField || "id"] ?? row?.id;
  return value == null || value === "" ? "" : String(value);
}

/**
 * Append the config's documented recovery hint to a write error.
 *
 * rmp_categories / rmp_classes answer a soft-delete name collision with a bare "name has
 * already been taken"; `config.updateErrorHints` carries the rename-then-reactivate wording
 * that turns that dead end into an instruction (masters spec §18).
 *
 * @param {object} config
 * @param {string} message
 * @returns {string}
 */
export function applyMasterErrorHints(config, message) {
  const text = String(message ?? "");
  if (!text) return text;
  for (const hint of config?.updateErrorHints ?? []) {
    const needle = String(hint?.match ?? "").toLowerCase();
    if (needle && text.toLowerCase().includes(needle)) return `${text}${hint.append ?? ""}`;
  }
  return text;
}

/**
 * Server-side filters this master understands beyond `search` (`config.serverFilters`),
 * paired with the matching form field so the control gets a label and an option source.
 * rmp_prices is the only master with one today: `rmp_sku_id` → the SKU picker.
 */
export function serverFilterControlsFor(config) {
  const out = [];
  for (const key of config?.serverFilters ?? []) {
    const field = (config?.fields ?? []).find((entry) => entry?.key === key);
    out.push({
      key,
      label: field?.label || key,
      optionsResource: field?.optionsResource || null
    });
  }
  return out;
}

function nameOf(row, config) {
  const label = row?.name ?? row?.title ?? row?.label ?? row?.code ?? row?.sku ?? "";
  const text = String(label).trim();
  return text || `#${idOf(row, config)}` || config?.labelSingular || "record";
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * @param {object} props
 * @param {object} props.config a master config from `masterConfigs.js`.
 * @param {boolean} [props.mayEdit=false] `isAdmin || canEdit` — gates every write action.
 * @param {(message: string) => void} [props.onToast] success channel (the panel's toast stack).
 * @param {(error: unknown) => void} [props.onError] failure channel (same stack, error tone).
 */
export default function ScottMasterListScreen({ config: master, mayEdit = false, onToast, onError }) {
  const service = useMemo(() => getMastersService(master.key), [master.key]);

  // The configs name the singular form `labelSingular` (and leave it to `createMastersService`
  // to derive one when it is absent); `ScottListPage` and `ScottEntityDialog` both read
  // `singularLabel`. Bridging the two here keeps the buttons at "New brand" / "Add brand"
  // instead of "New Brands", without touching either shared component.
  const config = useMemo(
    () => (master.singularLabel ? master : { ...master, singularLabel: service.config.labelSingular }),
    [master, service]
  );

  /** rmp_categories / rmp_classes: widen the list to soft-deleted rows (spec §18/§19). */
  const supportsIncludeInactive = config.supportsIncludeInactive === true;
  const [includeInactive, setIncludeInactive] = useState(false);

  /** `config.serverFilters` — real query params, not client-side filtering. */
  const serverFilterControls = useMemo(() => serverFilterControlsFor(config), [config]);
  const [serverFilterValues, setServerFilterValues] = useState({});

  /**
   * Filters that go ON THE WIRE with every page/drain. `buildListQuery` is the authority for
   * what each master does with them.
   */
  const listFilters = useMemo(() => {
    const filters = {};
    if (supportsIncludeInactive && includeInactive) filters.includeInactive = true;
    for (const control of serverFilterControls) {
      const value = serverFilterValues[control.key];
      if (value) filters[control.key] = value;
    }
    return filters;
  }, [supportsIncludeInactive, includeInactive, serverFilterControls, serverFilterValues]);

  /**
   * DELETE CACHE SURGERY (`config.deleteRequiresCacheEviction`, spec §18).
   *
   * Scott only soft-deletes. With "Show inactive" on, refetching after a delete brings the
   * row straight back and the delete looks like it failed. Upstream filters the id out of
   * every cached page before invalidating; this port has no query cache, so the deleted ids
   * are held here and filtered out of whatever the list hands back. The set is dropped
   * whenever the wire filters change (that is a fresh question to the server) and when the
   * master is swapped (the screen is keyed on it and remounts).
   */
  const [evictedIds, setEvictedIds] = useState(() => new Set());

  const fetchPage = useCallback(
    ({ page, items, search }) => service.listPage({ page, items, search, ...listFilters }),
    [service, listFilters]
  );

  const fetchAll = useCallback(
    // `useScottList` hands us the drain options it resolved from `config.fetchAllOptions` —
    // which the registry publishes as an alias of `config.fetchAll`, the very object
    // `mastersService` reads inside `listAll`. So rmp_skus still drains 100 rows a page and
    // rmp_prices 1000, and passing them again here would only land in the query string.
    // The one option that DOES have to travel is `onTruncated`: `listAll` forwards it into
    // `fetchAllScottPages`, which is the only place that knows the maxPages cap was hit.
    (options) => service.listAll(listFilters, { onTruncated: options?.onTruncated }),
    [service, listFilters]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogRecord, setDialogRecord] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Relation dropdowns are drained on demand; `rmp_prices` -> `rmp_skus` is far too heavy to
  // pay for on mount, so nothing loads until the first dialog opens.
  const [optionsWanted, setOptionsWanted] = useState(false);
  const detailSeqRef = useRef(0);

  /** 'list' | 'bulk' — bulk replaces the whole content area with the grid. */
  const [mode, setMode] = useState("list");
  const [importOpen, setImportOpen] = useState(false);

  /** rmp_prices only: Scott owns the matching, so no relation options are needed for it. */
  const serverUpload = usesServerBulkUpload(config);
  /**
   * Relation COLUMNS are the one option source that cannot wait for a dialog: ten masters
   * store a bare FK (`add_on_id`, `rmp_class_id`, …) and the table would print the raw id.
   * Field options stay lazy; multiselect options only join once a dialog has been opened.
   */
  const optionsNeeded = optionsWanted || mode === "bulk" || (importOpen && !serverUpload);

  const needsColumnOptions = useMemo(() => columnOptionResourcesFor(config).length > 0, [config]);

  const {
    optionsByResource,
    loading: optionsLoading
  } = useMasterRelationOptions(config, {
    enabled: optionsNeeded || needsColumnOptions,
    includeMultiselect: optionsWanted,
    includeColumns: true
  });

  const dialogFields = useMemo(
    () => dialogFieldsFor(config, optionsByResource),
    [config, optionsByResource]
  );

  /** Bulk-edit columns: the same `fields` array the dialog uses, in grid shape. */
  const bulkColumns = useMemo(
    () => bulkColumnsFor(config, optionsByResource),
    [config, optionsByResource]
  );

  /** Table columns with relation ids resolved to names (`[object Object]` / raw-id fix). */
  const listColumns = useMemo(
    () => decorateMasterColumns(config, optionsByResource),
    [config, optionsByResource]
  );

  /**
   * The config the LIST runs on — decorated columns included.
   *
   * `useScottList` derives its filterable columns from `config.columns`, and the relation
   * projection (`filterEngine.filterColumnValueGetter`) can only resolve a bare FK to a name
   * when the column carries the drained `options`. Feeding it the raw config instead would
   * leave the filter comparing against ids while the table shows names — which is exactly
   * the bug the decoration exists to prevent.
   */
  const listConfig = useMemo(
    () => (listColumns === config.columns ? config : { ...config, columns: listColumns }),
    [config, listColumns]
  );

  // `guardLargeDrain` is what stops one click on a sortable header from starting a
  // quarter-million-row drain. The threshold comes from the config (or the hook's default);
  // the decision is made from the server's reported total, so no entity is named here.
  const list = useScottList({ config: listConfig, fetchPage, fetchAll, guardLargeDrain: true });

  // A wire filter is not part of the hook's fetch deps (it only tracks page/size/search), so
  // changing one has to ask for the refetch itself.
  const filterSignature = JSON.stringify(listFilters);
  const filterSignatureRef = useRef(filterSignature);
  useEffect(() => {
    if (filterSignatureRef.current === filterSignature) return;
    filterSignatureRef.current = filterSignature;
    setEvictedIds((prev) => (prev.size === 0 ? prev : new Set()));
    list.refresh();
    // `list.refresh` is a stable useCallback; the signature is the only real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  /** The list, minus anything deleted under a "show inactive" query (see `evictedIds`). */
  const visibleList = useMemo(() => {
    if (!config.deleteRequiresCacheEviction || evictedIds.size === 0) return list;
    const rows = (list.rows ?? []).filter((row) => !evictedIds.has(idOf(row, config)));
    if (rows.length === (list.rows ?? []).length) return list;
    return { ...list, rows, total: Math.max(0, (list.total ?? 0) - (list.rows.length - rows.length)) };
  }, [config, evictedIds, list]);

  // Load failures also reach the toast stack — `ScottListPage` owns that now (it calls
  // `onError` once per distinct message), alongside its inline error card with the Retry
  // button. See the `onError` prop passed below.

  function openCreate() {
    setOptionsWanted(true);
    detailSeqRef.current += 1; // drop any detail fetch still in flight
    setDetailLoading(false);
    setDialogRecord(null);
    setDialogOpen(true);
  }

  async function openEdit(row) {
    setOptionsWanted(true);
    // Show the row we already have immediately, then swap in the fuller record.
    setDialogRecord(row ?? null);
    setDialogOpen(true);

    const id = idOf(row, config);
    if (!id) return;

    const seq = (detailSeqRef.current += 1);
    setDetailLoading(true);
    try {
      // `getById` honours the config: `detail.extract` unwraps the show response, and
      // `getByIdMode: 'find'` (7 masters have no usable show endpoint) resolves it from a
      // drained list instead — hence the row-shaped prefill above while this runs.
      const full = await service.getById(id);
      if (seq !== detailSeqRef.current) return;
      // MERGE, never replace. The row we already showed is real data; the show response is
      // only ever meant to ADD to it (relations, fields the list omits). Replacing outright
      // means any key the show payload lacks blanks a field the user was already looking at —
      // which is exactly how "the edit dialog fills in, then empties" happens. Undefined and
      // null values are skipped for the same reason; a real clear comes back as "" or false.
      if (full) {
        setDialogRecord((current) => {
          const base = current ?? row ?? {};
          const merged = { ...base };
          for (const [key, value] of Object.entries(full)) {
            if (value !== undefined && value !== null) merged[key] = value;
          }
          return merged;
        });
      }
    } catch (err) {
      if (seq !== detailSeqRef.current) return;
      onError?.(`Could not load the latest ${config.labelSingular || "record"}: ${messageOf(err)}`);
    } finally {
      if (seq === detailSeqRef.current) setDetailLoading(false);
    }
  }

  function closeDialog() {
    detailSeqRef.current += 1;
    setDetailLoading(false);
    setDialogOpen(false);
    setDialogRecord(null);
  }

  /**
   * Rejects on failure on purpose: the dialog catches it and shows its own Alert.
   *
   * Relation multiselects are NOT part of the body — after the record exists they go out as
   * their own PATCHes (`update_fabrics`, `update_categories`, …) with the FINAL id list.
   * Those run for create as well as update, and their failures are reported on the error
   * toast rather than rejecting: the record is already saved, and a second Save would
   * duplicate it. See `mastersRelationWrites.js`.
   */
  async function handleSubmit(values, record) {
    // `toWriteForm` re-homes picked files and strips the relation multiselects; the config's
    // ASYNC `toCreatePayload` / `toUpdatePayload` run (and are awaited) inside the service.
    const form = toWriteForm(config, values, record);
    const id = idOf(record, config);
    const relationPlan = planRelationWrites(config, values, record);

    let saved;
    let savedId;
    try {
      if (record && id) {
        saved = await service.update(id, form, record);
        savedId = idOf(saved, config) || id;
        onToast?.(`Updated ${nameOf(saved || record, config)}`);
      } else {
        saved = await service.create(form);
        savedId = idOf(saved, config);
        onToast?.(`Added ${nameOf(saved, config)}`);
      }
    } catch (err) {
      throw new Error(applyMasterErrorHints(config, messageOf(err)));
    }

    if (relationPlan.length > 0 && savedId) {
      const { failures } = await runRelationWrites(service, savedId, relationPlan);
      if (failures.length > 0) onError?.(summarizeRelationFailures(failures));
    }

    list.refresh();
  }

  /**
   * `ScottListPage` confirms first (house `window.confirm`) and does not catch — a rejection
   * here would surface as an unhandled promise rejection, so failures are reported inline.
   */
  async function handleDelete(row) {
    const id = idOf(row, config);
    if (!id) {
      onError?.(`This ${config.labelSingular || "record"} has no id to delete.`);
      return;
    }
    try {
      await service.remove(id);
      // Soft delete: with "Show inactive" on, the row comes straight back on the refetch
      // unless it is evicted here first (spec §18 cache surgery).
      if (config.deleteRequiresCacheEviction) {
        setEvictedIds((prev) => new Set(prev).add(id));
      }
      onToast?.(`Deleted ${nameOf(row, config)}`);
      list.refresh();
    } catch (err) {
      onError?.(applyMasterErrorHints(config, messageOf(err)));
    }
  }

  /**
   * One `DELETE {resource}/bulk_delete` with repeated `ids[]` — `runMasterBulkDelete` picks
   * that path whenever the config and `bulkDeleteService` agree, and falls back to batched
   * individual deletes otherwise (it never gets that far here: the action is hidden unless
   * the one-call endpoint exists). Deletes are SOFT, so the rows come back on any list that
   * includes inactive records.
   */
  async function handleBulkDelete(ids) {
    const targets = (ids || []).map((id) => String(id)).filter(Boolean);
    if (targets.length === 0) return;
    try {
      const result = await runMasterBulkDelete(service, targets);
      const message = summarizeBulkDelete(result, String(config.label || "records").toLowerCase());
      if (result.failures.length > 0) onError?.(message);
      else onToast?.(message);
      list.refresh();
    } catch (err) {
      onError?.(messageOf(err));
    }
  }

  const openBulkEdit = useCallback(() => {
    setOptionsWanted(true);
    setMode("bulk");
  }, []);

  /**
   * The grid confirms its own discard before calling `onClose` (and Esc goes through the same
   * path), so this must NOT confirm again — the panel's "Back to list" button and the panel
   * shell's master switch are the two entry points that ask.
   */
  const leaveBulkEdit = useCallback(() => {
    setMode("list");
    list.refresh();
  }, [list]);

  const handleBulkSaved = useCallback(() => {
    // The panel already toasted `summarizeBatchSave`; a clean save returns to the list.
    setMode("list");
    list.refresh();
  }, [list]);

  const handleImportComplete = useCallback(
    (result) => {
      const summary = summarizeImport(result);
      if (summary.tone === "error") onError?.(summary.message);
      else onToast?.(summary.message);
      list.refresh();
    },
    [list, onError, onToast]
  );

  /**
   * CSV of what the user is looking at — the FILTERED + SORTED set in 'full' mode, the
   * current page in plain 'server' mode — through the same writer the reports and the
   * customer directory use. Allowed for read-only users, like everywhere else.
   */
  const handleExport = useCallback(async () => {
    try {
      // Server mode has ONE page in memory; the export goes back to the wire for the rest
      // (the current search and the wire filters included) rather than writing 20 rows and
      // calling it a full export.
      let truncated = null;
      const rows = await resolveMasterExportRows({
        mode: visibleList.mode,
        processedRows: visibleList.processedRows,
        search: visibleList.debouncedSearch,
        service,
        listFilters,
        fetchAllOptions: config.fetchAllOptions,
        onTruncated: (meta) => {
          truncated = meta;
        }
      });
      if (rows.length === 0) {
        onToast?.("Nothing to export.");
        return;
      }
      const written = exportMasterCsv({ config, rows, columns: listColumns });
      const label = String(config.label || "records").toLowerCase();
      onToast?.(`Exported ${written.toLocaleString("en-IN")} ${label}.`);
      if (truncated) onError?.(describeScottTruncation(truncated, label));
    } catch (err) {
      onError?.(messageOf(err));
    }
  }, [config, listColumns, listFilters, onError, onToast, service, visibleList]);

  const canBulkDelete = mayEdit && supportsMasterBulkDelete(config);
  const subtitle = mayEdit
    ? `Scott master · ${config.resource}`
    : `Scott master · ${config.resource} — read-only access`;

  if (mode === "bulk") {
    return (
      <ScottMasterBulkEditPanel
        config={config}
        service={service}
        columns={bulkColumns}
        columnsLoading={optionsLoading}
        onClose={leaveBulkEdit}
        onSaved={handleBulkSaved}
        onToast={onToast}
        onError={onError}
      />
    );
  }

  /** "Show inactive" (rmp_categories / rmp_classes only) — a READ affordance, never gated. */
  const includeInactiveToggle = supportsIncludeInactive ? (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
      <Switch
        id={`scott-master-${config.key}-include-inactive`}
        checked={includeInactive}
        onCheckedChange={(next) => setIncludeInactive(next === true)}
        disabled={list.loading}
      />
      <Label
        htmlFor={`scott-master-${config.key}-include-inactive`}
        className="cursor-pointer whitespace-nowrap text-xs font-normal text-muted-foreground"
      >
        Show inactive
      </Label>
    </div>
  ) : null;

  /**
   * Real server filters (`config.serverFilters`) — rmp_prices' `rmp_sku_id` today. The
   * option list is drained on first open, never on mount: rmp_skus reads 100 rows a page.
   */
  const serverFilterBar =
    serverFilterControls.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {serverFilterControls.map((control) => {
          const entry = optionsByResource?.[control.optionsResource];
          const options = Array.isArray(entry?.options) ? entry.options : [];
          const value = serverFilterValues[control.key] || "";
          return (
            <Select
              key={control.key}
              value={value || SERVER_FILTER_ALL}
              onValueChange={(next) =>
                setServerFilterValues((prev) => ({
                  ...prev,
                  [control.key]: next === SERVER_FILTER_ALL ? "" : next
                }))
              }
              onOpenChange={(open) => {
                if (open) setOptionsWanted(true);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-56" aria-label={`Filter by ${control.label}`}>
                <SelectValue placeholder={`All ${String(control.label).toLowerCase()}s`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SERVER_FILTER_ALL}>
                  All {String(control.label).toLowerCase()}s
                </SelectItem>
                {entry?.loading ? (
                  <SelectItem value="__loading__" disabled>
                    Loading…
                  </SelectItem>
                ) : null}
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>
    ) : null;

  const entityLabel = String(config.label || "records").toLowerCase();

  /**
   * The drain stopped at its safety cap, so everything on screen — the rows, the count, the
   * sort, and any CSV written from here — covers only a prefix of the dataset. Silence was
   * the bug; this says so where the numbers are.
   */
  const truncationBanner = visibleList.truncation ? (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle>Partial data loaded</AlertTitle>
      <AlertDescription>{describeScottTruncation(visibleList.truncation, entityLabel)}</AlertDescription>
    </Alert>
  ) : null;

  /**
   * THE DRAIN GUARD PROMPT. Sorting and client-side filtering need the whole dataset, and on
   * the big masters that is a quarter of a million rows behind 250 requests. The hook parks
   * the list in server mode and hands the question over; nothing is fetched and no sort is
   * shown until the answer comes back.
   */
  const prompt = visibleList.fullDatasetPrompt;
  const promptTotal = prompt ? Number(prompt.total || 0).toLocaleString("en-IN") : "";
  const promptAction =
    prompt?.reason === "sort" ? "Sorting" : prompt?.reason === "search" ? "Searching" : "Filtering";

  const drainPromptDialog = prompt ? (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) visibleList.declineFullDataset?.();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Load all {promptTotal} {entityLabel}?</DialogTitle>
          <DialogDescription>
            {promptAction} this list happens in your browser, so every matching row has to be
            downloaded first — {prompt.totalIsExact ? "" : "about "}
            {promptTotal} {entityLabel}. That can take several minutes and a lot of memory.
            You can cancel and narrow the list with the search box or a wire filter instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => visibleList.declineFullDataset?.()}>
            Cancel
          </Button>
          <Button type="button" onClick={() => visibleList.confirmFullDataset?.()}>
            Load all {promptTotal}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <>
      <ScottListPage
        config={listConfig}
        list={visibleList}
        subtitle={subtitle}
        mayEdit={mayEdit}
        actions={
          <>
            {includeInactiveToggle}
            {mayEdit ? (
              <>
                <ScottAirtableSyncControl
                  mayEdit={mayEdit}
                  onToast={onToast}
                  onError={onError}
                  idPrefix={`scott-master-${config.key}`}
                />
                <Button type="button" variant="outline" size="sm" onClick={openBulkEdit}>
                  <Table2 className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Bulk edit</span>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileUp className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{serverUpload ? "Bulk upload" : "Import CSV"}</span>
                </Button>
              </>
            ) : null}
          </>
        }
        toolbarActions={serverFilterBar}
        onCreate={mayEdit ? openCreate : undefined}
        onEdit={openEdit}
        onDelete={mayEdit ? handleDelete : undefined}
        onBulkDelete={canBulkDelete ? handleBulkDelete : undefined}
        onExport={handleExport}
        onError={onError}
        emptyMessage={`No ${entityLabel} found on the Scott dashboard.`}
      >
        {truncationBanner}
      </ScottListPage>

      {drainPromptDialog}

      {/* Mounted only while open, and NOT keyed on the relation-option version.
          `ScottEntityDialog` fingerprints `field.options` in its own field-list memo, so a
          dropdown that mounted empty picks up the options as soon as they land. Remounting
          on every arrival used to reset the form up to five times (base_products drains five
          option masters) — mid-typing, silently discarding whatever had been entered. */}
      {dialogOpen ? (
        <ScottEntityDialog
          open
          config={config}
          fields={dialogFields}
          record={dialogRecord}
          readOnly={!mayEdit}
          idPrefix={`scott-master-${config.key}`}
          description={
            detailLoading || optionsLoading
              ? "Loading the latest values from Scott…"
              : undefined
          }
          onSubmit={handleSubmit}
          onClose={closeDialog}
        />
      ) : null}

      {mayEdit && importOpen ? (
        <ScottMasterCsvImportDialog
          config={config}
          service={service}
          open
          onOpenChange={(next) => setImportOpen(next === true)}
          optionsByResource={optionsByResource}
          optionsLoading={optionsLoading}
          onComplete={handleImportComplete}
        />
      ) : null}
    </>
  );
}
