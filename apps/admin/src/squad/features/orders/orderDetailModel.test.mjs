import test from 'node:test';import assert from 'node:assert/strict';
import {headerRows,orderedActions,actionLabel} from './orderDetailModel.js';
const fmt={date:v=>String(v),money:v=>`Rs${v}`};
test('header rows follow Flutter order and role-gate money/assignment',()=>{
  const sc=headerRows({id:5,created_at:'c',due_on:'d',dispatch_destination:{mode:'ho'},total_quantity:10,dispatched_quantity:2,total_amount:'99',factory_manager_id:null,worker_id:'7'},'Pending',fmt);
  assert.deepEqual(sc.map(r=>r[0]),['Order No','Created','Due on','Dispatch to','Order Status','Total Quantity','DELIVERED','Total Order Value','FACTORY MANAGER','JOB WORKER']);
  assert.equal(sc.find(r=>r[0]==='Dispatch to')[1],'Head office');assert.equal(sc.find(r=>r[0]==='FACTORY MANAGER')[1],'Yet to be assigned');assert.equal(sc.find(r=>r[0]==='JOB WORKER')[1],'Assigned');
  const worker=headerRows({id:5,total_quantity:1},'Pending',fmt).map(r=>r[0]);assert.ok(!worker.includes('Total Order Value')&&!worker.includes('FACTORY MANAGER'));
});
test('Flutter action buttons lead and are relabelled only in persona mode',()=>{
  assert.deepEqual(orderedActions({payment:true,due:true,cancel:true,edit:true,complete:false}),['edit','cancel','due','payment']);
  assert.equal(actionLabel('edit','Amend order',true),'EDIT ORDER');assert.equal(actionLabel('edit','Amend order',false),'Amend order');assert.equal(actionLabel('payment','Record payment',true),'Record payment');
});
