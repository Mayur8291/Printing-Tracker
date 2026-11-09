/** Source selection semantics: create_product_viewmodel.dart onAddOnSelected /
 * handleSelectionByGroup and add_ons_tab_widget.dart sleeve filtering. */
export function sleeveKind(part){const name=part?.name??'';return name.includes('Sleeve Length')?'length':name.includes('Sleeve Type')?'type':null;}
export function sleeveFilterCode(name=''){return name.includes('Full Sleeve')?'FS':name.includes('Half Sleeve')?'HS':name.includes('3/4th')?'3/4':'';}
export function sleeveChoiceVisible(choice,lengthChoice){const code=sleeveFilterCode(lengthChoice?.name);return !code||(choice.name??'').includes(code);}
export function selectAddon(existing,choice,colorId,choices){
 const byId=new Map(choices.map(row=>[String(row.id),row]));
 if(!byId.has(String(choice.id)))throw new Error('This add-on is no longer available. Reload its choices.');
 if(choice.has_color&&!colorId)throw new Error('Choose an add-on color before adding it.');
 if(existing.some(row=>!byId.has(String(row.addon_id))))throw new Error('A saved add-on is no longer available. Remove it before changing this part.');
 const group=choice.group??'';
 // Backend also rejects mixed single/multiple choices in a single group.
 // Replacing that group keeps both source behavior and the stricter contract.
 const conflicts=row=>{const other=byId.get(String(row.addon_id));return (other.group??'')===group&&(choice.selection_type===0||other.selection_type===0);};
 return [...existing.filter(row=>String(row.addon_id)!==String(choice.id)&&!conflicts(row)),{addon_id:String(choice.id),...(colorId?{color_id:colorId}:{})}];
}
export function updateConfiguredPart(configuration,part,value,parts){
 const previous=configuration.parts.find(row=>String(row.part_id)===String(part.id));
 const changedLength=sleeveKind(part)==='length'&&JSON.stringify(previous?.addons??[])!==JSON.stringify(value?.addons??[]);
 const sleeveTypeIds=new Set(parts.filter(p=>sleeveKind(p)==='type').map(p=>String(p.id)));
 return {...configuration,parts:[...configuration.parts.filter(row=>String(row.part_id)!==String(part.id)).map(row=>changedLength&&sleeveTypeIds.has(String(row.part_id))?{...row,addons:[]}:row),...(value?[value]:[])]};
}
export async function loadConfiguratorOptions(sdk,baseId,kind,filters={}){
 const rows=[],seen=new Set();let cursor=null;
 do{const page=await sdk.configuratorOptions(baseId,kind,filters,{cursor,limit:100});rows.push(...page.data);cursor=page.next_cursor;if(rows.length>2000||(cursor&&seen.has(cursor)))throw new Error('These configuration choices exceed the supported limit. Ask an administrator to review them.');if(cursor)seen.add(cursor);}while(cursor);
 return {data:rows,next_cursor:null};
}
