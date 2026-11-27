import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResourceState } from "../../components";
import { CountTabs, SearchHeader, PersonCard, OrderCard, Fab, LoadMore, useInfiniteSquadList } from "../../components/parity";
import { date, money } from "../../data/format";
import { orderState } from "../orders/orderModel";
import { PersonForm } from "../people/PeoplePage";

const PERSONAS = { team: { role: 12, label: "Team", add: "Add team member" }, worker: { role: 11, label: "Job Worker", add: "Add job worker" } };

/** Flutter AdminPersonasView: chip tabs Team / Job Worker, search, add button, open a person. */
export function PersonasPage({ sdk, identity, environment, canWrite, onNavigate }) {
  const [tab, setTab] = useState("team"), [term, setTerm] = useState(""), [adding, setAdding] = useState(false);
  const cfg = PERSONAS[tab];
  const list = useInfiniteSquadList(["personas", tab, term], (sdk, cursor) => sdk.people({ role: cfg.role, search: term }, { cursor, limit: 30 }));
  return <div className="space-y-4">
    <h1 className="text-lg font-semibold">Persona Profile</h1>
    <CountTabs tabs={Object.entries(PERSONAS).map(([key, v]) => ({ key, label: v.label }))} value={tab} onChange={(k) => { setTab(k); setTerm(""); }} />
    <SearchHeader title={cfg.label} count={list.isLoading ? null : list.rows.length} placeholder={tab === "team" ? "Search Team" : "Search JobWorker"} onSearch={setTerm} onRefresh={list.refetch} refreshing={list.isFetching} />
    {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No JobWorker Found" /> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((p) => <PersonCard key={p.id} name={p.name} subtitle={p.email} onOpen={() => onNavigate(`/squad/people/${p.id}`)} />)}</div>}
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    <Fab label={cfg.add} onClick={() => setAdding(true)} />
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[cfg.role]} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.refetch(); }} />}
  </div>;
}

/** Flutter SearchOrderView ("Force Complete Order"): find an open order, then use its Force complete action. */
export function ForceCompletePage({ onNavigate }) {
  const [term, setTerm] = useState("");
  const filters = { state: "pending", search: term };
  const list = useInfiniteSquadList(["force-complete", term], (sdk, cursor) => sdk.orders(filters, { cursor, limit: 30 }), { enabled: term.length > 0 });
  return <div className="space-y-4">
    <SearchHeader title="Orders" placeholder="Search by Order No, Customer Name" onSearch={setTerm} />
    <p className="text-sm text-muted-foreground">Search an open order to forcefully close it. You will confirm with a reason on the order page.</p>
    {!term ? <ResourceState title="Search Order to forcefully close it." /> : list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No Order Found." /> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((o) => <OrderCard key={o.id} order={o} money={money} date={date} status={orderState(o)} onOpen={() => onNavigate(`/squad/orders/${o.id}`)} />)}</div>}
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
  </div>;
}
