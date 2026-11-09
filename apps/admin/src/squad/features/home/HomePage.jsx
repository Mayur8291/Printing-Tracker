import { useState } from "react";
import AccountContacts from "../../components/AccountContacts";
import { Input } from "../../../components/ui/input";
import { dashboardPeriod } from "../../components/dashboardPeriod";
import { ArrowUpRight, Package, Clock3, CircleCheck, Truck } from "lucide-react";
import { Skeleton } from "../../../components/ui/skeleton";
import { Button } from "../../../components/ui/button";
import { HOME_COPY, navigationFor } from "../../navigation/registry";
import { useSquadQuery } from "../../data/hooks";
import { date, number, money } from "../../data/format";
import { PageHeader, ResourceState, MetricCard, SectionCard, DataTable, StatusBadge, Field } from "../../components";

export default function HomePage({ sdk, identity, environment, onNavigate }) {
  const team = identity.role === 12;
  const [from,setFrom]=useState(""),[through,setThrough]=useState(""),[period,setPeriod]=useState({}),[periodError,setPeriodError]=useState("");
  const summary = useSquadQuery(["dashboard",period], ({sdk}) => sdk.dashboard(period), { enabled: !team });
  const recent = useSquadQuery(["home-orders",period], ({sdk}) => sdk.orders(period, { limit: 5 }), { enabled: [0,1,2,3,4,10,11].includes(identity.role) });
  const links = navigationFor(identity).filter((item) => !["home", "profile", "notifications"].includes(item.key));
  const [title, description] = HOME_COPY[identity.role];
  return <div className="space-y-6"><PageHeader eyebrow={`Welcome${identity.name ? `, ${identity.name.split(" ")[0]}` : ""}`} title={title} description={description} />
    {!team&&<form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();try{setPeriod(dashboardPeriod(from,through));setPeriodError("");}catch(error){setPeriodError(error.message);}}}><Field label="Created from"><Input type="date" value={from} max={through||undefined} onChange={event=>setFrom(event.target.value)}/></Field><Field label="Through"><Input type="date" value={through} min={from||undefined} onChange={event=>setThrough(event.target.value)}/></Field><Button type="submit" variant="outline">Apply period</Button>{(from||through||Object.keys(period).length>0)&&<Button type="button" variant="ghost" onClick={()=>{setFrom("");setThrough("");setPeriod({});setPeriodError("");}}>All time</Button>}<span className="pb-2 text-xs text-muted-foreground">India time</span>{periodError&&<p role="alert" className="w-full text-sm text-destructive">{periodError}</p>}</form>}
    {!team && (summary.isLoading ? <><div className="grid grid-cols-2 gap-4 xl:grid-cols-4" role="status" aria-label="Loading your overview" aria-busy="true">{[0,1,2,3].map(index=><div key={index} className="squad-metric" aria-hidden="true"><div className="flex items-center justify-between gap-3"><Skeleton className="h-3 w-20"/><Skeleton className="size-4"/></div><Skeleton className="mt-4 h-8 w-20"/>{index===0&&<Skeleton className="mt-3 h-3 w-28 max-w-full"/>}</div>)}</div><div aria-hidden="true" className="h-4"><Skeleton className="h-3 w-64 max-w-full"/></div></> : summary.error ? <ResourceState status="error" error={summary.error} onRetry={summary.refetch} /> : <><div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <MetricCard label="Orders" value={number(summary.data?.orders)} icon={Package} description={identity.role===3?"Your orders":"Within your assigned scope"} />
      <MetricCard label="In progress" value={number(summary.data?.pending)} icon={Clock3} />
      <MetricCard label="Completed" value={number(summary.data?.completed)} icon={CircleCheck} />
      <MetricCard label="Pieces dispatched" value={number(summary.data?.dispatched)} icon={Truck} />
    </div><p className="text-xs text-muted-foreground">Updated {date(summary.data?.as_of, true)} · Your authorized records only</p><OrderStatusBreakdown data={summary.data}/></>)}
    <AccountContacts sdk={sdk} identity={identity} environment={environment}/>
    <SectionCard title="Your workspace" description={team && !links.length ? "Your administrator has not assigned additional modules yet. Your account remains available below." : "Pick up where you need to work next."}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{links.map((item) => <button type="button" key={item.key} className="group flex items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onNavigate(item.href)}><div><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs text-muted-foreground">{item.group}</p></div><ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></button>)}</div>
      {team && !links.length && <Button variant="outline" onClick={() => onNavigate("/squad/profile")}>View my account</Button>}
    </SectionCard>
    {recent.data && <SectionCard title="Recent orders" description={Object.keys(period).length?"The latest orders in your selected period.":"The latest orders visible to your account."} actions={<Button variant="ghost" size="sm" onClick={() => onNavigate("/squad/orders")}>View all<ArrowUpRight className="ml-2 size-4" /></Button>}><DataTable caption="Recent orders" rows={recent.data.data} onRowClick={(row) => onNavigate(`/squad/orders/${row.id}`)} columns={[
      { key: "id", label: "Order", render: (id) => `#${id}` }, { key: "created_at", label: "Created", render: value=><span className="whitespace-nowrap">{date(value)}</span> },
      { key: "status", label: "Status", render: (status, row) => <StatusBadge tone={row.provider_status === "CANCELLED" ? "danger" : status === 1 ? "success" : "info"}>{row.provider_status === "CANCELLED" ? "Cancelled" : status === 1 ? "Completed" : "In progress"}</StatusBadge> },
      { key: "total_quantity", label: "Pieces", align: "right", render: number },
      ...([0,1,3,10].includes(identity.role) ? [{ key: "total_amount", label: "Amount", align: "right", render: money }] : []),
    ]} /></SectionCard>}
    {recent.error && <ResourceState status="error" title="Recent orders could not be loaded" error={recent.error} onRetry={recent.refetch} />}
  </div>;
}

function OrderStatusBreakdown({data}) {
  const rows=[{label:"In progress",value:data?.pending,color:"bg-blue-500"},{label:"Completed",value:data?.completed,color:"bg-emerald-500"},{label:"Cancelled",value:data?.cancelled,color:"bg-rose-500"}];
  if(rows.some(row=>typeof row.value!=="number"||!Number.isFinite(row.value)||row.value<0))return null;
  const total=rows.reduce((sum,row)=>sum+row.value,0);
  return <SectionCard title="Order status" description="Current status of orders created in the selected period.">{total===0?<p className="text-sm text-muted-foreground">No orders in this period.</p>:<ul className="grid gap-5 sm:grid-cols-3" aria-label="Order status breakdown">{rows.map(row=><li key={row.label}><div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{row.label}</span><span className="font-medium tabular-nums">{number(row.value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={`h-full rounded-full ${row.color}`} style={{width:`${row.value/total*100}%`}}/></div></li>)}</ul>}</SectionCard>;
}
