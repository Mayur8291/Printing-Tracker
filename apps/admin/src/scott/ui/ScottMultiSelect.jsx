// Multi-select control for id lists (`fabric_ids`, `rmp_category_ids`, `color_ids`, …).
//
// shadcn parts ONLY: Popover + a scrollable Checkbox list. `Command` / `cmdk` does NOT
// exist in this repo — never import it here (a missing import is a blank white screen,
// there is no error boundary).
//
// The value is always an array of STRING ids, in the order the user picked them, which is
// exactly what the relation sub-endpoints (`{'fabric_ids[0]': …}`) and the body builders
// (`indexedIds('color_ids', …)`) consume.
//
// Shape copied from the house multi-select in `src/scott/reports/ReportFilters.jsx` (the
// customer picker): Popover -> filter Input -> `ScrollArea` -> `<label>` rows each wrapping a
// Checkbox. The list only gets a ScrollArea (which needs a DEFINITE height — `max-h` leaves
// the Radix viewport unscrollable) once it is long enough to need one.

import { useMemo, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Longest list rendered without a filter box (rmp_categories, fabrics… all exceed it). */
const SEARCH_THRESHOLD = 8;

/** Option -> `{ value, label }`, tolerating a bare string or a `{ id, name }` row. */
export function normalizeMultiSelectOption(option) {
  if (option == null) return { value: "", label: "" };
  if (typeof option === "object") {
    const value = String(option.value ?? option.id ?? "");
    const label = String(option.label ?? option.name ?? value);
    return { value, label };
  }
  const value = String(option);
  return { value, label: value };
}

/** Always an array of non-empty string ids — objects contribute their `id`. */
export function toIdArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const id =
      item && typeof item === "object" ? String(item.id ?? item.value ?? "") : String(item ?? "");
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Popover checkbox list.
 *
 * @param {object} props
 * @param {string} [props.id] id of the trigger — the dialog label's htmlFor target.
 * @param {Array<string>} [props.value] selected ids.
 * @param {Array<{value: string, label: string}|string>} [props.options]
 * @param {(next: Array<string>) => void} [props.onChange] emits a fresh array of string ids.
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.placeholder] trigger text when nothing is selected.
 * @param {string} [props.emptyMessage] shown when there are no options at all.
 * @param {string} [props.searchPlaceholder]
 * @param {string} [props.className]
 */
export default function ScottMultiSelect({
  id,
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = "Choose…",
  emptyMessage = "No options found.",
  searchPlaceholder = "Filter…",
  className
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const items = useMemo(
    () => (Array.isArray(options) ? options : []).map(normalizeMultiSelectOption).filter((o) => o.value),
    [options]
  );

  const selected = useMemo(() => toIdArray(value), [value]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const labelById = useMemo(() => {
    const map = new Map();
    for (const item of items) map.set(item.value, item.label);
    return map;
  }, [items]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, term]);

  function toggle(optionValue) {
    if (disabled) return;
    const next = selectedSet.has(optionValue)
      ? selected.filter((entry) => entry !== optionValue)
      : [...selected, optionValue];
    onChange?.(next);
  }

  function clearAll(event) {
    event?.stopPropagation();
    if (disabled) return;
    onChange?.([]);
  }

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? labelById.get(selected[0]) || `#${selected[0]}`
        : `${selected.length} selected`;

  const rows = (list) => (
    <div className="p-1">
      {list.map((item) => (
        <label
          key={item.value}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <Checkbox
            checked={selectedSet.has(item.value)}
            onCheckedChange={() => toggle(item.value)}
            disabled={disabled}
          />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={(next) => (disabled ? undefined : setOpen(next === true))}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {summary}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        {/* z-[200]: this popover opens INSIDE `ScottEntityDialog`, whose content sits at
            z-50 — the same stack the house customer picker had to clear. */}
        <PopoverContent className="z-[200] w-[min(22rem,calc(100vw-3rem))] p-0" align="start">
          {items.length > SEARCH_THRESHOLD ? (
            <div className="border-b p-2">
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8"
              />
            </div>
          ) : null}

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>
          ) : visible.length > SEARCH_THRESHOLD ? (
            <ScrollArea className="h-64">{rows(visible)}</ScrollArea>
          ) : (
            rows(visible)
          )}

          {selected.length > 0 ? (
            <div className="flex items-center justify-between border-t p-2">
              <span className="text-xs text-muted-foreground">
                {selected.length.toLocaleString("en-IN")} selected
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                <X className="size-3.5" aria-hidden />
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.slice(0, 12).map((entry) => (
            <Badge key={entry} variant="secondary" className="max-w-full font-normal">
              <span className="truncate">{labelById.get(entry) || `#${entry}`}</span>
            </Badge>
          ))}
          {selected.length > 12 ? (
            <Badge variant="outline" className="font-normal">
              +{selected.length - 12} more
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
