import type {Rpc} from './handler.ts';
type Job={id:string;lease_token:string};
type Device={id:string;revision:string;token:string;platform:'android'|'ios'|'web'};
export type PushCode='SENT'|'VALIDATED'|'UNREGISTERED'|'PROVIDER_UNAVAILABLE'|'PROVIDER_CONFIGURATION'|'RATE_LIMITED'|'STAGING_SUPPRESSED';
type Prepared={id:string;state:string;error_code?:string;notification_id:string;generation:string;devices:Device[]};
export type Push=(device:Device,message:{notificationId:string;generation:string})=>Promise<PushCode|{code:PushCode;retryAfterSeconds:number}>;

/** At-least-once delivery. Stable inbox identity lets clients deduplicate an
 * uncertain provider response. Provider acceptance is not proof a phone saw it. */
export function dispatchNotifications(rpc:Rpc,push:Push){
 return async(job:Job)=>{
  const args={p_id:job.id,p_lease_token:job.lease_token};
  const prepared=await rpc('squad_notification_prepare',args) as Prepared;
  if(prepared.state!=='prepared')return{id:job.id,state:prepared.state,...(prepared.error_code?{error_code:prepared.error_code}:{})};
  if(!/^[0-9]+$/.test(prepared.notification_id)||!/^[0-9]+$/.test(prepared.generation)||!Array.isArray(prepared.devices)||prepared.devices.length>10)throw new Error('invalid_delivery_contract');
  const results:Array<{id:string;revision:string;code:PushCode;retry_after?:number}>=[];
  // Three parallel calls, at most four waves. OAuth + each call have an 8-second
  // bound, so a full batch stays within the database's renewed 90-second lease.
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,prepared.devices.length)},async()=>{
   while(next<prepared.devices.length){
    const device=prepared.devices[next++];let outcome:Awaited<ReturnType<Push>>;
    try{outcome=await push(device,{notificationId:prepared.notification_id,generation:prepared.generation});}
    catch{outcome='PROVIDER_UNAVAILABLE';}
    results.push({id:device.id,revision:device.revision,code:typeof outcome==='string'?outcome:outcome.code,
     ...(typeof outcome!=='string'?{retry_after:Math.min(86400,Math.max(60,Math.ceil(outcome.retryAfterSeconds)||60))}:{})});
   }
  }));
  return await rpc('squad_notification_finish',{...args,p_results:results}) as {id:string;state:string;error_code?:string};
 };
}

type ServiceAccount={project_id:string;client_email:string;private_key:string};
export function parseFcmAccount(raw:string|undefined):ServiceAccount|undefined{
 try{const value=JSON.parse(raw??'null');return value&&typeof value.project_id==='string'&&typeof value.client_email==='string'&&typeof value.private_key==='string'?value:undefined;}
 catch{return undefined;}
}
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const enc=(value:unknown)=>b64(new TextEncoder().encode(JSON.stringify(value)));
/** Fixed Google endpoints; no caller URL, registration list or provider options. */
export function fcmPush(account:ServiceAccount|undefined,mode:'validate_only'|'deliver'='validate_only',request:typeof fetch=fetch,projectRef='scvojtvgnkmbupvyslmb'):Push{
 const environment=projectRef==='scvojtvgnkmbupvyslmb'?'staging':projectRef==='levwrmvqdntngeasrtnb'?'production':null;
 const deliveryMode=environment==='staging'?'validate_only':mode;
 let cached:{value:string;until:number}|undefined,flight:Promise<string>|undefined,key:Promise<CryptoKey>|undefined;
 async function accessToken():Promise<string>{
  if(cached&&cached.until>Date.now()+60000)return cached.value;
  if(flight)return await flight;
  flight=(async()=>{
   if(!account||!/^[a-z][a-z0-9-]{4,60}$/.test(account.project_id)||!account.client_email.endsWith('.iam.gserviceaccount.com'))throw new Error('provider_configuration');
   const pem=account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
   key??=crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
   const now=Math.floor(Date.now()/1000),unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
   const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',await key,new TextEncoder().encode(unsigned));
   const response=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64(new Uint8Array(signature))}),signal:AbortSignal.timeout(8000)});
   const value=await response.json().catch(()=>({}));
   if(!response.ok||typeof value.access_token!=='string'||value.access_token.length<20)throw new Error(response.status===400||response.status===401?'provider_configuration':'provider_unavailable');
   cached={value:value.access_token,until:Date.now()+Math.min(3600,Math.max(60,Number(value.expires_in)||3600))*1000};return cached.value;
  })();
  try{return await flight;}finally{flight=undefined;}
 }
 return async(device,message)=>{
  if(!account||!environment)return 'PROVIDER_CONFIGURATION';
  let access:string;
  try{access=await accessToken();}catch(error){return error instanceof Error&&error.message==='provider_configuration'?'PROVIDER_CONFIGURATION':'PROVIDER_UNAVAILABLE';}
  const tag='squad-'+message.generation+'-'+message.notificationId;
  try{
   const response=await request(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),body:JSON.stringify({validate_only:deliveryMode==='validate_only',message:{token:device.token,
    notification:{title:'Squad One',body:'New activity is available in your account.'},
    data:{notification_id:message.notificationId,generation:message.generation,project_ref:projectRef,environment},
    android:{ttl:'300s',notification:{tag}},apns:{headers:{'apns-collapse-id':tag,'apns-expiration':String(Math.floor(Date.now()/1000)+300)}},webpush:{notification:{tag}}}})});
   const body=await response.json().catch(()=>({}));
   if(response.ok)return deliveryMode==='validate_only'?'VALIDATED':'SENT';
   const codes=Array.isArray(body.error?.details)?body.error.details.filter((x:{'@type'?:string})=>x['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError').map((x:{errorCode?:string})=>x.errorCode):[];
   if(codes.includes('UNREGISTERED'))return 'UNREGISTERED';
   if(response.status===429||response.status===503){
    const header=response.headers.get('Retry-After');
    if(header){const seconds=/^[0-9]+$/.test(header)?Number(header):(Date.parse(header)-Date.now())/1000;
     if(Number.isFinite(seconds))return{code:response.status===429?'RATE_LIMITED':'PROVIDER_UNAVAILABLE',retryAfterSeconds:Math.max(60,Math.min(86400,Math.ceil(seconds)))};
    }
    if(response.status===429)return 'RATE_LIMITED';
   }
   if(response.status===401){cached=undefined;return 'PROVIDER_CONFIGURATION';}
   if(response.status===400||response.status===403||response.status===404)return 'PROVIDER_CONFIGURATION';
   return 'PROVIDER_UNAVAILABLE';
  }catch{return 'PROVIDER_UNAVAILABLE';}
 };
}
