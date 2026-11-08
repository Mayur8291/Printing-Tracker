/** Reconcile an already-authorized person state through GoTrue's Admin API.
 * This handler never accepts credentials or target identities from a client. */
import type {Rpc} from './handler.ts';
export interface AccountTarget {superseded?:boolean;managed_subject?:boolean;auth_user_id:string;legacy_user_id:string;email:string;legacy_role_id:number;allowed:boolean;source_confirmed:boolean;password_hash?:string|null;}
import {AccountProviderError,validateUser,type AuthAdmin} from '../_shared/squad-auth.ts';
export {authAdmin,AccountProviderError,type AuthAdmin,type AuthUser} from '../_shared/squad-auth.ts';
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
