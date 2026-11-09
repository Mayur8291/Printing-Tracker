import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {SelectField} from '../orders/CommerceUI';
import PeoplePicker from './PeoplePicker';
import {peopleFilterValues} from './peopleModel';

/** Options are fetched only when opened; every selector retains its server scope. */
export default function PeopleFilters({sdk,identity,environment,onApply}){
 const [open,setOpen]=useState(false),[revision,setRevision]=useState(0);
 const commercial=[0,1,10].includes(identity.role),workforce=[0,2,4].includes(identity.role);
 const picker={sdk,identity,environment};
 return <details className="border-b" onToggle={event=>setOpen(event.currentTarget.open)}><summary className="cursor-pointer px-5 py-4 text-sm font-medium">More people filters</summary>{open&&<form key={revision} className="space-y-4 px-5 pb-5" onSubmit={event=>{event.preventDefault();onApply(peopleFilterValues(Object.fromEntries(new FormData(event.currentTarget))));}}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
 {commercial&&<><SelectField label="Onboarding progress" name="onboarded" defaultValue=""><option value="">Any progress</option><option value="true">Complete</option><option value="false">Incomplete</option></SelectField><SelectField label="Fulfillment relationship" name="direct" defaultValue=""><option value="">Any relationship</option><option value="true">Direct</option><option value="false">Through dealer</option></SelectField><SelectField label="Registered by" name="registered_by" defaultValue=""><option value="">Any origin</option><option value="0">Customer</option><option value="1">Sales coordinator</option><option value="2">Dealer</option><option value="3">Admin</option></SelectField></>}
 {[0,1].includes(identity.role)&&<><PeoplePicker {...picker} kind="coordinators" label="Assigned sales coordinator" name="coordinator_id"/><PeoplePicker {...picker} kind="dealers" label="Linked dealer" name="dealer_id"/><PeoplePicker {...picker} kind="zones" label="Commercial zone" name="zone_id"/><PeoplePicker {...picker} kind="price_types" label="Assigned price type" name="price_type_id"/></>}
 {workforce&&<><PeoplePicker {...picker} factory label="Factory" name="factory_id"/><PeoplePicker {...picker} role={4} label="Factory manager" name="manager_id"/><PeoplePicker {...picker} role={5} label="Parent tailor" name="parent_tailor_id"/></>}
 </div><div className="flex gap-2"><Button type="submit" variant="outline">Apply people filters</Button><Button type="button" variant="ghost" onClick={()=>{setRevision(value=>value+1);onApply({});}}>Clear extra filters</Button></div></form>}</details>;
}
