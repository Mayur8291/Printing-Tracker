/** Reconcile an already-authorized person state through GoTrue's Admin API.
 * This handler never accepts credentials or target identities from a client. */
import type {Rpc} from './handler.ts';
export interface AccountTarget {superseded?:boolean;managed_subject?:boolean;auth_user_id:string;legacy_user_id:string;email:string;legacy_role_id:number;allowed:boolean;source_confirmed:boolean;password_hash?:string|null;}
export interface AuthUser {id:string;email?:string;role?:string;email_confirmed_at?:string|null;banned_until?:string|null;app_metadata?:Record<string,unknown>;}
export interface AuthAdmin {get:(id:string)=>Promise<AuthUser|null>;create:(body:Record<string,unknown>)=>Promise<AuthUser>;update:(id:string,body:Record<string,unknown>)=>Promise<AuthUser>;}
export class AccountProviderError extends Error {constructor(readonly code:'PROVIDER_UNAVAILABLE'|'IDENTITY_CONFLICT'|'ACCOUNT_UNAVAILABLE'){super(code);}}
function validateUser(user:AuthUser,target:AccountTarget){
 if(user.id!==target.auth_user_id||user.role!=='sa_app'||user.email?.trim().toLowerCase()!==target.email
 ||user.app_metadata?.application!=='canto'||String(user.app_metadata?.legacy_user_id)!==target.legacy_user_id)throw new AccountProviderError('IDENTITY_CONFLICT');
}
export function reconcileAccount(rpc:Rpc,auth:AuthAdmin){
 return async(job:{id:string;lease_token:string}):Promise<{id:string;state:string;error_code?:string}>=>{
  const args={p_id:job.id,p_lease_token:job.lease_token};
  let target:AccountTarget;
  try{target=await rpc('squad_account_prepare',args) as AccountTarget;}
  catch(e){if(e instanceof AccountProviderError)return await rpc('squad_account_finish',{...args,p_result:{},p_error:e.code}) as any;throw e;}
  if(target.superseded)return await rpc('squad_account_finish',{...args,p_result:{superseded:true},p_error:null}) as any;
  if(target.managed_subject)return await rpc('squad_account_finish',{...args,p_result:{auth_user_id:null,exists:false,confirmed:false},p_error:null}) as any;
  let result:Record<string,unknown>,error:string|null=null;
  try{
   if(!/^[0-9a-f-]{36}$/i.test(target.auth_user_id)||!/^[1-9][0-9]*$/.test(target.legacy_user_id)||!Number.isInteger(target.legacy_role_id)||typeof target.allowed!=='boolean')throw new AccountProviderError('ACCOUNT_UNAVAILABLE');
   let user=await auth.get(target.auth_user_id);
   const app_metadata={application:'canto',legacy_user_id:target.legacy_user_id,legacy_role_id:target.legacy_role_id};
   if(!user&&target.allowed){
    // Retry by reserved UUID; never reset an existing user's password because a
    // create response was lost. Legacy bcrypt is used only on first creation.
    const legacyHash=target.password_hash&&/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(target.password_hash)?target.password_hash:null;
    const body={id:target.auth_user_id,email:target.email,role:'sa_app',app_metadata,email_confirm:!!legacyHash||target.source_confirmed,
     ...(legacyHash?{password_hash:legacyHash}:{password:crypto.randomUUID()+crypto.randomUUID()})};
    try{user=await auth.create(body);}catch(e){user=await auth.get(target.auth_user_id);if(!user)throw e;}
   }
   if(user){
    validateUser(user,target);
    const banned=!!user.banned_until&&Date.parse(user.banned_until)>Date.now();
    const needsBan=target.allowed?banned:!banned||Date.parse(user.banned_until!)<Date.UTC(2100,0,1);
    const roleChanged=String(user.app_metadata?.legacy_role_id)!==String(target.legacy_role_id);
    if(needsBan||roleChanged)user=await auth.update(user.id,{...(needsBan?{ban_duration:target.allowed?'none':'876000h'}:{}),...(roleChanged?{app_metadata}:{})});
    validateUser(user,target);
    const reconciledBan=!!user.banned_until&&Date.parse(user.banned_until)>Date.now();
    if(reconciledBan===target.allowed||String(user.app_metadata?.legacy_role_id)!==String(target.legacy_role_id))throw new AccountProviderError('PROVIDER_UNAVAILABLE');
   }
   result={auth_user_id:target.auth_user_id,exists:!!user,confirmed:!!user?.email_confirmed_at};
  }catch(e){result={};error=e instanceof AccountProviderError?e.code:'PROVIDER_UNAVAILABLE';}
  return await rpc('squad_account_finish',{...args,p_result:result,p_error:error}) as any;
 };
}
export function authAdmin(url:string,key:string,transport:typeof fetch=fetch):AuthAdmin{
 async function request(path:string,method='GET',body?:Record<string,unknown>):Promise<AuthUser|null>{
  let r:Response;try{r=await transport(url+'/auth/v1/admin/users'+path,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});}catch{throw new AccountProviderError('PROVIDER_UNAVAILABLE');}
  if(r.status===404&&method==='GET'){await r.body?.cancel();return null;}
  if(!r.ok){await r.body?.cancel();throw new AccountProviderError([400,409,422].includes(r.status)?'IDENTITY_CONFLICT':'PROVIDER_UNAVAILABLE');}
  return await r.json() as AuthUser;
 }
 return{get:id=>request('/'+id),create:async body=>(await request('','POST',body))!,update:async(id,body)=>(await request('/'+id,'PUT',body))!};
}
