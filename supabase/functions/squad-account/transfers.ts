import {AccountError} from './errors.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const TRANSFER_MAX_BYTES=10*1024*1024;
interface Upload {id:string;bucket:string;path:string;bytes:string;state:string;expires_at:string;sha256?:string;}
interface Grant {id:string;bucket:string;path:string;bytes:string;sha256:string;generation:string;}
export interface TransferDependencies {
 rpc:(auth:string,name:string,args:Record<string,unknown>,service?:boolean)=>Promise<any>;
 signUpload:(path:string)=>Promise<string>;
 download:(path:string)=>Promise<Response>;
 signDownload:(path:string,ttl:number)=>Promise<string>;
 storageUrl:string;
}
function assertUpload(u:Upload,id?:string){if(!uuid.test(u.id)||id&&u.id!==id||u.bucket!=='squad-transfers'||u.path!=='inputs/'+u.id+'/file.csv'||!Number.isSafeInteger(Number(u.bytes))||Number(u.bytes)<1||Number(u.bytes)>TRANSFER_MAX_BYTES)throw new AccountError('TRANSFER_UNAVAILABLE',503);}
/** The complete <=10 MiB immutable upload is hashed before DB validation starts. */
export async function verifyTransfer(body:ReadableStream<Uint8Array>,expected:number){
 const reader=body.getReader(),parts:Uint8Array[]=[];let length=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 const decode=(value?:Uint8Array,stream=false)=>{try{const text=decoder.decode(value,{stream});if(text.includes('\0'))throw new Error();}catch{throw new AccountError('INVALID_CSV',400);}};
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>expected||length>TRANSFER_MAX_BYTES)throw new AccountError('INVALID_CSV',400);decode(value,true);parts.push(value);}decode();}
 finally{await reader.cancel();reader.releaseLock();}
 if(length!==expected||length===0)throw new AccountError('INVALID_CSV',400);
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return {bytes:length,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')};
}
export async function transferRequest(deps:TransferDependencies,auth:string,route:string,input:Record<string,unknown>){
 if(route==='transfers/uploads'){
  if(Object.keys(input).some(k=>!['kind','resource','file','idempotency_key'].includes(k))||!['masters','prices','zones'].includes(String(input.kind))||!uuid.test(String(input.idempotency_key??'')))throw new AccountError('INVALID_REQUEST',400);
  const reserved:Upload=await deps.rpc(auth,'account_transfer_upload',{p_kind:input.kind,p_resource:input.resource??null,p_file:input.file,p_idempotency_key:input.idempotency_key});assertUpload(reserved);
  // A repeated reservation must re-check current ownership, role and generation.
  const current:Upload=await deps.rpc(auth,'account_transfer_input',{p_id:reserved.id});assertUpload(current,reserved.id);
  if(current.state!=='reserved')return{id:current.id,state:current.state};
  const signed=await deps.signUpload(current.path);if(!signed.startsWith('/object/upload/sign/squad-transfers/'+current.path+'?')||signed.includes('\\'))throw new AccountError('TRANSFER_UNAVAILABLE',503);
  return{id:current.id,state:current.state,upload_url:deps.storageUrl+signed,bytes:current.bytes,content_type:'text/csv',expires_at:current.expires_at};
 }
 if(Object.keys(input).some(k=>k!=='id')||!uuid.test(String(input.id??'')))throw new AccountError('INVALID_REQUEST',400);const id=String(input.id).toLowerCase();
 if(route==='transfers/verify'){
  const upload:Upload=await deps.rpc(auth,'account_transfer_input',{p_id:id});assertUpload(upload,id);
  if(upload.state!=='reserved')return{id:upload.id,state:upload.state};
  const response=await deps.download(upload.path);if(!response.ok||!response.body){await response.body?.cancel();throw new AccountError('UPLOAD_NOT_FOUND',409);}
  const checked=await verifyTransfer(response.body,Number(upload.bytes));
  return await deps.rpc(auth,'account_transfer_verified',{p_id:id,p_bytes:checked.bytes,p_sha256:checked.sha256},true);
 }
 if(route==='transfers/download'){
  const grant:Grant=await deps.rpc(auth,'account_transfer_grant',{p_id:id});
  if(grant.id!==id||grant.bucket!=='squad-transfers'||!/^\d+$/.test(grant.generation)||grant.path!==`g${grant.generation}/${id}/export.csv`||!Number.isSafeInteger(Number(grant.bytes))||Number(grant.bytes)<1||Number(grant.bytes)>TRANSFER_MAX_BYTES||!/^([a-f0-9]{64})$/.test(grant.sha256))throw new AccountError('TRANSFER_UNAVAILABLE',503);
  const ttl=120,signed=await deps.signDownload(grant.path,ttl);if(!signed.startsWith('/object/sign/squad-transfers/'+grant.path+'?')||signed.includes('\\'))throw new AccountError('TRANSFER_UNAVAILABLE',503);
  const url=new URL(deps.storageUrl+signed);url.searchParams.set('download','squad-'+id+'.csv');return{id,url:url.href,expires_in:ttl,bytes:grant.bytes,sha256:grant.sha256,generation:grant.generation};
 }
 throw new AccountError('NOT_FOUND',404);
}
