/** Passive harness-only timings. Never reads headers, bodies, query values or
 * signed URLs; only fixed SDK contract paths on the configured API origin. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
const SDK_SOURCE=readFileSync(new URL('../../packages/shared/squad.js',import.meta.url),'utf8');
const RPC_PATHS=new Set([...SDK_SOURCE.matchAll(/call\("(v1_[a-z_]+)"/g)].map(match=>'/rest/v1/rpc/'+match[1]));
const EDGE_PATHS=new Set(['register','confirm','recovery','users/invite','users/status','documents/attachments','documents/attachments/finalize','documents/download','transfers/download','transfers/uploads','transfers/verify','media/finalize','media/grants','media/uploads','media/verify'].map(p=>'/functions/v1/squad-account/'+p));
export function timingContract(rawUrl,origin){
 try{const url=new URL(rawUrl);if(url.origin!==origin)return null;
  if(RPC_PATHS.has(url.pathname)||EDGE_PATHS.has(url.pathname))return url.pathname;
 }catch{/* Ignore non-HTTP/invalid navigation requests. */}
 return null;
}
const rounded=value=>Math.round(value*100)/100;
function percentile(values,p){return values.length?rounded(values[Math.max(0,Math.ceil(values.length*p)-1)]):null;}
export function createContractTimings({origin,maxSamples=5000,maxInFlight=128,now=()=>performance.now()}={}){
 assert.equal(new URL(origin).origin,origin);assert.ok(Number.isInteger(maxSamples)&&maxSamples>=1&&maxSamples<=10000);assert.ok(Number.isInteger(maxInFlight)&&maxInFlight>=1&&maxInFlight<=256);
 const samples=[],inFlight=new Map(),detach=[],startedAt=now();let observed=0,droppedSamples=0,droppedInFlight=0,unfinished=0,finished=false,peakInFlight=0;
 function store(sample){if(samples.length<maxSamples)samples.push(sample);else droppedSamples++;}
 function attach(page,role){
  assert.ok(Number.isInteger(role)&&role>=0&&role<=13);assert.ok(!finished);
  const start=request=>{
   const contract=timingContract(request.url(),origin);if(!contract||!['GET','POST'].includes(request.method()))return;
   observed++;if(inFlight.size>=maxInFlight){droppedInFlight++;return;}
   inFlight.set(request,{role,contract,start:now(),sequence:observed,trackedAtStart:inFlight.size+1});
   peakInFlight=Math.max(peakInFlight,inFlight.size);
  };
  const end=(request,failed)=>{
   const entry=inFlight.get(request);if(!entry)return;inFlight.delete(request);
   const status=request.response()?.status()??null;
   // Classify a browser-provided error locally, never retain its text.
   const cancelled=failed&&/ERR_ABORTED|ERR_CANCELED|ERR_CANCELLED/.test(request.failure()?.errorText??'');
   const outcome=failed?(cancelled?'cancelled':'failed'):status>=200&&status<300?'completed_success':status>=400?'completed_http_error':status>=300?'completed_redirect':'failed';
   const complete=outcome.startsWith('completed_');
   const endedAt=now();
   store({role:entry.role,contract:entry.contract,status,outcome,duration_ms:complete?rounded(Math.max(0,endedAt-entry.start)):null,
    sequence:entry.sequence,start_ms:rounded(Math.max(0,entry.start-startedAt)),end_ms:rounded(Math.max(0,endedAt-startedAt)),tracked_in_flight_at_start:entry.trackedAtStart,tracked_in_flight_after_end:inFlight.size});
  };
  const success=request=>end(request,false),failure=request=>end(request,true);
  page.on('request',start);page.on('requestfinished',success);page.on('requestfailed',failure);
  detach.push(()=>{page.off('request',start);page.off('requestfinished',success);page.off('requestfailed',failure);});
 }
 function summary(){
  const groups=new Map();
  for(const sample of samples){const key=JSON.stringify([sample.role,sample.contract,sample.status,sample.outcome]);if(!groups.has(key))groups.set(key,{role:sample.role,contract:sample.contract,status:sample.status,outcome:sample.outcome,count:0,values:[]});const row=groups.get(key);row.count++;if(sample.duration_ms!==null)row.values.push(sample.duration_ms);}
  const contracts=[...groups.values()].map(({values,...row})=>{values.sort((a,b)=>a-b);return {...row,latency_samples:values.length,p50_ms:percentile(values,.5),p95_ms:percentile(values,.95),max_ms:values.length?values.at(-1):null};}).sort((a,b)=>a.role-b.role||a.contract.localeCompare(b.contract)||a.outcome.localeCompare(b.outcome)||(a.status??0)-(b.status??0));
  return {measurement:'Browser request event through complete response-body receipt; network, gateway, server and harness interception included. Not render time or isolated SQL time.',cache_state:'mixed cold/warm; cache, connection and function warmth were not controlled',percentile_method:'nearest rank within each role/contract/status/outcome group',sample_policy:`First ${maxSamples} eligible settled requests; at most ${maxInFlight} tracked concurrently`,observed_requests:observed,captured_samples:samples.length,dropped_samples:droppedSamples,dropped_in_flight:droppedInFlight,in_flight:inFlight.size,unfinished_requests:unfinished,partial:unfinished>0||droppedSamples>0||droppedInFlight>0||inFlight.size>0,contracts,
   peak_tracked_in_flight:peakInFlight,timeline:[...samples].sort((a,b)=>a.sequence-b.sequence).map(sample=>({...sample})),timeline_measurement:'Offsets are relative to this browser observer, not wall-clock time. In-flight counts cover only tracked allowlisted browser requests, not active SQL connections or concurrent database queries. Cancelled/failed end offsets record browser termination; unfinished requests have no observed end. Timeline uses the existing sample cap.'};
 }
 function stop(){if(finished)return;finished=true;for(const remove of detach)remove();detach.length=0;unfinished+=inFlight.size;const stoppedAt=rounded(Math.max(0,now()-startedAt));for(const entry of inFlight.values())store({role:entry.role,contract:entry.contract,status:null,outcome:'unfinished',duration_ms:null,sequence:entry.sequence,start_ms:rounded(Math.max(0,entry.start-startedAt)),end_ms:null,observed_until_ms:stoppedAt,tracked_in_flight_at_start:entry.trackedAtStart,tracked_in_flight_after_end:null});inFlight.clear();}
 return {attach,summary,stop};
}
