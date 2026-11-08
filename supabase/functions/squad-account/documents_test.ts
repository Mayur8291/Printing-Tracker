import {createHandler,AccountError,type Dependencies} from './handler.ts';
const assert=(v:unknown)=>{if(!v)throw new Error('assertion failed');};
const id='abcdefab-abcd-4abc-8abc-abcdefabcdef',path='g0/'+id+'/'+id+'/document.pdf';
const request=(body:unknown={id},auth='Bearer actor')=>new Request('https://example.invalid/functions/v1/squad-account/documents/download',{method:'POST',headers:{Authorization:auth},body:JSON.stringify(body)});
const deps=():Dependencies=>({storageUrl:'https://example.invalid/storage/v1',resolveMedia:async()=>{throw new Error();},signMedia:async()=>[],documentGrant:async()=>({id,bucket:'squad-documents',path,expires_in:999,generation:'0',bytes:'100',sha256:'a'.repeat(64)}),signDocument:async()=>'/object/sign/squad-documents/'+path+'?token=synthetic'});
Deno.test('document download authenticates and rechecks authority before signing',async()=>{
 let signed=0;const d=deps();d.signDocument=async()=>{signed++;return'';};assert((await createHandler(d)(request({},''))).status===401);
 d.documentGrant=async(auth)=>{assert(auth==='Bearer actor');throw new AccountError('NOT_FOUND',404);};assert((await createHandler(d)(request())).status===404);assert(signed===0);
});
Deno.test('document download has fixed short TTL, disposition, and no-cache response',async()=>{
 const d=deps();d.signDocument=async(p,ttl)=>{assert(p===path&&ttl===120);return'/object/sign/squad-documents/'+p+'?token=synthetic';};const r=await createHandler(d)(request());const value=await r.json();assert(r.status===200&&r.headers.get('cache-control')==='no-store');assert(value.expires_in===120&&value.generation==='0');assert(new URL(value.url).searchParams.get('download')==='squad-'+id+'.pdf');assert(!('path' in value)&&!('bucket'in value));assert((await createHandler(d)(request({id:id.toUpperCase()}))).status===200);
});
Deno.test('download never signs a mismatched document or another bucket',async()=>{
 for(const wrong of [{id:crypto.randomUUID()},{bucket:'public'},{path:'../secret'},{path:path.replace('/document.pdf','/part-0000.pdf')}]){const d=deps(),original=d.documentGrant!;d.documentGrant=async(...a)=>({...await original(...a),...wrong});d.signDocument=async()=>{throw new Error('must not sign');};assert((await createHandler(d)(request())).status===503);}
});
Deno.test('document download rejects extra fields, unavailable storage and external URLs',async()=>{
 const d=deps();for(const body of [{id,url:'https://evil.invalid'},{id:'legacy:1'},{id:null}])assert((await createHandler(d)(request(body))).status===400);
 for(const url of ['https://evil.invalid/file','/object/sign/other/file?token=x','/object/sign/squad-documents/'+path+'?token=\\evil']){d.signDocument=async()=>url;assert((await createHandler(d)(request())).status===503);}
 d.signDocument=async()=>{throw new Error('private credential');};const r=await createHandler(d)(request());assert(r.status===503&&!JSON.stringify(await r.json()).includes('credential'));
});
