/** Real browser document output adapter for two registered staging jobs.
 * Root owns binding registration, provider pause, lease recovery and exact
 * Storage cleanup. Worker credentials remain in Node, never page.evaluate.
 * This script cannot register jobs or drain the ordinary queue.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
import {clickAndVerifyPdf} from './browser-pdf-click.mjs';
const STAGING='https://scvojtvgnkmbupvyslmb.supabase.co';
const KINDS={delivery_challan:7,tailor_weekly:4};

export function validateBindings(config){
 assert.equal(config.url,STAGING);assert.match(config.run_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 assert.equal(config.documents.length,2);assert.deepEqual(config.documents.map(d=>d.kind).sort(),Object.keys(KINDS).sort());
 assert.equal(new Set(config.documents.map(d=>d.document_id)).size,2);assert.equal(new Set(config.documents.map(d=>d.job_id)).size,2);
 assert.equal(path.resolve(config.output_dir),path.resolve('tools/squad/private/web-document-outputs/'+config.run_id));
 for(const d of config.documents){
  assert.equal(d.role,KINDS[d.kind]);for(const key of ['document_id','job_id','actor_id'])assert.match(d[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.match(String(d.generation),/^\d+$/);assert.match(d.request_hash,/^[a-f0-9]{64}$/);
  assert.equal(d.prefix,`g${d.generation}/${d.actor_id}/${d.document_id}/`);
  const actor=config.actors.find(a=>a.role===d.role);assert.equal(actor?.auth_id,d.actor_id);
 }
 return config.documents;
}
export function validateGrant(grant,expected){
 assert.equal(grant.expires_in,120);const u=new URL(grant.url);
 assert.equal(u.origin,STAGING);assert.equal(u.username,'');assert.equal(u.password,'');
 assert.equal(decodeURIComponent(u.pathname),'/storage/v1/object/sign/squad-documents/'+expected.prefix+'document.pdf');
 assert.match(grant.sha256,/^[a-f0-9]{64}$/);assert.ok(Number(grant.bytes)>10&&Number(grant.bytes)<=8*1024*1024);
 return u;
}
async function button(page,label){await page.waitForFunction(label=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()===label&&!b.disabled),{timeout:30000},label);await page.evaluate(label=>[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);}
async function privatePdfFromBrowser(page,url){
 return page.evaluate(async url=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{
   const r=await fetch(url,{credentials:'omit',redirect:'error',signal:controller.signal});if(!r.ok)throw Error('Private PDF request failed');
   const reader=r.body.getReader(),parts=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw Error('Fixture PDF exceeds bounded size');}parts.push(value);}
   const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
   let binary='';for(let i=0;i<size;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));
   return{base64:btoa(binary),contentType:r.headers.get('content-type')};
  }finally{clearTimeout(timer);}
 },url);
}
export async function runOutputs(ctx,config){
 const docs=validateBindings(config);assert.equal(typeof ctx.runExactDocumentJob,'function');
 const output=path.resolve(config.output_dir);fs.mkdirSync(output,{recursive:true,mode:0o700});fs.chmodSync(output,0o700);
 const results=[];
 for(const expected of docs){
  const sdk=ctx.clients.get(expected.role).sdk,page=await ctx.pageFor(expected.role);let doc=await sdk.document(expected.document_id);
  assert.equal(doc.job_id,expected.job_id);assert.equal(doc.state,'queued');
  await page.goto(ctx.base+`/squad/documents/${doc.id}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.innerText.includes('Your document is being prepared.'),{timeout:30000});
  assert.equal(await page.$$eval('main a',links=>links.some(a=>a.textContent.includes('Open PDF'))),false);
  const timings=[];
  for(let step=0;step<6&&doc.state!=='ready';step++){
   const start=performance.now(),result=await ctx.runExactDocumentJob(expected.job_id);
   assert.equal(result.paused,false);assert.ok(result.results.length<=1);
   for(const r of result.results){assert.equal(r.id,expected.job_id);assert.ok(!['unconfirmed','dead'].includes(r.state));}
   timings.push({step,wall_ms:Math.round(performance.now()-start),states:result.results.map(r=>r.state)});
   doc=await sdk.document(expected.document_id);assert.notEqual(doc.state,'failed');
   if(doc.state!=='ready'&&!result.results.length)throw Error('Exact worker is busy; retain recovery checkpoint');
  }
  assert.equal(doc.state,'ready');assert.equal(doc.delivery,'download');assert.equal(doc.delivery_state,'not_requested');
  // Polling is part of the product flow; do not reload a queued page into ready.
  await page.waitForFunction(()=>[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='Prepare download'),{timeout:30000});
  const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/functions/v1/squad-account/documents/download',{timeout:30000});
  await button(page,'Prepare download');const response=await waiting;assert.equal(response.ok(),true);const grant=await response.json();const signed=validateGrant(grant,expected);
  await page.waitForFunction(()=>[...document.querySelectorAll('main a')].some(a=>a.textContent.includes('Open PDF')),{timeout:30000});
  const anchor=await page.evaluateHandle(()=>[...document.querySelectorAll('main a')].find(a=>a.textContent.includes('Open PDF')));
  assert.equal(await anchor.evaluate(a=>a.href),grant.url);assert.equal(await anchor.evaluate(a=>a.rel),'noopener noreferrer');
  const downloaded=await privatePdfFromBrowser(page,grant.url),pdf=Buffer.from(downloaded.base64,'base64');downloaded.base64='';
  assert.ok(downloaded.contentType?.startsWith('application/pdf'));assert.equal(pdf.length,Number(grant.bytes));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const sha256=createHash('sha256').update(pdf).digest('hex');assert.equal(sha256,grant.sha256);
  fs.writeFileSync(path.join(output,expected.kind+'.pdf'),pdf,{mode:0o600});
  await page.screenshot({path:path.join(output,expected.kind+'-ready.png'),fullPage:true});fs.chmodSync(path.join(output,expected.kind+'-ready.png'),0o600);
  // Follow the real UI link. Chrome's native PDF viewer is environment-specific;
  // pixel layout review uses root's Poppler rendering of these same bytes.
  let browserPdfLink;try{browserPdfLink=await clickAndVerifyPdf({page,anchor:anchor.asElement(),url:grant.url,bytes:grant.bytes,sha256:grant.sha256});}finally{await anchor.dispose();}
  const foreign=ctx.clients.get(3).sdk;await assert.rejects(foreign.document(doc.id),e=>e.kind==='not_found');await assert.rejects(foreign.downloadDocument(doc.id),e=>e.kind==='not_found');
  const publicResponse=await fetch(signed.origin+signed.pathname.replace('/object/sign/','/object/public/'),{signal:AbortSignal.timeout(30000)});assert.ok(publicResponse.status>=400);await publicResponse.body?.cancel();
  const anonymous=await fetch(STAGING+'/functions/v1/squad-account/documents/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:doc.id}),signal:AbortSignal.timeout(30000)});assert.equal(anonymous.status,401);await anonymous.body?.cancel();
  results.push({kind:expected.kind,document_id:doc.id,job_id:doc.job_id,bytes:pdf.length,sha256,pages:doc.pages,queued_to_ready_without_reload:true,browser_prepare_download:true,browser_open_pdf:true,browser_pdf_link:browserPdfLink,private_storage:true,foreign_authenticated_denied:true,unauthenticated_denied:true,public_storage_denied:true,download_expiry_seconds:120,timings});
 }
 return{documents:results,real_browser:true,deployed_renderer:true,emails_sent:0,providers_called:0,visual_review_required:true,scope:'Two exact registered download jobs; browser request/progress/private PDF link and bytes; no ordinary queue drain or catalogue rendering'};
}

async function main(){
 let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);input='';validateBindings(config);assert.ok(config.worker_secret);
 const allowed=new Set(config.documents.map(d=>d.job_id)),clients=new Map(),pages=new Map(),errors=[],violations=[];
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  for(const role of [3,4,7]){const actor=config.actors.find(a=>a.role===role);assert.ok(actor);const client=createClient(STAGING,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});if(login.error)throw Error('Requester Auth login failed');assert.equal(login.data.user.id,actor.auth_id);clients.set(role,{client,sdk:createSquadClient(client)});}
  const ctx={base:'http://localhost:5183',clients,async pageFor(role){if(pages.has(role))return pages.get(role);assert.ok([4,7].includes(role));const actor=config.actors.find(a=>a.role===role),context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:1000});page.on('pageerror',e=>errors.push(e.name));await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(!['localhost','127.0.0.1','scvojtvgnkmbupvyslmb.supabase.co'].includes(u.hostname)&&!['about:','data:','blob:'].includes(u.protocol)){violations.push('unexpected_external_request');void r.abort();return;}if(u.pathname.startsWith('/rest/v1/')&&!u.pathname.startsWith('/rest/v1/rpc/'))violations.push('raw_table_request');void r.continue();});await page.goto('http://localhost:5183/squad/home',{waitUntil:'domcontentloaded'});await page.waitForSelector('#login-email');await page.type('#login-email',actor.email);await page.type('#login-password',actor.password);await page.click('button[type=submit]');await page.waitForSelector('.squad-app',{timeout:40000});pages.set(role,page);return page;},async runExactDocumentJob(id){assert.ok(allowed.has(id));const r=await fetch(STAGING+'/functions/v1/squad-jobs/document-rehearsal',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.worker_secret},body:JSON.stringify({job_id:id}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Exact document worker HTTP '+r.status);return r.json();}};
  const report=await runOutputs(ctx,config);assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);process.stdout.write(JSON.stringify({...report,browser_errors:0,network_violations:0})+'\n');
 }finally{config.worker_secret='';for(const actor of config.actors)actor.password='';await browser.close();for(const {client}of clients.values())await client.auth.signOut({scope:'local'}).catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
