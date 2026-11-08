/** Actual staging SDK → verified CSV → resumable SQL worker → private export. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),sdk=createSquadClient(client),timings=[];
const {error}=await client.auth.signInWithPassword(config.credentials);assert(!error,'Disposable staff login failed');
const cell=x=>'"'+String(x).replaceAll('"','""')+'"';
const csv=rows=>Buffer.from(rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n');
async function upload(bytes){
 const key=randomUUID(),u=await sdk.reserveTransferUpload('masters','base_product_types',{filename:'types.csv',bytes:bytes.length},key);
 assert.equal(u.state,'reserved');assert.ok(u.upload_url);
 const r=await fetch(u.upload_url,{method:'PUT',headers:{'Content-Type':'text/csv'},body:bytes,signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Signed CSV upload failed');await r.body?.cancel();
 const overwrite=await fetch(u.upload_url,{method:'PUT',headers:{'Content-Type':'text/csv'},body:bytes,signal:AbortSignal.timeout(30000)});assert.ok(overwrite.status>=400,'Signed input must be immutable');await overwrite.body?.cancel();
 const verified=await sdk.verifyTransferUpload(u.id);assert.equal(verified.state,'verified');assert.equal(verified.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal((await sdk.verifyTransferUpload(u.id)).state,'verified');
 return u;
}
async function until(id,target){
 for(let step=0;step<35;step++){
  const start=performance.now();
  const response=await fetch(config.url+'/functions/v1/squad-jobs/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.worker_secret},body:JSON.stringify({limit:3}),signal:AbortSignal.timeout(65000)});
  assert.equal(response.status,200,'Worker invocation failed');const pump=await response.json();assert.equal(pump.paused,false);const transfer=await sdk.transfer(id);
  timings.push({operation:target,step,wall_ms:Number((performance.now()-start).toFixed(3)),state:transfer.state,valid_rows:transfer.valid_rows,applied_rows:transfer.applied_rows});
  if(transfer.state===target)return transfer;
  if(['failed','expired','cancelled'].includes(transfer.state))throw new Error('Transfer failed: '+transfer.error_code);
  assert(!pump.results.some(j=>j.state==='unconfirmed'),'Unconfirmed worker transaction');
 }
 throw new Error('Transfer exceeded bounded acceptance steps');
}
try{
 const names=Array.from({length:201},(_,i)=>config.prefix+'-'+String(i).padStart(4,'0')+'-'+('x'.repeat(1400)));
 names[0]='=1+1 '+config.prefix+' quote "Unicode नमस्ते"\nnew line';
 const bytes=csv([['name'],...names.map(name=>[name])]);assert.ok(bytes.length>262144,'Range acceptance needs more than one read window');
 const u=await upload(bytes),key=randomUUID(),requested=await sdk.requestImport('masters',{upload_id:u.id},key);assert.deepEqual(await sdk.requestImport('masters',{upload_id:u.id},key),requested);
 let transfer=await until(requested.id,'validated');assert.equal(transfer.valid_rows,201);assert.equal(transfer.invalid_rows,0);assert.equal(transfer.applied_rows,0);
 const applying={action:'apply',id:transfer.id,version:transfer.version},applyKey=randomUUID();const applied=await sdk.requestImport('masters',applying,applyKey);assert.deepEqual(await sdk.requestImport('masters',applying,applyKey),applied);
 transfer=await until(requested.id,'completed');assert.equal(transfer.applied_rows,201);
 const exported=await sdk.requestExport('base_product_types',{columns:['id','name'],search:config.prefix},randomUUID());await assert.rejects(sdk.downloadTransfer(exported.id),e=>e instanceof SquadError);
 const out=await until(exported.id,'completed');assert.equal(out.total_rows,201);
 const grant=await sdk.downloadTransfer(out.id),response=await fetch(grant.url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);const output=Buffer.from(await response.arrayBuffer());assert.equal(output.length,Number(grant.bytes));assert.equal(createHash('sha256').update(output).digest('hex'),grant.sha256);
 const text=output.toString('utf8');for(let i=1;i<names.length;i++)assert(text.includes(names[i]));assert(text.includes("'=1+1 "+config.prefix),'Spreadsheet formula must be neutralized');assert(text.includes('नमस्ते'));assert(text.includes('""Unicode'));
 const publicUrl=new URL(grant.url);publicUrl.pathname=publicUrl.pathname.replace('/object/sign/','/object/public/');publicUrl.search='';const denied=await fetch(publicUrl);assert(denied.status>=400);await denied.body?.cancel();
 const unauth=await fetch(config.url+'/functions/v1/squad-account/transfers/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:out.id})});assert.equal(unauth.status,401);
 const bad=await upload(csv([['name'],[config.prefix+'duplicate'],[config.prefix+'duplicate']]));const invalid=await sdk.requestImport('masters',{upload_id:bad.id},randomUUID());const errors=await until(invalid.id,'invalid');assert.equal(errors.invalid_rows,2);assert.equal(errors.applied_rows,0);assert(errors.rows.data.every(r=>r.errors.length));
 await assert.rejects(sdk.requestImport('masters',{action:'apply',id:errors.id,version:errors.version},randomUUID()),e=>e instanceof SquadError);
 const history=await sdk.transfers({limit:2});assert.equal(history.data.length,2);assert(history.next_cursor);const next=await sdk.transfers({limit:2,cursor:history.next_cursor});assert(!next.data.some(r=>history.data.some(h=>h.id===r.id)));
 console.log(JSON.stringify({environment:'staging',shared_sdk:true,deployed_edges:true,import_rows:201,import_bytes:bytes.length,export_bytes:output.length,range_read_exercised:true,write_once_upload:true,validation_before_apply:true,bounded_batches:true,idempotent_requests:true,duplicate_rows_reported:true,formula_escaped:true,unicode_roundtrip:true,sha256_verified:true,private_storage:true,unauthenticated_denied:true,keyset_history:true,timings}));
}finally{await client.auth.signOut({scope:'local'});}
