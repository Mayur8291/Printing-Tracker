import test from 'node:test';import assert from 'node:assert/strict';import {createSquadClient} from './squad.js';
test('catalogue email retry uses a customer command and does not enter the cancellable read transport',async()=>{
 const calls=[];const sdk=createSquadClient({schema(name){assert.equal(name,'canto_api');return {rpc:async(name,args)=>{calls.push({name,args});return {data:{id:args.p_id,delivery_state:'pending'},error:null}}}}});
 const result=await sdk.retryCatalogueEmail('document-id');assert.equal(result.delivery_state,'pending');assert.deepEqual(calls,[{name:'v1_catalogue_email_retry',args:{p_id:'document-id'}}]);
 await assert.rejects(sdk.withSignal(new AbortController().signal).retryCatalogueEmail('document-id'),/Commands cannot run/);assert.equal(calls.length,1);
});
