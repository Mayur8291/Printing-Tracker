/** Local actual Chromium/HTTP-only diagnostic contract; no hosted requests. */
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {diagnoseMeBrowser} from './web-me-diagnostic.mjs';
let requests=0;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<main class="squad-app">Local diagnostic fixture</main><script>fetch('https://scvojtvgnkmbupvyslmb.supabase.co/rest/v1/rpc/v1_me',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json())</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.setRequestInterception(true);
 page.on('request',request=>{
  const u=new URL(request.url());if(u.hostname==='localhost'||u.hostname==='127.0.0.1')return void request.continue();
  assert.equal(u.origin,'https://scvojtvgnkmbupvyslmb.supabase.co');assert.equal(u.pathname,'/rest/v1/rpc/v1_me');
  if(request.method()==='OPTIONS')return void request.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST'}});
  requests++;return void request.respond({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'},body:JSON.stringify({id:'123',role:3,email:'private@example.invalid'})});
 });
 const result=await diagnoseMeBrowser({page,base:`http://localhost:${server.address().port}`,expectedUserId:'123'});
 assert.equal(requests,6);assert.equal(result.samples.length,6);assert.equal(result.all_requests_completed,true);
 assert.deepEqual(result.samples.map(x=>x.index),[0,1,2,3,4,5]);
 assert.ok(result.samples.every(x=>x.status===200&&x.duration_ms>=0));
 assert.equal(JSON.stringify(result).includes('private@example.invalid'),false);assert.equal(JSON.stringify(result).includes('expectedUserId'),false);
 const failed=await diagnoseMeBrowser({page,base:`http://localhost:${server.address().port}`,expectedUserId:'456'});
 assert.equal(requests,12);assert.equal(failed.samples.length,6);assert.ok(failed.samples.every(x=>x.outcome==='failed'));assert.equal(failed.repeat_p95_ms,null);assert.equal(failed.target_met,false);
 console.log(JSON.stringify({checks:4,actual_local_browser:true,hosted_requests:0,retained_success_samples:6,retained_failed_samples:6}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
