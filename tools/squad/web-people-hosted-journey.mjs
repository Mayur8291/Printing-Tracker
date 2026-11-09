/** Optional real UI People acceptance. Parent owns identities, paused workers,
 * deterministic command journal and immutable-audit-rooted cleanup. No invites. */
import assert from 'node:assert/strict';
const STAGING='https://scvojtvgnkmbupvyslmb.supabase.co';
export async function field(page,label,value){
 const find=(label)=>{const scope=document.querySelector('[role="dialog"]')??document;return [...scope.querySelectorAll('label')].find(l=>{const copy=l.cloneNode(true);copy.querySelectorAll('[aria-hidden="true"]').forEach(n=>n.remove());return copy.textContent.trim()===label;});};
 await page.waitForFunction((source,label)=>{const l=eval('('+source+')')(label);return l&&document.getElementById(l.htmlFor);},{timeout:25000},find.toString(),label);
 const h=await page.evaluateHandle((source,label)=>{const l=eval('('+source+')')(label);return document.getElementById(l.htmlFor);},find.toString(),label),e=h.asElement();assert.ok(e,`Missing ${label}`);
 if(await e.evaluate(n=>n.tagName==='SELECT')){await page.waitForFunction((source,label,value)=>{const l=eval('('+source+')')(label);return [...document.getElementById(l.htmlFor).options].some(o=>o.value===value);},{timeout:25000},find.toString(),label,String(value));await e.select(String(value));}
 else await e.evaluate((n,v)=>{Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,v);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
 await h.dispose();
}
async function click(page,text){await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===text&&!b.disabled),{timeout:25000},text);await page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);}
async function rpc(page,name,action,onAccepted=()=>{}){const wait=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).origin===STAGING&&new URL(r.url()).pathname===`/rest/v1/rpc/${name}`);await action();const r=await wait,value=await r.json();assert.ok(r.ok(),`${name}: ${value.code??r.status()} ${value.message??''}`);onAccepted(value);await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));return value;}
async function goto(ctx,role,id){const p=await ctx.pageFor(role);await p.goto(ctx.base+'/squad/people'+(id?'/'+id:''),{waitUntil:'domcontentloaded'});await p.waitForSelector('.squad-app');return p;}
async function selectParent(page,label,id,search){const input=`input[aria-label="Search ${label.toLowerCase()}"]`;await page.waitForSelector(input);await page.$eval(input,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));},search);await page.$eval(input,e=>e.parentElement.querySelector('button').click());await field(page,label,id);}
export async function runJourney(ctx){
 assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);assert.match(ctx.runId,/^[0-9a-f-]{36}$/);assert.match(ctx.base,/^http:\/\/localhost:\d+$/);
 const checks=[],entities={personIds:[]},admin=ctx.clients.get(0).sdk,fm=ctx.clients.get(4).sdk,sc=ctx.clients.get(1).sdk;let tailor;
 for(const [actor,role,rpcName] of [[4,5,'v1_tailor_save'],[4,6,'v1_subtailor_save'],[0,12,'v1_person_save'],[0,1,'v1_person_save']]){
  const page=await goto(ctx,actor),sdk=actor===4?fm:admin,name=`${ctx.fixture.label} browser managed role${role}`;
  await click(page,'Add person');await field(page,'Role',role);
  const roles=await page.$$eval('[role="dialog"] select',elements=>[...elements[0].options].map(o=>Number(o.value)));
  if(actor===4)assert.deepEqual(roles,[5,6,7,8,9],'Factory manager must not create commercial/Admin roles');
  await field(page,'Full name',name);await field(page,'Phone','9000000000');
  if(![5,6].includes(role))await field(page,'Login email',`squad-people-${ctx.runId.replaceAll('-','')}-${role}@mailinator.com`);
  if(role===12)await field(page,'Designation','Acceptance test team');
  if(role===6)await selectParent(page,'Parent tailor',tailor.id,ctx.fixture.label+' browser managed role5');
  const created=await rpc(page,rpcName,()=>click(page,'Create person'),v=>{assert.ok(v.id);ctx.record('person',v.id);entities.personIds.push(v.id);if(v.account_request_id)ctx.record('account_request',v.account_request_id);});
  await page.waitForFunction(id=>location.pathname===`/squad/people/${id}`,{},created.id);
  let person=await sdk.person(created.id);assert.equal(person.role,role);assert.equal(person.name,name);
  if([5,6].includes(role)){assert.equal(person.manager_id,ctx.clients.get(4).me.id);if(role===5)tailor=created;else assert.equal(person.parent_tailor_id,tailor.id);}
  await click(page,'Edit profile');await field(page,'Full name',name+' revised');const edited=await rpc(page,rpcName,()=>click(page,'Save person'));
  assert.notEqual(edited.version,created.version);person=await sdk.person(created.id);assert.equal(person.name,name+' revised');
  if(actor===4){await assert.rejects(sc.person(created.id),e=>['forbidden','not_found'].includes(e.kind));assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Send invitation')),false);}
  if(role===12){await click(page,'Manage capabilities');await page.$eval('input[name="notes"]',e=>{if(!e.checked)e.click();});await page.$eval('input[name="goals"]',e=>{if(e.checked)e.click();});await page.$eval('input[name="products"]',e=>{if(e.checked)e.click();});await field(page,'Reason for change',ctx.fixture.label+' limited team access');await rpc(page,'v1_person_capabilities_save',()=>click(page,'Save changes'));const features=(await admin.person(created.id)).features;assert.equal(features.find(f=>f.key==='1').checked,true);assert.equal(features.find(f=>f.key==='2').checked,false);assert.equal(features.find(f=>f.key==='3').checked,false);}
 }
 checks.push('fm_real_browser_tailor_subtailor_create_edit_exact_manager_parent_and_no_login_controls','admin_real_browser_team_sc_business_profile_create_edit_no_invites_or_workers','admin_real_browser_team_notes_only_grant_preserves_parent_child_constraints','sc_cannot_read_foreign_managed_workforce');
 return{checks,entities,scope:'Four separately created business profiles through real forms; Tailor/SubTailor managed by own FM, Team/SC by Admin. Queued account intents remain unexecuted; no Auth provisioning or mail claimed.'};
}

