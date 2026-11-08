/** Real shared-SDK factory sequence; no table access or provider invocation. */
import assert from 'node:assert/strict';
import {SquadError} from '../../packages/shared/squad.js';
export async function runJourney(ctx){
 const fm=ctx.clients.get(4).sdk,cm=ctx.clients.get(9).sdk,inspector=ctx.clients.get(8).sdk,dispatch=ctx.clients.get(7).sdk;
 const orderId=ctx.commercial.entities.factoryOrderId,itemId=ctx.commercial.entities.factoryItemId;
 const required=ctx.commercial.expected.factoryQuantity;assert.ok(Number.isInteger(required)&&required>=3);
 const id=role=>ctx.clients.get(role)?.me.id??String(ctx.fixture.actors[role]);
 const command=(label,expectedVersion)=>({idempotencyKey:ctx.commandKey('factory.'+label),expectedVersion});
 const invalid=e=>e instanceof SquadError&&e.kind==='validation';
 const version=async sdk=>(await sdk.orderItem(itemId)).version;
 const checks=[];
 await fm.assignCutter(itemId,id(9),ctx.fixture.label+' cutter',command('assign-cutter',await version(fm)));
 const quantity=(await cm.orderItem(itemId)).records.data[0];assert.equal(Number(quantity.quantity),required);const quantityId=quantity.id;
 const cutRows=n=>[{quantity_id:quantityId,quantity:n}];
 const cutKey=command('cut-partial',await version(cm));
 const cut=await cm.recordCutting(itemId,cutRows(1),null,cutKey);
 assert.deepEqual(await cm.recordCutting(itemId,cutRows(1),null,cutKey),cut);
 await assert.rejects(cm.recordCutting(itemId,cutRows(required),null,command('cut-overrun',await version(cm))),invalid);
 const balance=await cm.recordCutting(itemId,cutRows(required-1),null,command('cut-balance',await version(cm)));
 assert.equal(balance.progress.cut,required);
 const history=await cm.cuttingDetail(itemId,{limit:1});assert.equal(history.history.data.length,1);assert.ok(history.history.next_cursor);
 const next=await cm.cuttingDetail(itemId,{limit:1,historyCursor:history.history.next_cursor});assert.equal(next.history.data.length,1);assert.notEqual(next.history.data[0].id,history.history.data[0].id);
 checks.push('cutter_partial_balance_exact_retry_overrun_denial_and_history_cursor');
 const allocations=[{quantity_id:quantityId,tailor_id:id(5),quantity:1},{quantity_id:quantityId,tailor_id:id(6),quantity:required-1}];
 const assignKey=command('assign-tailors',await version(fm));
 const assigned=await fm.assignJobsheet(itemId,allocations,ctx.fixture.dueAt,ctx.fixture.completionBy,assignKey);
 assert.deepEqual(await fm.assignJobsheet(itemId,allocations,ctx.fixture.dueAt,ctx.fixture.completionBy,assignKey),assigned);
 await assert.rejects(fm.assignJobsheet(itemId,[allocations[0]],ctx.fixture.dueAt,ctx.fixture.completionBy,command('assign-overrun',await version(fm))),invalid);
 const progress=await fm.productionProgress(orderId);assert.equal(progress.assigned_complete,true);assert.equal(progress.sewn_complete,false);
 const rows=(await inspector.tailorWork({itemId})).data;assert.equal(rows.length,2);
 const counts=new Map([[id(5),1],[id(6),required-1]]);
 for(const row of rows){
  assert.equal(row.assigned,counts.get(row.tailor_id));
  const inspectRows=[{item_tailor_quantity_id:row.item_tailor_quantity_id,quantity:row.assigned}];
  const key=command('inspect-'+row.tailor_id,await version(inspector));
  const result=await inspector.inspectJobsheet(itemId,inspectRows,null,key);
  assert.deepEqual(await inspector.inspectJobsheet(itemId,inspectRows,null,key),result);
 }
 await assert.rejects(inspector.inspectJobsheet(itemId,[{item_tailor_quantity_id:rows[0].item_tailor_quantity_id,quantity:1}],null,command('inspect-overrun',await version(inspector))),invalid);
 const picked=(await inspector.tailorWork({itemId,history:true})).data;
 assert.equal(picked.reduce((sum,row)=>sum+row.inspected,0),required);assert.ok(picked.every(row=>row.picked===row.inspected));
 assert.equal((await fm.productionProgress(orderId)).sewn_complete,true);
 checks.push('factory_tailor_subtailor_allocation_retry_inspection_pick_and_rollups');
 const firstKey=command('dispatch-partial',await version(dispatch));const first=await dispatch.recordDispatch(itemId,cutRows(1),null,firstKey);
 assert.deepEqual(await dispatch.recordDispatch(itemId,cutRows(1),null,firstKey),first);assert.equal(first.progress.order_completed,false);
 await assert.rejects(dispatch.recordDispatch(itemId,cutRows(required),null,command('dispatch-overrun',await version(dispatch))),invalid);
 const lastKey=command('dispatch-balance',await version(dispatch));const last=await dispatch.recordDispatch(itemId,cutRows(required-1),null,lastKey);
 assert.deepEqual(await dispatch.recordDispatch(itemId,cutRows(required-1),null,lastKey),last);
 assert.deepEqual(last.progress,{required,cut:required,assigned:required,sewn:required,dispatched:required,order_completed:true});
 const final=await dispatch.order(orderId);assert.equal(final.status,1);assert.equal(final.dispatched_quantity,required);
 const deliveries=await dispatch.dispatchDetail(itemId);assert.equal(deliveries.history.data.length,2);
 checks.push('dispatch_partial_twice_exact_retry_overrun_denial_and_completed_order');
 return {checks,entities:{orderId,itemId,quantityId,managedTailorIds:[id(5),id(6)]},finalProgress:last.progress};
}
