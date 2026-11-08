import {reconcileAccount,authAdmin,AccountProviderError,type AccountTarget,type AuthUser,type AuthAdmin} from './accounts.ts';
import type {Rpc} from './handler.ts';
function assert(value:unknown,message='assertion failed'):asserts value {if(!value)throw new Error(message);}
const target:AccountTarget={auth_user_id:'11111111-1111-4111-8111-111111111111',legacy_user_id:'42',email:'fixture@example.invalid',legacy_role_id:3,allowed:true,source_confirmed:true};
const job={id:'job',lease_token:'lease'};
function user(t=target):AuthUser{return{id:t.auth_user_id,email:t.email,role:'sa_app',email_confirmed_at:'2026-01-01',app_metadata:{application:'canto',legacy_user_id:t.legacy_user_id,legacy_role_id:t.legacy_role_id}};}
function fixture(t:AccountTarget=target,initial:AuthUser|null=user(t)){
 let current=initial;const changes:Array<Record<string,unknown>>=[];let attestation:Record<string,unknown>={};
 const auth:AuthAdmin={get:async()=>current,create:async(body)=>{changes.push(body);current={...user(t),email_confirmed_at:body.email_confirm?'2026-01-01':null};return current;},update:async(_id,body)=>{changes.push(body);current={...current!,...(body.app_metadata?{app_metadata:body.app_metadata as Record<string,unknown>}:{}),...(body.ban_duration?{banned_until:body.ban_duration==='none'?null:'2126-01-01'}:{})};return current;}};
 const rpc:Rpc=async(name,args)=>{if(name==='squad_account_prepare')return t;assert(name==='squad_account_finish');attestation=args;return{id:'job',state:args.p_error?'pending':'done'};};
 return{auth,rpc,changes,result:()=>attestation};
}
Deno.test('existing account reconciliation never sends passwords or reconfirms email',async()=>{
 const f=fixture({...target,password_hash:'$2a$12$'+'a'.repeat(53)});await reconcileAccount(f.rpc,f.auth)(job);assert(f.changes.length===0);assert(!JSON.stringify(f.result()).includes('$2a$'));assert(f.result().p_error===null);
});
Deno.test('first activation uses the exact reserved identity and legacy bcrypt once',async()=>{
 const hash='$2a$12$'+'a'.repeat(53);const f=fixture({...target,password_hash:hash,source_confirmed:false},null);await reconcileAccount(f.rpc,f.auth)(job);
 assert(f.changes[0].id===target.auth_user_id&&f.changes[0].password_hash===hash&&f.changes[0].email_confirm===true);assert(!('password' in f.changes[0]));assert(!JSON.stringify(f.result()).includes(hash));
});
Deno.test('new people receive random unusable credentials pending invitation',async()=>{
 const f=fixture({...target,source_confirmed:false},null);await reconcileAccount(f.rpc,f.auth)(job);assert(f.changes[0].email_confirm===false);assert(typeof f.changes[0].password==='string'&&f.changes[0].password.length>64);assert(!JSON.stringify(f.result()).includes(String(f.changes[0].password)));
});
Deno.test('blocked absent accounts do not create GoTrue identities',async()=>{
 const f=fixture({...target,allowed:false},null);await reconcileAccount(f.rpc,f.auth)(job);assert(f.changes.length===0);assert((f.result().p_result as any).exists===false);
});
Deno.test('lost create response reconciles by reserved UUID without resetting password',async()=>{
 const f=fixture(target,null);const create=f.auth.create;let calls=0;f.auth.create=async b=>{calls++;await create(b);throw new Error('response lost');};await reconcileAccount(f.rpc,f.auth)(job);assert(calls===1&&f.changes.length===1&&f.result().p_error===null);
});
Deno.test('foreign email, identity, application and role fail closed without writes',async()=>{
 for(const invalid of [{id:crypto.randomUUID()},{email:'other@example.invalid'},{role:'authenticated'},{app_metadata:{application:'other',legacy_user_id:'42'}},{app_metadata:{application:'canto',legacy_user_id:'43'}}]){
  const f=fixture(target,{...user(),...invalid});await reconcileAccount(f.rpc,f.auth)(job);assert(f.changes.length===0&&f.result().p_error==='IDENTITY_CONFLICT');
 }
});
Deno.test('disable and enable change only ban state and verified role metadata',async()=>{
 const f=fixture({...target,allowed:false});await reconcileAccount(f.rpc,f.auth)(job);assert(f.changes[0].ban_duration==='876000h');
 const g=fixture(target,{...user(),banned_until:'2126-01-01'});await reconcileAccount(g.rpc,g.auth)(job);assert(g.changes[0].ban_duration==='none');
 const h=fixture({...target,legacy_role_id:12},user());await reconcileAccount(h.rpc,h.auth)(job);assert((h.changes[0].app_metadata as any).legacy_role_id===12);assert(!('password' in h.changes[0]));
});
Deno.test('provider outages produce sanitized bounded-retry classifications',async()=>{
 const f=fixture();f.auth.get=()=>{throw new Error('private provider credentials');};await reconcileAccount(f.rpc,f.auth)(job);assert(f.result().p_error==='PROVIDER_UNAVAILABLE');assert(!JSON.stringify(f.result()).includes('credentials'));
});
Deno.test('prepare identity conflict is settled without calling provider',async()=>{
 let finished=false;const f=fixture();f.auth.get=()=>{throw new Error('must not run');};const rpc:Rpc=async(name,args)=>{if(name==='squad_account_prepare')throw new AccountProviderError('IDENTITY_CONFLICT');finished=true;assert(args.p_error==='IDENTITY_CONFLICT');return{id:job.id,state:'dead'};};assert((await reconcileAccount(rpc,f.auth)(job)).state==='dead'&&finished);
});
Deno.test('superseded account intent skips GoTrue and completes safely',async()=>{
 const f=fixture({...target,superseded:true});f.auth.get=()=>{throw new Error('must not run');};await reconcileAccount(f.rpc,f.auth)(job);assert((f.result().p_result as any).superseded===true);
});
Deno.test('uncertain completion is left for durable retry rather than a second provider write',async()=>{
 const f=fixture({...target,allowed:false});let failed=false;try{await reconcileAccount(async(n,a)=>{if(n==='squad_account_finish')throw new Error('lost');return f.rpc(n,a);},f.auth)(job);}catch{failed=true;}assert(failed&&f.changes.length===1);
});
Deno.test('GoTrue transport bounds calls and never returns provider error payloads',async()=>{
 const calls:RequestInit[]=[];const transport=(async(_url:unknown,init:RequestInit)=>{calls.push(init);return new Response(JSON.stringify(user()),{status:200});}) as typeof fetch;
 const a=authAdmin('https://test.invalid','secret',transport);await a.get(target.auth_user_id);await a.update(target.auth_user_id,{ban_duration:'none'});assert(calls.every(c=>c.signal&&c.headers));
 for(const status of [404,409,500]){const b=authAdmin('https://test.invalid','secret',(async()=>new Response('private provider detail',{status})) as typeof fetch);if(status===404)assert(await b.get(target.auth_user_id)===null);else{let error:unknown;try{await b.get(target.auth_user_id);}catch(e){error=e;}assert(error instanceof AccountProviderError&&error.message===(status===409?'IDENTITY_CONFLICT':'PROVIDER_UNAVAILABLE'));}}
});
Deno.test('managed subjects reconcile without any GoTrue identity or password',async()=>{
 const f=fixture({...target,managed_subject:true,allowed:false});f.auth.get=()=>{throw new Error('must not run');};await reconcileAccount(f.rpc,f.auth)(job);assert((f.result().p_result as any).auth_user_id===null&&(f.result().p_result as any).exists===false);
});
