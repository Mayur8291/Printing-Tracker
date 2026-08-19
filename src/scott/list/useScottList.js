// The hybrid list pipeline — one hook behind every Scott master list and report list.
//
// Scott's API can only page and (on masters) free-text search. Everything else — advanced
// filters, quick filters, column sort — has to happen in the browser, which means the list
// runs in one of two modes:
//
//   'server'  no filter and no sort: fetch ONE page (`page`/`items`/`search`) and render it;
//             the pagination meta comes from the response's Rails pagy block.
//   'full'    the moment ANY filter or sort turns on: drain every page once (`fetchAll`),
//             then search + filter + sort + paginate entirely in memory.
//
// Switching to 'full' is deliberately eager — a sort over one server page would be a lie.
// The drained dataset is cached until `refresh()` (or a config swap) invalidates it, so
// paging and re-sorting inside 'full' mode cost nothing.
//
// THE DRAIN GUARD. Eager is fine at 200 rows and catastrophic at 200,000: on rmp_prices every
// column is sortable, and one click on a header used to start a 250-request drain that hangs
// or kills the tab. So a caller may pass `guardLargeDrain: true`. When it is on, and the
// server already told us the dataset is bigger than `largeDrainThreshold`, the switch to
// 'full' does NOT happen on its own: the list stays in 'server' mode and publishes
// `fullDatasetPrompt` for the screen to confirm. `confirmFullDataset()` proceeds;
// `declineFullDataset()` puts the client-side state back the way it was, so the header never
// shows a sort that is not applied. The guard is driven purely by the reported total — no
// entity names anywhere — so every large master benefits and small ones never see it.
// Callers that pass nothing keep the original eager behaviour.
//
// No react-query in this repo: plain useState/useEffect/useMemo/useCallback.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCOTT_DEFAULT_PAGE_SIZE, SCOTT_MAX_PAGE_SIZE, hasNextScottPage } from "../scottClient";
import {
  SCOTT_FETCH_ALL_MAX_PAGES,
  SCOTT_FETCH_ALL_PAGE_SIZE,
  fetchAllRecordIds,
  fetchAllScottPages
} from "../scottPagination";
import {
  applyFilterGroup,
  countFilterConditions,
  createEmptyFilterGroup,
  filterRowsBySearch,
  isFilterGroupActive,
  scottFilterColumnsFor
} from "./filterEngine";
import {
  applyQuickFilters,
  countQuickFilters,
  createEmptyQuickFilterValues,
  isQuickFilterActive
} from "./quickFilters";
import {
  EMPTY_SORT_STATE,
  getSortDirection as readSortDirection,
  isSortActive as readSortActive,
  nextSortDirection,
  sortRows
} from "./tableSort";

/** Search is debounced everywhere by the same amount. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Above this many known rows, switching into 'full' mode asks first (when the caller opted
 * into the guard). Chosen so that ordinary masters — every one of them is in the hundreds —
 * never prompt, while rmp_prices (250k) and rmp_skus (25k) always do. A config may override
 * it with `largeDrainThreshold`.
 */
export const SCOTT_LARGE_DRAIN_THRESHOLD = 5000;

/**
 * The whole drain-guard decision, as a pure function — the hook holds no logic of its own
 * here, so the rule can be exercised without a DOM.
 *
 * @param {object} args
 * @param {boolean} args.guardLargeDrain caller opted in (masters do; reports/customers do not).
 * @param {boolean} args.wantsFullDataset a filter / quick filter / sort / client search is on.
 * @param {boolean} args.approved the user already said yes for this dataset.
 * @param {number} args.drainedRowCount rows already in memory — never re-confirm those.
 * @param {number} args.knownTotal the server's count for the current query.
 * @param {number} args.threshold rows above which the drain must be confirmed.
 * @returns {{needsConfirm: boolean, needsFullDataset: boolean, mode: "full"|"server"}}
 */
