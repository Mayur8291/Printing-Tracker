/** Authenticated Dealer / Job Worker / Team acceptance through the shared SDK.
 * The common harness owns fixtures, sessions, command keys and exact cleanup.
 * No direct table transport, provider calls or artificial stock receipts here.
 */
import assert from 'node:assert/strict';
import {SquadError} from '../../packages/shared/squad.js';

const denied = (...kinds) => error => error instanceof SquadError && kinds.includes(error.kind);
const sdkFor = (ctx, role) => {
  const entry = ctx.clients.get(role);
  assert.ok(entry?.sdk, `Missing authenticated role ${role}`);
  return entry.sdk;
};
const idFor = (ctx, role) => String(ctx.clients.get(role).me.id);
const command = (ctx, label, expectedVersion = null) => ({expectedVersion,idempotencyKey:ctx.commandKey(`collaboration.${label}`)});
const own = (ctx,kind,id) => { assert.ok(id);ctx.record?.(kind,String(id));return String(id); };
const datePlus = (iso,days) => new Date(new Date(iso).valueOf()+days*86400000).toISOString();
const cents = value => {
  const match=/^(\d+)(?:\.(\d+))?$/.exec(String(value));
  assert.ok(match,'Expected nonnegative currency');
  assert.ok(!/[1-9]/.test((match[2]??'').slice(2)),'Expected exact currency precision');
  return BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0').slice(0,2));
};

