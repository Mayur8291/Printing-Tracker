/** Actual shared React form/primitive smoke, local fixtures only; no network API. */
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH??='/tmp/squad-playwright-browsers-1.65.0';
const {firefox,webkit}=await import('/tmp/squad-playwright-1.65.0/node_modules/playwright/index.mjs');
const root=path.resolve(import.meta.dirname,'../..'),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'squad-cross-local-'));
const assets=await fs.readdir(path.join(root,'apps/admin/dist/assets')),css=assets.filter(n=>n.endsWith('.css'));
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{CommandDialog,Field,PageHeader,SectionCard}from'${root}/apps/admin/src/squad/components/index.jsx';import{Input}from'${root}/apps/admin/src/components/ui/input';import{Button}from'${root}/apps/admin/src/components/ui/button';function App(){const[open,setOpen]=useState(false);return <main className="squad-app" style={{padding:16}}><PageHeader title="Workspace form review" description="Local browser acceptance fixture"/><SectionCard title="Profile"><Field label="Display name"><Input defaultValue="Local reviewer"/></Field><Button onClick={()=>setOpen(true)}>Open form</Button></SectionCard><CommandDialog open={open} onOpenChange={setOpen} title="Edit account" description="Local fixture; no saved changes." onSubmit={()=>{throw Error('Must never submit')}}><Field label="Full name" required><Input defaultValue="Local reviewer"/></Field><Field label="Phone"><Input type="tel"/></Field></CommandDialog></main>};createRoot(document.getElementById('root')).render(<App/>);`;
await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},outfile:path.join(scratch,'app.js'),bundle:true,jsx:'automatic',format:'iife',platform:'browser',alias:{'@':path.join(root,'apps/admin/src'),'react':path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},logLevel:'silent'});
const html=`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(n=>`<link rel="stylesheet" href="/assets/${n}">`).join('')}<style>html,body,#root{height:auto!important;overflow:auto!important}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const server=http.createServer(async(req,res)=>{try{const p=req.url.split('?')[0];if(p==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else if(p==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(scratch,'app.js')));}else if(css.some(n=>p===`/assets/${n}`)){res.setHeader('Content-Type','text/css');res.end(await fs.readFile(path.join(root,'apps/admin/dist',p)));}else{res.statusCode=404;res.end();}}catch{res.statusCode=500;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,results=[];
try{for(const [name,engine]of Object.entries({firefox,webkit})){
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:360,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  const input=page.getByLabel('Display name',{exact:true});await input.fill('Keyboard reviewer');assert.equal(await input.inputValue(),'Keyboard reviewer');
  const trigger=page.getByRole('button',{name:'Open form',exact:true});await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[role=dialog]')).opacity==='1');
  assert.equal(await dialog.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1}),true);
  await page.getByRole('textbox',{name:'Full name',exact:true}).fill('Edited locally');for(let i=0;i<16;i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true);
  await page.screenshot({path:`/tmp/squad-${name}-dialog-360.png`});await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.textContent==='Open form');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  results.push({engine:name,version:browser.version(),viewport:360,checks:['label_association','controlled_input_edit','keyboard_open','dialog_bounds','tab_trap','escape','trigger_focus_return','no_horizontal_overflow','no_javascript_error']});
 }finally{await browser.close();}
}console.log(JSON.stringify({passed:true,hosted:false,results}));}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(scratch,{recursive:true,force:true});}
