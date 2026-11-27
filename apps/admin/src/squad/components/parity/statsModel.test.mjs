import test from 'node:test';import assert from 'node:assert/strict';
import {visibleCounters,drillFilters,kilo,padCount,filteredOrdersContext,filteredOrdersHref} from './statsModel.js';
const admin={pending:3,critical:2,overdue:1,completed:2,cancelled:1,pending_criteria:3,total_orders:5,total_value:'660'};
test('tiles follow Flutter order and hide values the server withheld',()=>{
  assert.deepEqual(visibleCounters(admin).map(c=>c.key),['completed','pending','critical','overdue','total_value','total_orders']);
  assert.deepEqual(visibleCounters(admin,{criteria:true})[0].key,'pending_criteria');
  const {total_value,...noMoney}=admin;assert.ok(!visibleCounters(noMoney).some(c=>c.key==='total_value'));
  assert.deepEqual(visibleCounters({pending:1,amount_earned:'17.5',total_orders:1}).map(c=>c.key),['pending','amount_earned','total_orders']);
  assert.deepEqual(visibleCounters(null),[]);
});
test('formatting matches Flutter padLeft(2,0) and K/L/Cr',()=>{
  assert.equal(padCount(3),'03');assert.equal(padCount(124),'124');assert.equal(kilo(999),'999');assert.equal(kilo(1250),'1.3K');assert.equal(kilo(250000),'2.5L');assert.equal(kilo(25000000),'2.5Cr');
  assert.equal(visibleCounters(admin).find(c=>c.key==='total_value').value,'₹660');
  assert.equal(visibleCounters(admin).find(c=>c.key==='completed').hint,'incl. 1 cancelled');
});
test('drill-down filters; informational tiles do not drill',()=>{
  assert.deepEqual(drillFilters('critical'),{state:'critical'});assert.deepEqual(drillFilters('pending_criteria'),{criteria:0});
  assert.equal(drillFilters('total_value'),null);assert.equal(drillFilters('total_orders'),null);
});
test('filtered-orders link round-trips and rejects bad input',()=>{
  const href=filteredOrdersHref({state:'overdue'},{subject:{kind:'sales_coordinator',id:'12'},title:'Asha'});
  const ctx=filteredOrdersContext(href.split('?')[1]);
  assert.deepEqual(ctx.filters,{state:'overdue'});assert.deepEqual(ctx.subject,{kind:'sales_coordinator',id:'12'});assert.equal(ctx.title,'Asha');
  for(const bad of ['state=bogus','criteria=2','subject_kind=factory','subject_kind=x&subject_id=1','subject_kind=factory&subject_id=0'])assert.ok(filteredOrdersContext(bad).error,bad);
  assert.deepEqual(filteredOrdersContext('').filters,{});
});
import {subjectListFilter} from './statsModel.js';
test('person scope maps to existing order-list filters; PC scope via producer_id',()=>{
  assert.deepEqual(subjectListFilter({kind:'sales_coordinator',id:'7'}),{coordinator_id:'7'});
  assert.deepEqual(subjectListFilter({kind:'factory',id:'7'}),{manager_id:'7'});
  assert.deepEqual(subjectListFilter(null),{});
  assert.deepEqual(subjectListFilter({kind:'production_coordinator',id:'7'}),{producer_id:'7'});assert.equal(subjectListFilter({kind:'bogus',id:'7'}),null);
});

test('dealer scopes survive the drill-down link',()=>{
  const href=filteredOrdersHref({state:'pending',placed_for_me:true});
  assert.deepEqual(filteredOrdersContext(href.split('?')[1]).filters,{state:'pending',placed_for_me:true});
  assert.deepEqual(filteredOrdersContext('customer_id=9').filters,{customer_id:'9'});
  assert.ok(filteredOrdersContext('customer_id=x').error);assert.ok(filteredOrdersContext('placed_for_me=false').error);
});
