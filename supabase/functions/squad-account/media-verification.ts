import {createHash} from 'node:crypto';
import {DOMParser} from 'npm:@xmldom/xmldom@0.9.12';
export class InvalidMedia extends Error {constructor(){super('INVALID_MEDIA');}}
const text=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const ascii=(b:Uint8Array,start=0,end=b.length)=>String.fromCharCode(...b.subarray(start,end));
const equal=(a:Uint8Array,b:number[])=>a.length>=b.length && b.every((v,i)=>a[i]===v);
const elements=new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask pattern'.split(' '));
const attributes=new Set('id xmlns xmlns:xlink version viewBox width height x y x1 y1 x2 y2 cx cy r rx ry dx dy d points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity transform gradientTransform gradientUnits spreadMethod offset stop-color stop-opacity clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform preserveAspectRatio font-family font-size font-weight font-style text-anchor dominant-baseline style'.split(' '));
const styles=new Set('fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity stop-color stop-opacity font-family font-size font-weight font-style text-anchor dominant-baseline'.split(' '));
function safeValue(value:string){
 if(/[\\@<>]|(?:javascript|data|https?|file)\s*:/i.test(value))throw new InvalidMedia();
 for(const match of value.matchAll(/url\s*\(([^)]*)\)/gi))if(!/^#[a-zA-Z_][\w:.-]*$/.test(match[1].trim()))throw new InvalidMedia();
 if(/url/i.test(value.replace(/url\s*\(#[a-zA-Z_][\w:.-]*\)/gi,'')))throw new InvalidMedia();
}
export function validateSvg(bytes:Uint8Array){
 let source:string;try{source=text(bytes);}catch{throw new InvalidMedia();}
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new InvalidMedia();
 let document;try{document=new DOMParser({onError:()=>{throw new InvalidMedia();}}).parseFromString(source,'image/svg+xml');}catch{throw new InvalidMedia();}
 if(document.documentElement?.localName!=='svg'||document.documentElement.namespaceURI!=='http://www.w3.org/2000/svg')throw new InvalidMedia();
 const queue=Array.from(document.childNodes).map(node=>({node,depth:0}));let count=0;
 while(queue.length){const {node,depth}=queue.pop()!;if(++count>10000||depth>64)throw new InvalidMedia();
  if(node.nodeType===1){const el=node as NonNullable<typeof document.documentElement>;
   if(!elements.has(el.localName??'')||el.namespaceURI!=='http://www.w3.org/2000/svg')throw new InvalidMedia();
   for(const attr of Array.from(el.attributes)){
    if(!attributes.has(attr.name)||attr.value.length>1048576)throw new InvalidMedia();
    if(attr.name==='xmlns'){if(attr.value!=='http://www.w3.org/2000/svg')throw new InvalidMedia();continue;}
    if(attr.name==='xmlns:xlink'){if(attr.value!=='http://www.w3.org/1999/xlink')throw new InvalidMedia();continue;}
    safeValue(attr.value);
    if(attr.name==='style')for(const part of attr.value.split(';').filter(s=>s.trim())){const colon=part.indexOf(':');if(colon<1||!styles.has(part.slice(0,colon).trim()))throw new InvalidMedia();safeValue(part.slice(colon+1));}
   }
  }else if(![3,4,8].includes(node.nodeType))throw new InvalidMedia();
  for(const child of Array.from(node.childNodes??[]))queue.push({node:child,depth:depth+1});
 }
}
/** Bounded streaming SHA256; only SVG (<=5MB) needs a complete parse buffer. */
export async function verifyMedia(body:ReadableStream<Uint8Array>,expectedBytes:number,mime:string):Promise<{sha256:string;bytes:number;content_type:string}>{
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>104857600)throw new InvalidMedia();
 const reader=body.getReader(),hash=createHash('sha256'),svg:Uint8Array[]=[];let bytes=0,head=new Uint8Array(0),tail=new Uint8Array(0);
 try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>expectedBytes)throw new InvalidMedia();hash.update(value);
   if(head.length<64){const n=Math.min(64-head.length,value.length),merged=new Uint8Array(head.length+n);merged.set(head);merged.set(value.subarray(0,n),head.length);head=merged;}
   const keep=value.subarray(Math.max(0,value.length-2048));const merged=new Uint8Array(Math.min(2048,tail.length+keep.length));const previous=Math.min(tail.length,merged.length-keep.length);if(previous>0)merged.set(tail.subarray(tail.length-previous));merged.set(keep,previous);tail=merged;
   if(mime==='image/svg+xml'){if(bytes>5242880)throw new InvalidMedia();svg.push(value.slice());}
  }}finally{await reader.cancel();reader.releaseLock();}
 if(bytes!==expectedBytes)throw new InvalidMedia();
 let valid=false;
 switch(mime){
  case'image/png':valid=bytes>=45&&equal(head,[137,80,78,71,13,10,26,10])&&ascii(head,12,16)==='IHDR'&&equal(tail.subarray(tail.length-12),[0,0,0,0,73,69,78,68,174,66,96,130]);break;
  case'image/jpeg':valid=bytes>=4&&equal(head,[255,216,255])&&equal(tail.subarray(tail.length-2),[255,217]);break;
  case'image/gif':valid=bytes>=14&&['GIF87a','GIF89a'].includes(ascii(head,0,6))&&tail[tail.length-1]===59;break;
  case'image/webp':valid=bytes>=20&&ascii(head,0,4)==='RIFF'&&ascii(head,8,12)==='WEBP'&&new DataView(head.buffer,head.byteOffset,head.byteLength).getUint32(4,true)+8===bytes;break;
  case'application/pdf':valid=bytes>=20&&/^%PDF-[12]\.[0-9]/.test(ascii(head,0,8))&&/%%EOF\s*$/.test(ascii(tail));break;
  case'video/mp4':valid=bytes>=24&&ascii(head,4,8)==='ftyp'&&/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(ascii(head,8,12));break;
  case'video/webm':valid=bytes>=32&&equal(head,[26,69,223,163])&&ascii(head).includes('webm');break;
  case'image/svg+xml':{const all=new Uint8Array(bytes);let i=0;for(const b of svg){all.set(b,i);i+=b.length;}validateSvg(all);valid=true;break;}
 }
 if(!valid)throw new InvalidMedia();return {sha256:hash.digest('hex'),bytes,content_type:mime};
}
