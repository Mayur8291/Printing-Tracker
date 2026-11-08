import {AccountError} from './errors.ts';
import {InvalidMedia,verifyMedia} from './media-verification.ts';
export interface Upload {upload_id:string;path:string;bucket:string;bytes:string;content_type:string;filename:string;state:string;expected_version?:string;current_version?:string;result?:unknown;sha256?:string;expires_at?:string;}
export interface UploadDependencies {
 rpc:(auth:string,name:string,args:Record<string,unknown>,service?:boolean)=>Promise<any>;
 signUpload:(path:string)=>Promise<{url:string}>;
 download:(path:string)=>Promise<Response>;
 copyVerified:(path:string,hash:string,bytes:number,mime:string)=>Promise<void>;
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function assertUpload(u:Upload){if(!uuid.test(u.upload_id)||u.bucket!=='squad-uploads'||u.path!=='pending/'+u.upload_id)throw new AccountError('MEDIA_UNAVAILABLE',503);}
export async function uploadRequest(deps:UploadDependencies,auth:string,input:Record<string,unknown>){
 if(Object.keys(input).some(k=>!['target','file','expected_version','idempotency_key'].includes(k))||!uuid.test(String(input.idempotency_key??''))||typeof input.expected_version!=='string')throw new AccountError('INVALID_REQUEST',400);
 const u:Upload=await deps.rpc(auth,'account_upload_reserve',{p_target:input.target,p_file:input.file,p_expected_version:input.expected_version,p_idempotency_key:input.idempotency_key});assertUpload(u);
 const current:Upload=await deps.rpc(auth,'account_upload_get',{p_id:u.upload_id});assertUpload(current);
 if(current.state!=='reserved')return {upload_id:u.upload_id,state:current.state};
 const {url}=await deps.signUpload(u.path);return {upload_id:u.upload_id,state:'reserved',upload_url:url,expires_at:u.expires_at,bytes:u.bytes,content_type:u.content_type};
}
export async function finalizeRequest(deps:UploadDependencies,auth:string,input:Record<string,unknown>,attach=true){
 if(Object.keys(input).some(k=>!['upload_id','expected_version','idempotency_key'].includes(k))||!uuid.test(String(input.upload_id??''))||!uuid.test(String(input.idempotency_key??''))||typeof input.expected_version!=='string')throw new AccountError('INVALID_REQUEST',400);
 const u:Upload=await deps.rpc(auth,'account_upload_get',{p_id:input.upload_id});assertUpload(u);
 if(input.expected_version!==u.expected_version)throw new AccountError('VERSION_CONFLICT',409);
 if(u.state!=='attached'&&u.current_version!==u.expected_version)throw new AccountError('VERSION_CONFLICT',409);
 if(u.state==='reserved'){
  const response=await deps.download(u.path);
  if(!response.ok||!response.body){await response.body?.cancel();throw new AccountError('UPLOAD_NOT_FOUND',409);}
  let verified;
  try{verified=await verifyMedia(response.body,Number(u.bytes),u.content_type);}catch(e){if(e instanceof InvalidMedia)throw new AccountError('INVALID_MEDIA',400);throw e;}
  // Signed upload paths are write-once. Copy only verified bytes; never upsert
  // a canonical hash object or trust a caller-supplied destination.
  await deps.copyVerified(u.path,verified.sha256,verified.bytes,verified.content_type);
  await deps.rpc(auth,'account_upload_verified',{p_id:u.upload_id,p_sha256:verified.sha256,p_bytes:verified.bytes,p_content_type:verified.content_type},true);
 }
 if(!attach)return {upload_id:u.upload_id,state:u.state==='attached'?'attached':'verified'};
 return await deps.rpc(auth,'v1_media_attach',{p_upload_id:u.upload_id,p_expected_version:input.expected_version,p_idempotency_key:input.idempotency_key});
}