/** Separate optional127 journey; parent registers it only after cleanup proof.
 * Account reconciliation stays paused. The synchronous source/session guard,
 * not an Auth-provider ban, is the acceptance target. */
export async function runStatusJourney(ctx){
 assert.match(ctx.base,/^http:\/\/localhost:\d+$/);assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);
 const sc=ctx.clients.get(1),customer=ctx.clients.get(3),id=customer.me.id;
 assert.equal(id,String(ctx.fixture.actors['3']));assert.equal((await sc.sdk.person(id)).coordinator_id,sc.me.id);
 const customerPage=await ctx.pageFor(3),page=await goto(ctx,1,id);
 await customerPage.goto(ctx.base+'/squad/profile',{waitUntil:'domcontentloaded'});await customerPage.waitForSelector('.squad-app');
 async function action(verb){
  await click(page,verb==='disable'?'Disable sign-in':'Enable sign-in');await field(page,'Reason for change',ctx.fixture.label+' reversible customer access check');
  const wait=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).origin===STAGING&&new URL(r.url()).pathname==='/functions/v1/squad-account/users/status');
  await click(page,'Save changes');const r=await wait,value=await r.json();assert.ok(r.ok(),`Account status returned ${r.status()}`);assert.equal(value.id,id);assert.equal(value.state,verb==='disable'?'disabled':'enabled');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));return value;
 }
 await action('disable');assert.equal((await sc.sdk.person(id)).disabled,true);
 await assert.rejects(customer.sdk.me(),e=>['session','forbidden','not_found'].includes(e.kind));
 await customerPage.reload({waitUntil:'domcontentloaded'});await customerPage.waitForSelector('#login-email',{timeout:30000});assert.equal(await customerPage.$('.squad-app'),null);
 await action('enable');assert.equal((await sc.sdk.person(id)).disabled,false);
 await assert.rejects(customer.sdk.me(),e=>['session','forbidden','not_found'].includes(e.kind));
 const credentials=ctx.customerCredentials();try{
  for(const [selector,value]of [['#login-email',credentials.email],['#login-password',credentials.password]])await customerPage.$eval(selector,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);await customerPage.click('button[type=submit]');await customerPage.waitForSelector('.squad-app',{timeout:40000});
  const signed=await customer.client.auth.signInWithPassword(credentials);assert.equal(signed.error,null);assert.equal(signed.data.user.id,customer.me.auth_id);assert.equal(signed.data.user.role,'sa_app');assert.equal((await customer.sdk.me()).id,id);
 }finally{credentials.password='';}
 return{checks:['sc_real_browser_disables_only_own_customer_through_account_edge','disabled_customer_existing_session_and_deep_link_denied','reenable_keeps_old_session_revoked_and_fresh_real_login_restores_same_identity'],scope:'Exact fixture Customer source status and session revocation only. Account worker/provider ban and invitations are not executed or claimed.'};
}
