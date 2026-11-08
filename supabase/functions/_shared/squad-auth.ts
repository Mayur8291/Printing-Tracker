export interface AuthUser {id:string;email?:string;role?:string;email_confirmed_at?:string|null;banned_until?:string|null;app_metadata?:Record<string,unknown>;}
export interface AuthAdmin {get:(id:string)=>Promise<AuthUser|null>;create:(body:Record<string,unknown>)=>Promise<AuthUser>;update:(id:string,body:Record<string,unknown>)=>Promise<AuthUser>;}
export class AccountProviderError extends Error {constructor(readonly code:'PROVIDER_UNAVAILABLE'|'IDENTITY_CONFLICT'|'ACCOUNT_UNAVAILABLE'){super(code);}}
export function validateUser(user:AuthUser,target:{auth_user_id:string;email:string;legacy_user_id:string}){
 if(user.id!==target.auth_user_id||user.role!=='sa_app'||user.email?.trim().toLowerCase()!==target.email
 ||user.app_metadata?.application!=='canto'||String(user.app_metadata?.legacy_user_id)!==target.legacy_user_id)throw new AccountProviderError('IDENTITY_CONFLICT');
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
/** Bounded collision preflight; GoTrue's unique identity constraint is final. */
export function authEmailAvailable(url:string,key:string,transport:typeof fetch=fetch){
 return async(email:string)=>{
  const response=await transport(url+'/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&page=1&per_page=100',{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
  if(!response.ok){await response.body?.cancel();throw new AccountProviderError('PROVIDER_UNAVAILABLE');}
  const body=await response.json();if(!Array.isArray(body.users)||body.users.length>=100)return false;
  return !body.users.some((u:AuthUser)=>u.email?.trim().toLowerCase()===email);
 };
}
