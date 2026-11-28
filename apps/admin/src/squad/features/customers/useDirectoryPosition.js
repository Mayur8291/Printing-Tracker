import {useEffect,useRef} from 'react';

// Position only: account records and selection versions stay in the scoped query cache.
const clients=new WeakMap();
export function useDirectoryPosition(client,key,ready){
 const restoring=useRef(false);
 useEffect(()=>{
  const main=document.getElementById('squad-main');
  if(!main)return;
  if(!clients.has(client))clients.set(client,new Map());
  const positions=clients.get(client);
  let frame=0,active=true;
  restoring.current=true;
  const save=()=>{if(!restoring.current){positions.delete(key);positions.set(key,main.scrollTop);while(positions.size>100)positions.delete(positions.keys().next().value)}};
  main.addEventListener('scroll',save,{passive:true});
  if(ready)frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{if(!active)return;main.scrollTo({top:positions.get(key)??0,behavior:'instant'});restoring.current=false})});
  return()=>{active=false;cancelAnimationFrame(frame);main.removeEventListener('scroll',save)};
 },[client,key,ready]);
}
