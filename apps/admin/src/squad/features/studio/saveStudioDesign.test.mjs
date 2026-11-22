import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioDesignSaver,presetBrandings} from './saveStudioDesign.js';
const input={configuration:{base_product_id:'216'},name:'A',brandings:[]};
const placement={type:'print',side:'Front',width:'2',height:'3',unit:'inch'};
test('lost create receipt retries exact command',async()=>{
 let creates=0;const keys=[];
 const sdk={createCustomProduct:async(c,n,m,key)=>{keys.push(key);if(++creates===1)throw Error('lost');return {id:'55'};}};
 const saver=createStudioDesignSaver({sdk,origin:'https://example.supabase.co',newKey:()=> 'stable'});
 await assert.rejects(saver.save(input,'key'),/lost/);
 const result=await saver.save(input,'key');assert.deepEqual(keys,['key','key']);assert.equal(result.id,'55');
});
test('different save commands create separate products and never edit source artwork',async()=>{
 let n=0;const designs=[];const sdk={createCustomProduct:async()=>({id:String(++n)}),saveBranding:async d=>{designs.push(d);return {id:'10',version:'1:1'};}};
 const saver=createStudioDesignSaver({sdk,origin:'https://example.supabase.co',newKey:()=> 'stable'});
 assert.notEqual((await saver.save(input,'a')).id,(await saver.save(input,'b')).id);
 assert.ok(designs.every(d=>!d.id));assert.deepEqual(designs,[]);
});
test('same command key cannot change payload and scope revocation stops writes',async()=>{
 let allowed=true;const sdk={createCustomProduct:async()=>({id:'1'}),saveBranding:async()=>({id:'2',version:'1:1'})};
 const saver=createStudioDesignSaver({sdk,isCurrent:()=>allowed,newKey:()=> 'stable'});await saver.save(input,'a');
 await assert.rejects(saver.save({...input,name:'Different'},'a'),/original save/);allowed=false;await assert.rejects(saver.save(input,'b'),/context changed/);
});
test('saved preset restoration uses only complete server projection',()=>{
 assert.deepEqual(presetBrandings({reuse:{status:'unavailable',brandings:[{}]}}),[]);
 assert.deepEqual(presetBrandings({id:'8',reuse:{status:'complete',brandings:[{design_id:'9'}]}}),[{design_id:'9',product_id:'8'}]);
});
test('fork copies verified media with independent upload keys and never mutates source',async()=>{
 const body=new TextEncoder().encode('artwork'),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(x=>x.toString(16).padStart(2,'0')).join('');
 let key=0,uploads=0;const saves=[];const sdk={
  saveBranding:async (d,c)=>{saves.push([d,c]);return {id:'new',version:'1:1'};},
  mediaGrants:async ([r])=>({references:[{...r,status:r.record_id==='old'&&r.field==='image'?'ready':'empty',version:'1:1',sha256:sha,bytes:String(body.length),content_type:'image/png',url:'https://example.supabase.co/storage/v1/object/sign/canto-media/image'}]}),
  reserveMediaUpload:async()=>({state:'reserved',upload_id:'upload',upload_url:'https://example.supabase.co/storage/v1/object/upload/sign/squad-uploads/pending/image'}),verifyMediaUpload:async()=>{},finalizeMediaUpload:async()=>({entity_version:'1:2'})};
 const saver=createStudioDesignSaver({sdk,origin:'https://example.supabase.co',newKey:()=>`key-${++key}`,fetchFile:async (url,options)=>{if(options.method==='PUT'){uploads++;return {ok:true};}return {ok:true,arrayBuffer:async()=>body.buffer};}});
 const original={...placement,design_id:'old',product_id:'product'};
 const result=await saver.forkArtwork(original,'fork-key');assert.equal(result.design_id,'new');assert.equal(result.product_id,null);assert.equal(result.design_version,'1:2');assert.equal(original.design_id,'old');assert.equal(saves.length,1);assert.equal(saves[0][0].id,undefined);
 await saver.forkArtwork(original,'fork-key');assert.equal(uploads,1);assert.equal(saves.length,1);
});
test('mismatched private media bytes cannot be uploaded to a new design',async()=>{
 let reserves=0;const sdk={saveBranding:async()=>({id:'new',version:'1:1'}),mediaGrants:async([r])=>({references:[{...r,status:'ready',version:'1:1',sha256:'a'.repeat(64),bytes:'3',content_type:'image/png',url:'https://example.supabase.co/storage/v1/object/sign/canto-media/image'}]}),reserveMediaUpload:async()=>{reserves++;}};
 const saver=createStudioDesignSaver({sdk,origin:'https://example.supabase.co',fetchFile:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})});
 await assert.rejects(saver.forkArtwork({...placement,design_id:'old'},'key'),/integrity/);assert.equal(reserves,0);
});

