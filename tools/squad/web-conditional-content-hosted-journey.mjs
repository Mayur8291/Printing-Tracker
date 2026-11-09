/** Read-only UI observer for parent-owned Team/JobWorker capability transitions.
 * Call observeStage AFTER an existing journalled capability command. This module
 * never creates grants, submits documents, configures products or executes work.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {navigationFor} from '../../apps/admin/src/squad/navigation/registry.js';
import {transportAllowed} from './web-cross-browser-policy.mjs';
import {inspect,violations} from './web-navigation-hosted-journey.mjs';

const KEYS=['catalogue','configure','documents','promotions'];
const DENIED='Your role does not have access to this workspace.';
export const CAPABILITY_STAGES=Object.freeze({
 off:{catalogue:false,configure:false,documents:false,promotions:false},
 browse:{catalogue:true,configure:false,documents:false,promotions:false},
 configure:{catalogue:true,configure:true,documents:false,promotions:false},
 pdf:{catalogue:true,configure:false,documents:true,promotions:false},
 promotions:{catalogue:true,configure:false,documents:false,promotions:true},
 'combined-products':{catalogue:true,configure:true,documents:true,promotions:false},
 combined:{catalogue:true,configure:true,documents:true,promotions:true},
 revoked:{catalogue:false,configure:false,documents:false,promotions:false},
});
export function validateStage(stage,identity,role,fixture) {
 assert.ok([11,12].includes(role),'Only the owned Team/JobWorker subjects');
 assert.ok(Object.hasOwn(CAPABILITY_STAGES,stage),'Use an explicit finite capability stage');
 assert.match(String(fixture.actors[String(role)]),/^[1-9]\d*$/,'Exact fixture subject required');
 assert.equal(identity.role,role);assert.equal(String(identity.id),String(fixture.actors[String(role)]));
 for(const key of KEYS)assert.equal(identity.capabilities[key],CAPABILITY_STAGES[stage][key],`${stage}: actual ${key}`);
 assert.equal(identity.capabilities.place_orders,false,'Product access does not grant order placement');
 return CAPABILITY_STAGES[stage];
}
export function privateDirectory(ctx,prefix) {
 assert.match(prefix,/^web-[a-z-]+$/);
 assert.match(ctx.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 assert.match(ctx.base,/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
 const directory=path.resolve('tools/squad/private',`${prefix}-${ctx.runId}`);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);return directory;
}
export function observeReadRequests(page,base) {
 const denied=[];
 // The parent already owns request interception. Do not replace its handlers.
 const listener=request=>{if(!transportAllowed({url:request.url(),method:request.method(),body:request.postData()},base)){const url=new URL(request.url());denied.push({origin:url.origin,path:url.pathname,method:request.method()});}};
 page.on('request',listener);return {denied,close:()=>page.off('request',listener)};
}
export async function clickText(page,text,scope='main') {
 await page.waitForFunction((text,scope)=>[...document.querySelectorAll(`${scope} button,${scope} a`)].some(n=>n.textContent.trim()===text&&!n.disabled),{timeout:25000},text,scope);
 const button=await page.evaluateHandle((text,scope)=>[...document.querySelectorAll(`${scope} button,${scope} a`)].find(n=>n.textContent.trim()===text&&!n.disabled),text,scope);
 try{await button.asElement().click();}finally{await button.dispose();}
}
export async function ready(page) {
 await page.waitForFunction(()=>{const main=document.getElementById('squad-main');return main&&!main.innerText.includes('Loading workspace…')&&!main.querySelector('[aria-busy=true]');},{timeout:30000});
 await page.waitForNetworkIdle({idleTime:150,timeout:5000}).catch(()=>{});
}
export async function capture(page,directory,name) {
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished));});
 const filename=path.join(directory,`${name}.png`);await page.screenshot({path:filename});fs.chmodSync(filename,0o600);return filename;
}
export async function observeStage(ctx,{role,stage}) {
 const entry=(ctx.clientsMap??ctx.clients).get(role);assert.ok(entry?.sdk);
 const me=await entry.sdk.me(),expected=validateStage(stage,me,role,ctx.fixture);
 const obtained=await ctx.pageFor(role),page=obtained.page??obtained;
 const directory=privateDirectory(ctx,'web-conditional-content'),guard=observeReadRequests(page,ctx.base);
 const report={role,stage,expected,checks:[],routes:[],screenshotsPrivate:true};
 try{
  await page.setViewport({width:1440,height:1000});
  // A full navigation deliberately refreshes the authenticated bootstrap. It is
  // not claimed to prove an automatic live push or token refresh on grant edits.
  await page.goto(ctx.base+'/squad/home',{waitUntil:'domcontentloaded'});await ready(page);
  const actual=await page.$$eval('[data-sidebar="content"] a[href^="/squad/"]',links=>[...new Set(links.map(n=>n.getAttribute('href')))].sort());
  assert.deepEqual(actual,navigationFor(me).map(n=>n.href).sort());report.checks.push('actual_identity_drives_sidebar_after_reload');
  for(const [key,route] of [['catalogue','catalogue'],['documents','documents'],['promotions','promotions']]){
   await page.goto(`${ctx.base}/squad/${route}`,{waitUntil:'domcontentloaded'});await ready(page);
   if(!expected[key]){
    assert.equal(await page.$eval('main',(n,text)=>n.textContent.includes(text),DENIED),true);
    report.routes.push({key,allowed:false,explicitDenial:true});continue;
   }
   const state=await inspect(page);assert.deepEqual(violations(state),[],`${stage}:${key}`);
   report.routes.push({key,allowed:true});
   if(key==='catalogue'){
    await page.type('input[aria-label="Search products"]',ctx.fixture.label+' base');await page.click('button[aria-label="Search"]');
    await page.waitForFunction(id=>[...document.querySelectorAll('main article')].some(n=>[...n.querySelectorAll('span')].some(s=>s.textContent.trim()===`#${id}`)),{timeout:30000},String(ctx.fixture.ids.baseProductId));
    const card=await page.evaluateHandle(id=>[...document.querySelectorAll('main article')].find(n=>[...n.querySelectorAll('span')].some(s=>s.textContent.trim()===`#${id}`)),String(ctx.fixture.ids.baseProductId));
    try{const button=await card.asElement().$('button');assert.equal(await button.evaluate(n=>n.textContent.trim()),expected.configure?'Configure':'View product');await button.click();await button.dispose();}finally{await card.dispose();}
    await ready(page);
    const labels=await page.$$eval('main label',nodes=>nodes.map(n=>n.textContent.trim()));
    assert.equal(labels.includes('Design name'),expected.configure);
    assert.equal(await page.$eval('main',n=>[...n.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save reusable design')),expected.configure);
    assert.equal(await page.$eval('main',n=>[...n.querySelectorAll('button')].some(b=>b.textContent.trim()==='Review and place order')),false);
    report.checks.push(expected.configure?'configuration_controls_present_without_order_authority':'browse_reference_without_configuration_controls');
   }
   if(key==='documents'){
    await clickText(page,'Create document');await ready(page);
    assert.equal(await page.$eval('main',n=>n.textContent.includes('Catalogue')),true);
    report.checks.push('catalogue_document_form_visible_without_submission');
   }
   if(key==='promotions')report.checks.push('promotion_resources_readable');
   report.routes.at(-1).screenshot=await capture(page,directory,`role-${role}-${stage}-${route}`);
  }
  await page.setViewport({width:360,height:844});
  await page.goto(ctx.base+'/squad/home',{waitUntil:'domcontentloaded'});await ready(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  report.mobileScreenshot=await capture(page,directory,`role-${role}-${stage}-mobile`);
  assert.deepEqual(guard.denied,[],'Conditional observer must remain read-only');
  report.checks.push('conditional_routes_enforced','mobile_no_overflow','no_application_commands');
  return report;
 }finally{guard.close();}
}

/** Baseline only. Full eight-stage acceptance needs observeStage called by the
 * existing parent-owned capability journey after each exact owned grant change. */
export async function runJourney(ctx) {
 const stages=[];
 for(const role of [11,12]){
  const identity=await (ctx.clientsMap??ctx.clients).get(role).sdk.me();
  const stage=Object.keys(CAPABILITY_STAGES).find(name=>KEYS.every(key=>identity.capabilities[key]===CAPABILITY_STAGES[name][key]));
  assert.ok(stage,'Existing capability shape is outside the bounded stage matrix');
  stages.push(await observeStage(ctx,{role,stage}));
 }
 return {stages,scope:'Current conditional identities only; complete grant transitions require parent-owned stage callbacks',completeTransitionMatrix:false};
}
