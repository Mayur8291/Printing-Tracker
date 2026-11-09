import React,{useState} from 'react';
import {Button} from '@/components/ui/button';
import {useSquadQuery} from '../../data/hooks';
import {CommandDialog,Field,Panel,QueryState,SelectField,Status} from '../orders/CommerceUI';

export default function DealerPreferences({sdk,identity,environment,canWrite}){
 const [open,setOpen]=useState(false);
 const query=useSquadQuery(['dealer-preferences',environment,identity.id],({sdk}) => sdk.person(identity.id),{enabled:identity.role===10});
 if(identity.role!==10)return null;
 return <Panel title="Customer onboarding" description="Choose how newly registered dealership customers are approved." actions={<Button variant="outline" size="sm" disabled={!canWrite||!query.data} onClick={()=>setOpen(true)}>Change preference</Button>}><QueryState query={query} empty={!query.data}><div className="p-5"><Status>{query.data?.auto_approve_customers?'Automatic approval':'Review required'}</Status><p className="mt-3 text-sm text-muted-foreground">This setting applies to future onboarding. Existing customer approvals remain unchanged.</p></div></QueryState>{open&&<CommandDialog title="Customer approval preference" description="Only your dealership's automatic approval rule is changed." open onClose={()=>setOpen(false)} disabled={!canWrite} version={query.data.version} onSubmit={(v,c)=>sdk.saveDealerRules(identity.id,{auto_approve_customers:v.auto==='true'},v.reason,c)} onSuccess={()=>query.refetch()}><SelectField label="New customer approval" name="auto" defaultValue={String(query.data.auto_approve_customers??false)}><option value="false">Review required</option><option value="true">Approve automatically</option></SelectField><Field label="Reason" name="reason" required minLength={3}/></CommandDialog>}</Panel>;
}