export function resolveFullDatasetGuard({
  guardLargeDrain = false,
  wantsFullDataset = false,
  approved = false,
  drainedRowCount = 0,
  knownTotal = 0,
  threshold = SCOTT_LARGE_DRAIN_THRESHOLD
} = {}) {
  const limit = Number(threshold);
  const needsConfirm =
    guardLargeDrain === true &&
    wantsFullDataset === true &&
    approved !== true &&
    Number(drainedRowCount) === 0 &&
    Number.isFinite(limit) &&
    limit > 0 &&
    Number(knownTotal) > limit;

  const needsFullDataset = wantsFullDataset === true && !needsConfirm;
  return { needsConfirm, needsFullDataset, mode: needsFullDataset ? "full" : "server" };
}

/** Page sizes offered by the Scott pagination control. */
export const SCOTT_PAGE_SIZE_OPTIONS = Object.freeze([10, 20, 50, 100, 1000, 10000]);

function clampPageSize(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return SCOTT_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(num), 1), SCOTT_MAX_PAGE_SIZE);
}

function clampPage(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.trunc(num));
}

function normalizeSortState(sort) {
  const key = sort?.key;
  const direction = sort?.direction;
  if (!key || (direction !== "asc" && direction !== "desc")) return EMPTY_SORT_STATE;
  return { key: String(key), direction };
}

/** Plain slice of one client-side page. */
export function sliceClientPage(rows, page, pageSize) {
  const list = Array.isArray(rows) ? rows : [];
  const size = clampPageSize(pageSize);
  const start = (clampPage(page) - 1) * size;
  return list.slice(start, start + size);
}

/**
 * Client-side pagination meta, shaped exactly like a `ScottPaginatedResult` so the
 * pagination UI does not care which mode produced it. Totals are always exact here.
 * Returns null when there is nothing to page and nothing is loading (hides the pager).
 */
export function buildClientPaginationResult(rows, page, pageSize, isLoading) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0 && !isLoading) return null;

  const size = clampPageSize(pageSize);
  const current = clampPage(page);
  return {
    data: sliceClientPage(list, current, size),
    page: current,
    pageSize: size,
    totalCount: list.length,
    totalPages: Math.max(1, Math.ceil(list.length / size)),
    totalCountIsExact: true
  };
}

/** Tolerate a bare array from `fetchPage` as well as a full paginated result. */
function normalizeServerResult(result, page, pageSize) {
  const size = clampPageSize(pageSize);
  const current = clampPage(page);

  if (Array.isArray(result)) {
    return {
      data: result,
      page: current,
      pageSize: size,
      totalCount: result.length,
      totalPages: 1,
      totalCountIsExact: true
    };
  }

  const data = Array.isArray(result?.data) ? result.data : [];
  return {
    data,
    page: clampPage(result?.page ?? current),
    pageSize: clampPageSize(result?.pageSize ?? size),
    totalCount: Number(result?.totalCount) || 0,
    totalPages: Math.max(1, Number(result?.totalPages) || 1),
    totalCountIsExact: result?.totalCountIsExact === true
  };
}

/**
 * Per-entity drain overrides. Big lists cannot use the 10000-row default (rmp_skus reads
 * 100 at a time, customers 500), so a config may narrow both the page size and the cap.
 */
function resolveFetchAllOptions(config) {
  const explicit = config?.fetchAllOptions ?? {};
  const pageSize = clampPageSize(
    explicit.pageSize ?? config?.fetchAllPageSize ?? SCOTT_FETCH_ALL_PAGE_SIZE
  );
  const rawMaxPages = Number(explicit.maxPages ?? config?.fetchAllMaxPages ?? SCOTT_FETCH_ALL_MAX_PAGES);
  const maxPages = Number.isFinite(rawMaxPages)
    ? Math.max(1, Math.trunc(rawMaxPages))
    : SCOTT_FETCH_ALL_MAX_PAGES;

  const options = { pageSize, maxPages };
  const rawConcurrency = Number(explicit.concurrency ?? config?.fetchAllConcurrency);
  if (Number.isFinite(rawConcurrency)) options.concurrency = Math.max(1, Math.trunc(rawConcurrency));
  return options;
}

