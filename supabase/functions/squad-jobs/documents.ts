import {PDFDocument,StandardFonts,rgb} from 'npm:pdf-lib@1.17.1';
import type {Rpc} from './handler.ts';
import {DocumentError,renderDocument,validateAsset,type Asset,type Snapshot} from './documents-render.ts';
import {documentFonts} from './fonts/embedded.ts';
type Job={id:string;lease_token:string};
interface Part {path:string;bytes:number;sha256:string;pages:number;}
interface Prepared {id:string;state:string;error_code?:string;phase:'single'|'part'|'merge';document_id:string;object_path:string;part_index?:number;snapshot:Snapshot;parts?:Part[];}
export interface DocumentStorage {asset(a:Asset):Promise<Uint8Array>;part(p:Part):Promise<Uint8Array>;put(path:string,bytes:Uint8Array,sha256:string):Promise<void>;}
export const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),x=>x.toString(16).padStart(2,'0')).join('');
export function validDocumentPath(path:string){return /^g[0-9]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/(document|part-[0-9]{4})\.pdf$/.test(path);}
export async function mergeDocument(snapshot:Snapshot,parts:Part[],storage:DocumentStorage){
 if(!Array.isArray(parts)||parts.length<2||parts.length>200||parts.reduce((n,p)=>n+p.bytes,0)>48*1024*1024||parts.reduce((n,p)=>n+p.pages,0)>5000)throw new DocumentError('RENDER_LIMIT');
 const doc=await PDFDocument.create();doc.setTitle({catalogue:'Product catalogue',tailor_weekly:'Weekly work and payment report',delivery_challan:'Delivery challan'}[snapshot.kind]);doc.setCreationDate(new Date(snapshot.captured_at));doc.setModificationDate(new Date(snapshot.captured_at));doc.setProducer('Squad One documents v1');
 for(const part of parts){
  const bytes=await storage.part(part);const input=await PDFDocument.load(bytes,{updateMetadata:false});
  if(input.getPageCount()!==part.pages)throw new DocumentError('RENDER_FAILED');
  const pages=await doc.copyPages(input,input.getPageIndices());for(const page of pages)doc.addPage(page);
 }
 const font=await doc.embedFont(StandardFonts.Helvetica);const pages=doc.getPages();
 pages.forEach((page,i)=>{page.drawRectangle({x:490,y:17,width:70,height:18,color:rgb(1,1,1)});page.drawText(`${i+1} / ${pages.length}`,{x:500,y:24,size:8,font,color:rgb(.36,.4,.46)});});
 if(snapshot.terms_attachment){const a=validateAsset(snapshot.terms_attachment);const bytes=await storage.asset(a);const ext={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','text/plain':'txt'}[a.content_type]!;await doc.attach(bytes,'terms.'+ext,{mimeType:a.content_type,creationDate:new Date(snapshot.captured_at),modificationDate:new Date(snapshot.captured_at)});}
 const bytes=await doc.save({objectsPerTick:100});if(bytes.length>64*1024*1024)throw new DocumentError('RENDER_LIMIT');return{bytes,pages:pages.length};
}
export function documentWorker(rpc:Rpc,storage:DocumentStorage){
 return async(job:Job)=>{
  const args={p_id:job.id,p_lease_token:job.lease_token};const ready=await rpc('squad_document_prepare',args) as Prepared;
  if(ready.state!=='prepared')return{id:job.id,state:ready.state,...(ready.error_code?{error_code:ready.error_code}:{})};
  if(!validDocumentPath(ready.object_path)||!ready.object_path.includes('/'+ready.document_id+'/'))throw new Error('invalid_document_contract');
  let result:Record<string,unknown>;
  try{
   const output=ready.phase==='merge'?await mergeDocument(ready.snapshot,ready.parts!,storage):await renderDocument(ready.snapshot,{fonts:documentFonts(),asset:storage.asset});
   const sha256=await digest(output.bytes);await storage.put(ready.object_path,output.bytes,sha256);
   result={code:ready.phase==='part'?'PART_READY':'READY',sha256,bytes:output.bytes.length,pages:output.pages,...(ready.phase==='part'?{part_index:ready.part_index}:{})};
  }catch(error){result={code:error instanceof DocumentError?error.code:'RENDER_FAILED'};}
  // A failed/unconfirmed finish is never converted to a second error finish.
  return await rpc('squad_document_finish',{...args,p_result:result}) as {id:string;state:string;error_code?:string};
 };
}
export function documentStorage(url:string,key:string,request:typeof fetch=fetch):DocumentStorage {
 const headers={apikey:key,Authorization:`Bearer ${key}`};
 async function read(bucket:string,path:string,bytes:number,hash?:string){
  try{
  const r=await request(url+'/storage/v1/object/authenticated/'+bucket+'/'+path,{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok||!r.body){await r.body?.cancel();throw new DocumentError('STORAGE_UNAVAILABLE');}
  const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>bytes||size>64*1024*1024)throw new DocumentError('STORAGE_UNAVAILABLE');chunks.push(part.value);}}finally{await reader.cancel();}
  if(size!==bytes)throw new DocumentError('STORAGE_UNAVAILABLE');const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  if(hash&&await digest(result)!==hash)throw new DocumentError('STORAGE_UNAVAILABLE');return result;
  }catch{throw new DocumentError('STORAGE_UNAVAILABLE');}
 }
 return{
  asset:async(a)=>{validateAsset(a);return await read('canto-media',a.path,a.bytes,a.path.slice(-64));},
  part:async(p)=>{if(!validDocumentPath(p.path)||!/^([a-f0-9]{64})$/.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<10||p.bytes>64*1024*1024)throw new DocumentError('RENDER_FAILED');return await read('squad-documents',p.path,p.bytes,p.sha256);},
  async put(path,bytes,sha256){
   if(!validDocumentPath(path)||bytes.length>64*1024*1024)throw new DocumentError('RENDER_LIMIT');
   let r:Response;try{r=await request(url+'/storage/v1/object/squad-documents/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes as Uint8Array<ArrayBuffer>,signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw new DocumentError('STORAGE_UNAVAILABLE');}
   if(r.ok){await r.body?.cancel();return;}
   const error=await r.json().catch(()=>({}));if(!['409','Duplicate','ResourceAlreadyExists'].includes(String(error.statusCode??error.error??error.code)))throw new DocumentError('STORAGE_UNAVAILABLE');
   await read('squad-documents',path,bytes.length,sha256);
  },
 };
}
