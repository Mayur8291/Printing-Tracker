import {dashboardEvent,WebhookError,type DashboardEvent,type DashboardEventType} from './payload.ts';
export {WebhookError} from './payload.ts';
export const WEBHOOK_MAX_BYTES=262144;
export const PROJECTS={scvojtvgnkmbupvyslmb:'staging',levwrmvqdntngeasrtnb:'production'} as const;
export type ProjectRef=keyof typeof PROJECTS;
export interface Receipt {receipt_id:string;state:'accepted'|'duplicate'|'ignored'|'quarantined';}
export interface WebhookDependencies {projectRef:ProjectRef;enabled:boolean;secrets:string[];accept:(event:DashboardEvent,bodySha256:string,projectRef:ProjectRef)=>Promise<Receipt>;now?:()=>number;bodyTimeoutMs?:number;}
const response=(value:unknown,status:number)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const aliases:Record<string,DashboardEventType|undefined>={'/warehouse/dashboard':undefined,'/warehouse/dashboard/webhooks/orders/status_changed':'order.status_changed','/warehouse/dashboard/webhooks/stock/level_changed':'stock.level_changed','/warehouse/dashboard/webhooks/stock/low_threshold':'stock.low_threshold'};
function route(request:Request){const url=new URL(request.url);if(url.search)throw new WebhookError('NOT_FOUND',404);const match=url.pathname.match(/(?:^|\/)squad-webhooks(\/.*)$/);if(!match||!(match[1] in aliases))throw new WebhookError('NOT_FOUND',404);return aliases[match[1]];}
export async function readWebhookBody(request:Request,timeoutMs=5000){
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>WEBHOOK_MAX_BYTES))throw new WebhookError('REQUEST_TOO_LARGE',413);
 const reader=request.body?.getReader();if(!reader)throw new WebhookError('INVALID_EVENT',400);let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new WebhookError('REQUEST_TIMEOUT',408));},timeoutMs);});
 const read=async()=>{const chunks:Uint8Array[]=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>WEBHOOK_MAX_BYTES)throw new WebhookError('REQUEST_TOO_LARGE',413);chunks.push(value);}if(!size)throw new WebhookError('INVALID_EVENT',400);const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;};
 try{return await Promise.race([read(),timeout]);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function authenticate(bytes:Uint8Array,signature:string,secrets:string[]){
 const sig=new Uint8Array(signature.slice(7).match(/../g)!.map(x=>parseInt(x,16)));
 // WebCrypto verification avoids comparing HMAC strings with early exits.
 const checks=await Promise.all(secrets.map(async(secret)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('HMAC',key,sig,bytes as Uint8Array<ArrayBuffer>);}));return checks.some(Boolean);
}
export function createHandler(deps:WebhookDependencies){return async(request:Request):Promise<Response>=>{
 if(request.method!=='POST')return response({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const expected=route(request);
  if(!deps.enabled||!Object.hasOwn(PROJECTS,deps.projectRef)||deps.secrets.length<1||deps.secrets.length>2||deps.secrets.some(s=>typeof s!=='string'||s.length<32||s.length>512))throw new WebhookError('WEBHOOK_NOT_CONFIGURED',503);
  const signature=request.headers.get('x-dashboard-signature')??'';if(!/^sha256=[a-f0-9]{64}$/i.test(signature))throw new WebhookError('UNAUTHORIZED',401);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new WebhookError('UNSUPPORTED_MEDIA_TYPE',415);
  const bytes=await readWebhookBody(request,deps.bodyTimeoutMs);
  if(!await authenticate(bytes,signature,deps.secrets))throw new WebhookError('UNAUTHORIZED',401);
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WebhookError('INVALID_EVENT',400);}
  const event=dashboardEvent(value,deps.now?.()??Date.now(),expected);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  // Only this fixed RPC can acknowledge a provider request. It must durably
  // dedupe across refresh generations and queue or quarantine before returning.
  const receipt=await deps.accept(event,digest,deps.projectRef);
  if(!receipt||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(receipt.receipt_id)||!['accepted','duplicate','ignored','quarantined'].includes(receipt.state))throw new Error('invalid_receipt');
  return response({received:true,receipt_id:receipt.receipt_id,state:receipt.state},receipt.state==='accepted'?202:200);
 }catch(error){return error instanceof WebhookError?response({error:error.code},error.status):response({error:'ACCEPTANCE_UNAVAILABLE'},503);}
};}
export function serviceAcceptance(url:string,key:string,request:typeof fetch=fetch){return async(event:DashboardEvent,sha256:string,projectRef:ProjectRef):Promise<Receipt>=>{
 if(url!==`https://${projectRef}.supabase.co`)throw new WebhookError('WEBHOOK_NOT_CONFIGURED',503);
 const r=await request(url+'/rest/v1/rpc/squad_webhook_accept',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Profile':'canto_api','Accept-Profile':'canto_api'},body:JSON.stringify({p_provider:'dashboard',p_event_id:event.event_id,p_event_type:event.event,p_occurred_at:event.occurred_at,p_payload:event,p_body_sha256:sha256,p_project_ref:projectRef}),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok){const error=await r.json().catch(()=>({}));if(error.code==='23505')throw new WebhookError('EVENT_ID_CONFLICT',409);if(error.code==='42501')throw new WebhookError('PROVIDER_DISABLED',403);if(error.code==='55000')throw new WebhookError('ACCEPTANCE_PAUSED',503);if(String(error.code??'').startsWith('22'))throw new WebhookError('INVALID_EVENT',400);throw new WebhookError('ACCEPTANCE_UNAVAILABLE',503);}
 return await r.json();
};}
