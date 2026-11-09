/** Authenticated commercial acceptance; the common runner owns sessions and cleanup.
 * No direct table reads, service credentials, providers or worker invocation here.
 */
import assert from 'node:assert/strict';
import {SquadError} from '../../packages/shared/squad.js';

const denied = kind => error => error instanceof SquadError && error.kind === kind;
const cents = value => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  assert.ok(match, 'Expected a nonnegative decimal amount');
  assert.ok(!match[2] || !/[1-9]/.test(match[2].slice(2)), 'Expected exact currency precision');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0').slice(0, 2));
};
const sdkFor = (ctx, role) => {
  const client = ctx.clients.get(role);
  assert.ok(client?.sdk, `Missing authenticated role ${role}`);
  return client.sdk;
};
const idFor = (ctx, role) => String(ctx.clients.get(role).me.id);
const command = (ctx, label, expectedVersion = null) => ({expectedVersion, idempotencyKey:ctx.commandKey(`commercial.${label}`)});
const own = (ctx, kind, id) => { assert.ok(id); ctx.record?.(kind, String(id)); return String(id); };
const datePlus = (iso, days) => new Date(new Date(iso).valueOf() + days * 86400000).toISOString();

export async function runJourney(ctx) {
  const admin = sdkFor(ctx,0), sc = sdkFor(ctx,1), pc = sdkFor(ctx,2), customer = sdkFor(ctx,3), team = sdkFor(ctx,12);
  const fixture = ctx.fixture, label = fixture.label;
  assert.ok(label && fixture.customConfig && fixture.ids.customerAddressId && fixture.ids.sizeId);
  const customerId = idFor(ctx,3), coordinatorId = idFor(ctx,1), managerId = idFor(ctx,4), workerId = idFor(ctx,11);
  const dueAt = fixture.dueAt || datePlus(new Date().toISOString(),14);
  const periodStart = fixture.periodStart || new Date().toISOString().slice(0,10);
  const periodEnd = fixture.periodEnd || datePlus(periodStart+'T00:00:00Z',30).slice(0,10);
  const checks = [], entities = {quoteIds:[],orderIds:[],itemIds:[],ratingIds:[]};
  const custom = quantity => ({kind:'custom',configuration:fixture.customConfig,quantities:[{size_id:String(fixture.ids.sizeId),quantity}]});
  const request = quantity => ({customer_id:customerId,address_id:String(fixture.ids.customerAddressId),lines:[custom(quantity)]});
  const quote = async (sdk,quantity) => {
    const value = await sdk.quote(request(quantity));
    entities.quoteIds.push(own(ctx,'quote',value.quote_id));
    assert.equal(cents(value.total),BigInt(quantity)*52500n);
    assert.equal(cents(value.lines[0].variants[0].unit_price),50000n);
    assert.equal(value.quantity,quantity);
    return value;
  };

  // Approval does not imply enrollment: this controlled pending subject has no
  // Auth identity and remains separate from the already-authenticated Customer.
  const pendingId = String(fixture.reviewCustomerId);
  let pending = await admin.person(pendingId);
  assert.equal(pending.approved,false); assert.equal(pending.onboarded,false);
  let reviewed = await admin.reviewCustomer(pendingId,{onboarded:true},label+' onboarding',command(ctx,'onboard',pending.version));
  assert.equal(reviewed.onboarded,true); assert.equal(reviewed.approved,false);
  reviewed = await admin.reviewCustomer(pendingId,{approved:true},label+' approval',command(ctx,'approve',reviewed.version));
  assert.equal(reviewed.approved,true);
  const linked = await admin.saveCustomerLinks(pendingId,{coordinatorId,dealerIds:[],direct:true},label+' direct relationship',command(ctx,'links',reviewed.version));
  assert.equal((await sc.person(pendingId)).coordinator_id,coordinatorId);
  assert.equal((await sc.person(pendingId)).direct_deal,true);
  await assert.rejects(customer.reviewCustomer(pendingId,{approved:true},label,command(ctx,'customer-review-denied',linked.version)),denied('forbidden'));
  checks.push('admin_onboarding_approval_and_sc_relationship_are_distinct');

  // Create one source staff record through the real service; enrollment is only
  // queued. The runner keeps outbound jobs paused and removes the exact request.
  assert.match(fixture.createdTeamEmail,/^squad-business-[a-f0-9]+-created-team@mailinator\.com$/);
  const staffFields = {name:label+' created team',email:fixture.createdTeamEmail};
  const staffKey = command(ctx,'create-team');
  const staff = await admin.savePerson(null,12,staffFields,staffKey);
  entities.createdTeamId = own(ctx,'person',staff.id);
  entities.accountRequestId = own(ctx,'account_request',staff.account_request_id);
  assert.equal(staff.account,'queued');
  assert.deepEqual(await admin.savePerson(null,12,staffFields,staffKey),staff);
  const features = [{key:'1',checked:true},{key:'2',checked:true},{key:'3',checked:true,children:[{key:'3.3',checked:true}]}];
  await admin.saveCapabilities(staff.id,features,label+' staff grants',command(ctx,'staff-grants',(await admin.person(staff.id)).version));
  let existingTeam = await admin.person(idFor(ctx,12));
  await admin.saveCapabilities(existingTeam.id,[],label+' revoke fixture grants',command(ctx,'team-revoke',existingTeam.version));
  assert.equal((await team.me()).capabilities.configure,false);
  await assert.rejects(team.configuratorOptions(fixture.customConfig.base_product_id,'fabrics'),denied('forbidden'));
  existingTeam = await admin.person(existingTeam.id);
  await admin.saveCapabilities(existingTeam.id,features,label+' current grants',command(ctx,'team-grant',existingTeam.version));
  assert.equal((await team.me()).capabilities.configure,true);
  assert.ok((await team.configuratorOptions(fixture.customConfig.base_product_id,'fabrics')).data.some(x=>x.id===fixture.customConfig.fabric_id));
  checks.push('admin_staff_creation_retry_and_live_team_permission_revoke_grant');

  const milestoneCommand = command(ctx,'milestone');
  const target = {subjectId:coordinatorId,start:periodStart,end:periodEnd,amount:'10000',name:label+' target'};
  const milestone = await admin.saveMilestone(target,milestoneCommand);
  entities.milestoneId = own(ctx,'milestone',milestone.id);
  assert.deepEqual(await admin.saveMilestone(target,milestoneCommand),milestone);
  const responsibility = (await admin.saveResponsibilities([{subject_id:coordinatorId,kind:1,note:label+' responsibility'}],ctx.commandKey('commercial.responsibility'))).items[0];
  entities.responsibilityId = own(ctx,'responsibility',responsibility.id);
  assert.equal((await sc.transitionResponsibility(responsibility.id,'completed',null,command(ctx,'responsibility-complete',responsibility.version))).state,'completed');
  assert.ok((await sc.responsibilities()).data.some(x=>x.id===responsibility.id && x.completed===true));
  checks.push('admin_target_and_responsibility_assignment_sc_completion');

  const presetKey = ctx.commandKey('commercial.configure');
  const preset = await customer.configureProduct(fixture.customConfig,label+' custom preset','',presetKey);
  entities.presetId = own(ctx,'preset',preset.id);
  assert.deepEqual(await customer.configureProduct(fixture.customConfig,label+' custom preset','',presetKey),preset);
  const firstQuote = await quote(customer,2);
  assert.ok(!('costs' in firstQuote.lines[0]));
  await assert.rejects(pc.quote(request(2)),denied('forbidden'));
  const details = {due_at:dueAt,comment:label,line_settings:{'1':{product_id:preset.id}}};
  const place = async (name,q) => {
    const key = command(ctx,name,q.version), result = await customer.placeOrder(q.quote_id,details,key);
    assert.deepEqual(await customer.placeOrder(q.quote_id,details,key),result);
    assert.equal(result.orders.length,1);
    const order = result.orders[0]; entities.orderIds.push(own(ctx,'order',order.id));
    entities.itemIds.push(own(ctx,'item',order.items[0].item_id));
    return order;
  };
  let factoryOrder = await place('place-factory',firstQuote);
  entities.factoryOrderId = factoryOrder.id;
  let orderView = await sc.order(factoryOrder.id);
  const paymentKey = command(ctx,'deposit',orderView.version);
  const payment = await sc.recordOrderPayment(factoryOrder.id,'partial','100',label+' deposit',paymentKey);
  assert.deepEqual(await sc.recordOrderPayment(factoryOrder.id,'partial','100',label+' deposit',paymentKey),payment);
  assert.equal(cents(payment.paid_amount),10000n);
  await assert.rejects(pc.recordOrderPayment(factoryOrder.id,'partial','100',label,command(ctx,'pc-payment-denied',(await pc.order(factoryOrder.id)).version)),denied('forbidden'));
  const editQuote = await quote(sc,3); assert.ok('costs' in editQuote.lines[0]);
  const editCommand = command(ctx,'amend',(await sc.order(factoryOrder.id)).version);
  const amended = await sc.editOrder(factoryOrder.id,editQuote.quote_id,editQuote.version,details,label+' quantity amended',editCommand);
  assert.equal(amended.state,'applied'); assert.equal(amended.id,factoryOrder.id);
  entities.amendmentId = own(ctx,'amendment',amended.amendment_id);
  entities.factoryItemId = own(ctx,'item',amended.items[0].item_id); entities.itemIds.push(entities.factoryItemId);
  assert.notEqual(entities.factoryItemId,factoryOrder.items[0].item_id);
  assert.equal(cents(amended.total_amount),157500n); assert.equal(cents(amended.paid_amount),10000n);
  assert.deepEqual(await sc.editOrder(factoryOrder.id,editQuote.quote_id,editQuote.version,details,label+' quantity amended',editCommand),amended);
  await assert.rejects(sc.saveOrderDue(factoryOrder.id,dueAt,label,command(ctx,'stale-due',editCommand.expectedVersion)),denied('conflict'));
  const prime = await sc.saveOrderPriority(factoryOrder.id,true,label+' priority',command(ctx,'priority',(await sc.order(factoryOrder.id)).version)); assert.equal(prime.is_prime,true);
  await sc.saveOrderDue(factoryOrder.id,datePlus(dueAt,1),label+' customer due date',command(ctx,'due',prime.version));
  await pc.assignFactory(factoryOrder.id,managerId,label+' factory allocation',command(ctx,'factory',(await pc.order(factoryOrder.id)).version));
  const criteria = await pc.orderItem(entities.factoryItemId,'criteria'); assert.ok(criteria.records.data.length>=2);
  await pc.saveCriteria(entities.factoryItemId,criteria.records.data.map(x=>({id:x.id,checked:true})),command(ctx,'criteria',(await pc.orderItem(entities.factoryItemId)).version));
  const pcOrder = await pc.order(factoryOrder.id); assert.equal(cents(pcOrder.total_amount),157500n); assert.ok(!('paid_amount' in pcOrder));
  checks.push('customer_configuration_quote_place_retry_sc_payment_and_amendment_pc_factory_assignment');

  const workerOrder = await place('place-worker',await quote(customer,2));
  entities.workerOrderId = workerOrder.id; entities.workerItemId = workerOrder.items[0].item_id;
  await pc.assignWorker(workerOrder.id,workerId,dueAt,label+' outsourced work',command(ctx,'worker',(await pc.order(workerOrder.id)).version));
  await pc.saveWorkerCost(entities.workerItemId,'12.345',label+' agreed worker unit cost',command(ctx,'worker-cost',(await pc.orderItem(entities.workerItemId)).version));
  await sdkFor(ctx,11).saveWorkerDue(workerOrder.id,datePlus(dueAt,2),label+' worker due date',command(ctx,'worker-due',(await sdkFor(ctx,11).order(workerOrder.id)).version));
  const workerItem = await sdkFor(ctx,11).orderItem(entities.workerItemId);
  assert.equal(workerItem.worker_unit_cost,'12.345'); assert.equal(cents(workerItem.worker_total_cost),2469n);
  assert.ok(!('unit_amount' in workerItem)); assert.ok(!('total_amount' in await sdkFor(ctx,11).order(workerOrder.id)));
  assert.equal(cents((await customer.order(workerOrder.id)).total_amount),105000n);
  checks.push('pc_worker_assignment_due_cost_and_worker_selling_price_redaction');

  const exceptionOrder = await place('place-force-close',await quote(customer,2));
  entities.forceOrderId = exceptionOrder.id;
  const beforeForce = await admin.order(exceptionOrder.id);
  await assert.rejects(sc.forceCompleteOrder(exceptionOrder.id,label,command(ctx,'sc-force-denied',beforeForce.version)),denied('forbidden'));
  const forced = await admin.forceCompleteOrder(exceptionOrder.id,label+' controlled exception',command(ctx,'force-close',beforeForce.version)); assert.equal(forced.force_completed,true);
  const afterForce = await customer.order(exceptionOrder.id);
  assert.equal(afterForce.status,1); assert.equal(afterForce.dispatched_quantity,0); assert.equal(cents(afterForce.total_amount),105000n);
  checks.push('admin_exception_closure_preserves_undispatched_quantity');

  // Reports use the server's current Kolkata reporting window; target dates may
  // extend into the future and therefore are not a valid historical report range.
  const report = await admin.salesReport('customers',{}, {customer_id:customerId},{limit:10});
  assert.equal(report.data.length,1); assert.equal(report.data[0].id,customerId); assert.equal(report.data[0].orders,3);
  await assert.rejects(sc.salesReport('customers',{}, {customer_id:customerId}),denied('forbidden'));
  const progress = await sc.milestoneProgress(milestone.id);
  assert.equal(progress.order_count,3); assert.equal(cents(progress.placed_amount),367500n); assert.equal(cents(progress.completed_amount),105000n);
  checks.push('admin_scoped_report_and_sc_target_reflect_three_actual_orders');
  return {checks,entities,expected:{factoryQuantity:3,factoryTotal:'1575',paidAmount:'100',dueAt},scope:'Commercial mutations via authenticated shared SDK; factory completion and ratings follow in finishJourney.'};
}

