import {createHandler,dependencies} from './handler.ts';
function assert(value:unknown,message='assertion failed'):asserts value{if(!value)throw new Error(message);}
const request=()=>new Request('https://example.invalid/functions/v1/squad-account/users/status',{
 method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({user_id:'1',action:'disable',reason:'Fixture',expected_version:'1:0',idempotency_key:crypto.randomUUID()}),
});
for(const [code,expected,status] of [
 ['PT409','VERSION_CONFLICT',409],['40001','VERSION_CONFLICT',409],
 ['55000','WRITE_UNAVAILABLE',409],['42501','FORBIDDEN',403],['28000','SESSION_REQUIRED',401],['22023','INVALID_REQUEST',400],
] as const){
 Deno.test(`account RPC maps ${code} to ${expected} without retry or error detail leakage`,async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(input,init)=>{
   calls++;assert(String(input)==='https://example.invalid/rest/v1/rpc/account_user_status');
   assert(new Headers(init?.headers).get('Authorization')==='Bearer fixture');
   return new Response(JSON.stringify({code,message:'private database details',details:'private row data'}),{status:code==='40001'?500:409});
  };
  try{
   const response=await createHandler(dependencies('https://example.invalid','anon-fixture','service-fixture'))(request());
   assert(response.status===status);assert(JSON.stringify(await response.json())===JSON.stringify({error:expected}));assert(calls===1);
  }finally{globalThis.fetch=original;}
 });
}
