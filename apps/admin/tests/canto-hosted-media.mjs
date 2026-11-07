// Actual built dashboard, existing administrator login, and no legacy media network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const environment=process.env.CANTO_TEST_ENVIRONMENT || 'staging';
assert(['staging','production'].includes(environment));
const fixture=JSON.parse(fs.readFileSync(process.env.CANTO_TEST_FIXTURE || 'tools/canto-sync/private/admin-test.json'));
const project=environment==='staging'?'scvojtvgnkmbupvyslmb':'levwrmvqdntngeasrtnb';
assert.equal(fixture.url,`https://${project}.supabase.co`);
const url=process.env.CANTO_TEST_URL || 'http://127.0.0.1:5173';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page=await browser.newPage();const errors=[],legacy=[],wrongProject=[];
 await page.setViewport({width:1440,height:1000});
 page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',r=>{
  if(/64\.227\.186\.227|165\.22\.210\.53|leaderboard\.sagarfab\.com/.test(r.url())) {legacy.push(r.url());r.abort();}
  else {if(r.url().includes(environment==='staging'?'levwrmvqdntngeasrtnb.supabase.co':'scvojtvgnkmbupvyslmb.supabase.co'))wrongProject.push(r.url());r.continue();}
 });
 await page.evaluateOnNewDocument(environment=>{
  localStorage.setItem('scott-dashboard-env-override',environment);
  localStorage.setItem('canto:admin-target:v1',JSON.stringify({source:'supabase',environment}));
 },environment);
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#login-email');
 await page.type('#login-email',fixture.email);await page.type('#login-password',fixture.password);await page.click('button[type=submit]');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='Masters'),{timeout:60000});
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Masters').click());
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='RMP Categories'));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='RMP Categories').click());
 await page.waitForFunction(()=>[...document.querySelectorAll('img')].some(i=>i.src.includes('/canto-media/')&&i.complete&&i.naturalWidth>0),{timeout:60000});
 await page.waitForNetworkIdle({idleTime:500,timeout:30000});
 await page.screenshot({path:`/tmp/canto-hosted-media-${environment}.png`,fullPage:true});
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Data Refresh').click());
 await page.waitForFunction(()=>document.body.innerText.includes('source files'),{timeout:60000});
 assert(await page.evaluate(e=>document.body.innerText.includes(`DigitalOcean ${e} → Supabase ${e}`),environment));
 await page.reload({waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>document.body.innerText.includes('source files'),{timeout:60000});
 await page.screenshot({path:`/tmp/canto-hosted-media-report-${environment}.png`,fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(legacy,[]);assert.deepEqual(wrongProject,[]);
 console.log(JSON.stringify({environment,url,singleDashboardLogin:true,migratedImageRendered:true,mediaReportAndReload:true,legacyRequests:0,wrongProjectRequests:0,browserErrors:0}));
}finally{await browser.close();}
