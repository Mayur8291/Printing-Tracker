import nodemailer from 'npm:nodemailer@10.3.1';
import {Buffer} from 'node:buffer';
import type {MailConfig} from '../_shared/squad-mail.ts';
import type {Rpc} from './handler.ts';
import type {DocumentStorage} from './documents.ts';
interface Message {document_id:string;kind:string;email:string;path:string;bytes:number;sha256:string;pages:number;}
export function documentMessage(m:Message,attachment?:Uint8Array){
 if(!/^[a-f0-9-]{36}$/i.test(m.document_id)||m.email.length>254||!/^[^\s\x00-\x1f\x7f<>;,"@]+@[^\s\x00-\x1f\x7f<>;,"@]+\.[^\s\x00-\x1f\x7f<>;,"@]+$/.test(m.email)||!['catalogue','delivery_challan','tailor_weekly'].includes(m.kind))throw new Error('invalid_document_message');
 const title={catalogue:'catalogue',delivery_challan:'delivery challan',tailor_weekly:'weekly work and payment report'}[m.kind];
 return{to:{address:m.email,name:''},messageId:`<squad-document-${m.document_id}@scottinternational.com>`,subject:`Your Squad One ${title} is ready`,text:`Your ${title} is ready.\n\n${attachment?'The PDF is attached.':'The file exceeds the email attachment limit. Sign in to your account and download it from Documents.'}\n\nDocument: ${m.document_id}\nPages: ${m.pages}\n\nGenerated catalogues expire after three days. Operational records follow their retention policy.`,
  ...(attachment?{attachments:[{filename:m.kind+'.pdf',content:Buffer.from(attachment),contentType:'application/pdf'}]}:{})};
}
export function documentMailer(config:MailConfig){
 return async(message:Message,attachment?:Uint8Array)=>{
  if(!config.host||!config.username||!config.password||!config.sender||![2525,465].includes(config.port))throw new Error('mail_recipient_not_enabled');
  if(config.allowedRecipients&&!config.allowedRecipients.includes(message.email))throw new Error('mail_recipient_not_enabled');
  const content=documentMessage(message,attachment);
  const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:config.username,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,pool:false,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  try{const result=await transport.sendMail({...content,from:{address:config.sender,name:'Squad One'}});if(!result.accepted?.includes(message.email)||result.rejected?.length)throw new Error('mail_unconfirmed');}
  catch{throw new Error('mail_delivery_unavailable');}finally{transport.close();}
 };
}
export function documentMailWorker(rpc:Rpc,storage:DocumentStorage,send:ReturnType<typeof documentMailer>){
 return async(job:{id:string;lease_token:string})=>{
  const args={p_id:job.id,p_lease_token:job.lease_token};const message=await rpc('squad_document_mail_prepare',args) as Message&{state:string;error_code?:string};
  if(message.state!=='prepared')return{id:job.id,state:message.state,...(message.error_code?{error_code:message.error_code}:{})};
  let code='SENT';
  try{const attachment=message.bytes<=10*1024*1024?await storage.part({path:message.path,bytes:message.bytes,sha256:message.sha256,pages:message.pages}):undefined;await send(message,attachment);}
  catch(error){code=error instanceof Error&&error.message==='mail_recipient_not_enabled'?'MAIL_NOT_ENABLED':'PROVIDER_UNAVAILABLE';}
  return await rpc('squad_document_mail_finish',{...args,p_code:code}) as {id:string;state:string;error_code?:string};
 };
}
