/** Authenticated browser reporting + queued document journey. The root owns
 * fixture identity, provider pause, command journal and cleanup. Exported data
 * is restricted to one exact fixture order and read in browser memory only. */
import assert from 'node:assert/strict';

async function click(page,label){await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{timeout:25000},label);await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);}
async function field(page,label,value){
 await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>l.textContent.trim().replace(/\s*\*$/,'')===label),{timeout:25000},label);
 const h=await page.evaluateHandle(label=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);return document.getElementById(l.htmlFor);},label);
 const e=h.asElement();assert.ok(e,`Missing ${label}`);
 if(await e.evaluate(e=>e.tagName==='SELECT')){await page.waitForFunction((label,value)=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);return [...document.getElementById(l.htmlFor).options].some(o=>o.value===value);},{timeout:25000},label,String(value));await e.select(String(value));}
 else await e.evaluate((e,value)=>{Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
 await h.dispose();
}
export async function rpc(page,name,action,match=()=>true){const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/rest/v1/rpc/${name}`&&match(JSON.parse(r.request().postData()||'{}')),{timeout:30000});waiting.catch(()=>{});await action();const r=await waiting,value=await r.json();assert.ok(r.ok(),`${name}: ${value.code||r.status()} ${value.message||''}`);return value;}
async function goto(ctx,role,path){const page=await ctx.pageFor(role);await page.goto(ctx.base+path,{waitUntil:'domcontentloaded'});await page.waitForSelector('.squad-app',{timeout:30000});return page;}
function own(ctx,kind,id){assert.ok(id);ctx.record(kind,String(id));return String(id);}
// Match report_period/tailor_week: Kolkata civil dates, exclusive tomorrow,
// and the current Saturday (which the earnings contract explicitly permits).
export function reportingDates(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=type=>parts.find(p=>p.type===type).value;
 const today=new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`);
 const offset=days=>{const date=new Date(today);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
 return {period:{from:offset(-1),before:offset(1)},weekStart:offset(-((today.getUTCDay()+1)%7))};
}
async function picker(ctx,page,label,role){const search=`input[aria-label="Search ${label}"]`,select=`select[aria-label="${label}"]`;await page.waitForSelector(search);await page.$eval(search,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));},ctx.fixture.label);await page.$eval(search,e=>e.parentElement.querySelector('button').click());const id=String(ctx.clients.get(role)?.me.id??ctx.fixture.actors[String(role)]);await page.waitForFunction((s,id)=>document.querySelector(s)&&[...document.querySelector(s).options].some(o=>o.value===id),{timeout:25000},select,id);await page.select(select,id);}
async function waitDocumentHistory(page,result,kind,state=null){const label={catalogue:'Product catalogue',delivery_challan:'Delivery challan',tailor_weekly:'Weekly tailor report'}[kind];await page.waitForFunction((label,count,state)=>{const rows=[...document.querySelectorAll('table tbody tr')].filter(r=>r.children.length===5);return rows.length===count&&rows.length>0&&rows.every(r=>r.children[0].textContent.includes(label)&&(!state||r.children[2].textContent===state));},{timeout:25000},label,result.data.length,state);}
async function verifyQueued(ctx,role,result,kind){
 const id=own(ctx,'document',result.id),sdk=ctx.clients.get(role).sdk;
 const doc=await sdk.document(id);assert.equal(doc.kind,kind);assert.equal(doc.state,'queued');assert.equal(doc.delivery,'download');
 const page=await ctx.pageFor(role);await page.waitForFunction(id=>location.pathname===`/squad/documents/${id}`,{timeout:25000},id);
 await page.waitForFunction(()=>document.body.textContent.includes('Your document is being prepared.'));
 assert.equal(await page.$$eval('a',links=>links.some(a=>/Open PDF|Download PDF/.test(a.textContent)||a.href.includes('/storage/v1/object/sign/'))),false);
 await goto(ctx,role,'/squad/documents');
 const history=await rpc(page,'v1_documents_list',()=>field(page,'Document type',kind),p=>p.p_kind===kind);
 assert.ok(history.data.some(d=>d.id===id&&d.state==='queued'));
 await waitDocumentHistory(page,history,kind);
 const filtered=await rpc(page,'v1_documents_list',()=>field(page,'Status','queued'),p=>p.p_kind===kind&&p.p_state==='queued');
 assert.ok(filtered.data.some(d=>d.id===id));await waitDocumentHistory(page,filtered,kind,'queued');return id;
}
export async function runJourney(ctx){
 ctx.clients??=ctx.clientsMap;assert.ok(ctx.clients instanceof Map);assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);assert.ok(['localhost','127.0.0.1'].includes(new URL(ctx.base).hostname));
 const {period,weekStart}=reportingDates();
 const checks=[],entities={documentIds:[]},admin=ctx.clients.get(0).sdk,orderId=String(ctx.commercial.entities.customOrderIds[0]),filters={order_id:orderId};
 let page=await goto(ctx,0,'/squad/reports/sales');
 await field(page,'Report','custom_items');
 await field(page,'From',period.before);await field(page,'Before',period.from);await click(page,'Apply period');
 await page.waitForFunction(()=>document.body.textContent.includes('The end date must follow the start date.'));
 await field(page,'From',period.from);await field(page,'Before',period.before);
 await rpc(page,'v1_sales_report',()=>click(page,'Apply period'),p=>p.p_kind==='custom_items'&&p.p_from===period.from&&p.p_before===period.before);
 await field(page,'Order number',orderId);
 const report=await rpc(page,'v1_sales_report',()=>click(page,'Apply filters'),p=>p.p_kind==='custom_items'&&p.p_filters?.order_id===orderId);
 const oracle=await admin.salesReport('custom_items',period,filters,{limit:25});assert.deepEqual(report.data.map(r=>r.id),oracle.data.map(r=>r.id));assert.ok(report.data.length>0&&report.data.every(r=>r.order_id===orderId));
 for(const row of report.data)await page.waitForFunction(text=>document.body.textContent.includes(text),{},`#${row.id} · Order #${orderId}`);
 assert.equal(report.next_cursor,null);await page.waitForFunction(()=>['Next','Previous'].every(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label)?.disabled===true),{timeout:25000});
 await rpc(page,'v1_sales_report',()=>click(page,'Export all filtered rows'),p=>p.p_kind==='custom_items'&&p.p_filters?.order_id===orderId&&p.p_limit===100);
 await page.waitForSelector('a[download]');
 // Inspect only the fixture-scoped Blob; never download or publish business data.
 const csv=await page.$eval('a[download]',async a=>{if(!a.href.startsWith('blob:'))throw Error('Expected local export Blob');return await(await fetch(a.href)).text();});
 assert.equal(csv.trim().split(/\r?\n/).length,report.data.length+1);for(const row of report.data){assert.ok(csv.includes(`"${row.id}"`));assert.ok(csv.includes(`"${orderId}"`));}
 checks.push('admin_real_browser_report_date_validation_exact_order_filter_end_page_and_fixture_only_csv');
 // The fixture stays small: prove real server cursor context with limit 1 while
 // the 25-row browser page correctly disables Next for its one exact-order row.
 let cursor=null,seen=[],pages=0;do{const r=await admin.salesReport('custom_items',period,{customer_id:ctx.clients.get(3).me.id},{limit:1,cursor});assert.ok(r.data.every(row=>row.customer.id===ctx.clients.get(3).me.id));seen.push(...r.data.map(r=>r.id));cursor=r.next_cursor;pages++;assert.ok(pages<=20,'Unexpected fixture report scope');}while(cursor);
 assert.ok(pages>=2,'Commerce and operations must create at least two own customer orders');assert.equal(new Set(seen).size,seen.length);checks.push('real_rpc_customer_scoped_report_cursor_has_multiple_pages_without_duplicates');
 page=await goto(ctx,4,'/squad/reports/work');await field(page,'From',period.from);await field(page,'Before',period.before);
 const work=await rpc(page,'v1_work_metrics',()=>click(page,'Apply period'),p=>p.p_from===period.from&&p.p_before===period.before);assert.ok(work.work_in_period.cut>=2);assert.ok(work.work_in_period.inspected>=2);await page.waitForFunction(()=>document.body.textContent.includes('Work recorded in period'));
 page=await goto(ctx,4,'/squad/reports/leaderboard');await field(page,'From',period.from);await field(page,'Before',period.before);
 const leaderboard=await rpc(page,'v1_tailor_leaderboard',()=>click(page,'Apply period'),p=>p.p_from===period.from&&p.p_before===period.before);for(const role of [5,6]){const row=leaderboard.data.find(r=>r.id===String(ctx.fixture.actors[String(role)])&&r.completed>=1);assert.ok(row);await page.waitForFunction(row=>[...document.querySelectorAll('tbody tr')].some(r=>r.children[1]?.textContent.includes(row.name)&&Number(r.children[3]?.textContent.replaceAll(',',''))===row.completed),{timeout:25000},row);}checks.push('factory_manager_real_browser_period_work_metrics_and_tailor_subtailor_leaderboard');
 page=await goto(ctx,4,'/squad/reports/earnings');await picker(ctx,page,'tailor',5);await field(page,'Week starting Saturday',weekStart);const earnings=await rpc(page,'v1_tailor_earnings',()=>click(page,'View earnings'));assert.ok(earnings);await page.waitForFunction(()=>document.body.textContent.includes('Earnings breakdown'));
 page=await goto(ctx,4,'/squad/documents/new/tailor_weekly');await picker(ctx,page,'tailor',5);await field(page,'Week starting Saturday',weekStart);
 const weekly=await rpc(page,'v1_document_request',()=>click(page,'Generate weekly PDF'));entities.documentIds.push(await verifyQueued(ctx,4,weekly,'tailor_weekly'));checks.push('factory_manager_real_browser_weekly_earnings_and_queued_weekly_pdf_detail_history');
 const deliveries=await ctx.clients.get(7).sdk.deliveries({order_id:orderId},{limit:25});assert.equal(deliveries.data.length,2);const delivery=deliveries.data[0];
 page=await goto(ctx,7,'/squad/documents/new/delivery_challan');await page.waitForSelector(`input[aria-label="Delivery ${delivery.id}"]`);await page.click(`input[aria-label="Delivery ${delivery.id}"]`);
 const challan=await rpc(page,'v1_document_request',()=>click(page,'Generate challan'));entities.documentIds.push(await verifyQueued(ctx,7,challan,'delivery_challan'));checks.push('dispatch_real_browser_exact_recorded_delivery_challan_queued_detail_history');
 page=await goto(ctx,3,'/squad/documents/new/catalogue');await field(page,'Select by','class_ids');
 const className=ctx.fixture.label+' RMP class';await page.waitForFunction(name=>[...document.querySelectorAll('label')].some(l=>l.textContent===name),{timeout:25000},className);
 await page.evaluate(name=>[...document.querySelectorAll('label')].find(l=>l.textContent===name).querySelector('input[type=checkbox]').click(),className);
 await field(page,'Company name',ctx.fixture.label+' catalogue');await field(page,'Markup type','percentage');await field(page,'Markup (%)','12.5');await field(page,'Terms and conditions',ctx.fixture.label+' test-only terms');await field(page,'Remarks',ctx.fixture.label+' queued browser test');
 const catalogue=await rpc(page,'v1_document_request',()=>click(page,'Generate catalogue'));entities.documentIds.push(await verifyQueued(ctx,3,catalogue,'catalogue'));
 await assert.rejects(ctx.clients.get(1).sdk.document(catalogue.id),e=>['not_found','forbidden'].includes(e.kind));checks.push('customer_real_browser_fixture_class_catalogue_queued_detail_history_foreign_actor_denial');
 return {checks,entities,scope:'Real UI filters, exact fixture-only in-memory CSV, bounded page-end controls; multi-page cursor verified via real scoped RPC. Documents queued only, no worker/provider/media/download execution.'};
}
