import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtomicMasterWriter,preparePrivateMasterForm,sameMasterImage} from '../../apps/admin/src/canto/atomicMasterSave.js';
const file={__base64File:true,filename:'sample.png',data:btoa('file-content')};
function setup(){
 const calls=[],store=new Map();
 const storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'actor'}}}})}};
 const sdk={mediaGrants:async()=>({references:[{version:'v1'}]}),reserveMediaUpload:async(target,_,command)=>{calls.push({name:'reserve',target,command});return{upload_id:'file-id',state:'reserved',upload_url:'https://upload.invalid/?token=secret'};},verifyMediaUpload:async(id,command)=>{calls.push({name:'verify',id,command});return{upload_id:id,state:'verified'};}};
 const transport=async()=>{calls.push({name:'PUT'});return new Response('',{status:200});};
 const rpc=async(name,args)=>{calls.push({name,args});return{id:'1',...args.p_payload.values};};
 const deps={client,sdk,rpc,resource:'base_products',environment:'staging',storage,transport};
 return{calls,store,deps,writer:()=>createAtomicMasterWriter(deps)};
}
test('create stages and verifies before publishing the whole form',async()=>{
 const s=setup();const r=await s.writer().save('create',null,{name:'A',image:file},{fabrics:['1']});
 assert.deepEqual(s.calls.map(x=>x.name),['reserve','PUT','verify','account_master_save']);
 assert.equal(s.calls[0].target.record_id,null);assert.equal(s.calls[0].command.expectedVersion,'new');
 const p=s.calls[3].args;assert.deepEqual(p.p_payload.values,{name:'A'});assert.deepEqual(p.p_payload.relations,{fabrics:['1']});assert.deepEqual(p.p_upload_ids,['file-id']);assert.equal(r.id,'1');assert.equal(s.store.size,0);
});
test('an invalid file cannot publish metadata or relations',async()=>{
 const s=setup();s.deps.sdk.verifyMediaUpload=async()=>{throw new Error('Invalid media');};await assert.rejects(s.writer().save('create',null,{name:'A',image:file},{fabrics:['1']}),/Invalid media/);assert(!s.calls.some(x=>x.name==='account_master_save'));
});
test('uncertain commit retries identical command after page reload without reupload',async()=>{
 const s=setup();let failed=false;s.deps.rpc=async(name,args)=>{s.calls.push({name,args});if(!failed){failed=true;throw new Error('Network response lost');}return{id:'1'};};
 await assert.rejects(s.writer().save('create',null,{name:'A',image:file},{}));
 const saved=[...s.store.values()][0];assert(!saved.includes('secret')&&!saved.includes('file-content')&&!saved.includes(file.data)&&!saved.includes('https://'));
 await s.writer().save('create',null,{name:'A',image:file},{});
 assert.equal(s.calls.filter(x=>x.name==='PUT').length,1);const commands=s.calls.filter(x=>x.name==='account_master_save');assert.deepEqual(commands[0].args,commands[1].args);assert.equal(s.store.size,0);
});
test('concurrent identical form saves share one upload and one transaction',async()=>{
 const s=setup(),writer=s.writer();const r=await Promise.all([writer.save('create',null,{image:file},{}),writer.save('create',null,{image:file},{})]);assert.deepEqual(r[0],r[1]);assert.equal(s.calls.filter(x=>x.name==='reserve').length,1);assert.equal(s.calls.filter(x=>x.name==='account_master_save').length,1);
});
test('existing-object upload retries require successful server verification',async()=>{
 const s=setup();s.deps.transport=async()=>new Response('',{status:409});await s.writer().save('create',null,{image:file},{});assert.equal(s.calls.filter(x=>x.name==='verify').length,1);
 s.deps.sdk.verifyMediaUpload=async()=>{throw new Error('Hash invalid');};await assert.rejects(s.writer().save('create',null,{image:file,name:'B'},{}),/Hash invalid/);assert.equal(s.calls.filter(x=>x.name==='account_master_save').length,1);
});
test('failed upload aborts publishing and can be resumed',async()=>{
 const s=setup();s.deps.transport=async()=>new Response('',{status:503});const writer=s.writer();await assert.rejects(writer.save('create',null,{image:file},{}),/File upload failed/);assert(!s.calls.some(x=>x.name==='account_master_save'));
});
test('metadata-only update and explicit detach publish in one transaction',async()=>{
 const s=setup();await s.writer().save('update','5',{name:'New',image:null},{},'timestamp');assert.deepEqual(s.calls.map(x=>x.name),['account_master_save']);assert.equal(s.calls[0].args.p_payload.expectedUpdatedAt,'timestamp');assert.equal(s.calls[0].args.p_payload.values.image,null);
});
test('missing dashboard session cannot reserve or publish',async()=>{
 const s=setup();s.deps.client.auth.getSession=async()=>({data:{session:null}});await assert.rejects(s.writer().save('create',null,{image:file},{}),/session has expired/);assert.equal(s.calls.length,0);
});
test('URL aliases and displayed slots never enter the legacy image downloader',()=>{
 const upload=new Blob(['new']);const config={fields:[{key:'logo_url',type:'image',fileKey:'logoFile'},{key:'imageFiles',type:'image-slots'}],imageSlots:['image_1','image_2']};const form={name:'A',logo_url:'https://signed.invalid',logoFile:upload,image_1:'https://old.invalid',imageFiles:{image_1:'https://old.invalid',image_2:upload,image_3:null}};
 const r=preparePrivateMasterForm(config,form,{logo_url:'https://signed.invalid',image_2:'https://old.invalid'});assert.equal(r.form.name,'A');assert.equal(r.form.logoFile,upload);assert(!('logo_url'in r.form)&&!('logo_url'in r.previous));assert.deepEqual(r.form.imageFiles,{image_2:upload,image_3:null});assert(!('image_1'in r.form));assert.equal(form.logo_url,'https://signed.invalid');
});
test('blocked session storage preserves in-session command identity',async()=>{
 const s=setup();s.deps.storage={getItem(){throw new Error('Denied');},setItem(){throw new Error('Denied');},removeItem(){throw new Error('Denied');}};let first=true;s.deps.rpc=async(name,args)=>{s.calls.push({name,args});if(first){first=false;throw new Error('Network');}return{id:'1'};};const writer=s.writer();await assert.rejects(writer.save('create',null,{image:file},{}));await writer.save('create',null,{image:file},{});const commands=s.calls.filter(x=>x.name==='account_master_save');assert.deepEqual(commands[0].args,commands[1].args);assert.equal(s.calls.filter(x=>x.name==='reserve').length,1);
});

test('renewed signed URLs keep the same image while different files or environments do not',()=>{const path='/storage/v1/object/sign/canto-media/sha256/aa/file';const base='https://scvojtvgnkmbupvyslmb.supabase.co';assert(sameMasterImage(base+path+'?token=new',base+path+'?token=old'));assert(!sameMasterImage(base+path+'2',base+path));assert(!sameMasterImage('https://levwrmvqdntngeasrtnb.supabase.co'+path,base+path));assert(!sameMasterImage('https://external.invalid/a?new','https://external.invalid/a?old'));});
