/** Three additional commercial compositions through the actual shared SDK.
 * The common harness owns Auth, exact-owned fixtures and cleanup. No provider
 * worker is invoked; the mixed order's queued integration is not completion.
 */
import assert from 'node:assert/strict';
import {SquadError} from '../../packages/shared/squad.js';

const denied = kind => error => error instanceof SquadError && error.kind === kind;
const cents = value => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  assert.ok(match && (!match[2] || !/[1-9]/.test(match[2].slice(2))));
  return BigInt(match[1])*100n + BigInt((match[2] || '').padEnd(2,'0').slice(0,2));
};
const sdkFor = (ctx, role) => {
  const sdk = ctx.clients.get(role)?.sdk; assert.ok(sdk); return sdk;
};
const idFor = (ctx, role) => String(ctx.clients.get(role).me.id);
const command = (ctx, label, expectedVersion = null) => ({
  expectedVersion, idempotencyKey:ctx.commandKey(`commercial-extras.${label}`),
});
const own = (ctx, kind, id) => { assert.ok(id); ctx.record?.(kind,String(id)); return String(id); };

export async function runJourney(ctx) {
  const f=ctx.fixture, extra=f.commercialExtras;
  assert.ok(extra?.rmpSkuId && extra.coordinatorId && extra.mixedCustomerId && extra.mixedAddressId);
  const admin=sdkFor(ctx,0),sc=sdkFor(ctx,1),customer=sdkFor(ctx,3),dealer=sdkFor(ctx,10);
  const customerId=idFor(ctx,3),coordinatorId=idFor(ctx,1),dealerId=idFor(ctx,10);
  const checks=[],entities={};

  // A separate already-reviewed direct subject keeps this provider-bound order
  // independent of the authenticated customer's later dealer conversion.
  const subject=await sc.person(extra.mixedCustomerId);
  assert.equal(subject.approved,true); assert.equal(subject.direct_deal,true);
  assert.equal(subject.coordinator_id,coordinatorId);
  const preset=await sc.configureProduct(f.customConfig,f.label+' mixed preset','',ctx.commandKey('commercial-extras.mixed-preset'));
  entities.presetId=own(ctx,'preset',preset.id);
  const request={customer_id:extra.mixedCustomerId,address_id:extra.mixedAddressId,lines:[
    {kind:'custom',configuration:f.customConfig,quantities:[{size_id:String(f.ids.sizeId),quantity:2}]},
    {kind:'rmp',skus:[{sku_id:extra.rmpSkuId,quantity:3}]},
  ]};
  const quote=await sc.quote(request);entities.quoteId=own(ctx,'quote',quote.quote_id);
  assert.equal(quote.lines.length,2);assert.equal(quote.quantity,5);assert.equal(cents(quote.total),130200n);
  assert.equal(cents(quote.lines[0].variants[0].unit_price),50000n);
  assert.equal(cents(quote.lines[1].variants[0].unit_price),8000n);
  const overrideKey=command(ctx,'mixed-override',quote.version);
  const overridden=await sc.overrideQuote(quote.quote_id,1,'450',f.label+' approved mixed price',overrideKey);
  assert.deepEqual(await sc.overrideQuote(quote.quote_id,1,'450',f.label+' approved mixed price',overrideKey),overridden);
  assert.equal(cents(overridden.total),119700n);assert.equal(cents(overridden.subtotal),114000n);
  assert.equal(cents(overridden.cgst),2850n);assert.equal(cents(overridden.sgst),2850n);assert.equal(cents(overridden.igst),0n);
  assert.equal(cents(overridden.lines[0].variants[0].unit_price),45000n);
  assert.equal(cents(overridden.lines[0].variants[0].calculated_unit_price),50000n);
  const details={due_at:f.dueAt,comment:f.label+' mixed acceptance',line_settings:{'1':{product_id:preset.id}}};
  const placeKey=command(ctx,'mixed-place',overridden.version);
  const placed=await sc.placeOrder(overridden.quote_id,details,placeKey);
  assert.deepEqual(await sc.placeOrder(overridden.quote_id,details,placeKey),placed);
  assert.equal(placed.orders.length,1);assert.equal(cents(placed.total_amount),cents(overridden.total));
  const order=placed.orders[0];entities.mixedOrderId=own(ctx,'order',order.id);
  assert.equal(order.items.length,2);assert.equal(order.integration_status,'queued');
  entities.mixedItemIds=order.items.map(item=>own(ctx,'item',item.item_id));
  const viewed=await sc.order(order.id);
  assert.equal(cents(viewed.total_amount),119700n);assert.equal(viewed.total_quantity,5);
  assert.equal(viewed.items.data.length,2);assert.equal(viewed.items.next_cursor,null);
  const custom=viewed.items.data.find(item=>item.type===0),rmp=viewed.items.data.find(item=>item.type===1);
  assert.ok(custom && rmp);assert.equal(custom.product_id,preset.id);assert.equal(rmp.product_id,null);
  assert.equal(custom.total_quantity,2);assert.equal(rmp.total_quantity,3);
  assert.equal(cents(custom.unit_amount),45000n);assert.equal(cents(custom.total_amount),90000n);
  assert.equal(cents(rmp.unit_amount),8000n);assert.equal(cents(rmp.total_amount),24000n);
  for(const [item,quantity] of [[custom,2],[rmp,3]]){
    assert.equal(item.quantities.length,1);assert.equal(item.quantities[0].size_id,String(f.ids.sizeId));
    assert.equal(item.quantities[0].quantity,quantity);assert.equal(item.quantities[0].dispatched,0);
  }
  await assert.rejects(customer.order(order.id),denied('not_found'));
  checks.push('sc_mixed_quote_override_acceptance_preserves_money_one_order_and_two_typed_children');

  const before=await admin.person(customerId);assert.equal(before.coordinator_id,coordinatorId);
  const reason=f.label+' coordinator request';
  const requestKey=ctx.commandKey('commercial-extras.coordinator-request');
  const change=await customer.requestCoordinator(extra.coordinatorId,reason,requestKey);
  entities.coordinatorRequestId=own(ctx,'coordinator_request',change.id);
  assert.deepEqual(await customer.requestCoordinator(extra.coordinatorId,reason,requestKey),change);
  assert.equal(change.state,'pending');assert.equal(change.requested_coordinator_id,extra.coordinatorId);
  const pending=await customer.coordinatorRequests({state:'pending'},{limit:10});
  assert.ok(pending.data.some(row=>row.id===change.id && row.customer_id===customerId));
  const adminPending=await admin.coordinatorRequests({state:'pending',customerId},{limit:10});
  const current=adminPending.data.find(row=>row.id===change.id);assert.ok(current);
  await assert.rejects(customer.decideCoordinatorRequest(change.id,'approved',f.label,current.customer_version,
    command(ctx,'customer-decision-denied',current.version)),denied('forbidden'));
  const decisionKey=command(ctx,'coordinator-rejection',current.version),decisionReason=f.label+' keep current coordinator';
  const rejected=await admin.decideCoordinatorRequest(change.id,'rejected',decisionReason,current.customer_version,decisionKey);
  assert.equal(rejected.state,'rejected');assert.equal(rejected.assignment,null);
  assert.deepEqual(await admin.decideCoordinatorRequest(change.id,'rejected',decisionReason,current.customer_version,decisionKey),rejected);
  assert.equal((await admin.person(customerId)).coordinator_id,coordinatorId);
  assert.equal((await customer.person(customerId)).coordinator_id,coordinatorId);
  assert.ok((await customer.coordinatorRequests({state:'rejected'},{limit:10})).data.some(row=>row.id===change.id));
  assert.ok(!(await customer.coordinatorRequests({state:'pending'},{limit:10})).data.some(row=>row.id===change.id));
  checks.push('customer_coordinator_request_list_admin_rejection_retry_preserves_original_owner');

  assert.match(extra.createdCustomerEmail,/^squad-business-[a-f0-9]+-dealer-customer@mailinator\.com$/);
  const fields={name:f.label+' dealer customer',email:extra.createdCustomerEmail};
  const customerKey=command(ctx,'dealer-customer');
  const created=await dealer.savePerson(null,3,fields,customerKey);
  entities.createdCustomerId=own(ctx,'person',created.id);entities.accountRequestId=own(ctx,'account_request',created.account_request_id);
  assert.equal(created.account,'queued');assert.deepEqual(await dealer.savePerson(null,3,fields,customerKey),created);
  let person=await dealer.person(created.id);
  assert.equal(person.approved,true);assert.equal(person.onboarded,true);assert.equal(person.registered_by,2);
  assert.deepEqual(person.dealer_ids,[dealerId]);assert.equal(person.coordinator_id,coordinatorId);
  const addressFields={address:f.label+' dealer customer street',state:'Karnataka',city:f.label+' city',zip_code:'560001',is_primary:true};
  const addressKey=command(ctx,'dealer-customer-address');
  const address=await dealer.saveAddress(null,created.id,addressFields,addressKey);
  entities.addressId=own(ctx,'address',address.id);
  assert.deepEqual(await dealer.saveAddress(null,created.id,addressFields,addressKey),address);
  person=await dealer.person(created.id);
  assert.ok(person.addresses.some(row=>row.id===address.id && row.address===addressFields.address && row.is_primary===true));
  const coordinatorView=await sc.person(created.id);
  assert.equal(coordinatorView.coordinator_id,coordinatorId);
  assert.ok(coordinatorView.addresses.some(row=>row.id===address.id));
  await assert.rejects(customer.person(created.id),denied('not_found'));
  checks.push('dealer_customer_creation_retry_auto_approval_relationship_and_scoped_address_read');
  return {checks,entities,scope:'Authenticated shared SDK; mixed integration and created-customer enrollment are queued only. No provider or Auth provisioning worker is invoked.'};
}
