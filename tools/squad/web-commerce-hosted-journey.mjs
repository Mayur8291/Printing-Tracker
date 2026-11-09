/** Real browser→shared SDK→staging DB journey. The parent harness exclusively owns
 * disposable users, fixture setup, write fencing, command journaling and cleanup.
 * Every UI mutation below targets this run's exact fixture. No workers/providers,
 * invitations, email actions, account closure, or production endpoints are used.
 */
import assert from 'node:assert/strict';

async function click(page,label){
 await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);
 await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);
}
async function field(page,label,value){
 await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>l.textContent.trim().replace(/\s*\*$/,'')===label),{},label);
 const id=await page.evaluate(label=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim().replace(/\s*\*$/,'')===label).htmlFor,label);
 const handle=await page.evaluateHandle(id=>document.getElementById(id),id);
 const tag=await handle.evaluate(node=>node.tagName);
 if(tag==='SELECT'){
  await page.waitForFunction((id,value)=>[...document.getElementById(id).options].some(o=>o.value===value),{},id,String(value));
  await handle.asElement().select(String(value));
 }else{
  await handle.asElement().click({clickCount:3});await handle.asElement().press('Backspace');await handle.asElement().type(String(value));
 }
 await handle.dispose();
}
async function nativeValue(page,selector,value){
 await page.waitForSelector(selector);
 await page.$eval(selector,(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function rpc(page,name,action){
 const waiting=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/rest/v1/rpc/${name}`,{timeout:30_000});
 await action();const response=await waiting;const value=await response.json();
 assert.equal(response.ok(),true,`${name} failed: ${value.code||response.status()} ${value.message||''}`);
 await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:30_000});
 return value;
}
async function goto(ctx,page,path){await page.goto(ctx.base+path,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.body.textContent.includes('Verifying your account'));
 assert.ok(!page.url().includes('/login'),'Expected the harness-authenticated persona session');}
async function productCard(page,name){
 await page.waitForFunction(name=>[...document.querySelectorAll('article')].some(a=>a.querySelector('h2')?.textContent===name),{},name);
 await page.evaluate(name=>[...document.querySelectorAll('article')].find(a=>a.querySelector('h2')?.textContent===name).querySelector('button').click(),name);
}
function own(ctx,kind,id){assert.ok(id,`Missing ${kind} ID`);ctx.record(kind,String(id));return String(id);}
function ordersOwned(ctx,result){
 assert.ok(result.orders?.length,'Expected all accepted order children');
 return result.orders.map(order=>{own(ctx,'order',order.id);for(const item of order.items??[])own(ctx,'item',item.item_id);return String(order.id);});
}

async function selectCustom(ctx,page,quantity=2){
 const f=ctx.fixture;
 await page.waitForSelector('input[aria-label="Search products"]');await page.type('input[aria-label="Search products"]',f.label+' base');
 await page.click('button[aria-label="Search"]');await productCard(page,f.label+' base');
 await field(page,'Category',f.ids.categoryId);await field(page,'Fabric',f.ids.fabricId);await field(page,'Fabric color',f.ids.colorId);
 await page.waitForFunction(label=>[...document.querySelectorAll('label')].some(l=>l.textContent===label),{},f.label+' part');
 await page.evaluate(label=>[...document.querySelectorAll('label')].find(l=>l.textContent===label).querySelector('input[type=checkbox]').click(),f.label+' part');
 await field(page,f.label+' part color',f.ids.colorId);await field(page,'Add-on',f.ids.addonId);await field(page,'Add-on color',f.ids.colorId);await click(page,'Add selection');
 await field(page,'Size type',f.ids.sizeTypeId);await field(page,f.label+' size',quantity);
 await field(page,'Design name',f.label+' browser custom');await field(page,'Item note',f.label+' browser custom item');
 await click(page,'Add to selection');await page.waitForFunction(()=>document.body.textContent.includes('Review selection (1)'));
}
async function selectRmp(ctx,page,quantity=3){
 const f=ctx.fixture;
 await click(page,'Ready-made');await page.waitForSelector('input[aria-label="Search products"]');
 await nativeValue(page,'input[aria-label="Search products"]',f.label+' RMP class');await page.click('button[aria-label="Search"]');
 await productCard(page,f.label+' RMP class');
 await nativeValue(page,`input[aria-label="${f.label} RMP SKU quantity"]`,String(quantity));
 await click(page,'Add to selection');
}
async function accept(ctx,page,{quantity,customerId,addressId,label,payment=false,priceOverride=null}){
 const f=ctx.fixture;
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Review selection (')).click());
 await field(page,'Deliver to',addressId);
 let quote=await rpc(page,'v1_quote',()=>click(page,'Calculate prices'));own(ctx,'quote',quote.quote_id);assert.equal(quote.quantity,quantity);
 if(priceOverride!==null){await click(page,'Adjust price');await field(page,'Unit price',priceOverride);await field(page,'Reason',f.label+' browser commercial override');quote=await rpc(page,'v1_quote_override',()=>click(page,'Save changes'));assert.equal(Number(quote.lines[0].variants[0].unit_price),Number(priceOverride));}
 await click(page,'Review and place order');await nativeValue(page,'input[name="due"]',f.dueAt.slice(0,16));
 await page.type('input[name="comment"]',f.label+' '+label);
 if(payment){await field(page,'Payment','partial');await nativeValue(page,'input[name="paid_amount"]','100');}
 const placed=await rpc(page,'v1_order_place',()=>click(page,'Place order'));
 const ids=ordersOwned(ctx,placed);
 await page.waitForFunction(()=>document.body.textContent.includes('Order accepted'));
 for(const id of ids){const order=await ctx.clients.get(1).sdk.order(id);assert.equal(order.customer_id,String(customerId));assert.ok(order.comment?.includes(f.label));for(const item of order.items.data)if(item.product_id)own(ctx,'preset',item.product_id);}
 return {ids,quote,placed};
}

export async function runJourney(ctx){
 assert.ok(/^http:\/\/localhost:\d+$/.test(ctx.base),'Expected the harness-owned local frontend');
 const f=ctx.fixture;assert.match(f.label,/^SQB [a-f0-9]{12}$/);assert.ok(f.ids.sizeTypeId&&f.ids.scSizeId,'Web fixture needs explicit size type/sc_size links for actual dropdown selection');
 const customer=ctx.clients.get(3),sc=ctx.clients.get(1),pc=ctx.clients.get(2);
 assert.equal(customer.me.id,String(f.actors['3']));assert.equal(sc.me.id,String(f.actors['1']));
 const customerPage=await ctx.pageFor(3),scPage=await ctx.pageFor(1);const checks=[],entities={};

 await goto(ctx,customerPage,'/squad/profile');await click(customerPage,'Add address');
 await field(customerPage,'Street address',f.label+' browser address');assert.ok(f.web_address_location?.state&&f.web_address_location?.city,'Exact unused canonical address required');await field(customerPage,'State',f.web_address_location.state);await field(customerPage,'City',f.web_address_location.city);await field(customerPage,'Postal code','560001');
 const address=await rpc(customerPage,'v1_address_save',()=>click(customerPage,'Save changes'));entities.addressId=own(ctx,'address',address.id);
 assert.ok((await customer.sdk.person(customer.me.id)).addresses.some(a=>a.id===address.id&&a.address===f.label+' browser address'));
 checks.push('customer_real_browser_adds_owned_delivery_address');

 await goto(ctx,scPage,`/squad/people/${f.reviewCustomerId}`);await click(scPage,'Review onboarding');
 await field(scPage,'Approval','true');await field(scPage,'Onboarding','true');await field(scPage,'Reason for change',f.label+' browser review');
 await rpc(scPage,'v1_customer_review',()=>click(scPage,'Save changes'));
 await click(scPage,'Edit relationships');await field(scPage,'Fulfillment','true');await field(scPage,'Reason for change',f.label+' browser direct relationship');
 await rpc(scPage,'v1_customer_links_save',()=>click(scPage,'Save changes'));
 const reviewed=await sc.sdk.person(f.reviewCustomerId);assert.equal(reviewed.approved,true);assert.equal(reviewed.onboarded,true);assert.equal(reviewed.direct_deal,true);assert.equal(reviewed.coordinator_id,sc.me.id);
 checks.push('sc_real_browser_reviews_fixture_customer_and_assigns_direct_relationship');

 await goto(ctx,customerPage,'/squad/catalogue');await selectCustom(ctx,customerPage);
 const custom=await accept(ctx,customerPage,{quantity:2,customerId:customer.me.id,addressId:address.id,label:'custom order'});
 entities.customOrderIds=custom.ids;assert.equal(custom.ids.length,1);assert.equal(Number(custom.quote.total),1050);
 const customOrder=await customer.sdk.order(custom.ids[0]);assert.equal(customOrder.total_quantity,2);assert.equal(customOrder.items.data[0].type,0);assert.equal(customOrder.items.data[0].quantities[0].size_id,String(f.ids.sizeId));
 checks.push('customer_real_browser_configures_parts_addons_sizes_quotes_and_places_custom_order');

 await goto(ctx,scPage,`/squad/orders/${custom.ids[0]}`);await click(scPage,'Record payment');await field(scPage,'Payment status','partial');await field(scPage,'Total amount paid','100');await field(scPage,'Payment reference / note',f.label+' browser deposit');
 await rpc(scPage,'v1_order_payment_record',()=>click(scPage,'Save changes'));
 assert.equal(Number((await sc.sdk.order(custom.ids[0])).paid_amount),100);assert.equal('paid_amount' in await pc.sdk.order(custom.ids[0]),false);
 await click(scPage,'Change priority');await field(scPage,'Priority','true');await field(scPage,'Reason for change',f.label+' browser priority');await rpc(scPage,'v1_order_priority_save',()=>click(scPage,'Save changes'));
 assert.equal((await sc.sdk.order(custom.ids[0])).is_prime,true);
 checks.push('sc_real_browser_records_deposit_and_priority_pc_projection_hides_payment');

 await goto(ctx,customerPage,'/squad/catalogue');await selectRmp(ctx,customerPage);
 const ready=await accept(ctx,customerPage,{quantity:3,customerId:customer.me.id,addressId:address.id,label:'ready-made order'});
 entities.readyMadeOrderIds=ready.ids;assert.equal(Number(ready.quote.total),252);
 assert.equal((await customer.sdk.order(ready.ids[0])).items.data[0].type,1);
 checks.push('customer_real_browser_places_ready_made_order_with_server_price_and_queued_provider_intent');

 await goto(ctx,scPage,'/squad/catalogue');
 await field(scPage,'Customer',f.reviewCustomerId);await selectCustom(ctx,scPage);await selectRmp(ctx,scPage);
 const mixed=await accept(ctx,scPage,{quantity:5,customerId:f.reviewCustomerId,addressId:f.commercialExtras.mixedAddressId,label:'mixed order',payment:true});
 entities.mixedOrderIds=mixed.ids;assert.equal(mixed.ids.length,1);assert.equal(Number(mixed.quote.total),1302);
 const mixedOrder=await sc.sdk.order(mixed.ids[0]);assert.equal(mixedOrder.total_quantity,5);assert.deepEqual(mixedOrder.items.data.map(item=>item.type).sort(),[0,1]);assert.equal(Number(mixedOrder.paid_amount),100);
 await assert.rejects(customer.sdk.order(mixed.ids[0]),error=>error.kind==='not_found');
 checks.push('sc_real_browser_places_mixed_order_for_reviewed_customer_with_exact_totals_and_foreign_customer_denial');
 return {checks,entities,scope:'Real browser commands and authenticated SDK read oracles on exact-owned staging fixtures; workers paused, no provider/email execution.'};
}

/** Additional exact-owned custom work for the factory/worker/dealer browser lanes. */
export async function createCustomOrder(ctx,{role=3,customerId,addressId,quantity=2,label='extra custom order',customerRole=3,priceOverride=null}={}){
 const actor=ctx.clients.get(role);assert.ok(actor&&[1,3,10].includes(role));
 customerId=String(customerId??actor.me.id);addressId=String(addressId??(role===10?ctx.fixture.ids.dealerAddressId:ctx.fixture.ids.customerAddressId));
 const page=await ctx.pageFor(role);await goto(ctx,page,'/squad/catalogue');
 if(role===1){if(customerRole===10)await field(page,'Order for','10');await field(page,customerRole===10?'Dealer':'Customer',customerId);}
 await selectCustom(ctx,page,quantity);
 return accept(ctx,page,{quantity,customerId,addressId,label,priceOverride});
}

/** Run after migration120: source-preserving SC amendment on a separate fixture order. */
export async function runAmendmentJourney(ctx){
 const sc=ctx.clients.get(1),customer=ctx.clients.get(3),page=await ctx.pageFor(1);
 const created=await createCustomOrder(ctx,{role:1,customerId:customer.me.id,addressId:ctx.fixture.ids.customerAddressId,label:'amendment original'});
 const id=created.ids[0],before=await sc.sdk.order(id),original=before.items.data[0];
 assert.equal(created.ids.length,1);assert.equal(before.items.data.length,1);assert.equal(before.total_quantity,2);
 assert.ok(original.product_id);assert.ok(original.size_type);assert.equal(original.quantities.length,1);assert.equal(Number(original.quantities[0].quantity),2);
 assert.ok(before.comment.includes(ctx.fixture.label));assert.ok(original.comment.includes(ctx.fixture.label),'Preservation must exercise an actual item note');
 await goto(ctx,page,`/squad/orders/${id}`);await click(page,'Record payment');await field(page,'Payment status','partial');await field(page,'Total amount paid','100');await field(page,'Payment reference / note',ctx.fixture.label+' amendment deposit');await rpc(page,'v1_order_payment_record',()=>click(page,'Save changes'));
 await goto(ctx,page,`/squad/catalogue/amend/${id}`);await click(page,'Load current selection');await page.waitForFunction(()=>document.body.textContent.includes('Original item #'));
 await click(page,'Adjust quantities');await nativeValue(page,'input[name=quantity_0]','3');await click(page,'Update selection');await field(page,'Deliver to',ctx.fixture.ids.customerAddressId);
 const quote=await rpc(page,'v1_quote',()=>click(page,'Calculate prices'));own(ctx,'quote',quote.quote_id);assert.equal(quote.quantity,3);assert.equal(Number(quote.total),1575);
 await click(page,'Review amendment');assert.equal(await page.$eval('select[name=payment_status]',node=>node.value),'preserve');await field(page,'Reason for amendment',ctx.fixture.label+' preserve original configuration');
 const result=await rpc(page,'v1_order_edit',()=>click(page,'Submit amendment'));assert.equal(result.state,'applied');own(ctx,'amendment',result.amendment_id);for(const item of result.items??[])own(ctx,'item',item.item_id);
 const after=await sc.sdk.order(id);assert.equal(after.total_quantity,3);assert.equal(Number(after.paid_amount),100);assert.equal(after.comment,before.comment);assert.equal(after.items.data[0].product_id,original.product_id);assert.equal(after.items.data[0].size_type,original.size_type);assert.equal(after.items.data[0].comment,original.comment);assert.equal(after.items.data[0].quantities[0].size_id,original.quantities[0].size_id);assert.equal(Number(after.total_amount),1575);
 assert.equal(after.items.data.length,1);assert.equal(after.items.data[0].quantities.length,1);assert.equal(Number(after.items.data[0].quantities[0].quantity),3);
 return {checks:['sc_browser_amendment_preserves_original_product_size_type_sizes_notes_and_payment'],entities:{amendmentOrderIds:[id]}};
}

/** Additional retained commerce controls on their own disposable custom orders.
 * Invoke explicitly as commerce-controls; no mutation of the manufacturing
 * lane's orders and no provider/worker execution. */
export async function runCommerceControlsJourney(ctx){
 assert.ok(/^http:\/\/localhost:\d+$/.test(ctx.base));assert.match(ctx.fixture.label,/^SQB [a-f0-9]{12}$/);
 const {loseNextRpcResponse}=await import('./browser-lost-response.mjs');
 const f=ctx.fixture,sc=ctx.clients.get(1),customer=ctx.clients.get(3),admin=ctx.clients.get(0);
 const page=await ctx.pageFor(1),customerPage=await ctx.pageFor(3),adminPage=await ctx.pageFor(0),checks=[];
 const created=await createCustomOrder(ctx,{role:1,customerId:customer.me.id,addressId:f.ids.customerAddressId,label:'controls isolated order',priceOverride:'450'});
 const id=created.ids[0];assert.equal(created.ids.length,1);assert.equal(Number(created.quote.total),945);assert.equal(Number((await sc.sdk.order(id)).total_amount),945);checks.push('sc_browser_unit_price_override_recomputes_tax_and_persists_accepted_order_total');
 await goto(ctx,page,`/squad/orders/${id}`);
 const before=await sc.sdk.order(id);
 await click(page,'Change priority');await field(page,'Priority','true');await field(page,'Reason for change',f.label+' uncertain response');
 const fault=await loseNextRpcResponse(page,'v1_order_priority_save',{origin:'https://scvojtvgnkmbupvyslmb.supabase.co'});let lost;
 try{
  await click(page,'Save changes');lost=await fault.lost;
  assert.equal(lost.payload.p_id,String(id));
  await page.waitForSelector('[role="dialog"] [role="alert"]');
  assert.equal((await sc.sdk.order(id)).is_prime,true,'Server committed even though browser did not receive success');
 }finally{await fault.dispose();}
 const committed=await sc.sdk.order(id);assert.notEqual(committed.version,before.version);
 const retryRequest=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/rest/v1/rpc/v1_order_priority_save');
 await rpc(page,'v1_order_priority_save',()=>click(page,'Save changes'));
 assert.deepEqual(JSON.parse((await retryRequest).postData()),lost.payload,'Unchanged UI retry must retain key, payload and expected version');
 assert.equal((await sc.sdk.order(id)).version,committed.version,'Retry must not apply the priority command a second time');
 checks.push('sc_lost_success_response_ui_retry_retains_command_and_does_not_increment_version_twice');

 await click(page,'Change due date');const localDue=f.dueAt.slice(0,16);
 await nativeValue(page,'input[name=due]',localDue);await field(page,'Reason for change',f.label+' browser due date');
 const expectedDue=await page.$eval('input[name=due]',input=>new Date(input.value).toISOString());
 await rpc(page,'v1_order_due_save',()=>click(page,'Save changes'));
 assert.equal(new Date((await sc.sdk.order(id)).due_on).toISOString(),expectedDue);
 await click(page,'Dispatch destination');await field(page,'Send to','customer');await field(page,'Reason for change',f.label+' customer destination');
 await rpc(page,'v1_dispatch_destination_save',()=>click(page,'Save changes'));
 assert.equal((await sc.sdk.order(id)).dispatch_destination.mode,'customer');
 checks.push('sc_due_date_and_destination_persist_exact_browser_values');

 await goto(ctx,page,`/squad/people/${customer.me.id}`);await click(page,'View orders');
 await page.waitForFunction(id=>new URL(location.href).searchParams.get('customer_id')===id,{},customer.me.id);
 const sorted=page.waitForResponse(response=>{if(response.request().method()!=='POST'||new URL(response.url()).pathname!=='/rest/v1/rpc/v1_orders_list')return false;const p=JSON.parse(response.request().postData());return p.p_filters?.customer_id===customer.me.id&&p.p_filters?.sort==='due_asc';});
 await field(page,'Sort orders','due_asc');const response=await sorted;assert.ok(response.ok());const list=await response.json();
 assert.ok(list.data.some(order=>order.id===id));assert.ok(list.data.every(order=>order.customer_id===customer.me.id));
 checks.push('person_detail_reuses_orders_with_fixed_customer_scope_and_server_due_sort');

 await goto(ctx,customerPage,`/squad/orders/${id}`);const paymentBefore=await customer.sdk.order(id);
 await click(customerPage,'Payment instructions');await customerPage.waitForFunction(()=>document.body.textContent.includes('Staging preview — no payment is required.'));
 assert.equal(await customerPage.$('a[href^="https://wa.me/"]'),null);assert.equal(await customerPage.$('img[alt="Scott International payment QR from the existing application"]'),null);
 await click(customerPage,'I understand');await customerPage.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 const paymentAfter=await customer.sdk.order(id);assert.equal(paymentAfter.version,paymentBefore.version);assert.equal(paymentAfter.paid_amount,paymentBefore.paid_amount);assert.equal(paymentAfter.payment_status,paymentBefore.payment_status);
 checks.push('customer_manual_payment_acknowledgement_has_no_business_write_or_staging_external_action');

 await goto(ctx,adminPage,`/squad/orders/${id}`);await click(adminPage,'Force complete');await field(adminPage,'Reason for change',f.label+' disposable exception acceptance');
 await rpc(adminPage,'v1_order_force_complete',()=>click(adminPage,'Save changes'));
 assert.equal((await admin.sdk.order(id)).status,1);
 await goto(ctx,page,`/squad/orders/${id}`);await click(page,'Change priority');await field(page,'Priority','false');await field(page,'Reason for change',f.label+' completed priority');
 await rpc(page,'v1_order_priority_save',()=>click(page,'Save changes'));const completed=await sc.sdk.order(id);assert.equal(completed.status,1);assert.equal(completed.is_prime,false);
 await goto(ctx,customerPage,`/squad/orders/${id}`);await click(customerPage,'Give feedback');await field(customerPage,'Rating','4');
 await customerPage.click('[role="group"][aria-label="What went well choices"] button');
 await customerPage.type('textarea[name="positive"]',', '+f.label+' browser feedback');await customerPage.type('textarea[name="negative"]',f.label+' improvement');
 const rating=await rpc(customerPage,'v1_rating_save',()=>click(customerPage,'Save changes'));own(ctx,'rating',rating.id);
 let ratings=await customer.sdk.ratings('Order',id);let saved=ratings.data.find(row=>row.id===rating.id);assert.ok(saved);assert.equal(saved.from_id,customer.me.id);assert.equal(saved.to_id,sc.me.id);assert.equal(Number(saved.score),4);assert.match(saved.positive_comments,/Delivery Speed/);assert.ok(saved.positive_comments.includes(f.label));
 await click(customerPage,'Edit');await field(customerPage,'Rating','5');await rpc(customerPage,'v1_rating_save',()=>click(customerPage,'Save changes'));
 ratings=await customer.sdk.ratings('Order',id);assert.equal(ratings.data.filter(row=>row.from_id===customer.me.id).length,1);saved=ratings.data.find(row=>row.id===rating.id);assert.equal(Number(saved.score),5);assert.notEqual(saved.version,rating.version);
 checks.push('admin_reasoned_exception_completion_then_sc_completed_priority_and_customer_feedback_create_edit');

 const cancelOrder=await createCustomOrder(ctx,{role:1,customerId:customer.me.id,addressId:f.ids.customerAddressId,label:'cancellation isolated order'});
 const cancelId=cancelOrder.ids[0];await goto(ctx,page,`/squad/orders/${cancelId}`);await click(page,'Cancel order');await field(page,'Reason for change',f.label+' disposable cancellation');
 const cancelled=await rpc(page,'v1_order_cancel',()=>click(page,'Save changes'));assert.equal(cancelled.state,'cancelled');
 assert.equal((await sc.sdk.order(cancelId)).provider_status,'CANCELLED');assert.equal((await customer.sdk.order(cancelId)).provider_status,'CANCELLED');
 checks.push('sc_custom_order_cancellation_is_durable_and_visible_to_own_customer_without_provider_execution');
 const dealer=ctx.clients.get(10),dealerPage=await ctx.pageFor(10),dealerOrderIds=[];
 for(const mixed of [false,true]){
  await goto(ctx,dealerPage,'/squad/catalogue');if(mixed)await selectCustom(ctx,dealerPage);await selectRmp(ctx,dealerPage);
  const placed=await accept(ctx,dealerPage,{quantity:mixed?5:3,customerId:dealer.me.id,addressId:f.ids.dealerAddressId,label:mixed?'dealer own mixed purchase':'dealer own RMP purchase'});
  assert.equal(placed.ids.length,1);assert.equal(Number(placed.quote.total),mixed?1302:252);dealerOrderIds.push(...placed.ids);
  const ownOrder=await dealer.sdk.order(placed.ids[0]);assert.equal(ownOrder.customer_id,dealer.me.id);assert.equal(Number(ownOrder.total_amount),mixed?1302:252);assert.equal(ownOrder.total_quantity,mixed?5:3);assert.deepEqual(ownOrder.items.data.map(item=>item.type).sort(),mixed?[0,1]:[1]);
  assert.equal(placed.placed.orders[0].integration_status,'queued');
  // PC production scope excludes pure RMP. Source permits selling values on
  // custom/mixed work, while customer payment information remains private.
  if(mixed){const pcOrder=await ctx.clients.get(2).sdk.order(placed.ids[0]);assert.equal(Number(pcOrder.total_amount),1302);assert.equal('paid_amount' in pcOrder,false);assert.equal('payment_status' in pcOrder,false);}
  else await assert.rejects(ctx.clients.get(2).sdk.order(placed.ids[0]),error=>error.kind==='not_found');
  await assert.rejects(customer.sdk.order(placed.ids[0]),error=>error.kind==='not_found');
  checks.push(mixed?'dealer_browser_places_own_mixed_purchase_exact_tax_typed_children_and_foreign_denial':'dealer_browser_places_own_rmp_purchase_exact_tax_and_foreign_denial');
 }
 // Observe actual hosted keyset continuation without creating30 throwaway
 // orders to force a UI page. These are authenticated SDK reads, separately
 // labelled from the real browser sort/control observations above.
 const filters={customer_id:dealer.me.id,sort:'due_asc',state:'pending'};
 const bounded=await dealer.sdk.orders(filters,{limit:30});assert.equal(bounded.next_cursor,null,'Unexpected owned fixture volume');
 let cursor=null;const seen=[],seenCursors=new Set();let pages=0;
 do{assert.ok(++pages<=31,'Owned cursor test exceeded bounded page count');const result=await dealer.sdk.orders(filters,{cursor,limit:1});assert.ok(result.data.length<=1);assert.ok(result.data.length||!result.next_cursor,'Empty page cannot keep a continuation');for(const row of result.data){assert.equal(row.customer_id,dealer.me.id);assert.ok(!seen.includes(row.id));seen.push(row.id);}cursor=result.next_cursor;if(cursor){assert.ok(!seenCursors.has(cursor),'Cursor must advance');seenCursors.add(cursor);}if(seen.length>30)throw new Error('Owned cursor test exceeded bounded fixture volume');}while(cursor);
 assert.deepEqual(seen,bounded.data.map(row=>row.id));assert.ok(dealerOrderIds.every(id=>seen.includes(id)));
 checks.push('dealer_authenticated_due_sort_cursor_walk_matches_bounded_fixture_list_without_duplicates');
 return {checks,entities:{controlsOrderIds:[id,cancelId],dealerOrderIds,ratingIds:[rating.id]},pagination:{transport:'authenticated SDK reads; browser sort independently checked',page_size:1,observed_rows:seen.length,bulk_fixture_inserts:0},scope:'Real commands on separately browser-created exact-owned custom orders; intentional response loss after HTTP success; no provider execution. Parent cleanup and retained audit remain required.'};
}
