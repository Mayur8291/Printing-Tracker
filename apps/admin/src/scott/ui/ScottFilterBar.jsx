// Search + quick chips + advanced filter builder for Scott lists.
//
// The search box is CONTROLLED here but debounced inside `useScottList` (300ms), so pass
// `search`/`setSearch` straight through — do not debounce a second time.
//
// `src/scott/list/filterEngine.js` is the SINGLE SOURCE OF TRUTH for the filter group shape
// and the operator catalogue. This file owns no operator list of its own; it imports the
// engine's and renders the input each operator needs. Canonical group shape:
//
//   { logic: "and" | "or", conditions: [{ id, field, operator, value }] }
//
// Value shapes per operator (from `defaultValueForOperator`):
//   NO_VALUE_OPERATORS  (is_empty, is_not_empty, is_true, is_false) -> null, no input
//   TWO_VALUE_OPERATORS (between, date_between)                     -> [a, b], two inputs
//   enum (is_any_of, is_none_of)                                    -> string[], checkbox list
//   everything else                                                 -> string, one input

import { useEffect, useState } from "react";
import { Filter, Plus, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  NO_VALUE_OPERATORS,
  OPERATORS_BY_TYPE,
  TWO_VALUE_OPERATORS,
  countFilterConditions,
  createEmptyFilterGroup,
  createFilterCondition,
  defaultOperatorForType,
  defaultValueForOperator,
  deserializeFilterGroup,
  isFilterGroupActive,
  normalizeFieldType,
  scottFilterColumnsFor
} from "@/scott/list/filterEngine";
import { QUICK_FILTER_ALL_VALUE } from "@/scott/list/quickFilters";

/**
 * Operators that pre-date the engine, mapped onto their engine equivalents. Only needed for
 * groups persisted before the shapes were unified.
 */
const LEGACY_OPERATOR_ALIASES = Object.freeze({
  before: "date_before",
  after: "date_after",
  on: "date_on"
});

/**
 * The filterable columns for a config. This is now a thin re-export of the ONE derivation
 * (`scottFilterColumnsFor`), which `useScottList` also calls — mirroring matters, because if
 * this offered a field the hook typed differently the UI would build a condition the engine
 * then evaluates under another type.
 *
 * `config.filterColumns` wins when present; otherwise the table columns are typed through
 * `columnTypeToFilterType` (`number`→decimal, `datetime`→date, `badge`→enum with the options
 * off the matching config field) and Created At / Updated At are appended.
 *
 * @param {object} [config] entity config.
 * @returns {Array<{key: string, name: string, type: string, options?: Array<object>}>}
 */
export function scottFilterableColumns(config) {
  return scottFilterColumnsFor(config);
}

/** Look a column up by key, falling back to the first one. */
function columnFor(columns, field) {
  return columns.find((c) => c.key === field) || columns[0];
}

function typeOf(column) {
  return normalizeFieldType(column?.type);
}

/**
 * Coerce whatever the caller holds into the engine's group shape.
 *
 * Accepts the canonical `{ logic, conditions }`, the pre-unification `{ match, rules }`, a
 * bare array of conditions, and `null`. Legacy operator names are translated
 * (`before`→`date_before`, `after`→`date_after`); when `columns` is supplied, legacy
 * date `equals` becomes `date_on` and legacy enum `equals`/`not_equals` become
 * `is_any_of`/`is_none_of` with the value lifted into an array.
 *
 * @param {unknown} filters
 * @param {Array<object>} [columns] filterable columns, for type-aware legacy translation.
 * @returns {{logic: "and"|"or", conditions: Array<{id: string, field: string, operator: string, value: unknown}>}}
 */
export function normalizeScottFilters(filters, columns) {
  let logic = "and";
  let rawConditions = [];

  if (Array.isArray(filters)) {
    rawConditions = filters;
  } else if (filters && typeof filters === "object") {
    logic = filters.logic === "or" || filters.match === "or" ? "or" : "and";
    if (Array.isArray(filters.conditions)) rawConditions = filters.conditions;
    else if (Array.isArray(filters.rules)) rawConditions = filters.rules;
  }

  const cols = Array.isArray(columns) ? columns : null;

  const translated = rawConditions.filter(Boolean).map((condition) => {
    let operator = LEGACY_OPERATOR_ALIASES[condition.operator] ?? condition.operator;
    let value = condition.value;

    if (cols) {
      const type = typeOf(cols.find((c) => c.key === condition.field));
      if (type === "date" && operator === "equals") {
        operator = "date_on";
      } else if (type === "enum" && (operator === "equals" || operator === "not_equals")) {
        operator = operator === "equals" ? "is_any_of" : "is_none_of";
        value = Array.isArray(value) ? value : value == null || value === "" ? [] : [String(value)];
      }
    }

    return { ...condition, operator, value };
  });

  // `deserializeFilterGroup` drops fieldless/operatorless junk and backfills missing ids.
  return deserializeFilterGroup({ logic, conditions: translated });
}

