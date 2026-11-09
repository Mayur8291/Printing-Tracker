import React,{useState} from 'react';
import {useSquadQuery} from '../../data/hooks';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Field,SelectField} from '../orders/CommerceUI';

/** Bounded, searchable server options. Selection preserves decimal IDs as strings. */
export default function PeoplePicker({sdk,identity,environment,role,kind,label,name,value,onChange,defaultValue='',required=false,customerId,factory=false}){
 const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[cursor,setCursor]=useState(null),[selected,setSelected]=useState(defaultValue);
 const query=useSquadQuery(['people-picker',environment,identity.id,role,kind,factory,customerId,term,cursor],({sdk}) => factory?sdk.factories(term,{cursor,limit:30}):kind?sdk.relationshipOptions(kind,{customerId,search:term},{cursor,limit:30}):sdk.people({role,search:term},{cursor,limit:30}));
 const current=value??selected,rows=query.data?.data??[];
 return <div className="space-y-2"><SelectField label={label} name={name} required={required} value={current} onChange={e=>{setSelected(e.target.value);onChange?.(e.target.value);}}><option value="">Choose {label.toLowerCase()}</option>{current&&!rows.some(r=>r.id===current)&&<option value={current}>Selected #{current}</option>}{rows.map(r=><option value={r.id} key={r.id}>{r.name||r.company_name||`#${r.id}`}</option>)}</SelectField><div className="flex gap-2"><Input aria-label={`Search ${label.toLowerCase()}`} value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Find ${label.toLowerCase()}`} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();setTerm(search.trim());setCursor(null);}}}/><Button type="button" variant="outline" onClick={()=>{setTerm(search.trim());setCursor(null);}}>Find</Button>{query.data?.next_cursor&&<Button type="button" variant="ghost" onClick={()=>setCursor(query.data.next_cursor)}>More</Button>}</div>{query.isFetching&&<p role="status" className="text-xs text-muted-foreground">Loading choices…</p>}{query.error&&<p role="alert" className="text-xs text-destructive">{query.error.message}</p>}</div>;
}
