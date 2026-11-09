import test from 'node:test';import assert from 'node:assert/strict';
import {colorsDecision} from './web-tracker-colors-policy.mjs';import {STAGING} from './web-tracker-read-policy.mjs';
const base='http://127.0.0.1:5186/',scope={name:'UI Colors abc',editedName:'UI Colors abc edited',phase:'create',id:'42',updatedAt:'2026-11-09T00:00:00'};
const body={p_resource:'colors',p_action:'create',p_payload:{values:{name:scope.name,hex_code:'#2457AA',is_deleted:'false'},relations:{}},p_upload_ids:[],p_idempotency_key:'ad7efb91-2b17-49c4-b61d-90a28399f12d'};
const req=b=>({url:STAGING+'/rest/v1/rpc/account_master_save',method:'POST',headers:{'content-profile':'canto_api'},body:JSON.stringify(b)});
test('only exact prepared Colors payload may create; fields/resources/relations/media denied',()=>{
 assert.equal(colorsDecision(req(body),base,scope),'mutation');
 for(const change of [b=>b.p_resource='users',b=>b.p_payload.values.name='another',b=>b.p_payload.values.is_deleted='true',b=>b.p_payload.values.extra='x',b=>b.p_payload.relations={colors:['8']},b=>b.p_upload_ids=['a'],b=>b.p_payload.id='9']){const b=structuredClone(body);change(b);assert.equal(colorsDecision(req(b),base,scope),'deny');}
 for(const change of [r=>r.url=STAGING+'/rest/v1/rpc/account_master_save?extra=1',r=>r.method='GET',r=>r.headers['content-profile']='sa_api',r=>r.url='https://foreign.invalid/rest/v1/rpc/account_master_save']){const r=req(body);change(r);assert.equal(colorsDecision(r,base,scope),'deny');}
});
test('edit requires response-owned identity and version; delete only exact post-edit stage',()=>{
 const b=structuredClone(body);b.p_action='update';b.p_payload={id:'42',expectedUpdatedAt:scope.updatedAt,relations:{},values:{name:scope.editedName,hex_code:'#196B45',is_deleted:'false'}};
 assert.equal(colorsDecision(req(b),base,{...scope,phase:'update'}),'mutation');
 for(const s of [{...scope,phase:'create'},{...scope,phase:'update',id:'41'},{...scope,phase:'update',updatedAt:'old'}])assert.equal(colorsDecision(req(b),base,s),'deny');
 const r={...req({resource:'colors',action:'delete',payload:{id:'42'}}),url:STAGING+'/rest/v1/rpc/masters'};
 assert.equal(colorsDecision(r,base,{...scope,phase:'delete'}),'mutation');assert.equal(colorsDecision(r,base,scope),'deny');assert.equal(colorsDecision(r,base,{...scope,phase:'delete',id:'43'}),'deny');
});
test('no blanket write permission added to readonly policy',()=>{
 for(const rpc of ['v1_people_save','account_upload_reserve','dashboard','account_master_save'])assert.equal(colorsDecision({...req({}),url:STAGING+'/rest/v1/rpc/'+rpc},base,scope),'deny');
 assert.equal(colorsDecision({...req({}),url:STAGING+'/rest/v1/rpc/account_master_capabilities'},base,scope),'read');
});
test('request diagnostics discard payload values, credentials, URL query and unknown key names',async()=>{
 const {colorsRequestDiagnostic}=await import('./web-tracker-colors-hosted.mjs');
 const secret='do-not-retain-private-value',payload={...body,p_payload:{...body.p_payload,privateCustomer:secret,values:{...body.p_payload.values,[secret]:secret}}};
 const request={url:()=>STAGING+'/rest/v1/rpc/account_master_save?token='+secret,method:()=> 'POST',headers:()=>({'content-profile':'canto_api',authorization:secret,apikey:secret}),postData:()=>JSON.stringify(payload)};
 const d=colorsRequestDiagnostic(request,scope,'deny');assert.equal(JSON.stringify(d).includes(secret),false);assert.equal(d.contract,'account_master_save');assert.equal(d.profile,'canto_api');assert.ok(d.payload_keys.includes('unknown_key'));assert.equal(d.phase,'create');
});
