/**
 * Shared client-side pagination for any order list.
 * - Admin can set N orders per page (default 10). Saved per-tab to localStorage.
 * - When filters narrow the list and current page no longer exists, snap back to page 1.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

function readStoredPageSize(storageKey, fallback = DEFAULT_PAGE_SIZE) {
  if (typeof window === "undefined" || !storageKey) return fallback;
  try {
    const raw = window.localStorage.getItem(`orders-per-page:${storageKey}`);
    const n = Number.parseInt(raw ?? "", 10);
    if (Number.isFinite(n) && n > 0 && n <= 500) return n;
  } catch {
    /* ignore */
  }
  return fallback;
}

function persistPageSize(storageKey, value) {
  if (typeof window === "undefined" || !storageKey) return;
  try {
    window.localStorage.setItem(`orders-per-page:${storageKey}`, String(value));
  } catch {
    /* ignore */
  }
}

export function usePagination(items, storageKey, resetSignal, defaultPageSize = DEFAULT_PAGE_SIZE) {
  const safeItems = Array.isArray(items) ? items : [];
  const [pageSize, setPageSizeState] = useState(() => readStoredPageSize(storageKey, defaultPageSize));
  const [page, setPage] = useState(1);

  const total = safeItems.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  useEffect(() => {
    setPage(1);
  }, [resetSignal, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const visible = useMemo(() => {
    const start = (page - 1) * pageSize;
    return safeItems.slice(start, start + pageSize);
  }, [safeItems, page, pageSize]);

  function setPageSize(next) {
    const n = Number.parseInt(next, 10);
    const clean = Number.isFinite(n) && n > 0 ? Math.min(500, n) : DEFAULT_PAGE_SIZE;
    setPageSizeState(clean);
    persistPageSize(storageKey, clean);
  }

  return {
    visible,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  };
}

export function OrdersPerPageControl({ pageSize, onPageSizeChange, idPrefix = "orders-per-page" }) {
  const inputId = `${idPrefix}-input`;
  const listId = `${idPrefix}-options`;
  return (
    <div className="orders-per-page flex items-end gap-2">
      <Label htmlFor={inputId} className="text-sm font-normal text-muted-foreground">
        View
      </Label>
      <div className="orders-per-page-row flex items-center gap-1.5">
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          step={1}
          className="orders-per-page-input h-8 w-16 px-2"
          value={pageSize}
          list={listId}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onPageSizeChange(1);
              return;
            }
            onPageSizeChange(raw);
          }}
          onBlur={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(n) || n < 1) onPageSizeChange(10);
          }}
        />
        <span className="orders-per-page-suffix text-sm text-muted-foreground">/ page</span>
      </div>
      <datalist id={listId}>
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size} />
        ))}
      </datalist>
    </div>
  );
}

export function OrdersPagination({ page, totalPages, onPageChange, total, pageSize }) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="orders-pagination flex flex-wrap items-center justify-between gap-3" role="navigation" aria-label="Order list pages">
      <span className="orders-pagination-meta text-sm text-muted-foreground">
        {total === 0 ? "No orders to show" : `Showing ${start}\u2013${end} of ${total}`}
      </span>
      <div className="orders-pagination-controls flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="orders-pagination-btn"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
          Prev
        </Button>
        <span className="orders-pagination-page text-sm">
          Page <strong>{page}</strong> of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="orders-pagination-btn"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
