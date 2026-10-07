import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildScottZoneOptions, filterScottZoneOptions } from "@/scott/data/zoneOptions";
import { loadScottZoneOptions } from "@/scott/data/zoneOptionsService";

const EMPTY_ROWS = [];

export default function ScottZoneSelect({ id, value, record, seedRows = EMPTY_ROWS, seedComplete = false, onChange, disabled, required, loadOptions = loadScottZoneOptions }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ options: [], loading: !seedComplete, message: "", retryable: false, nextPage: null });
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (seedComplete) {
      setState((previous) => ({ ...previous, loading: false, message: "", retryable: false, nextPage: null }));
      return;
    }
    setState((previous) => ({ ...previous, loading: true, message: "", retryable: false }));
    loadOptions({ page, refresh: attempt > 0 }).then((result) => {
      if (!cancelled) setState((previous) => ({
        options: [...new Map([...previous.options, ...result.options].map((option) => [option.value, option])).values()],
        nextPage: result.nextPage, loading: false, message: "", retryable: false
      }));
    }).catch((error) => {
      if (!cancelled) setState((previous) => ({ ...previous, loading: false, message: error?.message || "Could not load zones. Please retry.", retryable: true }));
    });
    return () => { cancelled = true; };
  }, [attempt, page, seedComplete, loadOptions]);

  const options = state.options.map((option) => ({ ...option }));
  for (const option of buildScottZoneOptions([...seedRows, record, { zone_id: value }])) {
    const existing = options.find((item) => item.value === option.value);
    if (!existing) options.push(option);
    else if (existing.label === "Zone name unavailable") existing.label = option.label;
  }
  options.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value, undefined, { numeric: true }));
  const selected = options.find((option) => option.value === value);
  const visible = filterScottZoneOptions(options, search);
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, search]);

  function choose(option) {
    if (disabled || !option) return;
    onChange(option.value);
    setOpen(false);
  }

  function label(option) {
    return <span className="min-w-0 flex-1 text-left">
      <span className="block truncate font-medium">{option.label}</span>
      <span className="block text-xs font-normal text-muted-foreground">ID: {option.value}</span>
    </span>;
  }

  return (
    <div className="space-y-2">
      <Popover open={open && !disabled} onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
        setActive(0);
      }}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" disabled={disabled}
            aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={`${id}-options`}
            aria-describedby={`${id}-help`} className="h-auto min-h-10 w-full justify-between gap-2 py-2 font-normal">
            {selected ? label(selected) : <span className="text-muted-foreground">{state.loading ? "Loading zones…" : "Select a zone"}</span>}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[200] w-[var(--radix-popover-trigger-width)] p-0">
          <div className="border-b p-2">
            <Input role="combobox" aria-label="Search zones by name or ID" aria-autocomplete="list"
              aria-expanded={open} aria-controls={`${id}-options`} aria-required={required}
              aria-activedescendant={visible.length ? `${id}-option-${activeIndex}` : undefined}
              value={search} placeholder="Search by name or ID…"
              onChange={(event) => { setSearch(event.target.value); setActive(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActive(Math.max(0, Math.min(visible.length - 1, activeIndex + step)));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(visible[activeIndex]);
                }
              }} />
          </div>
          <div ref={listRef} id={`${id}-options`} role="listbox" aria-label="Zones" aria-busy={state.loading}
            className="max-h-64 overflow-y-auto p-1">
            {visible.map((option, index) => (
              <button key={option.value} id={`${id}-option-${index}`} type="button" role="option"
                aria-selected={option.value === value} tabIndex={-1}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent ${index === activeIndex ? "bg-accent" : ""}`}
                onMouseMove={() => setActive(index)} onClick={() => choose(option)}>
                {label(option)}
                {option.value === value ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          {!visible.length ? <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
            {state.loading ? "Loading zones…" : search ? "No zones match your search." : "No zones found in Scott records."}
          </p> : null}
        </PopoverContent>
      </Popover>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">Zones found in Scott price types.</p>
      {state.loading ? <p role="status" className="text-xs text-muted-foreground">{options.length ? "Checking for more zones…" : "Loading zone names…"}</p> : null}
      {state.nextPage && !state.loading && !state.retryable ? <Button type="button" variant="link" className="h-auto p-0 text-xs" disabled={disabled} onClick={() => setPage(state.nextPage)}>Load more zones</Button> : null}
      {state.message ? <div role="status" className="text-xs text-muted-foreground">
        {state.message}{" "}
        {state.retryable ? <Button type="button" variant="link" className="h-auto p-0 text-xs" disabled={disabled || state.loading} onClick={() => setAttempt((n) => n + 1)}>Retry</Button> : null}
      </div> : null}
    </div>
  );
}
