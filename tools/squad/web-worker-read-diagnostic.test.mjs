/** Local Chromium/HTTP contract test; hosted origin intercepted, never sent. */
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {diagnoseWorkerBrowser} from './web-worker-read-diagnostic.mjs';
let requests=0;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<main class="squad-app">Worker detail</main><script>fetch('https://scvojtvgnkmbupvyslmb.supabase.co/rest/v1/rpc/v1_order_get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_id:'123',p_item_cursor:null,p_item_limit:25})}).then(r=>r.json())</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.setRequestInterception(true);
 page.on('request',request=>{
  const u=new URL(request.url());if(u.hostname==='localhost'||u.hostname==='127.0.0.1')return void request.continue();
  assert.equal(u.origin,'https://scvojtvgnkmbupvyslmb.supabase.co');assert.equal(u.pathname,'/rest/v1/rpc/v1_order_get');
  if(request.method()==='OPTIONS')return void request.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST'}});
  requests++;assert.deepEqual(JSON.parse(request.postData()),{p_id:'123',p_item_cursor:null,p_item_limit:25});
  return void request.respond({status:requests===3?500:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'},body:JSON.stringify(requests===3?{message:'private SQL text'}:{id:'123',items:{data:[{id:'private-item'}]},comment:'private-comment'})});
 });
 const result=await diagnoseWorkerBrowser({page,base:`http://localhost:${server.address().port}`,orderId:'123'});
 assert.equal(requests,6);assert.equal(result.samples.length,6);assert.equal(result.samples[2].outcome,'failed');assert.equal(result.all_requests_completed,false);assert.equal(result.target_met,false);assert.equal(result.repeat_p95_ms,null);
 assert.equal(result.samples.filter(s=>s.outcome==='completed').length,5);
 assert.equal(JSON.stringify(result).includes('private'),false);
 assert.deepEqual(result.samples.map(s=>s.index),[0,1,2,3,4,5]);
 console.log(JSON.stringify({checks:5,actual_local_browser:true,hosted_requests:0,samples:6,failed_samples_retained:1,no_retry:true}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
