import {accountCrypto} from '../_shared/squad-account-crypto.ts';
import {proofMessage} from '../_shared/squad-mail.ts';
function assert(v:unknown):asserts v{if(!v)throw new Error('assertion failed');}
const crypt=accountCrypto('test-only-secret-never-a-production-value');const id=crypto.randomUUID();const email='fixture@example.invalid';
Deno.test('proof encryption binds the flow and email and rejects tampering',async()=>{
 const code=crypt.code();assert(/^\d{8}$/.test(code));const sealed=await crypt.seal(id,email,code);assert(!sealed.includes(code));assert(await crypt.open(id,email,sealed)===code);
 for(const [flow,recipient,cipher] of [[crypto.randomUUID(),email,sealed],[id,'foreign@example.invalid',sealed],[id,email,sealed.slice(0,-4)+'AAAA']]){let rejected=false;try{await crypt.open(flow,recipient,cipher);}catch{rejected=true;}assert(rejected);}
});
Deno.test('proof and password fingerprints are keyed and domain separated',async()=>{
 const code=crypt.code(),proof=await crypt.proof(id,email,code);assert(proof.length===64);assert(proof!==await crypt.password(id,code));assert(proof!==await accountCrypto('another-test-only-secret-with-enough-bytes').proof(id,email,code));assert(proof===await crypt.proof(id,email,code));
});
Deno.test('proof messages have stable delivery identity and no arbitrary headers or content',()=>{
 const a=proofMessage(id,email,'recovery','12345678'),b=proofMessage(id,email,'recovery','12345678');assert(a.messageId===b.messageId);assert(a.text.includes('12345678')&&!('html' in a)&&!('attachments' in a));
 for(const recipient of ['victim@example.invalid\r\nBcc: other@example.invalid','a@example.invalid,b@example.invalid','a@example.invalid; b@example.invalid']){let rejected=false;try{proofMessage(id,recipient,'register','12345678');}catch{rejected=true;}assert(rejected);}
});
Deno.test('request fingerprints ignore object key order but preserve array order',async()=>{
 assert(await crypt.request('register',email,{a:1,b:{d:4,c:3}})===await crypt.request('register',email,{b:{c:3,d:4},a:1}));
 assert(await crypt.request('register',email,{a:[1,2]})!==await crypt.request('register',email,{a:[2,1]}));
});
