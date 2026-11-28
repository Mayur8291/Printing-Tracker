import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResourceState } from "../../components";
import { CountTabs, SearchHeader, PersonCard, Fab, LoadMore, OrderCounters, useInfiniteSquadList, useOrderStats } from "../../components/parity";
import { PersonForm } from "../people/PeoplePage";
import { Sc1List } from "../customers/Sc1Customers";
import { Surface, SearchField, Card, Avatar, Icon } from "../../../scott-one-ui";
import { tailorTabs, deliveryTabs, queueCounterRoles } from "./factoryModel";
import "./sc1Factory.css";

function StaffList({ roleCfg, term, onNavigate, empty, scott }) {
  const list = useInfiniteSquadList(["staff", roleCfg.role, term], (sdk, cursor) => sdk.people({ role: roleCfg.role, search: term }, { cursor, limit: 30 }));
  return <>
    {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title={empty} /> : scott ? <Sc1StaffCards rows={list.rows} onNavigate={onNavigate} /> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((p) => <PersonCard key={p.id} name={p.name} subtitle={p.phone || p.email} onOpen={() => onNavigate(`/squad/team/${p.id}`)} />)}</div>}
    {scott ? <div className="sc1-factory-more"><LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} /></div> :
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />}
  </>;
}

function Sc1StaffCards({ rows, onNavigate }) {
  return <Sc1List>{rows.map((p) => {
    const name = String(p.name || `Person #${p.id}`);
    return <Card as="article" className="sc1-person-row sc1-order-tap" key={p.id}>
      <div className="sc1-person-top">
        <Avatar name={name} />
        <div className="sc1-grow">
          <h2><button type="button" className="sc1-order-open" onClick={() => onNavigate(`/squad/team/${p.id}`)}>{name}</button></h2>
          <p className="sc1-caption">{p.phone || p.email || "No contact details"}</p>
        </div>
        <span className="sc1-order-chevron" aria-hidden="true"><Icon name="chevron-right" size={20} /></span>
      </div>
    </Card>;
  })}</Sc1List>;
}

/** Title, optional heading action, search and staff-type chips for the Scott One staff directories. */
function Sc1StaffToolbar({ title, action, search, onSearchChange, onSearch, tabs, tab, onTab, children }) {
  return <Surface skin="core" className="sc1-order-toolbar sc1-work-toolbar">
    <div className="sc1-order-heading sc1-flush"><h1 className="sc1-type-page">{title}</h1>{action}</div>
    <SearchField value={search} onChange={(value) => { onSearchChange(value.slice(0, 100)); if (!value) onSearch(""); }} onSubmit={(value) => onSearch(value.trim())} label={`Search ${title}`} placeholder={`Search ${title}`} />
    {tabs.length > 1 && <div className="sc1-chip-rail" role="group" aria-label="Staff type">{tabs.map(({ key, label }) => <button type="button" key={key} className="sc1-rail-chip" aria-pressed={tab === key} onClick={() => onTab(key)}>{label}</button>)}</div>}
    {children}
  </Surface>;
}

/** Flutter TailorsView: Tailors / Cutting Master sub-tabs (Factory Manager), search, leaderboard preview, add button. */
export function TailorsPage({ sdk, identity, environment, canWrite, onNavigate, scott }) {
  const tabs = tailorTabs(identity.role);
  const [tab, setTab] = useState(tabs[0].key), [term, setTerm] = useState(""), [adding, setAdding] = useState(false), [search, setSearch] = useState("");
  const cfg = tabs.find((t) => t.key === tab);
  if (scott) return <div className="space-y-4">
    <Sc1StaffToolbar title={cfg.label} search={search} onSearchChange={setSearch} onSearch={setTerm} tabs={tabs} tab={tab} onTab={(k) => { setTab(k); setTerm(""); setSearch(""); }}
      action={tab === "tailors" && <button type="button" className="sc1-text-action" onClick={() => onNavigate("/squad/reports")}>Leaderboard</button>} />
    <StaffList key={tab} roleCfg={cfg} term={term} onNavigate={onNavigate} empty={cfg.empty} scott />
    {cfg.canAdd && <Fab label={cfg.add} onClick={() => setAdding(true)} />}
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[cfg.role]} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />}
  </div>;
  return <div className="space-y-4">
    {tabs.length > 1 && <CountTabs tabs={tabs.map(({ key, label }) => ({ key, label }))} value={tab} onChange={(k) => { setTab(k); setTerm(""); }} />}
    <SearchHeader title={cfg.label} placeholder={`Search ${cfg.label}`} onSearch={setTerm} />
    {tab === "tailors" && <div><Button variant="outline" size="sm" onClick={() => onNavigate("/squad/reports")}>Preview Leaderboard</Button></div>}
    <StaffList key={tab} roleCfg={cfg} term={term} onNavigate={onNavigate} empty={cfg.empty} />
    {cfg.canAdd && <Fab label={cfg.add} onClick={() => setAdding(true)} />}
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[cfg.role]} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />}
  </div>;
}

