// Small Scott One pieces shared by account, notification and content screens.
import { useState } from "react";
import { Surface, Sheet, Button, Icon, Card, Avatar } from "../../scott-one-ui";
import { date } from "../data/format";

/** Page title, optional filter sheet and optional chip rail. */
export function Sc1PageHead({ title, filters, filterCount = 0, chips, chip, onChip, chipLabel }) {
  const [open, setOpen] = useState(false);
  return <Surface skin="core" className="sc1-order-toolbar sc1-work-toolbar">
    <div className="sc1-order-heading sc1-flush"><h1 className="sc1-type-page">{title}</h1>
      {filters && <button type="button" className="sc1-filter-button" aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"} onClick={() => setOpen(true)}>
        <Icon name="filter" size={22} />{filterCount > 0 && <span aria-hidden="true">{filterCount}</span>}
      </button>}
    </div>
    {chips && <div className="sc1-chip-rail" role="group" aria-label={chipLabel}>{chips.map(([value, label]) => <button type="button" key={value} className="sc1-rail-chip" aria-pressed={chip === value} onClick={() => onChip(value)}>{label}</button>)}</div>}
    {filters && <Sheet open={open} onOpenChange={setOpen} title="Filters" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>{filters}</Sheet>}
  </Surface>;
}

export function Sc1Inbox({ items, pathFor, onNavigate }) {
  return <Surface skin="account" className="sc1-work-list">{items.map((item) => {
    const path = pathFor(item.target);
    return <Card as="article" tone="account" className="sc1-task sc1-order-tap" key={item.id}>
      <span className="sc1-inbox-icon" aria-hidden="true"><Icon name="bell" size={20} /></span>
      <div className="sc1-grow">
        <h2 className="sc1-inbox-title">{path ? <button type="button" className="sc1-order-open" onClick={() => onNavigate(path)}>{item.title}</button> : item.title}</h2>
        <p className="sc1-task-note">{item.body}</p>
        <p className="sc1-caption">{date(item.created_at, true)}</p>
      </div>
      {path && <Icon name="chevron-right" size={20} />}
    </Card>;
  })}</Surface>;
}

export function Sc1ProfileHead({ identity }) {
  const name = identity.name || identity.email || "Your account";
  return <Surface skin="account" className="sc1-profile-head">
    <Avatar name={name} size="profile" />
    <h1 className="sc1-type-account">{name}</h1>
    <p className="sc1-caption">{[identity.role_name, identity.email].filter(Boolean).join(" · ")}</p>
  </Surface>;
}
