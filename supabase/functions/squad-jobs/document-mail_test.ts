import {documentMessage,documentMailWorker,documentMailer} from './document-mail.ts';
import type {DocumentStorage} from './documents.ts';
const assert=(v:unknown)=>{if(!v)throw new Error('assertion failed');};
const job={id:crypto.randomUUID(),lease_token:crypto.randomUUID()};
const message={state:'prepared',document_id:crypto.randomUUID(),kind:'catalogue',email:'synthetic@squad.invalid',path:'synthetic',bytes:100,sha256:'a'.repeat(64),pages:1};
const storage:DocumentStorage={asset:async()=>new Uint8Array(),part:async()=>new Uint8Array(100),put:async()=>{}};
Deno.test('mail uses a stable message ID and a real attachment without exposing storage credentials',()=>{
 const a=documentMessage(message,new Uint8Array(100)),b=documentMessage(message,new Uint8Array(100));assert(a.messageId===b.messageId);assert(a.attachments?.[0].filename==='catalogue.pdf');assert(!a.text.includes('synthetic'));assert(a.to.address===message.email);
 for(const email of ['evil@example.com\r\nBCC:other@example.com','a@example.com,b@example.com']){try{documentMessage({...message,email});throw new Error('accepted');}catch(e){assert(e instanceof Error&&e.message==='invalid_document_message');}}
});
Deno.test('mail rechecks recipient before reading files or sending and large PDFs are not attached',async()=>{
 let sent=0,read=0;const files={...storage,part:async()=>{read++;return new Uint8Array();}};
 const denied=documentMailWorker(async()=>({state:'dead'}),files,async()=>{sent++;});assert((await denied(job)).state==='dead'&&read===0&&sent===0);
 let code='';const worker=documentMailWorker(async(name,args)=>name.endsWith('prepare')?{...message,bytes:11*1024*1024}:(code=String(args.p_code),{id:job.id,state:'done'}),files,async(m,a)=>{sent++;assert(a===undefined&&m.email===message.email);});await worker(job);assert(code==='SENT'&&read===0&&sent===1);
});
Deno.test('mail allowlist denial is terminal and provider failure is retryable',async()=>{
 for(const [error,expected] of [['mail_recipient_not_enabled','MAIL_NOT_ENABLED'],['network','PROVIDER_UNAVAILABLE']]){let code='';await documentMailWorker(async(name,args)=>name.endsWith('prepare')?message:(code=String(args.p_code),{id:job.id,state:'done'}),storage,async()=>{throw new Error(error);})(job);assert(code===expected);}
});
Deno.test('unconfirmed mail finish never sends again inside an invocation',async()=>{
 let sent=0,finish=0;try{await documentMailWorker(async(name)=>{if(name.endsWith('prepare'))return message;finish++;throw new Error('network');},storage,async()=>{sent++;})(job);}catch{}assert(sent===1&&finish===1);
});
Deno.test('configured staging allowlist rejects recipients before opening SMTP',async()=>{
 const send=documentMailer({host:'smtp.invalid',port:2525,username:'x',password:'x',sender:'sender@squad.invalid',allowedRecipients:['different@squad.invalid']});try{await send(message);throw new Error('accepted');}catch(e){assert(e instanceof Error&&e.message==='mail_recipient_not_enabled');}
});
