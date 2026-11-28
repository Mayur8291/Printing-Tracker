import { ORDER_SEARCH_PLACEHOLDER } from "../orders/orderParties";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResourceState, PageHeader } from "../../components";
import { OrderCounters, CountTabs, SearchHeader, PersonCard, OrderCard, Fab, LoadMore, PullToRefresh, useOrderStats, usePeopleOrderCounts, useInfiniteSquadList, filteredOrdersHref, subjectListFilter } from "../../components/parity";
import { useSquadQuery } from "../../data/hooks";
import { date, money } from "../../data/format";
import { orderState } from "../orders/orderModel";
import { PersonForm } from "../people/PeoplePage";
import { parseCoordinatorPath, canAddCoordinator, canViewKind } from "./coordinatorModel";
import { Sc1OrderList } from "../orders/Sc1Orders";
import { Sc1List, Sc1PersonCard } from "../customers/Sc1Customers";
import { Sc1StaffHead } from "./Sc1Staff";

export default function CoordinatorsPage(props) {
  const parsed = parseCoordinatorPath(props.path);
  if (!parsed || !canViewKind(props.identity, parsed.kind)) return <ResourceState status="denied" description="This list is not available to your account." />;
  return parsed.id ? <CoordinatorDetail key={parsed.id} {...props} kind={parsed.kind} id={parsed.id} /> : <CoordinatorList {...props} kind={parsed.kind} />;
}

function CoordinatorList({ sdk, identity, environment, canWrite, onNavigate, kind, scott }) {
  const [term, setTerm] = useState(""), [adding, setAdding] = useState(false);
  const stats = useOrderStats({}, null);
  const list = useInfiniteSquadList(["coordinators", kind.slug, term], (sdk, cursor) => sdk.people({ role: kind.role, search: term }, { cursor, limit: 30 }));
  const refresh = () => { list.refetch(); stats.refetch(); };
  return <div className={scott ? "space-y-4 sc1-staff" : "space-y-4"}>
    {scott && <Sc1StaffHead title={kind.plural} caption={list.isLoading ? null : `${list.rows.length} shown`} searchLabel={`Search ${kind.title}`} placeholder="Search" onSearch={setTerm} onRefresh={refresh} refreshing={list.isFetching} />}
    <OrderCounters stats={stats.data} loading={stats.isLoading} criteria={false} onSelect={(tile) => onNavigate(filteredOrdersHref(tile.drill, { title: kind.plural }))} />
    {!scott && <SearchHeader title={kind.title} count={list.isLoading ? null : list.rows.length} placeholder={`Search ${kind.title}`} onSearch={setTerm} onRefresh={refresh} refreshing={list.isFetching} />}
    <PullToRefresh onRefresh={() => list.refetch()}>
      {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title={kind.empty} /> :
        list.data.pages.map((page, i) => <CardPage key={i} scott={scott} rows={page.data ?? []} kind={kind} onOpen={(id) => onNavigate(`/squad/coordinators/${kind.slug}/${id}`)} />)}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    </PullToRefresh>
    {canAddCoordinator(identity, kind) && <Fab label={kind.add} onClick={() => setAdding(true)} />}
    {adding && <PersonForm {...{ sdk, identity, environment, canWrite }} allowedRoles={[kind.role]} scott={scott} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.refetch(); }} />}
  </div>;
}

/** One page of cards = one batched counts call (<= 30 ids). */
function CardPage({ rows, kind, onOpen, scott }) {
  const ids = rows.map((r) => String(r.id));
  const counts = usePeopleOrderCounts(kind.subject, ids);
  if (scott) return <div className="mb-3"><Sc1List>{rows.map((p) => <Sc1PersonCard key={p.id} person={{ ...p, company_name: undefined, phone: undefined }} counts={{ pending: counts.data?.[p.id]?.pending ?? "—", completed: counts.data?.[p.id]?.completed ?? "—" }} onOpen={() => onOpen(p.id)} />)}</Sc1List></div>;
  return <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((p) => <PersonCard key={p.id} name={p.name} subtitle={p.email} pending={counts.data?.[p.id]?.pending} completed={counts.data?.[p.id]?.completed} onOpen={() => onOpen(p.id)} />)}</div>;
}

