import * as React from "react"
import { format, isValid, parseISO, startOfDay } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

function parseDateValue(value) {
  if (!value) return undefined
  const parsed = parseISO(value)
  return isValid(parsed) ? startOfDay(parsed) : undefined
}

function formatDateValue(date) {
  if (!date || !isValid(date)) return ""
  return format(date, "yyyy-MM-dd")
}

function DatePicker({
  id,
  value = "",
  onChange,
  placeholder = "Pick a date",
  required = false,
  disabled = false,
  className,
  fromYear = 2020,
  toYear = new Date().getFullYear() + 5,
  minDate,
  maxDate,
}) {
  const [open, setOpen] = React.useState(false)
  const selected = parseDateValue(value)
  const min = parseDateValue(minDate)
  const max = parseDateValue(maxDate)

  const isDayDisabled = React.useCallback(
    (date) => {
      const day = startOfDay(date)
      if (min && day < min) return true
      if (max && day > max) return true
      return false
    },
    [min, max]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-start px-3 text-left font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0 opacity-60" />
          {selected ? format(selected, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="calendar-popover z-[200] w-auto p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
      >
        <Calendar
          mode="single"
          selected={selected}
          disabled={min || max ? isDayDisabled : undefined}
          onSelect={(date) => {
            onChange?.(formatDateValue(date))
            setOpen(false)
          }}
          className="rounded-md border shadow-sm"
          captionLayout="dropdown"
          fromYear={fromYear}
          toYear={toYear}
          initialFocus
        />
      </PopoverContent>
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          value={value}
          required={required}
          onChange={() => {}}
        />
      ) : null}
    </Popover>
  )
}

export { DatePicker, parseDateValue, formatDateValue }
