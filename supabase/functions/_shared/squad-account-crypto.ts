/** Separate keyed domains for proof codes, request binding and mail encryption.
 * Neither reusable credentials nor plaintext codes are stored in the database. */
const bytes=new TextEncoder();
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),n=>n.toString(16).padStart(2,'0')).join('');
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export function accountCrypto(secret:string){
 if(secret.length<32)throw new Error('account_crypto_unconfigured');
 async function key(domain:string,algorithm:'HMAC'|'AES-GCM'){
  const raw=await crypto.subtle.digest('SHA-256',bytes.encode(domain+'\0'+secret));
  return crypto.subtle.importKey('raw',raw,algorithm==='HMAC'?{name:algorithm,hash:'SHA-256'}:algorithm,false,algorithm==='HMAC'?['sign']:['encrypt','decrypt']);
 }
 const signing=key('squad-account-proof-v1','HMAC'),encryption=key('squad-account-mail-v1','AES-GCM');
 async function digest(purpose:string,value:unknown){return hex(await crypto.subtle.sign('HMAC',await signing,bytes.encode(JSON.stringify([purpose,value]))));}
 return{
  code(){const n=new Uint32Array(1);do{crypto.getRandomValues(n);}while(n[0]>=4200000000);return String(n[0]%100000000).padStart(8,'0');},
  proof:(id:string,email:string,code:string)=>digest('code',[id,email,code]),
  password:(id:string,password:string)=>digest('password',[id,password]),
  request:(purpose:string,email:string,payload:unknown)=>digest('request',[purpose,email,canonical(payload)]),
  async seal(id:string,email:string,code:string){
   const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(JSON.stringify([id,email]))},await encryption,bytes.encode(code));
   return b64(iv)+'.'+b64(new Uint8Array(encrypted));
  },
  async open(id:string,email:string,cipher:string){
   if(cipher.length>256||cipher.split('.').length!==2)throw new Error('invalid_mail_cipher');
   const [iv,data]=cipher.split('.').map(unb64);if(iv.length!==12)throw new Error('invalid_mail_cipher');
   const value=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:bytes.encode(JSON.stringify([id,email]))},await encryption,data));
   if(!/^\d{8}$/.test(value))throw new Error('invalid_mail_code');return value;
  },
 };
}
