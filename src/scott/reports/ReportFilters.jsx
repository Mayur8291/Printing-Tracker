// Report-level filter bar — the controls the registry declares in `report.filters`.
//
// These are NOT the column filters: `ScottFilterBar` (inside `ScottListPage`) owns search,
// quick chips and the advanced builder, all of which run client-side over the drained set.
// The controls here change what is REQUESTED — report type, period, customer selection —
// so every change re-fetches.
//
// Field types handled, all declared by `reportRegistry.js`:
//   select       report_type / growth period / order history
//   period       date | week | month | year, resolved by `resolveReportPeriodRange`
//   multiselect  customers (RMP Sales, client-side + overview-only)

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchCustomers } from "@/scott/data/customersService";
import { resolveReportPeriodRange } from "@/scott/data/reports/reportShared";

const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]);

const MODE_LABELS = Object.freeze({ date: "Custom range", week: "Week", month: "Month", year: "Year" });

/** Years offered by the month/year pickers: the last 8, newest first. */
function yearOptions() {
  const now = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => now - i);
}

// ---------------------------------------------------------------------------
// Period picker
// ---------------------------------------------------------------------------

/**
 * Period control for one registry `type: "period"` field.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {{mode?: string, startDate?: string, endDate?: string, weekValue?: string, month?: number, year?: number}} props.value
 * @param {(next: object) => void} props.onChange
 * @param {string[]} [props.modes] which modes the field offers (registry `modes`).
 * @param {boolean} [props.disabled]
 */
