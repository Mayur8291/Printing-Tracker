import React,{useEffect,useState} from 'react';
import {Plus,Search,ArrowUpRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useSquadQuery} from '../../data/hooks';
import {CommandDialog,Field,DataTable,PageTitle,Panel,Pager,QueryState,SelectField,Status} from '../orders/CommerceUI';
import {PersonDetail,PersonForm} from '../people/PeoplePage';
import {accountStatus,selectVisiblePeople} from '../people/peopleModel';
import PeopleFilters from '../people/PeopleFilters';
import PeoplePicker from '../people/PeoplePicker';
import CoordinatorRequests from '../people/CoordinatorRequests';
import {OrderCounters,CountTabs,Fab,useOrderStats,usePeopleOrderCounts,filteredOrdersHref} from '../../components/parity';
import {useMediaGrants} from '../../components/Media';
import {safeMediaUrl} from '../../components/mediaModel';
import {getEnvironmentConfig} from '../../../runtimeEnv';
import {useDirectoryPosition} from './useDirectoryPosition';
import {Sc1DirectoryToolbar,Sc1PersonCard,Sc1List} from './Sc1Customers';
import {commercialPath,directoryFilters,directoryRole,readDirectoryState} from './customerDirectoryModel';

export default function CustomersPage(props){
  const params=new URLSearchParams(props.search),distributorPath=/^\/squad\/distributors\/?$/.test(props.path??'');
  const tab=params.get('tab')||(distributorPath?'distributors':'customers');
  const id=props.path?.match(/\/(?:customers|distributors)\/([^/]+)/)?.[1];
  const directoryParams=new URLSearchParams(params);
  for(const key of ['returnTo','order_q','order_state','order_type','order_pages'])directoryParams.delete(key);
  const returnTo=params.get('returnTo');
  const backTo=/^\/squad\/distributors\/\d+(\?|$)/.test(returnTo??'')?returnTo:`/squad/customers?${directoryParams}`;
  const listKey=new URLSearchParams(params);listKey.delete('pages');listKey.delete('view');
  return id?<>{props.persona&&/^[1-9]\d{0,18}$/.test(id)&&<CustomerStats id={id} onNavigate={props.onNavigate}/>}<PersonDetail key={id} {...props} id={id} backTo={backTo}/></>:<Directory key={listKey.toString()} {...props} params={params} tab={tab}/>;
}
/** Flutter CustomerDetailsView: the customer's order counters above the profile (tiles open their filtered orders). */
function CustomerStats({id,onNavigate}){
  const subject={kind:'customer',id},stats=useOrderStats({},subject);
  return <div className="mb-5"><OrderCounters stats={stats.data} loading={stats.isLoading} onSelect={tile=>onNavigate(filteredOrdersHref(tile.drill,{subject,title:'Customer orders'}))}/></div>;
}
function Directory(props){
  const {identity,environment,sdk,canWrite,onNavigate,params,tab,scott}=props;
  const role=directoryRole(tab,identity.role),label=role===10?'Distributors':'Customers';
  const restored=readDirectoryState(params);
  const [search,setSearch]=useState(params.get('q')||''),extra=restored.filters,stack=restored.cursors;
  const setStack=value=>navigate({pages:JSON.stringify(value)});
  const [create,setCreate]=useState(false),[selected,setSelected]=useState({}),[reassign,setReassign]=useState(false),[requests,setRequests]=useState(false);
  const view=params.get('view')||'cards',status=params.get('status')||'';
  const filters=directoryFilters(role,params.get('q')||'',status,extra);
  const query=useSquadQuery(['customer-directory',environment,identity.id,filters,stack.at(-1)],({sdk})=>sdk.people(filters,{cursor:stack.at(-1),limit:30}),{staleTime:60_000});
  const rows=query.data?.data??[],admin=identity.role===0;
  const showStats=[0,1].includes(identity.role)&&params.get('persona_stats')!=='0';
  const stats=useOrderStats({},null,{enabled:showStats});
  const counts=usePeopleOrderCounts('customer',rows.map(p=>String(p.id)),{enabled:showStats});
  const photos=useMediaGrants(rows.map(p=>({resource:'users',record_id:p.id,field:'profile_image'})));
  const grants=new Map((photos.data??[]).map(g=>[String(g.record_id),g]));
  useDirectoryPosition(sdk,JSON.stringify([environment,identity.auth_id,identity.id,identity.role,identity.write_state?.generation,params.toString()]),!!query.data);
  function navigate(values){const next=new URLSearchParams(params);if(!Object.hasOwn(values,'pages'))next.delete('pages');for(const [key,value] of Object.entries(values))value?next.set(key,value):next.delete(key);const toDistributors=Object.hasOwn(values,'tab')?values.tab==='distributors':/^\/squad\/distributors\/?$/.test(props.path??'');if(toDistributors)next.delete('tab');onNavigate(`/squad/${toDistributors?'distributors':'customers'}?${next}`);}
  const open=p=>onNavigate(`${commercialPath(p)}?${params}`);
  const select=(p,checked)=>setSelected(current=>selectVisiblePeople(current,[p],checked));
  const statusBadge=p=><Status tone={accountStatus(p)==='Active'?'success':'warning'}>{accountStatus(p)}</Status>;
  const toggleSelect=p=>admin&&<input type="checkbox" aria-label={`Select ${p.name||p.id}`} checked={!!selected[p.id]} onChange={e=>select(p,e.target.checked)} disabled={!selected[p.id]&&Object.keys(selected).length>=100}/>;
  const peopleFilters=<PeopleFilters mode="commercial" values={extra} sdk={sdk} identity={identity} environment={environment} onApply={value=>navigate({filters:JSON.stringify(value)})}/>;
  return <div className="space-y-5">
    {!scott&&<PageTitle eyebrow="Business relationships" title="Customers" description={identity.role===10?'Manage the customers linked to your distributor account.':'Manage customers, distributors and account reviews.'} actions={<>{admin&&<Button variant="outline" onClick={()=>navigate({status:'pending'})}>Customers Verification</Button>}{admin&&<Button variant="outline" onClick={()=>setRequests(!requests)}>Coordinator requests</Button>}<Button disabled={!canWrite} onClick={()=>setCreate(true)}><Plus/>Add {role===10?'distributor':'customer'}</Button></>}/>}
    {scott&&admin&&<div className="sc1-order-actions"><Button variant="outline" onClick={()=>navigate({status:'pending'})}>Customers Verification</Button><Button variant="outline" onClick={()=>setRequests(!requests)}>Coordinator requests</Button></div>}
    {scott&&<Sc1DirectoryToolbar title={label} search={search} onSearchChange={setSearch} onSearch={q=>{if(q!==(params.get('q')||''))navigate({q});}} onRefresh={()=>query.refetch()} refreshing={query.isFetching} status={status} onStatus={value=>navigate({status:value})} filterCount={(status?1:0)+Object.keys(extra).length}
      extraAction={identity.role===1&&role===3?<button type="button" className="sc1-text-action" onClick={()=>navigate({status:'onboarding'})}>Train Customer</button>:null}>{peopleFilters}</Sc1DirectoryToolbar>}
    {showStats&&<OrderCounters stats={stats.data} loading={stats.isLoading} onSelect={tile=>onNavigate(filteredOrdersHref(tile.drill,{title:label}))}/>}
    {requests&&<CoordinatorRequests {...props}/>}
    {identity.role===1&&<CountTabs className={scott?'sc1-count-chips':undefined} tabs={[{key:'approved',label:'Approved'},{key:'requested',label:'Requested'}]} value={status==='pending'?'requested':'approved'} onChange={k=>navigate({status:k==='requested'?'pending':'approved'})}/>}
    {!scott&&<div className="flex flex-wrap items-center justify-between gap-3"><div role="tablist" aria-label="Account kind" className="flex gap-1 rounded-xl bg-muted p-1">{(identity.role===10?['customers']:['customers','distributors']).map(value=><Button key={value} role="tab" aria-selected={role===(value==='distributors'?10:3)} variant={role===(value==='distributors'?10:3)?'default':'ghost'} onClick={()=>navigate({tab:value})}>{value==='customers'?'Customers':'Distributors'}</Button>)}</div><Button variant="outline" onClick={()=>navigate({view:view==='cards'?'table':'cards'})}>{view==='cards'?'Table view':'Card view'}</Button></div>}
    <Panel className={scott?'sc1-flat-panel':''}>{!scott&&<><div className="flex flex-wrap items-end gap-3 p-5"><form className="flex w-full min-w-0 basis-full gap-2 sm:w-auto sm:flex-1" onSubmit={e=>{e.preventDefault();navigate({q:search.trim()});}}><Input className="min-w-0" aria-label={`Search ${label.toLowerCase()}`} placeholder="Name, company or email" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/><Button variant="outline" type="submit"><Search/>Search</Button></form><SelectField label="Account status" value={status} onChange={e=>navigate({status:e.target.value})}><option value="">All statuses</option><option value="pending">Awaiting review</option><option value="onboarding">Onboarding</option><option value="active">Active</option><option value="disabled">Disabled</option></SelectField><Button variant="outline" onClick={()=>query.refetch()} disabled={query.isFetching}>Refresh</Button></div>{peopleFilters}</>}
    {admin&&rows.length>0&&<div className="flex flex-wrap items-center gap-3 border-t p-3"><Button variant="ghost" onClick={()=>setSelected(current=>selectVisiblePeople(current,rows,!rows.every(p=>current[p.id])))}>Select / clear this page</Button><span className="text-sm text-muted-foreground">{Object.keys(selected).length} selected · maximum 100</span>{Object.keys(selected).length>0&&<><Button disabled={!canWrite} onClick={()=>setReassign(true)}>Assign coordinator</Button><Button variant="ghost" onClick={()=>setSelected({})}>Clear</Button></>}</div>}
    <QueryState query={query} empty={!rows.length} title={`No ${label.toLowerCase()} match`} description="Try another search or change the filters.">
      {scott?<Sc1List>{rows.map(p=><Sc1PersonCard key={p.id} person={p} avatar={<CustomerAvatar person={p} grant={grants.get(String(p.id))} environment={environment}/>} counts={counts.data?.[p.id]} hint={[0,1].includes(identity.role)&&p.approved!==true?'Review account':p.approved===true&&!p.onboarded?'View onboarding':null} onOpen={()=>open(p)} select={toggleSelect(p)||null}/>)}</Sc1List>:view==='table'?<DataTable rows={rows} columns={[...(admin?[{key:'select',label:'Select',render:p=><input type="checkbox" aria-label={`Select ${p.name||p.id}`} checked={!!selected[p.id]} onChange={e=>select(p,e.target.checked)} disabled={!selected[p.id]&&Object.keys(selected).length>=100}/>}]:[]),{key:'name',label:'Business',render:p=><button className="text-left font-semibold" onClick={()=>open(p)}>{p.company_name||p.name}</button>},{key:'email',label:'Email'},{key:'phone',label:'Phone'},{key:'state',label:'Account',render:statusBadge},{key:'open',label:'',render:p=><Button variant="ghost" onClick={()=>open(p)}>Open<ArrowUpRight/></Button>}]}/>:<div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(p=><article key={p.id} className="flex flex-col gap-4 rounded-2xl border bg-background p-5 shadow-sm"><div className="flex items-start justify-between gap-2"><CustomerAvatar person={p} grant={grants.get(String(p.id))} environment={environment}/>{statusBadge(p)}{admin&&<input type="checkbox" aria-label={`Select ${p.name||p.id}`} checked={!!selected[p.id]} onChange={e=>select(p,e.target.checked)} disabled={!selected[p.id]&&Object.keys(selected).length>=100}/>}</div><button className="text-left" onClick={()=>open(p)}><h2 className="text-lg font-semibold tracking-tight">{p.company_name||p.name||`Account #${p.id}`}</h2>{p.company_name&&p.name&&<p className="mt-1 text-sm text-muted-foreground">{p.name}</p>}</button>{counts.data?.[p.id]&&<p className="text-xs font-medium tracking-wide text-muted-foreground">PENDING ORDERS {counts.data[p.id].pending} · COMPLETED ORDERS {counts.data[p.id].completed}</p>}<div className="flex-1 space-y-1 break-words text-sm text-muted-foreground"><p>{p.email||'Email not provided'}</p><p>{p.phone||'Phone not provided'}</p></div><Button variant="outline" className="w-full justify-between" onClick={()=>open(p)}>{[0,1].includes(identity.role)&&p.approved!==true?'Review account':p.approved===true&&!p.onboarded?'View onboarding':'View details and orders'}<ArrowUpRight/></Button></article>)}</div>}
    </QueryState><Pager stack={stack} setStack={setStack} next={query.data?.next_cursor} fetching={query.isFetching} count={rows.length}/></Panel>
    {scott?canWrite&&<Fab label={`Add ${role===10?'distributor':'customer'}`} onClick={()=>setCreate(true)}/>:identity.role===1&&role===3&&<Fab label="Train Customer" onClick={()=>navigate({status:'onboarding'})}/>}
    {create&&<PersonForm {...props} allowedRoles={[role]} onClose={()=>setCreate(false)} onSaved={async p=>{await query.refetch();open({...p,role});}}/>}
    {reassign&&<CommandDialog title="Assign coordinator" description="Pending orders follow the new coordinator. Completed history stays unchanged." open onClose={()=>setReassign(false)} disabled={!canWrite} onSubmit={(v,c)=>sdk.reassignCustomers(Object.values(selected),v.coordinator,v.reason,c.idempotencyKey)} onSuccess={async()=>{setSelected({});await query.refetch();}}><PeoplePicker sdk={sdk} identity={identity} environment={environment} kind="coordinators" label="Coordinator" name="coordinator" required/><Field label="Reason" name="reason" minLength={3} required/></CommandDialog>}
  </div>;
}

function CustomerAvatar({person,grant,environment}){
  const url=grant?.status==='ready'&&['image/png','image/jpeg','image/webp','image/gif'].includes(grant.content_type)?safeMediaUrl(grant.url,getEnvironmentConfig(environment).url):null;
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[url]);
  const initials=(person.company_name||person.name||'?').split(/\s+/).slice(0,2).map(n=>n[0]).join('');
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted font-semibold" aria-hidden="true">{url&&!failed?<img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={()=>setFailed(true)}/>:initials}</span>;
}
