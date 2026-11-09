/** Local rendered ownership guard only. No upload/command/provider/hosted calls. */
import {build} from 'esbuild';import puppeteer from 'puppeteer';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const root=process.cwd(),dir=await mkdtemp(path.join(tmpdir(),'squad-transfer-ownership-'));
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{SquadContext}from'${root}/apps/admin/src/squad/data/hooks.js';import TransfersPanel from '${root}/apps/admin/src/squad/features/administration/TransfersPanel.jsx';
const root=createRoot(document.getElementById('root'));let generation=0;
window.mount=(mode,canWrite)=>{window.commandCalls=0;const sdk={transfers:async()=>({data:[{id:'1',kind:'zones',state:'validated',total_rows:1,applied_rows:0,created_at:'2026-11-09T00:00:00Z'}],next_cursor:null}),transfer:async()=>({id:'1',kind:'zones',state:'validated',valid_rows:1,invalid_rows:0,applied_rows:0,version:'fixture:1',rows:{data:[{row:1,state:'valid',errors:[]}],next_cursor:null}}),reserveTransferUpload:()=>{window.commandCalls++;throw Error('Forbidden local command');},requestImport:()=>{window.commandCalls++;throw Error('Forbidden local command');}};const n=++generation;root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SquadContext.Provider value={{sdk,scope:'ownership-'+n,identity:{id:'1',role:0},canWrite,writeState:{mode,allowed:canWrite}}}><main data-generation={n}><TransfersPanel key={n} sdk={sdk} canWrite={canWrite}/></main></SquadContext.Provider></QueryClientProvider>);return n;};`;
let browser;
try{
 await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},outfile:path.join(dir,'app.js'),bundle:true,jsx:'automatic',format:'iife',platform:'browser',alias:{'@':path.join(root,'apps/admin/src'),'react':path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},logLevel:'silent'});
 await writeFile(path.join(dir,'index.html'),'<meta charset="utf-8"><div id="root"></div><script src="app.js"></script>');
 browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('file://'+path.join(dir,'index.html'));
 assert.deepEqual(errors,[]);const checks=[];
 for(const [mode,canWrite]of[['mirror',false],['test',true],['native',false],['native',true]]){
  const generation=await page.evaluate(({mode,canWrite})=>window.mount(mode,canWrite),{mode,canWrite});await page.waitForFunction(n=>document.querySelector('main')?.dataset.generation===String(n)&&!!document.querySelector('tbody button'),{},generation);
  const permitted=mode==='native'&&canWrite;
  assert.equal(await page.$eval('input[type=file]',n=>n.disabled),!permitted);
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('Bulk imports become available when this environment owns its business data. The current mirror remains protected.')),!permitted);
  await page.$eval('tbody button',n=>n.click());await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='Apply validated import'));
  for(const label of['Apply validated import','Cancel import'])assert.equal(await page.evaluate(label=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===label).disabled,label),!permitted);
  assert.equal(await page.evaluate(()=>window.commandCalls),0);checks.push(mode+':'+(canWrite?'write':'readonly'));console.log('PASS '+checks.at(-1)+' rendered CSV ownership controls');
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,commands:0,hosted:false}));
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
