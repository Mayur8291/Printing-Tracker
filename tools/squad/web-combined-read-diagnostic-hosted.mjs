/** Original exact-owned persona fixture; stdin-only credentials, read-only UI. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {diagnoseMeBrowser} from './web-me-diagnostic.mjs';
import {diagnoseWorkerBrowser} from './web-worker-read-diagnostic.mjs';
import {transportAllowed,STAGING_ORIGIN} from './web-cross-browser-policy.mjs';
import {createBrowserShutdownGuard,BrowserShutdownUnconfirmed} from './browser-shutdown-guard.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);input='';
assert.equal(config.format,'squad-combined-read-diagnostic/v1');assert.equal(config.url,STAGING_ORIGIN);
assert.match(config.run_id,/^[0-9a-f-]{36}$/);assert.deepEqual(config.actors.map(a=>a.role),[3,11]);assert.match(config.order_id,/^[1-9]\d*$/);
const base='http://localhost:5183',violations=[],errors=[],reports=[];
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const guard=createBrowserShutdownGuard(browser,{deadlineMs:360000});let output;
let closed=false;
try{
 for(const actor of config.actors){
  guard.assertActive();const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:1000});
  page.on('pageerror',()=>errors.push('page_error'));
  await page.setRequestInterception(true);page.on('request',request=>{
   if(!transportAllowed({url:request.url(),method:request.method(),body:request.postData()},base)){violations.push('blocked_disallowed_transport');void request.abort();return;}void request.continue();
  });
  await page.goto(base+'/squad/home',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForSelector('#login-email',{timeout:30000});
  await page.type('#login-email',actor.email);await page.type('#login-password',actor.password);
  const identity=page.waitForResponse(r=>{const u=new URL(r.url());return u.origin===STAGING_ORIGIN&&u.pathname==='/rest/v1/rpc/v1_me'&&r.request().method()==='POST'&&r.status()===200;},{timeout:30000});identity.catch(()=>{});
  await page.click('button[type=submit]');const me=await(await identity).json();assert.equal(me.id,actor.id);assert.equal(me.auth_id,actor.auth_id);assert.equal(me.role,actor.role);
  actor.password='';await page.waitForSelector('.squad-app',{timeout:30000});
  reports.push(actor.role===3?await diagnoseMeBrowser({page,base,expectedUserId:actor.id}):await diagnoseWorkerBrowser({page,base,orderId:config.order_id}));
  await context.close();guard.assertActive();
 }
 assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
 output={format:config.format,run_id:config.run_id,environment:'staging',reports,browser_errors:0,network_violations:0,application_mutations:0};
}catch(error){process.stderr.write(JSON.stringify({failure:'combined_read_diagnostic',type:['AssertionError','TimeoutError'].includes(error?.name)?error.name:'Error'}));process.exitCode=1;}
finally{
 for(const actor of config.actors)actor.password='';
 try{await guard.dispose();closed=true;}catch(error){process.exitCode=error instanceof BrowserShutdownUnconfirmed?2:1;}
}
if(closed)process.stdout.write(JSON.stringify(output&&!process.exitCode?{...output,browser_closed:true}:{format:config.format,run_id:config.run_id,browser_closed:true,failed:true}));
