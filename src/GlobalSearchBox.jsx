import { useEffect, useId, useRef, useState } from "react";
import { buildGlobalSearchSuggestions } from "./globalSearchUtils";

export default function GlobalSearchBox({
  query,
  onQueryChange,
  orders,
  outwardChallans,
  contacts,
  canAccessTab,
  onSelect,
  loadingExtras = false
}) {
  const listId = useId();
  const wrapRef = useRef(null);
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
    if (!showDropdown) return undefined;
    function onPointerDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showDropdown]);

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

  return (
    <div className="global-search-wrap" ref={wrapRef}>
      <label className="global-search-label" htmlFor="global-dashboard-search">
        <span className="visually-hidden">Search everywhere</span>
        <input
          id="global-dashboard-search"
          ref={inputRef}
          type="search"
          className="dashboard-global-search-input global-search-input"
          placeholder="Search order #, customer, OC, contact…"
          value={query}
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
      </label>
      {showDropdown ? (
        <div className="global-search-dropdown" role="listbox" id={listId}>
          {loadingExtras ? (
            <p className="global-search-dropdown-status">Loading more areas…</p>
          ) : null}
          {suggestions.length === 0 ? (
            <p className="global-search-dropdown-empty">No matches across your departments.</p>
          ) : (
            <ul className="global-search-dropdown-list">
              {suggestions.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`global-search-option${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pickSuggestion(item)}
                  >
                    <span className={`global-search-badge global-search-badge--${item.badgeTone}`}>
                      {item.areaLabel}
                    </span>
                    <span className="global-search-option-context">{item.contextLine}</span>
                    <span className="global-search-option-title">{item.title}</span>
                    <span className="global-search-option-sub">{item.subtitle}</span>
                    {item.meta ? <span className="global-search-option-meta">{item.meta}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="global-search-dropdown-hint">
            Pick a row to open that area — badges show where it lives (Billing, Dispatch, etc.).
          </p>
        </div>
      ) : null}
    </div>
  );
}
