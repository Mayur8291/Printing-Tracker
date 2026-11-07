import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { OrdersPerPageControl } from "@/orderPagination";

export default function InternalSupportHistoryFilters({
  dateFrom = "",
  dateTo = "",
  onDateFromChange,
  onDateToChange,
  onClearDates,
  searchQuery = "",
  onSearchQueryChange,
  nameFilter = "all",
  nameOptions = [],
  onNameFilterChange,
  showNameFilter = true,
  pageSize,
  onPageSizeChange
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor="internal-support-history-from">From</FieldLabel>
          <DatePicker
            id="internal-support-history-from"
            value={dateFrom}
            onChange={onDateFromChange}
            placeholder="From date"
            maxDate={dateTo || undefined}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="internal-support-history-to">To</FieldLabel>
          <DatePicker
            id="internal-support-history-to"
            value={dateTo}
            onChange={onDateToChange}
            placeholder="To date"
            minDate={dateFrom || undefined}
          />
        </Field>
        <Button type="button" variant="outline" size="sm" onClick={onClearDates}>
          Clear
        </Button>
        <Field className="min-w-[12rem] flex-1 sm:min-w-[16rem]">
          <FieldLabel htmlFor="internal-support-history-search">Search</FieldLabel>
          <Input
            id="internal-support-history-search"
            type="search"
            placeholder={showNameFilter ? "Name, issue, comment..." : "Issue, comment..."}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
          />
        </Field>
        {showNameFilter ? (
          <Field className="w-auto">
            <FieldLabel htmlFor="internal-support-history-name">Name</FieldLabel>
            <Select value={nameFilter} onValueChange={onNameFilterChange}>
              <SelectTrigger id="internal-support-history-name">
                <SelectValue placeholder="All names" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All names</SelectItem>
                  {nameOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </div>
      {pageSize != null && onPageSizeChange ? (
        <OrdersPerPageControl
          idPrefix="internal-support-history-per-page"
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}