export function ReportPeriodPicker({ id, label, value, onChange, modes = ["date"], disabled = false }) {
  const config = value ?? {};
  const mode = modes.includes(String(config.mode)) ? String(config.mode) : modes[0];
  const resolved = useMemo(() => resolveReportPeriodRange({ ...config, mode }), [config, mode]);
  const patch = (next) => onChange?.({ ...config, mode, ...next });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${id}-mode`} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>

      <div className="flex flex-wrap items-center gap-2">
        {modes.length > 1 ? (
          <Select value={mode} onValueChange={(next) => patch({ mode: next })} disabled={disabled}>
            <SelectTrigger id={`${id}-mode`} className="h-9 w-[9.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modes.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABELS[m] ?? m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {mode === "date" ? (
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker
              id={`${id}-from`}
              value={String(config.startDate ?? "")}
              onChange={(next) => patch({ startDate: next || "" })}
              placeholder="From"
              disabled={disabled}
              className="w-[10.5rem]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <DatePicker
              id={`${id}-to`}
              value={String(config.endDate ?? "")}
              onChange={(next) => patch({ endDate: next || "" })}
              placeholder="To"
              disabled={disabled}
              className="w-[10.5rem]"
            />
          </div>
        ) : null}

        {mode === "week" ? (
          <Input
            id={`${id}-week`}
            type="week"
            className="h-9 w-[11rem]"
            value={String(config.weekValue ?? "")}
            onChange={(event) => patch({ weekValue: event.target.value })}
            disabled={disabled}
          />
        ) : null}

        {mode === "month" ? (
          <div className="flex items-center gap-2">
            <Select
              value={String(config.month ?? new Date().getMonth() + 1)}
              onValueChange={(next) => patch({ month: Number(next) })}
              disabled={disabled}
            >
              <SelectTrigger id={`${id}-month`} className="h-9 w-[8.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, index) => (
                  <SelectItem key={name} value={String(index + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <YearSelect id={`${id}-year`} value={config.year} onChange={(y) => patch({ year: y })} disabled={disabled} />
          </div>
        ) : null}

        {mode === "year" ? (
          <YearSelect id={`${id}-year`} value={config.year} onChange={(y) => patch({ year: y })} disabled={disabled} />
        ) : null}
      </div>

      <p className="text-[11px] tabular-nums text-muted-foreground">
        {resolved.startDate || "—"} → {resolved.endDate || "—"}
      </p>
    </div>
  );
}

function YearSelect({ id, value, onChange, disabled }) {
  const years = yearOptions();
  const current = Number(value) || new Date().getFullYear();
  const options = years.includes(current) ? years : [current, ...years];
  return (
    <Select value={String(current)} onValueChange={(next) => onChange?.(Number(next))} disabled={disabled}>
      <SelectTrigger id={id} className="h-9 w-[6.5rem]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export function ReportSelectFilter({ id, label, value, options = [], onChange, disabled = false }) {
  const list = Array.isArray(options) ? options : [];
  const current = list.some((option) => String(option.value) === String(value))
    ? String(value)
    : String(list[0]?.value ?? "");

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Select value={current} onValueChange={(next) => onChange?.(next)} disabled={disabled}>
        <SelectTrigger id={id} className="h-9 w-[11rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {list.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)}>
              {option.label ?? option.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer multiselect
// ---------------------------------------------------------------------------

/**
 * Customer picker for RMP Sales.
 *
 * The customers master is LAZY-loaded — the list is only drained when the popover is first
 * opened, so a report the user never filters by customer costs nothing. Filtering itself is
 * client-side and overview-only (`clientSide: true`, `appliesToTabs: ["overview"]`).
 */
export function ReportCustomerPicker({ id, label, value = [], onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const requestedRef = useRef(false);

  const selected = useMemo(() => new Set((value ?? []).map((v) => String(v))), [value]);

  async function load(force = false) {
    if (requestedRef.current && !force) return;
    requestedRef.current = true;
    setLoading(true);
    setError("");
    try {
      const rows = await fetchCustomers();
      setCustomers(Array.isArray(rows) ? rows : []);
    } catch (err) {
      requestedRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = customers.map((customer) => ({
      id: String(customer?.id ?? ""),
      name: String(customer?.company_name ?? customer?.contact_person ?? "").trim(),
      code: String(customer?.customer_code ?? "").trim()
    }));
    if (!text) return list.slice(0, 200);
    return list
      .filter((c) => c.name.toLowerCase().includes(text) || c.code.toLowerCase().includes(text))
      .slice(0, 200);
  }, [customers, query]);

  function toggle(customerId) {
    const next = new Set(selected);
    if (next.has(customerId)) next.delete(customerId);
    else next.add(customerId);
    onChange?.([...next]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="h-9 w-[13rem] justify-between px-3 font-normal" disabled={disabled}>
            <span className="truncate">
              {selected.size === 0 ? "All customers" : `${selected.size} selected`}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[200] w-[19rem] p-0">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 shrink-0 opacity-60" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customers…"
              className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
            />
            {selected.size > 0 ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={() => onChange?.([])}>
                Clear
              </Button>
            ) : null}
          </div>

          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading customers…</p>
          ) : error ? (
            <div className="space-y-2 px-3 py-4 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => load(true)}>
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No customers found.</p>
          ) : (
            <ScrollArea className="h-64">
              <div className="p-1">
                {filtered.map((customer) => (
                  <label
                    key={customer.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox checked={selected.has(customer.id)} onCheckedChange={() => toggle(customer.id)} />
                    <span className="min-w-0 flex-1 truncate">{customer.name || customer.code || customer.id}</span>
                    {customer.code ? (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{customer.code}</span>
                    ) : null}
                    {selected.has(customer.id) ? <Check className="size-3.5 shrink-0 opacity-70" aria-hidden /> : null}
                  </label>
                ))}
              </div>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

/**
 * The quick-filter DATE RANGE — the half of upstream's `QuickFilterBar` that the house
 * chip control cannot express.
 *
 * `ScottFilterBar` renders quick ENUM filters as cycling chips, which covers the four
 * dropdowns, but it has no date affordance; upstream's row also carried one date range
 * (`showDateFilters` / `maxDateColumns = 1`). Rather than change the shared filter bar, the
 * range lives here, beside the report-level controls, and writes into exactly the same
 * `useScottList` quick-filter state (`setQuickDateRange` -> `date_between` / `date_after` /
 * `date_before` in `scott/list/quickFilters.js`).
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label the column name, e.g. "Order Date".
 * @param {[string, string]} props.value `[from, to]` ISO dates.
 * @param {(from: string, to: string) => void} props.onChange
 * @param {boolean} [props.disabled]
 */
export function ReportQuickDateRange({ id, label, value, onChange, disabled = false }) {
  const from = String(value?.[0] ?? "");
  const to = String(value?.[1] ?? "");
  const active = from !== "" || to !== "";

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${id}-from`} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          id={`${id}-from`}
          value={from}
          onChange={(next) => onChange?.(next || "", to)}
          placeholder="From"
          disabled={disabled}
          className="w-[10.5rem]"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <DatePicker
          id={`${id}-to`}
          value={to}
          onChange={(next) => onChange?.(from, next || "")}
          placeholder="To"
          disabled={disabled}
          className="w-[10.5rem]"
        />
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange?.("", "")}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Which period modes a field offers.
 * `showDateFilters: false` (Total Inventory) drops the raw from/to range: that report opens
 * in `month` mode and its period only drives DRR / days-of-cover windows.
 */
