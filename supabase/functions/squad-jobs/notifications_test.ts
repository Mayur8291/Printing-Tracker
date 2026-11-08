import {dispatchNotifications,fcmPush,parseFcmAccount} from './notifications.ts';
import type {Rpc} from './handler.ts';
function assert(value:unknown):asserts value{if(!value)throw new Error('assertion failed');}
const device={id:'device',revision:'1',token:'private-registration-token',platform:'android' as const},message={notificationId:'123',generation:'0'};
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem='-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey))))+'\n-----END PRIVATE KEY-----';
const account={project_id:'test-project',client_email:'test@test-project.iam.gserviceaccount.com',private_key:pem};
Deno.test('malformed Firebase settings do not prevent other queue handlers starting',()=>{
 for(const raw of [undefined,'{','null','[]','{"project_id":3}'])assert(parseFcmAccount(raw)===undefined);
 assert(parseFcmAccount(JSON.stringify(account))?.project_id==='test-project');
});
function fakeRequest(send:(body:Record<string,unknown>)=>Response,onToken?:()=>void):typeof fetch{
 return (async(url,init)=>{
  if(url==='https://oauth2.googleapis.com/token'){onToken?.();return Response.json({access_token:'private-access-token-only-test',expires_in:3600});}
  assert(url==='https://fcm.googleapis.com/v1/projects/test-project/messages:send');return send(JSON.parse(String(init?.body)));
 }) as typeof fetch;
}
Deno.test('FCM defaults to validation only and generic content',async()=>{
 const push=fcmPush(account,undefined,fakeRequest(body=>{assert(body.validate_only===true);const m=body.message as Record<string,unknown>;assert(m.token===device.token);assert(JSON.stringify(m.data)===JSON.stringify({notification_id:'123',generation:'0',project_ref:'scvojtvgnkmbupvyslmb',environment:'staging'}));assert(!JSON.stringify(body).includes('customer'));return Response.json({name:'validated'});}));
 assert(await push(device,message)==='VALIDATED');
});
Deno.test('FCM explicit delivery reports provider acceptance',async()=>{
 assert(await fcmPush(account,'deliver',fakeRequest(body=>{assert(body.validate_only===false);return Response.json({name:'accepted'});}), 'levwrmvqdntngeasrtnb')(device,message)==='SENT');
});
Deno.test('staging cannot send a physical push even with the wrong delivery setting',async()=>{
 assert(await fcmPush(account,'deliver',fakeRequest(body=>{assert(body.validate_only===true);return Response.json({name:'validated'});}))(device,message)==='VALIDATED');
});
Deno.test('concurrent FCM requests share one scoped OAuth token exchange',async()=>{
 let exchanges=0;const push=fcmPush(account,undefined,fakeRequest(()=>Response.json({name:'ok'}),()=>exchanges++));await Promise.all([push(device,message),push(device,message),push(device,message)]);assert(exchanges===1);
});
Deno.test('only typed UNREGISTERED invalidates a token',async()=>{
 for(const [body,code] of [[{error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}},'UNREGISTERED'],[{error:{message:'UNREGISTERED'}},'PROVIDER_CONFIGURATION'],[{error:{details:[{'@type':'another.type',errorCode:'UNREGISTERED'}]}},'PROVIDER_CONFIGURATION']] as const){
  assert(await fcmPush(account,undefined,fakeRequest(()=>Response.json(body,{status:404})))(device,message)===code);
 }
});
Deno.test('provider IAM configuration errors never remove device bindings',async()=>{
 for(const status of [400,401,403])assert(await fcmPush(account,undefined,fakeRequest(()=>Response.json({error:{message:'sensitive provider diagnostic'}},{status})))(device,message)==='PROVIDER_CONFIGURATION');
});
Deno.test('provider throttling and outage are classified for durable retry',async()=>{
 assert(await fcmPush(account,undefined,fakeRequest(()=>Response.json({}, {status:429})))(device,message)==='RATE_LIMITED');
 assert(await fcmPush(account,undefined,fakeRequest(()=>Response.json({}, {status:503})))(device,message)==='PROVIDER_UNAVAILABLE');
});
Deno.test('provider Retry-After is preserved without sleeping in the Edge worker',async()=>{
 const result=await fcmPush(account,undefined,fakeRequest(()=>Response.json({}, {status:429,headers:{'Retry-After':'7200'}})))(device,message);
 assert(typeof result!=='string'&&result.code==='RATE_LIMITED'&&result.retryAfterSeconds===7200);
});
Deno.test('missing provider configuration fails visibly without network',async()=>{
 assert(await fcmPush(undefined,undefined,(()=>{throw new Error('must not fetch');}) as typeof fetch)(device,message)==='PROVIDER_CONFIGURATION');
});
Deno.test('revoked recipient skips provider entirely',async()=>{
 const rpc:Rpc=async()=>({id:'job',state:'dead',error_code:'42501'});let called=false;
 const value=await dispatchNotifications(rpc,async()=>{called=true;return 'SENT';})({id:'job',lease_token:'lease'});assert(!called&&value.state==='dead');
});
Deno.test('bounded parallel devices return sanitized per-device results',async()=>{
 let active=0,maximum=0;
 const rpc:Rpc=async(name,args)=>{
  if(name==='squad_notification_prepare')return{id:'job',state:'prepared',notification_id:'123',generation:'0',devices:Array.from({length:10},(_,i)=>({...device,id:String(i)}))};
  const results=args.p_results as unknown[];assert(results.length===10);assert(!JSON.stringify(args).includes(device.token));return{id:'job',state:'done'};
 };
 const result=await dispatchNotifications(rpc,async()=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,1));active--;return 'VALIDATED';})({id:'job',lease_token:'lease'});
 assert(maximum===3&&result.state==='done');
});
Deno.test('uncertain send does not falsely acknowledge delivery',async()=>{
 const rpc:Rpc=async(name,args)=>{
  if(name==='squad_notification_prepare')return{id:'job',state:'prepared',notification_id:'123',generation:'0',devices:[device]};
  assert((args.p_results as Array<{code:string}>)[0].code==='PROVIDER_UNAVAILABLE');assert(!JSON.stringify(args).includes('private'));return{id:'job',state:'pending'};
 };
 assert((await dispatchNotifications(rpc,async()=>{throw new Error('private upstream body');})({id:'job',lease_token:'lease'})).state==='pending');
});
Deno.test('inbox-only event acknowledges without calling provider',async()=>{
 let sent=false;const rpc:Rpc=async n=>n==='squad_notification_prepare'?{id:'job',state:'prepared',notification_id:'123',generation:'0',devices:[]}:{id:'job',state:'done'};
 assert((await dispatchNotifications(rpc,async()=>{sent=true;return 'SENT';})({id:'job',lease_token:'lease'})).state==='done');assert(!sent);
});
