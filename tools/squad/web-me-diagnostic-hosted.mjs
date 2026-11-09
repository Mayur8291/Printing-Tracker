/** Parent-owned disposable Customer; all credentials arrive only on stdin. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {diagnoseMeBrowser} from './web-me-diagnostic.mjs';
import {transportAllowed,STAGING_ORIGIN} from './web-cross-browser-policy.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);input='';
assert.equal(config.format,'squad-me-diagnostic/v1');assert.equal(config.url,STAGING_ORIGIN);
assert.match(config.run_id,/^[0-9a-f-]{36}$/);assert.equal(config.actors.length,1);
const actor=config.actors[0];assert.equal(actor.role,3);assert.equal(actor.id,String(config.expected_user_id));
const base='http://localhost:5183',violations=[],errors=[];
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const deadline=setTimeout(()=>{void browser.close();},250000);
try{
 const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:1000});
 page.on('pageerror',()=>errors.push('page_error'));
 await page.setRequestInterception(true);page.on('request',request=>{
  if(!transportAllowed({url:request.url(),method:request.method(),body:request.postData()},base)){violations.push('blocked_disallowed_transport');void request.abort();return;}void request.continue();
 });
 await page.goto(base+'/squad/home',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForSelector('#login-email',{timeout:30000});await page.type('#login-email',actor.email);await page.type('#login-password',actor.password);
 const identity=page.waitForResponse(response=>{const u=new URL(response.url());return u.origin===STAGING_ORIGIN&&u.pathname==='/rest/v1/rpc/v1_me'&&response.request().method()==='POST'&&response.status()===200;},{timeout:40000});
 await page.click('button[type=submit]');const me=await(await identity).json();assert.equal(me.id,actor.id);assert.equal(me.auth_id,actor.auth_id);assert.equal(me.role,3);
 actor.password='';await page.waitForSelector('.squad-app',{timeout:40000});
 const result=await diagnoseMeBrowser({page,base,expectedUserId:actor.id});
 assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
 process.stdout.write(JSON.stringify({run_id:config.run_id,...result,browser_errors:0,network_violations:0}));
}catch(error){process.stderr.write(JSON.stringify({failure:'me_diagnostic',type:['AssertionError','TimeoutError'].includes(error?.name)?error.name:'Error'}));process.exitCode=1;}
finally{clearTimeout(deadline);actor.password='';await browser.close();}
