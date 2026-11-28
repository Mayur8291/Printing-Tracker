import { ORDER_SEARCH_PLACEHOLDER } from "./orderParties";
import { useState } from "react";
import { Sc1OrderList, Sc1OrderToolbar, Sc1TypeSort } from "./Sc1Orders";
import { ResourceState } from "../../components";
import { OrderCounters, CountTabs, SearchHeader, OrderCard, Fab, LoadMore, PullToRefresh, useOrderStats, useInfiniteSquadList, filteredOrdersHref } from "../../components/parity";
import { date, money } from "../../data/format";
import { orderState } from "./orderModel";
import { boardScope, boardCriteria, boardLabels, boardTabFilter, boardDrillable, boardOpenPath } from "./orderBoardModel";

/** Flutter orders tab: tappable counters, "Orders (n)" search + refresh, Pending/Completed tabs, card list. */
export default function OrderBoard({ identity, search, onNavigate, scott }) {
  const { scope, filters: base } = boardScope(identity, search);
  const [tab, setTab] = useState("pending"), [term, setTerm] = useState("");
  const [type, setType] = useState(""), [sort, setSort] = useState("id_desc");
  const stats = useOrderStats(base, null);
  const extra = { ...(type !== "" ? { type: Number(type) } : {}), ...(sort !== "id_desc" ? { sort } : {}) };
  const filters = { ...extra, ...base, ...boardTabFilter(identity.role, tab), ...(term ? { search: term } : {}) };
  const list = useInfiniteSquadList(["order-board", scope, filters], (sdk, cursor) => sdk.orders(filters, { cursor, limit: 30 }));
  const { title, tabs } = boardLabels(identity.role, stats.data);
  return <div className="space-y-4">
    <OrderCounters stats={stats.data} loading={stats.isLoading} criteria={boardCriteria(identity.role)} onSelect={!boardDrillable(identity.role) ? undefined : (tile) => onNavigate(filteredOrdersHref({ ...tile.drill, ...base }, { title: scope === "own" ? "My Orders" : "Orders" }))} />
    {scott ? <Sc1OrderToolbar title={title} onSearch={setTerm} onRefresh={() => { list.refetch(); stats.refetch(); }} refreshing={list.isFetching} filterCount={Object.keys(extra).length} onReset={() => { setType(""); setSort("id_desc"); }}>
      <Sc1TypeSort type={type} onType={setType} sort={sort} onSort={setSort} />
    </Sc1OrderToolbar> : <SearchHeader title={title} placeholder={ORDER_SEARCH_PLACEHOLDER} liveSearch onSearch={setTerm} onRefresh={() => { list.refetch(); stats.refetch(); }} refreshing={list.isFetching} />}
    <CountTabs tabs={tabs} value={tab} onChange={setTab} className={scott ? "sc1-count-chips" : undefined} />
    <PullToRefresh onRefresh={() => list.refetch()}>
      {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No Order Found." /> :
        scott ? <Sc1OrderList rows={list.rows} onOpen={(o) => onNavigate(boardOpenPath(identity.role, o.id))} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((o) => <OrderCard key={o.id} order={o} money={money} date={date} status={orderState(o)} onOpen={() => onNavigate(boardOpenPath(identity.role, o.id))} />)}</div>}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    </PullToRefresh>
    {scope === "own" && <Fab label="Bulk Order" onClick={() => onNavigate("/squad/catalogue")} />}
  </div>;
}
