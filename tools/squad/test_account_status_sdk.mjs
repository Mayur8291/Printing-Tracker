/** Real staging account access journey. Secrets arrive only through stdin. */
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
const input=JSON.parse(readFileSync(0,'utf8'));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const staff=createClient(input.url,input.anon,options),customer=createClient(input.url,input.anon,options);
async function login(client,credentials){const r=await client.auth.signInWithPassword(credentials);assert.ok(!r.error,'Controlled account login failed');return r.data.session;}
async function request(path,body,authorization){const r=await fetch(input.url+path,{method:'POST',headers:{apikey:input.anon,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
await login(staff,input.staff);const before=await login(customer,input.customer),sdk=createSquadClient(staff),me=await createSquadClient(customer).me();assert.equal(me.id,input.legacy_id);
const timings=[];
try{
 const command={expectedVersion:input.version,idempotencyKey:crypto.randomUUID()};let start=performance.now();const disabled=await sdk.setAccountStatus(input.legacy_id,'disable','Controlled staging account acceptance',command);timings.push({operation:'disable',ms:Math.round(performance.now()-start)});
 assert.deepEqual(await sdk.setAccountStatus(input.legacy_id,'disable','Controlled staging account acceptance',command),disabled);
 await assert.rejects(createSquadClient(customer).me(),e=>e instanceof SquadError&&e.kind==='session');
 let pump=await request('/functions/v1/squad-jobs/run',{limit:3},'Bearer '+input.worker_secret);assert.equal(pump.status,200,'Account worker failed');assert.ok(pump.body.results.some(r=>r.state==='done'),'Disable reconciliation not completed');
 assert.ok((await customer.auth.signInWithPassword(input.customer)).error,'Disabled account could still log in');
 start=performance.now();const enabled=await sdk.setAccountStatus(input.legacy_id,'enable','Controlled staging account acceptance',{expectedVersion:disabled.version,idempotencyKey:crypto.randomUUID()});timings.push({operation:'enable',ms:Math.round(performance.now()-start)});assert.equal(enabled.state,'enabled');
 pump=await request('/functions/v1/squad-jobs/run',{limit:3},'Bearer '+input.worker_secret);assert.equal(pump.status,200);assert.ok(pump.body.results.some(r=>r.state==='done'),'Enable reconciliation not completed');
 const stale=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:before.refresh_token},'Bearer '+input.anon);assert.ok(stale.status>=400,'Old refresh session revived');
 const denied=await fetch(input.url+'/rest/v1/rpc/v1_me',{method:'POST',headers:{apikey:input.anon,Authorization:'Bearer '+before.access_token,'Content-Type':'application/json','Content-Profile':'canto_api'},body:'{}'});assert.ok(!denied.ok,'Old access session revived');await denied.body?.cancel();
 await login(customer,input.customer);assert.equal((await createSquadClient(customer).me()).id,input.legacy_id);
 await assert.rejects(createSquadClient(customer).setAccountStatus(input.legacy_id,'disable','Forbidden customer request',{expectedVersion:enabled.version,idempotencyKey:crypto.randomUUID()}),e=>e instanceof SquadError&&e.kind==='forbidden');
 console.log(JSON.stringify({environment:'staging',actualSDK:true,actualGoTrue:true,actualEdgeWorker:true,immediateAccessRevoked:true,oldRefreshRevoked:true,oldAccessStillRevokedAfterEnable:true,samePasswordLoginRestored:true,idempotentStatus:true,customerDenied:true,timings}));
}finally{await customer.auth.signOut({scope:'local'});await staff.auth.signOut({scope:'local'});}
