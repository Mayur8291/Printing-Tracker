import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResourceState } from "../../components";
import { SearchHeader, LoadMore, useInfiniteSquadList } from "../../components/parity";
import { CommandDialog, Field } from "../orders/CommerceUI";
import PeoplePicker from "../people/PeoplePicker";
import { selectVisiblePeople } from "../people/peopleModel";

/** Flutter ChangeCustomersScView: filter by Sales Co, select customers (Select All), choose the new SC and apply. */
export default function ChangeScPage({ sdk, identity, environment, canWrite }) {
  const [filter, setFilter] = useState(""), [term, setTerm] = useState(""), [selected, setSelected] = useState({}), [open, setOpen] = useState(false);
  const filters = { role: 3, search: term, ...(filter ? { coordinator_id: filter } : {}) };
  const list = useInfiniteSquadList(["change-sc", filters], (sdk, cursor) => sdk.people(filters, { cursor, limit: 30 }));
  const count = Object.keys(selected).length, all = list.rows.length > 0 && list.rows.every((p) => selected[p.id]);
  return <div className="space-y-4">
    <PeoplePicker sdk={sdk} identity={identity} environment={environment} kind="coordinators" label="Filter by Sales Co" name="filter" value={filter} onChange={(v) => { setFilter(v); setSelected({}); }} />
    <SearchHeader title="Customers" count={list.isLoading ? null : list.rows.length} placeholder="Search Customers" onSearch={(t) => { setTerm(t); setSelected({}); }} onRefresh={list.refetch} refreshing={list.isFetching} />
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={() => setSelected((cur) => selectVisiblePeople(cur, list.rows, !all))} />Select All</label>
      <span className="text-sm text-muted-foreground">{count} selected · maximum 100</span>
      {count > 0 && <Button disabled={!canWrite} onClick={() => setOpen(true)}>Select SC to Update</Button>}
    </div>
    {list.isLoading ? <ResourceState status="loading" /> : list.error ? <ResourceState status="error" error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? <ResourceState title="No customers found" /> :
      <ul className="divide-y rounded-xl border">{list.rows.map((p) => <li key={p.id}><label className="flex cursor-pointer items-center gap-3 p-3">
        <input type="checkbox" checked={!!selected[p.id]} disabled={!selected[p.id] && count >= 100} onChange={(e) => setSelected((cur) => selectVisiblePeople(cur, [p], e.target.checked))} />
        <span className="min-w-0"><strong className="block truncate">{p.company_name || p.name || `Account #${p.id}`}</strong><span className="block truncate text-xs text-muted-foreground">{p.email}</span></span></label></li>)}</ul>}
    <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />
    {open && <CommandDialog title="Assign coordinator" description="Pending orders follow the new coordinator. Completed history stays unchanged." open onClose={() => setOpen(false)} disabled={!canWrite}
      onSubmit={(v, c) => sdk.reassignCustomers(Object.values(selected), v.coordinator, v.reason, c.idempotencyKey)} onSuccess={() => { setSelected({}); list.refetch(); }}>
      <PeoplePicker sdk={sdk} identity={identity} environment={environment} kind="coordinators" label="Sales Co" name="coordinator" required />
      <Field label="Reason" name="reason" minLength={3} required />
    </CommandDialog>}
  </div>;
}
