import {createHandler,serviceRpc,type Rpc} from './handler.ts';

const assert=(value:unknown,message='assertion failed')=>{if(!value)throw new Error(message);};
const same=(actual:unknown,expected:unknown)=>assert(JSON.stringify(actual)===JSON.stringify(expected),JSON.stringify({actual,expected}));
const secret='document-rehearsal-fixture-secret-123456789';
const jobId='11111111-1111-4111-8111-111111111111';
const lease='22222222-2222-4222-8222-222222222222';
const otherId='33333333-3333-4333-8333-333333333333';
const project='scvojtvgnkmbupvyslmb';
const claimed={id:jobId,lease_token:lease,handler:'document_render',attempt:1};
const request=(body:unknown={job_id:jobId},options:{authorization?:string;contentType?:string;method?:string}={})=>new Request('https://fixture.invalid/functions/v1/squad-jobs/document-rehearsal',{
  method:options.method??'POST',headers:{authorization:options.authorization??`Bearer ${secret}`,'Content-Type':options.contentType??'application/json'},
  ...((options.method??'POST')==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),
});
function fixture(options:{claim?:unknown;projectRef?:string;claimError?:boolean;runError?:boolean;state?:string;missingDocuments?:boolean}={}){
  const calls:Array<{name:string;args:unknown}>=[],runs:unknown[]=[],sideEffects:string[]=[];
  const rpc:Rpc=(name,args)=>{
    calls.push({name,args});
    if(options.claimError)return Promise.reject(new Error('private database failure'));
    return Promise.resolve(options.claim??{jobs:[claimed],paused:false});
  };
  const documents={run:(job:unknown)=>{
    runs.push(job);
    return options.runError?Promise.reject(new Error('private provider token')):Promise.resolve({id:jobId,state:options.state??'done',private_value:'never-return'});
  },mail:()=>{sideEffects.push('mail');throw new Error('mail forbidden');},remove:()=>{sideEffects.push('cleanup');throw new Error('cleanup forbidden');}};
  const handler=createHandler(secret,rpc,()=>{sideEffects.push('upload-cleanup');throw new Error('cleanup forbidden');},undefined,undefined,undefined,options.missingDocuments?undefined:documents,undefined,{
    documentRehearsalProjectRef:options.projectRef??project,
    heartbeat:()=>{sideEffects.push('heartbeat');throw new Error('heartbeat forbidden');},
    warehouse:()=>{sideEffects.push('warehouse');throw new Error('warehouse forbidden');},
  });
  return {handler,calls,runs,sideEffects};
}

