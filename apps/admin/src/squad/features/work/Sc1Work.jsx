// Scott One presentation for To Do's, responsibilities and sales targets. Data, commands and permissions stay with the pages.
import { useEffect, useState } from "react";
import { Archive, Check, Pencil } from "lucide-react";
import { Surface, SearchField, Sheet, Button, ChoiceGroup, Card, Badge, Icon } from "../../../scott-one-ui";
import { date, money, number } from "../../data/format";

export function Sc1WorkToolbar({ title, search, onSearchChange, onSearch, filterCount = 0, filters, chips, chip, onChip, chipLabel }) {
  const [open, setOpen] = useState(false);
  return <Surface skin="core" className="sc1-order-toolbar sc1-work-toolbar">
    <h1 className="sc1-type-page">{title}</h1>
    {(onSearch || filters) && <div className="sc1-order-search">
      {onSearch && <SearchField value={search} onChange={(value) => { onSearchChange(value.slice(0, 200)); if (!value) onSearch(""); }} onSubmit={(value) => onSearch(value.trim())} label="Search note, order number or assignee" placeholder="Search tasks" />}
      {filters && <button type="button" className={onSearch ? "sc1-filter-button" : "sc1-text-action"} aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"} onClick={() => setOpen(true)}>
        <Icon name="filter" size={22} />{filterCount > 0 && onSearch && <span aria-hidden="true">{filterCount}</span>}
      </button>}
    </div>}
    <div className="sc1-chip-rail"><ChoiceGroup label={chipLabel} value={chip} onChange={onChip} options={chips} /></div>
    {filters && <Sheet open={open} onOpenChange={setOpen} title="Filters" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>{filters}</Sheet>}
  </Surface>;
}

export function Sc1TaskList({ items, goals, identity, canWrite, onToggle, onEdit, onArchive }) {
  return <Surface skin="core" className="sc1-work-list">{items.map((item) => {
    const completed = goals ? item.completed : item.state === 1;
    const editable = goals ? identity.role === 0 : identity.role === 0 || item.creator_id === identity.id;
    const owner = goals ? (String(item.subject_id) === String(identity.id) ? "Assigned to you" : `Assigned to #${item.subject_id}`)
      : item.assignees?.length ? `Assigned to ${item.assignees.map((person) => person.name || `Person #${person.id}`).join(", ")}` : null;
    return <Card as="article" className="sc1-task" data-complete={completed} key={item.id}>
      <button type="button" className="sc1-task-check" disabled={!canWrite} aria-label={`${completed ? "Reopen" : "Complete"}: ${item.note.slice(0, 80)}`} onClick={() => onToggle(item, completed)}>{completed && <Check className="size-4" aria-hidden="true" />}</button>
      <div className="sc1-grow">
        <p className="sc1-task-note">{item.note}</p>
        <p className="sc1-caption">{[goals ? ["Role", "Goal", "Task"][item.kind] : `Due ${date(item.deadline, true)}`, item.order_id ? `Order #${item.order_id}` : null].filter(Boolean).join(" · ")}</p>
        {owner && <p className="sc1-caption">{owner}</p>}
        <div className="sc1-task-foot"><Badge tone={completed ? "success" : "warning"}>{completed ? "Completed" : "Pending"}</Badge>
          {editable && <span>
            <button type="button" className="sc1-icon-button" aria-label="Edit" disabled={!canWrite} onClick={() => onEdit(item)}><Pencil className="size-4" aria-hidden="true" /></button>
            <button type="button" className="sc1-icon-button" aria-label="Archive" disabled={!canWrite} onClick={() => onArchive(item)}><Archive className="size-4" aria-hidden="true" /></button>
          </span>}
        </div>
      </div>
    </Card>;
  })}</Surface>;
}

const share = (part, whole) => (Number(whole) > 0 ? Math.max(0, Math.min(100, (Number(part) / Number(whole)) * 100)) : 0);

export function Sc1TargetList({ items, selected, onSelect, admin, canWrite, onEdit, onArchive }) {
  return <Surface skin="core" className="sc1-order-list">{items.map((item) => {
    const percent = Math.round(share(item.completed_amount, item.target_amount));
    return <Card as="article" className="sc1-target sc1-order-tap" key={item.id} data-selected={selected === item.id}>
      <p className="sc1-caption">{date(item.start)} – {date(item.end)}</p>
      <h2><button type="button" className="sc1-order-open" aria-pressed={selected === item.id} onClick={() => onSelect(item.id)}>{item.name}</button></h2>
      <strong className="sc1-type-amount">{money(item.target_amount)}</strong>
      <div className="sc1-bar" role="img" aria-label={`${percent}% of target completed`}><span style={{ width: `${percent}%` }} /></div>
      <dl className="sc1-target-facts">
        <div><dt>Placed</dt><dd>{money(item.placed_amount)}</dd></div>
        <div><dt>{percent}% done</dt><dd>{money(item.completed_amount)}</dd></div>
        <div><dt>Orders</dt><dd>{number(item.order_count)}</dd></div>
      </dl>
      {admin && <div className="sc1-target-actions">
        <button type="button" className="sc1-icon-button" aria-label="Edit target" disabled={!canWrite} onClick={() => onEdit(item)}><Pencil className="size-4" aria-hidden="true" /></button>
        <button type="button" className="sc1-icon-button" aria-label="Archive target" disabled={!canWrite} onClick={() => onArchive(item)}><Archive className="size-4" aria-hidden="true" /></button>
      </div>}
    </Card>;
  })}</Surface>;
}

/** Brings the progress card into view, since it opens above the list that was tapped. */
export function Sc1ScrollTop({ watch }) {
  useEffect(() => { document.getElementById("squad-main")?.scrollTo({ top: 0 }); }, [watch]);
  return null;
}
