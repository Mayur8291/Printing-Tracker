import assert from 'node:assert/strict';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';

let rpcCalls=0,edgeCalls=0,code='PT409';
const supabase={
 schema:name=>{assert.equal(name,'canto_api');return{rpc:async()=>{rpcCalls++;return{data:null,error:{code,message:'Record changed; reload and retry'}};}};},
 functions:{invoke:async()=>{edgeCalls++;return{data:null,error:{context:new Response(JSON.stringify({error:code}),{status:409})}};}},
};
const sdk=createSquadClient(supabase),command={expectedVersion:'1:0',idempotencyKey:crypto.randomUUID()};
for(const conflict of ['PT409','40001']){
 code=conflict;const before=rpcCalls;
 await assert.rejects(sdk.saveProfile({name:'Fixture'},command),e=>e instanceof SquadError&&e.kind==='conflict'&&e.code===conflict);
 assert.equal(rpcCalls,before+1,'A stale application version must be surfaced without client retry');
}
for(const conflict of ['VERSION_CONFLICT','PT409','40001']){
 code=conflict;const before=edgeCalls;
 await assert.rejects(sdk.setAccountStatus('1','disable','Fixture',command),e=>e instanceof SquadError&&e.kind==='conflict'&&e.code===conflict);
 assert.equal(edgeCalls,before+1);
}
for(const [other,kind] of [['55000','unavailable'],['42501','forbidden'],['28000','session'],['22023','validation'],['PGRST003','unexpected']]){
 code=other;await assert.rejects(sdk.saveProfile({name:'Fixture'},command),e=>e instanceof SquadError&&e.kind===kind&&e.code===other);
}
assert.equal(rpcCalls,7);assert.equal(edgeCalls,3);
console.log('Conflict SDK:10 direct/Edge error cases; PT409 and legacy40001 preserved without retries');