export async function runJourney(ctx) {
  const admin=sdkFor(ctx,0), pc=sdkFor(ctx,2), customer=sdkFor(ctx,3), dealer=sdkFor(ctx,10), worker=sdkFor(ctx,11), team=sdkFor(ctx,12);
  const f=ctx.fixture, label=f.label, dealerId=idFor(ctx,10), customerId=idFor(ctx,3), workerId=idFor(ctx,11), teamId=idFor(ctx,12);
  assert.ok(f.customConfig && f.ids.sizeId && f.ids.customerAddressId && f.ids.dealerAddressId);
  const commercial=ctx.journeys?.commercial ?? ctx.commercial;
  assert.ok(commercial?.entities?.workerOrderId && commercial.entities.workerItemId,'Commercial worker order must exist before collaboration');
  const dueAt=commercial.expected.dueAt;
  const checks=[], entities={orderIds:[],itemIds:[],presetIds:[],quoteIds:[],taskIds:[],responsibilityIds:[]};

  // Complete the actual direct customer job before converting its relationship.
  const directOrderId=commercial.entities.workerOrderId, directItemId=commercial.entities.workerItemId;
  const due1=await worker.saveWorkerDue(directOrderId,datePlus(dueAt,3),label+' material delay',command(ctx,'worker-due-3',(await worker.order(directOrderId)).version));
  assert.equal(due1.delta_days,3);assert.equal(due1.baseline_basis,'assignment');
  const due2=await worker.saveWorkerDue(directOrderId,datePlus(dueAt,4),label+' revised material delay',command(ctx,'worker-due-4',due1.version));
  assert.equal(due2.delta_days,4);assert.equal(due2.original_due_at,due1.original_due_at);
  const initialItem=await worker.orderItem(directItemId);
  await assert.rejects(worker.saveWorkerCost(directItemId,'99',label,command(ctx,'worker-cannot-set-cost',initialItem.version)),denied('forbidden'));
  await assert.rejects(worker.saveWorkerStage(directItemId,3,label,command(ctx,'worker-cannot-skip',initialItem.version)),denied('validation'));
  await assert.rejects(team.saveWorkerStage(directItemId,1,label,command(ctx,'team-cannot-progress',initialItem.version)),denied('forbidden'));

  const completeWorker=async(orderId,itemId,name,receiptExpected)=>{
    let item=await worker.orderItem(itemId), last;
    for(let stage=1;stage<=5;stage++) {
      const key=command(ctx,`${name}-stage-${stage}`,item.version);
      last=await worker.saveWorkerStage(itemId,stage,label+' production progress',key);
      assert.equal(last.stage,stage);
      if(stage===1 || stage===5)assert.deepEqual(await worker.saveWorkerStage(itemId,stage,label+' production progress',key),last);
      item={version:last.version};
    }
    assert.equal(last.order_completed,true);
    if(receiptExpected)assert.equal(last.stock_receipt.received,1);
    const order=await worker.order(orderId), quantities=await worker.orderItem(itemId);
    assert.equal(order.status,1);assert.equal(order.dispatched_quantity,0);
    assert.ok(!('total_amount' in order));assert.ok(!('unit_amount' in quantities));
    for(const row of quantities.records.data) {
      assert.equal(row.dispatched,0);assert.equal(row.cut,0);
    }
    return last;
  };
  await completeWorker(directOrderId,directItemId,'direct-worker',false);
  assert.equal((await customer.order(directOrderId)).status,1);
  checks.push('job_worker_due_baseline_sequential_stages_retry_and_cost_authority');
  checks.push('job_worker_completion_has_no_fabricated_factory_dispatch_or_customer_price');

  const person=await admin.person(customerId);
  const links=await admin.saveCustomerLinks(customerId,{coordinatorId:idFor(ctx,1),dealerIds:[dealerId],direct:false},label+' dealer relationship',command(ctx,'customer-dealer-link',person.version));
  assert.deepEqual(links.dealer_ids,[dealerId]);assert.equal(links.direct,false);
  const dealerPreset=await dealer.configureProduct(f.customConfig,label+' dealer supply','',ctx.commandKey('collaboration.dealer-preset'));
  const customerPreset=await customer.configureProduct(f.customConfig,label+' dealer demand','',ctx.commandKey('collaboration.customer-preset'));
  entities.presetIds.push(own(ctx,'preset',dealerPreset.id),own(ctx,'preset',customerPreset.id));
  assert.notEqual(dealerPreset.id,customerPreset.id,'Separate owners retain separate presets');

  const purchase=async(role,quantity,name,preset)=>{
    const sdk=sdkFor(ctx,role),address=role===10?f.ids.dealerAddressId:f.ids.customerAddressId;
    const quote=await sdk.quote({customer_id:idFor(ctx,role),address_id:String(address),lines:[{kind:'custom',configuration:f.customConfig,quantities:[{size_id:String(f.ids.sizeId),quantity}]}]});
    entities.quoteIds.push(own(ctx,'quote',quote.quote_id));assert.equal(quote.quantity,quantity);
    const details={due_at:dueAt,comment:label+' '+name,line_settings:{'1':{product_id:preset.id}}};
    const key=command(ctx,`${name}-place`,quote.version), result=await sdk.placeOrder(quote.quote_id,details,key);
    assert.deepEqual(await sdk.placeOrder(quote.quote_id,details,key),result);assert.equal(result.orders.length,1);
    const order=result.orders[0];entities.orderIds.push(own(ctx,'order',order.id));entities.itemIds.push(own(ctx,'item',order.items[0].item_id));
    const view=await sdk.order(order.id);assert.equal(cents(view.total_amount),cents(quote.total));
    return {id:order.id,itemId:order.items[0].item_id,quote};
  };
  const assignAndReceive=async(orderId,itemId,name)=>{
    await pc.assignWorker(orderId,workerId,dueAt,label+' dealer production',command(ctx,`${name}-assign`,(await pc.order(orderId)).version));
    await pc.saveWorkerCost(itemId,'12.345',label+' agreed dealer production cost',command(ctx,`${name}-cost`,(await pc.orderItem(itemId)).version));
    return completeWorker(orderId,itemId,name,true);
  };
  const stock=async(expected)=>{
    const page=await dealer.dealerStock({kind:'custom',product_id:dealerPreset.id},{},{limit:10});
    assert.equal(page.data.length,1);assert.equal(page.next_cursor,null);
    const row=page.data[0];assert.equal(row.available,expected);
    assert.equal(row.received-row.consumed,expected);
    return row;
  };

  const supply=await purchase(10,10,'dealer-supply',dealerPreset);
  await assignAndReceive(supply.id,supply.itemId,'dealer-supply');
  let balance=await stock(10);assert.equal(balance.received,10);assert.equal(balance.consumed,0);assert.equal(balance.receipt_count,1);
  await assert.rejects(dealer.dispatchDetail(supply.itemId),denied('not_found'));
  const customerStock=await customer.dealerStock({kind:'custom',product_id:customerPreset.id},{dealerId},{limit:10});
  assert.equal(customerStock.data.length,1);
  for(const field of ['received','consumed','receipt_count'])assert.ok(!(field in customerStock.data[0]));
  checks.push('dealer_purchase_worker_completion_creates_real_receipt_and_equivalent_preset_stock');

  const demand=await purchase(3,6,'customer-demand',customerPreset);
  let detail=await dealer.dispatchDetail(demand.itemId,{limit:1});
  assert.equal(detail.quantities.data.length,1);assert.equal(detail.quantities.next_cursor,null);
  assert.equal(detail.remaining_quantity,6);assert.equal(detail.available_to_dispatch,6);assert.equal(detail.stock_status,'ready');
  const quantityId=detail.quantities.data[0].id;
  await assert.rejects(customer.recordDispatch(demand.itemId,[{quantity_id:quantityId,quantity:2}],null,command(ctx,'customer-cannot-dispatch',detail.version)),denied('forbidden'));
  const firstKey=command(ctx,'dealer-partial-2',detail.version), firstRows=[{quantity_id:quantityId,quantity:2}];
  const first=await dealer.recordDispatch(demand.itemId,firstRows,null,firstKey);
  own(ctx,'dispatch_history',first.history_id);
  assert.equal(first.progress.order_completed,false);assert.equal(first.stock_allocations.reduce((sum,row)=>sum+row.quantity,0),2);
  assert.deepEqual(await dealer.recordDispatch(demand.itemId,firstRows,null,firstKey),first);
  await stock(8);
  detail=await dealer.dispatchDetail(demand.itemId,{limit:1});assert.equal(detail.remaining_quantity,4);assert.equal(detail.quantities.data[0].remaining,4);
  await assert.rejects(dealer.recordDispatch(demand.itemId,[{quantity_id:quantityId,quantity:1}],null,command(ctx,'stale-dispatch',firstKey.expectedVersion)),denied('conflict'));
  const final=await dealer.recordDispatch(demand.itemId,[{quantity_id:quantityId,quantity:4}],null,command(ctx,'dealer-final-4',detail.version));
  own(ctx,'dispatch_history',final.history_id);assert.equal(final.progress.order_completed,true);
  balance=await stock(4);assert.equal(balance.consumed,6);
  assert.equal((await customer.order(demand.id)).status,1);
  assert.equal(cents((await customer.order(demand.id)).total_amount),cents(demand.quote.total));
  const history=await dealer.dispatchDetail(demand.itemId,{limit:1});assert.equal(history.history.data.length,1);assert.ok(history.history.next_cursor);
  const history2=await dealer.dispatchDetail(demand.itemId,{limit:1,historyCursor:history.history.next_cursor});
  assert.equal(history2.history.data.length,1);assert.notEqual(history.history.data[0].id,history2.history.data[0].id);assert.equal(history2.history.next_cursor,null);
  checks.push('dealer_partial_and_final_dispatch_retry_stale_version_history_pagination_and_residual');

  const demand2=await purchase(3,7,'customer-shortage',customerPreset);
  const shortDetail=await dealer.dispatchDetail(demand2.itemId);assert.equal(shortDetail.stock_status,'partial');assert.equal(shortDetail.available_to_dispatch,4);
  await assert.rejects(dealer.recordDispatch(demand2.itemId,[{quantity_id:shortDetail.quantities.data[0].id,quantity:7}],null,command(ctx,'insufficient-stock',shortDetail.version)),denied('unavailable'));
  await stock(4);
  const preview=await dealer.previewBackorder([demand2.id],String(f.ids.dealerAddressId));
  own(ctx,'backorder_preview',preview.preview_id);own(ctx,'quote',preview.quote.quote_id);
  assert.equal(preview.requirements.length,1);assert.equal(preview.requirements[0].required,7);assert.equal(preview.requirements[0].available,4);assert.equal(preview.requirements[0].shortage,3);assert.equal(preview.quote.quantity,3);
  await assert.rejects(customer.previewBackorder([demand2.id],String(f.ids.dealerAddressId)),denied('forbidden'));
  const backKey=command(ctx,'backorder-place',preview.version), back=await dealer.placeBackorder(preview.preview_id,dueAt,backKey);
  assert.deepEqual(await dealer.placeBackorder(preview.preview_id,dueAt,backKey),back);assert.equal(back.orders.length,1);assert.ok(back.linked_order_versions[demand2.id]);
  const backOrder=back.orders[0], backItemId=backOrder.items[0].item_id;
  entities.orderIds.push(own(ctx,'order',backOrder.id));entities.itemIds.push(own(ctx,'item',backItemId));
  await assignAndReceive(backOrder.id,backItemId,'backorder');
  balance=await stock(7);assert.equal(balance.received,13);assert.equal(balance.consumed,6);assert.equal(balance.receipt_count,2);
  const ready=await dealer.dispatchDetail(demand2.itemId);assert.equal(ready.stock_status,'ready');assert.equal(ready.available_to_dispatch,7);
  const fulfilled=await dealer.recordDispatch(demand2.itemId,[{quantity_id:ready.quantities.data[0].id,quantity:7}],null,command(ctx,'dealer-backorder-7',ready.version));
  own(ctx,'dispatch_history',fulfilled.history_id);assert.equal(fulfilled.progress.order_completed,true);
  assert.deepEqual(fulfilled.stock_allocations.map(row=>row.quantity),[4,3]);
  balance=await stock(0);assert.equal(balance.received,13);assert.equal(balance.consumed,13);assert.equal(balance.receipt_count,2);
  assert.equal((await customer.order(demand2.id)).status,1);
  assert.equal(cents((await customer.order(demand2.id)).total_amount),cents(demand2.quote.total));
  checks.push('dealer_backorder_shortage_purchase_actual_receipt_fifo_fulfillment_and_zero_residual');

  // Feature changes act on current server authority; no token refresh hides a gap.
  const grant=async(role,features,name)=>admin.saveCapabilities(idFor(ctx,role),features,label+' '+name,command(ctx,name,(await admin.person(idFor(ctx,role))).version));
  await grant(11,[{key:'1',checked:true},{key:'2',checked:true}],'worker-notes-goals');
  await grant(12,[],'team-no-grants');
  await assert.rejects(team.tasks(),denied('forbidden'));
  await assert.rejects(team.responsibilities(),denied('forbidden'));
  const taskSpec={note:label+' worker handoff',deadline:datePlus(dueAt,5),assigneeIds:[idFor(ctx,2)]};
  const taskKey=command(ctx,'worker-task'),task=await worker.saveTask(taskSpec,taskKey);
  entities.taskIds.push(own(ctx,'task',task.id));assert.deepEqual(await worker.saveTask(taskSpec,taskKey),task);
  assert.equal((await pc.task(task.id)).creator_id,workerId);
  await assert.rejects(pc.saveTask({...taskSpec,id:task.id,note:label+' unauthorized edit'},command(ctx,'assignee-cannot-edit',task.version)),denied('forbidden'));
  await assert.rejects(pc.transitionTask(task.id,2,command(ctx,'assignee-cannot-archive',task.version)),denied('forbidden'));
  const completedTask=await pc.transitionTask(task.id,1,command(ctx,'assignee-complete',task.version));assert.equal(completedTask.state,1);
  const workerGoal=(await admin.saveResponsibilities([{subject_id:workerId,kind:1,note:label+' worker goal'}],ctx.commandKey('collaboration.worker-goal'))).items[0];
  entities.responsibilityIds.push(own(ctx,'responsibility',workerGoal.id));
  assert.equal((await worker.transitionResponsibility(workerGoal.id,'completed',null,command(ctx,'worker-goal-complete',workerGoal.version))).state,'completed');
  checks.push('worker_feature_grants_notes_assignee_authority_and_self_goal_completion');

  await grant(12,[{key:'1',checked:true}],'team-notes-only');
  await assert.rejects(team.responsibilities(),denied('forbidden'));
  const teamTask=await team.saveTask({note:label+' team task',deadline:datePlus(dueAt,5),assigneeIds:[]},command(ctx,'team-task'));
  entities.taskIds.push(own(ctx,'task',teamTask.id));assert.equal((await team.task(teamTask.id)).creator_id,teamId);
  await assert.rejects(team.task(task.id),denied('not_found'));
  await grant(12,[{key:'1',checked:true},{key:'2',checked:true}],'team-notes-goals');
  const teamGoal=(await admin.saveResponsibilities([{subject_id:teamId,kind:1,note:label+' team goal'}],ctx.commandKey('collaboration.team-goal'))).items[0];
  entities.responsibilityIds.push(own(ctx,'responsibility',teamGoal.id));
  await assert.rejects(team.transitionResponsibility(workerGoal.id,'completed',null,command(ctx,'team-cannot-complete-worker-goal',workerGoal.version)),denied('forbidden'));
  assert.equal((await team.transitionResponsibility(teamGoal.id,'completed',null,command(ctx,'team-goal-complete',teamGoal.version))).state,'completed');
  await grant(12,[{key:'2',checked:true}],'team-revoke-notes');
  await assert.rejects(team.task(teamTask.id),denied('forbidden'));
  assert.equal((await worker.task(task.id)).state,1);
  assert.ok((await team.responsibilities({kind:1,completed:true},{limit:10})).data.some(row=>row.id===teamGoal.id));
  checks.push('team_notes_and_goals_are_independent_grants_with_live_revocation_and_subject_isolation');
  return {checks,entities,scope:'Actual shared-SDK custom Dealer/Job Worker/Team commands, receipts, FIFO dispatch and backorder fulfillment. Ready-made provider fulfillment, notification delivery and UI are separate acceptance paths.'};
}
