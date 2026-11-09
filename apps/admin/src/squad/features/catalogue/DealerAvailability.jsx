import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {useSquadQuery} from '../../data/hooks';
import {DataTable,Panel,Pager,QueryState,SelectField,Status} from '../orders/CommerceUI';

/** Uses customer-projected counts; never derives them from a dealer's physical ledger. */
export default function DealerAvailability({sdk,identity,environment,customerId,productId,classId}){
 const [open,setOpen]=useState(false),[dealer,setDealer]=useState(''),[stack,setStack]=useState([null]);
 const eligible=[1,3,10].includes(identity.role),customer=identity.role===3?identity.id:customerId;
 const person=useSquadQuery(['stock-customer',environment,identity.id,customer],({sdk}) => sdk.person(customer),{enabled:eligible&&open&&identity.role!==10&&!!customer});
 const dealers=identity.role===10?[{id:identity.id,name:identity.name||'My dealership'}]:person.data?.linked_dealers??[];
 const selected=dealers.some(d=>d.id===dealer)?dealer:dealers.length===1?dealers[0].id:'';
 const scope=identity.role===10?{dealerId:identity.id}:{dealerId:selected,customerId:customer};
 const filters=productId?{kind:'custom',product_id:productId}:{kind:'rmp',rmp_class_id:classId};
 const balances=useSquadQuery(['dealer-availability',environment,identity.id,scope,filters,stack.at(-1)],({sdk}) => sdk.dealerStock(filters,scope,{cursor:stack.at(-1),limit:30}),{enabled:eligible&&open&&!!selected&&!!(productId||classId)&&person.data?.direct_deal!==true});
 if(!eligible)return null;
 return <Panel title="Dealer availability" description="Check availability for this product through the customer's linked dealership." actions={<Button variant="outline" size="sm" onClick={()=>setOpen(!open)}>{open?'Hide availability':'Check availability'}</Button>}>
  {open&&<div className="space-y-4 p-5">{identity.role!==10&&!customer?<p className="text-sm text-muted-foreground">Select a customer to see their dealer availability.</p>:identity.role!==10&&(person.isLoading||person.error)?<QueryState query={person}/>:person.data?.direct_deal?<p className="text-sm text-muted-foreground">This customer orders directly; dealer availability does not apply.</p>:!dealers.length?<p className="text-sm text-muted-foreground">No active dealership is linked to this customer.</p>:<>
   <SelectField label="Dealership" value={selected} onChange={e=>{setDealer(e.target.value);setStack([null]);}}><option value="">Select a dealership</option>{dealers.map(d=><option key={d.id} value={d.id}>{d.name||`Dealer #${d.id}`}</option>)}</SelectField>
   {selected&&<><QueryState query={balances} empty={!balances.data?.data?.length} title="No dealer stock available" description="No matching inventory is currently available for this product."><DataTable rows={balances.data?.data??[]} columns={[{key:'product_name',label:'Product'},{key:'brand_name',label:'Brand'},{key:'size_name',label:'Size',render:r=>r.size_name||`Size #${r.size_id}`},{key:'available',label:'Available',render:r=>r.available===null?'Awaiting verification':r.available},{key:'status',label:'Status',render:r=><Status tone={r.status==='ready'?'success':'warning'}>{r.status==='ready'?'Available':'Needs verification'}</Status>}]}/></QueryState><Pager next={balances.data?.next_cursor} stack={stack} setStack={setStack} fetching={balances.isFetching} count={balances.data?.data?.length}/><p className="text-xs text-muted-foreground">Availability is shown according to this account's stock rules. Viewing stock does not reserve it.</p></>}
  </>}</div>}
 </Panel>;
}
