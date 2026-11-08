import nodemailer from 'npm:nodemailer@10.3.1';
export interface MailConfig {host:string;port:number;username:string;password:string;sender:string;allowedRecipients?:string[];}
export type ProofPurpose='register'|'confirm'|'recovery'|'invite';
const labels:Record<ProofPurpose,string>={register:'registration',confirm:'email confirmation',recovery:'password recovery',invite:'account invitation'};
export function proofMessage(id:string,recipient:string,purpose:ProofPurpose,code:string){
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^\d{8}$/.test(code)||!Object.hasOwn(labels,purpose)||recipient.length>254||!/^[^\s\x00-\x1f\x7f<>;,"@]+@[^\s\x00-\x1f\x7f<>;,"@]+\.[^\s\x00-\x1f\x7f<>;,"@]+$/.test(recipient))throw new Error('invalid_proof_mail');
 return{to:{address:recipient,name:''},messageId:`<squad-${id}@scottinternational.com>`,subject:`Your Squad One ${labels[purpose]} code`,
 text:`Your Squad One ${labels[purpose]} code is:\n\n${code}\n\nIt expires 15 minutes after your request. Enter it only in the Squad One app or dashboard where you requested it. Do not share this code.\n\nEmail confirmation does not automatically approve your business account. If you did not request this message, you can ignore it.`};
}
export function proofMailer(config:MailConfig){
 if(!config.host||!config.username||!config.password||!config.sender||![2525,465].includes(config.port))throw new Error('mail_unconfigured');
 return async(id:string,recipient:string,purpose:ProofPurpose,code:string)=>{
  if(config.allowedRecipients&&!config.allowedRecipients.includes(recipient))throw new Error('mail_recipient_not_enabled');
  const message=proofMessage(id,recipient,purpose,code);
  const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:true,
   tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:config.username,pass:config.password},
   connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,pool:false,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  try{const result=await transport.sendMail({...message,from:{address:config.sender,name:'Squad One'}});if(!result.accepted?.includes(recipient)||result.rejected?.length)throw new Error('mail_unconfirmed');}
  catch{throw new Error('mail_delivery_unavailable');}
  finally{transport.close();}
 };
}
