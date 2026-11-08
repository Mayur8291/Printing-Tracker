/** Service-only, bounded queue pump. Provider/document handlers are added here;
 * callers never supply actor IDs, URLs, SQL or arbitrary handler names. */
type ClaimedJob = { id: string; lease_token: string; handler: string };
type Result = { id: string; state: string; error_code?: string };
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
export function createHandler(secret: string | undefined, rpc: Rpc) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    if (!secret || secret.length < 32) return json({error:'WORKER_NOT_CONFIGURED'},503);
    const authorization = req.headers.get('authorization') ?? '';
    if (authorization.length > 1024 || !await sameSecret(authorization,`Bearer ${secret}`)) return json({error:'UNAUTHORIZED'},401);
    const path = new URL(req.url).pathname.replace(/\/+$/,'');
    if (!path.endsWith('/squad-jobs/run')) return json({error:'NOT_FOUND'},404);
    let limit: number;
    try {
      const input=await boundedBody(req);limit=Number(input.limit??3);
      if(Object.keys(input).some(k=>k!=='limit') || (input.limit!==undefined && typeof input.limit!=='number') || !Number.isInteger(limit) || limit<1 || limit>5)throw new Error('invalid_limit');
    } catch { return json({error:'INVALID_REQUEST'},400); }
    let claim: {jobs:ClaimedJob[];paused:boolean};
    try { claim=await rpc('squad_job_claim',{p_limit:limit}) as typeof claim; }
    catch { return json({error:'QUEUE_UNAVAILABLE'},503); }
    if(claim.paused)return json({paused:true,results:[]});
    const results: Result[]=[];const started=performance.now();
    for(const job of claim.jobs){
      if(performance.now()-started>45000)break; // Unstarted leases recover automatically.
      try {
        if(job.handler!=='local_amendment')throw new Error('uninstalled_handler');
        const result=await rpc('squad_job_execute',{p_id:job.id,p_lease_token:job.lease_token}) as Result;
        results.push({id:job.id,state:result.state,...(result.error_code?{error_code:result.error_code}:{})});
      } catch {
        // A network failure is not proof that the DB transaction failed. Never
        // mark completed work failed or call a provider again on this assumption.
        results.push({id:job.id,state:'unconfirmed'});
      }
    }
    return json({paused:false,results});
  };
}
export function serviceRpc(url: string, key: string): Rpc {
  return async (name,args) => {
    if(!['squad_job_claim','squad_job_execute'].includes(name))throw new Error('unknown_rpc');
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{
      method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Content-Profile':'canto_api','Accept-Profile':'canto_api'},
      body:JSON.stringify(args),signal:AbortSignal.timeout(12000),
    });
    if(!response.ok){await response.body?.cancel();throw new Error('rpc_failed');}
    return await response.json();
  };
}
