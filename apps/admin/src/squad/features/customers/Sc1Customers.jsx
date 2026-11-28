// Scott One presentation for customer and distributor lists and profiles. Data and permissions stay with the callers.
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Surface, SearchField, Badge, Card, Sheet, Button, ChoiceGroup, Icon, Avatar } from "../../../scott-one-ui";
import { accountStatus } from "../people/peopleModel";
import ContactActions from "../../components/ContactActions";

const STATUS = [{ value: "", label: "All" }, { value: "pending", label: "Awaiting review" }, { value: "onboarding", label: "Onboarding" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }];
const statusTone = (status) => (status === "Active" ? "success" : status === "Disabled" ? "neutral" : "warning");

export function Sc1DirectoryToolbar({ title, search, onSearchChange, onSearch, onRefresh, refreshing, status, onStatus, filterCount = 0, extraAction, children }) {
  const [open, setOpen] = useState(false);
  return <Surface skin="core" className="sc1-order-toolbar">
    <div className="sc1-order-heading"><h1 className="sc1-type-page">{title}</h1>
      <div className="sc1-heading-actions">{extraAction}
        <button type="button" className="sc1-icon-button" aria-label={`Refresh ${title.toLowerCase()}`} disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? "size-5 animate-spin motion-reduce:animate-none" : "size-5"} aria-hidden="true" /></button></div></div>
    <div className="sc1-order-search">
      <SearchField value={search} onChange={(value) => { onSearchChange(value.slice(0, 100)); if (!value) onSearch(""); }} onSubmit={(value) => onSearch(value.trim())} label={`Search ${title.toLowerCase()} by name, company or email`} placeholder="Name, company or email" />
      <button type="button" className="sc1-filter-button" aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"} onClick={() => setOpen(true)}>
        <Icon name="filter" size={22} />{filterCount > 0 && <span aria-hidden="true">{filterCount}</span>}
      </button>
    </div>
    <Sheet open={open} onOpenChange={setOpen} title={`Filter ${title.toLowerCase()}`} footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
      <div className="sc1-filter-block"><p className="sc1-type-label">Account status</p><ChoiceGroup label="Account status" value={status} onChange={onStatus} options={STATUS} /></div>
      {children}
    </Sheet>
  </Surface>;
}

/** Whole row opens the account; the admin selection box stays separately clickable. */
export function Sc1PersonCard({ person, avatar, counts, hint, onOpen, select }) {
  const status = accountStatus(person);
  const name = person.company_name || person.name || `Account #${person.id}`;
  return <Card as="article" className="sc1-person-row sc1-order-tap">
    <div className="sc1-person-top">
      {avatar ?? <Avatar name={name} />}
      <div className="sc1-grow">
        <h2><button type="button" className="sc1-order-open" onClick={onOpen}>{name}</button></h2>
        <p className="sc1-caption">{[person.company_name && person.name, person.phone || person.email].filter(Boolean).join(" · ") || "No contact details"}</p>
      </div>
      {select}
      <span className="sc1-order-chevron" aria-hidden="true"><Icon name="chevron-right" size={20} /></span>
    </div>
    <div className="sc1-person-meta">
      <Badge tone={statusTone(status)}>{status}</Badge>
      {counts && <span className="sc1-caption">{counts.pending} pending · {counts.completed} completed</span>}
      {hint && <span className="sc1-person-hint">{hint}</span>}
    </div>
  </Card>;
}

export function Sc1List({ children }) {
  return <Surface skin="core" className="sc1-order-list">{children}</Surface>;
}

export function Sc1PersonHero({ person, kind, environment, onRefresh }) {
  const status = accountStatus(person);
  const name = person.name || `Person #${person.id}`;
  return <Surface skin="account" className="sc1-person-hero">
    <Card tone="account">
      <div className="sc1-person-top">
        <Avatar name={person.company_name || name} size="profile" />
        <div className="sc1-grow">
          <p className="sc1-caption">{kind}</p>
          <h1 className="sc1-type-section">{person.company_name || name}</h1>
          {person.company_name && <p className="sc1-caption">{name}</p>}
        </div>
        <button type="button" className="sc1-icon-button" aria-label="Refresh profile" onClick={onRefresh}><RefreshCw className="size-5" aria-hidden="true" /></button>
      </div>
      <div className="sc1-person-meta"><Badge tone={statusTone(status)}>{status}</Badge>{person.phone && <span className="sc1-caption">{person.phone}</span>}</div>
    </Card>
    <div className="squad-app-contact"><ContactActions phone={person.phone} name={name} environment={environment} /></div>
  </Surface>;
}
