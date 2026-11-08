/** Disposable hosted administrator; actual GoTrue, SDK, Edge and Storage. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
import {createAtomicMasterWriter} from '../../apps/admin/src/canto/atomicMasterSave.js';
const config=JSON.parse(readFileSync(0,'utf8'));
const checkpoint='tools/squad/private/master-upload-checkpoint.json';
const state=JSON.parse(readFileSync(checkpoint,'utf8'));
const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),sdk=createSquadClient(client);
const save=()=>writeFileSync(checkpoint,JSON.stringify(state,null,2)+'\n',{mode:0o600});
async function rpc(name,args){const {data,error}=await client.schema('canto_api').rpc(name,args);if(error)throw new Error(name+': '+error.code+' '+error.message);return data;}
function crc32(b){let crc=0xffffffff;for(const value of b){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function image(){const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2cAAAAASUVORK5CYII=','base64');const d=Buffer.from('comment\0'+randomUUID()),chunk=Buffer.alloc(d.length+12);chunk.writeUInt32BE(d.length);chunk.write('tEXt',4);d.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return Buffer.concat([original.subarray(0,-12),chunk,original.subarray(-12)]);}
const {error}=await client.auth.signInWithPassword(config.credentials);assert(!error,'Disposable staff login failed');
try{
 assert.equal((await rpc('account_master_capabilities',{})).atomic_master_save,true);
 // A real staff session must not sign an unrelated existing personal image.
 const denied=await client.storage.from('canto-media').createSignedUrl(state.personal_path,60);assert(denied.error&&!denied.data?.signedUrl,'Unrelated personal file was exposed');state.personal_file_denied=true;save();
 const legacy=await client.storage.from('canto-masters').upload(state.actor_id+'/test/'+randomUUID()+'.png',image(),{contentType:'image/png'});assert(legacy.error,'Legacy public upload policy remained writable');state.public_upload_denied=true;save();
 for(const resource of ['base_product_types','rmp_brands']){
  const bytes=image(),hash=createHash('sha256').update(bytes).digest('hex');state.hashes.push(hash);save();
  let lost=false;const commands=[];const baseRpc=async(name,args)=>{commands.push(args.p_idempotency_key);const r=await rpc(name,args);state.records.push({resource,id:r.id});save();if(!lost){lost=true;throw new Error('Simulated lost response after commit');}return r;};
  const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  const writer=createAtomicMasterWriter({client,sdk,rpc:baseRpc,resource,environment:'staging',storage});
  const payload={name:'Squad acceptance '+randomUUID(),image:{__base64File:true,filename:'test.png',data:bytes.toString('base64')}};
  const start=performance.now();await assert.rejects(writer.save('create',null,payload,{}),/Simulated lost response/);
  const r=await createAtomicMasterWriter({client,sdk,rpc:baseRpc,resource,environment:'staging',storage}).save('create',null,payload,{});assert.equal(commands[0],commands[1]);assert(r.image.startsWith('canto-media://'));const totalMs=performance.now()-start;
  const path='sha256/'+hash.slice(0,2)+'/'+hash;const signed=await client.storage.from('canto-media').createSignedUrl(path,60);assert(!signed.error&&signed.data.signedUrl,'Master file cannot be signed');const downloaded=await fetch(signed.data.signedUrl);assert.equal(downloaded.status,200);assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),hash);
  const update=await rpc('account_master_save',{p_resource:resource,p_action:'update',p_payload:{id:String(r.id),expectedUpdatedAt:r.updated_at,values:{name:payload.name+' renamed'}},p_upload_ids:[],p_idempotency_key:randomUUID()});assert.equal(update.image,r.image);
  const detached=await rpc('account_master_save',{p_resource:resource,p_action:'update',p_payload:{id:String(r.id),expectedUpdatedAt:update.updated_at,values:{image:null}},p_upload_ids:[],p_idempotency_key:randomUUID()});assert(!detached.image);
  const former=await client.storage.from('canto-media').createSignedUrl(path,60);assert(former.error&&!former.data?.signedUrl,'Detached file remained signable');
  state.results.push({resource,atomic_create:true,lost_response_retry_idempotent:true,metadata_only_keeps_file:true,checksum_verified:true,detached_file_not_signable:true,end_to_end_ms:Number(totalMs.toFixed(3))});save();console.log(JSON.stringify(state.results.at(-1)));
 }
}finally{await client.auth.signOut({scope:'local'});}