/**
 * @typedef {Object} UseScottListArgs
 * @property {Object} config
 *   Entity config (see `masterConfigs.js`). Read here:
 *   `key`, `idField`, `pageSize`, `columns` (sort + fallback filter columns),
 *   `filterColumns` (explicit `FilterableColumn[]`), `defaultSort`, `defaultFilters`,
 *   `defaultQuickFilters`, `toFilterRow(row)` (flatten nested data before filtering —
 *   must spread the original row), `getSearchDisplayValue(row, column)`,
 *   `fetchAllOptions: { pageSize, maxPages, concurrency }`.
 * @property {(params: {page:number, items:number, search:string}) => Promise<Object>} fetchPage
 *   One server page. `search` is '' when unset and is only ever sent in 'server' mode.
 * @property {(options: {pageSize:number, maxPages:number, concurrency?:number, onTruncated?:Function}) => Promise<unknown[]>} fetchAll
 *   Drain of the whole dataset (normally `fetchAllScottPages`). Never receives `search`.
 *   It is handed an `onTruncated` callback: forward it (mastersService's `listAll` does) and
 *   a capped drain surfaces as `truncation` instead of quietly returning a prefix.
 * @property {boolean} [guardLargeDrain=false]
 *   Opt in to the confirmation prompt described at the top of this file.
 * @property {number} [largeDrainThreshold]
 *   Overrides `SCOTT_LARGE_DRAIN_THRESHOLD` (also readable from `config.largeDrainThreshold`).
 */

/**
 * @param {UseScottListArgs} args
 */
