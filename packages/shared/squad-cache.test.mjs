import test from 'node:test';import assert from 'node:assert/strict';import {createSquadClient} from './squad.js';
const ref={resource:'rmp_classes',record_id:'1',field:'image',variant:'card'};
function fixture(){
 const calls=[];let fail=false;
 const version={revision:'a'.repeat(32),generation:'1',manifest:true,renditions:true};
 const transport={
  schema:()=>({rpc:(name,args)=>{calls.push({name,args});const p=Promise.resolve(fail?{error:{code:'42501'}}:{data:name==='v1_cache_revision'?version:{saved:true}});p.abortSignal=()=>p;return p}}),
  functions:{invoke:async(name,{body})=>{calls.push({name,body});return {data:{generation:'1',references:body.references.map(r=>({...r,status:'ready',sha256:'a'.repeat(64),expires_in:120}))}};}}
 };
 return {sdk:createSquadClient(transport),calls,setFail:v=>fail=v};
}
test('old server path strips variants; revision capability enables metadata and renditions',async()=>{const {sdk,calls}=fixture();await sdk.mediaManifest([ref]);assert.equal(calls.at(-1).name,'squad-account/media/grants');assert.equal(calls.at(-1).body.references[0].variant,undefined);await sdk.cacheRevision();await sdk.withSignal(new AbortController().signal).mediaManifest([ref]);assert.equal(calls.at(-1).name,'squad-account/media/manifest');assert.equal(calls.at(-1).body.references[0].variant,'card');await sdk.mediaGrants([ref],{download:true});assert.equal(calls.at(-1).body.references[0].variant,undefined)});
test('successful commands notify every owner; reads and failed commands do not invalidate',async()=>{const {sdk,setFail}=fixture();let changes=0;const off=sdk.subscribeMutations(()=>changes++);sdk.subscribeMutations(()=>{throw Error('observer')});await sdk.cacheRevision();await sdk.mediaManifest([ref]);assert.equal(changes,0);await sdk.saveProfile({name:'A'},{});assert.equal(changes,1);setFail(true);await assert.rejects(()=>sdk.saveProfile({name:'B'},{}));assert.equal(changes,1);setFail(false);off();await sdk.saveProfile({name:'C'},{});assert.equal(changes,1)});
test('missing manifest falls back once and disables repeated unsupported endpoint calls',async()=>{const calls=[];const sdk=createSquadClient({schema:()=>({rpc:()=>Promise.resolve({data:{generation:'1',manifest:true,renditions:true}})}),functions:{invoke:async(name,{body})=>{calls.push(name);return name.endsWith('/manifest')?{error:{code:'NOT_FOUND'}}:{data:{references:body.references}}}}});await sdk.cacheRevision();const first=await sdk.mediaManifest([ref]);await sdk.mediaManifest([ref]);assert.deepEqual(calls,['squad-account/media/manifest','squad-account/media/grants','squad-account/media/grants']);assert.equal(first.references[0].variant,'card')});
