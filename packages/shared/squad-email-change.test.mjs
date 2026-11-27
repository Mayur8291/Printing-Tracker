import test from 'node:test';
import assert from 'node:assert/strict';
import {createSquadClient} from './squad.js';

function fixture(){
 const calls=[];
 const sdk=createSquadClient({schema:()=>({rpc(){throw Error('Unexpected RPC')}}),functions:{invoke(path,options){
  calls.push({path,options});return Promise.resolve({data:{state:path.endsWith('/request')?'queued':'committed'},error:null});
 }}});
 return {sdk,calls};
}
test('email change uses the exact account routes and preserves retry identities',async()=>{
 const {sdk,calls}=fixture();
 assert.deepEqual(await sdk.requestEmailChange('flow','new@example.invalid','7:3'),{state:'queued'});
 assert.deepEqual(await sdk.completeEmailChange('flow','key','12345678'),{state:'committed'});
 assert.deepEqual(calls,[
  {path:'squad-account/email-change/request',options:{body:{flow_id:'flow',destination:'new@example.invalid',expected_version:'7:3'}}},
  {path:'squad-account/email-change/complete',options:{body:{flow_id:'flow',request_key:'key',code:'12345678'}}},
 ]);
});
test('signal-bound read clients never send email change commands',async()=>{
 const {sdk,calls}=fixture();const read=sdk.withSignal(new AbortController().signal);
 await assert.rejects(()=>read.requestEmailChange('flow','new@example.invalid','7:3'),TypeError);
 await assert.rejects(()=>read.completeEmailChange('flow','key','12345678'),TypeError);
 assert.equal(calls.length,0);
});
