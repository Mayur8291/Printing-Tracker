import test from 'node:test';
import assert from 'node:assert/strict';
import {createSquadClient} from './squad.js';

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
