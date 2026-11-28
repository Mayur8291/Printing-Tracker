import test from 'node:test';import assert from 'node:assert/strict';
import {parseCoordinatorPath,canAddCoordinator,canViewKind,KINDS} from './coordinatorModel.js';
test('path parsing',()=>{
  assert.equal(parseCoordinatorPath('/squad/coordinators/sales').kind.role,1);
  assert.deepEqual(parseCoordinatorPath('/squad/coordinators/production/42').id,'42');
  for(const bad of ['/squad/coordinators/other','/squad/coordinators/sales/0','/squad/coordinators/sales/1/2','/squad/people'])assert.equal(parseCoordinatorPath(bad),null,bad);
});
test('role rules match Flutter',()=>{
  assert.ok(canAddCoordinator({role:0},KINDS.sales));assert.ok(!canAddCoordinator({role:2},KINDS.sales));assert.ok(canAddCoordinator({role:2},KINDS.factory));assert.ok(canViewKind({role:2},KINDS.factory));assert.ok(!canViewKind({role:1},KINDS.factory));
  assert.ok(canViewKind({role:2},KINDS.sales));assert.ok(!canViewKind({role:2},KINDS.production));assert.ok(canViewKind({role:0},KINDS.production));assert.ok(!canViewKind({role:1},KINDS.sales));
});
