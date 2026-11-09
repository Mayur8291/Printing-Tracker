export const purchaseKey = row => `${row.key}:${row.size_id}`;
export function initialPurchaseQuantities(requirements){return Object.fromEntries(requirements.map(r=>[purchaseKey(r),String(r.purchase_quantity??r.shortage??0)]));}
export function purchaseQuantities(requirements,values){
 const rows=requirements.map(r=>{const value=values[purchaseKey(r)]??'';if(!/^\d{1,7}$/.test(value)||Number(value)>1000000)throw new Error('Enter a whole purchase quantity from 0 to 1,000,000 for every size.');return{key:r.key,size_id:r.size_id,quantity:Number(value)};});
 if(!rows.some(r=>r.quantity>0))throw new Error('Choose at least one piece to purchase.');return rows;
}
export function purchaseQuantitiesChanged(requirements,values){const expected=initialPurchaseQuantities(requirements);return Object.keys(expected).some(k=>String(values[k]??'')!==expected[k]);}
