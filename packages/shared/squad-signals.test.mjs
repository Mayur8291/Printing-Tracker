import test from 'node:test';
import assert from 'node:assert/strict';
import {createSquadClient} from './squad.js';
import polyfill from 'abort-controller';

function transport(){
 const calls=[];
 const schema={rpc(name,args){const call={kind:'rpc',name,args,signal:null};calls.push(call);let resolve;const promise=new Promise(r=>resolve=r);call.resolve=resolve;promise.abortSignal=signal=>{call.signal=signal;signal.addEventListener('abort',()=>resolve({error:{message:'aborted',code:'42501'}}),{once:true});return promise;};return promise;}};
 const source={schema:name=>{assert.equal(name,'canto_api');return schema;},functions:{invoke(name,options){const call={kind:'edge',name,...options};calls.push(call);return Promise.resolve({data:{references:[]},error:null});}}};return {calls,sdk:createSquadClient(source)};
}
test('unbound client retains existing RPC payload and command semantics',async()=>{
 const {sdk,calls}=transport();const promise=sdk.saveProfile({name:'Updated'},{expectedVersion:'1:2',idempotencyKey:'key'});
 assert.equal(calls[0].signal,null);assert.equal(calls[0].name,'v1_profile_save');assert.deepEqual(calls[0].args,{p_fields:{name:'Updated'},p_expected_version:'1:2',p_idempotency_key:'key'});calls[0].resolve({data:{version:'1:3'}});assert.deepEqual(await promise,{version:'1:3'});
});
test('two query clients have independent signals; abort never poisons original client',async()=>{
 const {sdk,calls}=transport(),a=new AbortController(),b=new AbortController();
 const first=sdk.withSignal(a.signal).orders({search:'a'}),second=sdk.withSignal(b.signal).orders({search:'b'}),plain=sdk.me();
 const firstCheck=assert.rejects(first,{name:'AbortError'});a.abort();await firstCheck;
 assert.equal(calls[0].signal,a.signal);assert.equal(calls[1].signal,b.signal);assert.equal(calls[2].signal,null);assert.equal(b.signal.aborted,false);
 calls[1].resolve({data:{data:[],next_cursor:null}});calls[2].resolve({data:{id:'3'}});await second;assert.equal((await plain).id,'3');
});
test('already aborted queries never reach RPC or Edge transport',async()=>{
 const {sdk,calls}=transport(),a=new AbortController();a.abort();const read=sdk.withSignal(a.signal);
 await assert.rejects(read.me(),{name:'AbortError'});await assert.rejects(read.mediaGrants([]),{name:'AbortError'});assert.equal(calls.length,0);
});
test('placement receipt is an abortable read of the original command key and quote', async () => {
 const {sdk,calls}=transport(), signal=new AbortController().signal;
 const result=sdk.withSignal(signal).orderPlacementReceipt('request-key','quote-id');
 assert.equal(calls[0].name,'v1_order_placement_receipt');
 assert.deepEqual(calls[0].args,{p_key:'request-key',p_quote_id:'quote-id'});
 assert.equal(calls[0].signal,signal);
 calls[0].resolve({data:{state:'unknown'}});
 assert.deepEqual(await result,{state:'unknown'});
});
test('signal-bound client rejects commands before any transport',async()=>{
 const {sdk,calls}=transport(),read=sdk.withSignal(new AbortController().signal);
 for(const command of [()=>read.saveProfile({},{}),()=>read.closeAccount('close',{}),()=>read.requestRecovery('x','y'),()=>read.reserveMediaUpload({}, {}, {}),()=>read.rebuildStockCounters('1',[],'reason','key')])await assert.rejects(command(),/Commands cannot run/);
 assert.equal(calls.length,0);
});
test('dual-purpose stock contract permits only exact read actions',async()=>{
 const {sdk,calls}=transport(),signal=new AbortController().signal,read=sdk.withSignal(signal);
 const review=read.reviewStock('10'),history=read.stockReconciliationHistory('10');assert.deepEqual(calls.map(c=>c.args.p_action),['review','history']);assert.ok(calls.every(c=>c.signal===signal));for(const c of calls)c.resolve({data:{data:[]}});await Promise.all([review,history]);
});
test('media grant keeps original payload while passing the per-query Edge signal',async()=>{
 const {sdk,calls}=transport(),signal=new AbortController().signal;await sdk.withSignal(signal).mediaGrants([{resource:'users',record_id:'3',field:'profile_image'}],{download:true});
 assert.equal(calls[0].signal,signal);assert.equal(calls[0].name,'squad-account/media/grants');assert.deepEqual(calls[0].body,{references:[{resource:'users',record_id:'3',field:'profile_image'}],download:true});
});
test('nested cached reads can bind their own independent query signal',async()=>{
 const {sdk,calls}=transport(),parent=new AbortController(),nested=new AbortController();const read=sdk.withSignal(parent.signal).withSignal(nested.signal);parent.abort();
 const result=read.configuratorOptions('1','assets');assert.equal(calls[0].signal,nested.signal);calls[0].resolve({data:{data:[],next_cursor:null}});await result;
});
test('invalid signal rejected instead of silently making unbound reads',()=>{
 const {sdk}=transport();assert.throws(()=>sdk.withSignal(undefined),TypeError);assert.throws(()=>sdk.withSignal({aborted:false}),TypeError);
});
test('React Native abort-controller works before and after read and Edge transport',async()=>{
 const original=globalThis.AbortSignal;globalThis.AbortSignal=polyfill.AbortSignal;
 try{
  const {sdk,calls}=transport(),first=new polyfill.AbortController();
  assert.equal(typeof first.signal.throwIfAborted,'undefined');assert.equal('reason' in first.signal,false);
  const read=sdk.withSignal(first.signal);const pending=read.me();assert.equal(calls.length,1);calls[0].resolve({data:{id:'3'}});assert.deepEqual(await pending,{id:'3'});
  first.abort();await assert.rejects(read.me(),{name:'AbortError'});await assert.rejects(read.mediaGrants([]),{name:'AbortError'});assert.equal(calls.length,1);
  const next=new polyfill.AbortController(),pendingRpc=sdk.withSignal(next.signal).me();next.abort();await assert.rejects(pendingRpc,{name:'AbortError'});
  let resolveEdge;const source={schema:()=>({rpc(){throw Error('unexpected RPC');}}),functions:{invoke:()=>new Promise(resolve=>{resolveEdge=resolve;})}};
  const edge=new polyfill.AbortController(),edgeRead=createSquadClient(source).withSignal(edge.signal).mediaGrants([]);edge.abort();resolveEdge({data:{references:[]},error:null});await assert.rejects(edgeRead,{name:'AbortError'});
 }finally{globalThis.AbortSignal=original;}
});
test('modern abort reason remains the exact caller-supplied value',async()=>{
 const {sdk,calls}=transport(),controller=new AbortController(),reason=new Error('superseded');controller.abort(reason);
 await assert.rejects(sdk.withSignal(controller.signal).me(),error=>error===reason);assert.equal(calls.length,0);
});
test('account closure preserves the exact command envelope for an uncertain retry',async()=>{
 const {sdk,calls}=transport(),command={expectedVersion:'4:12',idempotencyKey:'same-request'};
 const first=sdk.closeAccount('DELETE MY ACCOUNT',command);
 assert.equal(calls[0].name,'v1_account_close');assert.deepEqual(calls[0].args,{p_confirmation:'DELETE MY ACCOUNT',p_expected_version:'4:12',p_idempotency_key:'same-request'});
 calls[0].resolve({error:{code:'TRANSPORT_ERROR',message:'interrupted'}});await assert.rejects(first,error=>error.kind==='unexpected');
 const retry=sdk.closeAccount('DELETE MY ACCOUNT',command);assert.deepEqual(calls[1].args,calls[0].args);
 const receipt={id:'103',version:'4:13',state:'closed',sessions_revoked:true,account_reconciliation:'queued'};
 calls[1].resolve({data:receipt});assert.deepEqual(await retry,receipt);
});

