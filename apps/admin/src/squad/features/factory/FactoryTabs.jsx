import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResourceState } from "../../components";
import { CountTabs, SearchHeader, PersonCard, Fab, LoadMore, OrderCounters, useInfiniteSquadList, useOrderStats } from "../../components/parity";
import { PersonForm } from "../people/PeoplePage";
import { tailorTabs, deliveryTabs, queueCounterRoles } from "./factoryModel";

function StaffList({ roleCfg, term, onNavigate, empty }) {
  const list = useInfiniteSquadList(["staff", roleCfg.role, term], (sdk, cursor) => sdk.people({ role: roleCfg.role, search: term }, { cursor, limit: 30 }));
  return <>
    {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title={empty} /> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((p) => <PersonCard key={p.id} name={p.name} subtitle={p.phone || p.email} onOpen={() => onNavigate(`/squad/team/${p.id}`)} />)}</div>}
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
  </>;
}

/** Flutter TailorsView: Tailors / Cutting Master sub-tabs (Factory Manager), search, leaderboard preview, add button. */
export function TailorsPage({ sdk, identity, environment, canWrite, onNavigate }) {
  const tabs = tailorTabs(identity.role);
  const [tab, setTab] = useState(tabs[0].key), [term, setTerm] = useState(""), [adding, setAdding] = useState(false);
  const cfg = tabs.find((t) => t.key === tab);
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
export function DeliveryPage({ sdk, identity, environment, canWrite, onNavigate }) {
  const tabs = deliveryTabs();
  const [tab, setTab] = useState(tabs[0].key), [term, setTerm] = useState(""), [adding, setAdding] = useState(false);
  const cfg = tabs.find((t) => t.key === tab);
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
export function QueueStats({ identity, children }) {
  const show = queueCounterRoles.includes(Number(identity.role));
  const stats = useOrderStats({}, null, { enabled: show });
  return <div className="space-y-4">{show && <OrderCounters stats={stats.data} loading={stats.isLoading} criteria={Number(identity.role) === 7} />}{children}</div>;
}

/** Job worker "Your Efficiency" gauge for the menu (Flutter drawer header). */
export function EfficiencyGauge({ identity }) {
  const stats = useOrderStats({}, null, { enabled: Number(identity.role) === 11 });
  if (Number(identity.role) !== 11) return null;
  const pct = Math.max(0, Math.min(100, Number(stats.data?.efficiency ?? 0)));
  return <div className="border-b px-4 py-3"><div className="flex justify-between text-sm"><span>Your Efficiency</span><strong>{stats.data ? `${pct}%` : "—"}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Efficiency ${pct}%`}><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div></div>;
}
