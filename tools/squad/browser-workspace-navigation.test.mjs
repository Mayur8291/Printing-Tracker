import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer';
import {navigateWorkspace} from './browser-workspace-navigation.mjs';
test('real Chrome delayed shell, history restore and exact-route failures produce bounded safe evidence',async()=>{
 let conditionalRequests=0;const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.endsWith('/cached')&&req.headers['if-none-match']==='\"fixture-v1\"'){conditionalRequests++;res.writeHead(304,{'etag':'\"fixture-v1\"','cache-control':'no-cache'});res.end();return;}
  res.writeHead(200,{'content-type':'text/html','cache-control':path.endsWith('/cached')?'no-cache':'max-age=600',...(path.endsWith('/cached')?{'etag':'\"fixture-v1\"'}:{})});
  if(path.endsWith('/redirect'))res.end('<script>location.replace("/squad/job-work/old?token=PRIVATE")</script>');
  else if(path.endsWith('/missing'))res.end('<p>Opening workspace</p>');
  else res.end('<html><body><p>Opening workspace</p><script>setTimeout(()=>{document.body.innerHTML="<main class=\\"squad-app\\">Workspace</main>"},'+(path.endsWith('/delayed')?150:0)+');</script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage();await navigateWorkspace(page,base,'/squad/job-work/cached',{timeout:3000});await navigateWorkspace(page,base,'/squad/job-work/cached',{timeout:3000});assert.ok(conditionalRequests>=1,'Browser must actually revalidate cached document with304');
  await navigateWorkspace(page,base,'/squad/job-work/first',{timeout:3000});
  await navigateWorkspace(page,base,'/squad/job-work/delayed',{timeout:3000});assert.equal(new URL(page.url()).pathname,'/squad/job-work/delayed');
  await page.goBack({waitUntil:'domcontentloaded'});assert.equal(new URL(page.url()).pathname,'/squad/job-work/first');
  await navigateWorkspace(page,base,'/squad/job-work/next',{timeout:3000});
  // Match the harness: multiple isolated persona contexts, with the target tab backgrounded.
  const contexts=[];for(let i=0;i<10;i++){const context=await browser.createBrowserContext();contexts.push(context);const other=await context.newPage();await navigateWorkspace(other,base,'/squad/job-work/other',{timeout:3000});}
  await navigateWorkspace(page,base,'/squad/job-work/background',{timeout:3000});assert.equal(await page.evaluate(()=>document.visibilityState),'visible');assert.equal(new URL(page.url()).pathname,'/squad/job-work/background');
  for(const context of contexts)await context.close();
  const foreground=await page.browserContext().newPage();await foreground.bringToFront();await navigateWorkspace(page,base,'/squad/job-work/background-delayed',{timeout:3000});assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');await foreground.close();
  for(const path of['/squad/job-work/missing','/squad/job-work/redirect']){
   let caught;try{await navigateWorkspace(page,base,path,{timeout:500});}catch(error){caught=error;}
   assert.ok(caught);const trace=caught.navigationTrace;assert.equal(trace.requested_path,path);assert.equal(trace.response_status,200);assert.ok(trace.events.length<=8);assert.ok(trace.elapsed_ms>=450&&trace.elapsed_ms<4000);assert.equal(JSON.stringify(trace).includes('PRIVATE'),false);
   assert.equal(trace.actual_path,path.endsWith('redirect')?'/squad/job-work/old':path);assert.equal(trace.app_present,path.endsWith('redirect'));
  }
  assert.equal(page.listenerCount('framenavigated'),0);assert.equal(page.listenerCount('requestfailed'),0);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('real Chrome preserves exact allowed task order query and rejects dropped or changed filters',async()=>{
 let requests=0;
 const server=createServer((req,res)=>{
  requests++;const url=new URL(req.url,'http://localhost');
  if(url.search==='?order_id=700002'||url.search==='?order_id=700004'){
   res.writeHead(302,{location:url.search==='?order_id=700002'?'/squad/tasks?order_id=700003':'/squad/tasks'});res.end();return;
  }
  res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<main class="squad-app">Tasks</main>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage();
  await navigateWorkspace(page,base,'/squad/tasks?order_id=700001',{timeout:3000});
  assert.equal(page.url(),base+'/squad/tasks?order_id=700001');
  for(const id of['700002','700004']){
   let caught;try{await navigateWorkspace(page,base,'/squad/tasks?order_id='+id,{timeout:500});}catch(error){caught=error;}
   assert.ok(caught,'A changed or dropped query must not satisfy exact route readiness');
   const trace=caught.navigationTrace;assert.equal(trace.requested_path,'/squad/tasks');assert.equal(trace.actual_path,'/squad/tasks');assert.equal(trace.app_present,true);
   assert.ok(trace.elapsed_ms>=450&&trace.elapsed_ms<4000);assert.doesNotMatch(JSON.stringify(trace),/70000[1-4]|order_id|\?/);
  }
  const before=requests;
  for(const route of['/squad/tasks?order_id=0','/squad/tasks?order_id=-1','/squad/tasks?order_id=01','/squad/tasks?order_id=1&extra=2','/squad/tasks?order_id=1&order_id=2','/squad/tasks?order_id=1#fragment','/squad/tasks?order_id=%31','/squad/orders?order_id=1']){
   await assert.rejects(navigateWorkspace(page,base,route),{message:'Unsupported workspace route'});
  }
  assert.equal(requests,before,'Invalid query routes must be rejected before any browser request');
  assert.equal(page.listenerCount('framenavigated'),0);assert.equal(page.listenerCount('requestfailed'),0);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