test('RMP share reads preserve exact selection and support query cancellation',async()=>{
 const {sdk,calls}=transport(),signal=new AbortController().signal;
 const result=sdk.withSignal(signal).readyMadeShare('1','2','3');
 assert.equal(calls[0].name,'v1_rmp_share');
 assert.deepEqual(calls[0].args,{p_class_id:'1',p_brand_id:'2',p_category_id:'3',p_customer_id:null});
 assert.equal(calls[0].signal,signal);calls[0].resolve({data:{image:null}});
 assert.deepEqual(await result,{image:null});
});
test('category brand options carry the exact scope and support cancellation',async()=>{
 const {sdk,calls}=transport(),signal=new AbortController().signal;
 const result=sdk.withSignal(signal).categoryBrands('7','103',{cursor:'cursor',limit:10});
 assert.equal(calls[0].name,'v1_category_brands');
 assert.deepEqual(calls[0].args,{p_category_id:'7',p_customer_id:'103',p_cursor:'cursor',p_limit:10});
 assert.equal(calls[0].signal,signal);calls[0].resolve({data:{data:[],next_cursor:null}});
 assert.deepEqual(await result,{data:[],next_cursor:null});
});
test('catalogue option search binds kind, unmodified query, customer and pagination with cancellation',async()=>{
 const {sdk,calls}=transport(),signal=new AbortController().signal;
 const result=sdk.withSignal(signal).searchCatalogueOptions('brands','  hood  ','103',{cursor:'cursor',limit:7});
 assert.equal(calls[0].name,'v1_catalog_search_options');assert.deepEqual(calls[0].args,{p_kind:'brands',p_search:'  hood  ',p_customer_id:'103',p_cursor:'cursor',p_limit:7});assert.equal(calls[0].signal,signal);
 const page={data:[{id:'4',name:'Hood',destination:{category_id:'2',brand_id:'4'}},{id:'5',name:'Other',destination:null}],context:{},next_cursor:null};calls[0].resolve({data:page});assert.deepEqual(await result,page);
 const defaults=sdk.searchCatalogueOptions('categories','Hood');assert.deepEqual(calls[1].args,{p_kind:'categories',p_search:'Hood',p_customer_id:null,p_cursor:null,p_limit:30});calls[1].resolve({data:{data:[],context:{},next_cursor:null}});await defaults;
});

