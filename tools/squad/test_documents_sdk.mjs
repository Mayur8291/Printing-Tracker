/** Staging-only real SDK -> durable render -> private Storage -> scoped download. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const {error}=await client.auth.signInWithPassword(config.credentials);if(error)throw new Error('Controlled login failed');
try{
 const delivery=(config.synthetic_media||config.cron_mode)?'download':'email';
 const sdk=createSquadClient(client),timings=[];const spec={selection:{class_ids:config.classes},company_name:'Squad One staging acceptance',remarks:'Controlled acceptance test. Not a commercial offer.',delivery};
 let started=performance.now();const requested=await sdk.requestDocument('catalogue',spec,config.command);timings.push({operation:'request',wall_ms:performance.now()-started});
 assert.deepEqual(await sdk.requestDocument('catalogue',spec,config.command),requested);
 await assert.rejects(sdk.downloadDocument(requested.id),e=>e instanceof SquadError);
 let doc;
 for(let step=0;step<40;step++){
  let pump={results:[]};
  if(config.cron_mode){await new Promise(resolve=>setTimeout(resolve,3000));timings.push({operation:'cron_poll',step});}
  else{
  started=performance.now();const response=await fetch(config.url+'/functions/v1/squad-jobs/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.worker_secret},body:JSON.stringify({limit:3}),signal:AbortSignal.timeout(60000)});
  if(response.status!==200)throw new Error('Worker HTTP '+response.status);
  pump=await response.json();assert.equal(pump.paused,false);timings.push({operation:'worker',step,wall_ms:performance.now()-started,states:pump.results.map(j=>j.state)});
  }
  doc=await sdk.document(requested.id);
  if(doc.state==='failed'||doc.delivery_state==='failed')throw new Error('Document failed: '+JSON.stringify({state:doc.state,error:doc.error_code,delivery:doc.delivery_state,pump:pump.results}));
  if(doc.state==='ready'&&(delivery==='download'||doc.delivery_state==='sent'))break;
  if(pump.results.some(j=>j.state==='unconfirmed'))throw new Error('Worker result unconfirmed');
 }
 assert.equal(doc.state,'ready');assert.equal(doc.delivery_state,delivery==='email'?'sent':'not_requested');assert.ok(doc.completed_parts>=2,'Multi-part rendering was not exercised');
 const listed=await sdk.documents({kind:'catalogue'},{limit:2});assert.ok(listed.data.some(d=>d.id===doc.id));
 const grant=await sdk.downloadDocument(doc.id);assert.equal(grant.expires_in,120);
 const download=await fetch(grant.url,{signal:AbortSignal.timeout(60000)});assert.equal(download.status,200);const pdf=Buffer.from(await download.arrayBuffer());
 assert.equal(pdf.length,Number(grant.bytes));assert.equal(createHash('sha256').update(pdf).digest('hex'),grant.sha256);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 writeFileSync('tools/squad/private/documents/'+(config.synthetic_media?'staging-synthetic-images':'staging-catalogue')+'.pdf',pdf,{mode:0o600});
 const parsed=new URL(grant.url),publicUrl=parsed.origin+parsed.pathname.replace('/object/sign/','/object/public/');const publicResponse=await fetch(publicUrl);assert.ok(publicResponse.status>=400);await publicResponse.body?.cancel();
 const denied=await fetch(config.url+'/functions/v1/squad-account/documents/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:doc.id})});assert.equal(denied.status,401);
 await assert.rejects(sdk.downloadDocument('00000000-0000-4000-8000-000000000001'),e=>e instanceof SquadError&&e.kind==='not_found');
 console.log(JSON.stringify({environment:'staging',shared_sdk:true,deployed_edges:true,document_id:doc.id,pages:doc.pages,bytes:pdf.length,completed_parts:doc.completed_parts,private_storage:true,unauthenticated_denied:true,foreign_or_missing_document_denied:true,sha256_verified:true,email_provider_accepted:delivery==='email',synthetic_images:Boolean(config.synthetic_media),automatic_cron:Boolean(config.cron_mode),inbox_delivery_asserted:false,timings}));
}finally{await client.auth.signOut({scope:'local'});}
