import {Button} from '@/components/ui/button';
import {Field,SelectField} from './CommerceUI';
import PeoplePicker from '../people/PeoplePicker';

export function orderFilterValues(values){
 const result={};
 for(const key of ['prime','assigned'])if(values[key])result[key]=values[key]==='true';
 for(const key of ['criteria','worker_status'])if(values[key]!==undefined&&values[key]!=='')result[key]=Number(values[key]);
 for(const key of ['assignment_kind','customer_id'])if(values[key])result[key]=values[key];
 for(const key of ['created_from','created_before','due_before'])if(values[key])result[key]=new Date(values[key]).toISOString();
 return result;
}

export default function OrderFilters({sdk,identity,environment,onApply}){
 return <details className="border-b"><summary className="cursor-pointer px-5 py-4 text-sm font-medium">More filters</summary><form className="space-y-4 px-5 pb-5" onSubmit={event=>{event.preventDefault();onApply(orderFilterValues(Object.fromEntries(new FormData(event.currentTarget))));}}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
  {[0,1,10].includes(identity.role)&&<PeoplePicker sdk={sdk} identity={identity} environment={environment} role={3} label="Customer" name="customer_id"/>}
  <SelectField label="Priority" name="prime" defaultValue=""><option value="">Any priority</option><option value="true">Prime only</option><option value="false">Standard only</option></SelectField>
  <SelectField label="Production allocation" name="assignment_kind" defaultValue=""><option value="">Any allocation</option><option value="unassigned">Not assigned</option><option value="factory">Factory</option><option value="job_worker">External job worker</option><option value="ambiguous">Needs assignment review</option></SelectField>
  <SelectField label="Criteria" name="criteria" defaultValue=""><option value="">Any readiness</option><option value="0">Pending</option><option value="1">Complete</option></SelectField>
  <Field label="Placed from" name="created_from" type="datetime-local"/><Field label="Placed before" name="created_before" type="datetime-local"/><Field label="Due before" name="due_before" type="datetime-local"/>
  {identity.role===11&&<SelectField label="External work" name="worker_status" defaultValue=""><option value="">All work</option><option value="0">Pending</option><option value="1">Complete</option></SelectField>}
 </div><div className="flex gap-2"><Button type="submit" variant="outline">Apply filters</Button><Button type="reset" variant="ghost" onClick={()=>onApply({})}>Clear extra filters</Button></div></form></details>;
}
