/** Test-only transport: shared SDK RPC envelopes go to a rollback SQL fixture.
 * No Supabase URL, credentials, HTTP or provider transport exists in this runner.
 */
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {createSquadClient} from '../../packages/shared/squad.js';
import {runJourney as commercial,finishJourney} from './business_journey_commercial.mjs';
import {runJourney as factory} from './business_journey_factory.mjs';
import {runJourney as collaboration} from './business_journey_collaboration.mjs';

const lines=readline.createInterface({input:process.stdin})[Symbol.asyncIterator]();
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const next=async()=>{const row=await lines.next();if(row.done)throw new Error('Local SQL fixture ended');return JSON.parse(row.value);};
try{
 const init=await next(),keys=new Map(),journal=[],ctx={clients:new Map(),fixture:init.fixture};
 let phase='identity';
 ctx.record=(kind,id)=>journal.push({kind:'entity',value:{kind,id:String(id)}});
 ctx.commandKey=label=>{
  if(!keys.has(label)){
   let key=crypto.randomUUID();
   if(init.run_id){
    const bytes=createHash('sha1').update(Buffer.from(init.run_id.replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);
    bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');
    key=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
   }
   keys.set(label,key);journal.push({kind:'command',value:{label,key}});
  }
  return keys.get(label);
 };
 ctx.client=role=>ctx.clients.get(role);
 for(const role of init.roles){
  const transport={schema:schema=>{
   if(schema!=='canto_api')throw new Error('Only the public business contract is available');
   return {rpc:async(name,args)=>{
    const label=[...keys].find(([,key])=>key===args.p_idempotency_key)?.[0]??null;
    emit({kind:'rpc',role,name,args,...(init.profile?{phase,label}:{})});return await next();
   }};
  }};
  const sdk=createSquadClient(transport);ctx.clients.set(role,{sdk,me:await sdk.me()});
 }
 phase='commercial';ctx.commercial=await commercial(ctx);
 phase='factory';
 const factoryResult=await factory(ctx);
 phase='ratings';
 ctx.commercial=await finishJourney(ctx,ctx.commercial);
 phase='collaboration';
 const collaborationResult=await collaboration(ctx);
 emit({kind:'result',report:{commercial:ctx.commercial,factory:factoryResult,collaboration:collaborationResult},journal});
}catch(error){emit({kind:'failed',error:{name:error.name,message:error.message,code:error.code,stack:error.stack}});process.exitCode=1;}