export function useScottList({
  config,
  fetchPage,
  fetchAll,
  guardLargeDrain = false,
  largeDrainThreshold
} = {}) {
  const configKey = String(config?.key ?? "");
  const idField = config?.idField ?? "id";

  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => clampPageSize(config?.pageSize));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFiltersState] = useState(() => config?.defaultFilters ?? createEmptyFilterGroup());
  const [quickFilters, setQuickFiltersState] = useState(
    () => config?.defaultQuickFilters ?? createEmptyQuickFilterValues()
  );
  const [sort, setSortState] = useState(() => normalizeSortState(config?.defaultSort));
  const [selection, setSelection] = useState([]);

  const [serverResult, setServerResult] = useState(null);
  const [allRows, setAllRows] = useState([]);
  /** Set when a drain stopped at its `maxPages` cap — the rows below are a PREFIX. */
  const [truncation, setTruncation] = useState(null);
  /** The user said yes to draining a large dataset (see the drain guard above). */
  const [fullDatasetApproved, setFullDatasetApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // Callbacks live in refs so an un-memoized `fetchPage` from the caller cannot turn the
  // fetch effects into a render loop. Effect deps stay primitive on purpose.
  const fetchPageRef = useRef(fetchPage);
  const fetchAllRef = useRef(fetchAll);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
    fetchAllRef.current = fetchAll;
  });

  const requestSeqRef = useRef(0); // only the newest request may write state
  const loadedTokenRef = useRef(null); // reloadToken the drained dataset belongs to
  const silentRef = useRef(false); // set by refresh({ silent: true })
  const debouncedSearchRef = useRef("");

  // --- active-state flags -------------------------------------------------

  const filterActive = isFilterGroupActive(filters);
  const quickActive = isQuickFilterActive(quickFilters);
  const sortActive = readSortActive(sort);

  // WHERE SEARCH RUNS. Masters keep it upstream — `?search=` is the one query parameter the
  // Scott master endpoints honour, and letting the server do it keeps the list in cheap
  // 'server' mode. Report endpoints do NOT take `search` (all but three drop the param
  // silently), so a report that stayed in server mode would type a query and see the exact
  // same rows: a silent no-op. Those configs declare `searchMode: 'client'`, which makes a
  // non-empty query flip the list into 'full' mode and run through `filterRowsBySearch`
  // like every other client-side predicate.
  const clientSearch = config?.searchMode === "client";
  const searchActive = clientSearch && debouncedSearch.length > 0;

  /** What the UI has asked for. Whether it HAPPENS is the guard's call. */
  const wantsFullDataset = filterActive || quickActive || sortActive || searchActive;

  // The drain guard. `knownTotal` is the server's own count for the current query, which is
  // exactly the number the drain would have to pull, so the decision needs no entity names.
  // A dataset already in memory is never re-confirmed: paging and re-sorting inside 'full'
  // mode are free.
  const knownTotal = Number(serverResult?.totalCount) || 0;
  const drainThreshold = Number(
    largeDrainThreshold ?? config?.largeDrainThreshold ?? SCOTT_LARGE_DRAIN_THRESHOLD
  );
  const { needsConfirm: drainNeedsConfirm, needsFullDataset, mode } = resolveFullDatasetGuard({
    guardLargeDrain,
    wantsFullDataset,
    approved: fullDatasetApproved,
    drainedRowCount: allRows.length,
    knownTotal,
    threshold: drainThreshold
  });

  /**
   * While the prompt is up the sort/filters are STAGED, not applied — the list is still
   * showing unsorted server pages. Report them as inactive so the table header cannot draw
   * an arrow on a column that is not actually sorted.
   */
  const effectiveSort = drainNeedsConfirm ? EMPTY_SORT_STATE : sort;
  const effectiveSortActive = drainNeedsConfirm ? false : sortActive;

  /** Null unless the screen has to ask. Everything the prompt needs to word itself. */
  const fullDatasetPrompt = useMemo(() => {
    if (!drainNeedsConfirm) return null;
    return {
      total: knownTotal,
      totalIsExact: serverResult?.totalCountIsExact === true,
      threshold: drainThreshold,
      reason: sortActive ? "sort" : filterActive || quickActive ? "filter" : "search"
    };
  }, [
    drainNeedsConfirm,
    knownTotal,
    serverResult?.totalCountIsExact,
    drainThreshold,
    sortActive,
    filterActive,
    quickActive
  ]);

  /** "Yes, load all N rows." */
  const confirmFullDataset = useCallback(() => setFullDatasetApproved(true), []);

  const fetchAllOptions = useMemo(
    () => resolveFetchAllOptions(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config?.fetchAllOptions,
      config?.fetchAllPageSize,
      config?.fetchAllMaxPages,
      config?.fetchAllConcurrency
    ]
  );

  const sortColumns = useMemo(() => config?.columns ?? [], [config?.columns]);
  // `scottFilterColumnsFor` is shared with `ScottFilterBar` so the builder and the engine can
  // never read the same column under two different types. It also types `number` / `datetime`
  // / `badge` exactly as `tableSort` does, which is what makes the numeric, date and enum
  // operator sets reachable on the masters.
  const filterColumns = useMemo(
    () => scottFilterColumnsFor(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config?.filterColumns, config?.columns, config?.fields]
  );

  // --- search debounce (also the search half of the page reset) -----------

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = String(search ?? "").trim();
      if (debouncedSearchRef.current === next) return;
      debouncedSearchRef.current = next;
      setDebouncedSearch(next);
      setPage(1); // batched with the line above — one render, one fetch
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // --- setters that also reset the page ------------------------------------

  const setPageSize = useCallback((value) => {
    setPageSizeState((prev) => clampPageSize(typeof value === "function" ? value(prev) : value));
    setPage(1);
  }, []);

  const setFilters = useCallback((value) => {
    setFiltersState(value); // pass through so functional updates keep working
    setPage(1);
  }, []);

  const setQuickFilters = useCallback((value) => {
    setQuickFiltersState(value);
    setPage(1);
  }, []);

  const setSort = useCallback((value) => {
    setSortState(value);
    setPage(1);
  }, []);

  /** asc -> desc -> off. */
  const toggleSort = useCallback((key) => {
    if (!key) return;
    setSortState((prev) => nextSortDirection(prev, key));
    setPage(1);
  }, []);

  const clearSort = useCallback(() => {
    setSortState(EMPTY_SORT_STATE);
    setPage(1);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    debouncedSearchRef.current = "";
    setDebouncedSearch("");
    setFiltersState(createEmptyFilterGroup());
    setQuickFiltersState(createEmptyQuickFilterValues());
    setPage(1);
  }, []);

  /**
   * "No, don't." Rolls the staged client-side state back to nothing, which is the state the
   * list is actually rendering: server mode, page 1, no sort. Safe to call unconditionally —
   * the prompt only ever appears on a transition OUT of a clean server-mode list, so there is
   * never a previously-applied filter to lose here.
   */
  const declineFullDataset = useCallback(() => {
    setSortState(EMPTY_SORT_STATE);
    setFiltersState(createEmptyFilterGroup());
    setQuickFiltersState(createEmptyQuickFilterValues());
    if (clientSearch) {
      setSearch("");
      debouncedSearchRef.current = "";
      setDebouncedSearch("");
    }
    setPage(1);
  }, [clientSearch]);

  /** Re-run the current mode's fetch. `{ silent: true }` leaves loading/error alone. */
  const refresh = useCallback((opts) => {
    silentRef.current = opts?.silent === true;
    loadedTokenRef.current = null; // invalidate the drained dataset too
    setReloadToken((token) => token + 1);
  }, []);

  // --- server mode: one page ----------------------------------------------

  useEffect(() => {
    if (needsFullDataset) return undefined;

    const fetchOne = fetchPageRef.current;
    const silent = silentRef.current;
    silentRef.current = false;

    if (typeof fetchOne !== "function") {
      setLoading(false);
      return undefined;
    }

    const seq = (requestSeqRef.current += 1);
    let cancelled = false;
    const isCurrent = () => !cancelled && requestSeqRef.current === seq;

    if (!silent) {
      setLoading(true);
      setError("");
    }

    (async () => {
      try {
        const result = await fetchOne({ page, items: pageSize, search: debouncedSearch });
        if (!isCurrent()) return;
        setServerResult(normalizeServerResult(result, page, pageSize));
        if (silent) setError("");
      } catch (err) {
        if (!isCurrent()) return;
        setServerResult(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrent() && !silent) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsFullDataset, page, pageSize, debouncedSearch, reloadToken]);

  // --- full mode: drain once, then everything is in memory ------------------

  useEffect(() => {
    if (!needsFullDataset) return undefined;
    if (loadedTokenRef.current === reloadToken) return undefined; // already drained

    const drain = fetchAllRef.current;
    const silent = silentRef.current;
    silentRef.current = false;

    if (typeof drain !== "function") {
      setLoading(false);
      return undefined;
    }

    loadedTokenRef.current = reloadToken; // claim before awaiting
    const seq = (requestSeqRef.current += 1);
    let cancelled = false;
    const isCurrent = () => !cancelled && requestSeqRef.current === seq;

    if (!silent) {
      setLoading(true);
      setError("");
    }

    setTruncation(null); // this drain has not been capped yet

    (async () => {
      try {
        // A drain that hits its maxPages cap returns a PREFIX. `onTruncated` is the only
        // signal that happened; the screen turns it into a banner so nothing downstream
        // (sort, counts, CSV) claims to cover rows that were never fetched.
        const rows = await drain({
          ...fetchAllOptions,
          onTruncated: (meta) => {
            if (isCurrent()) setTruncation(meta);
          }
        });
        if (!isCurrent()) return;
        setAllRows(Array.isArray(rows) ? rows : []);
        if (silent) setError("");
      } catch (err) {
        if (!isCurrent()) return;
        loadedTokenRef.current = null; // let a later activation retry
        setAllRows([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrent() && !silent) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsFullDataset, reloadToken, fetchAllOptions]);

  // --- entity swap: this hook may be reused across configs -----------------

  const configKeyRef = useRef(configKey);
  useEffect(() => {
    if (configKeyRef.current === configKey) return;
    configKeyRef.current = configKey;

    requestSeqRef.current += 1; // drop in-flight responses from the previous entity
    loadedTokenRef.current = null;
    debouncedSearchRef.current = "";

    setPage(1);
    setPageSizeState(clampPageSize(config?.pageSize));
    setSearch("");
    setDebouncedSearch("");
    setFiltersState(createEmptyFilterGroup());
    setQuickFiltersState(createEmptyQuickFilterValues());
    setSortState(normalizeSortState(config?.defaultSort));
    setSelection([]);
    setServerResult(null);
    setAllRows([]);
    setTruncation(null);
    setFullDatasetApproved(false);
    setError("");
    setLoading(true);
    setReloadToken((token) => token + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // --- client pipeline (full mode only) ------------------------------------

  const projectedRows = useMemo(() => {
    const list = Array.isArray(allRows) ? allRows : [];
    const project = config?.toFilterRow;
    return typeof project === "function" ? list.map((row) => project(row)) : list;
  }, [allRows, config?.toFilterRow]);

  const processedRows = useMemo(() => {
    if (!needsFullDataset) return [];
    let out = projectedRows;
    // search -> advanced filter -> quick filters -> sort
    if (debouncedSearch) {
      out = filterRowsBySearch(out, debouncedSearch, filterColumns, config?.getSearchDisplayValue);
    }
    if (filterActive) out = applyFilterGroup(out, filters, filterColumns);
    if (quickActive) out = applyQuickFilters(out, quickFilters, filterColumns);
    if (sortActive) out = sortRows(out, sort, sortColumns);
    return out;
  }, [
    needsFullDataset,
    projectedRows,
    debouncedSearch,
    filterColumns,
    config?.getSearchDisplayValue,
    filterActive,
    filters,
    quickActive,
    quickFilters,
    sortActive,
    sort,
    sortColumns
  ]);

  // --- rows / pagination for the current mode -------------------------------

  const rows = useMemo(() => {
    if (needsFullDataset) return sliceClientPage(processedRows, page, pageSize);
    return serverResult?.data ?? [];
  }, [needsFullDataset, processedRows, page, pageSize, serverResult]);

  const pagination = useMemo(() => {
    if (needsFullDataset) return buildClientPaginationResult(processedRows, page, pageSize, loading);
    return serverResult;
  }, [needsFullDataset, processedRows, page, pageSize, loading, serverResult]);

  const total = needsFullDataset ? processedRows.length : (serverResult?.totalCount ?? 0);
  const totalPages = pagination?.totalPages ?? 1;
  const totalCountIsExact = needsFullDataset ? true : (serverResult?.totalCountIsExact ?? false);
  const hasNextPage = pagination ? hasNextScottPage(pagination) : false;
  const isEmpty = !loading && !error && rows.length === 0;

  // --- selection (bulk actions) ---------------------------------------------

  const pageRowIds = useMemo(
    () => rows.map((row) => String(row?.[idField] ?? "")).filter(Boolean),
    [rows, idField]
  );

  const isSelected = useCallback((id) => selection.includes(String(id)), [selection]);

  const toggleSelection = useCallback((id) => {
    const key = String(id);
    setSelection((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }, []);

  const clearSelection = useCallback(() => setSelection([]), []);

  /** Replaces the selection — used by "select all N matching" with resolved ids. */
  const selectIds = useCallback((ids) => {
    setSelection([...new Set((ids ?? []).map((id) => String(id)).filter(Boolean))]);
  }, []);

  /** "Select this page" — replaces the selection with exactly the visible rows. */
  const selectPage = useCallback(() => {
    selectIds(pageRowIds);
  }, [selectIds, pageRowIds]);

  /**
   * "Select all N matching" — the affordance the one-call `bulk_delete` endpoint exists for.
   * Without it a bulk delete can never reach past the page on screen.
   *
   *   full mode   the whole filtered set is already in memory: take its ids;
   *   server mode drain every page of the CURRENT query (search included, so the selection
   *               matches what the list is showing) and take the ids off the rows.
   *
   * Never throws — a failed drain lands on the list's own error channel and the selection is
   * left untouched, so nothing is silently half-selected before a destructive action.
   */
  const [isResolvingAll, setIsResolvingAll] = useState(false);
  const selectAllMatching = useCallback(async () => {
    if (needsFullDataset) {
      selectIds(processedRows.map((row) => row?.[idField]));
      return;
    }

    const fetchOne = fetchPageRef.current;
    if (typeof fetchOne !== "function") return;

    setIsResolvingAll(true);
    try {
      const drainPage = ({ page: pageNumber, items }) =>
        fetchOne({ page: pageNumber, items, search: debouncedSearch });
      // Same truncation contract as the full-mode drain: a capped "select all N matching"
      // must not present itself as covering everything before a destructive action.
      const drainOptions = { ...fetchAllOptions, onTruncated: (meta) => setTruncation(meta) };
      const ids =
        idField === "id"
          ? await fetchAllRecordIds(drainPage, drainOptions)
          : (await fetchAllScottPages(drainPage, drainOptions)).map((row) => row?.[idField]);
      selectIds(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResolvingAll(false);
    }
  }, [needsFullDataset, processedRows, idField, debouncedSearch, fetchAllOptions, selectIds]);

  /** Header checkbox: selects the page when partially selected, clears it when full. */
  const togglePageSelection = useCallback(() => {
    setSelection((prev) => {
      const allOnPage = pageRowIds.length > 0 && pageRowIds.every((id) => prev.includes(id));
      if (allOnPage) return prev.filter((id) => !pageRowIds.includes(id));
      return [...new Set([...prev, ...pageRowIds])];
    });
  }, [pageRowIds]);

  const pageSelectionState = useMemo(() => {
    if (pageRowIds.length === 0) return "none";
    const selectedOnPage = pageRowIds.filter((id) => selection.includes(id)).length;
    if (selectedOnPage === 0) return "none";
    return selectedOnPage === pageRowIds.length ? "all" : "some";
  }, [pageRowIds, selection]);

  return {
    // data
    rows,
    total,
    loading,
    error,
    isEmpty,

    // paging
    page,
    setPage,
    pageSize,
    setPageSize,
    pagination,
    totalPages,
    totalCountIsExact,
    hasNextPage,

    // search
    search,
    setSearch,
    debouncedSearch,

    // filters
    filters,
    setFilters,
    quickFilters,
    setQuickFilters,
    filterColumns,
    isFilterActive: filterActive || quickActive,
    activeFilterCount:
      countFilterConditions(filters) + countQuickFilters(quickFilters) + (debouncedSearch ? 1 : 0),
    clearAllFilters,

    // sort. `effectiveSort` is `sort` unless the drain prompt is up, in which case the
    // sort is staged and must not be drawn as applied.
    sort: effectiveSort,
    stagedSort: sort,
    setSort,
    toggleSort,
    clearSort,
    isSortActive: effectiveSortActive,
    getSortDirection: (key) => readSortDirection(effectiveSort, key),

    // mode + refresh
    mode,
    needsFullDataset,
    wantsFullDataset,
    allRows,
    processedRows, // the filtered+sorted set — what export must use, never just `rows`
    refresh,

    // drain guard
    fullDatasetPrompt,
    confirmFullDataset,
    declineFullDataset,

    // truncation (a drain that stopped at its maxPages cap)
    truncation,
    clearTruncation: () => setTruncation(null),

    // selection
    selection,
    setSelection,
    isSelected,
    toggleSelection,
    togglePageSelection,
    selectIds,
    selectPage,
    selectAllMatching,
    isResolvingAll,
    clearSelection,
    pageRowIds,
    pageSelectionState
  };
}

export default useScottList;
