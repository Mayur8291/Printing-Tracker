/** Explicit single owned Colors UI branch. Parent owns authorization/lifecycle. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import puppeteer from 'puppeteer';
import {initialize,clickText} from './web-tracker-read-hosted.mjs';
import {STAGING} from './web-tracker-read-policy.mjs';import {colorsDecision} from './web-tracker-colors-policy.mjs';
import {createBrowserShutdownGuard,BrowserShutdownUnconfirmed} from './browser-shutdown-guard.mjs';
import {browserErrorDiagnostic} from './browser-error-diagnostic.mjs';

export function persistColorsJournal(journal,entries){
 const tmp=journal+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(entries));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,journal);const d=fs.openSync(path.dirname(journal),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
}
export function journalColorsMutation(request,scope,entries,journal){
 const body=JSON.parse(request.postData());const entry={action:scope.phase,body};
 assert.equal(entries.length,['create','update','delete'].indexOf(scope.phase));
 entries.push(entry);persistColorsJournal(journal,entries);return request.continue();
}

export function colorsRequestDiagnostic(request,scope,decision){
 let url;try{url=new URL(request.url());}catch{return {kind:'invalid_url'};}
 const allowed=new Set(['account_master_save','account_master_capabilities','masters']);
 const rpc=url.pathname.split('/').at(-1);
 const headers=Object.fromEntries(Object.entries(request.headers()).map(([key,value])=>[key.toLowerCase(),value]));
 let body;try{body=JSON.parse(request.postData()??'{}');}catch{body=null;}
 const knownKeys=new Set(['p_resource','p_action','p_payload','p_upload_ids','p_idempotency_key','id','values','relations','expectedUpdatedAt','name','hex_code','is_deleted','resource','action','payload']);
 const safeKeys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).map(key=>knownKeys.has(key)?key:'unknown_key').slice(0,20):[];
 return {origin:url.origin===STAGING?'staging':url.hostname==='127.0.0.1'||url.hostname==='localhost'?'local':'other',contract:allowed.has(rpc)?rpc:'other',method:['GET','HEAD','POST','OPTIONS'].includes(request.method())?request.method():'other',phase:['create','update','delete'].includes(scope.phase)?scope.phase:'none',decision,profile:headers['content-profile']==='canto_api'?'canto_api':headers['content-profile']?'other':'absent',body_present:!!request.postData(),body_keys:safeKeys(body),payload_keys:safeKeys(body?.p_payload),value_keys:safeKeys(body?.p_payload?.values)};
}

export async function fillColor(page,name,hex){
 for(const [selector,value] of [['#scott-master-colors-name',name],['#scott-master-colors-hex_code',hex]]){
  await page.waitForSelector(selector,{visible:true});await page.click(selector,{clickCount:3});await page.keyboard.press('Backspace');await page.type(selector,value);
 }
}
export async function rowControl(page,name,label){
 await page.waitForFunction((name,label)=>[...document.querySelectorAll('tbody tr')].some(row=>[...row.querySelectorAll('td')].some(td=>td.textContent.trim()===name)&&[...row.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled)),{},name,label);
 const h=await page.evaluateHandle((name,label)=>{const row=[...document.querySelectorAll('tbody tr')].find(row=>[...row.querySelectorAll('td')].some(td=>td.textContent.trim()===name));return [...row.querySelectorAll('button')].find(b=>b.textContent.trim()===label);},name,label);
 try{await h.asElement().click();}finally{await h.dispose();}
}
export async function colorsJourney(page,scope,{mutate,verify,screenshot=async()=>{}}){
 await clickText(page,'Masters');await clickText(page,'Colors');
 await page.waitForSelector('input[type=search][placeholder*="colors"]');
 await page.type('input[type=search][placeholder*="colors"]',scope.name);
 await clickText(page,'New color');await fillColor(page,scope.name,'#2457AA');
 await mutate('create',()=>clickText(page,'Add color'));await page.waitForSelector('[role=dialog]',{hidden:true});
 await verify(false);await screenshot('created');
 const detail=page.waitForResponse(r=>new URL(r.url()).origin===STAGING&&r.request().method()==='POST'&&new URL(r.url()).pathname==='/rest/v1/rpc/masters'&&(()=>{try{const b=JSON.parse(r.request().postData());return b.resource==='colors'&&b.action==='get'&&String(b.payload?.id)===scope.id;}catch{return false;}})());detail.catch(()=>{});
 await rowControl(page,scope.name,'Edit');assert.equal((await detail).ok(),true);
 await page.waitForFunction(value=>document.querySelector('#scott-master-colors-name')?.value===value&&!document.querySelector('[role=dialog]')?.textContent.includes('Loading the latest values'),{},scope.name);
 await fillColor(page,scope.editedName,'#196B45');await mutate('update',()=>clickText(page,'Save changes'));await page.waitForSelector('[role=dialog]',{hidden:true});
 await verify(false);await screenshot('edited');
 const confirmation=new Promise((resolve,reject)=>page.once('dialog',async dialog=>{
  try{assert.equal(dialog.type(),'confirm');assert.ok(dialog.message().startsWith('Delete '+scope.editedName+' (#'+scope.id+') from Colors?'));await dialog.accept();resolve();}catch(e){await dialog.dismiss();reject(e);}
 }));confirmation.catch(()=>{});
 await mutate('delete',()=>rowControl(page,scope.editedName,'Delete'));await confirmation;
 await verify(true);await screenshot('archived');
 return ['visible_color_create_and_readback','visible_color_edit_and_readback','visible_color_archive_and_readback'];
}
export async function run(config){
 assert.equal(config.url,STAGING);assert.equal(config.base,'http://127.0.0.1:5186/');assert.match(config.run_id,/^[0-9a-f-]{36}$/);
 assert.equal(config.name,'UI Colors '+config.run_id.replaceAll('-',''));assert.equal(config.editedName,config.name+' edited');
 const actor=config.actors[0];assert.equal(config.actors.length,1);assert.equal(actor.role,'admin');assert.equal(actor.session.user.id,actor.id);assert.equal(actor.session.user.role,'authenticated');assert.ok(actor.session.expires_at*1000>Date.now()+300000);
 const folder=path.resolve('tools/squad/private/tracker-colors-'+config.run_id);assert.equal(path.resolve(config.evidence_dir),folder);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const journal=path.join(folder,'requests.json');assert.equal(fs.existsSync(journal),false);
 const entries=[],errors=[],violations=[],transport=[],entryAssets=[],scope={name:config.name,editedName:config.editedName,phase:null,id:null,updatedAt:null};
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),guard=createBrowserShutdownGuard(browser),page=await browser.newPage();
 let identity=false,profile=false;const pending=new Set();
 try{
  await page.setViewport({width:1440,height:1000});await page.evaluateOnNewDocument(initialize,{session:actor.session});
  page.on('pageerror',e=>errors.push(browserErrorDiagnostic(e,[actor.id,actor.email,actor.session.access_token,actor.session.refresh_token,config.anon])));
  await page.setRequestInterception(true);page.on('request',request=>{
   const decision=colorsDecision({url:request.url(),method:request.method(),body:request.postData(),headers:request.headers()},config.base,scope);
   const diagnostic=colorsRequestDiagnostic(request,scope,decision);if(diagnostic.contract!=='other'&&transport.length<100)transport.push(diagnostic);
   if(decision==='mutation'){
    try{void journalColorsMutation(request,scope,entries,journal);}catch(e){violations.push({kind:'mutation_provenance',error:browserErrorDiagnostic(e,[folder,config.name,config.editedName])});void request.abort();}return;
   }
   if(['local','read','identity','preflight'].includes(decision)){void request.continue();return;}
   if(decision!=='blocked-automatic-write')violations.push({method:request.method(),path:new URL(request.url()).pathname});
   void request.respond({status:403,contentType:'application/json',headers:{'access-control-allow-origin':new URL(config.base).origin},body:'{"code":"42501","message":"Scoped Colors acceptance blocks this operation"}'});
  });
  page.on('requestfailed',request=>{if(transport.length<100)transport.push({...colorsRequestDiagnostic(request,scope,'failed'),failure:/^net::[A-Z_]+$/.test(request.failure()?.errorText??'')?request.failure().errorText:'transport_failure'});});
  page.on('response',response=>{
   const task=(async()=>{const u=new URL(response.url());if(response.request().method()==='OPTIONS')return;
    if(u.origin===new URL(config.base).origin&&/^\/assets\/index-[^/]+\.js$/.test(u.pathname)&&response.ok())entryAssets.push({path:u.pathname,sha256:createHash('sha256').update(await response.buffer()).digest('hex')});
    if(u.origin!==STAGING)return;
    if(['/rest/v1/rpc/account_master_capabilities','/rest/v1/rpc/account_master_save','/rest/v1/rpc/masters'].includes(u.pathname)&&transport.length<100){
     const receipt={kind:'response',contract:u.pathname.split('/').at(-1),status:response.status()};
     if(receipt.contract==='account_master_capabilities'&&response.ok()){const capability=await response.json();receipt.verified_private=capability?.upload_pipeline==='verified_private';receipt.atomic_master_save=capability?.atomic_master_save===true;}
     transport.push(receipt);
    }
    if(u.pathname==='/auth/v1/user'){const r=await response.json();assert.equal(r.id,actor.id);assert.equal(r.role,'authenticated');identity=true;}
    if(u.pathname==='/rest/v1/profiles'&&u.searchParams.get('select')==='id,role'&&u.searchParams.get('id')==='eq.'+actor.id){const r=await response.json();assert.equal(r[0]?.id??r.id,actor.id);assert.equal(r[0]?.role??r.role,'admin');profile=true;}
   })().catch(()=>errors.push('identity_or_asset_verification_failed'));pending.add(task);void task.finally(()=>pending.delete(task));
  });
  await page.goto(config.base,{waitUntil:'domcontentloaded'});await clickText(page,'Printing Orders');await Promise.all([...pending]);assert.ok(identity&&profile);
  async function mutate(action,perform){
   guard.assertActive();scope.phase=action;
   const wait=page.waitForResponse(r=>new URL(r.url()).origin===STAGING&&r.request().method()==='POST'&&new URL(r.url()).pathname==='/rest/v1/rpc/'+(action==='delete'?'masters':'account_master_save')&&JSON.parse(r.request().postData()??'{}')[action==='delete'?'action':'p_action']===action,{timeout:30000});wait.catch(()=>{});
   await perform();const response=await wait;assert.equal(response.ok(),true);const r=await response.json();
   if(action==='create'){assert.match(String(r.id),/^[1-9]\d*$/);scope.id=String(r.id);}else assert.equal(String(r.id),scope.id);
   assert.equal(r.name,action==='create'?scope.name:scope.editedName);assert.equal(r.is_deleted,action==='delete');scope.updatedAt=r.updated_at;scope.phase=null;
  }
  async function verify(archived){
   // Independent authenticated point read, never service-role transport.
   const r=await page.evaluate(async({url,anon,token,id})=>{const res=await fetch(url+'/rest/v1/rpc/masters',{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Profile':'canto_api'},body:JSON.stringify({resource:'colors',action:'get',payload:{id}})});return {status:res.status,value:await res.json()};},{url:STAGING,anon:config.anon,token:actor.session.access_token,id:scope.id});
   assert.equal(r.status,200);assert.equal(String(r.value.id),scope.id);assert.equal(r.value.is_deleted,archived);assert.equal(r.value.name,entries.length===1?scope.name:scope.editedName);assert.equal(r.value.hex_code,entries.length===1?'#2457AA':'#196B45');
   await page.waitForFunction(({name,archived})=>[...document.querySelectorAll('tbody td')].some(td=>td.textContent.trim()===name)!==archived,{}, {name:r.value.name,archived});
  }
  const checks=await colorsJourney(page,scope,{mutate,verify,screenshot:step=>page.screenshot({path:path.join(folder,step+'.png')})});
  await Promise.all([...pending]);assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);assert.equal(entries.length,3);
  return {run_id:config.run_id,environment:'staging',complete:true,checks,entryAssets,errors,violations,scope:'One owned Colors create/edit/archive UI branch; no media, CSV, refresh or provider actions'};
 }catch(e){fs.writeFileSync(path.join(folder,'original-error.json'),JSON.stringify(browserErrorDiagnostic(e,[actor.id,actor.email,actor.session.access_token,actor.session.refresh_token,config.anon])),{mode:0o600});fs.writeFileSync(path.join(folder,'failure-diagnostics.json'),JSON.stringify({phase:scope.phase,command_count:entries.length,errors,violations:violations.slice(0,100),transport}),{mode:0o600});await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});throw e;
 }finally{await guard.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let input='';for await(const chunk of process.stdin)input+=chunk;try{console.log(JSON.stringify(await run(JSON.parse(input))));}catch(e){console.error(JSON.stringify(browserErrorDiagnostic(e)));process.exitCode=e instanceof BrowserShutdownUnconfirmed?2:1;}}
