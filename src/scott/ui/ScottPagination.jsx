// Server-side pagination control for Scott lists.
//
// `src/orderPagination.jsx` is deliberately NOT reused: it slices a client-side array and
// persists its own page size. Scott lists are paginated upstream, so page/pageSize/total are
// owned by `useScottList`. The visual language below matches `OrdersPagination` /
// `OrdersPerPageControl` so the two never look like different apps.

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Page sizes offered by every Scott list. 1000/10000 exist for "fetch-all" style exports. */
export const SCOTT_PAGE_SIZE_OPTIONS = Object.freeze([10, 20, 50, 100, 1000, 10000]);

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Server-pagination footer: page size select on the left, range + prev/next on the right.
 *
 * INEXACT TOTALS ARE THE NORMAL CASE, NOT AN EDGE CASE. When a Scott response carries no
 * Rails pagy block, `buildScottPaginatedMeta` can only report a lower bound —
 * `totalCount = page*pageSize`, `totalPages = page+1`, `totalCountIsExact:false`. Re-deriving
 * `ceil(total/pageSize)` from that lower bound yields exactly the current page, which
 * disabled Next on page 1 and made every such endpoint unpageable. So the truth about
 * "is there more?" comes from `hasNextPage` (`hasNextScottPage`: a full page means probe the
 * next one), never from an arithmetic guess, and an inexact range renders as
 * `"{start}–{end} (page N)"` rather than claiming a total it does not know.
 *
 * @param {object} props
 * @param {number} [props.page=1] current 1-based page (from `useScottList`).
 * @param {number} [props.pageSize=20] rows per page.
 * @param {number} [props.total=0] total row count reported by the API (a LOWER BOUND when
 *   `totalCountIsExact` is false).
 * @param {number} [props.totalPages] page count from `useScottList`; falls back to
 *   `ceil(total/pageSize)`.
 * @param {boolean} [props.totalCountIsExact=true] false when the response carried no pagy block.
 * @param {boolean} [props.hasNextPage] authoritative next-page signal (`hasNextScottPage`).
 *   Falls back to `page < totalPages` when not supplied.
 * @param {(page: number) => void} [props.onPageChange] `setPage`.
 * @param {(size: number) => void} [props.onPageSizeChange] `setPageSize`.
 * @param {number[]} [props.pageSizeOptions] override the size list.
 * @param {boolean} [props.loading=false] disables the controls and softens the range text.
 * @param {boolean} [props.disabled=false] hard-disable every control.
 * @param {boolean} [props.showFirstLast=true] render the jump-to-first/last buttons.
 * @param {string} [props.idPrefix="scott"] prefix for the generated input ids.
 * @param {string} [props.itemLabel="records"] noun used in the "No records to show" empty text.
 * @param {string} [props.className] extra classes on the footer row.
 */
export default function ScottPagination({
  page = 1,
  pageSize = 20,
  total = 0,
  totalPages: totalPagesProp,
  totalCountIsExact = true,
  hasNextPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = SCOTT_PAGE_SIZE_OPTIONS,
  loading = false,
  disabled = false,
  showFirstLast = true,
  idPrefix = "scott",
  itemLabel = "records",
  className
}) {
  const safeSize = toPositiveInt(pageSize, 20);
  const numericTotal = Number(total);
  const safeTotal = Number.isFinite(numericTotal) && numericTotal > 0 ? Math.floor(numericTotal) : 0;
  const exact = totalCountIsExact !== false;

  const derivedTotalPages = Math.max(1, Math.ceil(safeTotal / safeSize));
  const reportedTotalPages = toPositiveInt(totalPagesProp, 0);
  const totalPages = reportedTotalPages > 0 ? reportedTotalPages : derivedTotalPages;

  // Only an exact total may clamp the page — clamping against a lower bound is what used to
  // pin the user to page 1.
  const requestedPage = Math.max(1, toPositiveInt(page, 1));
  const safePage = exact ? Math.min(requestedPage, totalPages) : requestedPage;

  const start = safeTotal === 0 ? 0 : (safePage - 1) * safeSize + 1;
  const end = exact ? Math.min(safeTotal, safePage * safeSize) : safePage * safeSize;

  const canNext = hasNextPage === undefined ? safePage < totalPages : hasNextPage === true;
  // With an unknown end there is no "last page" to jump to, only "one more".
  const maxPage = exact ? totalPages : canNext ? safePage + 1 : safePage;

  const locked = disabled || loading;
  const selectId = `${idPrefix}-page-size`;

  // Always offer the active size even when it came from a config outside the option list.
  const options = Array.from(new Set([...(pageSizeOptions || []), safeSize])).sort((a, b) => a - b);

  const goto = (next) => {
    if (locked || typeof onPageChange !== "function") return;
    const clamped = Math.min(Math.max(1, next), maxPage);
    if (clamped !== safePage) onPageChange(clamped);
  };

  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3", className)}
      role="navigation"
      aria-label="Pagination"
    >
      <div className="flex items-center gap-2">
        <Label htmlFor={selectId} className="text-sm font-normal text-muted-foreground">
          View
        </Label>
        <Select
          value={String(safeSize)}
          onValueChange={(next) => onPageSizeChange?.(toPositiveInt(next, 20))}
          disabled={locked || typeof onPageSizeChange !== "function"}
        >
          <SelectTrigger id={selectId} className="h-8 w-[5.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size.toLocaleString("en-IN")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">/ page</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("text-sm text-muted-foreground", loading && "opacity-60")}>
          {loading
            ? "Loading…"
            : safeTotal === 0
              ? `No ${itemLabel} to show`
              : exact
                ? `Showing ${start.toLocaleString("en-IN")}–${end.toLocaleString("en-IN")} of ${safeTotal.toLocaleString("en-IN")}`
                : `Showing ${start.toLocaleString("en-IN")}–${end.toLocaleString("en-IN")} (page ${safePage.toLocaleString("en-IN")})`}
        </span>

        <div className="flex items-center gap-2">
          {showFirstLast ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => goto(1)}
              disabled={locked || safePage <= 1}
              aria-label="First page"
            >
              <ChevronsLeft className="size-4" />
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goto(safePage - 1)}
            disabled={locked || safePage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">Prev</span>
          </Button>

          <span className="whitespace-nowrap text-sm tabular-nums">
            Page <strong>{safePage.toLocaleString("en-IN")}</strong>
            {exact ? ` of ${totalPages.toLocaleString("en-IN")}` : null}
          </span>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goto(safePage + 1)}
            disabled={locked || !canNext}
            aria-label="Next page"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4" />
          </Button>

          {showFirstLast ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => goto(totalPages)}
              // An inexact total has no known last page, so there is nowhere to jump to.
              disabled={locked || !exact || safePage >= totalPages}
              aria-label="Last page"
            >
              <ChevronsRight className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
