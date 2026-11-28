import {loadConfiguratorOptions,selectAddon,updateConfiguredPart} from './addon-selection.js';
// Exact decimal display and comparison. No client-side selling-price formula.
const scale=10n**18n;
const decimal=/^-?\d{1,30}(?:\.\d{1,18})?$/;
function units(value){
 if(typeof value!=='string'||!decimal.test(value))throw Error('Invalid price');
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
 return (BigInt(whole)*scale+BigInt(fraction.padEnd(18,'0')))*(negative?-1n:1n);
}
function value(n){const sign=n<0n?'-':'';n=n<0n?-n:n;return sign+(n/scale).toString()+'.'+(n%scale).toString().padStart(18,'0').replace(/0+$/,'').padEnd(1,'0');}
export function priceSum(...prices){return value(prices.reduce((n,p)=>n+units(p),0n));}
export function priceDifference(after,before){return value(units(after)-units(before));}
export function priceMoney(price){
 let n=units(price),sign=n<0n?'-':'';n=n<0n?-n:n;
 const cents=(n+scale/200n)/(scale/100n),whole=(cents/100n).toString();
 return sign+'₹'+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(cents%100n).toString().padStart(2,'0');
}
export function optionPriceLabel(before,after,selected=false){
 if(!before?.rate_available||!after?.rate_available)return 'Price unavailable';
 const delta=priceDifference(priceSum(after.unit_price,after.branding_unit_price),priceSum(before.unit_price,before.branding_unit_price));
 if(units(delta)===0n)return before.sample_rate_applied&&after.sample_rate_applied?'No change at sample rate':'No price change';
 return `${selected?'Remove: ':''}${units(delta)>0n?'+':''}${priceMoney(delta)} / piece`;
}
export function quotePriceChanges(before,after){
 if(!before||!after||before.lines.length!==after.lines.length)return null;
 const fields=['subtotal','branding_total','cgst','sgst','igst','total'];
 const changed=(a,b)=>fields.filter(k=>units(a[k])!==units(b[k]));
 const lines=after.lines.flatMap((line,i)=>{
  const previous=before.lines[i],components=changed(previous,line);
  const variants=canonical(previous.variants?.map(v=>({quantity:v.quantity,unit_price:value(units(v.unit_price))})))!==canonical(line.variants?.map(v=>({quantity:v.quantity,unit_price:value(units(v.unit_price))})));
  return components.length||variants?[{line:i+1,previousTotal:previous.total,total:line.total,components:[...components,...(variants?['unit_price']:[])]}]:[];
 });
 return changed(before,after).length||lines.length?{previousTotal:before.total,total:after.total,lines}:null;
}
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
/** Bind every response to its request, account and generation before displaying it. */
export async function readPricePreviews({client,request,signal,isCurrent,customerId,generation}){
 const guard=()=>{if(signal.aborted||!isCurrent())throw Error('Price preview scope changed');};guard();
 const result=await client.withSignal(signal).previewCustomPrices(request);guard();
 if(result?.purpose!=='custom_price_preview'||result.currency!=='INR'||result.tax_included!==false||'quote_id' in result
  ||(customerId&&result.context?.customer_id!==customerId)||(generation&&String(result.context?.generation)!==generation)
  ||!Array.isArray(result.scenarios)||result.scenarios.length!==request.scenarios.length)throw Error('Could not verify price preview');
 for(let i=0;i<request.scenarios.length;i++){
  const row=result.scenarios[i],selection=request.scenarios[i];
  if(row?.index!==i+1||canonical(row.selection)!==canonical(selection)||!Array.isArray(row.prices)||row.prices.length<1||row.prices.length>7
   ||row.prices[0]?.quantity!==selection.quantity||(!request.include_volume&&row.prices.length!==1))throw Error('Mismatched price scenario');
  let last=0;
  for(const p of row.prices){
   if(!Number.isSafeInteger(p.quantity)||p.quantity<=last||p.quantity>1000000||typeof p.sample_rate_applied!=='boolean'||typeof p.rate_available!=='boolean'
    ||p.sample_rate_applied!==(!!selection.sample||p.quantity<6)
    ||!['unit_price','branding_unit_price','subtotal','branding_total','total'].every(k=>typeof p[k]==='string'&&decimal.test(p[k])&&units(p[k])>=0n))throw Error('Invalid volume price');
   last=p.quantity;
  }
 }
 return result;
}

/** Price the exact replacement/toggle, including dependent sleeve removals. */
export async function readOptionPriceDifferences(input){
 const {configuration,part,partColorId,choices,allParts,quantity,sample=false,brandings=[],signal}=input;
 const selected=configuration.parts.find(p=>p.part_id===part.id),labels={};
 const read=input.client.withSignal(signal);
 // Small batches bound total selection work and concurrent colour reads.
 for(let start=0;start<choices.length;start+=4){
  if(signal.aborted||!input.isCurrent())throw Error('Price preview scope changed');
  const candidates=await Promise.all(choices.slice(start,start+4).map(async choice=>{
   const existing=selected?.addons?.find(a=>a.addon_id===choice.id);
   let colorId=null;
   if(choice.has_color&&!existing){
    const colors=await loadConfiguratorOptions(read,configuration.base_product_id,'addon_colors',{parentId:choice.id,partId:part.id});
    colorId=colors.data.find(c=>c.id===partColorId)?.id??colors.data[0]?.id;
    if(!colorId)return {choice,configuration:null,existing};
   }
   const previous=selected??{part_id:part.id,color_id:partColorId,addons:[]};
   const addons=existing?previous.addons.filter(a=>a.addon_id!==choice.id):selectAddon(previous.addons,choice,colorId,choices);
   return {choice,existing,configuration:updateConfiguredPart(configuration,part,addons.length?{...previous,addons}:null,allParts)};
  }));
  const valid=candidates.filter(c=>c.configuration);
  if(valid.length){
   const request={...(input.customerId?{customer_id:input.customerId}:{}),scenarios:[{configuration,quantity,...(sample?{sample:true}:{}),brandings},...valid.map(c=>({configuration:c.configuration,quantity,...(sample?{sample:true}:{}),brandings}))]};
   const result=await readPricePreviews({...input,request});
   valid.forEach((c,i)=>{labels[c.choice.id]=optionPriceLabel(result.scenarios[0].prices[0],result.scenarios[i+1].prices[0],!!c.existing)});
  }
  candidates.filter(c=>!c.configuration).forEach(c=>{labels[c.choice.id]='Choose an available colour'});
 }
 return labels;
}
