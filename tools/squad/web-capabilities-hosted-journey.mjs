/** Compose the existing exact-owned capability rehearsal with UI observations.
 * Does not alter the business dispatcher, application or cleanup authority.
 * Parent must provide the same command journal/fences as the original journey.
 */
import assert from 'node:assert/strict';
import {runJourney as existingCapabilities} from './business_journey_capabilities.mjs';
import {observeStage,CAPABILITY_STAGES,validateStage} from './web-conditional-content-hosted-journey.mjs';

export async function runWithObserver(ctx,observe) {
 assert.equal(typeof observe,'function');assert.equal(typeof ctx.commandKey,'function');assert.equal(typeof ctx.record,'function');
 const clients=ctx.clients??ctx.clientsMap,admin=clients.get(0)?.sdk;assert.ok(admin);
 const subjects=new Map([11,12].map(role=>{const id=String(ctx.fixture.actors[role]);assert.match(id,/^[1-9]\d*$/);assert.equal(String(clients.get(role).me.id),id);return [id,role];}));
 const stages=[],seen=new Set();
 const check=async(role,stage)=>{
  const me=await clients.get(role).sdk.me();validateStage(stage,me,role,ctx.fixture);
  const result=await observe(ctx,{role,stage});assert.ok(result&&result.role===role&&result.stage===stage,'Observer must return exact stage proof');stages.push(result);
 };
 const intercept=async(subject,features,reason,command)=>{
  const role=subjects.get(String(subject));assert.ok(role,'Only exact owned conditional subjects');
  const result=await admin.saveCapabilities(subject,features,reason,command);
  const current=await clients.get(role).sdk.me();
  let stage=Object.keys(CAPABILITY_STAGES).find(name=>['catalogue','configure','documents','promotions'].every(key=>current.capabilities[key]===CAPABILITY_STAGES[name][key]));
  assert.ok(stage,'Unexpected capability result');
  if(stage==='off'&&seen.has(role))stage='revoked';seen.add(role);await check(role,stage);
  if(stage==='combined-products'){
   // Preserve notes/goals from the original validated feature tree. The added
   // transitions use exactly the existing command type, owned subject and journal.
   const roots=features.filter(item=>item.key!=='3');
   for(const [next,children]of [['promotions',['3.4']],['combined',['3.2','3.3','3.4']]]){
    const version=(await admin.person(subject)).version;
    await admin.saveCapabilities(subject,[...roots,{key:'3',checked:true,children:children.map(key=>({key,checked:true}))}],`${ctx.fixture.label} web ${next}`,{expectedVersion:version,idempotencyKey:ctx.commandKey(`capabilities.web-role-${role}-${next}`)});
    await check(role,next);
   }
  }
  return result;
 };
 // SDK instances are frozen. Clone their closure-bound methods rather than
 // violating Proxy invariants or mutating the original command client.
 const scoped=new Map(clients);scoped.set(0,{...clients.get(0),sdk:Object.freeze({...admin,saveCapabilities:intercept})});
 const backend=await existingCapabilities({...ctx,clients:scoped,clientsMap:scoped});
 for(const role of [11,12])assert.deepEqual(stages.filter(row=>row.role===role).map(row=>row.stage),['off','browse','configure','pdf','combined-products','promotions','combined','revoked']);
 return {backend,stages,checks:[...backend.checks,...stages.map(row=>`role_${row.role}_capability_${row.stage.replaceAll('-','_')}_ui`)],entities:backend.entities,completeTransitionMatrix:true,scope:'Existing owned capability command rehearsal plus16 real UI stage observations; two independent PDF/configuration ownership proofs retained; no worker/provider execution'};
}
export const runJourney=ctx=>runWithObserver(ctx,observeStage);
