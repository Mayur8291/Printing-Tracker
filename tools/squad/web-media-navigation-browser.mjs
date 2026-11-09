/** Real React + Chromium/WebKit regression. All grants and bytes are synthetic;
 * every remote request is intercepted. WebKit is not native Safari. */
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH??='/tmp/squad-playwright-browsers-1.65.0';
const playwright=await import(pathToFileURL('/tmp/squad-playwright-1.65.0/node_modules/playwright/index.mjs').href);
const root=process.cwd();
const bytes=fs.readFileSync(path.join(root,'apps/admin/public/brand-logo.png'));
// Real attachment transport is necessary: WebKit route.fulfill does not emit
// its download event for an intercepted Content-Disposition response.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'squad-media-nav-'));fs.chmodSync(temporary,0o700);
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temporary,'key.pem'),'-out',path.join(temporary,'cert.pem'),'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
let compiled,mediaNavigations=0;
const app=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url==='/app.js'?'application/javascript':'text/html'});res.end(req.url==='/app.js'?compiled.outputFiles[0].text:'<meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>');});
const storage=https.createServer({key:fs.readFileSync(path.join(temporary,'key.pem')),cert:fs.readFileSync(path.join(temporary,'cert.pem'))},(req,res)=>{const u=new URL(req.url,'https://localhost');if(!u.pathname.startsWith('/storage/v1/object/sign/canto-media/')){res.writeHead(404);res.end();return;}if(u.pathname.endsWith('synthetic.png'))mediaNavigations++;res.writeHead(200,{'Content-Type':'image/png',...(u.searchParams.has('download')?{'Content-Disposition':'attachment; filename="synthetic.png"'}:{})});res.end(bytes);});
await Promise.all([new Promise(resolve=>app.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>storage.listen(0,'127.0.0.1',resolve))]);
const base='http://127.0.0.1:'+app.address().port,origin='https://127.0.0.1:'+storage.address().port;
try{
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{SquadContext}from'${root}/apps/admin/src/squad/data/hooks.js';import{MediaViewer}from'${root}/apps/admin/src/squad/components/Media.jsx';
const origin=${JSON.stringify(origin)};window.calls=[];window.mode='ready';
const sdk={mediaGrants:async(refs,options)=>{window.calls.push(options);await new Promise(resolve=>window.release=resolve);if(window.mode==='error')throw Error('Fixture grant denied');return{references:refs.map(ref=>({...ref,record_id:window.mode==='wrong-reference'?'99':ref.record_id,status:window.mode==='missing'?'missing':'ready',content_type:'image/png',url:(window.mode==='foreign'?'https://foreign.invalid':origin)+'/storage/v1/object/sign/canto-media/synthetic.png?token=synthetic'+(options.download&&window.mode!=='inline'?'&download=':'')}))};}};
let gesture=false;document.addEventListener('click',event=>{if(event.isTrusted){gesture=true;setTimeout(()=>gesture=false,0);}else if(event.target?.closest?.('a')?.target==='_blank'&&!gesture){event.preventDefault();}},true);const open=window.open.bind(window);window.popupAttempts=[];window.open=(...args)=>{window.popupAttempts.push({duringGesture:gesture});return !gesture||window.blockPopup?null:open(...args);};
function App(){const[shown,setShown]=React.useState(true),[scope,setScope]=React.useState('A'),[id,setId]=React.useState('1');window.hide=()=>setShown(false);window.changeScope=()=>setScope('B');window.changeReference=()=>setId('2');const ref={resource:'promotions',record_id:id,field:'link'},grant={...ref,status:'ready',content_type:'image/png',url:origin+'/storage/v1/object/sign/canto-media/preview.png?token=synthetic'};return <SquadContext.Provider value={{sdk,scope,environment:'staging'}}>{shown&&<MediaViewer reference={ref} grant={grant} label="Synthetic media"/>}</SquadContext.Provider>;}
createRoot(document.getElementById('root')).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider></React.StrictMode>);`;
compiled=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},write:false,bundle:true,jsx:'automatic',format:'iife',platform:'browser',alias:{'@':root+'/apps/admin/src',react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':JSON.stringify({VITE_SUPABASE_URL_STAGING:origin})},logLevel:'silent'});
for(const engine of (process.env.MEDIA_TEST_ENGINE?[process.env.MEDIA_TEST_ENGINE]:['chromium','webkit'])){
 const browser=await playwright[engine].launch({headless:true,...engine==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{}});
 try{
  const context=await browser.newContext({acceptDownloads:true,ignoreHTTPSErrors:true});mediaNavigations=0;const errors=[];
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if([base,origin].includes(u.origin))return route.continue();throw Error('Unexpected remote request in isolated media test');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function reset(mode='ready'){await page.goto(base);await page.getByRole('button',{name:'Download',exact:true}).waitFor();await page.evaluate(m=>{window.mode=m;},mode);}
  async function release(){await page.waitForFunction(()=>typeof window.release==='function');await page.evaluate(()=>{window.release();});}
  // The original async target=_blank implementation fails here: no permitted
  // popup exists after the promise boundary. A real attachment must download.
  await reset();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();await release();const download=await downloadPromise.catch(async error=>{console.log(JSON.stringify({engine,stage:'download',path:new URL(page.url()).pathname,pages:context.pages().length,mediaNavigations,state:await page.evaluate(()=>({alerts:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent),attempts:window.popupAttempts,calls:window.calls,anchors:document.querySelectorAll('a').length}))}));throw error;});
  assert.equal(download.suggestedFilename(),'synthetic.png');assert.deepEqual(fs.readFileSync(await download.path()),bytes);await download.delete();assert.equal(page.url(),base+'/');assert.equal(context.pages().length,1);assert.deepEqual(await page.evaluate(()=>window.popupAttempts),[]);assert.deepEqual(await page.evaluate(()=>window.calls),[{download:true}]);
  await reset();const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Open',exact:true}).click();const popup=await popupPromise;assert.equal(popup.url(),'about:blank');assert.equal(await popup.evaluate(()=>opener===null),true);await release();await popup.waitForURL(u=>u.pathname.endsWith('/synthetic.png'));assert.equal(new URL(popup.url()).searchParams.has('download'),false);assert.deepEqual(await page.evaluate(()=>window.popupAttempts),[{duringGesture:true}]);await popup.close();
  await reset();await page.evaluate(()=>window.blockPopup=true);await page.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('alert').filter({hasText:'blocked'}).waitFor();assert.deepEqual(await page.evaluate(()=>window.calls),[]);assert.equal(context.pages().length,1);
  for(const mode of ['error','missing','foreign','inline','wrong-reference']){
   await reset(mode);const before=mediaNavigations;await page.getByRole('button',{name:'Download',exact:true}).click();await release();await page.getByRole('alert').waitFor();assert.equal(mediaNavigations,before);assert.equal(page.url(),base+'/');assert.equal(context.pages().length,1);assert.equal(await page.getByRole('button',{name:'Download',exact:true}).isEnabled(),true);assert.equal(await page.locator('a').count(),0);
  }
  await reset('error');const deniedPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'Open',exact:true}).click();const denied=await deniedPopup;await release();await page.getByRole('alert').waitFor();if(!denied.isClosed())await denied.waitForEvent('close');assert.equal(context.pages().length,1);
  for(const cancel of ['hide','changeScope','changeReference']){
   await reset();const before=mediaNavigations,pendingPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'Open',exact:true}).click();const pending=await pendingPopup;await page.evaluate(fn=>window[fn](),cancel);if(!pending.isClosed())await pending.waitForEvent('close');await release();await page.waitForTimeout(30);assert.equal(mediaNavigations,before);assert.equal(context.pages().length,1);
  }
  await reset();const changedPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'Open',exact:true}).click();const changed=await changedPopup;await changed.goto(base+'/user-choice');const beforeChanged=mediaNavigations;await release();await page.getByRole('alert').filter({hasText:'closed or changed'}).waitFor();assert.equal(changed.isClosed(),false);assert.equal(new URL(changed.url()).pathname,'/user-choice');assert.equal(mediaNavigations,beforeChanged);await changed.close();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,checks:13,attachmentBytes:bytes.length,errors:0,remoteRequests:0,transport:'real local HTTPS attachment'}));await context.close();
 }finally{await browser.close();}
}

}finally{await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>storage.close(r))]);fs.rmSync(temporary,{recursive:true,force:true});}
