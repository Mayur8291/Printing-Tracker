/** Hosted test of the actual shared mobile/web client. Never print credentials. */
import { readFileSync,writeFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSquadClient, SquadError } from '../../packages/shared/squad.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const credentials=JSON.parse(readFileSync(process.env.SQUAD_TEST_CREDENTIALS || path.resolve(root,'../Canto/canto-sync/private/auth-test.json'),'utf8'));
const key=execFileSync(path.join(root,'tools/canto-sync/.venv/bin/python'),['-c',
  "import sys;sys.path.insert(0,'tools/canto-sync');from auth_test import keys;print(keys('staging'))"],{cwd:root,encoding:'utf8'}).trim();
const client=createClient('https://scvojtvgnkmbupvyslmb.supabase.co',key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const sdk=createSquadClient(client);let oldToken;
await assert.rejects(sdk.mediaGrants([{resource:'base_products',record_id:'1',field:'image'}]),e=>e instanceof SquadError && e.kind==='session');
const {error}=await client.auth.signInWithPassword(credentials);if(error)throw new Error('Controlled media login failed');
try{
 oldToken=(await client.auth.getSession()).data.session.access_token;
 const catalogue=await sdk.catalogue('products',{}, {limit:100});
 const available=catalogue.data.filter(p=>p.image?.status==='ready');assert.ok(available.length>=25);
 const samples=[];let grants;for(let n=0;n<11;n++){const started=performance.now();grants=await sdk.mediaGrants(available.slice(0,25).map(p=>p.image));samples.push(performance.now()-started);}
 assert.equal(grants.references.length,25);assert.ok(grants.references.every(r=>r.status==='ready'&&r.url&&r.expires_in===120));
 const media=grants.references.find(r=>Number(r.bytes)<=8*1024*1024);assert.ok(media);
 const response=await fetch(media.url);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,Number(media.bytes));
 const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,new URL(media.url).pathname.split('/').at(-1));
 const publicUrl=new URL(media.url);publicUrl.pathname=publicUrl.pathname.replace('/object/sign/','/object/public/');publicUrl.search='';
 const publicResponse=await fetch(publicUrl);assert.notEqual(publicResponse.status,200);await publicResponse.body?.cancel();
 await assert.rejects(sdk.mediaGrants([{resource:'users',record_id:'1',field:'encrypted_password'}]),e=>e instanceof SquadError&&e.kind==='validation');
 const report={environment:'staging',measured_at:new Date().toISOString(),checks:['actual GoTrue login and shared SDK','25 actual signed grants','download byte length and SHA256 verified','unsigned public-bucket access denied','forbidden source column denied'],first_batch_ms:Number(samples[0].toFixed(3)),warm_samples_ms:samples.slice(1).map(x=>Number(x.toFixed(3))),warm_p95_ms:Number(Math.max(...samples.slice(1)).toFixed(3)),scope:'25-reference end-to-end batch from this Mac in India; warm ten-sample p95, separately from database budget; no business or Storage writes'};
 writeFileSync(path.join(root,'docs/squad-one-audit/implementation-evidence/staging-media-sdk.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{
 await client.auth.signOut({scope:'local'});
 if(oldToken){
  const denied=await fetch('https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/squad-account/media/grants',{method:'POST',headers:{Authorization:`Bearer ${oldToken}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({references:[{resource:'base_products',record_id:'1',field:'image'}]})});
  assert.equal(denied.status,401);await denied.body?.cancel();const evidencePath=path.join(root,'docs/squad-one-audit/implementation-evidence/staging-media-sdk.json');const evidence=JSON.parse(readFileSync(evidencePath,'utf8'));evidence.checks.push('revoked live session denied by deployed account function');writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');console.log('Revoked session denied by deployed account function');
 }
}
