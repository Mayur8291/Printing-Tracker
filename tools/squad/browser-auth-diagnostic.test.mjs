import assert from 'node:assert/strict';
import http from 'node:http';
import {observeAuthDiagnostic,authDiagnosticContract,AUTH_LOCK} from './browser-auth-diagnostic.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH??='/tmp/squad-playwright-browsers-1.65.0';
const {firefox}=await import('/tmp/squad-playwright-1.65.0/node_modules/playwright/index.mjs');
const sockets=new Set();const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<title>Auth diagnostic local test</title>');}
 if(req.url.startsWith('/auth/v1/')){res.setHeader('Content-Type','application/json');res.writeHead(200);res.flushHeaders();res.write('{"ok":');if(req.url.includes('unfinished'))return;return setTimeout(()=>res.end('true}'),180);}
 res.writeHead(404);res.end();
});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await firefox.launch({headless:true});
try{
 const page=await browser.newPage(),observer=await observeAuthDiagnostic(page,{role:10,origin});
 await page.goto(origin);
 const value=await page.evaluate(async({lockName,origin})=>{
  const returnValue=await navigator.locks.request(lockName,async lock=>{if(lock.name!==lockName)throw new Error('Lock name changed');return 37;});
  let release;const held=navigator.locks.request(lockName,()=>new Promise(resolve=>{release=resolve;}));
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  const unavailable=await navigator.locks.request(lockName,{ifAvailable:true},lock=>lock===null);
  const controller=new AbortController(),pending=navigator.locks.request(lockName,{signal:controller.signal},()=>false);controller.abort();
  let aborted=false;try{await pending;}catch(e){aborted=e.name==='AbortError';}
  release();await held;
  const marker=new Error('same-error-object');let sameError=false;
  try{await navigator.locks.request(lockName,()=>{throw marker;});}catch(e){sameError=e===marker;}
  const payload=await (await fetch(origin+'/auth/v1/user?secret=DO_NOT_RECORD')).json();
  return {returnValue,unavailable,aborted,sameError,payload};
 },{lockName:AUTH_LOCK,origin});
 assert.deepEqual(value,{returnValue:37,unavailable:true,aborted:true,sameError:true,payload:{ok:true}});
 await page.evaluate(async({origin})=>{const c=new AbortController();const r=await fetch(origin+'/auth/v1/token?abort=1',{signal:c.signal});c.abort();try{await r.text();}catch{};},{origin});
 const pendingResponse=page.waitForResponse(r=>r.url()===origin+'/auth/v1/user?unfinished=1');pendingResponse.catch(()=>{});
 await page.evaluate(origin=>{fetch(origin+'/auth/v1/user?unfinished=1').then(r=>r.text()).catch(()=>{});},origin);await pendingResponse;
 const result=await observer.finish();
 const complete=result.requests.find(r=>r.outcome==='body_finished');assert.equal(complete.status,200);assert.ok(complete.end_ms>=complete.response_ms&&complete.response_ms>=complete.start_ms);
 const unfinished=result.requests.find(r=>r.outcome==='unfinished');assert.equal(unfinished.status,200);assert.ok(unfinished.response_ms!==null);assert.equal(unfinished.end_ms,null);
 assert.ok(result.locks.some(e=>e.kind==='unavailable'&&e.zero_wait));assert.ok(result.locks.some(e=>e.kind==='aborted'));assert.ok(result.locks.some(e=>e.kind==='callback_finished'));
 const text=JSON.stringify(result);assert.ok(!text.includes('DO_NOT_RECORD')&&!text.includes('same-error-object')&&!text.includes('?unfinished')&&!text.includes('127.0.0.1'));
 assert.equal(authDiagnosticContract('https://foreign.invalid/auth/v1/token'),null);
 console.log('PASS Firefox native lock return/null/error identity/abort preserved; request headers/body/unfinished timing and privacy');
 await page.close();
 const unhandled=await browser.newPage();await observeAuthDiagnostic(unhandled,{role:11,origin,maxEvents:2});await unhandled.goto(origin);
 const nativeEvent=unhandled.waitForFunction(()=>window.nativeUnhandled==='unaltered rejection');
 await unhandled.evaluate(lockName=>{window.addEventListener('unhandledrejection',event=>{window.nativeUnhandled=event.reason.message;});navigator.locks.request(lockName,()=>{throw new Error('unaltered rejection');});},AUTH_LOCK);
 await nativeEvent;await unhandled.close();console.log('PASS observer does not suppress genuine native unhandled rejection');
}finally{await browser.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
