/** Exact-owned staging rehearsal. Secrets arrive through stdin, never journaled. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
import {runJourney as commercial,finishJourney} from './business_journey_commercial.mjs';
import {runJourney as factory} from './business_journey_factory.mjs';
import {runJourney as collaboration} from './business_journey_collaboration.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;const config=JSON.parse(input);input='';
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
assert.match(config.run_id,/^[0-9a-f-]{36}$/);
const journal=path.resolve(`tools/squad/private/business-${config.run_id}.jsonl`);
assert.equal(journal,path.resolve(config.journal));
const fd=fs.openSync(journal,'a',0o600);
function record(kind,value){fs.writeSync(fd,JSON.stringify({kind,value})+'\n');fs.fsyncSync(fd);}
function commandKey(label){
 assert.match(label,/^[a-zA-Z0-9_.:-]{1,160}$/);
 const bytes=createHash('sha1').update(Buffer.from(config.run_id.replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');
 const key=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 record('command',{label,key});return key;
}
const clients=new Map(),journeys={},httpConflicts=[];
let rpcRequests=0;
async function measuredFetch(input,options){
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 const start=performance.now(),response=await fetch(input,options);
 if(url.pathname.startsWith('/rest/v1/rpc/')){
  rpcRequests++;
  if(response.status===409){
   const error=await response.clone().json();
   httpConflicts.push({rpc:url.pathname.split('/').at(-1),status:response.status,code:error.code==='PT409'?'PT409':'other',elapsed_ms:Math.round((performance.now()-start)*100)/100});
  }
 }
 return response;
}
try{
 for(const actor of config.actors){
  const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:measuredFetch}});
  const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});actor.password='';
  if(login.error)throw new Error(`Role ${actor.role}: Auth login failed (${login.error.code||login.error.status})`);
  assert.equal(login.data.user.id,actor.auth_id);assert.equal(login.data.user.role,'sa_app');
  const sdk=createSquadClient(client),me=await sdk.me();assert.equal(me.role,actor.role);assert.equal(me.id,actor.id);
  clients.set(actor.role,{client,sdk,me});
 }
 const ctx={clients,client:role=>clients.get(role),fixture:config.fixture,commandKey,record:(kind,id)=>record('entity',{kind,id:String(id)}),journeys};
 journeys.commercial=ctx.commercial=await commercial(ctx);record('phase','commercial');
 journeys.factory=await factory(ctx);record('phase','factory');
 journeys.commercialFinish=await finishJourney(ctx,journeys.commercial);record('phase','commercial-finish');
 journeys.collaboration=await collaboration(ctx);record('phase','collaboration');
 const applicationConflicts=httpConflicts.filter(x=>x.code==='PT409');
 assert.ok(applicationConflicts.some(x=>x.rpc==='v1_order_due_save'),'Stale order version must return HTTP409/PT409');
 assert.ok(applicationConflicts.every(x=>x.elapsed_ms<5000),'Application conflicts must return within the 5-second hosted test bound');
 const report={environment:'staging',run_id:config.run_id,auth_personas:[...clients.keys()],journeys,transport:{rpc_requests:rpcRequests,application_conflicts:applicationConflicts,conflict_response_bound_ms:5000},scope:'Actual staged Auth/shared-SDK business commands with workers paused; no provider, email, document rendering or cutover acceptance'};
 record('complete',{phases:4});console.log(JSON.stringify(report));
}finally{
 for(const {client} of clients.values())await client.auth.signOut({scope:'local'}).catch(()=>{});
 for(const actor of config.actors)actor.password='';fs.closeSync(fd);
}
