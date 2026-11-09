/** Real operations components/hooks, synthetic delayed SDK. No hosted requests. */
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'squad-operation-invalidation-'));
const candidate=process.env.SQUAD_OPERATION_CANDIDATE,baseline=process.argv.includes('--baseline'),expected=baseline?3:2;
const entry=`
import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{SquadContext}from'${root}/apps/admin/src/squad/data/hooks.js';
import JobWorkPage from'${root}/apps/admin/src/squad/features/jobWork/JobWorkPage.jsx';
import ProductionPage from'${root}/apps/admin/src/squad/features/production/ProductionPage.jsx';
import StockReconciliationPanel from'${root}/apps/admin/src/squad/features/stock/StockReconciliationPanel.jsx';
const mount=createRoot(document.getElementById('root'));const clone=x=>JSON.parse(JSON.stringify(x));
window.counts={};window.active=0;window.server={};
async function read(name,value){window.counts[name]=(window.counts[name]||0)+1;window.active++;const result=clone(value());await new Promise(r=>setTimeout(r,70));window.active--;return result;}
const sdk={
 order:()=>read('order',()=>({id:'12',version:'1:'+window.server.version,customer_id:'88',total_quantity:10,worker_id:'11',factory_manager_id:null,worker_due_change_allowed:!window.server.saved,due_on:'2026-12-01T00:00:00Z',items:{data:[{id:'41',version:'1:'+window.server.version,order_id:'12',type:0,worker_stage:2,total_quantity:10,quantities:[],progress:{}}],next_cursor:null}})),
 orderSection:()=>read('history',()=>({data:[],next_cursor:null,commitment:{original_due_at:'2026-12-01T00:00:00Z',reason:window.server.saved?'Verified new commitment':null,reason_basis:'recorded'}})),
 ratings:()=>read('ratings',()=>({data:[],next_cursor:null,summary:{count:0,valid_count:0,average:null,invalid_source_count:0}})),
 saveWorkerDue:async(...args)=>{window.command=args;window.server.saved=true;window.server.version++;return {version:'1:'+window.server.version};},
 cuttingDetail:()=>read('cutting',()=>({id:'41',version:'1:'+window.server.version,order_id:'12',product_id:'7',planned_quantity:10,quantities:{data:[{id:'1',size_name:'Medium',quantity:10,cut:window.server.cut,assigned:0,inspected:0,picked:0,dispatched:0,remaining:10-window.server.cut}],next_cursor:null},history:{data:[],next_cursor:null}})),
 productionProgress:()=>read('progress',()=>({id:'12',item_count:1,cut:window.server.cut,assigned:0,sewn:0,dispatched:0})),
 recordCutting:async(...args)=>{window.command=args;window.server.cut+=args[1][0].quantity;window.server.version++;return{version:'1:'+window.server.version};},
 people:()=>read('people',()=>({data:[{id:'10',name:'Dealer fixture'}],next_cursor:null})),
 reviewStock:()=>read('stock',()=>({data:[{id:'71',order_id:'12',size_id:'1',received:10,consumed:4,counter:window.server.counter,status:window.server.counter===4?'ready':'needs_reconciliation',safe_action:window.server.counter===4?null:'rebuild_counter',issues:window.server.counter===4?[]:['counter_mismatch'],version:'1:'+'a'.repeat(64)}],next_cursor:null,summary_scope:'current_page',requires_review:window.server.counter===4?0:1})),
 rebuildStockCounters:async(...args)=>{window.command=args;window.server.counter=4;return{state:'completed',repairs:[{id:'71'}]};}
};
window.mount=kind=>{window.counts={};window.active=0;window.command=null;window.server={version:0,saved:false,cut:0,counter:2};const role=kind==='job'?11:kind==='cutting'?9:0;const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.client=client;const identity={id:String(role),role,capabilities:{}};const props={sdk,identity,environment:'staging',canWrite:true,path:kind==='job'?'/squad/job-work/12':'/squad/production/cutting/41',onNavigate:p=>window.navigation=p};const Component=kind==='job'?JobWorkPage:kind==='cutting'?ProductionPage:StockReconciliationPanel;mount.render(<QueryClientProvider client={client}><SquadContext.Provider value={{sdk,identity,scope:'isolated-'+kind,canWrite:true,writeState:{mode:'native',allowed:true}}}><Component key={kind} {...props}/></SquadContext.Provider></QueryClientProvider>);};
`;
const files=['features/jobWork/JobWorkPage.jsx','features/production/ProductionPage.jsx','features/stock/StockPage.jsx','features/stock/StockReconciliationPanel.jsx'];
await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},outfile:path.join(scratch,'app.js'),bundle:true,jsx:'automatic',format:'iife',platform:'browser',alias:{'@':path.join(root,'apps/admin/src'),react:path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},plugins:candidate?[{name:'candidate-only',setup(b){b.onLoad({filter:/\/squad\/features\/.+\.jsx$/},async args=>{const relative=path.relative(path.join(root,'apps/admin/src/squad'),args.path);if(!files.includes(relative))return;return {contents:await fs.readFile(path.join(candidate,relative),'utf8'),loader:'jsx',resolveDir:path.dirname(args.path)};});}}]:[],logLevel:'silent'});
await fs.writeFile(path.join(scratch,'index.html'),'<html><body><div id="root"></div><script src="app.js"></script></body></html>');
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('file://'+path.join(scratch,'index.html'));
 const click=label=>page.evaluate(label=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label&&!e.disabled);if(!e)throw Error('Missing enabled control '+label);e.click();},label);
 const field=(label,value)=>page.evaluate((label,value)=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.replace(/\\s*\\*$/,'').trim()===label);const e=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},label,value);
 const settle=async()=>{await page.waitForFunction(()=>window.active===0&&!document.querySelector('[aria-busy=true]'));await new Promise(r=>setTimeout(r,150));await page.waitForFunction(()=>window.active===0);};
 await page.evaluate(()=>window.mount('job'));await page.waitForFunction(()=>document.body.textContent.includes('Update commitment'));await settle();assert.equal(await page.evaluate(()=>window.counts.order),1);
 await field('New due date','2026-12-02T12:00');await field('Reason for change','Verified new commitment');await click('Update commitment');await page.waitForFunction(()=>window.server.saved);await settle();assert.equal(await page.evaluate(()=>window.counts.order),expected);assert.ok(await page.evaluate(()=>document.body.textContent.includes('Your first due-date change is already recorded')));assert.ok(await page.evaluate(()=>document.body.textContent.includes('Verified new commitment')));assert.equal(await page.evaluate(()=>window.command[3].expectedVersion),'1:0');
 checks.push('actual JobWork due-save refreshes current version and history with measured detail count');
 await page.evaluate(()=>window.mount('cutting'));await page.waitForSelector('input[aria-label="Quantity for Medium"]');await settle();await page.type('input[aria-label="Quantity for Medium"]','2');await click('Record cutting');await page.waitForFunction(()=>window.server.cut===2);await settle();assert.equal(await page.evaluate(()=>window.counts.cutting),expected);assert.equal(await page.evaluate(()=>window.counts.progress),2);assert.equal(await page.$eval('input[aria-label="Quantity for Medium"]',e=>e.value),'');assert.equal(await page.evaluate(()=>window.command[3].expectedVersion),'1:0');
 checks.push('actual cutting command refreshes detail and sibling progress, retaining quantity reset and expected version');
 await click('Refresh');await settle();assert.equal(await page.evaluate(()=>window.counts.cutting),expected+1);checks.push('explicit user Refresh still reads current detail');
 await page.evaluate(()=>window.mount('stock'));await page.waitForSelector('select[aria-label="Dealer"] option[value="10"]');await page.select('select[aria-label="Dealer"]','10');await page.waitForFunction(()=>document.body.textContent.includes('Review correction'));await settle();await click('Review correction');await page.waitForSelector('[role="dialog"] textarea');await page.type('[role="dialog"] textarea','Verified consumed counter');await click('Rebuild counter');await page.waitForFunction(()=>window.server.counter===4);await settle();assert.equal(await page.evaluate(()=>window.counts.stock),expected);assert.equal(await page.$('[role="dialog"]'),null);assert.ok(await page.evaluate(()=>document.body.textContent.includes('No correction needed')));assert.equal(await page.evaluate(()=>window.command[0]),'10');assert.equal(await page.evaluate(()=>window.command[1][0].id),'71');
 checks.push('actual stock reconciliation refreshes current counter, closes confirmation and preserves exact selected receipt');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',baseline,expected_detail_reads:expected,checks}));
}finally{await browser.close();await fs.rm(scratch,{recursive:true,force:true});}
