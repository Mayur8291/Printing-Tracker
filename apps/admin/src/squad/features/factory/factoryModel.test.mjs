import test from 'node:test';import assert from 'node:assert/strict';
import {tailorTabs,deliveryTabs,queueCounterRoles} from './factoryModel.js';
test('factory manager gets Tailors + Cutting Master; others only Tailors without add',()=>{
  assert.deepEqual(tailorTabs(4).map(t=>t.label),['Tailors','Cutting Master']);assert.ok(tailorTabs(4).every(t=>t.canAdd));
  assert.deepEqual(tailorTabs(7).map(t=>t.label),['Tailors']);assert.ok(!tailorTabs(8)[0].canAdd);
});
test('delivery tabs and counter roles',()=>{
  assert.deepEqual(deliveryTabs().map(t=>[t.label,t.role]),[['Dispatch In Charge',7],['Inspector',8]]);
  assert.deepEqual(queueCounterRoles,[7,9]);
});
