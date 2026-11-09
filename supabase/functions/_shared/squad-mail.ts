import nodemailer from 'npm:nodemailer@10.3.1';
export interface MailConfig {host:string;port:number;username:string;password:string;sender:string;allowedRecipients?:string[];}
export type ProofPurpose='register'|'confirm'|'recovery'|'invite';
const labels:Record<ProofPurpose,string>={register:'registration',confirm:'email confirmation',recovery:'password recovery',invite:'account invitation'};
export function proofMessage(id:string,recipient:string,purpose:ProofPurpose,code:string){
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^\d{8}$/.test(code)||!Object.hasOwn(labels,purpose)||recipient.length>254||!/^[^\s\x00-\x1f\x7f<>;,"@]+@[^\s\x00-\x1f\x7f<>;,"@]+\.[^\s\x00-\x1f\x7f<>;,"@]+$/.test(recipient))throw new Error('invalid_proof_mail');
 return{to:{address:recipient,name:''},messageId:`<squad-${id}@scottinternational.com>`,subject:`Your Squad One ${labels[purpose]} code`,
 text:`Your Squad One ${labels[purpose]} code is:\n\n${code}\n\n${purpose==='invite'?`Invitation request ID: ${id}\n\n`:''}It expires 15 minutes after your request. Enter it only in the Squad One app or dashboard where you requested it. Do not share this code.\n\nEmail confirmation does not automatically approve your business account. If you did not request this message, you can ignore it.`};
}
export interface ProofMailTransport {
 sendMail(message:Record<string,unknown>):Promise<{accepted?:unknown[];rejected?:unknown[]}>;
 close():void;
}
export type ProofMailTransportFactory=(options:Record<string,unknown>)=>ProofMailTransport;
export type ProjectMailConfig=MailConfig&{projectRef:string};
export function assertMailRecipient(config:ProjectMailConfig,recipient:string){
 if(!['scvojtvgnkmbupvyslmb','levwrmvqdntngeasrtnb'].includes(config.projectRef)||!config.host||!config.username||!config.password||!config.sender||![2525,465].includes(config.port))throw new Error('mail_recipient_not_enabled');
 if(config.projectRef==='scvojtvgnkmbupvyslmb'&&(!config.allowedRecipients?.length||!recipient.endsWith('@mailinator.com')))throw new Error('mail_recipient_not_enabled');
 if(config.allowedRecipients&&!config.allowedRecipients.includes(recipient))throw new Error('mail_recipient_not_enabled');
}
/** Shared bounded transport; the verified recipient overrides message fields. */
export async function deliverMail(config:ProjectMailConfig,recipient:string,message:Record<string,unknown>,createTransport:ProofMailTransportFactory=(options)=>nodemailer.createTransport(options)){
 assertMailRecipient(config,recipient);
 const transport=createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:true,
  tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:config.username,pass:config.password},
  connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,pool:false,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{transport.close();reject(new Error('mail_delivery_unavailable'));},35000);});
  const result=await Promise.race([transport.sendMail({...message,to:{address:recipient,name:''},from:{address:config.sender,name:'Squad One'}}),deadline]);
  if(!result.accepted?.includes(recipient)||result.rejected?.length)throw new Error('mail_unconfirmed');
 }catch{throw new Error('mail_delivery_unavailable');}
 finally{clearTimeout(timer);transport.close();}
}
export function proofMailer(config:ProjectMailConfig,createTransport?:ProofMailTransportFactory){
 // Incomplete optional SMTP settings never prevent unrelated jobs from booting.
 return async(id:string,recipient:string,purpose:ProofPurpose,code:string)=>{
  assertMailRecipient(config,recipient);
  await deliverMail(config,recipient,proofMessage(id,recipient,purpose,code),createTransport);
 };
}
