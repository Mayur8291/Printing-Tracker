/** Optional read-only actual-browser probe. Not wired into the dispatcher until
 * the parent releases its current harness freeze. No app hooks or SDK writes. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
const READS=new Set(['v1_me','v1_person_get','v1_orders_list','v1_order_get','v1_catalog_tree']);
const round=value=>Math.round(value*100)/100;

/** Request payloads are inspected only to select the intended bounded read;
 * they and response contents never enter the returned timing record. */
export async function measureBrowserRead(page,{origin=ORIGIN,name,matches=()=>true,validate=()=>{},action,timeoutMs=45000}){
 assert.ok(READS.has(name));assert.equal(new URL(origin).origin,origin);
 let request,start,timer,settled=false;let resolve,reject;
 const done=new Promise((yes,no)=>{resolve=yes;reject=no;});done.catch(()=>{});
 function selected(candidate){if(request||settled)return;try{const url=new URL(candidate.url());if(url.origin!==origin||url.pathname!==`/rest/v1/rpc/${name}`||candidate.method()!=='POST')return;const payload=JSON.parse(candidate.postData()||'{}');if(!matches(payload))return;request=candidate;start=performance.now();}catch{settled=true;reject(new Error('Read performance request could not be validated'));}}
 async function complete(candidate){if(candidate!==request||settled)return;settled=true;const duration=round(performance.now()-start);try{const response=candidate.response();assert.ok(response&&response.status()>=200&&response.status()<300,'Read performance request did not complete successfully');const count=validate(await response.json());resolve({duration_ms:duration,status:response.status(),observed_rows:count??null});}catch(error){reject(error);}}
 function failed(candidate){if(candidate!==request||settled)return;settled=true;reject(new Error('Read performance request failed or was cancelled'));}
 page.on('request',selected);page.on('requestfinished',complete);page.on('requestfailed',failed);
 timer=setTimeout(()=>{settled=true;reject(new Error('Read performance request did not complete within its bounded timeout'));},timeoutMs);
 try{await action();return await done;}finally{clearTimeout(timer);page.off('request',selected);page.off('requestfinished',complete);page.off('requestfailed',failed);}
}
export function summarizeProbe(name,samples){
 assert.ok(READS.has(name)&&samples.length===6);const repeated=samples.slice(1).map(s=>s.duration_ms).sort((a,b)=>a-b);const p95=repeated[Math.ceil(repeated.length*.95)-1];
 return {role:3,contract:`/rest/v1/rpc/${name}`,first_observation_ms:samples[0].duration_ms,first_observation_warmth:'uncontrolled; not claimed cold',repeat_sample_count:5,repeat_durations_ms:samples.slice(1).map(s=>s.duration_ms),repeat_p50_ms:repeated[2],repeat_p95_ms:p95,repeat_max_ms:repeated.at(-1),target_ms:2000,target_met_for_observed_repeats:p95<=2000,statuses:samples.map(s=>s.status),observed_rows:samples.map(s=>s.observed_rows)};
}
export async function runJourney(ctx){
 assert.match(ctx.base,/^http:\/\/localhost:\d+$/);assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);
 const entry=ctx.clients.get(3);assert.equal(entry.me.role,3);assert.equal(entry.me.id,String(ctx.fixture.actors['3']));const page=await ctx.pageFor(3),customerId=entry.me.id,metrics=[];
 async function navigate(route){await page.goto(ctx.base+route,{waitUntil:'domcontentloaded'});await page.waitForSelector('.squad-app',{timeout:45000});assert.ok(!new URL(page.url()).pathname.includes('login'));}
 async function probe(name,route,matches,validate,trigger){const samples=[];for(let n=0;n<6;n++){
  if(trigger)await navigate(route);
  const sample=await measureBrowserRead(page,{name,matches,validate,action:()=>trigger?trigger():navigate(route)});samples.push(sample);
  // Resolve visible route state; no background retry, synthetic response or
  // browser-side direct fetch substitutes for the application's own read.
  await page.waitForSelector('.squad-app');
 }metrics.push(summarizeProbe(name,samples));}
 await probe('v1_me','/squad/home',()=>true,result=>{assert.equal(result.id,customerId);assert.equal(result.role,3);return 1;});
 await probe('v1_person_get','/squad/profile',p=>p.p_id===customerId,result=>{assert.equal(result.id,customerId);assert.equal(result.role,3);return 1;});
 await probe('v1_orders_list',`/squad/orders?customer_id=${customerId}`,p=>p.p_filters?.customer_id===customerId&&p.p_limit===30&&p.p_cursor===null,result=>{assert.ok(Array.isArray(result.data)&&result.data.length<=30);assert.ok(result.data.every(row=>row.customer_id===customerId));return result.data.length;});
 const term=ctx.fixture.label+' base';
 await probe('v1_catalog_tree','/squad/catalogue',p=>p.p_kind==='products'&&p.p_filters?.search===term&&p.p_limit===18&&p.p_cursor===null,result=>{assert.equal(result.data.length,1);assert.equal(result.data[0].id,String(ctx.fixture.ids.baseProductId));return 1;},async()=>{await page.waitForSelector('input[aria-label="Search products"]');await page.type('input[aria-label="Search products"]',term);await page.click('button[aria-label="Search"]');await page.waitForFunction(name=>[...document.querySelectorAll('article h2')].some(node=>node.textContent===name),{},term);});
 return {checks:['actual_customer_browser_own_identity_profile_scoped_order_list_and_exact_fixture_catalogue_reads','six_observations_each_with_five_repeats_and_complete_response_body_timing','no_business_mutations_no_bulk_seed_or_unbounded_pagination'],metrics,measured_requests:24,all_observed_repeat_targets_met:metrics.every(m=>m.target_met_for_observed_repeats),measurement:'Real browser request start through complete response-body receipt, including network/gateway/SQL/harness interception; no render-time or isolated SQL claim.',warmth:'Five repeated navigations/searches after each first observation. Browser resource cache and network connections may be reused; database and Edge warmth are not controlled. Treat as repeated-route observations, not a guaranteed warm SLA.',volume:'Existing exact-owned fixture only; own orders at most30, exact catalogue search1. Catalogue route also performs its ordinary bounded18-row initial list before search. No data inserts, provider requests or email actions.'};
}
