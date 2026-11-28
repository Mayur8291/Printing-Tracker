// Scott One head shared by admin and coordinator screens. Data and permissions stay with the callers.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Surface, SearchField, Sheet, Button, Icon } from "../../../scott-one-ui";
import "./sc1-staff.css";

/** Title, optional search, filter sheet and chip rail. With `live`, search applies while typing; otherwise on submit. */
export function Sc1StaffHead({ as: Heading = "h1", title, caption, onRefresh, refreshing, onSearch, live = false, searchLabel, placeholder, filters, filterTitle = "Filters", filterCount = 0, chips, chip, onChip, chipLabel }) {
  const [text, setText] = useState(""), [open, setOpen] = useState(false);
  useEffect(() => {
    if (!live || !onSearch) return;
    const timer = setTimeout(() => onSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, live, onSearch]);
  const change = (value) => { setText(value.slice(0, 100)); if (!value) onSearch(""); };
  return <Surface skin="core" className="sc1-order-toolbar sc1-work-toolbar">
    <div className="sc1-order-heading sc1-flush">
      <div className="sc1-grow"><Heading className={Heading === "h1" ? "sc1-type-page" : "sc1-type-section"}>{title}</Heading>{caption && <p className="sc1-caption">{caption}</p>}</div>
      {onRefresh && <button type="button" className="sc1-icon-button" aria-label="Refresh" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? "size-5 animate-spin motion-reduce:animate-none" : "size-5"} aria-hidden="true" /></button>}
    </div>
    {(onSearch || filters) && <div className="sc1-order-search">
      {onSearch && <SearchField value={text} onChange={change} onSubmit={live ? undefined : (value) => onSearch(value.trim())} label={searchLabel} placeholder={placeholder ?? searchLabel} />}
      {filters && <button type="button" className="sc1-filter-button" aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"} onClick={() => setOpen(true)}>
        <Icon name="filter" size={22} />{filterCount > 0 && <span aria-hidden="true">{filterCount}</span>}
      </button>}
    </div>}
    {chips && <div className="sc1-chip-rail" role="group" aria-label={chipLabel}>{chips.map(([value, label]) => <button type="button" key={value} className="sc1-rail-chip" aria-pressed={chip === value} onClick={() => onChip(value)}>{label}</button>)}</div>}
    {filters && <Sheet open={open} onOpenChange={setOpen} title={filterTitle} footer={<Button onClick={() => setOpen(false)}>Done</Button>}>{filters}</Sheet>}
  </Surface>;
}

/** Ref callback: brings a panel that opened away from the tapped row into view. */
export function scrollPanelIntoView(node) {
  const main = document.getElementById("squad-main");
  if (node && main) main.scrollTo({ top: main.scrollTop + node.getBoundingClientRect().top - main.getBoundingClientRect().top });
}
