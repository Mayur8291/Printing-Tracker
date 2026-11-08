/** One durable import advances several bounded checkpoints per lease. Database
 * responses are never caught as provider failures: an uncertain commit recovers
 * through its persisted checkpoint rather than overwriting successful work. */
import type {Rpc} from './handler.ts';
import {AirtableError,freshAttachment,normalizeAirtable,contract,type Attachment} from './airtable-mapping.ts';
import type {AirtableProvider,AirtableStorage} from './airtable-provider.ts';
type Job={id:string;lease_token:string};
type Result={id:string;state:string;error_code?:string};
interface Asset {asset_id:string;resource:string;airtable_id:string;field:string;attachment:Attachment;}
interface Prepared extends Result {
 phase:'capture'|'media'|'validate'|'apply';resource:string;offset:string|null;
 bucket?:string;assets?:Asset[];transfer_id:string;generation:string;
}
const permanentMediaErrors=new Set(['AIRTABLE_INVALID_MEDIA','AIRTABLE_MEDIA_CHANGED','AIRTABLE_MEDIA_LIMIT','AIRTABLE_RESPONSE_LIMIT','AIRTABLE_REJECTED']);
export function airtableWorker(rpc:Rpc,provider:AirtableProvider|undefined,storage:AirtableStorage,workMs=35000,maxSteps=80){
 return async(job:Job):Promise<Result>=>{
  const args={p_id:job.id,p_lease_token:job.lease_token};
  const call=(action:string,input:Record<string,unknown>={})=>rpc('squad_airtable_work',{...args,p_action:action,p_input:input});
  const signal=AbortSignal.timeout(Math.min(35000,Math.max(1,workMs))),started=performance.now();
  // SQL checkpoints and provider requests share the wall-clock budget. The
  // provider enforces its own rate limit; small SQL batches need no extra delay.
  for(let step=0;step<Math.min(80,Math.max(1,maxSteps));step++){
   if(signal.aborted||performance.now()-started>workMs-1000)break;
   const prepared=await call('input') as Prepared;
   if(prepared.state!=='ready')return{id:job.id,state:prepared.state,...(prepared.error_code?{error_code:prepared.error_code}:{})};
   let action:string,input:Record<string,unknown>={};
   try{
    if(prepared.phase==='capture'){
     if(!provider)throw new AirtableError('AIRTABLE_NOT_CONFIGURED',300);
     contract(prepared.resource);
     const page=await provider.page(prepared.resource,prepared.offset,signal);
     if(page.records.length>100)throw new AirtableError('AIRTABLE_RESPONSE_LIMIT');
     const records=page.records.map(record=>normalizeAirtable(prepared.resource,record));
     if(new Set(records.map(r=>r.airtable_id)).size!==records.length)throw new AirtableError('AIRTABLE_INVALID_RECORD');
     action='capture';input={resource:prepared.resource,offset:prepared.offset,next_offset:page.offset,records,eof:page.offset===null};
    }else if(prepared.phase==='media'){
     if(!provider)throw new AirtableError('AIRTABLE_NOT_CONFIGURED',300);
     if(prepared.bucket!=='canto-media'||!Array.isArray(prepared.assets)||prepared.assets.length<1||prepared.assets.length>2)throw new AirtableError('AIRTABLE_INVALID_MEDIA');
     const assets=[];
     // Checkpoint one verified object before starting another network transfer.
     // Otherwise a slow/rate-limited second object could discard first-object
     // progress repeatedly and exhaust the transfer's retry budget.
     for(const asset of prepared.assets.slice(0,1)){
      if(!/^[a-f0-9-]{36}$/.test(asset.asset_id))throw new AirtableError('AIRTABLE_INVALID_MEDIA');
      try{
       // Refresh only the expiring URL, never the captured business attributes.
       const current=await provider.record(asset.resource,asset.airtable_id,signal);
       const fresh=freshAttachment(asset.resource,asset.airtable_id,asset.field,asset.attachment,current);
       const file=await provider.media(fresh,signal),manifest=await storage.put(file.bytes,file.mime,signal);
       assets.push({asset_id:asset.asset_id,attachment_id:asset.attachment.id,status:'ready',manifest});
      }catch(error){
       if(!(error instanceof AirtableError)||!permanentMediaErrors.has(error.code))throw error;
       assets.push({asset_id:asset.asset_id,attachment_id:asset.attachment.id,status:'failed',error_code:error.code});
      }
     }
     action='media';input={assets};
    }else if(prepared.phase==='validate'||prepared.phase==='apply'){action=prepared.phase;}
    else throw new AirtableError('AIRTABLE_INVALID_PHASE');
   }catch(error){
    const failure=error instanceof AirtableError?error:new AirtableError('AIRTABLE_UNAVAILABLE',60);
    action=failure.retryAfter?'retry':'fail';input={code:failure.code,...(failure.retryAfter?{retry_after_seconds:failure.retryAfter}:{})};
   }
   const result=await call(action,input) as Result;
   if(result.state!=='ready')return{id:job.id,state:result.state,...(result.error_code?{error_code:result.error_code}:{})};
  }
  return await call('yield') as Result;
 };
}
