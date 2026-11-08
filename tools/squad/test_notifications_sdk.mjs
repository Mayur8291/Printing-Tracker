/** Controlled staging worker journey; credentials enter on stdin, never stdout. */
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient} from '../../packages/shared/squad.js';
let input='';for await(const part of process.stdin)input+=part;const config=JSON.parse(input);
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
const supabase=createClient(config.url,config.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const {error}=await supabase.auth.signInWithPassword(config.credentials);if(error)throw new Error('Controlled login failed');
try{
 const sdk=createSquadClient(supabase);const binding=await sdk.saveDevice(config.installation,'android',config.token,{idempotencyKey:config.command});
 const response=await fetch(config.url+'/functions/v1/squad-jobs/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.worker_secret},body:JSON.stringify({limit:5}),signal:AbortSignal.timeout(60000)});
 assert.equal(response.status,200);const pump=await response.json();assert.equal(pump.paused,false);assert.equal(pump.results.find(x=>x.id===config.job)?.state,'done');
 const inbox=await sdk.notifications(null,{limit:1});assert.equal(inbox.data.length,1);assert.equal(inbox.data[0].push_state,'validated');assert.equal(inbox.data[0].target.kind,'person');assert.equal(inbox.data[0].target.id,config.legacy_id);
 assert.equal((await sdk.notificationFromPush({project_ref:'scvojtvgnkmbupvyslmb',notification_id:inbox.data[0].id,generation:inbox.generation},'scvojtvgnkmbupvyslmb')).id,inbox.data[0].id);
 assert.equal(await sdk.notificationFromPush({project_ref:'levwrmvqdntngeasrtnb',notification_id:inbox.data[0].id,generation:inbox.generation},'scvojtvgnkmbupvyslmb'),null);
 console.log(JSON.stringify({environment:'staging',real_shared_sdk:true,deployed_worker:true,provider:'FCM HTTP v1',push_state:inbox.data[0].push_state,device_id:binding.id,notification_id:inbox.data[0].id,notifications_sent:0}));
}finally{await supabase.auth.signOut({scope:'local'});}
