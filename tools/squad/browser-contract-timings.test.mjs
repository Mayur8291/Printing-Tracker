import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer';
import {createContractTimings,timingContract} from './browser-contract-timings.mjs';

test('contract whitelist omits credentials and identifiers; bounded summary uses nearest-rank completed samples',()=>{
 const origin='https://project.supabase.co';
 for(const path of ['/auth/v1/token?password=secret','/storage/v1/object/sign/bucket/private?token=secret','/rest/v1/users','/functions/v1/squad-account/users/private-email@example.com','/rest/v1/rpc/v1_user_123','/rest/v1/rpc/v1_unknown_private_name'])assert.equal(timingContract(origin+path,origin),null);
 assert.equal(timingContract('https://foreign.example/rest/v1/rpc/v1_me',origin),null);
 assert.equal(timingContract(origin+'/rest/v1/rpc/v1_me?email=private@example.com',origin),'/rest/v1/rpc/v1_me');
 let clock=0;const page=new EventEmitter(),timings=createContractTimings({origin,maxSamples:3,maxInFlight:1,now:()=>clock});timings.attach(page,3);
 const request=()=>({url:()=>origin+'/rest/v1/rpc/v1_me?secret=never-store',method:()=> 'POST',response:()=>({status:()=>200})});
 for(const duration of [10,20,100,999]){const r=request();page.emit('request',r);clock+=duration;page.emit('requestfinished',r);}
 const a=request(),b=request();page.emit('request',a);page.emit('request',b);timings.stop();
 const result=timings.summary();assert.deepEqual(result.contracts[0],{role:3,contract:'/rest/v1/rpc/v1_me',status:200,outcome:'completed_success',count:3,latency_samples:3,p50_ms:20,p95_ms:100,max_ms:100});assert.equal(result.dropped_samples,2);assert.equal(result.dropped_in_flight,1);assert.equal(result.in_flight,0);assert.equal(result.unfinished_requests,1);assert.equal(result.partial,true);assert.ok(!JSON.stringify(result).includes('never-store'));assert.equal(page.listenerCount('request'),0);
});

test('real browser timings wait for body completion and separate HTTP errors, cancellation and broken responses',async()=>{
 const secret='private-password-bearer-query-value';
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<main>Timing transport fixture</main>');return;}
  if(path.endsWith('v1_orders_list')){res.writeHead(200,{'content-type':'application/json'});res.write('{"result":');setTimeout(()=>res.end('true}'),90);return;}
  if(path.endsWith('v1_ratings_list')){const timer=setTimeout(()=>res.end('{}'),300);req.on('close',()=>clearTimeout(timer));return;}
  if(path.endsWith('v1_quote')){res.writeHead(200,{'content-type':'application/json','content-length':'100'});res.write('{');setTimeout(()=>res.destroy(),20);return;}
  res.writeHead(path.endsWith('v1_person_get')?403:200,{'content-type':'application/json'});res.end(JSON.stringify({secret}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const timings=createContractTimings({origin});
 try{const page=await browser.newPage();timings.attach(page,1);await page.goto(origin);await page.setRequestInterception(true);page.on('request',r=>void r.continue());
  await page.evaluate(async secret=>{for(const path of ['/rest/v1/rpc/v1_me','/rest/v1/rpc/v1_orders_list','/rest/v1/rpc/v1_person_get','/rest/v1/rpc/v1_quote','/functions/v1/squad-account/media/grants','/auth/v1/token','/storage/v1/object/sign/bucket/private']){try{await(await fetch(path+'?token='+secret,{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify({password:secret})})).text();}catch{}}const controller=new AbortController();setTimeout(()=>controller.abort(),20);try{await(await fetch('/rest/v1/rpc/v1_ratings_list?secret='+secret,{method:'POST',signal:controller.signal})).text();}catch{}},secret);
  await page.waitForNetworkIdle({idleTime:100,timeout:3000});timings.stop();const result=timings.summary();
  assert.equal(result.observed_requests,6);assert.equal(result.captured_samples,6);assert.equal(result.partial,false);
  const row=name=>result.contracts.find(r=>r.contract.endsWith(name));assert.equal(row('v1_me').outcome,'completed_success');assert.ok(row('v1_orders_list').p50_ms>=70,'Must include delayed response body');assert.equal(row('v1_person_get').status,403);assert.equal(row('v1_person_get').outcome,'completed_http_error');assert.equal(row('v1_ratings_list').outcome,'cancelled');assert.equal(row('v1_ratings_list').latency_samples,0);assert.equal(row('v1_quote').outcome,'failed');assert.equal(row('v1_quote').latency_samples,0);assert.equal(row('media/grants').outcome,'completed_success');
  const serialized=JSON.stringify(result);assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes('Bearer'));assert.ok(!serialized.includes('auth/v1'));assert.ok(!serialized.includes('storage/v1'));assert.ok(!serialized.includes('?'));
 }finally{timings.stop();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('passive timeline preserves overlap, cancellation, unfinished stop and the shared cap',()=>{
 const origin='https://project.supabase.co';let clock=1000;
 const page=new EventEmitter(),other=new EventEmitter(),timings=createContractTimings({origin,maxSamples:3,maxInFlight:3,now:()=>clock});timings.attach(page,11);timings.attach(other,4);
 const request=(name,error=null)=>({url:()=>origin+'/rest/v1/rpc/'+name+'?token=never-retain',method:()=> 'POST',response:()=>error?null:{status:()=>200},failure:()=>error?{errorText:error}:null});
 const first=request('v1_me'),second=request('v1_order_get','net::ERR_ABORTED'),third=request('v1_order_item_get');
 page.emit('request',first);clock=1010;page.emit('request',second);clock=1020;other.emit('request',third);
 clock=1030;page.emit('requestfailed',second);clock=1040;page.emit('requestfinished',first);
 clock=1050;timings.stop();timings.stop();const result=timings.summary();
 assert.equal(result.peak_tracked_in_flight,3);assert.equal(result.timeline.length,3);assert.deepEqual(result.timeline.map(s=>s.sequence),[1,2,3]);
 assert.deepEqual(result.timeline.map(s=>[s.start_ms,s.end_ms,s.tracked_in_flight_at_start,s.tracked_in_flight_after_end]),[[0,40,1,1],[10,30,2,2],[20,null,3,null]]);
 assert.equal(result.timeline[1].outcome,'cancelled');assert.equal(result.timeline[1].duration_ms,null);assert.equal(result.timeline[2].observed_until_ms,50);assert.equal(result.timeline[2].outcome,'unfinished');assert.equal(result.unfinished_requests,1);
 assert.equal(page.listenerCount('request'),0);assert.equal(other.listenerCount('request'),0);assert.ok(!JSON.stringify(result).includes('never-retain'));
 result.timeline[0].role=0;assert.equal(timings.summary().timeline[0].role,11,'Returned timeline cannot mutate retained measurements');
 const capped=createContractTimings({origin,maxSamples:1,maxInFlight:1,now:()=>clock});capped.attach(page,3);
 const a=request('v1_me'),b=request('v1_me');page.emit('request',a);page.emit('request',b);page.emit('requestfinished',a);page.emit('request',b);capped.stop();
 assert.equal(capped.summary().timeline.length,1);assert.equal(capped.summary().dropped_in_flight,1);assert.equal(capped.summary().dropped_samples,1);assert.equal(capped.summary().partial,true);
});
