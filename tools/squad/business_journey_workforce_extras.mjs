/** Additional workforce contracts through authenticated shared SDK clients.
 * Documents remain queued for download; no worker, email or provider is invoked.
 */
import assert from 'node:assert/strict';
import {SquadError} from '../../packages/shared/squad.js';

const denied=kind=>error=>error instanceof SquadError&&error.kind===kind;
const person=(ctx,role)=>String(ctx.clients.get(role)?.me.id??ctx.fixture.actors[role]);
const command=(ctx,label,expectedVersion=null)=>({idempotencyKey:ctx.commandKey('workforce.'+label),expectedVersion});
const own=(ctx,kind,id)=>{assert.ok(id);ctx.record?.(kind,String(id));return String(id);};
function reportingDates(){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const day=new Date(today+'T00:00:00Z'),week=new Date(day);
 week.setUTCDate(day.getUTCDate()-(day.getUTCDay()+1)%7);
 const end=new Date(day);end.setUTCDate(end.getUTCDate()+1);
 return {weekStart:week.toISOString().slice(0,10),from:week.toISOString().slice(0,10),before:end.toISOString().slice(0,10)};
}

export async function runJourney(ctx){
 const customer=ctx.clients.get(3).sdk,pc=ctx.clients.get(2).sdk,fm=ctx.clients.get(4).sdk;
 const cutter=ctx.clients.get(9).sdk,inspector=ctx.clients.get(8).sdk,di=ctx.clients.get(7).sdk;
 const f=ctx.fixture,label=f.label,checks=[],entities={documentIds:[]},period=reportingDates();
 const tailorKey=command(ctx,'create-tailor'),tailor=await fm.saveTailor(null,{name:label+' extra tailor'},tailorKey);
 assert.equal(tailor.account,'managed_subject');assert.deepEqual(await fm.saveTailor(null,{name:label+' extra tailor'},tailorKey),tailor);
 entities.tailorId=own(ctx,'person',tailor.id);
 const subKey=command(ctx,'create-subtailor'),subFields={name:label+' extra subtailor',parent_tailor_id:tailor.id};
 const sub=await fm.saveSubtailor(null,subFields,subKey);assert.equal(sub.account,'managed_subject');
 assert.deepEqual(await fm.saveSubtailor(null,subFields,subKey),sub);entities.subtailorId=own(ctx,'person',sub.id);
 assert.equal((await fm.person(sub.id)).parent_tailor_id,tailor.id);
 assert.equal((await fm.person(tailor.id)).email,null);
 assert.equal((await fm.person(sub.id)).email,null);
 await assert.rejects(customer.saveTailor(null,{name:label+' forbidden'},command(ctx,'customer-tailor-denied')),denied('forbidden'));
 checks.push('factory_manager_managed_tailor_and_subtailor_creation_retry_relationship_and_no_auth_contact');

 const quote=await customer.quote({customer_id:person(ctx,3),address_id:String(f.ids.customerAddressId),lines:[{kind:'custom',configuration:f.customConfig,quantities:[{size_id:String(f.ids.sizeId),quantity:4}]}]});
 own(ctx,'quote',quote.quote_id);assert.equal(quote.quantity,4);
 const placed=await customer.placeOrder(quote.quote_id,{due_at:f.dueAt,comment:label+' workforce extras',line_settings:{'1':{product_id:ctx.commercial.entities.presetId}}},command(ctx,'place',quote.version));
 assert.equal(placed.orders.length,1);const order=placed.orders[0],orderId=own(ctx,'order',order.id),itemId=own(ctx,'item',order.items[0].item_id);
 entities.orderId=orderId;entities.itemId=itemId;
 await pc.assignFactory(orderId,person(ctx,4),label+' extra work',command(ctx,'factory',(await pc.order(orderId)).version));
 await fm.assignCutter(itemId,person(ctx,9),label+' extra cutting',command(ctx,'cutter',(await fm.orderItem(itemId)).version));
 const quantity=(await cutter.orderItem(itemId)).records.data[0],quantityId=quantity.id;assert.equal(quantity.quantity,4);
 const itemVersion=async sdk=>(await sdk.orderItem(itemId)).version;
 await cutter.recordCutting(itemId,[{quantity_id:quantityId,quantity:4}],null,command(ctx,'cut',await itemVersion(cutter)));
 await fm.assignJobsheet(itemId,[{quantity_id:quantityId,tailor_id:tailor.id,quantity:2},{quantity_id:quantityId,tailor_id:sub.id,quantity:2}],f.dueAt,f.completionBy,command(ctx,'assign',await itemVersion(fm)));
 const allocations=(await inspector.tailorWork({itemId})).data;assert.equal(allocations.length,2);
 const partial=allocations.map(row=>({item_tailor_quantity_id:row.item_tailor_quantity_id,quantity:1}));
 await inspector.inspectJobsheet(itemId,partial,null,command(ctx,'inspect-partial',await itemVersion(inspector)));
 const partialPay=await fm.tailorEarnings(tailor.id,{weekStart:period.weekStart,includeTeam:true},{limit:1});
 assert.equal(partialPay.summary.completed,2);assert.equal(partialPay.summary.pending,2);assert.equal(Number(partialPay.summary.amount),70);
 assert.ok(partialPay.next_cursor);const nextPay=await fm.tailorEarnings(tailor.id,{weekStart:period.weekStart,includeTeam:true},{limit:1,cursor:partialPay.next_cursor});
 assert.deepEqual(partialPay.summary,nextPay.summary);assert.notEqual(partialPay.data[0].id,nextPay.data[0].id);
 await assert.rejects(fm.archivePerson(sub.id,label+' unfinished',command(ctx,'archive-unfinished-denied',(await fm.person(sub.id)).version)),denied('unavailable'));
 const board=(await fm.tailorLeaderboard(null,{from:period.from,before:period.before},{limit:100})).data;
 for(const id of [tailor.id,sub.id]){
  const earning=await fm.tailorEarnings(id,{weekStart:period.weekStart});const ranking=board.find(x=>x.id===id);assert.ok(ranking);
  assert.equal(earning.summary.completed,1);assert.equal(ranking.completed,earning.summary.completed);assert.equal(Number(ranking.amount),Number(earning.summary.amount));assert.equal(Number(ranking.amount),35);
 }
 await assert.rejects(customer.tailorEarnings(tailor.id,{weekStart:period.weekStart}),denied('forbidden'));
 checks.push('partial_factory_work_exact_legacy_payroll_leaderboard_agreement_pagination_and_archive_guard');

 await inspector.inspectJobsheet(itemId,partial,null,command(ctx,'inspect-balance',await itemVersion(inspector)));
 const completePay=await fm.tailorEarnings(tailor.id,{weekStart:period.weekStart,includeTeam:true});
 assert.equal(completePay.summary.completed,4);assert.equal(completePay.summary.pending,0);assert.equal(Number(completePay.summary.amount),140);
 let renamed=await fm.saveTailor(tailor.id,{name:label+' renamed tailor'},command(ctx,'rename-tailor',(await fm.person(tailor.id)).version));
 assert.equal(renamed.id,tailor.id);assert.deepEqual((await fm.tailorEarnings(tailor.id,{weekStart:period.weekStart,includeTeam:true})).summary,completePay.summary);
 const beforeArchive=(await inspector.tailorWork({itemId,history:true})).data;
 assert.equal(beforeArchive.reduce((sum,row)=>sum+row.inspected,0),4);
 const subArchived=await fm.archivePerson(sub.id,label+' finished subject',command(ctx,'archive-subtailor',(await fm.person(sub.id)).version));assert.equal(subArchived.state,'archived');
 const parentArchived=await fm.archivePerson(tailor.id,label+' finished parent',command(ctx,'archive-tailor',(await fm.person(tailor.id)).version));assert.equal(parentArchived.state,'archived');
 assert.deepEqual((await inspector.tailorWork({itemId,history:true})).data,beforeArchive);
 const currentWork=(await inspector.tailorWork({itemId})).data;assert.deepEqual(currentWork.map(x=>x.tailor_id).sort(),[tailor.id,sub.id].sort());assert.equal(currentWork.reduce((sum,x)=>sum+x.inspected,0),4);
 checks.push('completed_managed_subject_rename_and_archive_preserve_work_ids_quantities_and_history');

 const destination=await di.saveDispatchDestination(orderId,'customer',label+' first destination',command(ctx,'destination-customer',(await di.order(orderId)).version));
 assert.equal(destination.destination.mode,'customer');
 const first=await di.recordDispatch(itemId,[{quantity_id:quantityId,quantity:1}],null,command(ctx,'dispatch-first',await itemVersion(di)));
 own(ctx,'dispatch_history',first.history_id);assert.equal(first.progress.order_completed,false);
 await di.saveDispatchDestination(orderId,'ho',label+' remaining destination',command(ctx,'destination-ho',(await di.order(orderId)).version));
 const last=await di.recordDispatch(itemId,[{quantity_id:quantityId,quantity:3}],null,command(ctx,'dispatch-balance',await itemVersion(di)));
 own(ctx,'dispatch_history',last.history_id);assert.equal(last.progress.order_completed,true);assert.equal(last.progress.dispatched,4);
 const deliveries=(await di.deliveries({order_id:orderId},{limit:20})).data;
 const firstDelivery=deliveries.find(x=>x.id===first.history_id),lastDelivery=deliveries.find(x=>x.id===last.history_id);
 assert.ok(firstDelivery&&lastDelivery);assert.equal(firstDelivery.quantity,1);assert.equal(firstDelivery.destination.mode,'customer');assert.equal(lastDelivery.quantity,3);assert.equal(lastDelivery.destination.mode,'ho');
 const challanSpec={item_id:itemId,dispatch_id:first.history_id,delivery:'download'},challanKey=ctx.commandKey('workforce.challan');
 const challan=await di.requestDocument('delivery_challan',challanSpec,challanKey);assert.equal(challan.state,'queued');assert.deepEqual(await di.requestDocument('delivery_challan',challanSpec,challanKey),challan);
 entities.documentIds.push(own(ctx,'document',challan.id));
 const challanDetail=await di.document(challan.id);assert.equal(challanDetail.state,'queued');
 await assert.rejects(customer.requestDocument('delivery_challan',challanSpec,ctx.commandKey('workforce.customer-challan-denied')),denied('forbidden'));
 entities.selectedDispatchId=first.history_id;entities.selectedDispatchQuantity=1;
 checks.push('dispatch_destination_snapshots_and_selected_partial_dispatch_challan_request_retry');

 // Use the still-active original factory tailor: archiving the extra subjects
 // intentionally makes them unavailable for newly requested payroll reports.
 const weeklySpec={tailor_id:String(f.actors[5]),week_start:period.weekStart,include_team:true,delivery:'download'};
 const weeklyKey=ctx.commandKey('workforce.weekly'),weekly=await fm.requestDocument('tailor_weekly',weeklySpec,weeklyKey);
 assert.equal(weekly.state,'queued');assert.deepEqual(await fm.requestDocument('tailor_weekly',weeklySpec,weeklyKey),weekly);
 entities.documentIds.push(own(ctx,'document',weekly.id));assert.equal((await fm.document(weekly.id)).state,'queued');
 await assert.rejects(di.requestDocument('tailor_weekly',weeklySpec,ctx.commandKey('workforce.di-weekly-denied')),denied('forbidden'));
 checks.push('explicit_kolkata_weekly_payroll_document_queued_once_for_download_with_role_denial');
 return {checks,entities,expected:{quantity:4,payrollAmount:'140',selectedDispatchQuantity:1,documentsQueued:2},scope:'Shared-SDK managed subjects, work, payroll, leaderboard, destination and document-request contracts. No document rendering, delivery or Auth enrollment.'};
}
