import {useState} from 'react';
import CanonicalLocationFields from './CanonicalLocationFields';
import {canonicalLocation,locationError} from './addressModel';
import {MapPin,Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useSquadQuery} from '../../data/hooks';
import {CommandDialog,Field,Panel,QueryState,SelectField,Status} from '../orders/CommerceUI';

/** Shared by self profile, managed people and checkout; source-used addresses stay immutable. */
export default function AddressBook({sdk,identity,environment,canWrite,person:provided,userId=identity.id,onSaved}){
 const [edit,setEdit]=useState(null),[remove,setRemove]=useState(null),[message,setMessage]=useState('');
 const query=useSquadQuery(['address-book',environment,identity.id,userId],({sdk}) => sdk.person(userId),{enabled:!provided});
 const person=provided??query.data;
 async function saved(result){setMessage('Address saved. Delivery and commercial rules have been refreshed.');if(!provided)await query.refetch();await onSaved?.(result);}
 if(!person)return <QueryState query={query} empty={!query.data} title="Address book unavailable"/>;
 if(!Array.isArray(person.addresses))return null;
 return <Panel title="Addresses" description="Delivery locations and the primary address used for your commercial rules." actions={<Button size="sm" variant="outline" disabled={!canWrite} onClick={()=>setEdit({})}><Plus/>Add address</Button>}>
  {message&&<p role="status" className="border-b bg-muted/30 p-4 text-sm">{message}</p>}
  <div className="divide-y">{person.addresses.map(address=><div key={address.id} className="flex flex-wrap items-start justify-between gap-4 p-5"><div className="flex gap-3"><MapPin className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"/><div><p className="text-sm leading-6">{address.address}<br/>{[address.city,address.state,address.zip_code].filter(Boolean).join(', ')}</p><div className="mt-2 flex flex-wrap gap-2">{address.is_primary&&<Status>Primary</Status>}{address.used_on_orders&&<Status>Used on orders</Status>}</div></div></div><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!canWrite} onClick={()=>setEdit(address)}>{address.used_on_orders?'Change primary status':'Edit'}</Button><Button size="sm" variant="ghost" disabled={!canWrite||address.used_on_orders} onClick={()=>setRemove(address)}>Remove</Button></div></div>)}{!person.addresses.length&&<p className="p-5 text-sm text-muted-foreground">No addresses saved yet. Add a delivery address before placing an order.</p>}</div>
  {edit&&<CommandDialog title={edit.id?'Edit address':'Add address'} description={edit.used_on_orders?'This address appears on existing orders. Its delivery details are preserved; you can change whether it is the primary address. Add a new address for different delivery details.':'The primary city determines applicable zone and dealer rules for future orders.'} open onClose={()=>setEdit(null)} disabled={!canWrite} version={edit.version} onSubmit={(values,command)=>{const error=edit.used_on_orders?null:locationError(values.state,values.city,{legacy:edit,allowLegacy:!!edit.id});if(error)throw new Error(error);const location=canonicalLocation(values.state,values.city)??{state:values.state,city:values.city};return sdk.saveAddress(edit.id??null,userId,{...(edit.used_on_orders?{}:{address:values.address,...location,zip_code:values.zip_code}),is_primary:values.primary==='true'},command);}} onSuccess={saved}>
   <input type="hidden" name="owner" value={userId}/><input type="hidden" name="address_id" value={edit.id??''}/>
   <Field label="Street address" name="address" defaultValue={edit.address??''} required disabled={edit.used_on_orders}/><CanonicalLocationFields defaultValue={{state:edit.state??'',city:edit.city??''}} disabled={edit.used_on_orders} allowLegacy={!!edit.id}/><Field label="Postal code" name="zip_code" defaultValue={edit.zip_code??''} inputMode="numeric" pattern="[0-9]{1,6}" maxLength={6} required disabled={edit.used_on_orders}/><SelectField label="Address type" name="primary" defaultValue={String(edit.is_primary??(person.addresses.length===0))}><option value="false">Additional address</option><option value="true">Primary address</option></SelectField>
  </CommandDialog>}
  {remove&&<CommandDialog title="Remove address" description="This address will no longer be available for new orders." open onClose={()=>setRemove(null)} disabled={!canWrite||remove.used_on_orders} version={remove.version} onSubmit={(_,command)=>sdk.archiveAddress(remove.id,userId,command)} onSuccess={saved} destructive confirm="Remove address"><input type="hidden" name="address_id" value={remove.id}/><input type="hidden" name="owner" value={userId}/><p className="text-sm">{remove.address}, {remove.city}</p></CommandDialog>}
 </Panel>;
}
