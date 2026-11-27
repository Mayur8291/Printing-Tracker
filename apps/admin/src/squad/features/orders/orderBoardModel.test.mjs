import test from 'node:test';import assert from 'node:assert/strict';
import {boardScope,boardCriteria,boardLabels,boardTabFilter,boardDrillable,boardOpenPath} from './orderBoardModel.js';
test('dealer splits Placed Orders from My Orders; others see everything in scope',()=>{
  assert.deepEqual(boardScope({role:10,id:'9'},'?scope=own'),{scope:'own',filters:{customer_id:'9'}});
  assert.deepEqual(boardScope({role:10,id:'9'},''),{scope:'placed',filters:{placed_for_me:true}});
  assert.deepEqual(boardScope({role:1,id:'9'},'?scope=own'),{scope:'all',filters:{}});
});
test('criteria tile only for PC, FM and dispatch; labels follow Flutter',()=>{
  assert.ok(boardCriteria(2)&&boardCriteria(4)&&boardCriteria(7));assert.ok(!boardCriteria(1)&&!boardCriteria(3));
  assert.equal(boardLabels(2,{total_orders:5}).title,'Orders');assert.equal(boardLabels(2,{}).tabs[1].label,'Assigned');
  assert.equal(boardLabels(1,{total_orders:5,pending:2,completed_excl_cancelled:3}).title,'Orders (5)');
  assert.deepEqual(boardLabels(1,{pending:2,completed_excl_cancelled:3}).tabs.map(t=>t.count),[2,3]);
});
test('job worker board uses worker_status, informational tiles and the job-work detail',()=>{
  assert.deepEqual(boardTabFilter(11,'pending'),{worker_status:0});assert.deepEqual(boardTabFilter(11,'completed'),{worker_status:1});
  assert.deepEqual(boardTabFilter(1,'completed'),{state:'completed'});
  assert.ok(!boardDrillable(11)&&boardDrillable(1));assert.equal(boardOpenPath(11,5),'/squad/job-work/5');assert.equal(boardOpenPath(1,5),'/squad/orders/5');
});
