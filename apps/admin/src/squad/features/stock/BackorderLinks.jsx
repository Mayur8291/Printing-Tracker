import React from 'react';
import {ArrowUpRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Panel,QueryState,DataTable,DateText,Pagination,useCursor,useOperationQuery,Status} from '../production/OperationsUI';
export default function BackorderLinks({sdk,identity,environment,orderId,version,onNavigate}){
 const page=useCursor();
 const query=useOperationQuery(['backorder-links',environment,identity.id,orderId,version,page.cursor],({sdk}) => sdk.orderSection(orderId,'backorders',{cursor:page.cursor,limit:25}));
 return <Panel title="Linked stock orders" description="Purchases and customer demand you are authorized to view."><div className="px-5 pt-4"><QueryState query={query}/>{query.data&&!query.data.data.length&&<p className="text-sm text-muted-foreground">No linked stock orders are available.</p>}</div>
  {query.data?.data.length>0&&<DataTable rows={query.data.data} columns={[{key:'id',label:'Order',render:r=><Button variant="link" className="h-auto p-0" onClick={()=>onNavigate(`/squad/orders/${r.id}`)}>#{r.id}<ArrowUpRight/></Button>},{key:'direction',label:'Relationship',render:r=><span>{r.direction==='purchase'?'Stock purchase':r.direction==='demand'?'Customer demand':<Status tone="warning">Relationship needs review</Status>}</span>},{key:'total_quantity',label:'Quantity'},{key:'due_at',label:'Due',render:r=><DateText value={r.due_at}/>},{key:'status',label:'Status',render:r=><Status tone={r.status===1?'success':'neutral'}>{r.status===1?'Completed':'Pending'}</Status>}]}/>}
  <div className="px-5 pb-4"><Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={()=>page.next(query.data?.next_cursor)} loading={query.loading}/></div>
 </Panel>;
}
