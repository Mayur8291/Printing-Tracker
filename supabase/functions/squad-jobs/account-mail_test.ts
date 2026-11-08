import {accountMail} from './account-mail.ts';
import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import type {Rpc} from './handler.ts';
function assert(v:unknown):asserts v{if(!v)throw new Error('assertion failed');}
const crypto=accountCrypto('test-only-never-production-mail-secret'),flow='11111111-1111-4111-8111-111111111111',email='fixture@example.invalid',code='12345678',job={id:'job',lease_token:'private-lease'};
Deno.test('mail sends only the scoped decrypted code then acknowledges without secrets',async()=>{
 let delivered=false;const cipher=await crypto.seal(flow,email,code);const rpc:Rpc=async(n,a)=>{if(n==='squad_account_mail_prepare')return{flow_id:flow,email,purpose:'recovery',ciphertext:cipher,expires_at:new Date(Date.now()+900000).toISOString()};assert(delivered&&a.p_sent===true);assert(!JSON.stringify(a).includes(code)&&!JSON.stringify(a).includes(email));return{id:'job',state:'done'};};const result=await accountMail(rpc,crypto,async(id,to,purpose,value)=>{assert(id===flow&&to===email&&purpose==='recovery'&&value===code);delivered=true;})(job);assert(result.state==='done');
});
Deno.test('expired or superseded proof never sends mail',async()=>{
 let sent=false;const rpc:Rpc=async(n,a)=>{if(n==='squad_account_mail_prepare')return{skip:true};assert(a.p_sent===false&&a.p_error===null);return{id:'job',state:'done'};};await accountMail(rpc,crypto,async()=>{sent=true;})(job);assert(!sent);
});
Deno.test('SMTP uncertain response is retryable and does not acknowledge delivery',async()=>{
 const cipher=await crypto.seal(flow,email,code);const rpc:Rpc=async(n,a)=>{if(n==='squad_account_mail_prepare')return{flow_id:flow,email,purpose:'recovery',ciphertext:cipher,expires_at:new Date(Date.now()+900000).toISOString()};assert(a.p_sent===false&&a.p_error==='PROVIDER_UNAVAILABLE');return{id:'job',state:'pending'};};assert((await accountMail(rpc,crypto,async()=>{throw new Error('provider password must never leak');})(job)).state==='pending');
});
Deno.test('staging recipient restriction creates an explicit failure without provider retry',async()=>{
 const cipher=await crypto.seal(flow,email,code);const rpc:Rpc=async(n,a)=>{if(n==='squad_account_mail_prepare')return{flow_id:flow,email,purpose:'recovery',ciphertext:cipher,expires_at:new Date(Date.now()+900000).toISOString()};assert(a.p_error==='MAIL_NOT_ENABLED');return{id:'job',state:'dead'};};assert((await accountMail(rpc,crypto,async()=>{throw new Error('mail_recipient_not_enabled');})(job)).state==='dead');
});
