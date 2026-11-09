import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPABILITY_STAGES,validateStage,observeReadRequests} from './web-conditional-content-hosted-journey.mjs';
import {usableGrant,discoverProducts,discoverPromotions} from './web-content-media-hosted-journey.mjs';
import {EventEmitter} from 'node:events';
const origin='https://scvojtvgnkmbupvyslmb.supabase.co';
const reference=id=>({resource:'rmp_classes',record_id:String(id),field:'images',pointer:'/0'});
const ready=id=>({...reference(id),status:'ready',url:origin+'/storage/v1/object/sign/canto-media/source.png?token=local',bytes:32,content_type:'image/png'});
test('conditional stage rejects unauthorized subject, role, authority and capability mismatches',()=>{
 const fixture={actors:{11:'9007199254740999',12:'1902000012'}};
 for(const role of [11,12])for(const [stage,expected]of Object.entries(CAPABILITY_STAGES)){
  const identity={id:fixture.actors[role],role,capabilities:{...expected,place_orders:false}};
  assert.deepEqual(validateStage(stage,identity,role,fixture),expected);
  assert.throws(()=>validateStage(stage,{...identity,id:'123'},role,fixture));
  assert.throws(()=>validateStage(stage,{...identity,capabilities:{...identity.capabilities,place_orders:true}},role,fixture));
  assert.throws(()=>validateStage(stage,{...identity,capabilities:{...identity.capabilities,documents:!expected.documents}},role,fixture));
 }
 assert.throws(()=>validateStage('unknown',{},11,fixture));assert.throws(()=>validateStage('off',{},0,fixture));assert.throws(()=>validateStage('off',{id:undefined,role:11,capabilities:CAPABILITY_STAGES.off},11,{actors:{}}));
});
test('read observer catches commands, raw tables and foreign grants without altering parent interceptor',()=>{
 const page=new EventEmitter(),guard=observeReadRequests(page,'http://localhost:5183');
 const send=(url,method='POST',body='{}')=>page.emit('request',{url:()=>url,method:()=>method,postData:()=>body});
 send(origin+'/rest/v1/rpc/v1_me');send(origin+'/functions/v1/squad-account/media/grants');
 assert.equal(guard.denied.length,0);
 send(origin+'/rest/v1/rpc/v1_person_capabilities_save');send(origin+'/rest/v1/users');send('https://production.supabase.co/storage/v1/object/sign/file','GET');
 assert.equal(guard.denied.length,3);assert.ok(guard.denied.every(row=>!JSON.stringify(row).includes('token=')));
 guard.close();assert.equal(page.listenerCount('request'),0);
});
test('existing media eligibility fails closed on origin, size, readiness and raster type',()=>{
 assert.equal(usableGrant(ready(1),{raster:true}),true);
 for(const patch of [{status:'missing'},{bytes:0},{bytes:10*1024*1024+1},{bytes:1.5},{bytes:'bad'},{url:'https://foreign.example/source.png'},{url:origin+'/storage/v1/object/public/file'}])assert.equal(usableGrant({...ready(1),...patch}),false);
 assert.equal(usableGrant({...ready(1),content_type:'image/svg+xml'},{raster:true}),false);
 assert.equal(usableGrant({...ready(1),content_type:'application/pdf'}),true);
});
test('ready-made discovery preserves exact references, stops at40 and never mutates',async()=>{
 const calls=[];const sdk={readyMade:async(filters,customer,page)=>{calls.push({filters,customer,page});return {data:Array.from({length:20},(_,index)=>({id:String(index+(page.cursor?20:0)+1),name:'Source',images:[reference(index+(page.cursor?20:0)+1)]})),next_cursor:'still-more'};},mediaGrants:async refs=>({references:refs.map(r=>({...ready(r.record_id),...r,status:'pending'}))})};
 const none=await discoverProducts(sdk,'9007199254740999');assert.equal(calls.length,2);assert.equal(none.observed.length,40);assert.equal(none.usable,null);assert.equal(none.missing,null);assert.ok(calls.every(c=>c.page.limit===20&&c.customer==='9007199254740999'));
 calls.length=0;sdk.mediaGrants=async refs=>({references:refs.map((r,index)=>({...ready(r.record_id),...r,status:index===0?'ready':'missing'}))});
 const found=await discoverProducts(sdk,'3');assert.equal(calls.length,1);assert.equal(found.usable.product.id,'1');assert.equal(found.missing.product.id,'2');
});
test('promotion discovery is bounded, rejects ambiguous card titles and never invents missing content',async()=>{
 const calls=[];const sdk={promotions:async(filters,page)=>{calls.push(page);return {data:[{id:'1',name:'Ambiguous',content:{kind:'file',media:reference(1)}},{id:'2',name:'Ambiguous',content:{kind:'file',media:reference(2)}},{id:'3',name:'Ready',content:{kind:'file',media:reference(3)}},{id:'4',name:'Missing',content:{kind:'file',media:reference(4)}}],next_cursor:'more'};},mediaGrants:async refs=>({references:refs.map(r=>({...ready(r.record_id),...r,status:r.record_id==='4'?'missing':'ready'}))})};
 const found=await discoverPromotions(sdk);assert.equal(calls.length,1);assert.deepEqual(found.observed.map(r=>r.id),['3','4']);assert.equal(found.usable.item.id,'3');assert.equal(found.missing.item.id,'4');
 sdk.mediaGrants=async refs=>({references:refs.map(r=>({...r,status:'pending'}))});calls.length=0;const pending=await discoverPromotions(sdk);assert.equal(calls.length,2);assert.equal(pending.missing,null);assert.equal(pending.usable,null);assert.ok(calls.every(c=>c.limit===12));
});
