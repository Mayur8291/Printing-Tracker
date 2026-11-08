import {AirtableError,attachmentUrl,contract,object,recordId,type AirtableBase,type Attachment} from './airtable-mapping.ts';
import {verifyMedia,InvalidMedia} from '../squad-account/media-verification.ts';
export const AIRTABLE_MEDIA_MAX_BYTES=25*1024*1024;
export interface AirtablePage {records:unknown[];offset:string|null;}
export interface MediaManifest {bucket:'canto-media';path:string;sha256:string;bytes:number;mime:string;}
export interface AirtableProvider {
 page(resource:string,offset:string|null,signal:AbortSignal):Promise<AirtablePage>;
 record(resource:string,id:string,signal:AbortSignal):Promise<unknown>;
 media(attachment:Attachment,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:string}>;
}
export interface AirtableStorage {put(bytes:Uint8Array,mime:string,signal:AbortSignal):Promise<MediaManifest>;}
export async function abortable<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();let stop=()=>{};
 const aborted=new Promise<never>((_,reject)=>{stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});});
 try{return await Promise.race([pending,aborted]);}finally{signal.removeEventListener('abort',stop);}
}
async function pause(ms:number,signal:AbortSignal){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await abortable(new Promise<void>(resolve=>{timer=setTimeout(resolve,ms);}),signal);}finally{clearTimeout(timer);}
}
export async function readBounded(response:Response,max:number,signal:AbortSignal):Promise<Uint8Array>{
 if(!response.body)throw new AirtableError('AIRTABLE_RESPONSE_INVALID');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await abortable(reader.read(),signal);if(done)break;size+=value.length;if(size>max)throw new AirtableError('AIRTABLE_RESPONSE_LIMIT');chunks.push(value);}}
 finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let start=0;for(const chunk of chunks){bytes.set(chunk,start);start+=chunk.length;}return bytes;
}
function responseError(status:number):AirtableError {
 return status===429?new AirtableError('AIRTABLE_RATE_LIMIT',30):status===401||status===403?new AirtableError('AIRTABLE_AUTH_UNAVAILABLE',300):status>=500||status===408?new AirtableError('AIRTABLE_UNAVAILABLE',60):new AirtableError('AIRTABLE_REJECTED');
}
export function airtableProvider(
 bases:Record<AirtableBase,{id:string;token:string}>,request:typeof fetch=fetch,spacingMs=250,
):AirtableProvider {
 for(const config of Object.values(bases))if(!/^app[A-Za-z0-9]{14}$/.test(config.id)||!config.token||config.token.length>4096||/[\r\n]/.test(config.token))throw new AirtableError('AIRTABLE_NOT_CONFIGURED');
 const next:Record<AirtableBase,number>={custom:0,ready_stock:0};
 const tails:Record<AirtableBase,Promise<unknown>>={custom:Promise.resolve(),ready_stock:Promise.resolve()};
 async function api(resource:string,id:string|null,offset:string|null,signal:AbortSignal){
  const spec=contract(resource),config=bases[spec.base],previous=tails[spec.base];let release=()=>{};
  const ownTurn=new Promise<void>(resolve=>{release=resolve;});
  // A cancelled waiter releases its own turn but must not release the request
  // ahead of it. Keep that dependency in the tail even after this call aborts.
  tails[spec.base]=previous.then(()=>ownTurn);
  try{
   await abortable(previous,signal);await pause(Math.max(0,next[spec.base]-Date.now()),signal);signal.throwIfAborted();next[spec.base]=Date.now()+Math.max(0,spacingMs);
   const url=new URL(`https://api.airtable.com/v0/${config.id}/${spec.table}${id?'/'+id:''}`);
   if(!id){url.searchParams.set('pageSize','100');if(offset!==null){if(typeof offset!=='string'||!offset||offset.length>2048||/[\u0000-\u001f]/.test(offset))throw new AirtableError('AIRTABLE_INVALID_OFFSET');url.searchParams.set('offset',offset);}}
   const bounded=AbortSignal.any([signal,AbortSignal.timeout(10000)]),response=await abortable(request(url,{headers:{Authorization:`Bearer ${config.token}`,Accept:'application/json'},redirect:'error',signal:bounded}),bounded);
   if(!response.ok){void response.body?.cancel().catch(()=>{});throw responseError(response.status);}
   const bytes=await readBounded(response,8*1024*1024,bounded);
   try{return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch(error){if(error instanceof AirtableError)throw error;throw new AirtableError('AIRTABLE_RESPONSE_INVALID');}
  }finally{release();}
 }
 return {
  async page(resource,offset,signal){
   const result=await api(resource,null,offset,signal);
   if(!Array.isArray(result.records)||result.records.length>100||result.offset!==undefined&&(typeof result.offset!=='string'||!result.offset||result.offset.length>2048)||result.offset===offset&&offset!==null)throw new AirtableError('AIRTABLE_RESPONSE_INVALID');
   return{records:result.records,offset:typeof result.offset==='string'?result.offset:null};
  },
  async record(resource,id,signal){if(!recordId(id))throw new AirtableError('AIRTABLE_INVALID_RECORD');return await api(resource,id,null,signal);},
  async media(source,signal){
   const bounded=AbortSignal.any([signal,AbortSignal.timeout(20000)]);
   // Attachment requests have no Airtable or Supabase authorization headers.
   const response=await abortable(request(attachmentUrl(source.url),{redirect:'error',signal:bounded}),bounded);
   if(!response.ok){void response.body?.cancel().catch(()=>{});throw responseError(response.status);}
   const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()??'';
   if(source.variant==='original'&&mime!==source.mime||source.variant==='large'&&!['image/png','image/jpeg','image/webp'].includes(mime)){
    void response.body?.cancel().catch(()=>{});throw new AirtableError('AIRTABLE_INVALID_MEDIA');
   }
   const bytes=await readBounded(response,AIRTABLE_MEDIA_MAX_BYTES,bounded);
   if(source.variant==='original'&&bytes.length!==source.bytes)throw new AirtableError('AIRTABLE_MEDIA_CHANGED');
   return{bytes,mime};
  },
 };
}
export function airtableFromEnvironment(get:(name:string)=>string|undefined,request:typeof fetch=fetch):AirtableProvider|undefined {
 const ref=get('SUPABASE_URL')?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)?.[1],environment=get('SQUAD_AIRTABLE_ENVIRONMENT');
 if(get('SQUAD_AIRTABLE_ENABLED')!=='true'||!ref||({scvojtvgnkmbupvyslmb:'staging',levwrmvqdntngeasrtnb:'production'} as Record<string,string>)[ref]!==environment||get('SQUAD_AIRTABLE_ISOLATED_ENVIRONMENT')!==environment)return undefined;
 const custom={id:get('SQUAD_AIRTABLE_CUSTOM_BASE')??'',token:get('SQUAD_AIRTABLE_CUSTOM_TOKEN')??''},ready_stock={id:get('SQUAD_AIRTABLE_READY_STOCK_BASE')??'',token:get('SQUAD_AIRTABLE_READY_STOCK_TOKEN')??''};
 try{return airtableProvider({custom,ready_stock},request);}catch{return undefined;}
}
export function airtableStorage(url:string,key:string,request:typeof fetch=fetch):AirtableStorage {
 if(!/^https:\/\/(scvojtvgnkmbupvyslmb|levwrmvqdntngeasrtnb)\.supabase\.co$/.test(url))throw new AirtableError('AIRTABLE_NOT_CONFIGURED');
 const headers={apikey:key,Authorization:`Bearer ${key}`};
 return{async put(bytes,mime,signal){
  if(bytes.length<1||bytes.length>AIRTABLE_MEDIA_MAX_BYTES)throw new AirtableError('AIRTABLE_MEDIA_LIMIT');
  let checked;try{checked=await verifyMedia(new Response(bytes as Uint8Array<ArrayBuffer>).body!,bytes.length,mime);}catch(error){if(error instanceof InvalidMedia)throw new AirtableError('AIRTABLE_INVALID_MEDIA');throw error;}
  const path=`sha256/${checked.sha256.slice(0,2)}/${checked.sha256}`,bounded=AbortSignal.any([signal,AbortSignal.timeout(20000)]);
  const response=await abortable(request(`${url}/storage/v1/object/canto-media/${path}`,{method:'POST',headers:{...headers,'Content-Type':mime,'x-upsert':'false'},body:bytes as Uint8Array<ArrayBuffer>,signal:bounded,redirect:'error'}),bounded);
  if(!response.ok){
   const raw=await readBounded(response,4096,bounded);let value:Record<string,unknown>={};try{value=object(JSON.parse(new TextDecoder().decode(raw)));}catch{/* no provider body is exposed */}
   if(!['409','Duplicate','ResourceAlreadyExists'].includes(String(value.statusCode??value.error??value.code)))throw new AirtableError('AIRTABLE_STORAGE_UNAVAILABLE',60);
   const existing=await abortable(request(`${url}/storage/v1/object/authenticated/canto-media/${path}`,{headers,signal:bounded,redirect:'error'}),bounded);
   if(!existing.ok||existing.headers.get('content-type')?.split(';')[0]!==mime){void existing.body?.cancel().catch(()=>{});throw new AirtableError('AIRTABLE_STORAGE_UNAVAILABLE',60);}
   const stored=await readBounded(existing,bytes.length,bounded),proof=await verifyMedia(new Response(stored as Uint8Array<ArrayBuffer>).body!,bytes.length,mime);
   if(proof.sha256!==checked.sha256)throw new AirtableError('AIRTABLE_STORAGE_UNAVAILABLE',60);
  }else void response.body?.cancel().catch(()=>{});
  return{bucket:'canto-media',path,sha256:checked.sha256,bytes:checked.bytes,mime};
 }};
}
