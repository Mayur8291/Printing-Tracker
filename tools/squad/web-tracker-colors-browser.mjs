/** Actual built Masters controls with synthetic, fully intercepted transport. */
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import puppeteer from 'puppeteer';
import {initialize,clickText} from './web-tracker-read-hosted.mjs';import {colorsJourney} from './web-tracker-colors-hosted.mjs';import {colorsDecision} from './web-tracker-colors-policy.mjs';import {STAGING} from './web-tracker-read-policy.mjs';
const dist=path.resolve(process.env.SQUAD_COLORS_TEST_DIST||'apps/admin/dist');const server=http.createServer((req,res)=>{let file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(dist+path.sep)||!path.extname(file))file=path.join(dist,'index.html');try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage(),now=Math.floor(Date.now()/1000),id='00000000-0000-4000-8000-000000000020',user={id,role:'authenticated',email:'local@example.invalid',user_metadata:{full_name:'Local Staff'},app_metadata:{}};
const token='header.'+Buffer.from(JSON.stringify({iss:STAGING+'/auth/v1',sub:id,role:'authenticated',exp:now+3600})).toString('base64url')+'.local',scope={name:'UI Colors local test',editedName:'UI Colors local test edited',phase:null,id:null,updatedAt:null};let row=null;const writes=[],errors=[],denied=[];
try{
 await page.evaluateOnNewDocument(initialize,{session:{access_token:token,refresh_token:'local-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user}});await page.setViewport({width:1440,height:1000});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',async req=>{const u=new URL(req.url()),method=req.method();if(u.origin===new URL(base).origin||['data:','blob:'].includes(u.protocol)){await req.continue();return;}
  const headers={'access-control-allow-origin':new URL(base).origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,HEAD,POST,OPTIONS','content-type':'application/json','content-range':'0-0/0'};const send=(body,status=200)=>req.respond({status,headers,body:JSON.stringify(body)});
  const decision=colorsDecision({url:req.url(),method,body:req.postData(),headers:req.headers()},base,scope);
  if(decision==='deny'){denied.push(u.pathname);await send({message:'denied'},403);return;}if(decision==='blocked-automatic-write'){await send({},403);return;}
  if(method==='OPTIONS'){await send(null,204);return;}if(u.pathname==='/auth/v1/user'){await send(user);return;}
  if(['GET','HEAD'].includes(method)&&u.pathname.startsWith('/rest/v1/')){await send(u.pathname.endsWith('/profiles')?[{id,email:user.email,role:'admin',full_name:'Local Staff',is_active:true}]:u.pathname.endsWith('/admin_emails')?[{email:user.email}]:[]);return;}
  if(u.pathname.endsWith('/list_team_chat_directory')){await send([]);return;}
  if(u.pathname.endsWith('/account_master_capabilities')){await send({upload_pipeline:'verified_private',atomic_master_save:true});return;}
  const b=JSON.parse(req.postData()??'{}');
  if(u.pathname.endsWith('/account_master_save')){writes.push(b.p_action);row={id:999,name:b.p_payload.values.name,hex_code:b.p_payload.values.hex_code,is_deleted:false,created_at:'2026-11-09T00:00:00',updated_at:'2026-11-09T00:00:0'+writes.length,source:1};await send(row);return;}
  if(u.pathname.endsWith('/masters')){
   if(b.action==='delete'){writes.push('delete');row={...row,is_deleted:true,updated_at:'2026-11-09T00:00:03'};await send(row);return;}
   if(b.action==='get'){await send(row);return;}
   const data=b.resource==='colors'&&row&&(!row.is_deleted||b.payload.includeInactive)&&row.name.includes(b.payload.search)?[row]:[];await send({data,page:1,pageSize:1000,totalCount:data.length,totalPages:1,totalCountIsExact:true});return;
  }
  denied.push(u.pathname);await send({},403);
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});await clickText(page,'Printing Orders');
 const checks=await colorsJourney(page,scope,{
  mutate:async(action,click)=>{scope.phase=action;const wait=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(action==='delete'?'/masters':'/account_master_save')&&JSON.parse(r.request().postData()??'{}')[action==='delete'?'action':'p_action']===action);wait.catch(()=>{});await click();const res=await wait;assert.equal(res.ok(),true);const value=await res.json();scope.id=String(value.id);scope.updatedAt=value.updated_at;scope.phase=null;},
  verify:async archived=>{assert.equal(row.is_deleted,archived);await page.waitForFunction(({name,archived})=>[...document.querySelectorAll('tbody td')].some(td=>td.textContent.trim()===name)!==archived,{}, {name:row.name,archived});},
  screenshot:step=>page.screenshot({path:'/tmp/squad-colors-local-'+step+'.png'})});
 assert.deepEqual(writes,['create','update','delete']);assert.deepEqual(errors,[]);assert.deepEqual(denied,[]);console.log(JSON.stringify({passed:true,checks,scope:'Actual built React controls, synthetic intercepted boundary only; no hosted calls'}));
}catch(error){await page.screenshot({path:'/tmp/squad-colors-local-failure.png'});console.error(JSON.stringify({inputs:await page.$$eval('[role=dialog] input',nodes=>nodes.map(n=>({id:n.id,value:n.value}))),denied,errors}));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
