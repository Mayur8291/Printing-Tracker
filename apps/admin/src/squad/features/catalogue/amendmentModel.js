import {positiveQuantity} from './catalogueModel.js';

const id=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
async function readSection(sdk,itemId,section){
 const rows=[];let cursor=null,first;
 do{
  const result=await sdk.orderItem(itemId,section,{cursor,limit:100});first??=result;
  requireValue(result.version===first.version,'An item changed while loading. Reload the order before amending.');
  rows.push(...result.records.data);cursor=result.records.next_cursor;
  requireValue(rows.length<=1000&&!((rows.length===1000)&&cursor),'This item is too large to prepare interactively.');
 }while(cursor);
 return {...first,records:{...first.records,data:rows,next_cursor:null}};
}
function brandingInput(branding){
 requireValue([0,1].includes(branding.type)&&branding.unit==='inch'&&branding.image?.status==='ready',`Design #${branding.id} is incomplete or its image is unavailable. Restore that design before preserving this line.`);
 requireValue(!branding.comment_truncated,'A design note exceeds the readable limit; it cannot be copied safely.');
 return {type:branding.type===0?'print':'embroidery',side:branding.side,width:branding.width,height:branding.height,unit:'inch',design_id:branding.id,design_version:branding.version};
}
async function readLine(sdk,item){
 const [quantities,designs]=await Promise.all([readSection(sdk,item.id,'quantities'),readSection(sdk,item.id,'brandings')]);
 requireValue(quantities.version===item.version&&designs.version===item.version,'An item changed while loading. Reload before amending.');
 requireValue(!quantities.comment_truncated,`Item #${item.id} has a note too long to preserve automatically.`);
 const brandings=designs.records.data.map(brandingInput),settings={comment:quantities.comment??''};let line;
 if(item.type===0){
  requireValue(Object.hasOwn(quantities,'size_type'),`Item #${item.id} is missing its original size-type context.`);
  const preset=await sdk.presets({id:item.product_id},{limit:1});const product=preset.data.find(row=>row.id===item.product_id);
  requireValue(product?.configuration,`The complete configuration for item #${item.id} is unavailable.`);
  const plan=item.sample_order?await readSection(sdk,item.id,'bulk_plan'):quantities;
  requireValue(plan.version===item.version,'The bulk size plan changed while loading.');
  const sizes=plan.records.data.map(row=>({size_id:row.size_id,quantity:positiveQuantity(row.quantity)}));
  requireValue(sizes.length>0&&sizes.every(row=>id(row.size_id)),`Item #${item.id} has an incomplete original size plan.`);
  requireValue(new Set(sizes.map(row=>row.size_id)).size===sizes.length,`Item #${item.id} contains duplicate size rows and needs review.`);
  line={kind:'custom',configuration:product.configuration,quantities:sizes};
  if(item.sample_order){requireValue(quantities.records.data.length===1,'The original sample plan is ambiguous.');const row=quantities.records.data[0];line.sample={size_id:row.size_id,quantity:positiveQuantity(row.quantity)};}
  settings.product_id=item.product_id;
  if(quantities.size_type){
   const types=[];let cursor=null;do{const page=await sdk.configuratorOptions(product.configuration.base_product_id,'size_types',{}, {cursor,limit:100});types.push(...page.data);cursor=page.next_cursor;requireValue(types.length<=1000&&!((types.length===1000)&&cursor),'Size-type choices exceed the interactive review limit.');}while(cursor);
   const matching=types.filter(type=>type.name===quantities.size_type);requireValue(matching.length===1,`The original size type ‘${quantities.size_type}’ is missing or ambiguous. Review this item before replacing it.`);settings.size_type_id=matching[0].id;
  }
 }else{
  const variants=await readSection(sdk,item.id,'variants');
  requireValue(variants.version===item.version,'The accepted variant selection changed while loading.');
  requireValue(variants.records.basis==='accepted_quote'&&variants.records.data.length>0,`Item #${item.id} has no recorded SKU selection from the old application. Choose its replacement explicitly; sizes alone cannot identify its original SKUs.`);
  const skus=variants.records.data.map(row=>({sku_id:row.sku_id,quantity:positiveQuantity(row.quantity)}));
  requireValue(skus.every(row=>id(row.sku_id))&&new Set(skus.map(row=>row.sku_id)).size===skus.length,'The original SKU selection is incomplete or ambiguous.');
  line={kind:'rmp',skus};
 }
 if(brandings.length)line.brandings=brandings;
 const ordered=(line.sample?line.sample.quantity:(line.quantities??line.skus).reduce((total,row)=>total+row.quantity,0));
 requireValue(ordered===item.total_quantity,`Item #${item.id} quantities do not reconcile with its ordered total.`);
 return {key:`existing:${item.id}`,label:quantities.product?.name||`Item #${item.id}`,line,settings,source:{itemId:item.id,version:item.version,baseline:JSON.stringify({line,settings})}};
}
export function amendmentLineState(row){return !row.source?'New':JSON.stringify({line:row.line,settings:row.settings})===row.source.baseline?'Preserved':'Changed';}

/** Explicit user-triggered preparation. Never returns a partial order selection. */
export async function loadAmendmentSelection(sdk,order){
 requireValue(!order.comment_truncated,'The order note is too long to preserve automatically.');
 const items=[];let cursor=null;
 do{
  const page=await sdk.order(order.id,{cursor,limit:50});
  requireValue(page.version===order.version,'The order changed. Reload before preparing its amendment.');
  items.push(...page.items.data);cursor=page.items.next_cursor;
  requireValue(items.length<=50&&!cursor,'This order exceeds the 50-line interactive replacement limit.');
 }while(cursor);
 requireValue(items.length>0,'There are no current items to preserve.');
 const rows=[];
 // Three independent items at a time limits request pressure; each child page is bounded.
 for(let index=0;index<items.length;index+=3)rows.push(...await Promise.all(items.slice(index,index+3).map(item=>readLine(sdk,item))));
 const latest=await sdk.order(order.id,{limit:1});
 requireValue(latest.version===order.version,'The order changed while loading. Reload before preparing its amendment.');
 return rows;
}
