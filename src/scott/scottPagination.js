// Drain every page of a Scott list endpoint.
//
// No timeouts, no retries, no dedup: any page error aborts the whole fetch (fail-fast),
// matching the rest of this transport layer.

import { SCOTT_MAX_PAGE_SIZE } from "./scottClient";

/** Fetch-all pulls 10000 rows per request by default, not the 20 used for UI paging. */
export const SCOTT_FETCH_ALL_PAGE_SIZE = SCOTT_MAX_PAGE_SIZE;
/** Safety cap on how many requests one drain may issue. */
export const SCOTT_FETCH_ALL_MAX_PAGES = 250;
/** Pages per batch. Batches run sequentially; pages inside a batch run in parallel. */
export const SCOTT_FETCH_ALL_CONCURRENCY = 5;

/**
 * @typedef {Object} ScottPaginatedResult
 * @property {unknown[]} data
 * @property {number} page
 * @property {number} pageSize
 * @property {number} totalCount
 * @property {number} totalPages
 * @property {boolean} totalCountIsExact
 */

/**
 * @typedef {Object} ScottDrainMeta
 * @property {unknown[]} rows        the rows actually fetched.
 * @property {boolean} truncated     true when `maxPages` stopped the drain early.
 * @property {number} fetchedRows    `rows.length`.
 * @property {number} fetchedPages   how many pages were actually requested.
 * @property {number} maxPages       the cap that applied.
 * @property {number} pageSize       rows per request.
 * @property {number} totalCount     upstream's count (0 when it did not report one).
 * @property {boolean} totalCountIsExact
 */

/**
 * @typedef {Object} FetchAllScottPagesOptions
 * @property {number} [pageSize]     rows per request (default 10000, clamped to 10000)
 * @property {number} [maxPages]     request cap (default 250)
 * @property {number} [concurrency]  pages per parallel batch (default 5)
 * @property {(meta: ScottDrainMeta) => void} [onTruncated]
 *   Called EXACTLY when `maxPages` cut the drain short, i.e. the returned array is a prefix
 *   of the dataset rather than the whole of it. Without this the truncation was completely
 *   silent: sorting, filtering, counting and CSV export all went on to operate on a partial
 *   set and reported the partial number as the answer. Callers are expected to surface it
 *   (the masters list raises a banner). Throwing from the callback is never desirable — it
 *   is invoked inside the drain's own try-free tail, so keep it a plain state setter.
 */

function clampPositiveInt(value, fallback, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.trunc(num), 1), max);
}

/**
 * Fetch every page and return the concatenated rows in page order, plus the drain metadata.
 *
 * This is `fetchAllScottPages` with the truncation flag still attached; the plain function
 * unwraps it (and fires `onTruncated`) for the many callers that only want rows.
 *
 * Page 1 runs alone so its meta can size the rest of the drain:
 * - exact totals   -> fetch `min(totalPages, maxPages)` pages
 * - inexact totals -> probe up to `maxPages` (requests are still issued up to the cap)
 *
 * Callers routinely override the defaults — e.g. `{ pageSize: 500, maxPages: 50 }` for
 * reports whose upstream rejects very large page sizes.
 *
 * @param {(params: { page: number, items: number }) => Promise<ScottPaginatedResult>} fetchPage
 * @param {FetchAllScottPagesOptions} [options]
 * @returns {Promise<ScottDrainMeta>}
 */
