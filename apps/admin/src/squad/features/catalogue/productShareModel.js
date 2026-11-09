import {mediaReference,referenceKey,safeMediaUrl} from '../../components/mediaModel.js';

export const PRODUCT_SHARE_LIMIT=20;
const MAX_FILE=10*1024*1024, MAX_TOTAL=20*1024*1024;
const EXTENSIONS={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
export function productShareName(product,type) {
  const name=String(product.name||'Product').normalize('NFKC').replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g,'-').replace(/\.{2,}/g,'-').replace(/^\.+|\.+$/g,'').slice(0,70).trim()||'Product';
  return `${name}-${String(product.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24)}.${EXTENSIONS[type]||'bin'}`;
}
async function boundedBlob(response,type,signal,onBytes) {
  if(!response.ok||!response.body)throw new Error('The image could not be downloaded. Try preparing it again.');
  const declared=Number(response.headers.get('content-length'));if(declared>MAX_FILE)throw new Error('Image exceeds the 10 MB file limit.');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try {while(true){signal?.throwIfAborted();const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_FILE)throw new Error('Image exceeds the 10 MB file limit.');onBytes(next.value.byteLength);chunks.push(next.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(!bytes)throw new Error('This image is empty.');return new Blob(chunks,{type});
}
async function decodeRaster(blob) {
  const bitmap=await createImageBitmap(blob);
  try{if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40_000_000)throw new Error('Image exceeds the supported dimensions.');}finally{bitmap.close();}
}
/** Fresh scoped grants become verified local files, never persistent share URLs. */
export async function prepareProductFiles({products,sdk,origin,signal,onProgress=()=>{}}) {
  if(!products.length||products.length>PRODUCT_SHARE_LIMIT)throw new Error(`Select between 1 and ${PRODUCT_SHARE_LIMIT} products.`);
  if(new Set(products.map(p=>String(p.id))).size!==products.length)throw new Error('A product is selected more than once.');
  const refs=products.map(p=>mediaReference(p.images?.[0]));
  const granted=refs.some(Boolean)?await sdk.mediaGrants(refs.filter(Boolean),{download:true}):{references:[]};
  signal?.throwIfAborted();const grants=new Map(granted.references.map(g=>[referenceKey(g),g]));
  const files=[],entries=[],failures=[];let total=0;
  for(let i=0;i<products.length;i++){
    signal?.throwIfAborted();const product=products[i],grant=refs[i]&&grants.get(referenceKey(refs[i]));
    try{
      if(grant?.status!=='ready')throw new Error(grant?.status==='missing'?'Image is missing from this environment.':'First product image is unavailable.');
      const url=safeMediaUrl(grant.url,origin),type=grant.content_type;
      if(!url)throw new Error('Image is unavailable in this environment.');
      if(!Object.hasOwn(EXTENSIONS,type))throw new Error('Only PNG, JPEG, WebP and GIF images can be shared.');
      if(Number(grant.bytes)>MAX_FILE)throw new Error('Image exceeds the 10 MB file limit.');
      const response=await fetch(url,{signal,credentials:'omit',redirect:'error'});
      const blob=await boundedBlob(response,type,signal,bytes=>{total+=bytes;if(total>MAX_TOTAL)throw new Error('The selected images exceed 20 MB. Choose fewer products.');});
      await decodeRaster(blob);signal?.throwIfAborted();
      const file=new File([blob],productShareName(product,type),{type});files.push(file);entries.push({id:String(product.id),name:product.name||`Product #${product.id}`,filename:file.name,bytes:file.size});
    }catch(error){if(signal?.aborted)throw error;if(total>MAX_TOTAL)throw error;failures.push({id:String(product.id),name:product.name||`Product #${product.id}`,message:error.message?.startsWith('Image')||error.message?.startsWith('Only')||error.message?.startsWith('First')?error.message:'This image could not be prepared. Try again or select another product.'});}
    onProgress({completed:i+1,total:products.length});
  }
  return {files,entries,failures};
}
export async function productFilesZip(prepared) {
  if(!prepared.files.length)throw new Error('No available images to download.');
  const {default:JSZip}=await import('jszip');const zip=new JSZip();
  for(const file of prepared.files)zip.file(file.name,await file.arrayBuffer());
  zip.file('products.txt',prepared.entries.map(p=>`${p.name}\nProduct #${p.id}\nFile: ${p.filename}`).join('\n\n')+'\n');
  return zip.generateAsync({type:'blob',compression:'STORE'});
}
