/** Stage and verify files first; publish the form and every file in one RPC.
 * Retain command identities across an uncertain response or page reload. */
export function preparePrivateMasterForm(config, form, previous) {
  const next = {...form}, current = {...previous};
  // Legacy payload builders re-download displayed URLs. Only explicitly changed
  // URLs are fetched later by the Supabase adapter; uploaded File objects survive.
  for (const field of config.fields || []) {
    if (field.type === 'image') {
      delete next[field.key];
      delete current[field.key];
    }
    if (field.type === 'image-slots' && next[field.key]) {
      next[field.key] = Object.fromEntries(Object.entries(next[field.key]).filter(([,value])=>typeof value !== 'string'));
    }
  }
  for (const slot of config.imageSlots || []) { delete next[slot]; delete current[slot]; }
  return {form:next, previous:current};
}

export function sameMasterImage(value, previous) {
  if (value === previous) return true;
  try {
    const a = new URL(value), b = new URL(previous);
    return /^https:\/\/(scvojtvgnkmbupvyslmb|levwrmvqdntngeasrtnb)\.supabase\.co$/.test(a.origin)
      && a.origin === b.origin && a.pathname === b.pathname
      && a.pathname.startsWith('/storage/v1/object/sign/canto-media/');
  } catch { return false; }
}

export function createAtomicMasterWriter({client,sdk,rpc,resource,environment,storage=globalThis.sessionStorage,transport=fetch}) {
  const active = new Map(), memory = new Map();
  async function save(action,id,payload,relations,expectedUpdatedAt) {
    const input = JSON.stringify({action,id,payload,relations,expectedUpdatedAt});
    if(active.has(input))return active.get(input);
    const task=(async()=>{
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(x=>x.toString(16).padStart(2,'0')).join('');
      return perform(fingerprint,action,id,payload,relations,expectedUpdatedAt);
    })();
    active.set(input,task);
    try{return await task;}finally{active.delete(input);}
  }
  async function perform(fingerprint,action,id,payload,relations,expectedUpdatedAt) {
    const {data:{session}}=await client.auth.getSession();if(!session)throw new Error('Your dashboard session has expired. Please sign in again.');
    const storageKey=`canto:master-save:${environment}:${resource}:${session.user.id}:${fingerprint}`;
    let pending;try{pending=JSON.parse(storage?.getItem(storageKey)||'null');}catch{pending=null;}
    pending ||= memory.get(storageKey);
    pending ||= {key:crypto.randomUUID(),files:{}};
    const remember=()=>{memory.set(storageKey,pending);try{storage?.setItem(storageKey,JSON.stringify(pending));}catch{/* Server idempotency still protects in-session retries. */}};
    remember();const values={},ids=[];
    for(const [field,value] of Object.entries(payload)) {
      if(value===undefined)continue;
      if(!value?.__base64File){values[field]=value;continue;}
      const raw=atob(value.data);if(raw.length>8*1024*1024)throw new Error('Images must be smaller than 8 MB.');
      const filename=String(value.filename||'image.png');const extension=filename.split('.').at(-1).toLowerCase();
      const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',pdf:'application/pdf'}[extension];
      if(!mime)throw new Error('Choose a supported image, SVG, or PDF file.');
      const target={resource,record_id:id==null?null:String(id),field};
      let file=pending.files[field];
      if(!file){const version=id==null?'new':(await sdk.mediaGrants([target])).references[0].version;file=pending.files[field]={key:crypto.randomUUID(),verifyKey:crypto.randomUUID(),version};remember();}
      if(!file.verified){
        const upload=await sdk.reserveMediaUpload(target,{filename,bytes:String(raw.length),content_type:mime},{expectedVersion:file.version,idempotencyKey:file.key});file.id=upload.upload_id;remember();
        if(upload.state==='reserved'){
          if(!upload.upload_url)throw new Error('The upload could not be prepared.');
          const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
          const response=await transport(upload.upload_url,{method:'PUT',headers:{'Content-Type':mime},body:bytes});
          if(!response.ok){
            // The prior PUT may have succeeded without its response arriving.
            // Only a verified server-side file can rescue an existing-object reply.
            if(![400,409].includes(response.status)){await response.body?.cancel();throw new Error('File upload failed. Retry to resume this save.');}
          }
          await response.body?.cancel();
          await sdk.verifyMediaUpload(upload.upload_id,{expectedVersion:file.version,idempotencyKey:file.verifyKey});
        }else if(!['verified','attached'].includes(upload.state))throw new Error('Upload unavailable.');
        file.verified=true;remember();
      }
      ids.push(file.id);
    }
    const result=await rpc('account_master_save',{p_resource:resource,p_action:action,p_payload:{id:id==null?undefined:String(id),values,relations,expectedUpdatedAt},p_upload_ids:ids,p_idempotency_key:pending.key});
    memory.delete(storageKey);try{storage?.removeItem(storageKey);}catch{/* Save is already committed. */}
    return result;
  }
  return {save};
}
