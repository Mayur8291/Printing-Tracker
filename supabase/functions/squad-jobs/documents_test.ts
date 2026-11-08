import {PDFDocument,PDFName,PDFDict} from 'npm:pdf-lib@1.17.1';
import {renderDocument,DocumentError,validateAsset,type Snapshot} from './documents-render.ts';
import {documentWorker,documentStorage,mergeDocument,digest,type DocumentStorage} from './documents.ts';
import {documentFonts} from './fonts/embedded.ts';
const assert=(value:unknown,message='assertion failed')=>{if(!value)throw new Error(message);};
const base:Snapshot={kind:'catalogue',document_id:'11111111-1111-4111-8111-111111111111',captured_at:'2026-11-08T06:00:00Z',template_version:'squad-documents-v1',rows:[{name:'Cotton shirt / नमस्ते',brand:'Sample',category:'Shirts',color:'Blue',display_price:'125.50',mrp:'200.00',variants:[{size:'M'}]}],presentation:{company_name:'Sample',terms:'Synthetic terms. '.repeat(100)}};
const deps={fonts:documentFonts(),asset:async()=>new Uint8Array()};
const path='g0/11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111/document.pdf';
const job={id:'11111111-1111-4111-8111-111111111111',lease_token:'22222222-2222-4222-8222-222222222222'};
Deno.test('PDF opens, contains embedded Unicode fonts, and output is deterministic',async()=>{
 const first=await renderDocument(base,deps),second=await renderDocument(base,deps);assert(await digest(first.bytes)===await digest(second.bytes));
 const pdf=await PDFDocument.load(first.bytes);assert(pdf.getPageCount()===first.pages);assert(pdf.getTitle()==='Product catalogue');
 const fonts=pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'),PDFDict);assert(fonts.keys().length>=2);
});
Deno.test('renderer rejects unsupported glyphs without silently corrupting names',async()=>{
 try{await renderDocument({...base,presentation:{company_name:'Unsupported 🦋'}},deps);throw new Error('accepted');}catch(e){assert(e instanceof DocumentError&&e.code==='UNSUPPORTED_MEDIA');}
});
Deno.test('renderer bounds rows and input image inflation before decoding',async()=>{
 try{await renderDocument({...base,rows:Array(2001).fill({})},deps);throw new Error('accepted');}catch(e){assert(e instanceof DocumentError&&e.code==='RENDER_LIMIT');}
 const bytes=new Uint8Array(24);const view=new DataView(bytes.buffer);view.setUint32(16,100000);view.setUint32(20,100000);
 const image={bucket:'canto-media',path:'sha256/aa/'+'a'.repeat(64),bytes:24,content_type:'image/png'};
 try{await renderDocument({...base,rows:[{...base.rows[0],image}]},{...deps,asset:async()=>bytes});throw new Error('accepted');}catch(e){assert(e instanceof DocumentError&&e.code==='RENDER_LIMIT');}
});
Deno.test('media paths cannot be arbitrary URLs, traversal or a mismatched digest shard',()=>{
 for(const p of ['https://example.com/x','../secret','sha256/bb/'+'a'.repeat(64)]){
  try{validateAsset({bucket:'canto-media',path:p,bytes:100,content_type:'image/jpeg'});throw new Error('accepted');}catch(e){assert(e instanceof DocumentError);}
 }
});
Deno.test('large documents merge into one PDF with every page retained',async()=>{
 const chunk=await renderDocument({...base,rows:Array(12).fill(base.rows[0])},deps);const sha256=await digest(chunk.bytes);
 const parts=Array.from({length:3},(_,i)=>({path:'part-'+i,bytes:chunk.bytes.length,sha256,pages:chunk.pages}));
 const storage:DocumentStorage={asset:deps.asset,put:async()=>{},part:async()=>chunk.bytes};const result=await mergeDocument(base,parts,storage);assert(result.pages===3*chunk.pages);assert((await PDFDocument.load(result.bytes)).getPageCount()===result.pages);
});
Deno.test('terms remain embedded after assembly',async()=>{
 const bytes=new TextEncoder().encode('Synthetic terms'),a={bucket:'canto-media',path:'sha256/aa/'+'a'.repeat(64),bytes:bytes.length,content_type:'text/plain'};
 const chunk=await renderDocument(base,deps);const parts=Array.from({length:2},()=>({path:'part',bytes:chunk.bytes.length,sha256:'a'.repeat(64),pages:chunk.pages}));
 const result=await mergeDocument({...base,terms_attachment:a},parts,{asset:async()=>bytes,part:async()=>chunk.bytes,put:async()=>{}});
 const doc=await PDFDocument.load(result.bytes);assert(doc.catalog.lookup(PDFName.of('Names'),PDFDict).has(PDFName.of('EmbeddedFiles')));
});
Deno.test('worker records exact output, then finishes once',async()=>{
 const calls:string[]=[];let output=0;const storage:DocumentStorage={asset:deps.asset,part:async()=>new Uint8Array(),put:async(p,bytes,sha)=>{assert(p===path);assert(await digest(bytes)===sha);output=bytes.length;}};
 const worker=documentWorker(async(name,args)=>{calls.push(name);if(name==='squad_document_prepare')return{...job,state:'prepared',phase:'single',document_id:base.document_id,object_path:path,snapshot:base};const result=args.p_result as Record<string,unknown>;assert(result.code==='READY'&&result.bytes===output);return{id:job.id,state:'done'};},storage);
 assert((await worker(job)).state==='done');assert(calls.join(',')==='squad_document_prepare,squad_document_finish');
});
Deno.test('worker checkpoints each part instead of marking the whole document ready',async()=>{
 let code='';const worker=documentWorker(async(name,args)=>name==='squad_document_prepare'?{...job,state:'prepared',phase:'part',part_index:0,document_id:base.document_id,object_path:path.replace('document.pdf','part-0000.pdf'),snapshot:base}:(code=String((args.p_result as Record<string,unknown>).code),{id:job.id,state:'pending'}),{asset:deps.asset,part:async()=>new Uint8Array(),put:async()=>{}});
 assert((await worker(job)).state==='pending'&&code==='PART_READY');
});
Deno.test('unconfirmed finish is not followed by another finish',async()=>{
 let finishes=0;const worker=documentWorker(async(name)=>{if(name==='squad_document_prepare')return{...job,state:'prepared',phase:'single',document_id:base.document_id,object_path:path,snapshot:base};finishes++;throw new Error('network');},{asset:deps.asset,part:async()=>new Uint8Array(),put:async()=>{}});
 try{await worker(job);throw new Error('accepted');}catch{assert(finishes===1);}
});
Deno.test('storage conflict verifies immutable prior bytes instead of overwriting',async()=>{
 const bytes=new TextEncoder().encode('synthetic pdf');let calls=0;const storage=documentStorage('https://scvojtvgnkmbupvyslmb.supabase.co','not-real',async(_url,init)=>{calls++;if(init?.method==='POST'){assert(new Headers(init.headers).get('x-upsert')==='false');return new Response(JSON.stringify({statusCode:'409'}),{status:409});}return new Response(bytes);});
 await storage.put(path,bytes,await digest(bytes));assert(calls===2);
});
Deno.test('storage rejects bytes that differ from the immutable inventory hash',async()=>{
 const storage=documentStorage('https://scvojtvgnkmbupvyslmb.supabase.co','not-real',async()=>new Response(new Uint8Array([1,2,3])));
 try{await storage.asset({bucket:'canto-media',path:'sha256/aa/'+'a'.repeat(64),bytes:3,content_type:'image/png'});throw new Error('accepted');}catch(e){assert(e instanceof DocumentError&&e.code==='STORAGE_UNAVAILABLE');}
});
Deno.test('network and interrupted body failures remain retryable',async()=>{
 for(const request of [async()=>{throw new Error('network');},async()=>new Response(new ReadableStream({start(c){c.error(new Error('interrupted'));}}))]){
  const storage=documentStorage('https://example.invalid','not-real',request);
  try{await storage.part({path,bytes:100,sha256:'a'.repeat(64),pages:1});throw new Error('accepted');}catch(e){assert(e instanceof DocumentError&&e.code==='STORAGE_UNAVAILABLE');}
 }
});
