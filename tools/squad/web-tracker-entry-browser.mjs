/** Actual built Tracker with delayed synthetic staff reads; no hosted transport. */
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import puppeteer from 'puppeteer';
import {initialize,clickText} from './web-tracker-read-hosted.mjs';
import {trackerReadDecision} from './web-tracker-read-policy.mjs';
const dist=path.resolve('apps/admin/dist'),origin='https://scvojtvgnkmbupvyslmb.supabase.co';
const server=http.createServer((req,res)=>{let file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(dist+path.sep)||!path.extname(file))file=path.join(dist,'index.html');try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const role of ['admin','viewer']){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],calls=[],unexpectedReads=[];
  const now=Math.floor(Date.now()/1000),id='00000000-0000-4000-8000-000000000020',user={id,role:'authenticated',email:'local@example.invalid',user_metadata:{full_name:'Local Staff'},app_metadata:{}};
  const token='header.'+Buffer.from(JSON.stringify({iss:origin+'/auth/v1',sub:id,role:'authenticated',exp:now+3600})).toString('base64url')+'.local';
  await page.evaluateOnNewDocument(initialize,{session:{access_token:token,refresh_token:'local-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user}});
  await page.setViewport({width:1440,height:1000});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',async req=>{
   const u=new URL(req.url()),method=req.method();if(u.origin===base||['data:','blob:'].includes(u.protocol)){await req.continue();return;}
   assert.equal(u.origin,origin);const headers={'access-control-allow-origin':base,'access-control-allow-headers':'*','access-control-allow-methods':'GET,HEAD,POST,OPTIONS','content-type':'application/json','content-range':'0-0/0'};
   const send=(body,status=200)=>req.respond({status,headers,body:JSON.stringify(body)});
   if(method==='OPTIONS'){await send(null,204);return;}
   if(u.pathname==='/auth/v1/user'){await send(user);return;}
   if(['GET','HEAD'].includes(method)&&u.pathname.startsWith('/rest/v1/')){
    calls.push(u.pathname);if(trackerReadDecision({url:req.url(),method,headers:req.headers()},base)!=='read')unexpectedReads.push(u.pathname);
    if(u.pathname==='/rest/v1/profiles'){
     // Membership succeeds first; real Tracker's own profile can still be loading.
     if(u.searchParams.get('select')!=='id,role')await new Promise(r=>setTimeout(r,350));
     await send([{id,email:user.email,full_name:'Local Staff',role,is_active:true,department:'operations',status_tones_enabled:false}]);return;
    }
    if(u.pathname==='/rest/v1/admin_emails'){await send(role==='admin'?[{email:user.email}]:[]);return;}
    await send([]);return;
   }
   if(u.pathname.endsWith('/list_team_chat_directory')){await send([]);return;}
   await send({code:'42501',message:'Local acceptance denies writes'},403);
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.textContent.includes('Scott Dashboard')&&!document.body.textContent.includes('Opening your dashboard'));
  // No idle sleep: exercise the same ready-control wait as the hosted adapter.
  await clickText(page,'Printing Orders');await page.waitForSelector('[aria-label="Printing orders views"]');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('printing-tracker-dashboard-tab')),'printing');
  await page.waitForNetworkIdle({idleTime:100,timeout:5000}).catch(()=>{});assert(calls.includes('/rest/v1/orders'));assert.deepEqual(errors,[]);assert.deepEqual(unexpectedReads,[],'Every actual startup GET must match the reviewed read policy');
  await page.screenshot({path:`/tmp/squad-tracker-entry-${role}.png`});await context.close();
 }
 console.log(JSON.stringify({passed:true,checks:['actual_admin_built_entry_with_delayed_profile','actual_viewer_built_entry_with_delayed_profile','source_printing_tab_id','visible_navigation_wait_without_idle_sleep','printing_region_and_orders_read','zero_page_errors','all_actual_startup_reads_match_reviewed_policy'],scope:'Synthetic local staff/read responses only; all hosted writes/reads intercepted'}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
