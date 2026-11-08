import {accountFlow,type FlowDependencies} from './flows.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {AccountError} from './errors.ts';
import type {AuthUser} from '../_shared/squad-auth.ts';
function assert(v:unknown):asserts v{if(!v)throw new Error('assertion failed');}
const crypto=accountCrypto('test-only-never-production-account-secret');
const flow='11111111-1111-4111-8111-111111111111',auth='22222222-2222-4222-8222-222222222222',lease='33333333-3333-4333-8333-333333333333';
const target={flow_id:flow,purpose:'recovery',auth_user_id:auth,legacy_user_id:'103',legacy_role_id:3,email:'fixture@example.invalid',allowed:true,lease_token:lease,provider_committed:false};
const body={action:'complete',request_id:flow,email:target.email,code:'12345678',password:'User-selected-password-123'};
function fixture(overrides:Record<string,unknown>={},absent=false){
 let user:AuthUser|null=absent?null:{id:auth,email:target.email,role:'sa_app',email_confirmed_at:'2026-01-01',app_metadata:{application:'canto',legacy_user_id:'103',legacy_role_id:3}};
 const calls:Array<[string,Record<string,unknown>]> =[],writes:Record<string,unknown>[]=[];
 const deps:FlowDependencies={crypto,emailAvailable:async()=>true,authorizeInvite:async()=>({grant:lease,email:target.email}),
  rpc:async(name,args)=>{calls.push([name,args]);return name==='squad_account_flow_prepare'?{...target,...overrides}:name==='squad_account_flow_request'?{accepted:true,request_id:flow,expires_in:900}:args.p_error?{error:args.p_error}:{completed:true,next:'sign_in'};},
  auth:{get:async()=>user,create:async b=>{writes.push(b);user={id:auth,email:target.email,role:'sa_app',email_confirmed_at:'2026-01-01',app_metadata:b.app_metadata as Record<string,unknown>};return user;},update:async(_id,b)=>{writes.push(b);user={...user!,app_metadata:b.app_metadata as Record<string,unknown>,email_confirmed_at:'2026-01-01'};return user;}}};
 return{deps,calls,writes};
}
Deno.test('proof request queues encrypted code and never returns password or code',async()=>{
 const f=fixture();const result=await accountFlow(f.deps,'Bearer anon','recovery',{action:'request',request_id:flow,email:target.email});assert(result.accepted);const args=f.calls[0][1];assert(typeof args.p_code_hash==='string'&&args.p_code_hash.length===64);const code=await crypto.open(flow,target.email,String(args.p_code_cipher));assert(/^\d{8}$/.test(code));assert(!JSON.stringify(result).includes(code));assert(f.writes.length===0);
});
Deno.test('invitation target comes from caller-authorized RPC rather than user email',async()=>{
 const f=fixture();let authorized=false;f.deps.authorizeInvite=async(a,id)=>{assert(a==='Bearer staff'&&id==='103');authorized=true;return{grant:lease,email:target.email};};await accountFlow(f.deps,'Bearer staff','users/invite',{action:'request',request_id:flow,user_id:'103'});assert(authorized&&f.calls[0][1].p_invitation_grant===lease);let denied=false;try{await accountFlow(f.deps,'Bearer staff','users/invite',{action:'request',request_id:flow,user_id:'103',email:'foreign@example.invalid'});}catch{denied=true;}assert(denied);
});
Deno.test('complete binds route, proof and password fingerprint without sending password to DB',async()=>{
 const f=fixture();assert((await accountFlow(f.deps,'Bearer anon','recovery',body)).completed);assert(f.calls[0][1].p_purpose==='recovery');assert(!JSON.stringify(f.calls).includes(body.password));assert(f.writes.length===1&&f.writes[0].password===body.password);
});
Deno.test('invalid code causes no provider read or write',async()=>{
 const f=fixture({error:'INVALID_OR_EXPIRED_CODE'});f.deps.auth.get=()=>{throw new Error('must not run');};let rejected=false;try{await accountFlow(f.deps,'Bearer anon','recovery',body);}catch(e){rejected=e instanceof AccountError&&e.code==='INVALID_OR_EXPIRED_CODE';}assert(rejected&&f.writes.length===0);
});
Deno.test('completed idempotent retry never resets an existing password',async()=>{
 const f=fixture({replayed:true,result:{completed:true}});f.deps.auth.get=()=>{throw new Error('must not run');};assert((await accountFlow(f.deps,'Bearer anon','recovery',body)).completed);assert(f.writes.length===0);
});
Deno.test('lost create response reconciles by immutable ID and metadata without password replay',async()=>{
 const f=fixture({purpose:'register',allowed:false},true);const create=f.deps.auth.create;f.deps.auth.create=async b=>{await create(b);throw new Error('lost response');};assert((await accountFlow(f.deps,'Bearer anon','register',body)).completed);assert(f.writes.length===1&&f.writes[0].id===auth&&f.writes[0].ban_duration==='876000h');
});
Deno.test('lost successful update response is completed by authoritative credential revision',async()=>{
 const f=fixture();const update=f.deps.auth.update;f.deps.auth.update=async(id,b)=>{await update(id,b);throw new Error('lost response');};const rpc=f.deps.rpc;f.deps.rpc=async(n,a)=>n==='squad_account_flow_finish'?{completed:true}:rpc(n,a);assert((await accountFlow(f.deps,'Bearer anon','recovery',body)).completed);assert(f.writes.length===1);
});
Deno.test('provider marker proves retry already applied and skips another password update',async()=>{
 const f=fixture({provider_committed:true});f.deps.auth.get=async()=>({id:auth,email:target.email,role:'sa_app',email_confirmed_at:'2026-01-01',app_metadata:{application:'canto',legacy_user_id:'103',legacy_role_id:3,squad_account_flow:flow}});assert((await accountFlow(f.deps,'Bearer anon','recovery',body)).completed);assert(f.writes.length===0);
});
Deno.test('a foreign provider account cannot be reassigned or reset',async()=>{
 const f=fixture();f.deps.auth.get=async()=>({id:auth,email:target.email,role:'authenticated'});let denied=false;try{await accountFlow(f.deps,'Bearer anon','recovery',body);}catch(e){denied=e instanceof AccountError&&e.code==='IDENTITY_CONFLICT';}assert(denied&&f.writes.length===0);
});
Deno.test('proof routes reject roles, arbitrary identities, short and overlong passwords before DB',async()=>{
 for(const invalid of [{...body,role:0},{...body,auth_user_id:auth},{...body,password:'short'},{...body,password:'é'.repeat(40)},{...body,code:'1234'}]){const f=fixture();let denied=false;try{await accountFlow(f.deps,'Bearer anon','recovery',invalid);}catch(e){denied=e instanceof AccountError&&e.code==='INVALID_REQUEST';}assert(denied&&f.calls.length===0);}
});
