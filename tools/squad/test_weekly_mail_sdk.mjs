/** Real Auth/shared-SDK email requests and private output downloads. No worker call. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);input='';
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
assert.ok(['setup','download'].includes(config.mode));assert.match(config.run_id,/^[a-f0-9-]{36}$/);
const clients=new Map();
const journal=path.resolve(`tools/squad/private/business-${config.run_id}.jsonl`);assert.equal(journal,path.resolve(config.journal));
const fd=fs.openSync(journal,'a',0o600);
function key(label){
 const bytes=createHash('sha1').update(Buffer.from(config.run_id.replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');
 const id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
 fs.writeSync(fd,JSON.stringify({kind:'command',value:{label,key:id}})+'\n');fs.fsyncSync(fd);return id;
}
try{
 for(const role of [0,7]){
  const actor=config.actors.find(a=>a.role===role);assert.ok(actor);
  const client=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});actor.password='';
  if(login.error)throw new Error('Mail requester Auth failed');assert.equal(login.data.user.id,actor.auth_id);
  const sdk=createSquadClient(client),me=await sdk.me();assert.equal(me.role,role);clients.set(role,{client,sdk});
 }
 const admin=clients.get(0).sdk;
 if(config.mode==='setup'){
  const settings=(await admin.mailSettings()).data.find(x=>x.kind==='tailor_weekly');assert.ok(settings);
  await admin.saveMailSettings('tailor_weekly',[0,2,4].map(role=>config.fixture.actors[String(role)]),{expectedVersion:settings.version,idempotencyKey:key('mail.settings')});
  const schedule=await admin.weeklyTailorSchedule();
  assert.equal(schedule.enabled,false,'Existing schedule must be inactive for rehearsal');
  await admin.configureWeeklyTailorSchedule(true,{expectedVersion:schedule.version,idempotencyKey:key('mail.schedule')});
  const catalogue=await admin.requestDocument('catalogue',{selection:{class_ids:[config.fixture.commercialExtras.rmpClassId]},delivery:'email'},key('mail.catalogue'));
  const request=config.challan_request;assert.equal(request.delivery,'email');assert.match(request.item_id,/^[0-9]+$/);assert.match(request.dispatch_id,/^[0-9]+$/);
  const challan=await clients.get(7).sdk.requestDocument('delivery_challan',request,key('mail.challan'));
  assert.equal(catalogue.state,'queued');assert.equal(challan.state,'queued');console.log(JSON.stringify({manual_documents:[catalogue.id,challan.id],settings_configured_by_sdk:true}));
 }else{
  assert.equal(config.documents.length,3);const directory=path.resolve('tools/squad/private/mail-outputs/'+config.run_id);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const receipts=[];
  for(const expected of config.documents){
   const sdk=clients.get(expected.kind==='delivery_challan'?7:0).sdk,doc=await sdk.document(expected.document_id);
   assert.equal(doc.state,'ready');assert.equal(doc.delivery_state,'sent');const grant=await sdk.downloadDocument(doc.id);
   assert.equal(grant.expires_in,120);const url=new URL(grant.url);assert.equal(url.origin,config.url);
   assert.equal(decodeURIComponent(url.pathname),'/storage/v1/object/sign/squad-documents/'+expected.prefix+'document.pdf');
   const response=await fetch(grant.url,{signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(bytes.length,Number(grant.bytes));
   const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,grant.sha256);
   fs.writeFileSync(path.join(directory,expected.kind+'.pdf'),bytes,{mode:0o600});receipts.push({document_id:doc.id,kind:expected.kind,bytes:bytes.length,sha256:hash,pages:doc.pages,private_sdk_download:true});
  }
  console.log(JSON.stringify({documents:receipts}));
 }
}finally{fs.closeSync(fd);for(const {client} of clients.values())await client.auth.signOut({scope:'local'}).catch(()=>{});for(const actor of config.actors)actor.password='';}
