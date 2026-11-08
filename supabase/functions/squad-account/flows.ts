import {AccountError} from './errors.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {AccountProviderError,validateUser,type AuthAdmin} from '../_shared/squad-auth.ts';
export interface FlowDependencies{
 crypto:ReturnType<typeof accountCrypto>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;
 authorizeInvite:(authorization:string,id:string)=>Promise<{grant:string;email:string}>;
 auth:AuthAdmin;
 emailAvailable:(email:string)=>Promise<boolean>;
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function email(v:unknown){
 if(typeof v!=='string'||v.trim().length>254||!/^[^\s\x00-\x1f\x7f<>;,"@]+@[^\s\x00-\x1f\x7f<>;,"@]+\.[^\s\x00-\x1f\x7f<>;,"@]+$/.test(v.trim()))throw new AccountError('INVALID_REQUEST',400);
 return v.trim().toLowerCase();
}
function result(value:any){
 if(value?.error){const code=String(value.error);throw new AccountError(code,['ACCOUNT_REQUEST_BUSY','PROVIDER_UNAVAILABLE'].includes(code)?503:['ACCOUNT_REQUEST_CONFLICT'].includes(code)?409:400);}return value;
}
export async function accountFlow(deps:FlowDependencies,authorization:string,route:string,input:Record<string,unknown>){
 const purpose=route==='users/invite'?'invite':route;
 if(!['register','confirm','recovery','invite'].includes(purpose)||!['request','complete'].includes(String(input.action)))throw new AccountError('INVALID_REQUEST',400);
 const allowed=input.action==='request'?['action','request_id',...(purpose==='invite'?['user_id']:['email']),...(purpose==='register'?['profile']:[])]:['action','request_id','email','code','password'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||!uuid(input.request_id))throw new AccountError('INVALID_REQUEST',400);
 if(input.action==='request'){
  let recipient:string,grant:string|null=null;
  if(purpose==='invite'){
   if(typeof input.user_id!=='string'||!/^[1-9][0-9]{0,18}$/.test(input.user_id))throw new AccountError('INVALID_REQUEST',400);
   const target=await deps.authorizeInvite(authorization,input.user_id);recipient=email(target.email);grant=target.grant;
  }else recipient=email(input.email);
  const profile=purpose==='register'?input.profile:{};
  if(!profile||typeof profile!=='object'||Array.isArray(profile))throw new AccountError('INVALID_REQUEST',400);
  const code=deps.crypto.code(),id=input.request_id;
  const [hash,cipher,fingerprint,available]=await Promise.all([deps.crypto.proof(id,recipient,code),deps.crypto.seal(id,recipient,code),deps.crypto.request(purpose,recipient,profile),purpose==='register'?deps.emailAvailable(recipient):Promise.resolve(false)]);
  return result(await deps.rpc('squad_account_flow_request',{p_id:id,p_purpose:purpose,p_email:recipient,p_payload:profile,p_input_fingerprint:fingerprint,p_code_hash:hash,p_code_cipher:cipher,p_provider_available:available,p_invitation_grant:grant}));
 }
 const recipient=email(input.email);
 if(typeof input.code!=='string'||!/^\d{8}$/.test(input.code)||typeof input.password!=='string'||input.password.length<12||new TextEncoder().encode(input.password).byteLength>72)throw new AccountError('INVALID_REQUEST',400);
 const [hash,fingerprint,available]=await Promise.all([deps.crypto.proof(input.request_id,recipient,input.code),deps.crypto.password(input.request_id,input.password),purpose==='register'?deps.emailAvailable(recipient):Promise.resolve(false)]);
 const target=result(await deps.rpc('squad_account_flow_prepare',{p_id:input.request_id,p_purpose:purpose,p_email:recipient,p_code_hash:hash,p_password_fingerprint:fingerprint,p_provider_available:available}));
 if(target.replayed)return target.result;
 if(target.purpose!==purpose||!uuid(target.auth_user_id)||target.email!==recipient||!uuid(target.lease_token)||target.flow_id!==input.request_id)throw new AccountError('ACCOUNT_UNAVAILABLE',400);
 let error:string|null=null;
 try{
  let user=await deps.auth.get(target.auth_user_id);
  const metadata={application:'canto',legacy_user_id:target.legacy_user_id,legacy_role_id:target.legacy_role_id,squad_account_flow:target.flow_id};
  const body={password:input.password,email_confirm:true,ban_duration:target.allowed?'none':'876000h',app_metadata:metadata};
  if(!user){
   try{user=await deps.auth.create({...body,id:target.auth_user_id,email:target.email,role:'sa_app'});}
   catch(e){user=await deps.auth.get(target.auth_user_id);if(!user)throw e;}
  }
  validateUser(user,target);
  // Marker and credential revision are verified again by the DB finish step.
  // A lost response cannot cause an existing/newer password to be reset again.
  if(user.app_metadata?.squad_account_flow!==target.flow_id){
   if(target.provider_committed)throw new AccountProviderError('ACCOUNT_UNAVAILABLE');
   user=await deps.auth.update(target.auth_user_id,body);validateUser(user,target);
  }
  if(!user.email_confirmed_at||user.app_metadata?.squad_account_flow!==target.flow_id)throw new AccountProviderError('PROVIDER_UNAVAILABLE');
 }catch(e){error=e instanceof AccountProviderError?e.code:'PROVIDER_UNAVAILABLE';}
 return result(await deps.rpc('squad_account_flow_finish',{p_id:target.flow_id,p_lease_token:target.lease_token,p_error:error}));
}
