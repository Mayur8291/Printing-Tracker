import { ORDER_SEARCH_PLACEHOLDER } from "../orders/orderParties";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, ResourceState, Field } from "../../components";
import { OrderCounters, SearchHeader, OrderCard, LoadMore, PullToRefresh, useOrderStats, useInfiniteSquadList, filteredOrdersContext, filteredOrdersHref, subjectListFilter, STATE_CHIPS } from "../../components/parity";
import { dashboardPeriod } from "../../components/dashboardPeriod";
import { date, money } from "../../data/format";
import { orderState } from "../orders/orderModel";

/** Drill-down for every counter tile (Flutter FilteredOrdersView): status chips, search, custom date range, infinite list. */
export default function FilteredOrdersPage({ search, onNavigate }) {
  const ctx = filteredOrdersContext(search);
  const scope = subjectListFilter(ctx.subject);
  const invalid = Boolean(ctx.error) || scope === null;
  return invalid
    ? <div className="space-y-4"><Button variant="ghost" size="sm" onClick={() => onNavigate(-1)}><ArrowLeft className="mr-1 size-4" />Back</Button><ResourceState status="error" title="Orders unavailable" description={ctx.error || "This person's orders can't be listed from here yet. Open them from their profile."} /></div>
    : <FilteredOrders ctx={ctx} scope={scope} onNavigate={onNavigate} />;
}

function FilteredOrders({ ctx, scope, onNavigate }) {
  const [state, setState] = useState(ctx.filters.state ?? ""), [term, setTerm] = useState("");
  const [from, setFrom] = useState(""), [through, setThrough] = useState(""), [period, setPeriod] = useState({}), [periodError, setPeriodError] = useState("");
  const { state: _state, ...fixed } = ctx.filters;
  const filters = { ...fixed, ...(state ? { state } : {}), ...(term ? { search: term } : {}), ...period, ...scope };
  const list = useInfiniteSquadList(["filtered-orders", filters], (sdk, cursor) => sdk.orders(filters, { cursor, limit: 30 }));
  const stats = useOrderStats({ ...fixed, ...period, ...scope }, null);
  const applyPeriod = (event) => { event.preventDefault(); try { setPeriod(dashboardPeriod(from, through)); setPeriodError(""); } catch (error) { setPeriodError(error.message); } };
  return <div className="space-y-4">
    <Button variant="ghost" size="sm" onClick={() => onNavigate(-1)}><ArrowLeft className="mr-1 size-4" />Back</Button>
    <PageHeader title={ctx.title} description="Orders matching the selected counter. Tap an order to open it." />
    <OrderCounters stats={stats.data} loading={stats.isLoading} onSelect={(tile) => onNavigate(filteredOrdersHref({ ...tile.drill, ...fixed }, { subject: ctx.subject, title: ctx.title }), { replace: true })} />
    <div className="squad-chip-row" role="group" aria-label="Order status">{[["", "All"], ...STATE_CHIPS].map(([key, label]) => <button type="button" key={key || "all"} className={`squad-count-tab ${state === key ? "is-active" : ""}`} aria-pressed={state === key} onClick={() => setState(key)}>{label}</button>)}</div>
    <SearchHeader title="Orders" count={state ? stats.data?.[state] : stats.data?.total_orders} placeholder={ORDER_SEARCH_PLACEHOLDER} liveSearch onSearch={setTerm} onRefresh={() => { list.refetch(); stats.refetch(); }} refreshing={list.isFetching} />
    <form className="flex flex-wrap items-end gap-3" onSubmit={applyPeriod}>
      <Field label="Custom range from"><Input type="date" value={from} max={through || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="Through"><Input type="date" value={through} min={from || undefined} onChange={(e) => setThrough(e.target.value)} /></Field>
      <Button type="submit" variant="outline">Apply</Button>
      {(from || through || Object.keys(period).length > 0) && <Button type="button" variant="ghost" onClick={() => { setFrom(""); setThrough(""); setPeriod({}); setPeriodError(""); }}>Clear</Button>}
      {periodError && <p role="alert" className="w-full text-sm text-destructive">{periodError}</p>}
    </form>
    <PullToRefresh onRefresh={() => list.refetch()}>
      {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No Order Found." description="Try a different status, search or date range." /> :
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.rows.map((order) => <OrderCard key={order.id} order={order} money={money} date={date} status={orderState(order)} onOpen={() => onNavigate(`/squad/orders/${order.id}`)} />)}</div>}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    </PullToRefresh>
  </div>;
}
