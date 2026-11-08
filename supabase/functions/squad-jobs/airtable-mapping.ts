/** Source-backed mappings; provider credentials, SQL identifiers and URLs are
 * never selected by a client. Capture preserves references until all tables exist. */
import contractsJson from './airtable-contracts.json' with {type:'json'};
export type AirtableBase='custom'|'ready_stock';
export interface AirtableContract {
 base:AirtableBase;table:string;fields:Record<string,string>;defaults?:Record<string,unknown>;
 transforms?:Record<string,string>;references?:Record<string,{resource:string;field:string}>;
 relations?:Record<string,{field:string;by:string}>;media?:Record<string,{field:string;variant:string}>;
 derived?:Record<string,string>;identity?:Record<string,unknown>;
}
export const airtableContracts=contractsJson as Record<string,AirtableContract>;
export class AirtableError extends Error {
 constructor(readonly code:string,readonly retryAfter?:number){super(code);}
}
export interface Attachment {id:string;url:string;filename:string;bytes:number;mime:string;variant:'original'|'large';}
export interface AirtableRecord {id:string;fields:Record<string,unknown>;}
export interface CapturedRecord {
 airtable_id:string;attributes:Record<string,unknown>;
 references:Record<string,{resource:string;airtable_id:string|null}>;
 relations:Record<string,string[]>;media:Record<string,Attachment|null>;
}
export const recordId=(value:unknown):value is string=>typeof value==='string'&&/^rec[A-Za-z0-9]{14}$/.test(value);
export function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AirtableError('AIRTABLE_INVALID_RECORD');
 return value as Record<string,unknown>;
}
export function contract(resource:string):AirtableContract {
 if(!Object.hasOwn(airtableContracts,resource))throw new AirtableError('AIRTABLE_INVALID_RESOURCE');
 return airtableContracts[resource];
}
export function attachmentUrl(value:unknown):string {
 if(typeof value!=='string'||value.length>8192)throw new AirtableError('AIRTABLE_INVALID_MEDIA');
 let u:URL;try{u=new URL(value);}catch{throw new AirtableError('AIRTABLE_INVALID_MEDIA');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
 !(u.hostname==='airtableusercontent.com'||u.hostname.endsWith('.airtableusercontent.com')))
 throw new AirtableError('AIRTABLE_INVALID_MEDIA');
 return value;
}
export function attachment(value:unknown,variant='original'):Attachment|null {
 if(value===undefined||value===null||Array.isArray(value)&&value.length===0)return null;
 if(!Array.isArray(value)||value.length>100)throw new AirtableError('AIRTABLE_INVALID_MEDIA');
 const first=object(value[0]);
 if(typeof first.id!=='string'||!/^att[A-Za-z0-9]{14}$/.test(first.id)||
 typeof first.filename!=='string'||first.filename.length>1024||
 !Number.isSafeInteger(first.size)||Number(first.size)<1||typeof first.type!=='string'||first.type.length>100)
 throw new AirtableError('AIRTABLE_INVALID_MEDIA');
 let url=first.url;
 if(variant==='large'){
  // Missing thumbnails are explicit null, as in the original class importer.
  if(!first.thumbnails||!object(first.thumbnails).large)return null;
  url=object(object(first.thumbnails).large).url;
 }else if(variant!=='original')throw new AirtableError('AIRTABLE_INVALID_MEDIA');
 return{id:first.id,url:attachmentUrl(url),filename:first.filename,bytes:Number(first.size),mime:first.type,variant};
}
function scalar(value:unknown):unknown {
 if(value===undefined)return null;
 if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw new AirtableError('AIRTABLE_INVALID_RECORD');
 if(typeof value==='string'&&(value.length>16384||value.includes('\0'))||typeof value==='number'&&!Number.isFinite(value))throw new AirtableError('AIRTABLE_INVALID_RECORD');
 return value;
}
function transform(value:unknown,kind?:string):unknown {
 if(!kind)return value;
 if(kind==='boolean')return ![null,false,0,'','0','f','F','false','FALSE','off','OFF'].includes(value as never);
 if(value===null)return null;
 if(typeof value!=='string')throw new AirtableError('AIRTABLE_INVALID_RECORD');
 if(kind==='trim')return value.trim();
 if(kind==='parameterize')return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
 if(kind==='fabric_type'){
  const values:Record<string,string>={'COTTON':'cotton','POLYESTER':'polyester','POLY COTTON':'poly_cotton'};
  if(!Object.hasOwn(values,value))throw new AirtableError('AIRTABLE_INVALID_RECORD');return values[value];
 }
 throw new AirtableError('AIRTABLE_INVALID_RECORD');
}
function links(value:unknown,by='airtable_id'):string[]{
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>1000||value.some(v=>typeof v!=='string'||(by==='airtable_id'?!recordId(v):!v.trim()||v.length>255||v.includes('\0'))))throw new AirtableError('AIRTABLE_INVALID_REFERENCE');
 if(new Set(value).size!==value.length)throw new AirtableError('AIRTABLE_INVALID_REFERENCE');
 return value;
}
export function normalizeAirtable(resource:string,value:unknown):CapturedRecord {
 const spec=contract(resource),row=object(value),fields=object(row.fields);
 if(!recordId(row.id))throw new AirtableError('AIRTABLE_INVALID_RECORD');
 const result:CapturedRecord={airtable_id:row.id,attributes:{},references:{},relations:{},media:{}};
 for(const [target,source] of Object.entries(spec.fields)){
  const raw=fields[source]??spec.defaults?.[target]??null;
  result.attributes[target]=transform(scalar(raw),spec.transforms?.[target]);
 }
 for(const [target,source] of Object.entries(spec.references??{})){
  const values=links(fields[source.field]);
  // The legacy importer selects the first record for singular references.
  result.references[target]={resource:source.resource,airtable_id:values[0]??null};
 }
 for(const [target,source] of Object.entries(spec.relations??{}))result.relations[target]=links(fields[source.field],source.by);
 for(const [target,source] of Object.entries(spec.media??{}))result.media[target]=attachment(fields[source.field],source.variant);
 // file_size is set after the thumbnail has actually been verified by the media
 // phase. Source metadata alone cannot establish the downloaded object's size.
 return result;
}
export function freshAttachment(resource:string,id:string,field:string,captured:Attachment,value:unknown):Attachment {
 const row=object(value),spec=contract(resource).media?.[field];
 if(row.id!==id||!spec)throw new AirtableError('AIRTABLE_MEDIA_CHANGED');
 const fresh=attachment(object(row.fields)[spec.field],spec.variant);
 if(!fresh||fresh.id!==captured.id||fresh.bytes!==captured.bytes||fresh.mime!==captured.mime||fresh.filename!==captured.filename||fresh.variant!==captured.variant)
 throw new AirtableError('AIRTABLE_MEDIA_CHANGED');
 return fresh;
}
