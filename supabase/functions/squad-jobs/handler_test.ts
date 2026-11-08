import {scheduledMaintenance,createHandler,type Rpc} from './handler.ts';
const secret='test-only-not-a-real-secret-1234567890';
function assert(value:unknown,message='assertion failed'):asserts value {if(!value)throw new Error(message);}
function request(body:unknown={},token=secret,path='/functions/v1/squad-jobs/run'){
 return new Request(`https://example.invalid${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
}
Deno.test('unauthorized request never contacts database',async()=>{
 let calls=0;const h=createHandler(secret,()=>{calls++;throw new Error();});assert((await h(request({},'wrong'))).status===401);assert(calls===0);
});
Deno.test('missing configuration fails closed',async()=>{
 const h=createHandler(undefined,()=>{throw new Error();});assert((await h(request())).status===503);
});
Deno.test('only bounded fixed route and parameters accepted',async()=>{
 const h=createHandler(secret,()=>{throw new Error();});
 for(const body of [{limit:6},{limit:0},{limit:1.5},{limit:'2'},{actor_id:'arbitrary'},[],{limit:2,url:'https://evil.invalid'}])assert((await h(request(body))).status===400);
 assert((await h(request({},secret,'/other'))).status===404);
 assert((await h(request({x:'x'.repeat(5000)}))).status===400);
 assert((await h(new Request('https://example.invalid'))).status===405);
});
Deno.test('mirror skips all execution',async()=>{
 const calls:string[]=[];const h=createHandler(secret,async(name)=>{calls.push(name);return {paused:true,jobs:[]};});
 const body=await(await h(request())).json();assert(body.paused);assert(calls.length===1);
});
Deno.test('claimed job passes exact lease without disclosing it',async()=>{
 const calls:Array<[string,Record<string,unknown>]>=[];const rpc:Rpc=async(name,args)=>{calls.push([name,args]);return name==='squad_job_claim'?{paused:false,jobs:[{id:'job',lease_token:'private',handler:'local_amendment'}]}:{id:'job',state:'done'};};
 const body=await(await createHandler(secret,rpc)(request({limit:1}))).text();assert(body.includes('done'));assert(!body.includes('private'));assert(calls[1][1].p_lease_token==='private');assert(calls[0][1].p_limit===1);
});
Deno.test('uncertain execution keeps lease for reconciliation',async()=>{
 const rpc:Rpc=async(name)=>{if(name==='squad_job_execute')throw new Error('database password must never surface');return {paused:false,jobs:[{id:'job',lease_token:'private',handler:'local_amendment'}]};};
 const body=await(await createHandler(secret,rpc)(request())).text();assert(body.includes('unconfirmed'));assert(!body.includes('password'));assert(!body.includes('private'));
});
Deno.test('failed claim produces safe retriable error',async()=>{
 const h=createHandler(secret,()=>{throw new Error('secret detail');});const response=await h(request());assert(response.status===503);assert(!JSON.stringify(await response.json()).includes('secret'));
});
Deno.test('expired media files removed before acknowledgement',async()=>{
 const calls:string[]=[];const id='11111111-1111-4111-8111-111111111111';
 const h=createHandler('x'.repeat(48),async(name,args)=>{if(name==='squad_account_flow_cleanup'){calls.push('accounts');return{expired_flows:0,expired_grants:0};}assert(name==='account_upload_cleanup');calls.push((args.p_completed as string[]).length?'ack':'list');return{uploads:[{id,path:'pending/'+id}]};},async(paths)=>{assert(paths[0]==='pending/'+id);calls.push('delete');});
 const r=await h(new Request('https://test.invalid/squad-jobs/media-cleanup',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(48)},body:'{}'}));assert(r.status===200);assert(calls.join(',')==='list,delete,ack,accounts');
});
Deno.test('failed storage cleanup remains unacknowledged',async()=>{
 let ack=false;const id='11111111-1111-4111-8111-111111111111';const h=createHandler('x'.repeat(48),async(_name,args)=>{if((args.p_completed as string[]).length)ack=true;return{uploads:[{id,path:'pending/'+id}]};},async()=>{throw new Error('failed');});
 const r=await h(new Request('https://test.invalid/squad-jobs/media-cleanup',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(48)},body:'{}'}));assert(r.status===503);assert(!ack);
});
Deno.test('cleanup refuses paths outside reserved upload bucket',async()=>{
 let removed=false;const h=createHandler('x'.repeat(48),async()=>({uploads:[{id:'x',path:'../canonical'}]}),async()=>{removed=true;});const r=await h(new Request('https://test.invalid/squad-jobs/media-cleanup',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(48)},body:'{}'}));assert(r.status===503);assert(!removed);
});
Deno.test('account reconciliation uses the installed handler and retains lease secrecy',async()=>{
 let seen=false;const rpc:Rpc=async()=>({paused:false,jobs:[{id:'account',lease_token:'private',handler:'account_reconciliation'}]});
 const h=createHandler(secret,rpc,undefined,async j=>{assert(j.id==='account'&&j.lease_token==='private');seen=true;return{id:j.id,state:'done'};});const body=await(await h(request())).text();assert(seen&&body.includes('done')&&!body.includes('private'));
});
Deno.test('domain worker routing uses only fixed installed handlers and exact leases',async()=>{
 const seen:string[]=[],pending=['warehouse','airtable','business_mail','airtable_report','warehouse_webhook'];const rpc:Rpc=async(name,args)=>{
  if(name==='squad_job_claim'){assert(args.p_limit===1);const handler=pending.shift();return{paused:false,jobs:handler?[{id:handler,lease_token:'private',handler}]:[]};}
  assert(name==='squad_warehouse_webhook'&&args.p_id==='warehouse_webhook'&&args.p_lease_token==='private');seen.push('warehouse_webhook');return{state:'done'};
 };
 const run=async(j:{id:string;lease_token:string})=>{assert(j.lease_token==='private');seen.push(j.id);return{id:j.id,state:'done'};};
 const h=createHandler(secret,rpc,undefined,undefined,undefined,undefined,undefined,undefined,{warehouse:run,airtable:run,businessMail:run,airtableReport:run});
 const body=await(await h(request({limit:5}))).text();assert(seen.join(',')==='warehouse,airtable,business_mail,airtable_report,warehouse_webhook');assert(!body.includes('private'));
});
Deno.test('uninstalled or unknown domain handler retains recoverable lease',async()=>{
 const rpc:Rpc=async(name)=>{assert(name==='squad_job_claim');return{paused:false,jobs:[{id:'x',lease_token:'private',handler:'arbitrary_name'}]};};
 const body=await(await createHandler(secret,rpc)(request())).json();assert(body.results[0].state==='unconfirmed');
});

Deno.test('queue drains fast jobs without leasing work ahead of execution',async()=>{
 const calls:string[]=[];let id=0;
 const rpc:Rpc=async(name,args)=>{if(name==='squad_job_claim'){assert(args.p_limit===1);calls.push('claim');return{paused:false,jobs:[{id:String(++id),lease_token:'private',handler:'local_amendment'}]};}calls.push('run:'+args.p_id);return{state:'done'};};
 const result=await(await createHandler(secret,rpc)(request({limit:3}))).json();
 assert(result.results.length===3&&calls.join(',')==='claim,run:1,claim,run:2,claim,run:3');
});
Deno.test('uncertain job never preclaims another work item',async()=>{
 let claims=0;const rpc:Rpc=async(name)=>{if(name==='squad_job_claim'){claims++;return{paused:false,jobs:[{id:'1',lease_token:'private',handler:'local_amendment'}]};}throw new Error('uncertain commit');};
 const result=await(await createHandler(secret,rpc)(request({limit:5}))).json();assert(claims===1&&result.results[0].state==='unconfirmed');
});
Deno.test('scheduled maintenance runs only after authorization and input validation',async()=>{
 let count=0;const h=createHandler(secret,async()=>({paused:true,jobs:[]}),undefined,undefined,undefined,undefined,undefined,undefined,{heartbeat:async()=>{count++;}});
 await h(request({},'wrong'));await h(request({arbitrary:'command'}));assert(count===0);
 const result=await(await h(request())).json();assert(Number(count)===1&&result.paused&&result.results.length===0);
});
Deno.test('scheduler failure is visible without blocking existing queued work',async()=>{
 const rpc:Rpc=async(name)=>name==='squad_job_claim'?{paused:false,jobs:[{id:'job',lease_token:'private',handler:'local_amendment'}]}:{state:'done'};
 const h=createHandler(secret,rpc,undefined,undefined,undefined,undefined,undefined,undefined,{heartbeat:async()=>{throw new Error('private failure');}});
 const result=await(await h(request({limit:1}))).json();assert(result.maintenance==='unconfirmed'&&result.results[0].state==='done'&&!JSON.stringify(result).includes('private'));
});

Deno.test('maintenance independently attempts both fixed schedules despite one failure',async()=>{
 const calls:string[]=[];let rejected=false;
 try{await scheduledMaintenance(async(name,args)=>{calls.push(name);if(name==='squad_weekly_tailor_heartbeat'){assert(args.p_limit===25);throw new Error('private');}assert(name==='squad_warehouse_heartbeat'&&Object.keys(args).length===0);return{state:'disabled'};});}catch(error){rejected=error instanceof Error&&error.message==='maintenance_unconfirmed';}
 assert(rejected&&calls.join(',')==='squad_weekly_tailor_heartbeat,squad_warehouse_heartbeat');
});
