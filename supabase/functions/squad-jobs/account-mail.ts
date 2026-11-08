import type {Rpc} from './handler.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import type {ProofPurpose} from '../_shared/squad-mail.ts';
export function accountMail(rpc:Rpc,crypto:ReturnType<typeof accountCrypto>,send:(id:string,email:string,purpose:ProofPurpose,code:string)=>Promise<void>){
 return async(job:{id:string;lease_token:string})=>{
  const args={p_id:job.id,p_lease_token:job.lease_token};
  const message=await rpc('squad_account_mail_prepare',args) as {skip?:boolean;flow_id:string;email:string;purpose:ProofPurpose;ciphertext:string;expires_at:string};
  let sent=false,error:string|null=null;
  if(!message.skip){
   try{
    if(Date.parse(message.expires_at)<=Date.now())throw new Error('expired');
    const code=await crypto.open(message.flow_id,message.email,message.ciphertext);
    await send(message.flow_id,message.email,message.purpose,code);sent=true;
   }catch(e){error=e instanceof Error&&e.message==='mail_recipient_not_enabled'?'MAIL_NOT_ENABLED':'PROVIDER_UNAVAILABLE';}
  }
  return await rpc('squad_account_mail_finish',{...args,p_sent:sent,p_error:error}) as {id:string;state:string;error_code?:string};
 };
}
