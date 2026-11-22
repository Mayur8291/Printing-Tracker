// Draft metadata only: never persist signed URLs, image bytes, or authentication.
const prefix='scott-studio-draft-v1:';
export function draftKey(environment,actor,customer,product,preset){return prefix+JSON.stringify([environment,actor,customer??null,product,preset??null]);}
export function readDraft(key,storage=globalThis.sessionStorage){try{
 const value=JSON.parse(storage.getItem(key));
 if(value?.v!==1||!Number.isFinite(value.savedAt)||value.savedAt>Date.now()+60000||Date.now()-value.savedAt>12*60*60*1000)return null;
 const c=value.configuration,id=v=>typeof v==='string'&&/^\d+$/.test(v);
 if(!c||!id(c.base_product_id)||!Array.isArray(c.parts)||c.parts.length>50||c.parts.some(p=>!p||!id(p.part_id)||!Array.isArray(p.addons)||p.addons.length>100||p.addons.some(a=>!a||!id(a.addon_id))))return null;
 if(value.brandings!==undefined&&(!Array.isArray(value.brandings)||value.brandings.length>20||value.brandings.some(row=>!row||!['print','embroidery'].includes(row.type)||typeof row.side!=='string')))return null;
 if(value.stage&&!['Fabric','Parts','Artwork','Review','Sizes'].includes(value.stage))return null;
 return value;
}catch{return null;}}
export function writeDraft(key,value,storage=globalThis.sessionStorage){try{const brandings=(value.brandings??[]).map(row=>Object.fromEntries(['type','side','width','height','unit','comment','print_area','design_id','design_version','product_id'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));storage.setItem(key,JSON.stringify({...value,brandings,v:1,savedAt:Date.now()}));return true;}catch{return false;}}
export function clearDraft(key,storage=globalThis.sessionStorage){try{storage.removeItem(key);}catch{}}