test('incomplete placement is rejected before creating a saved product',async()=>{
 let creates=0;const saver=createStudioDesignSaver({sdk:{createCustomProduct:async()=>{creates++;}},newKey:()=> 'key'});
 await assert.rejects(saver.save({...input,brandings:[placement]},'save'),/upload an image/);assert.equal(creates,0);
});
test('partial save retries lost branding receipt without duplicating accepted product',async()=>{
 const body=new Uint8Array([1,2,3]),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(x=>x.toString(16).padStart(2,'0')).join('');
 let creates=0,attempt=0;const keys=[];const sdk={createCustomProduct:async()=>{creates++;return {id:'product'};},
 saveBranding:async(d,c)=>{keys.push(c.idempotencyKey);if(++attempt===1)throw Error('lost');return {id:'new',version:'1:1'};},
 mediaGrants:async([r])=>({references:[{...r,status:r.record_id==='old'&&r.field==='image'?'ready':'empty',version:'1:1',sha256:sha,bytes:'3',content_type:'image/png',url:'https://example.supabase.co/storage/v1/object/sign/canto-media/image'}]}),reserveMediaUpload:async()=>({state:'attached',upload_id:'upload'}),verifyMediaUpload:async()=>{},finalizeMediaUpload:async()=>({entity_version:'1:2'})};
 const saver=createStudioDesignSaver({sdk,origin:'https://example.supabase.co',newKey:()=> 'stable',fetchFile:async()=>({ok:true,arrayBuffer:async()=>body.buffer})});
 const payload={...input,brandings:[{...placement,design_id:'old'}]};
 await assert.rejects(saver.save(payload,'save'),/lost/);const result=await saver.save(payload,'save');
 assert.equal(creates,1);assert.deepEqual(keys,['stable','stable']);assert.equal(result.brandings[0].design_id,'new');
});
test('browser remount reuses uncertain product command despite a new dialog key',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const keys=[];let lost=true;const sdk={createCustomProduct:async(c,n,m,key)=>{keys.push(key);if(lost)throw Error('network response lost');return {id:'55'};}};
 const options={sdk,storage,journalKey:'scoped:save',newKey:()=> 'stable'};
 await assert.rejects(createStudioDesignSaver(options).save(input,'original'),/network/);
 lost=false;const result=await createStudioDesignSaver(options).save(input,'new-dialog-key');assert.equal(result.id,'55');assert.deepEqual(keys,['original','original']);
});
test('failed durable journal write prevents product mutation',async()=>{
 let writes=0;const saver=createStudioDesignSaver({sdk:{createCustomProduct:async()=>{writes++;}},journalKey:'scoped:save',storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});
 await assert.rejects(saver.save(input,'key'),/recovery storage/);assert.equal(writes,0);
});
test('interrupted reference finalize resumes after remount with stable keys and no new product',async()=>{
 const bytes=new Uint8Array([9,8,7]),file=new File([bytes],'guide.png',{type:'image/png'}),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const reference={id:'ref',name:file.name,size:file.size,type:file.type,sha256:sha},values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let creates=0,lost=true,n=0;const reserves=[],finalizes=[];const sdk={createCustomProduct:async()=>{creates++;return {id:'product'};},mediaGrants:async([r])=>({references:[{...r,status:'empty',version:'1:0'}]}),reserveMediaUpload:async(target,file,command)=>{reserves.push(command);return {state:'attached',upload_id:'upload'};},verifyMediaUpload:async()=>{},finalizeMediaUpload:async(id,command)=>{finalizes.push(command);if(lost)throw Error('lost finalize response');return {entity_version:'1:1'};}};
 const options={sdk,journalKey:'scope:save',storage,newKey:()=>`step-${++n}`,readStagedReference:async()=>file},payload={...input,references:[reference]};
 await assert.rejects(createStudioDesignSaver(options).save(payload,'original'),/lost finalize/);
 const recovered=createStudioDesignSaver(options);assert.equal(recovered.pending().name,input.name);assert.equal(recovered.pending().references[0].id,'ref');
 lost=false;await recovered.save(payload,'new-dialog-key');assert.equal(creates,1);assert.deepEqual(reserves[0],reserves[1]);assert.deepEqual(finalizes[0],finalizes[1]);assert.equal(recovered.pending(),null);
 assert.doesNotMatch(values.get('scope:save'),/blob:|data:image|upload_url/);
});
test('an interrupted save cannot be abandoned by submitting another intent',async()=>{
 const saver=createStudioDesignSaver({sdk:{createCustomProduct:async()=>{throw Error('lost');}}});
 await assert.rejects(saver.save(input,'first'),/lost/);await assert.rejects(saver.save({...input,name:'Different'},'second'),/Resume the interrupted/);
});
