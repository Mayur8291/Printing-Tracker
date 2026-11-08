/** Two exact synthetic documents: real Edge renderer, private Storage, shared SDK. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);input='';
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
assert.equal(config.documents.length,2);
assert.match(config.run_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
assert.equal(path.resolve(config.output_dir),path.resolve('tools/squad/private/document-outputs/'+config.run_id));
const clients=new Map(),results=[];
try{
 for(const role of [3,4,7]){
  const actor=config.actors.find(a=>a.role===role);assert.ok(actor);
  const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});actor.password='';
  if(login.error)throw new Error('Document requester login failed');assert.equal(login.data.user.id,actor.auth_id);
  clients.set(role,{client,sdk:createSquadClient(client)});
 }
 fs.mkdirSync(config.output_dir,{recursive:true,mode:0o700});
 for(const expected of config.documents){
  assert.ok(['delivery_challan','tailor_weekly'].includes(expected.kind));
  const {sdk}=clients.get(expected.role),foreign=clients.get(3).sdk,timings=[];
  let doc=await sdk.document(expected.document_id);assert.equal(doc.job_id,expected.job_id);assert.equal(doc.state,'queued');
  await assert.rejects(sdk.downloadDocument(doc.id),e=>e instanceof SquadError);
  for(let step=0;step<6&&doc.state!=='ready';step++){
   const start=performance.now();
   const response=await fetch(config.url+'/functions/v1/squad-jobs/document-rehearsal',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.worker_secret},body:JSON.stringify({job_id:expected.job_id}),signal:AbortSignal.timeout(60000)});
   if(response.status!==200)throw new Error('Exact document worker HTTP '+response.status);
   const result=await response.json();assert.equal(result.paused,false);assert.ok(result.results.length<=1);
   for(const row of result.results){assert.equal(row.id,expected.job_id);assert.ok(!['unconfirmed','dead'].includes(row.state),'Document result not confirmed');}
   timings.push({step,wall_ms:Math.round(performance.now()-start),states:result.results.map(x=>x.state)});
   doc=await sdk.document(expected.document_id);assert.notEqual(doc.state,'failed');
   if(doc.state!=='ready'&&result.results.length===0)throw new Error('Exact document worker is busy; retain recovery checkpoint');
  }
  assert.equal(doc.state,'ready');assert.equal(doc.delivery_state,'not_requested');assert.equal(doc.kind,expected.kind);
  const grant=await sdk.downloadDocument(doc.id);assert.equal(grant.expires_in,120);
  const signed=new URL(grant.url);assert.equal(signed.origin,config.url);
  assert.equal(decodeURIComponent(signed.pathname),'/storage/v1/object/sign/squad-documents/'+expected.prefix+'document.pdf');
  const response=await fetch(grant.url,{signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);
  const pdf=Buffer.from(await response.arrayBuffer());assert.equal(pdf.length,Number(grant.bytes));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const sha256=createHash('sha256').update(pdf).digest('hex');assert.equal(sha256,grant.sha256);
  fs.writeFileSync(path.join(config.output_dir,expected.kind+'.pdf'),pdf,{mode:0o600});
  const publicUrl=signed.origin+signed.pathname.replace('/object/sign/','/object/public/');
  const publicResponse=await fetch(publicUrl,{signal:AbortSignal.timeout(30000)});assert.ok(publicResponse.status>=400);await publicResponse.body?.cancel();
  await assert.rejects(foreign.document(doc.id),e=>e instanceof SquadError&&e.kind==='not_found');
  await assert.rejects(foreign.downloadDocument(doc.id),e=>e instanceof SquadError&&e.kind==='not_found');
  const anonymous=await fetch(config.url+'/functions/v1/squad-account/documents/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:doc.id}),signal:AbortSignal.timeout(30000)});assert.equal(anonymous.status,401);await anonymous.body?.cancel();
  results.push({kind:expected.kind,document_id:doc.id,job_id:expected.job_id,bytes:pdf.length,sha256,pages:doc.pages,private_storage:true,download_expiry_seconds:120,foreign_authenticated_denied:true,unauthenticated_denied:true,public_storage_denied:true,timings});
 }
 console.log(JSON.stringify({documents:results,actual_sdk_download:true,deployed_renderer:true,emails_sent:0,inbox_delivery_asserted:false,automatic_cron_asserted:false}));
}finally{for(const {client} of clients.values())await client.auth.signOut({scope:'local'}).catch(()=>{});for(const actor of config.actors)actor.password='';}
