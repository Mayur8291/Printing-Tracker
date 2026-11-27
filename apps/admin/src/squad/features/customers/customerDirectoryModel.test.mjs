import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directoryRole,directoryFilters,commercialPath,readDirectoryState} from './customerDirectoryModel.js';
import {canVisit,navigationFor} from '../../navigation/registry.js';
test('real account role determines directory membership, never pricing labels',()=>{
 assert.equal(directoryRole('distributors',0),10);
 assert.equal(directoryRole('distributors',1),10);
 assert.equal(directoryRole('distributors',10),3);
 assert.equal(commercialPath({id:'4',role:3,price_type:'Distributor'}),'/squad/customers/4');
 assert.equal(commercialPath({id:'5',role:10,price_type:'Retail'}),'/squad/distributors/5');
});
test('review includes false and null; active requires approval and completed onboarding',()=>{
 assert.deepEqual(directoryFilters(3,'','pending'),{role:3,search:'',approved:[false,null],disabled:false});
 assert.deepEqual(directoryFilters(3,'','active'),{role:3,search:'',approved:[true],onboarded:true,disabled:false});
 assert.equal(directoryFilters(3,'x','',{role:0,search:'bad'}).role,3);
});
test('staff/customer navigation does not grant new personas commercial access',()=>{
 assert.equal(canVisit({role:10},'/squad/distributors/5'),false);
 for(const role of [2,4,7,8,9,11,12,3])assert.equal(canVisit({role},'/squad/customers'),false);
 assert.equal(canVisit({role:1},'/squad/customers'),true);
 assert.equal(canVisit({role:1},'/squad/people/4'),true);
 const items=navigationFor({role:0});
 assert.ok(items.some(x=>x.key==='customers'));assert.ok(items.some(x=>x.key==='team'));
 assert.ok(!items.some(x=>x.key==='people'||x.key==='distributors'));
});
test('filter and pagination URLs restore context and reject malformed state',()=>{
 assert.deepEqual(readDirectoryState(new URLSearchParams('filters=broken&pages=42')),{filters:{},cursors:[null]});
 const p=new URLSearchParams({filters:JSON.stringify({zone_id:'3'}),pages:JSON.stringify([null,'cursor'])});
 assert.deepEqual(readDirectoryState(p),{filters:{zone_id:'3'},cursors:[null,'cursor']});
});

test('Approved tab (Flutter) lists approved enabled accounts',()=>{assert.deepEqual(directoryFilters(3,'','approved').approved,[true]);assert.equal(directoryFilters(3,'','approved').disabled,false);});