/**
 * How many conditions the group carries (engine semantics — a blank value is still a
 * condition, because e.g. `contains ""` legitimately matches everything).
 * @param {unknown} filters
 * @returns {number}
 */
export function countActiveScottFilters(filters) {
  return countFilterConditions(normalizeScottFilters(filters));
}

/** @param {unknown} filters @returns {boolean} */
export function isScottFilterActive(filters) {
  return isFilterGroupActive(normalizeScottFilters(filters));
}

function optionValue(option) {
  if (option == null) return "";
  if (typeof option === "object") return String(option.value ?? option.id ?? option.label ?? "");
  return String(option);
}

function optionLabel(option) {
  if (option == null) return "";
  if (typeof option === "object") return String(option.label ?? option.name ?? option.value ?? option.id ?? "");
  return String(option);
}

/**
 * Search + quick chips + advanced filter builder.
 *
 * @param {object} props
 * @param {object} [props.config] entity config; drives the filter fields via `scottFilterableColumns`.
 * @param {Array<object>} [props.columns] explicit `FilterableColumn[]` (overrides the config).
 * @param {string} [props.search=""] controlled search text (`search` from `useScottList`).
 * @param {(next: string) => void} [props.onSearchChange] `setSearch` from `useScottList`.
 * @param {string} [props.searchPlaceholder="Search…"]
 * @param {Array<{key: string, label: string, value: string, options: Array<{value: string, label: string}>}>} [props.quickFilters]
 *        cycling chips — clicking advances to the next option, house style. Reset value is
 *        `QUICK_FILTER_ALL_VALUE` (`"__all__"`), matching `quickFilters.js`.
 * @param {(key: string, value: string) => void} [props.onQuickFilterChange]
 * @param {{logic?: "and"|"or", conditions?: Array<object>}|null} [props.filters] engine filter group.
 * @param {(next: {logic: "and"|"or", conditions: Array<object>}) => void} [props.onFiltersChange] `setFilters`.
 * @param {() => void} [props.onClearAll] clears search + chips + filters.
 * @param {number} [props.resultCount] rows currently matching.
 * @param {number} [props.totalCount] rows before filtering.
 * @param {number} [props.selectedCount=0] appended as "· N selected".
 * @param {boolean} [props.loading=false] disables the chips and the Filters trigger.
 * @param {import("react").ReactNode} [props.actions] extra controls pinned to the right.
 * @param {string} [props.idPrefix="scott"] prefix for generated ids.
 * @param {string} [props.className] extra classes on the toolbar band.
 */
