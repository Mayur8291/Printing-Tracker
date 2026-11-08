/** New customer registration through the actual shared SDK and GoTrue. */
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
const lines=createInterface({input:process.stdin,terminal:false})[Symbol.asyncIterator]();const read=async()=>JSON.parse((await lines.next()).value);const c=await read();
const auth=createClient(c.url,c.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),sdk=createSquadClient(auth);
const profile={first_name:'Disposable',last_name:'Acceptance',company_name:'Squad registration acceptance',phone:'9999999999',addresses:[{address:'Synthetic staging fixture',state:'Test',city:'NoRouting-'+c.request_id,zip_code:'000000'}]};
const requested=await sdk.requestRegistration(c.email,profile,c.request_id);assert.equal(requested.accepted,true);
assert.deepEqual(await sdk.requestRegistration(c.email,profile,c.request_id),requested);
const response=await fetch(c.url+'/functions/v1/squad-jobs/run',{method:'POST',headers:{Authorization:'Bearer '+c.worker_secret,'Content-Type':'application/json'},body:'{"limit":1}'});assert.equal(response.status,200);const jobs=await response.json();assert.equal(jobs.results[0].state,'done');
process.stdout.write(JSON.stringify({step:'mail_ready'})+'\n');const {code}=await read();
const proof={requestId:c.request_id,email:c.email,code,password:c.password};const started=performance.now();const done=await sdk.completeRegistration(proof);const elapsed=performance.now()-started;
assert.equal(done.completed,true);assert.equal(done.user_id,c.legacy_id);assert.equal(done.email_confirmed,true);assert.equal(done.login_allowed,false);assert.equal(done.next,'await_approval');
const login=await auth.auth.signInWithPassword({email:c.email,password:c.password});assert.ok(login.error);assert.equal(login.error.code,'user_banned');
assert.deepEqual(await sdk.completeRegistration(proof),done);
await assert.rejects(sdk.completeRecovery(proof),e=>e instanceof SquadError&&e.code==='INVALID_OR_EXPIRED_CODE');
process.stdout.write(JSON.stringify({step:'complete',environment:'staging',actual_shared_sdk:true,email_code_received:true,new_auth_identity_created:true,stable_legacy_id:true,email_confirmation_separate_from_approval:true,unapproved_login_banned:true,idempotent_completion:true,proof_purpose_bound:true,completion_roundtrip_ms:Math.round(elapsed)})+'\n');process.exit(0);