export async function finishJourney(ctx,result) {
  const {entities,checks} = result;
  for (const [role,target] of [[3,1],[1,2],[2,4]]) {
    const sdk = sdkFor(ctx,role), fields = {score:'4.5',positive_comments:ctx.fixture.label+' completed journey'};
    const key = command(ctx,`rating-${role}`);
    const rating = await sdk.saveRating(null,'Order',entities.factoryOrderId,null,fields,key);
    entities.ratingIds.push(own(ctx,'rating',rating.id));
    assert.equal(rating.to_id,idFor(ctx,target));
    assert.deepEqual(await sdk.saveRating(null,'Order',entities.factoryOrderId,null,fields,key),rating);
    assert.ok((await sdk.ratings('Order',entities.factoryOrderId)).data.some(x=>x.id===rating.id));
  }
  const order = await sdkFor(ctx,3).order(entities.factoryOrderId);
  assert.equal(order.status,1); assert.equal(order.dispatched_quantity,3);
  assert.equal(cents(order.total_amount),157500n); assert.equal(cents(order.paid_amount),10000n);
  checks.push('completed_factory_order_rating_chain_customer_sc_pc_and_unchanged_financials');
  return {...result,scope:'Commercial creation, amendment, payment, factory completion and rating chain via authenticated shared SDK. Staff enrollment delivery and external warehouse acceptance are not exercised.'};
}
