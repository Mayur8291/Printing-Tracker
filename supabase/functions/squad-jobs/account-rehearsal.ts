/** Exact SQL-capability challenge delivery; never a generic mail allowlist. */
import type {Rpc} from './handler.ts';
import {accountMail} from './account-mail.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {proofMailer,type ProjectMailConfig,type ProofMailTransportFactory,type ProofPurpose} from '../_shared/squad-mail.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function accountRehearsal(rpc:Rpc,secret:string|undefined,config:ProjectMailConfig,transport?:ProofMailTransportFactory){
 return async(id:string)=>{
  if(config.projectRef!=='scvojtvgnkmbupvyslmb'||!secret||!uuid.test(id))throw new Error('account_rehearsal_unavailable');
  const grant=await rpc('squad_account_rehearsal_claim',{p_id:id}) as {
   jobs:Array<{id:string;lease_token:string;handler:string}>;recipient?:string;flow_id?:string;purpose?:ProofPurpose;expires_at?:string;
  };
  if(!grant||!Array.isArray(grant.jobs)||grant.jobs.length>1)throw new Error('invalid_account_rehearsal_claim');
  if(!grant.jobs.length)return{results:[]};
  const job=grant.jobs[0];
  if(job.id!==id||job.handler!=='account_mail'||!uuid.test(job.lease_token)||!grant.flow_id||!uuid.test(grant.flow_id)
   ||!grant.purpose||!['register','confirm','recovery','invite'].includes(grant.purpose)
   ||typeof grant.recipient!=='string'||!new RegExp(`^squad-guest-[a-f0-9]{32}-${grant.purpose}@mailinator\\.com$`).test(grant.recipient)
   ||!grant.expires_at||!Number.isFinite(Date.parse(grant.expires_at))||Date.parse(grant.expires_at)<=Date.now()
   ||Date.parse(grant.expires_at)>Date.now()+15*60_000)throw new Error('invalid_account_rehearsal_claim');
  const send=proofMailer({...config,allowedRecipients:[grant.recipient]},transport);
  const worker=accountMail(rpc,accountCrypto(secret),async(flow,email,purpose,code)=>{
   if(flow!==grant.flow_id||email!==grant.recipient||purpose!==grant.purpose||Date.parse(grant.expires_at!)<=Date.now())throw new Error('mail_recipient_not_enabled');
   await send(flow,email,purpose,code);
  });
  const result=await worker(job);
  return{results:[{id:result.id,state:result.state,...(result.error_code?{error_code:result.error_code}:{})}]};
 };
}
