import {AccountError} from './errors.ts';
import {finalizeRequest,type Upload,type UploadDependencies} from './uploads.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function checked(u:Upload){
 if(u.resource!=='document_attachments'||!uuid.test(u.upload_id)||u.bucket!=='squad-uploads'||u.path!=='pending/'+u.upload_id||typeof u.expected_version!=='string'||Number(u.bytes)>5242880||!['application/pdf','image/png','image/jpeg','text/plain'].includes(u.content_type))throw new AccountError('MEDIA_UNAVAILABLE',503);
}
export async function documentAttachmentRequest(deps:UploadDependencies,auth:string,route:string,input:Record<string,unknown>){
 if(route==='documents/attachments'){
  if(Object.keys(input).some(k=>!['file','idempotency_key'].includes(k))||!uuid.test(String(input.idempotency_key??'')))throw new AccountError('INVALID_REQUEST',400);
  const reserved:Upload=await deps.rpc(auth,'account_document_attachment_reserve',{p_file:input.file,p_idempotency_key:input.idempotency_key});checked(reserved);
  const current:Upload=await deps.rpc(auth,'account_upload_get',{p_id:reserved.upload_id});checked(current);
  const base={upload_id:current.upload_id,state:current.state,expected_version:current.expected_version,bytes:current.bytes,content_type:current.content_type};
  if(current.state!=='reserved')return base;
  const signed=await deps.signUpload(current.path);
  return {...base,upload_url:signed.url,expires_at:reserved.expires_at};
 }
 if(route!=='documents/attachments/finalize'||Object.keys(input).some(k=>!['upload_id','expected_version','idempotency_key'].includes(k))||!uuid.test(String(input.upload_id??''))||!uuid.test(String(input.idempotency_key??''))||typeof input.expected_version!=='string')throw new AccountError('INVALID_REQUEST',400);
 // Reuse byte verification, immutable canonical copy and service attestation.
 // Final attachment authority is rechecked inside the purpose-specific RPC.
 const current:Upload=await deps.rpc(auth,'account_upload_get',{p_id:input.upload_id});checked(current);
 await finalizeRequest(deps,auth,input,false);
 return deps.rpc(auth,'v1_document_attachment_attach',{p_upload_id:input.upload_id,p_idempotency_key:input.idempotency_key});
}