export async function fetchAllScottPagesWithMeta(fetchPage, options) {
  const pageSize = clampPositiveInt(
    options?.pageSize ?? SCOTT_FETCH_ALL_PAGE_SIZE,
    SCOTT_FETCH_ALL_PAGE_SIZE,
    SCOTT_MAX_PAGE_SIZE
  );
  const maxPages = clampPositiveInt(
    options?.maxPages ?? SCOTT_FETCH_ALL_MAX_PAGES,
    SCOTT_FETCH_ALL_MAX_PAGES,
    Number.MAX_SAFE_INTEGER
  );
  const concurrency = clampPositiveInt(
    options?.concurrency ?? SCOTT_FETCH_ALL_CONCURRENCY,
    SCOTT_FETCH_ALL_CONCURRENCY,
    Number.MAX_SAFE_INTEGER
  );

  let first;
  try {
    first = await fetchPage({ page: 1, items: pageSize });
  } catch (e) {
    console.error("fetchAllScottPages: Error on page 1:", e);
    throw e;
  }

  const firstRows = first?.data ?? [];
  const totalCount = Number(first?.totalCount) || 0;
  const totalCountIsExact = first?.totalCountIsExact === true;
  const upstreamPages = Math.max(1, Number(first?.totalPages) || 1);

  const meta = (rows, fetchedPages, truncated) => ({
    rows,
    truncated,
    fetchedRows: rows.length,
    fetchedPages,
    maxPages,
    pageSize,
    totalCount,
    totalCountIsExact
  });

  // Short first page means there is nothing after it.
  if (firstRows.length < pageSize) return meta(firstRows, 1, false);
  if (totalCountIsExact && upstreamPages <= 1) return meta(firstRows, 1, false);

  // TRUNCATION, decided up front where the totals are known:
  //   exact totals   -> upstream says there are more pages than the cap allows;
  //   inexact totals -> the cap is all we have, so a still-full final page means "more".
  const truncatedByCap = totalCountIsExact ? upstreamPages > maxPages : false;

  const totalPages = totalCountIsExact ? Math.min(upstreamPages, maxPages) : maxPages;
  if (totalPages <= 1) return meta(firstRows, 1, truncatedByCap);

  // Indexed by page - 2 so results reassemble in page order regardless of batch timing.
  const resultsByPage = new Array(totalPages - 1);

  for (let start = 2; start <= totalPages; start += concurrency) {
    const batch = [];
    for (let page = start; page < start + concurrency && page <= totalPages; page += 1) {
      batch.push(page);
    }

    // Promise.all rejects on the first failure, which aborts the whole drain.
    await Promise.all(
      batch.map(async (page) => {
        try {
          const result = await fetchPage({ page, items: pageSize });
          resultsByPage[page - 2] = result?.data ?? [];
        } catch (e) {
          console.error(`fetchAllScottPages: Error on page ${page}:`, e);
          throw e;
        }
      })
    );
  }

  // Built by index (never spread directly — `resultsByPage` starts sparse).
  const pages = [firstRows];
  let lastPageWasFull = firstRows.length >= pageSize;
  let fetchedPages = 1;
  for (let i = 0; i < resultsByPage.length; i += 1) {
    const rows = resultsByPage[i];
    if (!rows) continue;
    fetchedPages += 1;
    lastPageWasFull = rows.length >= pageSize;
    if (rows.length > 0) pages.push(rows);
  }

  // With inexact totals the only evidence of "there is more" is that the page we stopped on
  // came back full — a short page proves we reached the end inside the cap.
  const truncated = truncatedByCap || (!totalCountIsExact && fetchedPages >= maxPages && lastPageWasFull);
  return meta(pages.flat(), fetchedPages, truncated);
}

/**
 * Fetch every page and return the concatenated rows in page order.
 *
 * Truncation is NOT silent: when `maxPages` cuts the drain short, `options.onTruncated`
 * receives the drain metadata before the rows are returned. Callers that pass no callback
 * behave exactly as before (rows only) — use `fetchAllScottPagesWithMeta` when the flag
 * matters more than the ergonomics.
 *
 * Page 1 runs alone so its meta can size the rest of the drain:
 * - exact totals   -> fetch `min(totalPages, maxPages)` pages
 * - inexact totals -> probe up to `maxPages` (requests are still issued up to the cap)
 *
 * Callers routinely override the defaults — e.g. `{ pageSize: 500, maxPages: 50 }` for
 * reports whose upstream rejects very large page sizes.
 *
 * @param {(params: { page: number, items: number }) => Promise<ScottPaginatedResult>} fetchPage
 * @param {FetchAllScottPagesOptions} [options]
 * @returns {Promise<unknown[]>}
 */
export async function fetchAllScottPages(fetchPage, options) {
  const result = await fetchAllScottPagesWithMeta(fetchPage, options);
  if (result.truncated && typeof options?.onTruncated === "function") {
    options.onTruncated(result);
  }
  return result.rows;
}

/**
 * One sentence a user can act on, for the truncation banner.
 * @param {ScottDrainMeta} meta
 * @param {string} [label] plural noun for the entity ("prices", "records").
 * @returns {string}
 */
export function describeScottTruncation(meta, label = "records") {
  const fetched = Number(meta?.fetchedRows) || 0;
  const shown = fetched.toLocaleString("en-IN");
  const total =
    meta?.totalCountIsExact && Number(meta?.totalCount) > 0
      ? Number(meta.totalCount).toLocaleString("en-IN")
      : null;
  const of = total ? ` of ${total}` : "";
  return (
    `Only the first ${shown}${of} ${label} could be loaded (the ${meta?.maxPages ?? 0}-request ` +
    "safety cap was reached). Sorting, filtering, counts and CSV export below cover just those " +
    "rows — narrow the list with a search or a wire filter to see the rest."
  );
}

/**
 * Same drain, reduced to the `id` of every row.
 * @param {(params: { page: number, items: number }) => Promise<ScottPaginatedResult>} fetchPage
 * @param {FetchAllScottPagesOptions} [options]
 * @returns {Promise<string[]>}
 */
export async function fetchAllRecordIds(fetchPage, options) {
  const rows = await fetchAllScottPages(fetchPage, options);
  return rows.map((row) => row?.id);
}
