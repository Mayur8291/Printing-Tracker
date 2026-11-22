const fields=['type','side','width','height','unit','design_id','design_version'];
function configKey(c){return JSON.stringify([String(c.base_product_id),String(c.category_id),String(c.fabric_id),String(c.fabric_color_id),(c.parts??[]).map(p=>[String(p.part_id),String(p.color_id??''),(p.addons??[]).map(a=>[String(a.addon_id),String(a.color_id??'')]).sort((a,b)=>a[0].localeCompare(b[0]))]).sort((a,b)=>a[0].localeCompare(b[0]))]);}
export function savedDesignLine(line,preset){
 const reuse=preset?.reuse;
 if(!preset||reuse?.status!=='complete'||reuse.preset_id!==preset.id||reuse.preset_version!==preset.version||!/^[a-f0-9]{64}$/.test(reuse.fingerprint??'')||configKey(line.configuration)!==configKey(preset.configuration))throw Error('The saved design changed or is incomplete. Reopen it before adding it to your selection.');
 return {...line,preset_id:preset.id,preset_reuse_fingerprint:reuse.fingerprint,brandings:reuse.brandings.map(row=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])))};
}
