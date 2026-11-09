import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {classifyBrowserErrors,observeBrowserErrors,EXPECTED_STAGING_LOCK_MESSAGE} from './browser-error-observer.mjs';
const require=createRequire(import.meta.url),{build}=require('esbuild');
process.env.PLAYWRIGHT_BROWSERS_PATH??='/tmp/squad-playwright-browsers-1.65.0';
const playwright=await import('/tmp/squad-playwright-1.65.0/node_modules/playwright/index.mjs');
const lock='lock:sb-scvojtvgnkmbupvyslmb-auth-token';
const script=(await build({stdin:{contents:`import {navigatorLock} from ${JSON.stringify(process.cwd()+'/node_modules/@supabase/auth-js/src/lib/locks.ts')};
window.probe=async mode=>{let release,held;const ready=new Promise(r=>held=r);const holder=navigator.locks.request(${JSON.stringify(lock)},async()=>{held();await new Promise(r=>release=r)});await ready;
const attempt=mode==='unrelated'?navigator.locks.request(${JSON.stringify(lock)},{ifAvailable:true},async()=>{throw Error('Unrelated caught failure')}):navigatorLock(${JSON.stringify(lock)},0,async()=>{});
if(mode==='uncaught'){window.pendingAttempt=attempt;}else try{await attempt;}catch(e){window.caught={message:e.message,acquire:e.isAcquireTimeout===true};}
release();await holder;window.probeDone=true;
};`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Error observer test</title><script>'+script+'</script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let count=0;const ok=label=>{count++;console.log('PASS '+label);};
try{
 const browser=await playwright.firefox.launch({headless:true});
 try{for(const mode of ['caught','uncaught','unrelated','window-error']){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   const observer=await observeBrowserErrors(page,{engine:'firefox'});
   await page.goto('http://127.0.0.1:'+server.address().port);
   if(mode==='window-error')await page.evaluate(message=>{setTimeout(()=>{throw Error(message);},0);},EXPECTED_STAGING_LOCK_MESSAGE);
   else{await page.evaluate(mode=>{void window.probe(mode);},mode);await page.waitForFunction(()=>window.probeDone===true);}
   await page.waitForTimeout(100);
   const result=await observer.finish(true);
   if(mode==='caught'){
    assert.equal((await page.evaluate(()=>window.caught)).acquire,true);
    assert.ok(result.pageErrors.some(e=>e.message===EXPECTED_STAGING_LOCK_MESSAGE));
    assert.deepEqual(result.nativeErrors,[]);assert.deepEqual(result.errors,[]);assert.ok(result.expectedCaughtLockDiagnostics.length>0);
   }else{
    assert.ok(result.errors.length>0);assert.deepEqual(result.expectedCaughtLockDiagnostics,[]);
    if(mode==='uncaught')assert.ok(result.nativeErrors.some(e=>e.source==='unhandled_rejection'&&e.message===EXPECTED_STAGING_LOCK_MESSAGE));
    if(mode==='window-error')assert.ok(result.nativeErrors.some(e=>e.source==='window_error'&&e.message===EXPECTED_STAGING_LOCK_MESSAGE));
    if(mode==='unrelated'){assert.deepEqual(result.nativeErrors,[]);assert.ok(result.errors.some(e=>e.message==='Unrelated caught failure'));}
   }
   ok('actual Firefox locked navigator '+mode);
  }finally{await context.close();}
 }}finally{await browser.close();}
 const error={name:'Error',message:EXPECTED_STAGING_LOCK_MESSAGE};
 for(const engine of ['chromium','webkit']){
  assert.deepEqual(classifyBrowserErrors({engine,pageErrors:[error],nativeErrors:[],completed:true}).errors,[error]);ok(engine+' never classifies the Firefox artifact');
 }
 assert.deepEqual(classifyBrowserErrors({engine:'firefox',pageErrors:[error],nativeErrors:[],completed:false}).errors,[error]);ok('incomplete authentication/navigation journey remains failed');
 const wrong={...error,message:EXPECTED_STAGING_LOCK_MESSAGE.replace('scvojtvgnkmbupvyslmb','different-project')};
 assert.deepEqual(classifyBrowserErrors({engine:'firefox',pageErrors:[wrong],nativeErrors:[],completed:true}).errors,[wrong]);ok('other project lock remains failed');
 console.log(JSON.stringify({passed:count,scope:'Local actual Firefox native locks plus strict classifier negatives; no hosted application or credentials'}));
}finally{await new Promise(r=>server.close(r));}
