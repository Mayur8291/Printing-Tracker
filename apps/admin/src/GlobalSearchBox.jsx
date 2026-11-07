import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buildGlobalSearchSuggestions } from "./globalSearchUtils";

const BADGE_VARIANT = {
  printing: "default",
  "printing-dept": "secondary",
  billing: "outline",
  production: "secondary",
  dispatch: "outline",
  outward: "outline",
  contact: "secondary",
  inventory: "outline",
  chat: "secondary"
};

export default function GlobalSearchBox({
  query,
  onQueryChange,
  orders,
  outwardChallans,
  contacts,
  canAccessTab,
  onSelect,
  loadingExtras = false,
  className
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmed = query.trim();
  const suggestions = buildGlobalSearchSuggestions({
    query: trimmed,
    orders,
    outwardChallans,
    contacts,
    canAccessTab
  });
  const showDropdown = open && trimmed.length > 0;

  useEffect(() => {
    setActiveIndex(suggestions.length ? 0 : -1);
  }, [trimmed, suggestions.length]);

  useEffect(() => {
    if (!trimmed) setOpen(false);
  }, [trimmed]);

  function pickSuggestion(item) {
    onSelect(item);
    setOpen(false);
    onQueryChange("");
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (!showDropdown) {
      if (e.key === "ArrowDown" && trimmed) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function onResultsWheel(e) {
    e.stopPropagation();
    const el = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const delta = e.deltaY;
    const atTop = scrollTop <= 0 && delta < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && delta > 0;
    if (atTop || atBottom) e.preventDefault();
  }

  return (
    <Popover open={showDropdown} onOpenChange={setOpen} modal={false}>
      <div className={cn("relative min-w-0 flex-1", className)}>
        <PopoverAnchor asChild>
          <div className="w-full">
            <label htmlFor="global-dashboard-search" className="sr-only">
              Search everywhere
            </label>
            <Input
              id="global-dashboard-search"
              ref={inputRef}
              type="search"
              placeholder="Search order #, customer, OC, contact…"
              value={query}
              className="h-9 w-full"
              onChange={(e) => {
                onQueryChange(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls={showDropdown ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                showDropdown && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
              }
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="end"
          sideOffset={4}
          className="w-[min(100vw-2rem,28rem)] overflow-hidden p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onWheel={(e) => e.stopPropagation()}
        >
          {loadingExtras ? (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">Loading more areas…</p>
          ) : null}
          {suggestions.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches across your departments.
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              className="max-h-72 overflow-y-auto overscroll-contain p-1 [-webkit-overflow-scrolling:touch]"
              onWheel={onResultsWheel}
            >
              {suggestions.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-sm px-3 py-2 text-left text-sm transition-colors",
                      index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pickSuggestion(item)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={BADGE_VARIANT[item.badgeTone] ?? "outline"} className="text-[10px]">
                        {item.areaLabel}
                      </Badge>
                      {item.contextLine ? (
                        <span className="text-xs text-muted-foreground">{item.contextLine}</span>
                      ) : null}
                    </div>
                    <span className="font-medium leading-snug">{item.title}</span>
                    {item.subtitle ? (
                      <span className="text-xs text-muted-foreground">{item.subtitle}</span>
                    ) : null}
                    {item.meta ? <span className="text-[11px] text-muted-foreground/80">{item.meta}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </div>
    </Popover>
  );
}
