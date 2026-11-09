import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {useSquadQuery} from '../../data/hooks';
import {SelectField} from '../orders/CommerceUI';

export function CatalogueFilter({sdk,identity,environment,customerId,kind,value,onChange,label,custom=false,baseTypeId}){
 const [stack,setStack]=useState([null]);
 const result=useSquadQuery(['catalogue-filter',environment,identity.id,customerId,kind,custom,baseTypeId,stack.at(-1)],({sdk}) => custom?sdk.catalogue(kind,baseTypeId?{base_type_id:baseTypeId}:{},{cursor:stack.at(-1),limit:50}):sdk.catalogueOptions(kind,customerId||null,{cursor:stack.at(-1),limit:50}));
 return <div className="min-w-44 space-y-2"><SelectField label={label} value={value||''} onChange={e=>onChange(e.target.value)}><option value="">All {label.toLowerCase()}</option>{value&&!result.data?.data?.some(r=>r.id===value)&&<option value={value}>Selected #{value}</option>}{result.data?.data?.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>{result.error&&<p role="alert" className="text-xs text-destructive">{result.error.message}</p>}{(stack.length>1||result.data?.next_cursor)&&<div className="flex gap-2"><Button type="button" variant="ghost" size="sm" disabled={stack.length===1||result.isFetching} onClick={()=>setStack(stack.slice(0,-1))}>Previous choices</Button><Button type="button" variant="ghost" size="sm" disabled={!result.data?.next_cursor||result.isFetching} onClick={()=>setStack([...stack,result.data.next_cursor])}>More choices</Button></div>}</div>;
}

export function catalogueDestination(search){
 const query=new URLSearchParams(search),id=key=>{const value=query.get(key);return value&&/^[1-9][0-9]{0,18}$/.test(value)&&(value.length<19||value<='9223372036854775807')?value:'';};
 return {tab:query.get('type')==='ready-made'?'ready-made':'custom',brand:id('brand_id'),category:id('category_id'),classId:id('class_id')};
}
