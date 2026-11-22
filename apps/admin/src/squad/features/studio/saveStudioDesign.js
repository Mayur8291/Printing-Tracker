import {safeMediaUrl,referenceKey,MEDIA_LIMITS} from '../../components/mediaModel.js';

export const brandingSpec = value => Object.fromEntries(['type','side','width','height','unit','comment','print_area'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
export function presetBrandings(preset) {
  if (!preset?.reuse || preset.reuse.status!=='complete') return [];
  return preset.reuse.brandings.map(row=>({...row,product_id:preset.id}));
}
/** One instance per scoped editor. Uncertain retries retain every write key and
 * accepted receipt. Never mutate the source artwork when saving another design. */
export function createStudioDesignSaver({sdk,origin,isCurrent=()=>true,newKey=()=>crypto.randomUUID(),fetchFile=fetch,journalKey,storage,readStagedReference}) {
 const store=storage??(journalKey?globalThis.sessionStorage:null);
 const attempts=new Map();
 if(journalKey)try{const record=JSON.parse(store.getItem(journalKey));if(record?.v===1&&Date.now()-record.savedAt<12*60*60*1000)for(const [key,value] of record.attempts??[])attempts.set(key,value);}catch{/* New journal when unavailable. */}
 function persist(){if(!journalKey)return;const serialized=JSON.stringify({v:1,savedAt:Date.now(),attempts:[...attempts]},(key,value)=>key==='source'?undefined:value);try{store.setItem(journalKey,serialized);}catch{throw Error('Save recovery storage is unavailable. Free browser storage before saving.');}}

 const guard=()=>{if(!isCurrent())throw Error('Your account or customer context changed. Reopen this design.');};
 async function copyField(sourceId,targetId,field,step) {
  guard();
  if(step.done)return step.result;
  if(!step.source){
   const target={resource:'brandings',record_id:sourceId,field};
   const result=await sdk.mediaGrants([target]);guard();
   const grant=result.references.find(row=>referenceKey(row)===referenceKey(target));
   if(grant?.status==='empty'){if(step.sourceProof)throw Error('The source artwork was removed during save recovery.');step.done=true;persist();return null;}
   const url=grant?.status==='ready'&&safeMediaUrl(grant.url,origin);
   if(!url||!grant.version||!/^[a-f0-9]{64}$/.test(grant.sha256??''))throw Error(`The ${field.replaceAll('_',' ')} is unavailable. Restore it before saving a copy.`);
   if(step.sourceProof&&(step.sourceProof.sha256!==grant.sha256||step.sourceProof.version!==grant.version))throw Error('The source artwork changed during save recovery. Restore the original artwork before retrying.');
   const bytes=Number(grant.bytes),max=MEDIA_LIMITS[grant.content_type];
   if(!max||!Number.isSafeInteger(bytes)||bytes<1||bytes>max)throw Error('Artwork exceeds the supported file limit.');
   const response=await fetchFile(url,{credentials:'omit',redirect:'error'});guard();
   if(!response.ok)throw Error('Artwork download failed. Retry saving your design.');
   const buffer=await response.arrayBuffer();guard();
   if(buffer.byteLength!==bytes)throw Error('Artwork changed while it was being copied.');
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');guard();
   if(digest!==grant.sha256)throw Error('Artwork integrity check failed.');
   const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','application/pdf':'pdf'}[grant.content_type];
   // Opaque source attachments require their original verified extension.
   const filename=grant.filename??grant.original_filename??(ext?`${field}.${ext}`:null);
   if(!filename)throw Error('This attachment needs its original filename before it can be copied.');
   step.sourceProof={sha256:grant.sha256,version:grant.version};persist();
   step.source={blob:new Blob([buffer],{type:grant.content_type}),filename,mime:grant.content_type,bytes};
  }
  const target={resource:'brandings',record_id:targetId,field};
  if(!step.version){const result=await sdk.mediaGrants([target]);guard();step.version=result.references.find(row=>referenceKey(row)===referenceKey(target))?.version;if(!step.version)throw Error('New artwork is not writable.');}
  step.keys??={reserve:newKey(),verify:newKey(),finalize:newKey()};persist();
  const source=step.source,command=key=>({expectedVersion:step.version,idempotencyKey:key});
  const reservation=await sdk.reserveMediaUpload(target,{filename:source.filename,bytes:String(source.bytes),content_type:source.mime},command(step.keys.reserve));guard();
  if(reservation.state==='reserved'){
   const url=safeMediaUrl(reservation.upload_url,origin,true);if(!url)throw Error('Artwork upload location is invalid.');
   const response=await fetchFile(url,{method:'PUT',body:source.blob,headers:{'Content-Type':source.mime},credentials:'omit',redirect:'error'});guard();
   if(!response.ok&&![400,409].includes(response.status))throw Error('Artwork upload was interrupted. Retry saving.');
  }else if(!['verified','attached'].includes(reservation.state))throw Error('Artwork upload has expired.');
  await sdk.verifyMediaUpload(reservation.upload_id,command(step.keys.verify));guard();
  step.result=await sdk.finalizeMediaUpload(reservation.upload_id,command(step.keys.finalize));guard();step.done=true;step.source=null;persist();
  return step.result;
 }
 async function uploadReference(productId,reference,step){
  guard();if(step.done)return step.result;
  if(!readStagedReference)throw Error('Reference recovery is not available.');
  const file=await readStagedReference(reference.id);guard();
  const bytes=await file.arrayBuffer(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');guard();
  if(sha!==reference.sha256||file.size!==reference.size||file.type!==reference.type)throw Error('A reference image changed. Restore the original file before retrying this save.');
  const target={resource:'products',record_id:productId,field:'images'};
  if(!step.version){const grants=await sdk.mediaGrants([target]);guard();step.version=grants.references.find(row=>referenceKey(row)===referenceKey(target))?.version;if(!step.version)throw Error('Reference images cannot be attached to this product.');}
  step.keys??={reserve:newKey(),verify:newKey(),finalize:newKey()};persist();
  const command=key=>({expectedVersion:step.version,idempotencyKey:key});
  const reservation=await sdk.reserveMediaUpload(target,{filename:reference.name,bytes:String(file.size),content_type:file.type},command(step.keys.reserve));guard();
  if(reservation.state==='reserved'){
   const url=safeMediaUrl(reservation.upload_url,origin,true);if(!url)throw Error('Reference upload location is invalid.');
   const response=await fetchFile(url,{method:'PUT',body:file,headers:{'Content-Type':file.type},credentials:'omit',redirect:'error'});guard();
   if(!response.ok&&![400,409].includes(response.status))throw Error('Reference upload was interrupted. Retry saving.');
  }else if(!['verified','attached'].includes(reservation.state))throw Error('Reference upload expired.');
  await sdk.verifyMediaUpload(reservation.upload_id,command(step.keys.verify));guard();
  step.result=await sdk.finalizeMediaUpload(reservation.upload_id,command(step.keys.finalize));guard();step.done=true;persist();return step.result;
 }
 return {
  async save({configuration,name,comment='',brandings=[],references=[]},idempotencyKey){
   guard();if(!idempotencyKey)throw Error('A save command key is required.');
   if(brandings.length>20)throw Error('At most 20 artwork placements can be saved.');
   if(references.length>12)throw Error('At most 12 reference images can be saved.');
   const fingerprint=JSON.stringify({configuration,name,comment,brandings,references});
   const unresolved=[...attempts].find(([key,value])=>!key.startsWith('fork:')&&value.started&&!value.complete&&value.fingerprint!==fingerprint);
   if(unresolved)throw Error('Resume the interrupted design save before saving another version.');
   const recovery=[...attempts].find(([key,value])=>!key.startsWith('fork:')&&!value.complete&&value.fingerprint===fingerprint);
   if(!attempts.has(idempotencyKey)&&recovery)idempotencyKey=recovery[0];
   let attempt=attempts.get(idempotencyKey);
   if(attempt&&attempt.fingerprint!==fingerprint)throw Error('Retry the original save before changing this design.');
   if(!attempt){attempt={fingerprint,product:null,references:{},steps:brandings.map(()=>({key:newKey(),receipt:null,files:{}}))};attempts.set(idempotencyKey,attempt);persist();}
   if(!attempt.product){
    // The backend only exposes a reusable design when each placement has an image.
    // Check this before creating any product to avoid an unreopenable partial save.
    for(const row of brandings){
     if(!row.design_id)throw Error('Add and upload an image for every artwork placement before saving. Return to Artwork to finish it, or remove the placement.');
     const target={resource:'brandings',record_id:row.design_id,field:'image'};
     const response=await sdk.mediaGrants([target]);guard();
     const image=response.references.find(ref=>referenceKey(ref)===referenceKey(target));
     if(image?.status!=='ready'||!safeMediaUrl(image.url,origin))throw Error('An artwork image is not ready. Return to Artwork and finish its upload before saving.');
    }
    for(const reference of references){if(!readStagedReference)throw Error('Reference recovery is unavailable.');await readStagedReference(reference.id);guard();}
    attempt.started=true;persist();
    attempt.product=await sdk.createCustomProduct(configuration,name,comment,idempotencyKey);guard();if(!attempt.product?.id)throw Error('Design save was not confirmed.');persist();}
   const saved=[];
   for(let index=0;index<brandings.length;index++){
    guard();const row=brandings[index],step=attempt.steps[index];
    if(!step.receipt){step.receipt=await sdk.saveBranding({productId:attempt.product.id,spec:brandingSpec(row)},{expectedVersion:null,idempotencyKey:step.key});guard();persist();}
    let version=step.receipt.version;
    if(row.design_id)for(const field of ['image','mockup_image','attachment']){const result=await copyField(row.design_id,step.receipt.id,field,step.files[field]??={});if(result?.entity_version)version=result.entity_version;}
    saved.push({...brandingSpec(row),design_id:step.receipt.id,design_version:version,product_id:attempt.product.id});
   }
   attempt.references??={};for(const reference of references)await uploadReference(attempt.product.id,reference,attempt.references[reference.id]??={});
   attempt.complete=true;persist();return {...attempt.product,brandings:saved};
  },
  async forkArtwork(row,idempotencyKey){
   guard();const fingerprint=JSON.stringify(row),key=`fork:${idempotencyKey}`;
   let step=attempts.get(key);
   if(step&&step.fingerprint!==fingerprint)throw Error('Retry the original artwork copy first.');
   if(!step){step={fingerprint,receipt:null,files:{}};attempts.set(key,step);persist();}
   if(!step.receipt){step.receipt=await sdk.saveBranding({spec:brandingSpec(row)},{expectedVersion:null,idempotencyKey});guard();persist();}
   let version=step.receipt.version;
   for(const field of ['image','mockup_image','attachment']){const result=await copyField(row.design_id,step.receipt.id,field,step.files[field]??={});if(result?.entity_version)version=result.entity_version;}
   return {...brandingSpec(row),design_id:step.receipt.id,design_version:version,product_id:null};
  },
  pending(){const found=[...attempts].find(([key,value])=>!key.startsWith('fork:')&&value.started&&!value.complete);if(!found)return null;try{return {key:found[0],...JSON.parse(found[1].fingerprint)};}catch{return null;}},
  clear(){attempts.clear();if(journalKey)store.removeItem(journalKey);},
 };
}
