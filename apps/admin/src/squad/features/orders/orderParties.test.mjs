import test from 'node:test';
import assert from 'node:assert/strict';
import {orderParties,orderPartySummary} from './orderParties.js';
test('company and contact names remain visible alongside a linked distributor',()=>{
 const o={customer_id:'3',customer_role:3,customer_name:'Asha Rao',customer_company_name:'North Star',customer_dealer_id:'10',dealer_name:'Ravi Shah',dealer_company_name:'West Distribution'};
 assert.deepEqual(orderParties(o),[{label:'Customer',name:'North Star',contact:'Asha Rao'},{label:'Dealer / distributor',name:'West Distribution',contact:'Ravi Shah'}]);
 assert.match(orderPartySummary(o),/West Distribution \(Ravi Shah\)/);
});
test('dealer buying directly is labelled correctly without a duplicate party',()=>{
 assert.deepEqual(orderParties({customer_id:'10',customer_role:10,customer_name:' Ravi ',customer_company_name:'ravi',customer_dealer_id:'10'}),[{label:'Dealer / distributor',name:'ravi',contact:''}]);
});
test('missing legacy names are explicit, not silently omitted',()=>{
 assert.deepEqual(orderParties({customer_id:'123'}),[{label:'Customer',name:'Customer #123',contact:''}]);
});
