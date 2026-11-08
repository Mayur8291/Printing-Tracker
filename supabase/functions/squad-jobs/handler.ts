/** Service-only, bounded queue pump. Provider/document handlers are added here;
 * callers never supply actor IDs, URLs, SQL or arbitrary handler names. */
import {AccountProviderError} from './accounts.ts';
type ClaimedJob = { id: string; lease_token: string; handler: string };
type Result = { id: string; state: string; error_code?: string };
type DomainWorkers = {documentRehearsalProjectRef?:string;warehouseCheck?:(skus:string[],orderCode?:string)=>Promise<unknown>;heartbeat?:()=>Promise<unknown>;airtableReport?:(job:ClaimedJob)=>Promise<Result>;warehouse?:(job:ClaimedJob)=>Promise<Result>;businessMail?:(job:ClaimedJob)=>Promise<Result>;airtable?:(job:ClaimedJob)=>Promise<Result>};
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
async function sameSecret(input: string, expected: string): Promise<boolean> {
  const bytes = new TextEncoder();
  const [a, b] = await Promise.all([input, expected].map(x => crypto.subtle.digest('SHA-256', bytes.encode(x))));
  let difference = 0;const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
async function boundedBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();if (!reader) return {};
  const chunks: Uint8Array[] = [];let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();if(done)break;
      size += value.byteLength;if(size > 4096)throw new Error('body_limit');chunks.push(value);
    }
  } finally { await reader.cancel();reader.releaseLock(); }
  const combined = new Uint8Array(size);let offset=0;
  for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
  const value = size ? JSON.parse(new TextDecoder().decode(combined)) : {};
  if(!value || Array.isArray(value) || typeof value !== 'object')throw new Error('invalid_body');
  return value;
}
export function createHandler(secret: string | undefined, rpc: Rpc, removeUploads?: (paths:string[])=>Promise<void>, runAccount?: (job:ClaimedJob)=>Promise<Result>, runMail?: (job:ClaimedJob)=>Promise<Result>, runPush?: (job:ClaimedJob)=>Promise<Result>, documents?: {run:(job:ClaimedJob)=>Promise<Result>;mail:(job:ClaimedJob)=>Promise<Result>;remove:(paths:string[])=>Promise<void>}, transfers?: {run:(job:ClaimedJob)=>Promise<Result>;remove:(paths:string[])=>Promise<void>}, domain:DomainWorkers={}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    if (!secret || secret.length < 32) return json({error:'WORKER_NOT_CONFIGURED'},503);
    const authorization = req.headers.get('authorization') ?? '';
    if (authorization.length > 1024 || !await sameSecret(authorization,`Bearer ${secret}`)) return json({error:'UNAUTHORIZED'},401);
    const path = new URL(req.url).pathname.replace(/\/+$/,'');
    if(path.endsWith('/squad-jobs/document-rehearsal')){
      // The database grants only an exact, expiring, download-only document
      // lease. This route never invokes generic claims, maintenance or mail.
      if(domain.documentRehearsalProjectRef!=='scvojtvgnkmbupvyslmb'||!documents)return json({error:'WORKER_NOT_CONFIGURED'},503);
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      let id:string;
      try{
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')??''))return json({error:'INVALID_REQUEST'},400);
        const body=await boundedBody(req);
        if(Object.keys(body).length!==1||typeof body.job_id!=='string'||!uuid.test(body.job_id))return json({error:'INVALID_REQUEST'},400);
        id=body.job_id;
      }catch{return json({error:'INVALID_REQUEST'},400);}
      let claim:{jobs:ClaimedJob[];paused?:boolean};
      try{
        claim=await rpc('squad_document_rehearsal_claim',{p_id:id}) as typeof claim;
        if(!claim||!Array.isArray(claim.jobs)||claim.jobs.length>1||
          (claim.paused!==undefined&&typeof claim.paused!=='boolean')||
          (claim.paused&&claim.jobs.length)||claim.jobs.some(job=>!job||job.id!==id||job.handler!=='document_render'||typeof job.lease_token!=='string'||!uuid.test(job.lease_token)))throw new Error('invalid_rehearsal_claim');
      }catch{return json({error:'DOCUMENT_REHEARSAL_UNAVAILABLE'},503);}
      if(!claim.jobs.length)return json({paused:claim.paused??false,results:[]});
      try{
        const result=await documents.run(claim.jobs[0]);
        return json({paused:false,results:[{id,state:result.state,...(result.error_code?{error_code:result.error_code}:{})}]});
      }catch{return json({paused:false,results:[{id,state:'unconfirmed'}]});}
    }
    if(path.endsWith('/squad-jobs/warehouse-check')){
      let skus:string[];let orderCode:string|undefined;
      try{
        const body=await boundedBody(req);skus=body.skus as string[];
        if(Object.keys(body).some(k=>k!=='skus'&&k!=='order_code') || !Array.isArray(skus) || !skus.length || skus.length>5 || new Set(skus).size!==skus.length || skus.some(x=>typeof x!=='string'||!x.trim()||x.length>200||/[,\u0000-\u001f\u007f]/u.test(x)))return json({error:'INVALID_REQUEST'},400);
        if(body.order_code!==undefined&&(typeof body.order_code!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(body.order_code)))return json({error:'INVALID_REQUEST'},400);
        orderCode=body.order_code as string|undefined;
      }catch{return json({error:'INVALID_REQUEST'},400);}
      if(!domain.warehouseCheck)return json({error:'WORKER_NOT_CONFIGURED'},503);
      try{return json(await domain.warehouseCheck(skus,orderCode));}catch{return json({error:'WAREHOUSE_CHECK_UNAVAILABLE'},503);}
    }
    const cleanup=path.endsWith('/squad-jobs/media-cleanup');
    if (!cleanup && !path.endsWith('/squad-jobs/run')) return json({error:'NOT_FOUND'},404);
    if(cleanup){
      try{
        if(Object.keys(await boundedBody(req)).length)return json({error:'INVALID_REQUEST'},400);
        if(!removeUploads)return json({error:'WORKER_NOT_CONFIGURED'},503);
        const batch=await rpc('account_upload_cleanup',{p_completed:[]}) as {uploads:Array<{id:string;path:string}>};
        if(batch.uploads.length>100||batch.uploads.some(u=>!/^pending\/[a-f0-9-]{36}$/.test(u.path)||u.path!=='pending/'+u.id))throw new Error('invalid_cleanup_paths');
        if(batch.uploads.length){await removeUploads(batch.uploads.map(u=>u.path));await rpc('account_upload_cleanup',{p_completed:batch.uploads.map(u=>u.id)});}
        let documentCount=0;
        if(documents){
          const files=await rpc('squad_document_cleanup',{p_completed:[]}) as {paths:string[]};
          if(files.paths.length>100||files.paths.some(path=>!/^g[0-9]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/(document|part-[0-9]{4})\.pdf$/.test(path)))throw new Error('invalid_document_cleanup_paths');
          if(files.paths.length){await documents.remove(files.paths);await rpc('squad_document_cleanup',{p_completed:files.paths});documentCount=files.paths.length;}
        }
        let transferCount=0;
        if(transfers){
          const files=await rpc('squad_transfer_cleanup',{p_ack:[],p_limit:25}) as {objects:Array<{id:string;paths:string[]}>};
          if(!Array.isArray(files.objects)||files.objects.length>25||files.objects.some(o=>!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(o.id)||!Array.isArray(o.paths)||o.paths.length!==1||!/^((inputs\/[a-f0-9-]{36}\/file)|(g[0-9]+\/[a-f0-9-]{36}\/(export|part-[0-9]{4})))\.csv$/.test(o.paths[0])))throw new Error('invalid_transfer_cleanup_paths');
          if(files.objects.length){await transfers.remove(files.objects.map(o=>o.paths[0]));await rpc('squad_transfer_cleanup',{p_ack:files.objects.map(o=>o.id),p_limit:25});transferCount=files.objects.length;}
        }
        const accounts=await rpc('squad_account_flow_cleanup',{});
        return json({cleaned:batch.uploads.length,accounts,...(documents?{documents:documentCount}:{}),...(transfers?{transfers:transferCount}:{})});
      }catch{return json({error:'CLEANUP_UNAVAILABLE'},503);}
    }
    let limit: number;
    try {
      const input=await boundedBody(req);limit=Number(input.limit??3);
      if(Object.keys(input).some(k=>k!=='limit') || (input.limit!==undefined && typeof input.limit!=='number') || !Number.isInteger(limit) || limit<1 || limit>5)throw new Error('invalid_limit');
    } catch { return json({error:'INVALID_REQUEST'},400); }
    const started=performance.now();let maintenanceFailed=false;
    if(domain.heartbeat){try{await domain.heartbeat();}catch{maintenanceFailed=true;}}
    let claim: {jobs:ClaimedJob[];paused:boolean};
    try { claim=await rpc('squad_job_claim',{p_limit:1}) as typeof claim; }
    catch { return json({error:'QUEUE_UNAVAILABLE'},503); }
    if(claim.paused)return json({paused:true,results:[]});
    const results: Result[]=[];
    // Lease immediately before execution. Slow HTTP must never spend retry
    // attempts on a later job this invocation has no time to start.
    while(claim.jobs.length && results.length<limit){
      if(claim.jobs.length!==1)return json({error:'QUEUE_UNAVAILABLE'},503);
      const job=claim.jobs[0];
      try {
        const result=job.handler==='warehouse'&&domain.warehouse?await domain.warehouse(job):job.handler==='warehouse_webhook'?await rpc('squad_warehouse_webhook',{p_id:job.id,p_lease_token:job.lease_token}) as Result:job.handler==='business_mail'&&domain.businessMail?await domain.businessMail(job):job.handler==='airtable'&&domain.airtable?await domain.airtable(job):job.handler==='airtable_report'&&domain.airtableReport?await domain.airtableReport(job):job.handler==='transfer'&&transfers?await transfers.run(job):job.handler==='document_render'&&documents?await documents.run(job):job.handler==='document_mail'&&documents?await documents.mail(job):job.handler==='notification_delivery'&&runPush?await runPush(job):job.handler==='notification_fanout'?await rpc('squad_notification_fanout',{p_id:job.id,p_lease_token:job.lease_token}) as Result:job.handler==='account_mail'&&runMail?await runMail(job):job.handler==='account_reconciliation'&&runAccount?await runAccount(job):job.handler==='local_amendment'
          ?await rpc('squad_job_execute',{p_id:job.id,p_lease_token:job.lease_token}) as Result
          :(()=>{throw new Error('uninstalled_handler');})();
        results.push({id:job.id,state:result.state,...(result.error_code?{error_code:result.error_code}:{})});
      } catch {
        // A network failure is not proof that the DB transaction failed. Never
        // mark completed work failed or call a provider again on this assumption.
        results.push({id:job.id,state:'unconfirmed'});break;
      }
      // Reserve at least 35 seconds for the next bounded external operation.
      if(results.length>=limit || performance.now()-started>=10000)break;
      try{claim=await rpc('squad_job_claim',{p_limit:1}) as typeof claim;}catch{break;}
      if(claim.paused)break;
    }
    return json({paused:false,results,...(maintenanceFailed?{maintenance:'unconfirmed'}:{})});
  };
}
export async function scheduledMaintenance(rpc:Rpc){
  const results=await Promise.allSettled([
    rpc('squad_weekly_tailor_heartbeat',{p_limit:25}),
    rpc('squad_warehouse_heartbeat',{}),
  ]);
  if(results.some(result=>result.status==='rejected'))throw new Error('maintenance_unconfirmed');
}
export function serviceRpc(url: string, key: string): Rpc {
  return async (name,args) => {
    if(!['squad_document_rehearsal_claim','squad_warehouse_heartbeat','squad_weekly_tailor_heartbeat','squad_airtable_report_prepare','squad_airtable_report_finish','squad_airtable_work','squad_warehouse_prepare','squad_warehouse_finish','squad_warehouse_webhook','squad_business_mail_prepare','squad_business_mail_finish','squad_transfer_cleanup','squad_transfer_work','squad_job_claim','squad_job_execute','account_upload_cleanup','squad_account_prepare','squad_account_finish','squad_account_mail_prepare','squad_account_mail_finish','squad_account_flow_cleanup','squad_notification_fanout','squad_notification_prepare','squad_notification_finish','squad_document_prepare','squad_document_finish','squad_document_mail_prepare','squad_document_mail_finish','squad_document_cleanup'].includes(name))throw new Error('unknown_rpc');
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{
      method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Content-Profile':'canto_api','Accept-Profile':'canto_api'},
      body:JSON.stringify(args),signal:AbortSignal.timeout(12000),
    });
    if(!response.ok){
      if(name==='squad_account_prepare'){
        const body=await response.json().catch(()=>({}));
        if(body.code==='23505')throw new AccountProviderError('IDENTITY_CONFLICT');
        if(body.code==='P0002')throw new AccountProviderError('ACCOUNT_UNAVAILABLE');
      } else await response.body?.cancel();
      throw new Error('rpc_failed');
    }
    return await response.json();
  };
}

export function storageCleanup(url:string,key:string){
 return async(paths:string[])=>{
  const response=await fetch(url+'/storage/v1/object/squad-uploads',{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths}),signal:AbortSignal.timeout(12000)});
  if(!response.ok){await response.body?.cancel();throw new Error('storage_cleanup_failed');}await response.body?.cancel();
 };
}
