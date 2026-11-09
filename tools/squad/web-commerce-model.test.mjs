import test from 'node:test';
import assert from 'node:assert/strict';
import {orderActions,orderState,paymentAmount} from '../../apps/admin/src/squad/features/orders/orderModel.js';
import {manageableRoles,personFields,savePerson,peopleFilterValues} from '../../apps/admin/src/squad/features/people/peopleModel.js';
import {customLine,readyMadeLine,positiveQuantity,quoteRequest} from '../../apps/admin/src/squad/features/catalogue/catalogueModel.js';

const open={id:'9007199254740995',customer_id:'9007199254740999',status:0,provider_status:'CREATED',dispatched_quantity:0,pending_change:null};
test('commercial and operational order rights remain distinct',()=>{
 assert.equal(orderActions({role:2,id:'2'},open).payment,false);
 assert.equal(orderActions({role:0,id:'0'},open).payment,false);
 assert.equal(orderActions({role:1,id:'1'},open).payment,true);
 assert.equal(orderActions({role:3,id:open.customer_id},open).cancel,false);
 assert.equal(orderActions({role:10,id:open.customer_id},open).cancel,false);
 assert.equal(orderActions({role:10,id:'10'},open).delete,false);
 assert.equal(orderActions({role:0,id:'0'},open).complete,true);
});
test('pending provider changes and dispatch suppress unsafe order actions',()=>{
 for(const role of [0,1,2,10]){
  const actions=orderActions({role,id:'100'},{...open,pending_change:{kind:'edit'}});
  assert.equal(actions.priority,false);assert.equal(actions.cancel,false);assert.equal(actions.complete,false);
 }
 assert.equal(orderActions({role:1},{...open,dispatched_quantity:1}).cancel,false);
 assert.equal(orderState({...open,status:1,provider_status:'CANCELLED'}),'Cancelled');
});
test('payment uses decimal strings and cumulative partial amount validation',()=>{
 assert.equal(paymentAmount('paid','irrelevant','1234.56'),'1234.56');
 assert.equal(paymentAmount('unpaid','123','1234.56'),'0');
 assert.equal(paymentAmount('partial','100.25','1234.56'),'100.25');
 for(const value of ['0','-1','1234.56','2000','1.001','NaN','1e2'])assert.throws(()=>paymentAmount('partial',value,'1234.56'));
});
test('managed workforce roles cannot accidentally get login email and use dedicated commands',async()=>{
 assert.deepEqual(manageableRoles(4),[5,6,7,8,9]);assert.deepEqual(manageableRoles(10),[3]);assert.deepEqual(manageableRoles(12),[]);
 const values={name:' Tailor ',email:'do-not-send@example.test',phone:' 123 ',manager_id:'9007199254740995',parent_tailor_id:'8'};
 assert.equal(personFields(values,5).email,undefined);assert.equal(personFields(values,5).manager_id,'9007199254740995');
 assert.equal(personFields(values,6).parent_tailor_id,'8');
 assert.equal(personFields(values,3,{existing:true}).email,undefined);
 const calls=[];const sdk=Object.fromEntries(['savePerson','saveTailor','saveSubtailor','saveFactoryTeam'].map(name=>[name,(...args)=>{calls.push([name,...args]);return Promise.resolve({id:'1'});} ]));
 await savePerson(sdk,null,5,{},{});await savePerson(sdk,null,6,{},{});await savePerson(sdk,null,8,{},{});await savePerson(sdk,null,3,{},{});
 assert.deepEqual(calls.map(c=>c[0]),['saveTailor','saveSubtailor','saveFactoryTeam','savePerson']);
});
test('custom quantity plans preserve original bigint IDs and sample separately',()=>{
 const configuration={base_product_id:'1',category_id:'2',fabric_id:'3',fabric_color_id:'4',parts:[]};
 const line=customLine(configuration,{'9007199254740995':'12','2':'0'},{size_id:'7',quantity:'1'});
 assert.deepEqual(line.quantities,[{size_id:'9007199254740995',quantity:12}]);
 assert.deepEqual(line.sample,{size_id:'7',quantity:1});
 assert.equal(line.configuration,configuration);
 assert.throws(()=>customLine({...configuration,fabric_color_id:''},{1:'10'}));
});
test('ready-made IDs are never substituted for custom sizes',()=>{
 assert.deepEqual(readyMadeLine({'9007199254740995':'2'}),{kind:'rmp',skus:[{sku_id:'9007199254740995',quantity:2}]});
 for(const value of [-1,1.5,'NaN',Infinity,100001,0])assert.throws(()=>positiveQuantity(value));
 assert.throws(()=>readyMadeLine({a:'0'}));
});
test('quote builder has explicit customer/address scope without UI-only fields',()=>{
 const line={kind:'rmp',skus:[{sku_id:'1',quantity:2}]};
 assert.deepEqual(quoteRequest([{key:'local',label:'shirt',line}],'9007199254740995','2'),{customer_id:'9007199254740995',address_id:'2',lines:[line]});
 assert.deepEqual(quoteRequest([{line}],null,null),{lines:[line]});
 assert.throws(()=>quoteRequest([],null,null));
});

test('people filters preserve exact IDs, source origin enum, and boolean values',()=>{
 assert.deepEqual(peopleFilterValues({registered_by:'0',direct:'false',onboarded:'true',coordinator_id:'9007199254740995',dealer_id:'',price_type_id:'1e3'}),{onboarded:true,direct:false,coordinator_id:'9007199254740995',registered_by:[0]});
 assert.deepEqual(peopleFilterValues({registered_by:'4',direct:'unknown',factory_id:'-1'}),{});
});

test('quote pricing preserves saved design identity while excluding artwork-only notes and media',()=>{
 const branding={type:'print',side:'Front',width:'3',height:'4',unit:'inch',design_id:'42',design_version:'v2',comment:'Keep logo upright',print_area:'Chest',image:{pointer:'/0'}};
 const request=quoteRequest([{line:{kind:'rmp',skus:[{sku_id:'1',quantity:1}],brandings:[branding]}}],null,null);
 assert.deepEqual(request.lines[0].brandings[0],{type:'print',side:'Front',width:'3',height:'4',unit:'inch',design_id:'42',design_version:'v2'});
 assert.equal(branding.comment,'Keep logo upright','The local saved-artwork metadata is retained');
});
