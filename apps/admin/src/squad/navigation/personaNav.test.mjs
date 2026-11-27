import test from 'node:test';import assert from 'node:assert/strict';
import {tabsFor,drawerFor,landingFor,activeTabKey} from './personaNav.js';
const caps=(o={})=>({catalogue:false,notes:false,goals:false,documents:false,promotions:false,...o});
const labels=(role,c)=>tabsFor({role,capabilities:caps(c)}).map(t=>t.label);
test('exact Flutter tab labels and order per persona',()=>{
  assert.deepEqual(labels(0,{notes:true,catalogue:true}),['Customers','Sales Co-ord.','Prod. Co-ord.','Products','To Do\'s']);
  assert.deepEqual(labels(1,{notes:true,catalogue:true}),['Orders','Customers','Distributor','Products','To Do\'s']);
  assert.deepEqual(labels(3,{catalogue:true}),['Products','Orders']);
  assert.deepEqual(labels(4,{notes:true}),['Orders','Tailors','Delivery','To Do\'s']);
  assert.deepEqual(labels(10,{catalogue:true}),['Placed Orders','My Orders','Customers','Products']);
  assert.deepEqual(labels(11,{}),['Orders']);
});
test('feature-flagged tabs hide when grants are off and an all-off Team worker has no tabs',()=>{
  assert.deepEqual(labels(11,{notes:true,catalogue:true}),['Orders','Products','To Do\'s']);
  assert.deepEqual(labels(12,{}),[]);
  assert.equal(landingFor({role:12,capabilities:caps()}),'/squad/profile');
});
test('tabs the role cannot visit are dropped (no navigation into denied pages)',()=>{
  for(const role of [0,1,2,3,4,7,8,9,10,11,12])for(const t of tabsFor({role,capabilities:caps({catalogue:true,notes:true,goals:true})}))assert.ok(t.href.startsWith('/squad/'),`${role}:${t.key}`);
  assert.ok(!labels(2,{notes:true}).includes('Customers'),'PC Customers tab waits for D3 registry/backend change');
});
test('landing is the first tab, Customer lands on Products',()=>{
  assert.equal(landingFor({role:3,capabilities:caps({catalogue:true})}),'/squad/catalogue');
  assert.equal(landingFor({role:9,capabilities:caps()}),'/squad/production');
});
test('drawer keeps web-only modules under More and never duplicates a tab',()=>{
  const d=drawerFor({role:0,capabilities:caps({notes:true,catalogue:true,goals:true,documents:true,promotions:true})});
  assert.ok(d.find(i=>i.label==='Administration'&&i.group==='More'));
  assert.ok(d.find(i=>i.label==='Force Complete Order'));
  assert.equal(new Set(d.map(i=>i.label)).size,d.length);
});
test('active tab follows route module',()=>{
  const tabs=tabsFor({role:10,capabilities:caps({catalogue:true})});
  assert.equal(activeTabKey(tabs,'/squad/orders?scope=own'),'my-orders');
  assert.equal(activeTabKey(tabs,'/squad/orders?scope=placed'),'placed-orders');
  assert.equal(activeTabKey(tabs,'/squad/orders/12'),'placed-orders');
  assert.equal(activeTabKey(tabs,'/squad/distributors/5'),'customers');
});
test('admin coordinator tabs resolve to their own lists and stay distinguishable',()=>{
  const tabs=tabsFor({role:0,capabilities:caps({notes:true,catalogue:true})});
  assert.equal(tabs.find(t=>t.key==='sales-coordinators').href,'/squad/coordinators/sales');
  assert.equal(activeTabKey(tabs,'/squad/coordinators/sales/12'),'sales-coordinators');
  assert.equal(activeTabKey(tabs,'/squad/coordinators/production'),'production-coordinators');
  assert.ok(drawerFor({role:0,capabilities:caps()}).some(i=>i.label==='Personas'&&i.href==='/squad/personas'));
  assert.ok(tabsFor({role:2,capabilities:caps({notes:true})}).some(t=>t.label==='Sales Co-ord.'));
});
test('admin menu reaches Change SC and Customers Request; customer Change SC goes to profile',()=>{
  const d=drawerFor({role:0,capabilities:caps()});
  assert.equal(d.find(i=>i.label==='Change SC').href,'/squad/change-sc');
  assert.equal(d.find(i=>i.label==='Customers Request').href,'/squad/customer-requests');
  assert.equal(drawerFor({role:3,capabilities:caps()}).find(i=>i.label==='Change SC')?.href,'/squad/profile');
});
