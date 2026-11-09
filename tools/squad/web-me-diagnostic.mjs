/** Parent-owned, read-only diagnostic. Requires an already authenticated Customer
 * page; does not log in, seed data, send mail, or change the frozen dispatcher. */
import assert from 'node:assert/strict';
import {measureBrowserRead} from './web-read-performance-hosted-journey.mjs';
const ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
const round=value=>Math.round(value*100)/100;
export async function diagnoseMeBrowser({page,base,expectedUserId}){
 assert.match(base,/^http:\/\/localhost:\d+$/);assert.match(String(expectedUserId),/^[1-9]\d*$/);
 const samples=[];
 for(let index=0;index<6;index++){
  let timing=null,selectedRequest=null;
  const selected=request=>{try{const u=new URL(request.url());if(!selectedRequest&&u.origin===ORIGIN&&u.pathname==='/rest/v1/rpc/v1_me'&&request.method()==='POST')selectedRequest=request;}catch{}};
  const observed=response=>{
   try{if(response.request()!==selectedRequest)return;
    const source=response.timing();if(source){timing={};for(const key of ['dnsStart','dnsEnd','connectStart','connectEnd','sslStart','sslEnd','sendStart','sendEnd','receiveHeadersStart','receiveHeadersEnd'])if(Number.isFinite(source[key]))timing[key]=round(source[key]);}
   }catch{/* Transport timings are optional; missing timing never implies zero latency. */}
  };
  page.on('request',selected);page.on('response',observed);
  try{
   const sample=await measureBrowserRead(page,{name:'v1_me',timeoutMs:15000,validate:result=>{assert.equal(result.id,String(expectedUserId));assert.equal(result.role,3);return 1;},action:async()=>{
    await page.goto(base+'/squad/home',{waitUntil:'domcontentloaded',timeout:15000});
    await page.waitForSelector('.squad-app',{timeout:15000});
    assert.equal(new URL(page.url()).pathname,'/squad/home');
   }});
   samples.push({index, outcome:'completed',...sample,transport_timing_ms:timing});
  }catch(error){samples.push({index,outcome:'failed',error_type:['AssertionError','TimeoutError','AbortError'].includes(error?.name)?error.name:'Error',transport_timing_ms:timing});}
  finally{page.off('request',selected);page.off('response',observed);}
 }
 const repeated=samples.slice(1),complete=repeated.every(x=>x.outcome==='completed');
 const sorted=complete?repeated.map(x=>x.duration_ms).sort((a,b)=>a-b):[];
 return {format:'squad-me-browser-diagnostic/v1',environment:'staging',role:3,contract:'/rest/v1/rpc/v1_me',samples,
  repeat_sample_count:5,repeat_p95_ms:complete?sorted.at(-1):null,target_ms:2000,target_met:complete&&sorted.at(-1)<=2000,
  all_requests_completed:samples.every(x=>x.outcome==='completed'),
  measurement:'Actual browser request event through full response receipt. Relative Chromium transport timing is optional, excludes response body time, and is not isolated SQL timing.',
  warmth:'First and five repeated route navigations; network, database and gateway warmth uncontrolled. Failed samples are retained and never enter successful percentiles.',
  application_mutations:0};
}