export default function ScottFilterBar({
  config,
  columns,
  search = "",
  onSearchChange,
  searchPlaceholder = "Search…",
  quickFilters = [],
  onQuickFilterChange,
  filters = null,
  onFiltersChange,
  onClearAll,
  resultCount,
  totalCount,
  selectedCount = 0,
  loading = false,
  actions = null,
  idPrefix = "scott",
  className
}) {
  const fields = Array.isArray(columns) && columns.length > 0 ? columns : scottFilterableColumns(config);
  const activeCount = countActiveScottFilters(filters);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(createEmptyFilterGroup);

  // Re-seed the draft from committed state every time the popover opens.
  useEffect(() => {
    if (open) setDraft(normalizeScottFilters(filters, fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeChips = (quickFilters || []).filter(
    (chip) =>
      chip &&
      chip.value != null &&
      chip.value !== "" &&
      chip.value !== "all" &&
      chip.value !== QUICK_FILTER_ALL_VALUE
  );
  const anythingActive = String(search || "").trim() !== "" || activeCount > 0 || activeChips.length > 0;

  function cycleChip(chip) {
    if (!onQuickFilterChange) return;
    const options = Array.isArray(chip.options) ? chip.options : [];
    if (options.length === 0) return;
    const values = options.map(optionValue);
    const index = values.indexOf(String(chip.value ?? values[0]));
    onQuickFilterChange(chip.key, values[(index + 1) % values.length]);
  }

  function chipLabel(chip) {
    const options = Array.isArray(chip.options) ? chip.options : [];
    const hit = options.find((o) => optionValue(o) === String(chip.value));
    return hit ? optionLabel(hit) : String(chip.value ?? "");
  }

  function patchCondition(id, patch) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c))
    }));
  }

  /** Replace one half of a `[a, b]` tuple value without disturbing the other. */
  function patchTuple(condition, index, next) {
    const current = Array.isArray(condition.value) ? [...condition.value] : ["", ""];
    current[index] = next;
    patchCondition(condition.id, { value: current });
  }

  /** Add/remove one option from an enum condition's string[] value. */
  function toggleEnumValue(condition, value) {
    const current = Array.isArray(condition.value) ? condition.value : [];
    const exists = current.some((v) => String(v) === String(value));
    patchCondition(condition.id, {
      value: exists ? current.filter((v) => String(v) !== String(value)) : [...current, String(value)]
    });
  }

  function addCondition() {
    const first = fields[0];
    if (!first) return;
    setDraft((d) => ({ ...d, conditions: [...d.conditions, createFilterCondition(first)] }));
  }

  function removeCondition(id) {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((c) => c.id !== id) }));
  }

  function applyDraft() {
    // Let the engine's own deserializer decide what survives — it drops fieldless/
    // operatorless junk but keeps legitimately-blank values (`contains ""` matches all).
    onFiltersChange?.(deserializeFilterGroup(draft));
    setOpen(false);
  }

  function clearDraft() {
    const empty = createEmptyFilterGroup();
    setDraft(empty);
    onFiltersChange?.(empty);
    setOpen(false);
  }

  function renderValueControl(condition, column) {
    const id = `${idPrefix}-cond-${condition.id}`;
    const type = typeOf(column);

    if (NO_VALUE_OPERATORS.has(condition.operator)) {
      return <div className="flex h-9 items-center text-xs text-muted-foreground">No value needed</div>;
    }

    if (TWO_VALUE_OPERATORS.has(condition.operator)) {
      const tuple = Array.isArray(condition.value) ? condition.value : ["", ""];
      if (condition.operator === "date_between") {
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            <DatePicker
              id={`${id}-from`}
              value={String(tuple[0] ?? "")}
              onChange={(next) => patchTuple(condition, 0, next || "")}
              placeholder="From"
            />
            <DatePicker
              id={`${id}-to`}
              value={String(tuple[1] ?? "")}
              onChange={(next) => patchTuple(condition, 1, next || "")}
              placeholder="To"
            />
          </div>
        );
      }
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input
            id={`${id}-min`}
            type="number"
            inputMode="decimal"
            value={String(tuple[0] ?? "")}
            onChange={(e) => patchTuple(condition, 0, e.target.value)}
            placeholder="Min"
            className="tabular-nums"
          />
          <Input
            id={`${id}-max`}
            type="number"
            inputMode="decimal"
            value={String(tuple[1] ?? "")}
            onChange={(e) => patchTuple(condition, 1, e.target.value)}
            placeholder="Max"
            className="tabular-nums"
          />
        </div>
      );
    }

    if (type === "enum") {
      // Multi-select. `Command` does not exist in this repo, so this is a Checkbox list.
      const options = (column?.options || []).filter((o) => optionValue(o) !== "");
      const selected = Array.isArray(condition.value) ? condition.value.map(String) : [];
      if (options.length === 0) {
        return (
          <div className="flex h-9 items-center text-xs text-muted-foreground">No options available</div>
        );
      }
      return (
        <div className="space-y-2">
          <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-md border p-2">
            {options.map((option) => {
              const value = optionValue(option);
              const optionId = `${id}-opt-${value}`;
              return (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox
                    id={optionId}
                    checked={selected.includes(value)}
                    onCheckedChange={() => toggleEnumValue(condition, value)}
                  />
                  <Label htmlFor={optionId} className="cursor-pointer text-sm font-normal">
                    {optionLabel(option)}
                  </Label>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.length === 0
              ? "Nothing selected — matches every row."
              : `${selected.length} selected`}
          </p>
        </div>
      );
    }

    if (type === "date") {
      return (
        <DatePicker
          id={id}
          value={String(condition.value ?? "")}
          onChange={(next) => patchCondition(condition.id, { value: next || "" })}
          placeholder="Pick a date"
        />
      );
    }

    const numeric = type === "integer" || type === "decimal";
    return (
      <Input
        id={id}
        type={numeric ? "number" : "text"}
        inputMode={numeric ? "decimal" : undefined}
        step={type === "integer" ? 1 : undefined}
        value={String(condition.value ?? "")}
        onChange={(e) => patchCondition(condition.id, { value: e.target.value })}
        placeholder="Value"
        className={cn(numeric && "tabular-nums")}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-3 border-b bg-muted/30 p-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4 lg:gap-y-3",
        className
      )}
    >
      {/* Search */}
      <div className="relative w-full lg:w-64 lg:shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={`${idPrefix}-search`}
          type="search"
          className="h-9 pl-8"
          placeholder={searchPlaceholder}
          value={search ?? ""}
          // Never disabled while loading: the hook re-fetches as you type, so disabling
          // here would steal focus mid-word.
          onChange={(e) => onSearchChange?.(e.target.value)}
          aria-label={searchPlaceholder}
        />
      </div>

      {/* Quick-filter chips */}
      {(quickFilters || []).length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {quickFilters.map((chip) => {
            const isActive = activeChips.includes(chip);
            return (
              <Button
                key={chip.key}
                type="button"
                variant={isActive ? "secondary" : "outline"}
                size="sm"
                disabled={loading}
                onClick={() => cycleChip(chip)}
                title={`Click to cycle ${chip.label}`}
              >
                {chip.label}
                {isActive ? (
                  <Badge variant="outline" className="ml-2 font-normal">
                    {chipLabel(chip)}
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </div>
      ) : null}

      {/* Advanced filters */}
      {fields.length > 0 && typeof onFiltersChange === "function" ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant={activeCount > 0 ? "secondary" : "outline"} size="sm" disabled={loading}>
              <Filter className="size-4" />
              Filters
              {activeCount > 0 ? (
                <Badge variant="outline" className="ml-1 font-normal">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,38rem)] p-0">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium leading-none">Advanced filters</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Filtering switches the list to fetch-all mode.
                </p>
              </div>
              <div className="inline-flex shrink-0 rounded-lg border p-0.5">
                {["and", "or"].map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={draft.logic === mode ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setDraft((d) => ({ ...d, logic: mode }))}
                  >
                    {mode.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="max-h-[min(60vh,24rem)] space-y-3 overflow-y-auto px-4 py-3">
              {draft.conditions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No filters yet. Add one to narrow the list.
                </p>
              ) : (
                draft.conditions.map((condition, index) => {
                  const column = columnFor(fields, condition.field);
                  const operators = OPERATORS_BY_TYPE[typeOf(column)];
                  const wideValue =
                    TWO_VALUE_OPERATORS.has(condition.operator) || typeOf(column) === "enum";
                  return (
                    <div key={condition.id} className="rounded-lg border bg-background p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {index === 0 ? "Where" : draft.logic === "or" ? "Or" : "And"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => removeCondition(condition.id)}
                          aria-label="Remove filter"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <div className={cn("grid gap-2", wideValue ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
                        <div className="grid gap-1.5">
                          <Label
                            htmlFor={`${idPrefix}-cond-${condition.id}-field`}
                            className="text-xs text-muted-foreground"
                          >
                            Field
                          </Label>
                          <Select
                            value={condition.field || column?.key || ""}
                            onValueChange={(next) => {
                              // Field change resets operator + value to that type's defaults.
                              const nextColumn = fields.find((c) => c.key === next);
                              const fresh = createFilterCondition(nextColumn, { id: condition.id });
                              patchCondition(condition.id, {
                                field: fresh.field,
                                operator: fresh.operator,
                                value: fresh.value
                              });
                            }}
                          >
                            <SelectTrigger id={`${idPrefix}-cond-${condition.id}-field`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {fields.map((c) => (
                                <SelectItem key={c.key} value={c.key}>
                                  {c.name ?? c.key}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-1.5">
                          <Label
                            htmlFor={`${idPrefix}-cond-${condition.id}-operator`}
                            className="text-xs text-muted-foreground"
                          >
                            Condition
                          </Label>
                          <Select
                            value={condition.operator || defaultOperatorForType(typeOf(column))}
                            onValueChange={(next) =>
                              patchCondition(condition.id, {
                                operator: next,
                                value: defaultValueForOperator(next, typeOf(column))
                              })
                            }
                          >
                            <SelectTrigger id={`${idPrefix}-cond-${condition.id}-operator`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {operators.map((op) => (
                                <SelectItem key={op.value} value={op.value}>
                                  {op.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className={cn("grid gap-1.5", wideValue && "sm:col-span-2")}>
                          <Label
                            htmlFor={`${idPrefix}-cond-${condition.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Value
                          </Label>
                          {renderValueControl(condition, column)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              <Button type="button" variant="outline" size="sm" onClick={addCondition} disabled={fields.length === 0}>
                <Plus className="size-4" />
                Add filter
              </Button>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearDraft}
                disabled={draft.conditions.length === 0 && activeCount === 0}
              >
                Clear all
              </Button>
              <Button type="button" size="sm" onClick={applyDraft}>
                Apply filters
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      {anythingActive && typeof onClearAll === "function" ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClearAll} disabled={loading}>
          <X className="size-4" />
          Clear
        </Button>
      ) : null}

      {/* Counts + caller actions */}
      <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
        {resultCount != null ? (
          <span className="text-xs text-muted-foreground">
            {Number(resultCount).toLocaleString("en-IN")}
            {totalCount != null ? ` of ${Number(totalCount).toLocaleString("en-IN")}` : ""}
            {selectedCount > 0 ? ` · ${Number(selectedCount).toLocaleString("en-IN")} selected` : ""}
          </span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