/** Flutter DeliveryView: Dispatch In Charge / Inspector sub-tabs listing the staff, with shortcuts to their queues. */
export function DeliveryPage({ sdk, identity, environment, canWrite, onNavigate, scott }) {
  const tabs = deliveryTabs();
  const [tab, setTab] = useState(tabs[0].key), [term, setTerm] = useState(""), [adding, setAdding] = useState(false), [search, setSearch] = useState("");
  const cfg = tabs.find((t) => t.key === tab);
  if (scott) return <div className="space-y-4">
    <Sc1StaffToolbar title={cfg.label} search={search} onSearchChange={setSearch} onSearch={setTerm} tabs={tabs} tab={tab} onTab={(k) => { setTab(k); setTerm(""); setSearch(""); }}>
      <button type="button" className="sc1-text-action sc1-factory-queue" onClick={() => onNavigate("/squad/production")}>{tab === "dispatch" ? "Open dispatch queue" : "Open inspection queue"}<Icon name="chevron-right" size={18} /></button>
    </Sc1StaffToolbar>
    <StaffList key={tab} roleCfg={cfg} term={term} onNavigate={onNavigate} empty={cfg.empty} scott />
    <Fab label={cfg.add} onClick={() => setAdding(true)} />
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[cfg.role]} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />}
  </div>;
  return <div className="space-y-4">
    <CountTabs tabs={tabs.map(({ key, label }) => ({ key, label }))} value={tab} onChange={(k) => { setTab(k); setTerm(""); }} />
    <SearchHeader title={cfg.label} placeholder={`Search ${cfg.label}`} onSearch={setTerm} />
    <div><Button variant="outline" size="sm" onClick={() => onNavigate("/squad/production")}>{tab === "dispatch" ? "Open dispatch queue" : "Open inspection queue"}</Button></div>
    <StaffList key={tab} roleCfg={cfg} term={term} onNavigate={onNavigate} empty={cfg.empty} />
    <Fab label={cfg.add} onClick={() => setAdding(true)} />
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[cfg.role]} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />}
  </div>;
}

/** Counters above the dispatch / cutting queues. Informational: their lists are item/dispatch based, not status filters. */
export function QueueStats({ identity, children, scott, hideCounters }) {
  const show = !hideCounters && queueCounterRoles.includes(Number(identity.role));
  const stats = useOrderStats({}, null, { enabled: show });
  return <div className={scott ? "space-y-4 sc1-queue-stats" : "space-y-4"}>{show && <OrderCounters stats={stats.data} loading={stats.isLoading} criteria={Number(identity.role) === 7} />}{children}</div>;
}

/** Job worker "Your Efficiency" gauge for the menu (Flutter drawer header). */
export function EfficiencyGauge({ identity }) {
  const stats = useOrderStats({}, null, { enabled: Number(identity.role) === 11 });
  if (Number(identity.role) !== 11) return null;
  const pct = Math.max(0, Math.min(100, Number(stats.data?.efficiency ?? 0)));
  return <div className="sc1-efficiency border-b px-4 py-3"><div className="flex justify-between text-sm"><span>Your Efficiency</span><strong>{stats.data ? `${pct}%` : "—"}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Efficiency ${pct}%`}><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div></div>;
}
