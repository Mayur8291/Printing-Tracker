import React from 'react';
import {Panel,QueryState,DataTable,DateText,Pagination,useCursor,useOperationQuery} from '../production/OperationsUI';
export default function WorkerCommitmentHistory({sdk,identity,environment,order}){
 const page=useCursor();
 const query=useOperationQuery(['worker-commitment',environment,identity.id,order.id,order.version,page.cursor],({sdk}) => sdk.orderSection(order.id,'worker_history',{cursor:page.cursor,limit:25}));
 const commitment=query.data?.commitment;
 return <Panel title="Commitment history" description="Changes recorded for the current job-worker assignment.">
  <div className={query.data?.data.length?"p-5":""}><QueryState query={query}/>{commitment&&<dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Original commitment</dt><dd className="mt-1 font-medium">{commitment.original_due_at?<DateText value={commitment.original_due_at}/>: 'Not recorded in the source'}</dd></div><div><dt className="text-muted-foreground">Latest reason</dt><dd className="mt-1 whitespace-pre-wrap">{commitment.reason||'No change recorded'}{commitment.reason_truncated?'…':''}{commitment.reason_basis==='legacy_current_value'&&<p className="mt-1 text-xs text-muted-foreground">Imported current value; change date was not recorded.</p>}</dd></div></dl>}</div>
  {query.data?.data.length>0?<DataTable rows={query.data.data} columns={[{key:'occurred_at',label:'Recorded',render:r=><span className="whitespace-nowrap"><DateText value={r.occurred_at}/></span>},{key:'before',label:'Previous due',render:r=><DateText value={r.before}/>},{key:'after',label:'New due',render:r=><DateText value={r.after}/>},{key:'reason',label:'Reason',render:r=><p className="min-w-40 whitespace-pre-wrap">{r.reason||'—'}{r.reason_truncated?'…':''}</p>}]}/>:query.data&&<p className="mt-4 text-sm text-muted-foreground">No dated changes are recorded for this assignment.</p>}
  <div className={query.data?.data.length?"px-5 pb-4":""}><Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={()=>page.next(query.data?.next_cursor)} loading={query.loading}/></div>
 </Panel>;
}