function CoordinatorDetail({ sdk, identity, environment, canWrite, onNavigate, kind, id, scott }) {
  const [tab, setTab] = useState("pending"), [term, setTerm] = useState(""), [editing, setEditing] = useState(false);
  const subject = { kind: kind.subject, id };
  const person = useSquadQuery(["person", id], ({ sdk }) => sdk.person(id));
  const stats = useOrderStats({}, subject);
  const scope = subjectListFilter(subject);
  const filters = { state: tab, ...(term ? { search: term } : {}), ...scope };
  const list = useInfiniteSquadList(["coordinator-orders", id, filters], (sdk, cursor) => sdk.orders(filters, { cursor, limit: 30 }));
  const p = person.data, name = p?.name ?? `${kind.title} #${id}`;
  const tabs = [{ key: "pending", label: "Pending", count: stats.data?.pending }, { key: "completed", label: "Completed", count: stats.data?.completed_excl_cancelled }];
  if (person.error) return <ResourceState status="error" error={person.error} onRetry={person.refetch} />;
  const contact = [p?.email, p?.phone].filter(Boolean).join(" · ") || undefined;
  const actions = <>{canAddCoordinator(identity, kind) && p && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}<Button variant="outline" onClick={() => onNavigate(`/squad/people/${id}`)}>View Details</Button>{kind.slug === "sales" && identity.role === 0 && <Button variant="outline" onClick={() => onNavigate("/squad/targets")}>Target</Button>}</>;
  const refresh = () => { list.refetch(); stats.refetch(); };
  return <div className={scott ? "space-y-4 sc1-staff" : "space-y-4"}>
    <Button variant="ghost" size="sm" className={scott ? "sc1-desktop-only" : undefined} onClick={() => onNavigate(-1)}><ArrowLeft className="mr-1 size-4" />Back</Button>
    {scott ? <><Sc1StaffHead title={name} caption={[kind.title, contact].filter(Boolean).join(" · ")} /><div className="sc1-order-actions">{actions}</div></>
      : <PageHeader eyebrow={kind.title} title={name} description={contact} actions={actions} />}
    <OrderCounters stats={stats.data} loading={stats.isLoading} criteria onSelect={(tile) => onNavigate(filteredOrdersHref(tile.drill, { subject, title: name }))} />
    {scott ? <Sc1StaffHead as="h2" title={stats.data?.total_orders != null ? `Orders (${stats.data.total_orders})` : "Orders"} searchLabel={ORDER_SEARCH_PLACEHOLDER} placeholder="Search by order or name" live onSearch={setTerm} onRefresh={refresh} refreshing={list.isFetching} />
      : <SearchHeader title="Orders" count={stats.data?.total_orders} placeholder={ORDER_SEARCH_PLACEHOLDER} liveSearch onSearch={setTerm} onRefresh={refresh} refreshing={list.isFetching} />}
    <CountTabs tabs={tabs} value={tab} onChange={setTab} className={scott ? "sc1-count-chips" : undefined} />
    <PullToRefresh onRefresh={() => list.refetch()}>
      {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No Order Found." /> :
        scott ? <Sc1OrderList rows={list.rows} onOpen={(o) => onNavigate(`/squad/orders/${o.id}`)} /> :
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((o) => <OrderCard key={o.id} order={o} money={money} date={date} status={orderState(o)} onOpen={() => onNavigate(`/squad/orders/${o.id}`)} />)}</div>}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    </PullToRefresh>
    {editing && p && <PersonForm {...{ sdk, identity, environment, canWrite }} person={p} allowedRoles={[kind.role]} scott={scott} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); person.refetch(); }} />}
  </div>;
}