test('brand home read preserves parent/category scope, pagination and cancellation',async()=>{
 const {sdk,calls}=transport(),signal=new AbortController().signal;
 const result=sdk.withSignal(signal).homeCatalogue('2','6',{cursor:'next',limit:12});
 assert.equal(calls[0].name,'v1_home_catalog');assert.deepEqual(calls[0].args,{p_brand_id:'2',p_category_id:'6',p_cursor:'next',p_limit:12});assert.equal(calls[0].signal,signal);calls[0].resolve({data:{data:[],next_cursor:null}});await result;
});

// Saving revalidates the download grant after returning from the OS picker.
test('document download grants are cancellable reads, including post-picker reauthorization',async()=>{
 const {sdk,calls}=transport(),controller=new AbortController();let mutations=0;sdk.subscribeMutations(()=>mutations++);
 await sdk.withSignal(controller.signal).downloadDocument('doc-123');assert.equal(mutations,0,'A download grant must not trigger a session/cache refresh during saving');
 assert.equal(calls[0].name,'squad-account/documents/download');assert.deepEqual(calls[0].body,{id:'doc-123'});assert.equal(calls[0].signal,controller.signal);
 controller.abort();await assert.rejects(sdk.withSignal(controller.signal).downloadDocument('doc-123'),{name:'AbortError'});assert.equal(calls.length,1);
 let resolve;const late=new AbortController(),client=createSquadClient({schema:()=>({}),functions:{invoke:()=>new Promise(r=>resolve=r)}});
 const pending=client.withSignal(late.signal).downloadDocument('doc-123');late.abort();resolve({data:{url:'not-published'},error:null});await assert.rejects(pending,{name:'AbortError'});
});
