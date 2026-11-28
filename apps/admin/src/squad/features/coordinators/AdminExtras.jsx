import { ORDER_SEARCH_PLACEHOLDER } from "../orders/orderParties";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResourceState } from "../../components";
import { CountTabs, SearchHeader, PersonCard, OrderCard, Fab, LoadMore, useInfiniteSquadList } from "../../components/parity";
import { date, money } from "../../data/format";
import { orderState } from "../orders/orderModel";
import { PersonForm } from "../people/PeoplePage";
import { Sc1OrderList } from "../orders/Sc1Orders";
import { Sc1List, Sc1PersonCard } from "../customers/Sc1Customers";
import { Sc1StaffHead } from "./Sc1Staff";

const PERSONAS = { team: { role: 12, label: "Team", add: "Add team member" }, worker: { role: 11, label: "Job Worker", add: "Add job worker" } };

/** Flutter AdminPersonasView: chip tabs Team / Job Worker, search, add button, open a person. */
export function PersonasPage({ sdk, identity, environment, canWrite, onNavigate, scott }) {
  const [tab, setTab] = useState("team"), [term, setTerm] = useState(""), [adding, setAdding] = useState(false);
  const cfg = PERSONAS[tab];
  const list = useInfiniteSquadList(["personas", tab, term], (sdk, cursor) => sdk.people({ role: cfg.role, search: term }, { cursor, limit: 30 }));
  const switchTab = (k) => { setTab(k); setTerm(""); };
  const placeholder = tab === "team" ? "Search Team" : "Search JobWorker";
  return <div className={scott ? "space-y-4 sc1-staff" : "space-y-4"}>
    {scott ? <Sc1StaffHead title="Persona Profile" caption={list.isLoading ? null : `${list.rows.length} shown`} searchLabel={placeholder} onSearch={setTerm} onRefresh={list.refetch} refreshing={list.isFetching} chipLabel="Persona" chips={Object.entries(PERSONAS).map(([key, v]) => [key, v.label])} chip={tab} onChip={switchTab} /> : <>
    <h1 className="text-lg font-semibold">Persona Profile</h1>
    <CountTabs tabs={Object.entries(PERSONAS).map(([key, v]) => ({ key, label: v.label }))} value={tab} onChange={switchTab} />
    <SearchHeader title={cfg.label} count={list.isLoading ? null : list.rows.length} placeholder={placeholder} onSearch={setTerm} onRefresh={list.refetch} refreshing={list.isFetching} />
    </>}
    {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No JobWorker Found" /> :
      scott ? <Sc1List>{list.rows.map((p) => <Sc1PersonCard key={p.id} person={{ ...p, company_name: undefined, phone: undefined }} onOpen={() => onNavigate(`/squad/people/${p.id}`)} />)}</Sc1List> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((p) => <PersonCard key={p.id} name={p.name} subtitle={p.email} onOpen={() => onNavigate(`/squad/people/${p.id}`)} />)}</div>}
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    <Fab label={cfg.add} onClick={() => setAdding(true)} />
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[cfg.role]} scott={scott} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.refetch(); }} />}
  </div>;
}

/** Flutter SearchOrderView ("Force Complete Order"): find an open order, then use its Force complete action. */
export function ForceCompletePage({ onNavigate, scott }) {
  const [term, setTerm] = useState("");
  const filters = { state: "pending", search: term };
  const list = useInfiniteSquadList(["force-complete", term], (sdk, cursor) => sdk.orders(filters, { cursor, limit: 30 }), { enabled: term.length > 0 });
  return <div className={scott ? "space-y-4 sc1-staff" : "space-y-4"}>
    {scott ? <Sc1StaffHead title="Force complete" searchLabel={ORDER_SEARCH_PLACEHOLDER} placeholder="Search by order or name" live onSearch={setTerm} />
      : <SearchHeader title="Orders" placeholder={ORDER_SEARCH_PLACEHOLDER} liveSearch onSearch={setTerm} />}
    <p className="text-sm text-muted-foreground">Search an open order to forcefully close it. You will confirm with a reason on the order page.</p>
    {!term ? <ResourceState title="Search Order to forcefully close it." /> : list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No Order Found." /> :
      scott ? <Sc1OrderList rows={list.rows} onOpen={(o) => onNavigate(`/squad/orders/${o.id}`)} /> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((o) => <OrderCard key={o.id} order={o} money={money} date={date} status={orderState(o)} onOpen={() => onNavigate(`/squad/orders/${o.id}`)} />)}</div>}
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
  </div>;
}
