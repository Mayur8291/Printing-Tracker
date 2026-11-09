/** Real UI acceptance. Fixture authorization and exact cleanup belong to Python.
 * Deterministic test-only UUIDs journal every possible browser command before use.
 * No production access, provider execution, or application test hooks.
 */
import assert from 'node:assert/strict';
import {createContractTimings} from './browser-contract-timings.mjs';
import {browserErrorDiagnostic} from './browser-error-diagnostic.mjs';
import {createCompletedCheckRecorder} from './browser-completed-check.mjs';
import {catalogueMediaCapability} from './web-catalogue-media-capability.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
let input='';for await(const part of process.stdin)input+=part;
const config=JSON.parse(input);input='';
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
assert.match(config.run_id,/^[0-9a-f-]{36}$/);
const base=config.web_content_media?(config.base??'http://localhost:5186'):'http://localhost:5183';
if(config.web_content_media)assert.match(base,/^http:\/\/(?:localhost|127\.0\.0\.1):[0-9]{1,5}$/);
const journal=path.resolve(`tools/squad/private/business-${config.run_id}.jsonl`);
assert.equal(journal,path.resolve(config.journal));
const fd=fs.openSync(journal,'a',0o600);
function log(kind,value){fs.writeSync(fd,JSON.stringify({kind,value})+'\n');fs.fsyncSync(fd);}
function commandKey(label){
 assert.match(label,/^[a-zA-Z0-9_.:-]{1,160}$/);
 const bytes=createHash('sha1').update(Buffer.from(config.run_id.replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const h=bytes.toString('hex'),key=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
 log('command',{label,key});return key;
}
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const clients=new Map(),pages=new Map(),errors=[],violations=[],journeys={};
const timings=createContractTimings({origin:config.url});
const modules=(process.env.SQUAD_WEB_JOURNEYS||'navigation,commerce,operations').split(',');
assert.ok(modules.length&&modules.every(m=>['navigation','commerce','operations','operations-read','collaboration','reporting','administration','artwork','amendment','commerce-controls','people','people-status','factory-management','relationships','workflow-extensions','stock-reconciliation','read-performance','capabilities','content-media','feedback','account','media','catalogue-media'].includes(m)));
assert.ok(!modules.includes('account')||modules.at(-1)==='account','Account closure must be last');
async function pageFor(role){
 if(pages.has(role))return pages.get(role);
 const actor=config.actors.find(a=>a.role===role);assert.ok(actor);
 const context=await browser.createBrowserContext(),page=await context.newPage();
 timings.attach(page,role);
 await page.setViewport({width:1440,height:1000});
 const keys=Array.from({length:256},(_,index)=>commandKey(`web.role${role}.${index}`));
 await page.evaluateOnNewDocument((keys,run)=>{
  // sessionStorage survives navigations within this isolated persona context.
  Object.defineProperty(crypto,'randomUUID',{value:()=>{
   const storageKey=`web-test-uuid:${run}`;
   const index=Number(sessionStorage.getItem(storageKey)||0);
   if(index>=keys.length)throw new Error('Test command journal exhausted');
   sessionStorage.setItem(storageKey,String(index+1));return keys[index];
  }});
 },keys,config.run_id);
 page.on('pageerror',error=>errors.push({role,message:error.message}));
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const u=new URL(request.url());
  const allowed=['localhost','127.0.0.1','scvojtvgnkmbupvyslmb.supabase.co'].includes(u.hostname)||['data:','blob:','about:'].includes(u.protocol);
  if(!allowed){violations.push({role,host:u.hostname});void request.abort();return;}
  if(u.pathname.startsWith('/rest/v1/')&&!u.pathname.startsWith('/rest/v1/rpc/'))violations.push({role,rawTable:u.pathname});
  void request.continue();
 });
 await page.goto(base+'/squad/home',{waitUntil:'networkidle0'});
 await page.waitForSelector('#login-email');
 await page.type('#login-email',actor.email);await page.type('#login-password',actor.password);
 await page.click('button[type=submit]');await page.waitForSelector('.squad-app',{timeout:40000});
 pages.set(role,page);return page;
}
try{
 for(const actor of config.actors){
  const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});
  if(login.error)throw new Error(`Role ${actor.role}: Auth login failed (${login.error.code||login.error.status})`);
  assert.equal(login.data.user.id,actor.auth_id);assert.equal(login.data.user.role,'sa_app');
  const sdk=createSquadClient(client),me=await sdk.me();assert.equal(me.role,actor.role);
  clients.set(actor.role,{client,sdk,me});
 }
 const ctx={base,runId:config.run_id,fixture:config.fixture,clients,clientsMap:clients,pageFor,commandKey,record:(kind,id)=>log('entity',{kind,id:String(id)}),journeys,
  recordCompletedCheck:createCompletedCheckRecorder({log,errors,violations,modules}),
  customerCredentials:()=>{const actor=config.actors.find(a=>a.role===3);return {email:actor.email,password:actor.password};}};
 if(config.web_content_media){
  assert.deepEqual(modules,['content-media'],'Owned content requires its dedicated cleanup harness');
  ctx.ownedContent=config.web_content_media;
 }
 if(modules.includes('catalogue-media')){
  assert.deepEqual(modules,['catalogue-media'],'Catalogue media requires its dedicated reviewed recovery harness');
  ctx.catalogueMediaAcceptance=catalogueMediaCapability(config,clients,log);
 }
 if(modules.includes('media')){
  assert.deepEqual(modules,['media'],'Media has an isolated ownership/Storage cleanup harness');
  const proof=config.web_media,actor=config.actors.find(a=>a.role===3),reserved=[];
  assert.ok(proof);assert.equal(proof.actor_id,actor.auth_id);
  assert.deepEqual(proof.target,{resource:'users',record_id:String(config.fixture.actors['3']),field:'profile_image'});
  ctx.mediaAcceptance={role:3,target:proof.target,route:'/squad/profile',label:'Profile photo',files:proof.files,
   assertOwnedTarget:async()=>{assert.equal(clients.get(3).me.id,proof.target.record_id);},
   recordReservation:async(id,target)=>{assert.match(id,/^[0-9a-f-]{36}$/);assert.deepEqual(target,proof.target);assert.ok(!reserved.includes(id));reserved.push(id);log('entity',{kind:'media_upload',id,target});},
   verifyCleanupReady:async({target,uploadIds})=>{assert.deepEqual(target,proof.target);assert.deepEqual(uploadIds,reserved);assert.equal(reserved.length,2);return {passed:true,scope:'Browser uploads settled and field empty; parent must independently prove Storage and database cleanup'};}};
 }
 for(const name of modules){
  console.error(`Starting real UI journey: ${name}`);
  const module=await import(['amendment','commerce-controls'].includes(name)?'./web-commerce-hosted-journey.mjs':name==='people-status'?'./web-people-hosted-journey.mjs':name==='factory-management'?'./web-factory-people-hosted-journey.mjs':`./web-${name}-hosted-journey.mjs`);
  journeys[name]=await (name==='amendment'?module.runAmendmentJourney:name==='commerce-controls'?module.runCommerceControlsJourney:name==='people-status'?module.runStatusJourney:module.runJourney)(ctx);
  if(name==='commerce')ctx.commercial=journeys[name];
  assert.deepEqual(errors,[],'Unexpected browser exceptions');
  assert.deepEqual(violations,[],'Unexpected raw-table or external request');
  // Preserve a completed module's assertions if a later independent module
  // fails. The parent cleanup receipt remains mandatory for acceptance.
  log('journey_result',{name,result:journeys[name],browser_errors:0,network_violations:0});
  log('api_timings',{after_journey:name,...timings.summary()});
  log('phase',name);console.error(`Passed real UI journey: ${name}`);
 }
 assert.deepEqual(errors,[],'Unexpected browser exceptions');
 assert.deepEqual(violations,[],'Unexpected raw-table or external request');
 timings.stop();
 console.log(JSON.stringify({api_timings:timings.summary(),environment:'staging',run_id:config.run_id,journeys,auth_personas:[...clients.keys()],browser_personas:[...pages.keys()],browser_errors:0,network_violations:0,scope:'Real browser commands on disposable staged personas; workers paused; no provider, email, cutover or document rendering acceptance'}));
}catch(error){
 const folder=`tools/squad/private/web-ui-failure-${config.run_id}`;fs.mkdirSync(folder,{recursive:true,mode:0o700});
 fs.writeFileSync(`${folder}/original-error.json`,JSON.stringify(browserErrorDiagnostic(error,[config.anon,...config.actors.flatMap(actor=>[actor.email,actor.auth_id,actor.password])])),{mode:0o600});
 timings.stop();log('api_timings',{after_failure:true,...timings.summary()});
 if(error.navigationTrace){
  // The navigation helper records paths/status only, never query strings,
  // headers or browser storage. Keep this evidence before screenshots can
  // activate a background tab and change the state being investigated.
  const trace=error.navigationTrace;
  const route=value=>typeof value==='string'&&/^\/squad\/[a-z0-9/-]{1,160}$/.test(value)?value:null;
  const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
  const elapsed=value=>Number.isFinite(value)&&value>=0?Math.round(value):null;
  const bounded={requested_path:route(trace.requested_path),actual_path:route(trace.actual_path),response_path:route(trace.response_path),response_status:status(trace.response_status),app_present:typeof trace.app_present==='boolean'?trace.app_present:null,document_ready:['loading','interactive','complete'].includes(trace.document_ready)?trace.document_ready:null,elapsed_ms:elapsed(trace.elapsed_ms),events:(Array.isArray(trace.events)?trace.events:[]).slice(0,8).map(event=>({kind:['frame','request_failed'].includes(event.kind)?event.kind:null,path:route(event.path),status:status(event.status),elapsed_ms:elapsed(event.elapsed_ms)}))};
  fs.writeFileSync(`${folder}/navigation.json`,JSON.stringify(bounded),{mode:0o600});
 }
 for(const [role,page]of pages){
  const filename=`${folder}/role-${role}.png`;
  await page.screenshot({path:filename,fullPage:true}).then(()=>fs.chmodSync(filename,0o600)).catch(()=>{});
  const summary=await page.evaluate(()=>({url:location.pathname,text:document.body.innerText.slice(-12000)})).catch(()=>({}));
  fs.writeFileSync(`${folder}/role-${role}.json`,JSON.stringify(summary),{mode:0o600});
 }
 // The full route report is already stored privately; keep terminal diagnostics bounded.
 if(error.report)delete error.report;
 throw error;
}finally{
 timings.stop();
 await browser.close();
 for(const {client}of clients.values())await client.auth.signOut({scope:'local'}).catch(()=>{});
 for(const actor of config.actors)actor.password='';fs.closeSync(fd);
}
