/** Actual React category paging/date filtering against local intercepted reads. */
import {build} from 'esbuild';import puppeteer from 'puppeteer';import assert from 'node:assert/strict';import {applyOwnedPromotionFilters} from './web-content-media-hosted-journey.mjs';
const root=process.cwd(),base='http://localhost:41777',category='SQB owned content',day='2026-11-09';
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{SquadContext}from'${root}/apps/admin/src/squad/data/hooks.js';import PromotionsPage from'${root}/apps/admin/src/squad/features/promotions/PromotionsPage.jsx';
const sdk={promotions:async(filters,page={})=>(await fetch('/rest/v1/rpc/v1_promotions_list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_filters:filters,p_cursor:page.cursor??null,p_limit:page.limit})})).json(),mediaGrants:async()=>({references:[]})};const props={sdk,identity:{id:'3',role:3,capabilities:{promotions:true,catalogue:true}},environment:'staging',canWrite:false};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SquadContext.Provider value={{...props,scope:'local-promotion'}}><main id="squad-main"><PromotionsPage {...props}/></main></SquadContext.Provider></QueryClientProvider>);`;
const compiled=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},write:false,bundle:true,jsx:'automatic',format:'iife',platform:'browser',alias:{'@':root+'/apps/admin/src','react':root+'/node_modules/react','react-dom':root+'/node_modules/react-dom'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},logLevel:'silent'});
const browser=await puppeteer.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage(),calls=[],errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
 page.on('request',request=>{
  const u=new URL(request.url());
  if(u.origin!==base)return void request.abort();
  if(u.pathname==='/')return void request.respond({status:200,contentType:'text/html',body:'<meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>'});
  if(u.pathname==='/app.js')return void request.respond({status:200,contentType:'application/javascript',body:compiled.outputFiles[0].text});
  if(u.pathname==='/rest/v1/rpc/v1_promotions_list'){
   const b=JSON.parse(request.postData());calls.push(b);let result;
   if(b.p_filters.mode==='categories')result=b.p_cursor?{data:[{category}],next_cursor:null}:{data:[{category:'A foreign same-day category'}],next_cursor:'next-local'};
   else if(b.p_filters.category===category&&b.p_filters.upload_date===day)result={data:[{id:'300',name:'Owned ready PNG',category,upload_date:day},{id:'301',name:'Owned missing PNG',category,upload_date:day}],next_cursor:null};
   else result={data:Array.from({length:12},(_,i)=>({id:String(i),name:'Foreign same-day '+i,category:'A foreign same-day category',upload_date:day})),next_cursor:'foreign-page'};
   return void request.respond({status:200,contentType:'application/json',body:JSON.stringify(result)});
  }
  return void request.respond({status:404,body:''});
 });
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('main form select')&&!document.querySelector('main form select').disabled&&document.body.textContent.includes('Foreign same-day 11'));
 const result=await applyOwnedPromotionFilters(page,{category,uploadDate:day},{origin:base});assert.deepEqual(result.data.map(r=>r.id),['300','301']);
 await page.waitForFunction(()=>document.body.textContent.includes('Owned ready PNG')&&!document.body.textContent.includes('Foreign same-day 0'));
 assert.deepEqual(calls.filter(c=>c.p_filters.mode==='categories').map(c=>c.p_cursor),[null,'next-local']);
 assert.deepEqual(calls.at(-1).p_filters,{category,upload_date:day});assert.deepEqual(errors,[]);
 console.log('PASS actual category paging + date submission excludes twelve unrelated same-day rows');
}finally{await browser.close();}
