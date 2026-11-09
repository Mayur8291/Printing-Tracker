import {useEffect,useId,useRef,useState} from 'react';
import {Input} from '@/components/ui/input';
import {Field} from '../../components/index.js';
import {states,canonicalState,canonicalLocation,locationError} from './addressModel';

/** Shared registration/address inputs preserve provider-approved spelling. */
export default function CanonicalLocationFields({value,onChange,defaultValue={state:'',city:''},disabled=false,allowLegacy=false,idPrefix}){
 const [local,setLocal]=useState(defaultValue),initial=useRef(defaultValue),stateInput=useRef(null),cityInput=useRef(null),id=useId();
 const current=value??local,state=canonicalState(current.state),legacy=allowLegacy&&!canonicalLocation(initial.current.state,initial.current.city);
 const unchanged=legacy&&current.state===initial.current.state&&current.city===initial.current.city;
 function change(next){setLocal(next);onChange?.(next);}
 useEffect(()=>{
  stateInput.current?.setCustomValidity(!disabled&&!unchanged&&current.state&&!state?'Choose a state from the list.':'');
  cityInput.current?.setCustomValidity(!disabled&&!unchanged&&current.city?locationError(current.state,current.city)??'':'');
 },[current.state,current.city,disabled,unchanged,state]);
 function stateChanged(next){const found=canonicalState(next),city=found?.cities.find(name=>name.toLowerCase()===current.city.trim().toLowerCase());change({state:next,city:found?(city??''):current.city});}
 return <><div className="grid gap-4 sm:grid-cols-2"><Field label="State" required><Input id={idPrefix?`${idPrefix}-state`:undefined} ref={stateInput} name="state" required disabled={disabled} value={current.state} list={`${id}-states`} autoComplete="address-level1" onChange={event=>stateChanged(event.target.value)} onBlur={()=>{if(state)change({...current,state:state.state});}}/></Field><datalist id={`${id}-states`}>{states.map(row=><option key={row.state} value={row.state}/>)}</datalist><Field label="City" required><Input id={idPrefix?`${idPrefix}-city`:undefined} ref={cityInput} name="city" required disabled={disabled} value={current.city} list={`${id}-cities`} autoComplete="address-level2" onChange={event=>change({...current,city:event.target.value})} onBlur={()=>{const found=canonicalLocation(current.state,current.city);if(found)change(found);}}/></Field><datalist id={`${id}-cities`}>{state?.cities.map(city=><option key={city} value={city}/>)}</datalist></div>{legacy&&!disabled&&<p className="text-xs leading-relaxed text-muted-foreground">This saved address uses an older location spelling. You may keep it unchanged; when changing its location, choose a state and city from the list.</p>}</>;
}
