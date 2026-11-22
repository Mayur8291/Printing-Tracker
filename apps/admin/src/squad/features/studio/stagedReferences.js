import {validateMediaFile} from '../../components/mediaModel.js';
let generation=0;
const DB='scott-studio-private-files-v1',STORE='references',MAX_AGE=12*60*60*1000;
function database(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB){reject(Error('This browser cannot retain reference images safely.'));return;}const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore(STORE,{keyPath:'id'});store.createIndex('scope','scope');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Reference image storage could not be opened.'));});}
async function operation(mode,run){const db=await database();try{return await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,mode),store=transaction.objectStore(STORE);let result;const request=run(store);request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error??Error('Reference storage was interrupted.'));});}finally{db.close();}}
const descriptor=row=>({id:row.id,name:row.name,size:row.size,type:row.type,sha256:row.sha256});
export async function stageReference(scope,file){
 const started=generation;
 validateMediaFile(file,{resource:'products',field:'images'});
 if(!scope||!file?.size||file.size>10*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Choose a PNG, JPEG, WebP or GIF image up to 10 MB.');
 const bytes=await file.arrayBuffer(),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(started!==generation)throw Error('The account changed while preparing this image.');
 const row={id:crypto.randomUUID(),scope,name:file.name,type:file.type,size:file.size,sha256,blob:file,savedAt:Date.now()};await operation('readwrite',store=>store.put(row));if(started!==generation){await removeReference(scope,row.id);throw Error('The account changed while preparing this image.');}return descriptor(row);
}
export async function listReferences(scope){const rows=await operation('readonly',store=>store.index('scope').getAll(scope));const current=[];for(const row of rows){if(Date.now()-row.savedAt>MAX_AGE)await removeReference(scope,row.id);else current.push(descriptor(row));}return current;}
export async function readReference(scope,id){const row=await operation('readonly',store=>store.get(id));if(row?.scope!==scope||Date.now()-row.savedAt>MAX_AGE)throw Error('A staged reference image is no longer available. Choose it again before saving.');return new File([row.blob],row.name,{type:row.type});}
export async function removeReference(scope,id){const row=await operation('readonly',store=>store.get(id));if(row?.scope===scope)await operation('readwrite',store=>store.delete(id));}

export async function clearStudioPrivateStorage(){
 generation++;
 try{const keys=Object.keys(sessionStorage).filter(key=>key.startsWith('scott-studio-draft-v1:'));for(const key of keys)sessionStorage.removeItem(key);}catch{}
 if(globalThis.indexedDB)await operation('readwrite',store=>store.clear());
}
