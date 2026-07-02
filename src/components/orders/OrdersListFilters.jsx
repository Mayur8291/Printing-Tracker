import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { OrdersPerPageControl } from "@/orderPagination";

export default function OrdersListFilters({
  className,
  dateFrom = "",
  dateTo = "",
  onDateFromChange,
  onDateToChange,
  onClearDates,
  clearDatesLabel = "Clear dates",
  showDates = true,
  searchQuery,
  onSearchQueryChange,
  onClearSearch,
  searchLabel = "Search",
  searchPlaceholder = "Order #, customer, coordinator…",
  searchInputMode,
  showSearch = false,
  pageSize,
  onPageSizeChange,
  idPrefix = "orders",
  showPerPage = true,
  extraActions = null
}) {
  const searchTrimmed = String(searchQuery ?? "").trim();

  return (
    <div className={cn("table-filters linked-tab-filters flex flex-wrap items-end gap-3", className)}>
      {showDates ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-date-from`}>From</Label>
            <DatePicker
              id={`${idPrefix}-date-from`}
              value={dateFrom}
              onChange={onDateFromChange}
              placeholder="From date"
              className="min-w-[10.5rem]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-date-to`}>To</Label>
            <DatePicker
              id={`${idPrefix}-date-to`}
              value={dateTo}
              onChange={onDateToChange}
              placeholder="To date"
              className="min-w-[10.5rem]"
            />
          </div>
          {onClearDates ? (
            <Button type="button" variant="outline" size="sm" onClick={onClearDates}>
              {clearDatesLabel}
            </Button>
          ) : null}
        </>
      ) : null}
      {showSearch ? (
        <div className="grid min-w-[12rem] flex-1 gap-1.5 sm:min-w-[16rem]">
          <Label htmlFor={`${idPrefix}-search`}>{searchLabel}</Label>
          <Input
            id={`${idPrefix}-search`}
            type="search"
            placeholder={searchPlaceholder}
            value={searchQuery ?? ""}
            inputMode={searchInputMode}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
          />
        </div>
      ) : null}
      {showSearch && searchTrimmed && onClearSearch ? (
        <Button type="button" variant="outline" size="sm" onClick={onClearSearch}>
          Clear search
        </Button>
      ) : null}
      {extraActions}
      {showPerPage && pageSize != null && onPageSizeChange ? (
        <OrdersPerPageControl idPrefix={`${idPrefix}-per-page`} pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
      ) : null}
    </div>
  );
}
