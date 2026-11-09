/** Parent-owned existing Tracker staging smoke. No account creation or domain writes.
 * Input sessions exist only in memory; the Python owner supplies/cleans exact actors. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer';
import {STAGING,approvedFrontend,trackerReadDecision} from './web-tracker-read-policy.mjs';
import {createBrowserShutdownGuard,BrowserShutdownUnconfirmed} from './browser-shutdown-guard.mjs';
import {browserErrorDiagnostic} from './browser-error-diagnostic.mjs';

export function validateConfig(config, now = Date.now()) {
  assert.equal(config.url,STAGING); assert.ok(approvedFrontend(config.base));
  assert.match(config.run_id,/^[0-9a-f-]{36}$/i);
  assert.equal(config.actors?.length,2); assert.deepEqual(config.actors.map(a=>a.role).sort(),['admin','viewer']);
  assert.equal(new Set(config.actors.map(a=>a.id)).size,2);
  for(const actor of config.actors){
    assert.match(actor.id,/^[0-9a-f-]{36}$/i);assert.equal(typeof actor.email,'string');
    assert.equal(actor.session?.user?.id,actor.id);assert.equal(actor.session.user.email,actor.email);
    assert.equal(actor.session.user.role,'authenticated');
    assert.ok(actor.session.expires_at*1000>now+300000,'Session must remain valid for the bounded smoke');
    const token=JSON.parse(Buffer.from(actor.session.access_token.split('.')[1],'base64url').toString());
    assert.equal(token.iss,STAGING+'/auth/v1');assert.equal(token.sub,actor.id);assert.equal(token.role,'authenticated');
    assert.ok(token.exp*1000>now+300000);
  }
  const privateRoot=path.resolve('tools/squad/private');
  const directory=path.resolve(config.evidence_dir||path.join(privateRoot,'tracker-read-'+config.run_id));
  assert.ok(directory.startsWith(privateRoot+path.sep));
  return directory;
}

// No socket is opened. This is only a subscription rendering double, not realtime acceptance.
export function initialize({session}) {
  localStorage.setItem('sb-scvojtvgnkmbupvyslmb-auth-token',JSON.stringify(session));
  localStorage.setItem('scott-dashboard-env-override','staging');
  localStorage.setItem('canto:admin-target:v1',JSON.stringify({source:'supabase',environment:'production'}));
  sessionStorage.setItem('printing-tracker-dashboard-tab','printing');
  class LocalSocket extends EventTarget {
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url){super();this.url=url;this.readyState=0;queueMicrotask(()=>{this.readyState=1;const event=new Event('open');this.dispatchEvent(event);this.onopen?.(event);});}
    send(text){try{const m=JSON.parse(text);if(!m.topic)return;queueMicrotask(()=>{const e=new MessageEvent('message',{data:JSON.stringify({topic:m.topic,event:'phx_reply',ref:m.ref,join_ref:m.join_ref,payload:{status:'ok',response:{postgres_changes:[]}}})});this.dispatchEvent(e);this.onmessage?.(e);});}catch{}}
    close(){this.readyState=3;const e=new CloseEvent('close',{code:1000});this.dispatchEvent(e);this.onclose?.(e);}
  }
  window.WebSocket=LocalSocket;
}
export async function clickText(page,text){
  await page.waitForFunction(text=>[...document.querySelectorAll('button,a')].some(e=>e.textContent.trim()===text&&!e.disabled&&e.getBoundingClientRect().width>0),{timeout:15000},text);
  const handle=await page.evaluateHandle(text=>[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===text&&!e.disabled&&e.getBoundingClientRect().width>0),text);
  try{assert.ok(handle.asElement(),'Required existing navigation control absent');await handle.asElement().click();}finally{await handle.dispose();}
}
const wireBody=r=>{try{return JSON.parse(r.postData()||'{}');}catch{return {};}};
const matches=(request,step)=>{
 const p=new URL(request.url()).pathname,b=wireBody(request);
 if(step==='Printing Orders')return p==='/rest/v1/orders'&&request.method()==='GET';
 if(request.method()!=='POST')return false;
 if(step==='Customers')return p==='/rest/v1/rpc/dashboard'&&b.p_action==='query'&&b.p_args?.report==='customers';
 if(step==='Reports')return p==='/rest/v1/rpc/dashboard'&&b.p_action==='query'&&b.p_args?.report==='order_reports';
 if(step==='Masters')return p==='/rest/v1/rpc/masters'&&b.resource==='authorized_brands'&&b.action==='list';
 return step==='Data Refresh'&&p==='/functions/v1/canto-refresh'&&b.action==='status'&&b.environment==='staging';
};

export async function run(config) {
  const directory=validateConfig(config);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const report={scope:'Real staging staff gateway and bounded reads; automatic writes blocked; realtime and CRUD not exercised',checks:[],actors:[],frontend:config.base,environment:'staging',entryAssets:[],complete:false};
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const lifetime=createBrowserShutdownGuard(browser); //240s, below parent's300s hard ceiling.
  let phase='initial',subphase='initial',currentDiagnostics=null;
  try{
    for(const actor of config.actors){
      lifetime.assertActive();
      const context=await browser.createBrowserContext(),page=await context.newPage(),pending=new Set();
      const errors=[],denied=[],automatic=[],readFailures=[],javascript=[],successful=[];
      currentDiagnostics={role:actor.role,errors,denied,automatic,readFailures,javascript};
      let identityVerified=false,membershipVerified=false;
      try{
        phase=actor.role+':entry';await page.setViewport({width:1440,height:1000});
        await page.evaluateOnNewDocument(initialize,{session:actor.session});
        await page.setRequestInterception(true);
        page.on('request',request=>{
          const decision=trackerReadDecision({url:request.url(),method:request.method(),body:request.postData(),headers:request.headers()},config.base);
          if(['local','read','identity','preflight'].includes(decision)){void request.continue();return;}
          const item={method:request.method(),path:new URL(request.url()).pathname};
          if(decision==='blocked-automatic-write')automatic.push(item);else denied.push(item);
          void request.respond({status:403,contentType:'application/json',headers:{'access-control-allow-origin':new URL(config.base).origin},body:JSON.stringify({code:'42501',message:'Read-only acceptance blocks this operation'})});
        });
        page.on('pageerror',error=>errors.push(browserErrorDiagnostic(error,[config.anon,...config.actors.flatMap(a=>[a.id,a.email,a.session?.access_token,a.session?.refresh_token])])));
        page.on('response',response=>{
          const promise=(async()=>{
            const request=response.request(),u=new URL(response.url());
            if(u.origin===new URL(config.base).origin&&u.pathname.endsWith('.js')){
              javascript.push(path.basename(u.pathname));
              if(/\/assets\/index-[^/]+\.js$/.test(u.pathname)&&response.ok()){
                const hash=createHash('sha256').update(await response.buffer()).digest('hex');
                if(!report.entryAssets.some(a=>a.path===u.pathname))report.entryAssets.push({path:u.pathname,sha256:hash});
              }
            }
            if(u.origin!==STAGING||request.method()==='OPTIONS')return;
            const decision=trackerReadDecision({url:request.url(),method:request.method(),body:request.postData(),headers:request.headers()},config.base);
            if(!['read','identity'].includes(decision))return;
            if(!response.ok()){readFailures.push({path:u.pathname,status:response.status()});return;}
            successful.push(request);
            if(u.pathname==='/auth/v1/user'){
              const result=await response.json();assert.equal(result.id,actor.id);assert.equal(result.email,actor.email);assert.equal(result.role,'authenticated');identityVerified=true;
            }
            if(u.pathname==='/rest/v1/profiles'&&u.searchParams.get('id')==='eq.'+actor.id&&u.searchParams.get('select')==='id,role'){
              const result=await response.json(),row=Array.isArray(result)?result[0]:result;
              assert.equal(row.id,actor.id);assert.equal(row.role,actor.role);membershipVerified=true;
            }
          })().catch(()=>errors.push('response_identity_or_artifact_verification_failed'));
          pending.add(promise);void promise.finally(()=>pending.delete(promise));
        });
        subphase='navigate_entry';await page.goto(config.base,{waitUntil:'domcontentloaded'});
        subphase='wait_workspace';
        await page.waitForFunction(()=>document.body.textContent.includes('Scott Dashboard')&&!document.body.textContent.includes('Opening your dashboard'),{timeout:45000});
        await Promise.all([...pending]);
        assert.ok(identityVerified&&membershipVerified,'Real Auth and exact staff membership must be verified');
        assert.ok(javascript.some(f=>/^App-.*\.js$/.test(f)),'Legacy lazy chunk missing');
        assert.equal(javascript.some(f=>/^SquadApp-.*\.js$/.test(f)),false);
        const checks=['actual_identity_and_profile_verified','legacy_gateway_without_squad_chunk'];
        const steps=actor.role==='admin'?['Printing Orders','Customers','Reports','Masters','Data Refresh']:['Printing Orders'];
        for(const step of steps){
          phase=actor.role+':'+step;
          subphase='wait_navigation_control';
          if(step==='Reports')await page.evaluate(()=>localStorage.setItem('scott.reports.selectedReport','order_reports'));
          const seen=successful.some(r=>matches(r,step));
          const responsePromise=seen&&step==='Printing Orders'?Promise.resolve(null):page.waitForResponse(r=>matches(r.request(),step)&&r.request().method()!=='OPTIONS',{timeout:45000});
          responsePromise.catch(()=>{});
          await clickText(page,step);subphase='wait_read_response';const response=await responsePromise;if(response)assert.equal(response.ok(),true);
          await page.waitForNetworkIdle({idleTime:300,timeout:5000}).catch(()=>{});
          subphase='wait_rendered_screen';await page.waitForFunction(step=>{
            const title=step==='Data Refresh'?'Data refresh':step;
            const current=step==='Printing Orders'?document.querySelector('[aria-label="Printing orders views"]'):[...document.querySelectorAll('h1,h2')].find(n=>n.textContent.trim()===title);
            return Boolean(current?.getBoundingClientRect().width)&&!document.querySelector('tbody .animate-pulse');
          },{timeout:15000},step);
          subphase='validate_rendered_screen';assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
          assert.equal(await page.evaluate(()=>/Could not load|Unable to load|Sign in to (staging|production) to continue/.test(document.body.innerText)),false);
          await page.screenshot({path:path.join(directory,actor.role+'-'+step.toLowerCase().replaceAll(' ','-')+'.png')});
          checks.push('read_screen_'+step.toLowerCase().replaceAll(' ','_'));
        }
        // Await the actual timer request, not time since navigation (Auth may be slow).
        if(!automatic.some(r=>r.path.endsWith('/promote_stale_new_orders_to_pending')))
          await page.waitForRequest(r=>new URL(r.url()).pathname==='/rest/v1/rpc/promote_stale_new_orders_to_pending'&&r.method()==='POST',{timeout:10000});
        await page.setViewport({width:360,height:800});
        await page.waitForNetworkIdle({idleTime:300,timeout:5000}).catch(()=>{});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        await page.screenshot({path:path.join(directory,actor.role+'-360.png')});
        await Promise.all([...pending]);
        assert.deepEqual(errors,[]);assert.deepEqual(denied,[]);assert.deepEqual(readFailures,[]);
        assert.ok(automatic.some(r=>r.path.endsWith('/promote_stale_new_orders_to_pending')),'Known stale-order automatic-write fence was not observed');
        checks.push('360px_no_overflow','automatic_writes_blocked','zero_unexpected_transport_or_browser_errors');
        report.actors.push({role:actor.role,checks,successfulReads:successful.length,blockedAutomaticWrites:automatic});
        report.checks.push(...checks.map(check=>actor.role+':'+check));
      }finally{
        if(currentDiagnostics)currentDiagnostics.controls=await page.evaluate(()=>({documentReady:document.readyState,printingViewPresent:Boolean(document.querySelector('[aria-label="Printing orders views"]')),navigation:Object.fromEntries(['Printing Orders','Customers','Reports','Masters','Data Refresh'].map(label=>[label,[...document.querySelectorAll('button,a')].some(e=>e.textContent.trim()===label&&e.getBoundingClientRect().width>0)]))})).catch(()=>null);
        await context.close();await Promise.all([...pending]);
      }
    }
    lifetime.assertActive();assert.ok(report.entryAssets.length>0,'Built application entry must be pinned');
    report.complete=true;return report;
  }catch(cause){
    // Private and public diagnostics contain no response bodies, identities or credentials.
    const original=browserErrorDiagnostic(cause,[config.anon,...config.actors.flatMap(a=>[a.id,a.email,a.session?.access_token,a.session?.refresh_token])]);
    fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify({phase,subphase,original,scope:report.scope,shutdown_reason:lifetime.reason,diagnostics:currentDiagnostics}),{mode:0o600});
    throw new Error('Tracker read smoke failed at '+phase+'; inspect private evidence');
  }finally{for(const actor of config.actors){actor.session=null;}await lifetime.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  let config;try{config=JSON.parse(input);input='';const report=await run(config);console.log(JSON.stringify(report));}catch(error){input='';if(config?.actors)for(const actor of config.actors)actor.session=null;console.error(error instanceof BrowserShutdownUnconfirmed?'Browser shutdown could not be confirmed':error.message.startsWith('Tracker read smoke failed at ')?error.message:'Tracker read smoke configuration or startup validation failed');process.exitCode=error instanceof BrowserShutdownUnconfirmed?2:1;}
}
