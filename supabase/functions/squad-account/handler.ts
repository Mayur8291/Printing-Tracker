import {documentAttachmentRequest} from './document-attachments.ts';
import {AccountError} from './errors.ts';
import {accountFlow,type FlowDependencies} from './flows.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {authAdmin,authEmailAvailable} from '../_shared/squad-auth.ts';
export {AccountError} from './errors.ts';
import {uploadRequest,finalizeRequest,type UploadDependencies} from './uploads.ts';
import {verifyMedia} from './media-verification.ts';
import {transferRequest,type TransferDependencies} from './transfers.ts';
export interface MediaReference {resource:string;record_id:string;field:string;pointer?:string;}
interface ResolvedMedia extends MediaReference {status:string;version?:string;bucket?:string;object_path?:string;bytes?:string;content_type?:string;url?:string;}
export interface MediaResolution {references:ResolvedMedia[];expires_in:number;generation:string;as_of:string;}
export interface Dependencies {
 resolveMedia:(authorization:string,references:unknown[])=>Promise<MediaResolution>;
 signMedia:(paths:string[],expiresIn:number)=>Promise<Array<{path:string;signedURL?:string;error?:string|null}>>;
 storageUrl:string;
 uploads?:UploadDependencies;
 transfers?:TransferDependencies;
 flows?:FlowDependencies;
 accountStatus?:(authorization:string,input:Record<string,unknown>)=>Promise<unknown>;
 documentGrant?:(authorization:string,id:string)=>Promise<{id:string;bucket:string;path:string;expires_in:number;generation:string;bytes:string;sha256:string}>;
 signDocument?:(path:string,expiresIn:number)=>Promise<string>;
}
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function readBody(req:Request):Promise<Record<string,unknown>>{
 const reader=req.body?.getReader();if(!reader)throw new AccountError('INVALID_REQUEST',400);
 const parts:Uint8Array[]=[];let size=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw new AccountError('REQUEST_TOO_LARGE',413);parts.push(value);}}
 finally {await reader.cancel();reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AccountError('INVALID_REQUEST',400);}
 if(!input || Array.isArray(input) || typeof input!=='object')throw new AccountError('INVALID_REQUEST',400);
 return input;
}
export function createHandler(deps:Dependencies){
 return async(req:Request):Promise<Response>=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return response({error:'METHOD_NOT_ALLOWED'},405);
  const path=new URL(req.url).pathname.replace(/\/+$/,'');
  const route=path.slice(path.lastIndexOf('/squad-account/')+15);
  if(!['documents/attachments','documents/attachments/finalize','transfers/uploads','transfers/verify','transfers/download','documents/download','media/grants','media/uploads','media/finalize','media/verify','users/status','register','confirm','recovery','users/invite'].includes(route))return response({error:'NOT_FOUND'},404);
  const authorization=req.headers.get('authorization')??'';
  if(!/^Bearer [^\s]+$/.test(authorization)||authorization.length>16384)return response({error:'SESSION_REQUIRED'},401);
  try{
   const input=await readBody(req);
   if(route.startsWith('transfers/')){
    if(!deps.transfers)throw new AccountError('SERVICE_UNAVAILABLE',503);
    return response(await transferRequest(deps.transfers,authorization,route,input));
   }
   if(route==='documents/attachments'||route==='documents/attachments/finalize'){
    if(!deps.uploads)throw new AccountError('SERVICE_UNAVAILABLE',503);
    return response(await documentAttachmentRequest(deps.uploads,authorization,route,input));
   }
   if(route==='documents/download'){
    if(Object.keys(input).some(k=>k!=='id')||typeof input.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.id))throw new AccountError('INVALID_REQUEST',400);
    if(!deps.documentGrant||!deps.signDocument)throw new AccountError('SERVICE_UNAVAILABLE',503);
    const id=input.id.toLowerCase(),grant=await deps.documentGrant(authorization,id);
    if(grant.id!==id||grant.bucket!=='squad-documents'||!/^g[0-9]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/document\.pdf$/.test(grant.path)||!grant.path.includes('/'+id+'/'))throw new AccountError('MEDIA_UNAVAILABLE',503);
    const ttl=120,signed=await deps.signDocument(grant.path,ttl);
    if(!signed.startsWith('/object/sign/squad-documents/'+grant.path+'?')||signed.includes('\\'))throw new AccountError('MEDIA_UNAVAILABLE',503);
    const url=new URL(deps.storageUrl+signed);url.searchParams.set('download','squad-'+id+'.pdf');
    return response({id:grant.id,url:url.href,expires_in:ttl,generation:grant.generation,bytes:grant.bytes,sha256:grant.sha256});
   }
   if(['register','confirm','recovery','users/invite'].includes(route)){
    if(!deps.flows)throw new AccountError('SERVICE_UNAVAILABLE',503);
    return response(await accountFlow(deps.flows,authorization,route,input));
   }
   if(route==='users/status'){
    if(Object.keys(input).some(k=>!['user_id','action','reason','expected_version','idempotency_key'].includes(k))
     ||typeof input.user_id!=='string'||!/^[1-9][0-9]{0,18}$/.test(input.user_id)
     ||!['enable','disable','archive'].includes(String(input.action))||typeof input.reason!=='string'||typeof input.expected_version!=='string'
     ||typeof input.idempotency_key!=='string'||!/^[a-f0-9-]{36}$/i.test(input.idempotency_key))throw new AccountError('INVALID_REQUEST',400);
    if(!deps.accountStatus)throw new AccountError('SERVICE_UNAVAILABLE',503);
    return response(await deps.accountStatus(authorization,input));
   }
   if(route!=='media/grants'){
    if(!deps.uploads)throw new AccountError('SERVICE_UNAVAILABLE',503);
    return response(await(route==='media/uploads'?uploadRequest(deps.uploads,authorization,input):finalizeRequest(deps.uploads,authorization,input,route!=='media/verify')));
   }
   if(Object.keys(input).some(k=>!['references','download'].includes(k)) || !Array.isArray(input.references) || input.references.length<1 || input.references.length>25 || (input.download!==undefined && typeof input.download!=='boolean'))throw new AccountError('INVALID_REQUEST',400);
   // PostgREST verifies the caller JWT and the RPC checks the current Auth
   // session plus record scope. Signing uses only those database-resolved paths.
   const resolved=await deps.resolveMedia(authorization,input.references);
   const paths=[...new Set(resolved.references.filter(r=>r.status==='ready').map(r=>{
    if(r.bucket!=='canto-media'||!r.object_path||!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(r.object_path))throw new AccountError('MEDIA_UNAVAILABLE',503);
    return r.object_path;
   }))];
   const ttl=120;const signed=paths.length?await deps.signMedia(paths,ttl):[];
   const byPath=new Map(signed.map(r=>[r.path,r]));
   const references=resolved.references.map(r=>{
    const {object_path,bucket:_bucket,...publicFields}=r;
    if(r.status!=='ready')return publicFields;
    const signedFile=byPath.get(object_path!);
    if(!signedFile || signedFile.error || !signedFile.signedURL)return {...publicFields,status:'unavailable'};
    if(!signedFile.signedURL.startsWith('/object/sign/canto-media/')||signedFile.signedURL.includes('\\'))throw new AccountError('MEDIA_UNAVAILABLE',503);
    const fileUrl=new URL(deps.storageUrl+signedFile.signedURL);
    if(input.download||!['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','audio/mpeg','application/pdf'].includes(r.content_type??''))fileUrl.searchParams.set('download','');
    return {...publicFields,url:fileUrl.href,expires_in:ttl};
   });
   return response({references,generation:resolved.generation,as_of:resolved.as_of});
  }catch(error){return error instanceof AccountError?response({error:error.code},error.status):response({error:'SERVICE_UNAVAILABLE'},503);}
 };
}
export function dependencies(url:string,anon:string,service:string,flowSecret?:string):Dependencies{
 const serviceHeaders={apikey:service,Authorization:`Bearer ${service}`};
 const storage=url+'/storage/v1';
 async function rpc(authorization:string,name:string,args:Record<string,unknown>,privileged=false){
  const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:privileged?service:anon,Authorization:privileged?`Bearer ${service}`:authorization,'Content-Type':'application/json','Content-Profile':'canto_api','Accept-Profile':'canto_api'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
  const value=await r.json();if(!r.ok){const code=String(value?.code??'');
   if(code==='28000'||r.status===401)throw new AccountError('SESSION_REQUIRED',401);
   if(code==='42501')throw new AccountError('FORBIDDEN',403);
   if(code==='P0002')throw new AccountError('NOT_FOUND',404);
   if(code==='PT409'||code==='40001')throw new AccountError('VERSION_CONFLICT',409);
   if(code==='55000')throw new AccountError('WRITE_UNAVAILABLE',409);
   if(code==='54000')throw new AccountError('QUOTA_EXCEEDED',429);
   if(code.startsWith('22'))throw new AccountError('INVALID_REQUEST',400);
   throw new AccountError('SERVICE_UNAVAILABLE',503);
  }return value;
 }
 return {
  storageUrl:url+'/storage/v1',
  transfers:{rpc,storageUrl:storage,
   async signUpload(path){
    const r=await fetch(storage+'/object/upload/sign/squad-transfers/'+path,{method:'POST',headers:{...serviceHeaders,'Content-Type':'application/json','x-upsert':'false'},body:'{}',signal:AbortSignal.timeout(12000),redirect:'error'});
    const result=await r.json();if(!r.ok||typeof result.url!=='string')throw new AccountError('TRANSFER_UNAVAILABLE',503);return result.url;
   },
   download:(path)=>fetch(storage+'/object/authenticated/squad-transfers/'+path,{headers:serviceHeaders,signal:AbortSignal.timeout(20000),redirect:'error'}),
   async signDownload(path,expiresIn){
    const r=await fetch(storage+'/object/sign/squad-transfers/'+path,{method:'POST',headers:{...serviceHeaders,'Content-Type':'application/json'},body:JSON.stringify({expiresIn}),signal:AbortSignal.timeout(12000),redirect:'error'});
    const result=await r.json();if(!r.ok||typeof result.signedURL!=='string')throw new AccountError('TRANSFER_UNAVAILABLE',503);return result.signedURL;
   },
  },
  documentGrant:(authorization,id)=>rpc(authorization,'account_document_grant',{p_id:id}),
  async signDocument(path,expiresIn){
   const r=await fetch(storage+'/object/sign/squad-documents/'+path,{method:'POST',headers:{...serviceHeaders,'Content-Type':'application/json'},body:JSON.stringify({expiresIn}),signal:AbortSignal.timeout(12000)});
   if(!r.ok){await r.body?.cancel();throw new AccountError('MEDIA_UNAVAILABLE',503);}const value=await r.json();if(typeof value.signedURL!=='string')throw new AccountError('MEDIA_UNAVAILABLE',503);return value.signedURL;
  },
  ...(flowSecret?{flows:{crypto:accountCrypto(flowSecret),auth:authAdmin(url,service),emailAvailable:authEmailAvailable(url,service),rpc:(name:string,args:Record<string,unknown>)=>rpc('',name,args,true),authorizeInvite:(authorization:string,id:string)=>rpc(authorization,'account_invitation_authorize',{p_id:id})}}:{}),
  accountStatus:(authorization,input)=>rpc(authorization,'account_user_status',{p_id:input.user_id,p_action:input.action,p_reason:input.reason,p_expected_version:input.expected_version,p_idempotency_key:input.idempotency_key}),
  resolveMedia:(authorization,references)=>rpc(authorization,'account_media_resolve',{p_references:references}),
  uploads:{
   rpc,
   async signUpload(path){
    const r=await fetch(storage+'/object/upload/sign/squad-uploads/'+path,{method:'POST',headers:{...serviceHeaders,'Content-Type':'application/json','x-upsert':'false'},body:'{}',signal:AbortSignal.timeout(12000)});
    const value=await r.json();if(!r.ok||typeof value.url!=='string'||!value.url.startsWith('/object/upload/sign/squad-uploads/pending/'))throw new AccountError('MEDIA_UNAVAILABLE',503);
    return {url:storage+value.url};
   },
   download:(path)=>fetch(storage+'/object/authenticated/squad-uploads/'+path,{headers:serviceHeaders,signal:AbortSignal.timeout(90000)}),
   async copyVerified(path,hash,bytes,mime){
    const source=await fetch(storage+'/object/authenticated/squad-uploads/'+path,{headers:serviceHeaders,signal:AbortSignal.timeout(90000)});
    if(!source.ok||!source.body){await source.body?.cancel();throw new AccountError('MEDIA_UNAVAILABLE',503);}
    const canonical='sha256/'+hash.slice(0,2)+'/'+hash;
    const r=await fetch(storage+'/object/canto-media/'+canonical,{method:'POST',headers:{...serviceHeaders,'Content-Type':mime,'Content-Length':String(bytes),'x-upsert':'false'},body:source.body,signal:AbortSignal.timeout(90000)});
    if(!r.ok){const value=await r.json();if(!['409','Duplicate','ResourceAlreadyExists'].includes(String(value.statusCode??value.error??value.code)))throw new AccountError('MEDIA_UNAVAILABLE',503);
     const existing=await fetch(storage+'/object/authenticated/canto-media/'+canonical,{headers:serviceHeaders,signal:AbortSignal.timeout(90000)});
     if(!existing.ok||!existing.body||existing.headers.get('content-type')?.split(';')[0]!==mime){await existing.body?.cancel();throw new AccountError('MEDIA_UNAVAILABLE',503);}
     const checked=await verifyMedia(existing.body,bytes,mime);if(checked.sha256!==hash)throw new AccountError('MEDIA_UNAVAILABLE',503);
    }else await r.body?.cancel();
   },
  },
  async signMedia(paths,expiresIn){
   const r=await fetch(url+'/storage/v1/object/sign/canto-media',{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify({paths,expiresIn}),signal:AbortSignal.timeout(12000)});
   if(!r.ok){await r.body?.cancel();throw new AccountError('MEDIA_UNAVAILABLE',503);}return await r.json();
  },
 };
}
