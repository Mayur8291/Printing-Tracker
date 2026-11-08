import {createHandler,type Rpc} from './handler.ts';
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
