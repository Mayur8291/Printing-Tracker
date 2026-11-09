/** Real persona-browser operations journey. The root harness owns staging-only
 * Auth, fixture manifest, paused workers, deterministic UUID journal and cleanup.
 * SDK mutations are restricted to explicit dealer/customer prerequisites; all
 * allocation/work/dispatch/job/backorder actions under test use rendered UI. */
import assert from 'node:assert/strict';
import {navigateWorkspace} from './browser-workspace-navigation.mjs';
import {createCustomOrder} from './web-commerce-hosted-journey.mjs';
const localDate=iso=>{const d=new Date(iso),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
async function click(page,label){await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{timeout:25000},label);await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);}
async function field(page,label,value){
 await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>l.textContent.trim().replace(/\s*\*$/,'')===label),{timeout:25000},label);
 const handle=await page.evaluateHandle(label=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);return document.getElementById(l.htmlFor);},label);
 const element=handle.asElement();assert.ok(element,`Missing field ${label}`);const tag=await element.evaluate(e=>e.tagName);
 if(tag==='SELECT'){await page.waitForFunction((label,value)=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label);const e=l&&document.getElementById(l.htmlFor);return e&&!e.disabled&&[...e.options].some(o=>o.value===value);},{timeout:25000},label,String(value));await element.select(String(value));}else await element.evaluate((e,value)=>{Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
 await handle.dispose();
}
async function picker(ctx,page,label,role){
 const search=`input[aria-label="Search ${label.toLowerCase()}"]`,select=`select[aria-label="${label}"]`;
 await page.waitForSelector(search);await page.$eval(search,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},ctx.fixture.label);
 await page.$eval(search,e=>e.parentElement.querySelector('button').click());
 const id=String(ctx.clients.get(role)?.me.id??ctx.fixture.actors[role]);
 await page.waitForFunction((selector,id)=>[...document.querySelector(selector).options].some(o=>o.value===id),{timeout:25000},select,id);await page.select(select,id);
}
async function quantity(page,panelTitle,value,index=0){
 await page.waitForFunction((title,index)=>{const section=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent===title);return section&&[...section.querySelectorAll('input[aria-label^="Quantity for"]')].filter(e=>!e.disabled)[index];},{timeout:25000},panelTitle,index);
 await page.evaluate((title,value,index)=>{const s=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent===title);const e=[...s.querySelectorAll('input[aria-label^="Quantity for"]')].filter(e=>!e.disabled)[index];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));},panelTitle,value,index);
}
export async function response(page,name,action,match=()=>true){const wait=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/rest/v1/rpc/${name}`&&match(JSON.parse(r.request().postData()||'{}')),{timeout:30000});wait.catch(()=>{});await action();const r=await wait,value=await r.json();assert.ok(r.ok(),`${name}: ${value.code??r.status()} ${value.message??''}`);return value;}
async function goto(ctx,role,path){const page=await ctx.pageFor(role);return navigateWorkspace(page,ctx.base,path);}
function record(ctx,kind,id){assert.ok(id,`Missing ${kind} ID`);ctx.record?.(kind,String(id));return String(id);}
function recordWork(ctx,r){if(r.history_id)record(ctx,'dispatch_history',r.history_id);}
async function factoryAllocation(ctx,orderId,itemId){const pc=await goto(ctx,2,`/squad/production/factory/${itemId}`);await picker(ctx,pc,'factory',4);await field(pc,'Reason',ctx.fixture.label+' browser factory assignment');await response(pc,'v1_order_assign_factory',()=>click(pc,'Save assignment'));assert.equal((await ctx.clients.get(2).sdk.order(orderId)).factory_manager_id,ctx.clients.get(4).me.id);}
async function workerAllocation(ctx,orderId,itemId,label){const pc=await goto(ctx,2,`/squad/production/factory/${itemId}`);await field(pc,'Assignment','worker');await picker(ctx,pc,'worker',11);await field(pc,'Due date',localDate(ctx.fixture.dueAt));await field(pc,'Reason',ctx.fixture.label+' '+label);await response(pc,'v1_order_assign_worker',()=>click(pc,'Save assignment'));assert.equal((await ctx.clients.get(2).sdk.order(orderId)).worker_id,ctx.clients.get(11).me.id);}
async function completeWorker(ctx,orderId,itemId,{cost=true,due=true}={}){
 if(cost){const pc=await goto(ctx,2,`/squad/job-work/${orderId}`);await field(pc,'Worker cost per piece (₹)','12.345');await field(pc,'Cost change reason',ctx.fixture.label+' browser worker cost');await response(pc,'v1_worker_cost_save',()=>click(pc,'Save worker cost'));}
 let page=await goto(ctx,11,`/squad/job-work/${orderId}`);
 if(due){await field(page,'New due date',localDate(new Date(new Date(ctx.fixture.dueAt).valueOf()+86400000).toISOString()));await field(page,'Reason for change',ctx.fixture.label+' browser due-date commitment');await response(page,'v1_worker_due_save',()=>click(page,'Update commitment'));await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Update commitment'));const history=await ctx.clients.get(11).sdk.orderSection(orderId,'worker_history');assert.equal(history.data.length,1);assert.equal(history.commitment.reason,ctx.fixture.label+' browser due-date commitment');}
 let last;
 const initial=(await ctx.clients.get(11).sdk.order(orderId)).items.data.find(i=>i.id===itemId)?.worker_stage;
 assert.ok(initial==null||initial===0,'New worker order must start at the source initial stage');
 // Source status 0 is the initial Fabric ordered state; workers advance 1..5.
 for(let stage=(initial??0)+1;stage<6;stage++){
  page=await goto(ctx,11,`/squad/job-work/${orderId}`);await field(page,'Next stage',String(stage));await field(page,'Progress note',ctx.fixture.label+' browser stage '+stage);
  last=await response(page,'v1_worker_stage_save',()=>click(page,'Save progress'));assert.equal(last.stage,stage);
 }
 const finished=await ctx.clients.get(11).sdk.order(orderId);assert.equal(finished.status,1);assert.ok(finished.items.data.find(i=>i.id===itemId)?.worker_stage_changed_at);return last;
}
async function currentItems(ctx,itemId,completed,tailorRole){
 const role=tailorRole?4:8,path=tailorRole?`/squad/people/${ctx.fixture.actors[String(tailorRole)]}`:'/squad/production';
 const page=await goto(ctx,role,path);await page.waitForSelector('input[aria-label="Item number"]');await page.select('select[aria-label="Work status"]',String(completed));
 await page.$eval('input[aria-label="Item number"]',(e,id)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,id);e.dispatchEvent(new Event('input',{bubbles:true}));},String(itemId));
 const rows=await response(page,'v1_operational_items',()=>click(page,'Find'),p=>String(p.p_item_id)===String(itemId)&&p.p_completed===completed);
 assert.equal(rows.data.length,1);assert.equal(rows.data[0].id,String(itemId));assert.equal(rows.data[0].completed,completed);await page.waitForFunction((id,completed)=>[...document.querySelectorAll('tbody tr')].some(r=>r.textContent.includes('Item #'+id)&&r.children[4]?.textContent===(completed?'Completed':'Pending')),{timeout:25000},String(itemId),completed);return page;
}
async function dispatch(ctx,role,itemId,count){const page=await goto(ctx,role,`/squad/${role===10?'stock':'production'}/dispatch/${itemId}`);await quantity(page,'Size breakdown',count);const r=await response(page,'v1_dispatch_record',()=>click(page,'Record dispatch'));recordWork(ctx,r);return r;}
export async function runJourney(ctx){
 ctx.clients??=ctx.clientsMap;assert.ok(ctx.clients instanceof Map);assert.ok(ctx.fixture.label&&ctx.fixture.dueAt&&ctx.fixture.completionBy);assert.ok(['localhost','127.0.0.1'].includes(new URL(ctx.base).hostname));
 const checks=[],entities={orderIds:[],itemIds:[]},pc=ctx.clients.get(2).sdk,fm=ctx.clients.get(4).sdk,cm=ctx.clients.get(9).sdk,inspector=ctx.clients.get(8).sdk,di=ctx.clients.get(7).sdk,dealer=ctx.clients.get(10).sdk;
 const orderId=ctx.commercial.entities.factoryOrderId??ctx.commercial.entities.customOrderIds?.[0];assert.ok(orderId,'Commerce must create a custom factory order first');const order=await pc.order(orderId),itemId=order.items.data[0].id,required=order.items.data[0].total_quantity;assert.ok(required>=2);entities.factoryOrderId=orderId;entities.factoryItemId=itemId;
 await factoryAllocation(ctx,orderId,itemId);
 let page=await goto(ctx,4,`/squad/production/factory/${itemId}`);await field(page,'Assignment','cutter');await picker(ctx,page,'cutter',9);await field(page,'Reason',ctx.fixture.label+' browser cutting assignment');await response(page,'v1_item_assign_cutter',()=>click(page,'Save assignment'));
 // Complete only criteria on the fixture item; the server owns readiness rules.
 page=await goto(ctx,4,`/squad/production/factory/${itemId}`);await page.waitForFunction(()=>[...document.querySelectorAll('section')].some(s=>s.querySelector('h2')?.textContent==='Production checklist'&&s.querySelector('form')));
 const changed=await page.evaluate(()=>{const s=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='Production checklist');const boxes=[...s.querySelectorAll('input[type="checkbox"]')].filter(e=>!e.disabled&&!e.checked);for(const b of boxes)b.click();return boxes.length;});if(changed)await response(page,'v1_item_criteria_save',()=>click(page,'Save checklist'));
 for(const count of [1,required-1]){page=await goto(ctx,9,`/squad/production/cutting/${itemId}`);await quantity(page,'Size breakdown',count);await response(page,'v1_cutting_record',()=>click(page,'Record cutting'));}
 assert.equal((await cm.productionProgress(orderId)).cut,required);assert.equal((await cm.cuttingDetail(itemId)).history.data.length,2);checks.push('real_browser_pc_factory_fm_cutter_checklist_cm_partial_cut_and_history');
 for(const [role,count] of [[5,1],[6,required-1]]){page=await goto(ctx,4,`/squad/production/factory/${itemId}`);await field(page,'Workforce',String(role));await picker(ctx,page,'tailor',role);await quantity(page,'Assign work',count);await field(page,'Due date',localDate(ctx.fixture.dueAt));await field(page,'Completion target',localDate(ctx.fixture.completionBy));await response(page,'v1_jobsheet_assign',()=>click(page,'Save assignment'));}
 assert.equal((await fm.productionProgress(orderId)).assigned,required);await currentItems(ctx,itemId,false);await currentItems(ctx,itemId,false,5);
 page=await goto(ctx,8,`/squad/production/inspection/${itemId}`);const assignments=(await inspector.tailorWork({itemId})).data;assert.equal(assignments.length,2);
 for(let i=0;i<assignments.length;i++)await quantity(page,'Record inspection',assignments[i].assigned-assignments[i].inspected,i);
 await response(page,'v1_jobsheet_inspect',()=>click(page,'Record inspection and pickup'));const completed=(await inspector.tailorWork({itemId,history:true})).data;assert.equal(completed.reduce((s,r)=>s+r.inspected,0),required);assert.ok(completed.every(r=>r.inspected===r.picked));await currentItems(ctx,itemId,true);await currentItems(ctx,itemId,true,5);checks.push('real_browser_fm_tailor_subtailor_allocation_inspector_coupled_completion_pickup_and_current_item_tabs');
 page=await goto(ctx,7,`/squad/production/dispatch/${itemId}`);await field(page,'Deliver to','customer');await field(page,'Reason',ctx.fixture.label+' browser destination');await response(page,'v1_dispatch_destination_save',()=>click(page,'Save destination'));
 const first=await dispatch(ctx,7,itemId,1);assert.equal(first.progress.order_completed,false);const last=await dispatch(ctx,7,itemId,required-1);assert.equal(last.progress.order_completed,true);assert.equal((await di.deliveries({order_id:orderId})).data.length,2);checks.push('real_browser_di_destination_partial_dispatch_and_completed_order');
 const extra=await createCustomOrder(ctx,{quantity:2,label:'browser job worker order'}),workerOrderId=extra.ids[0],workerItemId=(await pc.order(workerOrderId)).items.data[0].id;entities.workerOrderId=workerOrderId;entities.workerItemId=workerItemId;
 await workerAllocation(ctx,workerOrderId,workerItemId,'browser direct worker allocation');await completeWorker(ctx,workerOrderId,workerItemId);checks.push('real_browser_pc_worker_cost_and_allocation_jw_due_commitment_and_six_stages');
 // Explicit prerequisites only: a separate customer prevents changes to the
 // source relations of the earlier direct/mixed/provider-queued orders.
 const setupKey=label=>({idempotencyKey:ctx.commandKey('web-operations.setup.'+label),expectedVersion:null});
 const subject=await dealer.savePerson(null,3,{name:ctx.fixture.label+' browser dealer customer',email:ctx.fixture.commercialExtras.createdCustomerEmail},setupKey('dealer-customer'));
 record(ctx,'person',subject.id);if(subject.account_request_id)record(ctx,'account_request',subject.account_request_id);
 const address=await dealer.saveAddress(null,subject.id,{address:ctx.fixture.label+' browser dealer address',state:ctx.fixture.web_address_location.state,city:ctx.fixture.web_address_location.city,zip_code:'560001',is_primary:true},setupKey('dealer-customer-address'));record(ctx,'address',address.id);
 const supply=await createCustomOrder(ctx,{role:10,quantity:2,label:'browser dealer stock purchase'}),supplyId=supply.ids[0],supplyItem=(await pc.order(supplyId)).items.data[0];await workerAllocation(ctx,supplyId,supplyItem.id,'browser dealer production');const receipt=await completeWorker(ctx,supplyId,supplyItem.id,{due:false});assert.equal(receipt.stock_receipt.received,1);assert.equal((await dealer.dealerStock({kind:'custom',product_id:supplyItem.product_id},{},{limit:25})).data.reduce((s,r)=>s+r.available,0),2);
 const demand=await createCustomOrder(ctx,{role:1,customerId:subject.id,addressId:address.id,quantity:3,label:'browser dealer customer demand'}),demandId=demand.ids[0],demandItem=(await dealer.order(demandId)).items.data[0];
 const partial=await dispatch(ctx,10,demandItem.id,1);assert.equal(partial.stock_allocations.reduce((s,r)=>s+r.quantity,0),1);
 page=await goto(ctx,10,'/squad/stock/backorders');await page.waitForSelector(`input[aria-label="Select order ${demandId}"]`);await page.click(`input[aria-label="Select order ${demandId}"]`);await field(page,'Delivery address for the purchase',ctx.fixture.ids.dealerAddressId);const preview=await response(page,'v1_backorder_preview',()=>click(page,'Review shortages'));record(ctx,'backorder_preview',preview.preview_id);record(ctx,'quote',preview.quote.quote_id);assert.equal(preview.requirements.reduce((s,r)=>s+r.shortage,0),1);
 const purchase=await page.waitForSelector('input[aria-label^="Purchase quantity for"]',{visible:true,timeout:25000});assert.ok(purchase);await purchase.evaluate(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2');e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Place backorder')?.disabled===true);
 const revised=await response(page,'v1_backorder_preview',()=>click(page,'Update purchase quote'));record(ctx,'backorder_preview',revised.preview_id);record(ctx,'quote',revised.quote.quote_id);assert.equal(revised.quote.quantity,2);assert.equal(revised.requirements[0].purchase_quantity,2);

 await field(page,'Requested due date',localDate(ctx.fixture.dueAt));const back=await response(page,'v1_backorder_place',()=>click(page,'Place backorder'));const backOrder=back.orders[0];record(ctx,'order',backOrder.id);for(const i of backOrder.items)record(ctx,'item',i.item_id);const backItemId=backOrder.items[0].item_id;
 await workerAllocation(ctx,backOrder.id,backItemId,'browser shortage production');await completeWorker(ctx,backOrder.id,backItemId,{due:false});const fulfilled=await dispatch(ctx,10,demandItem.id,2);assert.equal(fulfilled.progress.order_completed,true);assert.deepEqual(fulfilled.stock_allocations.map(r=>r.quantity),[1,1]);
 const balance=await dealer.dealerStock({kind:'custom',product_id:supplyItem.product_id},{},{limit:25});assert.equal(balance.data.reduce((s,r)=>s+r.available,0),1);assert.equal((await dealer.order(demandId)).status,1);page=await goto(ctx,10,`/squad/orders/${demandId}`);await page.waitForFunction(()=>[...document.querySelectorAll('summary')].some(s=>s.textContent.trim()==='Linked stock orders'));await page.evaluate(()=>[...document.querySelectorAll('summary')].find(s=>s.textContent.trim()==='Linked stock orders').click());await page.waitForFunction(id=>[...document.querySelectorAll('section')].some(s=>s.querySelector('h2')?.textContent==='Linked stock orders'&&s.textContent.includes('#'+id)),{timeout:25000},backOrder.id);const links=await dealer.orderSection(demandId,'backorders');assert.ok(links.data.some(r=>r.id===backOrder.id&&r.direction==='purchase'));checks.push('real_browser_dealer_receipt_partial_fifo_dispatch_edited_procurement_requote_linked_purchase_and_exact_remaining_stock');
 Object.assign(entities,{dealerCustomerId:subject.id,supplyOrderId:supplyId,demandOrderId:demandId,backorderId:backOrder.id});
 return{checks,entities,scope:'Real browser operations with authenticated read oracles. Separate dealer customer/address are declared SDK setup; no workers, external providers or emails invoked.'};
}
