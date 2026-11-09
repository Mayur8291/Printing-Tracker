import {proofMessage,proofMailer,type ProofPurpose,type ProofMailTransportFactory} from '../_shared/squad-mail.ts';
const assert=(value:unknown)=>{if(!value)throw new Error('assertion failed');};
const base={projectRef:'scvojtvgnkmbupvyslmb',host:'smtp.invalid',port:2525,username:'fixture',password:'fixture',sender:'sender@squad.invalid'};
const id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',email='squad-proof@mailinator.com';
async function denied(send:ReturnType<typeof proofMailer>,recipient=email,purpose:ProofPurpose='register'){try{await send(id,recipient,purpose,'12345678');throw new Error('accepted');}catch(error){assert(error instanceof Error&&error.message==='mail_recipient_not_enabled');}}
Deno.test('proof mail staging requires explicit Mailinator allowlist for all purposes',async()=>{
 let transports=0;const factory:ProofMailTransportFactory=()=>{transports++;throw new Error('unexpected SMTP');};
 for(const purpose of ['register','confirm','recovery','invite'] as ProofPurpose[]){
  await denied(proofMailer(base,factory),email,purpose);
  await denied(proofMailer({...base,allowedRecipients:[]},factory),email,purpose);
  await denied(proofMailer({...base,allowedRecipients:['real@example.com']},factory),'real@example.com',purpose);
  await denied(proofMailer({...base,allowedRecipients:['different@mailinator.com']},factory),email,purpose);
 }
 assert(transports===0);
});
Deno.test('proof mail sends only allowed test recipient with TLS and stable purpose identity',async()=>{
 let closed=0;const sent:Record<string,unknown>[]=[];
 const factory:ProofMailTransportFactory=(options)=>{assert(options.requireTLS===true&&options.disableFileAccess===true&&options.disableUrlAccess===true);assert((options.tls as Record<string,unknown>).rejectUnauthorized===true);return{sendMail:async(message)=>{sent.push(message);return{accepted:[email],rejected:[]};},close:()=>{closed++;}};};
 for(const purpose of ['register','confirm','recovery','invite'] as ProofPurpose[])await proofMailer({...base,allowedRecipients:[email]},factory)(id,email,purpose,'12345678');
 assert(sent.length===4&&closed===4);assert(sent.every(message=>message.messageId===`<squad-${id}@scottinternational.com>`));assert(new Set(sent.map(x=>x.subject)).size===4);
});
Deno.test('proof mail partial SMTP config is lazy and does not open transport',async()=>{
 let calls=0;const factory:ProofMailTransportFactory=()=>{calls++;throw new Error('unexpected SMTP');};
 for(const property of ['host','username','password','sender']){const send=proofMailer({...base,[property]:'',allowedRecipients:[email]},factory);await denied(send);}
 await denied(proofMailer({...base,port:587,allowedRecipients:[email]},factory));assert(calls===0);
});
Deno.test('proof mail rejects unknown project and applies optional production allowlist',async()=>{
 let opened=0;const factory:ProofMailTransportFactory=()=>{opened++;return{sendMail:async()=>({accepted:['real@example.com']}),close:()=>{}};};
 await denied(proofMailer({...base,projectRef:'unknown',allowedRecipients:[email]},factory));
 await denied(proofMailer({...base,projectRef:'levwrmvqdntngeasrtnb',allowedRecipients:[email]},factory),'real@example.com');
 await proofMailer({...base,projectRef:'levwrmvqdntngeasrtnb'},factory)(id,'real@example.com','invite','12345678');assert(opened===1);
});
Deno.test('proof mail never treats rejection or uncertain SMTP response as sent',async()=>{
 for(const response of [{accepted:[]},{accepted:[email],rejected:['other@example.com']},null]){
  let closes=0;const factory:ProofMailTransportFactory=()=>({sendMail:async()=>{if(!response)throw new Error('network private details');return response;},close:()=>{closes++;}});
  try{await proofMailer({...base,allowedRecipients:[email]},factory)(id,email,'confirm','12345678');throw new Error('accepted');}catch(error){assert(error instanceof Error&&error.message==='mail_delivery_unavailable');}assert(closes===1);
 }
});
Deno.test('shared SMTP deadline closes a stalled transport and reports uncertainty',async()=>{
 const original=globalThis.setTimeout;let closes=0,deadline=0;
 globalThis.setTimeout=((handler:()=>void,timeout:number)=>{deadline=timeout;return original(handler,1);}) as typeof setTimeout;
 try{
  const factory:ProofMailTransportFactory=()=>({sendMail:()=>new Promise(()=>{}),close:()=>{closes++;}});
  try{await proofMailer({...base,allowedRecipients:[email]},factory)(id,email,'recovery','12345678');throw new Error('accepted');}catch(error){assert(error instanceof Error&&error.message==='mail_delivery_unavailable');}
  assert(deadline===35000&&closes>=1);
 }finally{globalThis.setTimeout=original;}
});

Deno.test('invitation proof includes the exact request ID required by the guest form',()=>{
 const invitation=proofMessage(id,email,'invite','12345678');
 assert(invitation.text.includes(`Invitation request ID: ${id}`));
 for(const purpose of ['register','confirm','recovery'] as ProofPurpose[])assert(!proofMessage(id,email,purpose,'12345678').text.includes('Invitation request ID:'));
});
