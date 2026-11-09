export function positiveQuantity(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error('Enter a whole quantity between 1 and 100,000.');return n;}
export function customLine(configuration,quantities,sample,brandings=[]){
 for(const key of ['base_product_id','fabric_id','fabric_color_id','category_id'])if(!configuration[key])throw new Error('Choose a product, category, fabric and fabric color.');
 const values=Object.entries(quantities).filter(([,v])=>v!==''&&Number(v)!==0).map(([size_id,v])=>({size_id,quantity:positiveQuantity(v)}));
 if(!values.length)throw new Error('Enter at least one size quantity.');
 return {kind:'custom',configuration,quantities:values,...(sample?.size_id?{sample:{size_id:sample.size_id,quantity:positiveQuantity(sample.quantity)}}:{}),...(brandings.length?{brandings}:{} )};
}
export function readyMadeLine(quantities,brandings=[]){const skus=Object.entries(quantities).filter(([,v])=>v!==''&&Number(v)!==0).map(([sku_id,v])=>({sku_id,quantity:positiveQuantity(v)}));if(!skus.length)throw new Error('Enter a quantity for at least one available variant.');return {kind:'rmp',skus,...(brandings.length?{brandings}:{})};}
export function cartQuantity(line){return (line.kind==='custom'?line.quantities:line.skus).reduce((sum,row)=>sum+row.quantity,0);}
export function quoteRequest(cart,customerId,addressId){if(!cart.length)throw new Error('Add at least one product.');return {...(customerId?{customer_id:customerId}:{}),...(addressId?{address_id:addressId}:{}),lines:cart.map(row=>({...row.line,...(row.line.brandings?{brandings:row.line.brandings.map(branding=>Object.fromEntries(['type','side','width','height','unit','design_id','design_version'].filter(key=>branding[key]!==undefined).map(key=>[key,branding[key]])))}:{})}))};}
