import React,{useState} from 'react';
import {ArrowUpRight,RefreshCw,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Panel,QueryState,Select,Pagination,useCursor,useOperationQuery,DateText,Status,DataTable,RefreshButton} from './OperationsUI';
import {roleOf} from './operationsModel';
import {Surface,Card,Badge,Icon} from '../../../scott-one-ui';
import './sc1TailorWork.css';

// The same item view serves a selected tailor and the factory inspection queue.
// Completion is evaluated by the server against the appropriate source counter.
export default function TailorWorkPanel(props){
 return <OperationalItemsPanel key={`${props.environment}:${props.identity.id}:${props.tailorId}`} {...props}/>;
}
export function OperationalItemsPanel({sdk,identity,environment,tailorId,onNavigate,scott}){
 const page=useCursor(),[completed,setCompleted]=useState(false),[search,setSearch]=useState(''),[itemId,setItemId]=useState(null);
 const role=roleOf(identity),filters={completed,...(tailorId?{tailorId}:{}),...(itemId?{itemId}:{})};
 const query=useOperationQuery(['operational-items',environment,identity.id,filters,page.cursor],({sdk}) => sdk.operationalItems(filters,{cursor:page.cursor,limit:25}));
 const rows=query.data?.data||[];
 const open=r=>onNavigate(role===0?`/squad/orders/${r.order_id}`:`/squad/production/${[2,4].includes(role)?'factory':'inspection'}/${r.id}`);
 const tone=r=>r.needs_reconciliation?'warning':r.completed?'success':'neutral';
 const stateLabel=r=>r.needs_reconciliation?'Needs review':r.completed?'Completed':'Pending';
 const columns=[{key:'id',label:'Work item',render:r=><div className="min-w-[160px]"><Button variant="link" className="h-auto p-0" onClick={()=>open(r)}>Item #{r.id}<ArrowUpRight/></Button><p className="mt-1 text-xs text-muted-foreground">{r.product_name||`Order #${r.order_id}`}</p></div>},
  {key:'assigned',label:'Assigned'},{key:'inspected',label:'Inspected'},
  {key:'due_at',label:'Due',render:r=><span className="whitespace-nowrap"><DateText value={r.due_at}/></span>},
  {key:'completed',label:'Status',render:r=><Status tone={tone(r)}>{stateLabel(r)}</Status>}];
 if(scott)return <section className="sc1-tailor-work" aria-label={tailorId?'Assigned work':'Inspection queue'}>
  <div className="sc1-tailor-head">{tailorId?<h2>Assigned work</h2>:<h1 className="sc1-tailor-title">Inspection</h1>}<Button type="button" variant="outline" size="icon" aria-label="Refresh" onClick={query.refresh} disabled={query.loading}><RefreshCw/></Button></div>
  {tailorId&&<p className="sc1-tailor-note">Includes work shared with other tailors.</p>}
  <div className="sc1-count-chips" role="group" aria-label="Work status">{[[false,'Pending'],[true,'Completed']].map(([value,label])=><button type="button" key={label} className={completed===value?'squad-count-tab is-active':'squad-count-tab'} aria-pressed={completed===value} onClick={()=>{if(completed===value)return;setCompleted(value);page.reset();}}>{label}</button>)}</div>
  <form className="sc1-tailor-find" onSubmit={e=>{e.preventDefault();setItemId(search.trim()||null);page.reset();}}>
   <Input aria-label="Item number" inputMode="numeric" pattern="[1-9][0-9]*" value={search} placeholder="Item number" onChange={e=>setSearch(e.target.value)}/>
   <Button type="submit" variant="outline"><Search/>Find</Button>
   {itemId&&<Button type="button" variant="ghost" onClick={()=>{setSearch('');setItemId(null);page.reset();}}>Clear</Button>}
  </form>
  <QueryState query={query} empty={!rows.length}/>
  {!query.loading&&!query.error&&rows.length>0&&<Surface skin="core" className="sc1-order-list">{rows.map(r=><Card as="article" className="sc1-order sc1-order-tap" key={r.id}>
   <div className="sc1-order-top">
    <div className="sc1-grow"><p className="sc1-caption">{r.product_name||`Order #${r.order_id}`}</p><h3><button type="button" className="sc1-order-open" onClick={()=>open(r)}>Item #{r.id}</button></h3></div>
    <Badge tone={tone(r)}>{stateLabel(r)}</Badge>
    <span className="sc1-order-chevron" aria-hidden="true"><Icon name="chevron-right" size={20}/></span>
   </div>
   <dl className="sc1-order-facts"><div><dt>Assigned</dt><dd>{r.assigned??'—'}</dd></div><div><dt>Inspected</dt><dd>{r.inspected??'—'}</dd></div><div><dt>Due</dt><dd><DateText value={r.due_at}/></dd></div></dl>
  </Card>)}</Surface>}
  <div className="sc1-tailor-pager"><Pagination loading={query.loading} cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={()=>page.next(query.data?.next_cursor)}/></div>
 </section>;
 return <Panel title={tailorId?'Assigned work':'Inspection queue'} description={tailorId?'Completion follows this tailor’s assignment, including work shared with other tailors.':'Each assigned item appears once. Open it to review sizes and record inspection.'} actions={<RefreshButton onClick={query.refresh} disabled={query.loading}/>}>
  <form className="flex flex-wrap items-end gap-3 p-5" onSubmit={e=>{e.preventDefault();setItemId(search.trim()||null);page.reset();}}>
   <label className="min-w-36 space-y-1 text-sm font-medium">Work status<Select aria-label="Work status" value={String(completed)} onChange={e=>{setCompleted(e.target.value==='true');page.reset();}}><option value="false">Pending</option><option value="true">Completed</option></Select></label>
   <label className="min-w-40 flex-1 space-y-1 text-sm font-medium">Item number<Input aria-label="Item number" inputMode="numeric" pattern="[1-9][0-9]*" value={search} placeholder="All assigned items" onChange={e=>setSearch(e.target.value)}/></label>
   <Button type="submit" variant="outline"><Search/>Find</Button>
   {itemId&&<Button type="button" variant="ghost" onClick={()=>{setSearch('');setItemId(null);page.reset();}}>Clear</Button>}
  </form>
  <QueryState query={query} empty={!rows.length}/>{!query.loading&&!query.error&&rows.length>0&&<DataTable rows={rows} columns={columns}/>}
  <div className="px-5 pb-4"><Pagination loading={query.loading} cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={()=>page.next(query.data?.next_cursor)}/></div>
 </Panel>;
}