export function resolvePeriodModes(field) {
  const modes = Array.isArray(field?.modes) && field.modes.length > 0 ? [...field.modes] : ["date"];
  if (field?.showDateFilters === false) {
    const withoutDate = modes.filter((mode) => mode !== "date");
    if (withoutDate.length > 0) return withoutDate;
  }
  return modes;
}

/**
 * Render every registry filter field for a report.
 *
 * @param {object} props
 * @param {Array<object>} props.fields `report.filters`.
 * @param {Record<string, unknown>} props.values current values.
 * @param {(key: string, value: unknown) => void} props.onChange
 * @param {string} [props.idPrefix]
 * @param {boolean} [props.disabled]
 * @param {string} [props.activeTab] hides fields whose `appliesToTabs` excludes the tab.
 * @param {import("react").ReactNode} [props.extras] extra always-visible controls rendered
 *   alongside the registry fields — the quick-filter date range (`ReportQuickDateRange`).
 *   Three reports declare NO registry filters at all, so the bar must render for `extras`
 *   alone or that control would have nowhere to live.
 * @param {import("react").ReactNode} [props.actions] trailing controls (e.g. Reset).
 */
export default function ReportFilterBar({
  fields = [],
  values = {},
  onChange,
  idPrefix = "report",
  disabled = false,
  activeTab,
  extras = null,
  actions = null
}) {
  const visible = (Array.isArray(fields) ? fields : []).filter((field) => {
    if (!field) return false;
    // `appliesToTabs` scopes a field to certain tabs (RMP Sales customers -> overview only).
    if (!Array.isArray(field.appliesToTabs) || !activeTab) return true;
    return field.appliesToTabs.includes(activeTab);
  });

  if (visible.length === 0 && !extras) return null;

  return (
    <Card className="border shadow-sm">
      <CardContent className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        {visible.map((field) => {
          const id = `${idPrefix}-${field.key}`;
          const value = values?.[field.key];

          if (field.type === "period") {
            return (
              <ReportPeriodPicker
                key={field.key}
                id={id}
                label={field.label}
                value={value}
                modes={resolvePeriodModes(field)}
                onChange={(next) => onChange?.(field.key, next)}
                disabled={disabled}
              />
            );
          }

          if (field.type === "multiselect") {
            return (
              <ReportCustomerPicker
                key={field.key}
                id={id}
                label={field.label}
                value={Array.isArray(value) ? value : []}
                onChange={(next) => onChange?.(field.key, next)}
                disabled={disabled}
              />
            );
          }

          if (field.type === "select") {
            return (
              <ReportSelectFilter
                key={field.key}
                id={id}
                label={field.label}
                value={value}
                options={field.options}
                onChange={(next) => onChange?.(field.key, next)}
                disabled={disabled}
              />
            );
          }

          return null;
        })}

        {extras}

        {actions ? <div className="ml-auto flex items-end gap-2">{actions}</div> : null}
      </CardContent>
    </Card>
  );
}
