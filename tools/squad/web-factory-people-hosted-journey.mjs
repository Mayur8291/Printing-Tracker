/** Optional exact-owned PC setup branch. No providers, invitations or workers.
 * Parent owns fixture, UUID journal, browser lifetime and immutable-audit cleanup. */
import assert from 'node:assert/strict';
import {field} from './web-people-hosted-journey.mjs';
const STAGING='https://scvojtvgnkmbupvyslmb.supabase.co';
export async function clickFactoryControl(page,label){
 await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{timeout:25000},label);
 await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);
}
export async function selectFactoryRelationship(page,label,id,search){
 const selector=`input[aria-label="Search ${label.toLowerCase()}"]`;
 await page.waitForSelector(selector);
 await page.$eval(selector,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));},search);
 await page.$eval(selector,e=>e.parentElement.querySelector('button').click());
 // Wait for this exact authorized result, not the retained Selected #id fallback.
 await page.waitForFunction((label,id,search)=>{const l=[...document.querySelectorAll('[role="dialog"] label')].find(n=>n.textContent.replace('*','').trim()===label);return l&&[...document.getElementById(l.htmlFor).options].some(o=>o.value===String(id)&&o.textContent.includes(search));},{timeout:25000},label,id,search);
 await field(page,label,id);
}
export async function fillFactoryPerson(page,{role,name,email,factory,manager}){
 await field(page,'Role',role);await field(page,'Full name',name);await field(page,'Phone','9000000000');await field(page,'Login email',email);
 if(role===4)await selectFactoryRelationship(page,'Factory',factory.id,factory.name);
 else await selectFactoryRelationship(page,'Factory manager',manager.id,manager.name);
}
async function accepted(page,rpc,action,record=()=>{}){
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).origin===STAGING&&new URL(r.url()).pathname===`/rest/v1/rpc/${rpc}`);
 void response.catch(()=>{}); // Observe orphan rejection if the preceding UI action fails.
 await action();const r=await response,v=await r.json();assert.ok(r.ok(),`${rpc} returned ${r.status()} ${v.code??''}`);record(v);
 await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));return v;
}
export async function runJourney(ctx){
 assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);assert.match(ctx.runId,/^[0-9a-f-]{36}$/);assert.match(ctx.base,/^http:\/\/localhost:\d+$/);
 const pc=ctx.clients.get(2),sc=ctx.clients.get(1);assert.equal(pc.me.role,2);
 const page=await ctx.pageFor(2),entities={factoryIds:[],personIds:[]};
 const open=async()=>{await page.goto(ctx.base+'/squad/people',{waitUntil:'domcontentloaded'});await page.waitForSelector('.squad-app');};
 await open();await clickFactoryControl(page,'Factories');await clickFactoryControl(page,'Add factory');
 const factoryName=ctx.fixture.label+' PC factory';await field(page,'Factory name',factoryName);
 const factory=await accepted(page,'v1_factory_save',()=>clickFactoryControl(page,'Save changes'),v=>{assert.ok(v.id);ctx.record('factory',v.id);entities.factoryIds.push(v.id);});
 await page.waitForFunction(name=>[...document.querySelectorAll('tr')].some(r=>r.textContent.includes(name)),{},factoryName);
 await page.evaluate(name=>[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(name)).querySelector('button').click(),factoryName);
 await field(page,'Factory name',factoryName+' revised');const revised=await accepted(page,'v1_factory_save',()=>clickFactoryControl(page,'Save changes'));
 assert.equal(revised.id,factory.id);assert.notEqual(revised.version,factory.version);
 const listed=await pc.sdk.factories(factoryName,{limit:5});assert.equal(listed.data.length,1);assert.equal(listed.data[0].id,factory.id);assert.equal(listed.data[0].name,factoryName+' revised');
 let manager;
 for(const role of [4,8]){
  await open();await clickFactoryControl(page,'Add person');const name=ctx.fixture.label+' PC managed role'+role;
  await fillFactoryPerson(page,{role,name,email:`squad-factory-${ctx.runId.replaceAll('-','')}-${role}@mailinator.com`,factory:listed.data[0],manager});
  const rpc=role===4?'v1_person_save':'v1_factory_team_save';
  const created=await accepted(page,rpc,()=>clickFactoryControl(page,'Create person'),v=>{assert.ok(v.id);ctx.record('person',v.id);entities.personIds.push(v.id);if(v.account_request_id)ctx.record('account_request',v.account_request_id);});
  await page.waitForFunction(id=>location.pathname===`/squad/people/${id}`,{},created.id);
  let person=await pc.sdk.person(created.id);assert.equal(person.role,role);assert.equal(person.name,name);
  if(role===4)assert.equal(person.factory_id,factory.id);else assert.equal(person.manager_id,manager.id);
  await clickFactoryControl(page,'Edit profile');await field(page,'Full name',name+' revised');const edited=await accepted(page,rpc,()=>clickFactoryControl(page,'Save person'));
  assert.equal(edited.id,created.id);assert.notEqual(edited.version,created.version);person=await pc.sdk.person(created.id);assert.equal(person.name,name+' revised');
  if(role===4){assert.equal(person.factory_id,factory.id);manager=person;}else assert.equal(person.manager_id,manager.id);
  await assert.rejects(sc.sdk.person(created.id),e=>['forbidden','not_found'].includes(e.kind));
 }
 return {checks:['pc_real_browser_factory_create_edit_exact_version_and_bounded_directory_read','pc_real_browser_factory_manager_create_edit_preserves_owned_factory','pc_real_browser_inspector_create_edit_preserves_exact_manager_and_sc_denial'],entities,scope:'One new factory, one new Factory Manager and one Inspector represent the shared factory-team save branch. Six browser commands; queued account intents unexecuted. No Auth provisioning, invitation, email, production assignment or all-team-role Cartesian coverage claimed.'};
}
