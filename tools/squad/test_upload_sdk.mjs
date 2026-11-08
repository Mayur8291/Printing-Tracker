/** Real GoTrue -> shared client -> deployed Edge -> Storage -> RPC test.
 * A Python harness enables disposable writes and reconciles all test records. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
const checkpoint='tools/squad/private/upload-checkpoint.json';const state=JSON.parse(readFileSync(checkpoint,'utf8'));assert.equal(state.environment,'staging');
const key=execFileSync('tools/canto-sync/.venv/bin/python',['-c',"import sys;sys.path.insert(0,'tools/canto-sync');from auth_test import keys;print(keys('staging'))"],{encoding:'utf8'}).trim();
const client=createClient('https://scvojtvgnkmbupvyslmb.supabase.co',key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const sdk=createSquadClient(client);
const credentials=JSON.parse(readFileSync('../Canto/canto-sync/private/auth-test.json','utf8'));
const save=()=>writeFileSync(checkpoint,JSON.stringify(state,null,2)+'\n',{mode:0o600});
function commandKey(){const key=randomUUID();state.keys.push(key);save();return key;}
function crc32(b){let crc=0xffffffff;for(const value of b){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2cAAAAASUVORK5CYII=','base64');
function png(){const d=Buffer.from('comment\0'+randomUUID());const chunk=Buffer.alloc(d.length+12);chunk.writeUInt32BE(d.length);chunk.write('tEXt',4);d.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return Buffer.concat([original.subarray(0,-12),chunk,original.subarray(-12)]);}
function svg(){const prefix='<svg xmlns="http://www.w3.org/2000/svg"><desc>'+randomUUID(),suffix='</desc><path d="M0 0L1 1"/></svg>';return Buffer.from(prefix+'x'.repeat(5242880-prefix.length-suffix.length)+suffix);}
function pdf(){let header='%PDF-1.7\n';const offsets=[];for(const obj of ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>']){offsets.push(header.length);header+=`${offsets.length} 0 obj\n${obj}\nendobj\n`;}const xref=header.length;header+='xref\n0 4\n0000000000 65535 f \n'+offsets.map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%${randomUUID()}`;const suffix='\n%%EOF\n';return Buffer.from(header+'x'.repeat(26214400-header.length-suffix.length)+suffix);}
function video(){const original=readFileSync('tools/squad/private/upload-video.mp4'),padding=Buffer.alloc(104857600-original.length);padding.writeUInt32BE(padding.length);padding.write('free',4);padding.write(randomUUID(),8);const b=Buffer.concat([original,padding]);writeFileSync('tools/squad/private/upload-max-video.mp4',b);execFileSync('ffmpeg',['-nostdin','-loglevel','error','-i','tools/squad/private/upload-max-video.mp4','-f','null','-']);return b;}
let cases=[{name:'private.png',mime:'image/png',field:'image',bytes:png()},{name:'static.svg',mime:'image/svg+xml',field:'image',bytes:svg()},{name:'document.pdf',mime:'application/pdf',field:'attachment',bytes:pdf()}];
if(process.env.SQUAD_UPLOAD_CASES==='video')cases=[{name:'reference.mp4',mime:'video/mp4',field:'attachment',bytes:video()}];
const {error}=await client.auth.signInWithPassword(credentials);if(error)throw new Error('Controlled upload login failed');
try{
 for(const c of cases){
  const design=await sdk.saveBranding({spec:{type:'print',side:'front',width:'2',height:'3',unit:'inch'}},{idempotencyKey:commandKey()});state.designs.push(design.id);save();
  const target={resource:'brandings',record_id:design.id,field:c.field};const version=(await sdk.mediaGrants([target])).references[0].version;assert.ok(version);
  const hash=createHash('sha256').update(c.bytes).digest('hex');state.hashes.push(hash);save();
  const reserved=await sdk.reserveMediaUpload(target,{filename:c.name,bytes:String(c.bytes.length),content_type:c.mime},{expectedVersion:version,idempotencyKey:commandKey()});state.uploads.push(reserved.upload_id);save();assert.ok(reserved.upload_url);
  let start=performance.now();const up=await fetch(reserved.upload_url,{method:'PUT',headers:{'Content-Type':c.mime},body:c.bytes});assert.equal(up.status,200);await up.body?.cancel();const uploadMs=performance.now()-start;
  const command={expectedVersion:version,idempotencyKey:commandKey()};start=performance.now();const attached=await sdk.finalizeMediaUpload(reserved.upload_id,command);const finalizeMs=performance.now()-start;assert.equal(attached.status,'ready');assert.deepEqual(attached,await sdk.finalizeMediaUpload(reserved.upload_id,command));
  const grant=(await sdk.mediaGrants([target])).references[0];assert.equal(grant.status,'ready');const download=await fetch(grant.url);assert.equal(download.status,200);const downloaded=Buffer.from(await download.arrayBuffer());assert.equal(createHash('sha256').update(downloaded).digest('hex'),hash);assert.equal(download.headers.get('content-type')?.split(';')[0],c.mime);
  const detached=await sdk.detachMedia(target,'Remove controlled test file',{expectedVersion:attached.version,idempotencyKey:commandKey()});assert.equal(detached.status,'empty');assert.equal((await sdk.mediaGrants([target])).references[0].status,'empty');
  state.results.push({content_type:c.mime,bytes:c.bytes.length,upload_ms:Number(uploadMs.toFixed(3)),finalize_ms:Number(finalizeMs.toFixed(3)),checksum_verified:true,retry_idempotent:true,detached:true});save();console.log(JSON.stringify(state.results.at(-1)));
 }
 // A correct declared type/size does not let invalid file bytes enter live media.
 const design=await sdk.saveBranding({spec:{type:'print',side:'front',width:'2',height:'3',unit:'inch'}},{idempotencyKey:commandKey()});state.designs.push(design.id);save();const target={resource:'brandings',record_id:design.id,field:'image'};const version=(await sdk.mediaGrants([target])).references[0].version;
 const u=await sdk.reserveMediaUpload(target,{filename:'invalid.png',bytes:'10',content_type:'image/png'},{expectedVersion:version,idempotencyKey:commandKey()});state.uploads.push(u.upload_id);save();const put=await fetch(u.upload_url,{method:'PUT',headers:{'Content-Type':'image/png'},body:'not-a-png!'});assert.equal(put.status,200);await put.body?.cancel();
 await assert.rejects(sdk.finalizeMediaUpload(u.upload_id,{expectedVersion:version,idempotencyKey:commandKey()}),e=>e instanceof SquadError&&e.code==='INVALID_MEDIA');state.invalid_rejected=true;save();
}finally{await client.auth.signOut({scope:'local'});}
