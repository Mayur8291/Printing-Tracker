/** Bounded transfer execution; authority and checkpoints stay in leased SQL transactions. */
import type {Rpc} from './handler.ts';
import {parseCsvRange,csvHeaders,csvObjects,encodeCsvRows,CSV_RANGE_BYTES,CsvError} from './transfers-csv.ts';
const MAX_BYTES=10*1024*1024;
export class TransferError extends Error {constructor(readonly code:'CSV_INVALID'|'STORAGE_UNAVAILABLE'|'TRANSFER_LIMIT'|'EXPORT_FAILED'){super(code);}}
type Job={id:string;lease_token:string};type Result={id:string;state:string;error_code?:string};
export interface TransferPart {path:string;bytes:number;sha256:string;}
interface Prepared {state:string;error_code?:string;kind:'validate'|'apply'|'export';transfer_id:string;generation:string;bucket:string;path:string;bytes:number|string;byte_offset:number;row_offset:number;headers:string[];phase?:'part'|'merge';columns?:string[];rows?:Record<string,unknown>[];part_number?:number;parts?:TransferPart[];}
export interface TransferStorage {range(path:string,start:number,total:number,signal?:AbortSignal):Promise<Uint8Array>;read(part:TransferPart,signal?:AbortSignal):Promise<Uint8Array>;put(path:string,bytes:Uint8Array,sha256:string,signal?:AbortSignal):Promise<void>;}
export const TRANSFER_WORK_MS=35000;
export const transferDigest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),x=>x.toString(16).padStart(2,'0')).join('');
export function validTransferPath(path:string){return /^g[0-9]+\/[a-f0-9-]{36}\/(export|part-[0-9]{4})\.csv$/.test(path);}
export async function readTransferBody(response:Response,expected:number){
 if(!response.ok||!response.body||!Number.isSafeInteger(expected)||expected<1||expected>MAX_BYTES){await response.body?.cancel();throw new TransferError('STORAGE_UNAVAILABLE');}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>expected)throw new TransferError('STORAGE_UNAVAILABLE');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
 if(size!==expected)throw new TransferError('STORAGE_UNAVAILABLE');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function transferStorage(url:string,key:string,request:typeof fetch=fetch):TransferStorage {
 const headers={apikey:key,Authorization:`Bearer ${key}`};
 const boundedSignal=(milliseconds:number,outer?:AbortSignal)=>outer?AbortSignal.any([outer,AbortSignal.timeout(milliseconds)]):AbortSignal.timeout(milliseconds);
 async function read(part:TransferPart,signal?:AbortSignal){
  if(!validTransferPath(part.path)||!/^([a-f0-9]{64})$/.test(part.sha256))throw new TransferError('EXPORT_FAILED');
  const r=await request(url+'/storage/v1/object/authenticated/squad-transfers/'+part.path,{headers,signal:boundedSignal(15000,signal),redirect:'error'});
  const bytes=await readTransferBody(r,part.bytes);if(await transferDigest(bytes)!==part.sha256)throw new TransferError('STORAGE_UNAVAILABLE');return bytes;
 }
 return {read,
  async range(path,start,total,signal){
   if(!/^inputs\/[a-f0-9-]{36}\/file\.csv$/.test(path)||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(total)||total<1||total>MAX_BYTES||start>=total)throw new TransferError('CSV_INVALID');
   const end=Math.min(total-1,start+CSV_RANGE_BYTES-1),r=await request(url+'/storage/v1/object/authenticated/squad-transfers/'+path,{headers:{...headers,Range:`bytes=${start}-${end}`},signal:boundedSignal(15000,signal),redirect:'error'});
   // Accept 200 only when the requested range is the entire file. Never read a
   // full multi-megabyte object for every checkpoint if a proxy ignores Range.
   if(!(r.status===206&&r.headers.get('content-range')===`bytes ${start}-${end}/${total}`)&&!(r.status===200&&start===0&&end===total-1)){await r.body?.cancel();throw new TransferError('STORAGE_UNAVAILABLE');}
   return await readTransferBody(r,end-start+1);
  },
  async put(path,bytes,sha256,signal){
   if(!validTransferPath(path)||bytes.length<1||bytes.length>MAX_BYTES||await transferDigest(bytes)!==sha256)throw new TransferError('TRANSFER_LIMIT');
   const r=await request(url+'/storage/v1/object/squad-transfers/'+path,{method:'POST',headers:{...headers,'Content-Type':'text/csv','x-upsert':'false'},body:bytes as Uint8Array<ArrayBuffer>,signal:boundedSignal(20000,signal),redirect:'error'});
   if(r.ok){await r.body?.cancel();return;}const error=await r.json().catch(()=>({}));
   if(!['409','Duplicate','ResourceAlreadyExists'].includes(String(error.statusCode??error.error??error.code)))throw new TransferError('STORAGE_UNAVAILABLE');
   await read({path,bytes:bytes.length,sha256},signal);
  },
 };
}
export function transferWorker(rpc:Rpc,storage:TransferStorage,workMs=TRANSFER_WORK_MS){return async(job:Job):Promise<Result>=>{
 const args={p_id:job.id,p_lease_token:job.lease_token};
 const call=(action:string,input:Record<string,unknown>={})=>rpc('squad_transfer_work',{...args,p_action:action,p_input:input});
 const prepared=await call('input') as Prepared;
 if(prepared.state!=='ready')return{id:job.id,state:prepared.state,...(prepared.error_code?{error_code:prepared.error_code}:{})};
 // DB mutations are deliberately outside the work-error catch. An uncertain
 // response must be recovered from its checkpoint, never overwritten by fail.
 let action:string,input:Record<string,unknown>;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(workMs)]);
 try{
  if(prepared.kind==='apply'){action='apply';input={};}
  else if(prepared.kind==='validate'){
   const total=Number(prepared.bytes),offset=Number(prepared.byte_offset);
   if(prepared.bucket!=='squad-transfers'||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(prepared.row_offset)||prepared.row_offset<0)throw new TransferError('CSV_INVALID');
   const bytes=await storage.range(prepared.path,offset,total,signal),chunk=parseCsvRange(bytes,offset+bytes.length===total,offset===0,100);
   if(chunk.consumed<1)throw new TransferError('CSV_INVALID');
   const headers=offset===0?csvHeaders(chunk.rows.shift()??[]):prepared.headers;
   if(!Array.isArray(headers)||!headers.length||headers.length>100)throw new TransferError('CSV_INVALID');
   action='validate';input={byte_offset:offset,next_byte_offset:offset+chunk.consumed,headers,rows:csvObjects(headers,chunk.rows,prepared.row_offset+1),eof:chunk.done};
  }else if(prepared.kind==='export'){
   if(prepared.bucket!=='squad-transfers'||!validTransferPath(prepared.path)||!prepared.path.startsWith(`g${prepared.generation}/${prepared.transfer_id}/`))throw new TransferError('EXPORT_FAILED');
   let bytes:Uint8Array;
   if(prepared.phase==='part'){
    if(!Number.isInteger(prepared.part_number)||prepared.part_number!<0||prepared.part_number!>200||!Array.isArray(prepared.columns)||!prepared.columns.length||prepared.columns.length>100||!Array.isArray(prepared.rows)||prepared.rows.length>100)throw new TransferError('TRANSFER_LIMIT');
    const rows=prepared.rows.map(row=>prepared.columns!.map(c=>row[c]));if(prepared.part_number===0)rows.unshift(prepared.columns);
    bytes=encodeCsvRows(rows);action='checkpoint';input={part_number:prepared.part_number,path:prepared.path};
   }else if(prepared.phase==='merge'){
    const parts=prepared.parts;if(!Array.isArray(parts)||!parts.length||parts.length>200||parts.some((p,i)=>p.path!==`g${prepared.generation}/${prepared.transfer_id}/part-${String(i).padStart(4,'0')}.csv`||!Number.isSafeInteger(p.bytes)||p.bytes<1)||parts.reduce((n,p)=>n+p.bytes,0)>MAX_BYTES)throw new TransferError('TRANSFER_LIMIT');
    const chunks:Uint8Array[]=[];let size=0;for(let i=0;i<parts.length;i+=4){signal.throwIfAborted();const group=await Promise.all(parts.slice(i,i+4).map(part=>storage.read(part,signal)));for(const chunk of group){chunks.push(chunk);size+=chunk.length;}}
    bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}action='complete';input={};
   }else throw new TransferError('EXPORT_FAILED');
   const sha256=await transferDigest(bytes);signal.throwIfAborted();await storage.put(prepared.path,bytes,sha256,signal);input={...input,bytes:bytes.length,sha256};
  }else throw new TransferError('EXPORT_FAILED');
 }catch(error){
  const code=error instanceof TransferError?error.code:error instanceof CsvError?(['CSV_LIMIT','RECORD_TOO_LONG','FIELD_TOO_LONG','TOO_MANY_COLUMNS'].includes(error.code)?'TRANSFER_LIMIT':'CSV_INVALID'):'STORAGE_UNAVAILABLE';
  controller.abort();return await call('fail',{code}) as Result;
 }finally{controller.abort();}
 return await call(action,input) as Result;
};}
