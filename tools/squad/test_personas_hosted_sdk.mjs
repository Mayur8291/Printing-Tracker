/** Prepared all-persona GoTrue/shared-SDK acceptance. Secrets arrive only on stdin.
 * Read/scope/session coverage only; no claim of the complete business journeys.
 */
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createSquadClient,SquadError} from '../../packages/shared/squad.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);input='';
assert.equal(config.url,'https://scvojtvgnkmbupvyslmb.supabase.co');
assert.deepEqual(config.actors.map(a=>a.role),[0,1,2,3,4,7,8,9,10,11,12]);
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const forbidden=e=>e instanceof SquadError&&e.kind==='forbidden';
const unavailable=e=>e instanceof SquadError&&e.kind==='unavailable';
const missing=e=>e instanceof SquadError&&e.kind==='not_found';
const report=[];
for(const fixture of config.actors){
 const client=createClient(config.url,config.anon,options);let session;
 try{
  const wrong=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password+'-incorrect'});assert.ok(wrong.error,'Wrong fixture password accepted');
  const login=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});if(login.error)throw new Error(`Role ${fixture.role}: login rejected (${login.error.code||login.error.status})`);
  session=login.data.session;assert.ok(session);assert.equal(session.user.role,'sa_app');assert.equal(session.user.id,fixture.auth_id);
  const sdk=createSquadClient(client),me=await sdk.me();assert.equal(me.role,fixture.role);assert.equal(me.id,fixture.id);assert.ok(!JSON.stringify(me).includes('encrypted_password'));
  assert.equal((await sdk.bootstrap('android','1.0.0')).client,'squad');
  const notifications=await sdk.notifications(null,{limit:2});assert.ok(notifications.data.length<=2);assert.ok(notifications.data.every(n=>!('recipient_id' in n)&&!('token' in n)));
  if(fixture.role===12){await assert.rejects(sdk.orders({}, {limit:1}),forbidden);await assert.rejects(sdk.dashboard(),forbidden);}
  else{
   const positiveOrder=fixture.role===2?config.foreign_order:config.own_order;
   const order=await sdk.order(positiveOrder,{limit:1});assert.equal(order.id,positiveOrder);assert.equal(order.items.data.length,1);
   const page=await sdk.orders({search:config.label},{limit:1});assert.ok(page.data.length<=1);assert.ok(page.data.every(o=>[config.own_order,config.foreign_order].includes(o.id)));
   const dashboard=await sdk.dashboard({search:config.label});assert.ok(dashboard.orders>=1);
   if(fixture.role===2)await assert.rejects(sdk.order(config.own_order,{limit:1}),missing);
   else if(fixture.role===0){assert.equal((await sdk.order(config.foreign_order,{limit:1})).id,config.foreign_order);}
   else await assert.rejects(sdk.order(config.foreign_order,{limit:1}),missing);
   if([3,10].includes(fixture.role)){assert.ok(!('factory_manager_id' in order));assert.ok(!('worker_unit_cost' in order.items.data[0]));}
   if(fixture.role===2){assert.ok(!('payment_status' in order));assert.ok(!('paid_amount' in order));}
  }
  if(me.capabilities.catalogue){const page=await sdk.catalogue('products',{}, {limit:1});assert.ok(page.data.length<=1);}
  if([0,1,2,4,7,8,10].includes(fixture.role)){
   const own=await sdk.person(fixture.id);assert.equal(own.id,fixture.id);
   if([4,7,8].includes(fixture.role)){
    const tailor=await sdk.person(config.tailor_id),sub=await sdk.person(config.subtailor_id);
    for(const subject of [tailor,sub]){
     if(fixture.role===4){assert.ok(Object.hasOwn(subject,'email'));assert.equal(subject.email,null);}
     else{assert.ok(!Object.hasOwn(subject,'email'));assert.ok(!Object.hasOwn(subject,'phone'));}
     for(const field of ['encrypted_password','password','reset_password_token','confirmation_token','unlock_token','auth_user_id','canonical_email'])assert.ok(!Object.hasOwn(subject,field));
     assert.ok(!JSON.stringify(subject).includes('@managed.invalid'));
    }
    await assert.rejects(sdk.person(config.foreign_customer_id),missing);
   }
  }else await assert.rejects(sdk.people(),forbidden);
  if(fixture.role===0){assert.equal(typeof(await sdk.weeklyTailorSchedule()).enabled,'boolean');assert.equal(typeof(await sdk.warehouseSchedule()).enabled,'boolean');}
  else{await assert.rejects(sdk.weeklyTailorSchedule(),forbidden);await assert.rejects(sdk.warehouseSchedule(),forbidden);}
  for(const [schema,table] of [['public','profiles'],['sa_snapshot_20261019','sa_users']]){
   const denied=await client.schema(schema).from(table).select('id').limit(1);assert.ok(denied.error,`${schema} raw table unexpectedly readable`);
  }
  const worker=await client.schema('canto_api').rpc('squad_weekly_tailor_heartbeat',{p_limit:1});assert.ok(worker.error,'Browser invoked service worker');
  await assert.rejects(sdk.saveProfile({name:me.name},{expectedVersion:me.version,idempotencyKey:crypto.randomUUID()}),unavailable);
  // Test mutable user metadata against the real Auth service, never app metadata.
  const metadata=await client.auth.updateUser({data:{role:0,admin:true}});assert.ifError(metadata.error);assert.equal((await sdk.me()).role,fixture.role);
  const refreshed=await client.auth.refreshSession();assert.ifError(refreshed.error);const refreshedMe=await sdk.me();assert.equal(refreshedMe.id,fixture.id);assert.equal(refreshedMe.role,fixture.role);session=refreshed.data.session;
  if(fixture.role!==0)await assert.rejects(sdk.weeklyTailorSchedule(),forbidden);
  const oldAccess=session.access_token,oldRefresh=session.refresh_token;assert.ifError((await client.auth.signOut({scope:'local'})).error);
  const response=await fetch(config.url+'/rest/v1/rpc/v1_me',{method:'POST',headers:{apikey:config.anon,Authorization:'Bearer '+oldAccess,'Content-Profile':'canto_api','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
  assert.ok(!response.ok,'Logged-out access token retained a live application session');const denied=await response.json();assert.ok(['28000','42501','PGRST301','PGRST303'].includes(denied.code));
  assert.ok((await client.auth.refreshSession({refresh_token:oldRefresh})).error,'Logged-out refresh token revived the session');
  report.push({role:fixture.role,legacy_id:fixture.id,auth_id:fixture.auth_id,password_hash_login:true,wrong_password_denied:true,shared_sdk_identity:true,scope_and_field_redaction:true,service_and_raw_tables_denied:true,mirror_write_denied:true,user_metadata_not_authority:true,refresh_and_logout:true});
 }finally{await client.auth.signOut({scope:'local'}).catch(()=>{});fixture.password='';}
}
console.log(JSON.stringify({environment:'staging',scope:'11 synthetic legacy-compatible bcrypt identities through real GoTrue and shared SDK; read/authorization/session coverage, not complete business journeys',actors:report,managed_subjects_have_no_auth:true,business_writes:0,provider_requests:0,emails_sent:0}));
