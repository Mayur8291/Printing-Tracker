/** Standalone real browser catalogue/terms adapter. Python owns registration,
 * manifest preflight, provider pause and exact recovery. No hosted setup here. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
import {validateGrant} from './web-document-outputs-hosted.mjs';
import {clickAndVerifyPdf} from './browser-pdf-click.mjs';

const STAGING='https://scvojtvgnkmbupvyslmb.supabase.co',base='http://localhost:5183';
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);input='';
assert.equal(config.url,STAGING);assert.ok(['request','render'].includes(config.phase));
assert.match(config.run_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
assert.equal(path.resolve(config.output_dir),path.resolve('tools/squad/private/web-catalogue-terms/'+config.run_id));
assert.equal(path.resolve(config.journal),path.resolve('tools/squad/private/business-'+config.run_id+'.jsonl'));
const expectedBytes=Buffer.from(`Synthetic Squad catalogue terms.\nRun ${config.run_id}\nNo real customer conditions.\n`);
const expectedHash=createHash('sha256').update(expectedBytes).digest('hex');
assert.equal(config.file.path,path.resolve('tools/squad/private/catalogue-terms-'+config.run_id+'.txt'));
assert.equal(config.file.sha256,expectedHash);assert.equal(config.file.bytes,expectedBytes.length);
assert.equal(config.file.canonical,`sha256/${expectedHash.slice(0,2)}/${expectedHash}`);
assert.deepEqual(fs.readFileSync(config.file.path),expectedBytes);
fs.mkdirSync(config.output_dir,{recursive:true,mode:0o700});fs.chmodSync(config.output_dir,0o700);
const journal=fs.openSync(config.journal,'a',0o600),clients=new Map(),pages=new Map(),errors=[],violations=[];
const log=(kind,value)=>{fs.writeSync(journal,JSON.stringify({kind,value})+'\n');fs.fsyncSync(journal);};
function key(index){
 const label=`web.role3.${index}`,b=createHash('sha1').update(Buffer.from(config.run_id.replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);
 b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex'),key=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
 log('command',{label,key});return key;
}
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
async function pageFor(role){
 if(pages.has(role))return pages.get(role);
 const actor=config.actors.find(a=>a.role===role),context=await browser.createBrowserContext(),page=await context.newPage();
 await page.setViewport({width:1440,height:1000});pages.set(role,page);
 if(config.phase==='request'){
  assert.equal(role,3);const keys=Array.from({length:256},(_,i)=>key(i));
  await page.evaluateOnNewDocument((keys,run)=>{Object.defineProperty(crypto,'randomUUID',{value:()=>{const k='catalogue-acceptance:'+run,i=Number(sessionStorage.getItem(k)||0);if(i>=keys.length)throw Error('Command journal exhausted');sessionStorage.setItem(k,String(i+1));return keys[i];}});},keys,config.run_id);
 }
 page.on('pageerror',e=>errors.push(e.name));await page.setRequestInterception(true);
 page.on('request',r=>{const u=new URL(r.url());if(!['localhost','127.0.0.1','scvojtvgnkmbupvyslmb.supabase.co'].includes(u.hostname)&&!['about:','data:','blob:'].includes(u.protocol)){violations.push('unexpected_external_request');void r.abort();return;}if(u.pathname.startsWith('/rest/v1/')&&!u.pathname.startsWith('/rest/v1/rpc/'))violations.push('raw_table_request');void r.continue();});
 await page.goto(base+'/squad/home',{waitUntil:'domcontentloaded'});await page.waitForSelector('#login-email');await page.type('#login-email',actor.email);await page.type('#login-password',actor.password);await page.click('button[type=submit]');await page.waitForSelector('.squad-app',{timeout:40000});return page;
}
async function click(page,label){await page.waitForFunction(label=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()===label&&!b.disabled),{timeout:30000},label);await page.evaluate(label=>[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);}
async function field(page,label,value){await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>(()=>{const copy=l.cloneNode(true);copy.querySelectorAll('[aria-hidden="true"]').forEach(n=>n.remove());return copy.textContent.trim()===label;})()),{timeout:30000},label);const h=await page.evaluateHandle(label=>{const l=[...document.querySelectorAll('label')].find(l=>(()=>{const copy=l.cloneNode(true);copy.querySelectorAll('[aria-hidden="true"]').forEach(n=>n.remove());return copy.textContent.trim()===label;})());return document.getElementById(l.htmlFor);},label),e=h.asElement();assert.ok(e);if(await e.evaluate(e=>e.tagName==='SELECT'))await e.select(value);else{await e.click({clickCount:3});await e.press('Backspace');await e.type(value);}await h.dispose();}
const post=(r,pathname)=>r.request().method()==='POST'&&new URL(r.url()).pathname===pathname;
async function body(response){assert.ok(response.ok(),'Expected successful product request');return response.json();}
async function boundedBytes(page,url,limit){return page.evaluate(async(url,limit)=>{const r=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Download failed');const reader=r.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Download exceeds bound');}chunks.push(value);}const out=new Uint8Array(size);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}let result='';for(let i=0;i<size;i+=32768)result+=String.fromCharCode(...out.subarray(i,i+32768));return btoa(result);},url,limit);}

try{
 for(const role of [3,1]){const actor=config.actors.find(a=>a.role===role);assert.ok(actor);const client=createClient(STAGING,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),r=await client.auth.signInWithPassword({email:actor.email,password:actor.password});if(r.error)throw Error('Fixture login failed');assert.equal(r.data.user.id,actor.auth_id);clients.set(role,{client,sdk:createSquadClient(client)});}
 const page=await pageFor(3),sdk=clients.get(3).sdk,foreign=clients.get(1).sdk;let report;
 if(config.phase==='request'){
  await page.goto(base+'/squad/documents/new/catalogue',{waitUntil:'domcontentloaded'});await field(page,'Select by','class_ids');
  const name=config.fixture.label+' RMP class';await page.waitForFunction(name=>[...document.querySelectorAll('label')].some(l=>l.textContent===name),{timeout:30000},name);
  await page.evaluate(name=>[...document.querySelectorAll('label')].find(l=>l.textContent===name).querySelector('input[type=checkbox]').click(),name);
  await field(page,'Company name',config.fixture.label+' catalogue');await field(page,'Markup type','percentage');await field(page,'Markup (%)','12.5');
  const fileInput=await page.$('input[type=file]');assert.ok(fileInput);await fileInput.uploadFile(config.file.path);await fileInput.dispose();
  const reserved=page.waitForResponse(r=>post(r,'/functions/v1/squad-account/documents/attachments'),{timeout:30000});
  const finalized=page.waitForResponse(r=>post(r,'/functions/v1/squad-account/documents/attachments/finalize'),{timeout:60000});finalized.catch(()=>{});
  await click(page,'Upload terms attachment');const reservation=await body(await reserved);log('entity',{kind:'media_upload',id:reservation.upload_id});
  const ref=await body(await finalized);assert.equal(ref.resource,'document_attachments');assert.equal(ref.field,'terms');log('entity',{kind:'document_attachment',id:ref.record_id});
  await page.waitForFunction(()=>document.body.textContent.includes('Terms attachment ready'),{timeout:30000});
  const typed={resource:ref.resource,record_id:ref.record_id,field:ref.field},grant=(await sdk.mediaGrants([typed])).references[0];assert.equal(grant.status,'ready');
  const u=new URL(grant.url);assert.equal(u.origin,STAGING);assert.equal(decodeURIComponent(u.pathname),'/storage/v1/object/sign/canto-media/'+config.file.canonical);
  assert.deepEqual(Buffer.from(await boundedBytes(page,grant.url,config.file.bytes),'base64'),expectedBytes);
  await assert.rejects(foreign.mediaGrants([typed]),e=>['not_found','forbidden'].includes(e.kind));
  const waiting=page.waitForResponse(r=>post(r,'/rest/v1/rpc/v1_document_request'),{timeout:30000});await click(page,'Generate catalogue');const result=await body(await waiting);
  log('entity',{kind:'document',id:result.id});const doc=await sdk.document(result.id);assert.equal(doc.state,'queued');assert.equal(doc.kind,'catalogue');
  await page.waitForFunction(id=>location.pathname===`/squad/documents/${id}`&&document.body.textContent.includes('Your document is being prepared.'),{timeout:30000},doc.id);
  await page.screenshot({path:path.join(config.output_dir,'catalogue-queued.png'),fullPage:true});
  report={phase:'request',document_id:doc.id,job_id:doc.job_id,upload_id:reservation.upload_id,attachment_reference:typed,terms_bytes:config.file.bytes,terms_sha256:expectedHash,real_browser_upload:true,owner_grant_verified:true,foreign_grant_denied:true,queued:true};
 }else{
  const d=config.document;assert.equal(d.kind,'catalogue');assert.equal(d.role,3);assert.equal(d.actor_id,config.actors.find(a=>a.role===3).auth_id);
  for(const name of ['document_id','job_id','actor_id'])assert.match(d[name],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(d.prefix,`g${d.generation}/${d.actor_id}/${d.document_id}/`);assert.match(d.request_hash,/^[a-f0-9]{64}$/);assert.ok(config.worker_secret);
  await page.goto(base+'/squad/documents/'+d.document_id,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.textContent.includes('Your document is being prepared.'),{timeout:30000});
  let doc=await sdk.document(d.document_id);assert.equal(doc.job_id,d.job_id);assert.equal(doc.state,'queued');
  for(let step=0;step<6&&doc.state!=='ready';step++){
   const response=await fetch(STAGING+'/functions/v1/squad-jobs/document-rehearsal',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.worker_secret},body:JSON.stringify({job_id:d.job_id}),signal:AbortSignal.timeout(60000)});
   assert.equal(response.ok,true,'Exact document worker request must succeed');const result=await response.json();
   assert.equal(result.paused,false);assert.ok(result.results.length<=1);
   for(const entry of result.results){assert.equal(entry.id,d.job_id);assert.ok(!['unconfirmed','dead'].includes(entry.state));}
   doc=await sdk.document(d.document_id);assert.notEqual(doc.state,'failed');
   if(doc.state!=='ready'&&!result.results.length)throw Error('Exact worker busy; retain checkpoint');
  }
  assert.equal(doc.state,'ready');assert.equal(doc.delivery,'download');assert.equal(doc.delivery_state,'not_requested');assert.equal(doc.total_parts,1);
  await page.waitForFunction(()=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='Prepare download'),{timeout:30000});
  const waiting=page.waitForResponse(r=>post(r,'/functions/v1/squad-account/documents/download'),{timeout:30000});await click(page,'Prepare download');const grant=await body(await waiting);validateGrant(grant,d);
  const bytes=Buffer.from(await boundedBytes(page,grant.url,8*1024*1024),'base64');assert.equal(bytes.length,Number(grant.bytes));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const sha=createHash('sha256').update(bytes).digest('hex');assert.equal(sha,grant.sha256);
  fs.writeFileSync(path.join(config.output_dir,'catalogue.pdf'),bytes,{mode:0o600});
  await page.waitForFunction(()=>[...document.querySelectorAll('main a')].some(a=>a.textContent.includes('Open PDF')),{timeout:30000});
  const anchor=await page.evaluateHandle(()=>[...document.querySelectorAll('main a')].find(a=>a.textContent.includes('Open PDF')));assert.equal(await anchor.evaluate(a=>a.href),grant.url);assert.equal(await anchor.evaluate(a=>a.rel),'noopener noreferrer');
  let browserPdfLink;try{browserPdfLink=await clickAndVerifyPdf({page,anchor:anchor.asElement(),url:grant.url,bytes:grant.bytes,sha256:grant.sha256});}finally{await anchor.dispose();}
  await assert.rejects(foreign.document(doc.id),e=>e.kind==='not_found');await assert.rejects(foreign.downloadDocument(doc.id),e=>e.kind==='not_found');
  const anonymous=await fetch(STAGING+'/functions/v1/squad-account/documents/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:doc.id}),signal:AbortSignal.timeout(30000)});assert.equal(anonymous.status,401);await anonymous.body?.cancel();
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewport(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(config.output_dir,`catalogue-ready-${viewport.width}.png`),fullPage:true});}
  report={phase:'render',kind:'catalogue',document_id:doc.id,job_id:doc.job_id,bytes:bytes.length,sha256:sha,pages:doc.pages,queued_to_ready_without_reload:true,browser_prepare_download:true,browser_open_pdf:true,browser_pdf_link:browserPdfLink,foreign_authenticated_denied:true,unauthenticated_denied:true,visual_review_required:true};
 }
 assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
 for(const name of fs.readdirSync(config.output_dir)){const filename=path.join(config.output_dir,name);if(fs.statSync(filename).isFile())fs.chmodSync(filename,0o600);}
 process.stdout.write(JSON.stringify({...report,browser_errors:0,network_violations:0,provider_requests:0,emails_sent:0})+'\n');
}catch(error){
 for(const [role,page]of pages){const filename=path.join(config.output_dir,`failure-${config.phase}-${role}.png`);await page.screenshot({path:filename,fullPage:true}).then(()=>fs.chmodSync(filename,0o600)).catch(()=>{});}
 throw error;
}finally{config.worker_secret='';for(const a of config.actors)a.password='';await browser.close();for(const {client}of clients.values())await client.auth.signOut({scope:'local'}).catch(()=>{});fs.closeSync(journal);}
