/** Six exact UI reads, never a retry-to-pass loop or direct browser fetch. */
import assert from 'node:assert/strict';
import {measureBrowserRead} from './web-read-performance-hosted-journey.mjs';
export async function diagnoseWorkerBrowser({page,base,orderId}){
 assert.match(base,/^http:\/\/localhost:\d+$/);assert.match(String(orderId),/^[1-9]\d*$/);
 const samples=[],path=`/squad/job-work/${orderId}`;
 for(let index=0;index<6;index++){
  try{
   const sample=await measureBrowserRead(page,{name:'v1_order_get',timeoutMs:15000,
    matches:p=>String(p.p_id)===String(orderId)&&p.p_item_cursor===null&&p.p_item_limit===25,
    validate:r=>{assert.equal(r.id,String(orderId));assert.ok(Array.isArray(r.items?.data)&&r.items.data.length===1);assert.ok(!Object.hasOwn(r,'total_amount'));return r.items.data.length;},
    action:async()=>{await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForSelector('.squad-app',{timeout:15000});assert.equal(new URL(page.url()).pathname,path);}});
   samples.push({index,outcome:'completed',...sample});
  }catch(error){samples.push({index,outcome:'failed',error_type:['AssertionError','TimeoutError','AbortError'].includes(error?.name)?error.name:'Error'});}
 }
 const repeated=samples.slice(1),complete=repeated.every(s=>s.outcome==='completed'),p95=complete?Math.max(...repeated.map(s=>s.duration_ms)):null;
 return {format:'squad-worker-browser-diagnostic/v1',environment:'staging',role:11,contract:'/rest/v1/rpc/v1_order_get',samples,
  all_requests_completed:samples.every(s=>s.outcome==='completed'),repeat_p95_ms:p95,target_ms:2000,target_met:complete&&p95<=2000,application_mutations:0,
  measurement:'Actual application navigation and exact bounded order read through full browser response receipt. Six observations, including failures; no retry, direct fetch or business command.',
  fixture_limit:'Original persona fixture has one item/quantity, no product and both factory and Worker assignment. This isolates the existing read contract; it is not the failed commercial graph or a capacity benchmark.'};
}
