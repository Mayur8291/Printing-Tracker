/** Local SQL-only proof of the composed command sequence; no HTTP or browser.
 * Stage observations assert actual identities but do not claim rendered UI. */
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {createSquadClient} from '../../packages/shared/squad.js';
import {runWithObserver} from './web-capabilities-hosted-journey.mjs';
import {validateStage} from './web-conditional-content-hosted-journey.mjs';
const lines=readline.createInterface({input:process.stdin})[Symbol.asyncIterator]();
const next=async()=>{const row=await lines.next();if(row.done)throw Error('Local bridge input ended');return JSON.parse(row.value);};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const init=await next(),journal=[],clients=new Map();
const ctx={fixture:init.fixture,runId:init.run_id,clients,commandKey:label=>{
 const bytes=createHash('sha1').update(Buffer.from(init.run_id.replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const h=bytes.toString('hex'),key=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;journal.push({kind:'command',value:{label,key}});return key;
},record:(kind,id)=>journal.push({kind:'entity',value:{kind,id:String(id)}})};
try{
 for(const role of [0,11,12]){
  const sdk=createSquadClient({schema:name=>{if(name!=='canto_api')throw Error('Unexpected schema');return {rpc:async(name,args)=>{emit({kind:'rpc',role,name,args});return next();}};}});
  clients.set(role,{sdk,me:await sdk.me()});
 }
 const report=await runWithObserver(ctx,async(ctx,{role,stage})=>{
  validateStage(stage,await clients.get(role).sdk.me(),role,ctx.fixture);
  if(init.fail_stage===`${role}:${stage}`)throw Error('Injected UI observer failure');
  return {role,stage,scope:'Local SQL identity proof only; browser not executed'};
 });
 emit({kind:'result',report,journal});
}catch(error){emit({kind:'result',failed:{name:error.name,message:error.message},journal});}
