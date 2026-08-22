import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { OrdersPerPageControl } from "@/orderPagination";

export default function PurchaseOrderHistoryFilters({
  dateFrom = "",
  dateTo = "",
  onDateFromChange,
  onDateToChange,
  onClearDates,
  searchQuery = "",
  onSearchQueryChange,
  coordinator = "all",
  coordinatorOptions = [],
  onCoordinatorChange,
  pageSize,
  onPageSizeChange
}) {
  return (
    <div className="space-y-3 px-4 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="po-history-date-from">From</Label>
          <DatePicker
            id="po-history-date-from"
            value={dateFrom}
            onChange={onDateFromChange}
            placeholder="From date"
            className="min-w-[10.5rem]"
            maxDate={dateTo || undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-history-date-to">To</Label>
          <DatePicker
            id="po-history-date-to"
            value={dateTo}
            onChange={onDateToChange}
            placeholder="To date"
            className="min-w-[10.5rem]"
            minDate={dateFrom || undefined}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClearDates}>
          Clear
        </Button>
        <div className="grid min-w-[12rem] flex-1 gap-1.5 sm:min-w-[16rem]">
          <Label htmlFor="po-history-search">Search</Label>
          <Input
            id="po-history-search"
            type="search"
            placeholder="PO Number, supplier, coordinator..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-history-coordinator">Coordinator</Label>
          <Select value={coordinator} onValueChange={onCoordinatorChange}>
            <SelectTrigger id="po-history-coordinator" className="min-w-[13rem] bg-background">
              <SelectValue placeholder="All coordinators" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All coordinators</SelectItem>
                {coordinatorOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      {pageSize != null && onPageSizeChange ? (
        <OrdersPerPageControl
          idPrefix="po-history-per-page"
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}