Deno.test('document rehearsal rejects missing or incorrect worker authentication before any claim',async()=>{
  for(const authorization of ['', 'Bearer wrong', 'Bearer '+ 'x'.repeat(1100)]){
    const f=fixture(),response=await f.handler(request({job_id:jobId},{authorization}));
    assert(response.status===401);same(f.calls,[]);same(f.runs,[]);
  }
});
Deno.test('document rehearsal requires POST and configured worker secret',async()=>{
  const f=fixture();assert((await f.handler(request(undefined,{method:'GET'}))).status===405);same(f.calls,[]);
  for(const value of [undefined,'short']){
    const handler=createHandler(value,()=>{throw new Error('must not claim');});
    assert((await handler(request())).status===503);
  }
});
Deno.test('document rehearsal is unavailable outside the exact staging project or without renderer',async()=>{
  for(const options of [{projectRef:'levwrmvqdntngeasrtnb'},{projectRef:'unknown'},{projectRef:''},{missingDocuments:true}]){
    const f=fixture(options);assert((await f.handler(request())).status===503);same(f.calls,[]);same(f.runs,[]);
  }
  const handler=createHandler(secret,()=>{throw new Error('must not claim');});
  assert((await handler(request())).status===503);
});
Deno.test('document rehearsal requires a JSON object containing only one exact UUID job',async()=>{
  for(const body of [{},[],null,{job_id:1},{job_id:'all'},{job_id:jobId,limit:2},{job_id:jobId,document_id:otherId},{job_id:jobId,handler:'warehouse'},{job_id:jobId,actor_id:otherId},'{broken']){
    const f=fixture();assert((await f.handler(request(body))).status===400);same(f.calls,[]);same(f.runs,[]);
  }
  for(const contentType of ['text/plain','application/jsonx','']){
    const f=fixture();assert((await f.handler(request({job_id:jobId},{contentType}))).status===400);same(f.calls,[]);
  }
});
Deno.test('document rehearsal enforces its body byte limit before database dispatch',async()=>{
  const f=fixture(),response=await f.handler(request({job_id:jobId,padding:'x'.repeat(4096)}));
  assert(response.status===400);same(f.calls,[]);same(f.runs,[]);
});
Deno.test('document rehearsal claims the exact job and only invokes the existing document worker once',async()=>{
  const f=fixture(),response=await f.handler(request({job_id:jobId},{contentType:'application/json; charset=utf-8'}));
  assert(response.status===200);same(f.calls,[{name:'squad_document_rehearsal_claim',args:{p_id:jobId}}]);same(f.runs,[claimed]);same(f.sideEffects,[]);
  same(await response.json(),{paused:false,results:[{id:jobId,state:'done'}]});
  assert(response.headers.get('cache-control')==='no-store');
});
Deno.test('busy or unavailable-to-claim document jobs do not invoke rendering',async()=>{
  for(const claim of [{jobs:[],paused:true},{jobs:[],paused:false},{jobs:[]}]){
    const f=fixture({claim}),response=await f.handler(request());
    assert(response.status===200);same(f.runs,[]);same(f.sideEffects,[]);
    same(await response.json(),{paused:claim.paused??false,results:[]});
  }
});
Deno.test('document rehearsal fails closed on a malformed, unrelated or non-document lease',async()=>{
  for(const claim of [{},{jobs:null},{jobs:[null]},{jobs:[claimed,claimed]},{jobs:[{...claimed,id:otherId}]},{jobs:[{...claimed,handler:'document_mail'}]},{jobs:[{...claimed,handler:'warehouse'}]},{jobs:[{...claimed,lease_token:'not-a-lease'}]},{jobs:[claimed],paused:true},{jobs:[],paused:'false'}]){
    const f=fixture({claim}),response=await f.handler(request());
    assert(response.status===503);same(f.runs,[]);same(f.sideEffects,[]);
    same(await response.json(),{error:'DOCUMENT_REHEARSAL_UNAVAILABLE'});
  }
});
Deno.test('expired or rejected document capability errors disclose no database details and run nothing',async()=>{
  const f=fixture({claimError:true}),response=await f.handler(request());
  assert(response.status===503);same(await response.json(),{error:'DOCUMENT_REHEARSAL_UNAVAILABLE'});same(f.runs,[]);same(f.sideEffects,[]);
});
Deno.test('a lost document finish response remains unconfirmed without a second execution or contradictory finish',async()=>{
  const f=fixture({runError:true}),response=await f.handler(request());
  same(await response.json(),{paused:false,results:[{id:jobId,state:'unconfirmed'}]});
  assert(f.calls.length===1&&f.runs.length===1);same(f.sideEffects,[]);
});
Deno.test('a document part checkpoint does not automatically claim another part or another job',async()=>{
  const f=fixture({state:'pending'}),response=await f.handler(request());
  same(await response.json(),{paused:false,results:[{id:jobId,state:'pending'}]});
  assert(f.calls.length===1&&f.runs.length===1);same(f.sideEffects,[]);
});
Deno.test('service RPC transport allows only the exact named rehearsal claim through private service auth',async()=>{
  const original=globalThis.fetch;const calls:Array<{url:string;body:unknown}>=[];
  globalThis.fetch=(input,init)=>{
    const headers=new Headers(init?.headers);
    assert(headers.get('Authorization')==='Bearer fixture-service-key');
    assert(headers.get('Content-Profile')==='canto_api'&&headers.get('Accept-Profile')==='canto_api');
    calls.push({url:String(input),body:JSON.parse(String(init?.body))});
    return Promise.resolve(new Response(JSON.stringify({jobs:[],paused:true}),{headers:{'Content-Type':'application/json'}}));
  };
  try{
    const rpc=serviceRpc('https://fixture.supabase.co','fixture-service-key');
    same(await rpc('squad_document_rehearsal_claim',{p_id:jobId}),{jobs:[],paused:true});
    same(calls,[{url:'https://fixture.supabase.co/rest/v1/rpc/squad_document_rehearsal_claim',body:{p_id:jobId}}]);
    let rejected=false;try{await rpc('squad_document_rehearsal_claim_all',{});}catch{rejected=true;}
    assert(rejected&&calls.length===1);
  }finally{globalThis.fetch=original;}
});
