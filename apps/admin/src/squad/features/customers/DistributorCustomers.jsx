import React,{useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useSquadQuery} from '../../data/hooks';
import {DataTable,Panel,Pager,QueryState,Status} from '../orders/CommerceUI';
import {accountStatus} from '../people/peopleModel';

export default function DistributorCustomers({person,environment,identity,onNavigate,path,search:locationSearch}){
 const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[stack,setStack]=useState([null]);
 const filters={role:3,dealer_id:person.id,search:term};
 const query=useSquadQuery(['distributor-customers',environment,identity.id,filters,stack.at(-1)],({sdk})=>sdk.people(filters,{limit:20,cursor:stack.at(-1)}));
 const rows=query.data?.data??[];
 return <Panel title="Linked customers"><form className="flex gap-2 p-4" onSubmit={e=>{e.preventDefault();setTerm(search.trim());setStack([null]);}}><Input aria-label="Search linked customers" placeholder="Name, company or email" value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/><Button variant="outline">Search</Button></form><QueryState query={query} empty={!rows.length} title="No linked customers found" description="Only customers you have permission to view are shown."><DataTable rows={rows} columns={[{key:'name',label:'Customer',render:p=><button className="text-left font-medium" onClick={()=>onNavigate(`/squad/customers/${p.id}?returnTo=${encodeURIComponent(`${path}${locationSearch??''}`)}`)}>{p.company_name||p.name}</button>},{key:'email',label:'Email'},{key:'status',label:'Account',render:p=><Status>{accountStatus(p)}</Status>},{key:'open',label:'',render:p=><Button variant="ghost" onClick={()=>onNavigate(`/squad/customers/${p.id}?returnTo=${encodeURIComponent(`${path}${locationSearch??''}`)}`)}>View account</Button>}]}/></QueryState><Pager stack={stack} setStack={setStack} next={query.data?.next_cursor} fetching={query.isFetching} count={rows.length}/></Panel>;
}
