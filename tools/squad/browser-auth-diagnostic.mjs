/** Passive test-only Auth/RPC and native Web Lock timings. No headers, bodies,
 * query strings, tokens, storage contents, retries or lock-policy changes. */
import assert from 'node:assert/strict';
import {timingContract} from './browser-contract-timings.mjs';
export const AUTH_ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
export const AUTH_LOCK='lock:sb-scvojtvgnkmbupvyslmb-auth-token';
const AUTH_PATHS=new Set(['/auth/v1/token','/auth/v1/user','/auth/v1/logout']);
export function authDiagnosticContract(url,origin=AUTH_ORIGIN){
 try{const u=new URL(url);return u.origin===origin&&AUTH_PATHS.has(u.pathname)?u.pathname:timingContract(url,origin);}catch{return null;}
}
export function installLockTrace({lockName}){
 const pending=new Set();Object.defineProperty(window,'__squadLockTracePending',{value:pending});
 if(!navigator.locks?.request)return;
 let sequence=0,count=0;const native=navigator.locks.request;
 const emit=(kind,id,options={})=>{
  if(++count>1000)return;
  const delivery=window.__squadLockTrace({kind,id,at:performance.timeOrigin+performance.now(),document:performance.timeOrigin,zero_wait:options.ifAvailable===true,steal:options.steal===true,mode:options.mode==='shared'?'shared':'exclusive'});
  pending.add(delivery);delivery.then(()=>pending.delete(delivery),()=>pending.delete(delivery));
 };
 navigator.locks.request=function(...args){
  if(args[0]!==lockName)return Reflect.apply(native,this,args);
  const callback=args.at(-1);if(typeof callback!=='function')return Reflect.apply(native,this,args);
  const options=args.length===3&&args[1]&&typeof args[1]==='object'?args[1]:{},id=++sequence;
  emit('requested',id,options);
  const aborted=()=>emit('aborted',id,options);
  options.signal?.addEventListener('abort',aborted,{once:true});
  args[args.length-1]=async function(...values){
   options.signal?.removeEventListener('abort',aborted);
   emit(values[0]?'acquired':'unavailable',id,options);
   try{return await Reflect.apply(callback,this,values);}
   finally{emit('callback_finished',id,options);}
  };
  // Return the original native request promise. In particular, do not attach a
  // rejection handler that could hide a real native unhandled rejection.
  try{return Reflect.apply(native,this,args);}
  catch(error){options.signal?.removeEventListener('abort',aborted);emit('synchronous_error',id,options);throw error;}
 };
}
export async function observeAuthDiagnostic(page,{role,origin=AUTH_ORIGIN,lockName=AUTH_LOCK,maxEvents=2000}={}){
 assert.ok(Number.isInteger(role)&&[10,11,12].includes(role));assert.ok(maxEvents>=1&&maxEvents<=2000);
 const start=Date.now(),requests=[],locks=[],pending=new Map(),statuses=new WeakMap();let sequence=0,droppedRequests=0,droppedLocks=0,stopped=false;
 const now=()=>Math.round((Date.now()-start)*100)/100;
 const begin=request=>{const contract=authDiagnosticContract(request.url(),origin);if(!contract||!['GET','POST'].includes(request.method()))return;
  if(requests.length+pending.size>=maxEvents){droppedRequests++;return;}
  pending.set(request,{sequence:++sequence,contract,method:request.method(),start_ms:now()});};
 const response=r=>statuses.set(r.request(),{status:r.status(),response_ms:now()});
 const end=(request,failed)=>{const row=pending.get(request);if(!row)return;pending.delete(request);requests.push({...row,end_ms:now(),status:statuses.get(request)?.status??null,response_ms:statuses.get(request)?.response_ms??null,outcome:failed?'request_failed':'body_finished'});};
 const success=r=>end(r,false),failure=r=>end(r,true);
 page.on('request',begin);page.on('response',response);page.on('requestfinished',success);page.on('requestfailed',failure);
 await page.exposeBinding('__squadLockTrace',(_source,event)=>{
  if(stopped)return;if(locks.length>=maxEvents){droppedLocks++;return;}
  if(!['requested','acquired','unavailable','callback_finished','aborted','synchronous_error'].includes(event?.kind)||!Number.isSafeInteger(event.id)||event.id<1||!Number.isFinite(event.at)||!Number.isFinite(event.document))return;
  locks.push({kind:event.kind,id:event.id,document_ms:Math.round(event.document-start),at_ms:Math.round((event.at-start)*100)/100,zero_wait:event.zero_wait===true,steal:event.steal===true,mode:event.mode==='shared'?'shared':'exclusive'});
 });
 await page.addInitScript(installLockTrace,{lockName});
 return {async finish(){
  let drain='completed';
  try{await Promise.race([page.evaluate(()=>Promise.all([...window.__squadLockTracePending??[]])),new Promise((_,reject)=>setTimeout(()=>reject(new Error('drain timeout')),1000))]);}catch{drain='unavailable_or_timeout';}
  stopped=true;page.off('request',begin);page.off('response',response);page.off('requestfinished',success);page.off('requestfailed',failure);
  const until=now();for(const [request,row] of pending)requests.push({...row,end_ms:null,status:statuses.get(request)?.status??null,response_ms:statuses.get(request)?.response_ms??null,outcome:'unfinished',observed_until_ms:until});pending.clear();
  return {format:'squad-auth-lock-diagnostic/v1',role,requests:requests.sort((a,b)=>a.sequence-b.sequence),locks,dropped_requests:droppedRequests,dropped_locks:droppedLocks,lock_delivery_drain:drain,measurement:'Relative browser request/body-finish timings and observed native lock callback lifetime. Callback_finished does not imply the browser has released the lock at that exact instant. Interrupted documents may lose last binding deliveries; no active database concurrency is inferred.'};
 }};
}
