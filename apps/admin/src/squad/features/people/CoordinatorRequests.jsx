import React,{useState} from 'react';
import {Button} from '@/components/ui/button';
import {useSquadQuery} from '../../data/hooks';
import {CommandDialog,DataTable,Field,Pager,Panel,QueryState,SelectField,Status} from '../orders/CommerceUI';
import PeoplePicker from './PeoplePicker';
import {dateLabel} from '../orders/orderModel';
import {Sc1StaffHead} from '../coordinators/Sc1Staff';

export default function CoordinatorRequests({sdk,identity,environment,canWrite,scott,path}){
 const [stack,setStack]=useState([null]),[state,setState]=useState('pending'),[selection,setSelection]=useState(null),[request,setRequest]=useState(false);
 const query=useSquadQuery(['coordinator-requests',environment,identity.id,state,stack.at(-1)],({sdk}) => sdk.coordinatorRequests({state},{cursor:stack.at(-1),limit:30}),{enabled:[0,3].includes(identity.role)});
 if(![0,3].includes(identity.role))return null;
const states=['pending','approved','rejected','all'],changeState=value=>{setState(value);setStack([null]);};
 const ask=identity.role===3?<Button size="sm" variant="outline" disabled={!canWrite} onClick={()=>setRequest(true)}>Request a change</Button>:undefined;
 const table=<DataTable rows={query.data?.data??[]} columns={[{key:'customer_id',label:'Customer',render:r=>`#${r.customer_id}`},{key:'requested_coordinator_id',label:'Requested coordinator',render:r=>`#${r.requested_coordinator_id}`},{key:'state',label:'Status',render:r=><Status tone={r.state==='approved'?'success':'neutral'}>{r.state}</Status>},{key:'created_at',label:'Requested',render:r=>dateLabel(r.created_at)},{key:'reason',label:'Reason'},{key:'action',label:'',render:r=>identity.role===0&&r.state==='pending'?<Button size="sm" variant="outline" disabled={!canWrite} onClick={()=>setSelection(r)}>Review</Button>:r.decision_reason??'—'}]}/>;
 const results=<QueryState query={query} empty={!query.data?.data?.length} title="No coordinator requests">{scott?<Panel>{table}</Panel>:table}</QueryState>;
 const pager=<Pager stack={stack} setStack={setStack} next={query.data?.next_cursor} fetching={query.isFetching} count={query.data?.data?.length}/>;
 const dialogs=<> {request&&<CommandDialog title="Request coordinator change" description="The administrator reviews your request. Your current coordinator remains assigned until approval." open onClose={()=>setRequest(false)} disabled={!canWrite} onSubmit={(v,c)=>sdk.requestCoordinator(v.coordinator,v.reason,c.idempotencyKey)} onSuccess={()=>query.refetch()} confirm="Send request"><PeoplePicker sdk={sdk} identity={identity} environment={environment} kind="coordinators" label="Sales coordinator" name="coordinator" required/><Field label="Reason" name="reason" required minLength={3} maxLength={1000}/></CommandDialog>}
 {selection&&<CommandDialog title="Review coordinator request" description={`Customer #${selection.customer_id} requested coordinator #${selection.requested_coordinator_id}. Approval changes pending-order routing and preserves completed history.`} open onClose={()=>setSelection(null)} disabled={!canWrite} version={selection.version} onSubmit={(v,c)=>sdk.decideCoordinatorRequest(selection.id,v.decision,v.reason,selection.customer_version,c)} onSuccess={()=>query.refetch()}><input type="hidden" name="request_id" value={selection.id}/><input type="hidden" name="customer_version" value={selection.customer_version}/><SelectField label="Decision" name="decision" defaultValue="approved"><option value="approved">Approve</option><option value="rejected">Reject</option></SelectField><Field label="Decision note" name="reason" required minLength={3} maxLength={1000}/></CommandDialog>}</>;
 if(scott)return <div className="space-y-3 sc1-staff"><Sc1StaffHead as={path?.startsWith('/squad/customer-requests')?'h1':'h2'} title="Coordinator requests" onRefresh={()=>query.refetch()} refreshing={query.isFetching} chipLabel="Request status" chips={states.map(s=>[s,s.charAt(0).toUpperCase()+s.slice(1)])} chip={state} onChip={changeState}/>{ask}{results}<div className="sc1-staff-pager">{pager}</div>{dialogs}</div>;
 return <Panel title="Coordinator requests" description={identity.role===3?'Direct customers can request a different sales coordinator.':'Review requested changes before rerouting pending orders.'} actions={ask}><div className="p-5"><SelectField label="Request status" value={state} onChange={e=>changeState(e.target.value)}>{states.map(s=><option key={s} value={s}>{s}</option>)}</SelectField></div>{results}{pager}
 {dialogs}
 </Panel>;
}
