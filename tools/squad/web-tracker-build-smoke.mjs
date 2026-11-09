/** Frozen production artifact regression using explicit synthetic Tracker reads.
 * All external HTTP/WebSocket transport is replaced locally. No real staff
 * credentials, public profiles, Tracker writes, old API or Supabase is contacted.
 * This is gateway/rendering evidence, not hosted Tracker business acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
const dist=path.resolve('apps/admin/dist'),html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const entry=html.match(/<script[^>]+src="([^"]+)"/)[1];
const server=http.createServer((req,res)=>{try{let file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);assert.ok(file.startsWith(dist+path.sep)||file===dist);if(!path.extname(file))file=path.join(dist,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const origin='https://scvojtvgnkmbupvyslmb.supabase.co',userId='00000000-0000-4000-8000-000000000020';
const now=Math.floor(Date.now()/1000),user={id:userId,aud:'authenticated',role:'authenticated',email:'tracker-local@example.invalid',email_confirmed_at:new Date().toISOString(),user_metadata:{full_name:'Local Tracker Staff'},app_metadata:{provider:'email',providers:['email']},created_at:new Date().toISOString()};
const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,role:'authenticated',aud:'authenticated',exp:now+3600,iat:now,iss:origin+'/auth/v1'})).toString('base64url')+'.synthetic-local-signature';
const session={access_token:jwt,refresh_token:'local-only-never-transmitted',expires_in:3600,expires_at:now+3600,token_type:'bearer',user};
const report={scope:'Frozen production artifact with synthetic staff membership and local read responses only; not hosted CRUD/refresh/realtime acceptance',entry,entrySha256:createHash('sha256').update(fs.readFileSync(path.join(dist,entry))).digest('hex'),cases:[],blockedWrites:[],unexpectedRequests:[]};
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const membership of ['admin','viewer','none']){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  try{
   await page.setViewport({width:1440,height:1000});page.on('pageerror',error=>errors.push(error.message));
   await page.evaluateOnNewDocument((session)=>{
    localStorage.setItem('sb-scvojtvgnkmbupvyslmb-auth-token',JSON.stringify(session));
    // Explicit subscription test double: no WebSocket or real-time evidence.
    class LocalSocket extends EventTarget {
     static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
     constructor(url){super();this.url=url;this.readyState=0;queueMicrotask(()=>{this.readyState=1;const event=new Event('open');this.dispatchEvent(event);this.onopen?.(event);});}
     send(text){try{const message=JSON.parse(text);if(!message.topic)return;queueMicrotask(()=>{const event=new MessageEvent('message',{data:JSON.stringify({topic:message.topic,event:'phx_reply',ref:message.ref,join_ref:message.join_ref,payload:{status:'ok',response:{postgres_changes:[]}}})});this.dispatchEvent(event);this.onmessage?.(event);});}catch{}}
     close(){this.readyState=3;const event=new CloseEvent('close',{code:1000});this.dispatchEvent(event);this.onclose?.(event);}
    }
    window.WebSocket=LocalSocket;
   },session);
   const readRequests=[],js=[];
   await page.setRequestInterception(true);page.on('request',request=>{
    const url=new URL(request.url()),method=request.method();
    if(url.origin===base||['data:','blob:','about:'].includes(url.protocol)){if(url.pathname.endsWith('.js'))js.push(path.basename(url.pathname));void request.continue();return;}
    const headers={'access-control-allow-origin':base,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS,HEAD','content-type':'application/json','content-range':'0-0/0'};
    const respond=(body,status=200)=>void request.respond({status,headers,body:JSON.stringify(body)});
    if(url.origin!==origin){report.unexpectedRequests.push({membership,origin:url.origin,path:url.pathname});void request.abort();return;}
    if(method==='OPTIONS'){respond(null,204);return;}
    if(url.pathname==='/auth/v1/user'&&method==='GET'){respond(user);return;}
    if(url.pathname.startsWith('/rest/v1/')&&['GET','HEAD'].includes(method)){
     readRequests.push(url.pathname);
     if(url.pathname==='/rest/v1/profiles'){respond(membership==='none'?[]:[{id:userId,email:user.email,full_name:'Local Tracker Staff',role:membership,is_active:true,status_tones_enabled:false,department:'operations'}]);return;}
     if(url.pathname==='/rest/v1/admin_emails'){respond(membership==='admin'?[{email:user.email}]:[]);return;}
     respond([]);return;
    }
    if(url.pathname==='/rest/v1/rpc/list_team_chat_directory'&&method==='POST'){respond([]);return;}
    let body;try{body=JSON.parse(request.postData()||'{}');}catch{body={};}
    if(url.pathname==='/functions/v1/scott-dashboard-masters'&&method==='POST'&&body.method==='GET'&&body.resource==='authorized_brands'){
     respond({ok:true,upstreamStatus:200,body:{data:[{id:901,name:'Local regression brand',description:'Synthetic read fixture',is_deleted:false}],pagy:{page:1,items:20,count:1,pages:1}}});return;
    }
    if(url.pathname==='/functions/v1/canto-refresh'&&method==='POST'&&body.action==='status'&&body.environment==='staging'){
     respond({state:{edit_revision:0,synced_revision:0,active_job:null,cutover:false},jobs:[],last_success:null});return;
    }
    if(url.pathname==='/rest/v1/rpc/media_status'&&method==='POST'){
     respond({summary:{files:0,missing:0,external:0,pending:false,complete:true},exceptions:[]});return;
    }
    // Legacy Tracker auto-promotes statuses after5s. Deny this mutation locally
    // and record it; a real read-only regression must not forward this call.
    report.blockedWrites.push({membership,path:url.pathname,method});respond({code:'42501',message:'Local regression transport denies writes'},403);
   });
   await page.goto(base+'/',{waitUntil:'domcontentloaded'});
   if(membership==='none'){
    await page.waitForFunction(()=>document.body.textContent.includes('This account has no active staff workspace.'),{timeout:20000});
    assert.equal(js.some(name=>/^App-.*\.js$/.test(name)),false);
    report.cases.push({membership,checks:['missing_staff_membership_denied_before_legacy_import'],errors});continue;
   }
   await page.waitForFunction(()=>document.body.textContent.includes('Scott Dashboard')&&!document.body.textContent.includes('Opening your dashboard'),{timeout:30000});
   await page.waitForNetworkIdle({idleTime:150,timeout:5000}).catch(()=>{});
   assert.equal(js.some(name=>/^App-.*\.js$/.test(name)),true);assert.equal(js.some(name=>/^SquadApp-.*\.js$/.test(name)),false);
   assert.equal(readRequests.includes('/rest/v1/profiles'),true);
   assert.equal(report.blockedWrites.some(row=>row.membership===membership&&row.path==='/rest/v1/profiles'),false,'Existing staff must not create/promote its profile');
   const entryState=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1}));
   assert.equal(entryState.overflow,false);
   const checks=['verified_staff_membership_routes_to_legacy_tracker','tracker_lazy_chunk_only','no_profile_create_or_promotion','desktop_no_page_overflow'];
   if(membership==='admin'){
    for(const label of ['Printing Orders','Masters','Data Refresh']){
     const handle=await page.evaluateHandle(label=>[...document.querySelectorAll('button,a')].find(n=>n.textContent.trim()===label),label);assert.ok(handle.asElement(),`Existing Tracker navigation ${label}`);await handle.asElement().click();await handle.dispose();
     await page.waitForNetworkIdle({idleTime:150,timeout:5000}).catch(()=>{});
     if(label==='Masters')await page.waitForFunction(()=>document.body.textContent.includes('Local regression brand'),{timeout:10000});
     if(label==='Data Refresh')await page.waitForFunction(()=>document.body.textContent.includes('0 source files'),{timeout:10000});
     const screenshot=`/tmp/squad-tracker-local-${label.toLowerCase().replaceAll(' ','-')}.png`;await page.screenshot({path:screenshot});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks.push(`existing_${label.toLowerCase().replaceAll(' ','_')}_entry_renders`);
    }
   }
   assert.deepEqual(errors,[]);report.cases.push({membership,checks,errors,publicReadCount:readRequests.length});
  }finally{await context.close();}
 }
 assert.deepEqual(report.unexpectedRequests,[]);fs.writeFileSync('/tmp/squad-tracker-build-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,cases:report.cases,blockedWrites:report.blockedWrites,report:'/tmp/squad-tracker-build-smoke.json'}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
