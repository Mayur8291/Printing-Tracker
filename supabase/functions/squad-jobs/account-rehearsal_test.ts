import {accountRehearsal} from './account-rehearsal.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {createHandler} from './handler.ts';
const assert=(v:unknown)=>{if(!v)throw new Error('assertion failed');};
const id='11111111-1111-4111-8111-111111111111',flow='22222222-2222-4222-8222-222222222222',lease='33333333-3333-4333-8333-333333333333';
const email='squad-guest-11111111111111111111111111111111-register@mailinator.com',secret='s'.repeat(64);
const config={projectRef:'scvojtvgnkmbupvyslmb',host:'smtp.invalid',port:2525,username:'fixture',password:'fixture',sender:'sender@squad.invalid'};
const grant=()=>({jobs:[{id,lease_token:lease,handler:'account_mail'}],flow_id:flow,recipient:email,purpose:'register',expires_at:new Date(Date.now()+600000).toISOString()});
Deno.test('exact account rehearsal delivers original proof to only bound actual recipient',async()=>{
 let sent=0;const calls:string[]=[];const crypto=accountCrypto(secret);
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push(name);assert(args.p_id===id);if(name==='squad_account_rehearsal_claim')return grant();assert(args.p_lease_token===lease);if(name==='squad_account_mail_prepare')return{flow_id:flow,email,purpose:'register',ciphertext:await crypto.seal(flow,email,'12345678'),expires_at:new Date(Date.now()+600000).toISOString()};assert(name==='squad_account_mail_finish'&&args.p_sent===true);return{id,state:'done'};};
 const result=await accountRehearsal(rpc,secret,config,()=>({sendMail:async(message)=>{assert((message.to as {address:string}).address===email);assert(message.messageId===`<squad-${flow}@scottinternational.com>`);sent++;return{accepted:[email]};},close:()=>{}}))(id);
 assert(sent===1&&result.results[0].state==='done'&&calls.length===3);
});
Deno.test('foreign recipients, purposes, job ids and stale grants cannot open SMTP',async()=>{
 for(const changes of [{recipient:'real@example.com'},{recipient:email.replace('register','invite')},{flow_id:'bad'},{purpose:'push'},{expires_at:'bad'},{expires_at:new Date(0).toISOString()},{jobs:[{id:flow,lease_token:lease,handler:'account_mail'}]}]){
  let opened=0;try{await accountRehearsal(async()=>({...grant(),...changes}),secret,config,()=>{opened++;throw new Error('unexpected SMTP');})(id);throw new Error('accepted');}catch(e){assert((e as Error).message==='invalid_account_rehearsal_claim');}assert(opened===0);
 }
});
Deno.test('mail payload changed after claim cannot deliver to another recipient',async()=>{
 const crypto=accountCrypto(secret);let sent=0;
 const rpc=async(name:string,args:Record<string,unknown>)=>name==='squad_account_rehearsal_claim'?grant():name==='squad_account_mail_prepare'?{flow_id:flow,email:'other@mailinator.com',purpose:'register',ciphertext:await crypto.seal(flow,'other@mailinator.com','12345678'),expires_at:grant().expires_at}:(assert(args.p_sent===false),{id,state:'dead'});
 await accountRehearsal(rpc,secret,config,()=>{sent++;throw new Error('unexpected SMTP');})(id);assert(sent===0);
});
Deno.test('route is worker-secret protected, staging-only and rejects arbitrary selectors',async()=>{
 let calls=0;const domain={rehearsalProjectRef:config.projectRef,accountRehearsal:async()=>{calls++;return{results:[]};}};
 const handler=createHandler(secret,async()=>{throw new Error('generic RPC forbidden');},undefined,undefined,undefined,undefined,undefined,undefined,domain);
 const request=(body:unknown,auth=secret)=>new Request('https://edge.invalid/squad-jobs/account-rehearsal',{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)});
 assert((await handler(request({job_id:id},'wrong'))).status===401);
 assert((await handler(request({job_id:id,recipient:email}))).status===400);
 assert((await handler(request({job_id:id}))).status===200&&calls===1);
 domain.rehearsalProjectRef='production';assert((await handler(request({job_id:id}))).status===503&&calls===1);
});
