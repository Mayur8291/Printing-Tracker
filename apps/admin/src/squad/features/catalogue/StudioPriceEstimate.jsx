import React,{useEffect,useState} from 'react';
import {priceMoney,priceSum,readPricePreviews} from '@canto/shared/pricing';
import {Sheet} from '../../../scott-one-ui';

/** Uses the same scoped contract and calculator as native. Quantities remain a display experiment. */
export default function StudioPriceEstimate({sdk,identity,environment,customerId,scenario,previewQuantity=1,onPreviewQuantity,hasQuantities=false,compact=false,presetVersion,scott=false}){
 const key=JSON.stringify([environment,identity.id,identity.write_state?.generation,customerId,scenario,presetVersion]);
 const [state,setState]=useState(null),[retry,setRetry]=useState(0),[expanded,setExpanded]=useState(false);
 useEffect(()=>{
  if(!scenario)return;
  let active=true;const abort=new AbortController();let timeout;
  const timer=setTimeout(()=>{
   timeout=setTimeout(()=>{abort.abort();if(active)setState({key,status:'error'})},10000);
   void readPricePreviews({client:sdk,request:{...(customerId?{customer_id:customerId}:{}),scenarios:[scenario],include_volume:!compact},signal:abort.signal,isCurrent:()=>active,customerId,generation:identity.write_state?.generation}).then(result=>{
    if(presetVersion&&result.scenarios[0].preset_version!==presetVersion)throw Error('Saved design changed');
    if(active&&!abort.signal.aborted)setState({key,status:'ready',prices:result.scenarios[0].prices});
   }).catch(()=>{if(active&&!abort.signal.aborted)setState({key,status:'error'})}).finally(()=>clearTimeout(timeout));
  },300);
  return()=>{active=false;clearTimeout(timer);clearTimeout(timeout);abort.abort()};
 },[sdk,key,retry,compact]);
 const current=state?.key===key?state:null,row=current?.prices?.[0];
 const volume=<>{!hasQuantities&&onPreviewQuantity&&<label className="flex items-center gap-3">Preview quantity<input type="number" min="1" max="1000000" step="1" aria-label="Price preview quantity" className="w-28 rounded border p-2" value={previewQuantity} onChange={e=>{const n=Number(e.target.value);if(Number.isSafeInteger(n)&&n>0&&n<=1000000)onPreviewQuantity(n)}}/></label>}<div role="table" aria-label="Volume prices" className="text-xs"><div role="row" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,paddingBottom:8,fontWeight:600}}><span role="columnheader">Volume</span><span role="columnheader">Per piece</span><span role="columnheader">Total</span></div>{current?.prices?.map(p=><div role="row" key={p.quantity} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,padding:'8px 0',borderTop:'1px solid #eee',overflowWrap:'anywhere'}}><span role="cell">{p.quantity} {p.quantity===1?'piece':'pieces'}{p.sample_rate_applied?' · Sample':''}</span><span role="cell">{p.rate_available?priceMoney(priceSum(p.unit_price,p.branding_unit_price)):'Rate unavailable'}</span><span role="cell">{p.rate_available?priceMoney(p.total):'—'}</span></div>)}</div><p className="text-xs text-muted-foreground">Prices apply to each design separately. Exploring volume does not change your order quantities.</p></>;
 const note=<p className="mt-2 text-xs text-muted-foreground">Before tax and delivery. Final pricing is confirmed at checkout.{scenario?.sample?' Sample rate applies to the planned quantity; the separate sample quantity is retained.':''}</p>;
 // Pinned studio footer: one total line; the breakdown and volume table open in a sheet.
 if(scott&&!compact)return <div className="studio-price" aria-live="polite">
  <div className="studio-price-copy">{!scenario?<span>Choose fabric and colour to see your price.</span>:row?.rate_available?<><strong>{priceMoney(row.total)} <small>estimated</small></strong><span>{priceMoney(priceSum(row.unit_price,row.branding_unit_price))} / piece · {row.quantity} {row.quantity===1?'piece':'pieces'}{row.sample_rate_applied?' · Sample rate':''}</span></>:current?.status==='error'||row?<span>Price unavailable. <button type="button" className="underline" onClick={()=>setRetry(n=>n+1)}>Retry price</button></span>:<span>Updating price…</span>}</div>
  {scenario&&<button type="button" className="studio-price-more" aria-haspopup="dialog" onClick={()=>setExpanded(true)}>Price details</button>}
  <Sheet open={expanded&&!!scenario} onOpenChange={setExpanded} title="Price details">
   {row?.rate_available&&<p>{priceMoney(row.total)} estimated total · Garment {priceMoney(row.unit_price)} + branding {priceMoney(row.branding_unit_price)} / piece</p>}
   <div className="space-y-3">{volume}</div>{note}
  </Sheet>
 </div>;
 return <div className={compact?'text-xs text-muted-foreground':'mb-4 rounded-xl border bg-white p-4 text-sm'} aria-live="polite">
  {!scenario?<span>Choose fabric and colour to see your price.</span>:row?.rate_available?<><span>{priceMoney(priceSum(row.unit_price,row.branding_unit_price))} / piece · at {row.quantity} {row.quantity===1?'piece':'pieces'}{row.sample_rate_applied?' · Sample rate':''}</span>{!compact&&<div className="mt-1">{priceMoney(row.total)} estimated total · Garment {priceMoney(row.unit_price)} + branding {priceMoney(row.branding_unit_price)} / piece</div>}</>:current?.status==='error'||row?<span>Price unavailable. <button type="button" className="underline" onClick={()=>setRetry(n=>n+1)}>Retry price</button></span>:<span>Updating price…</span>}
  {!compact&&scenario&&<><button type="button" className="mt-2 text-primary underline" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Hide volume prices':'Explore volume prices'}</button>{expanded&&<div className="mt-3 space-y-3">{volume}</div>}</>}
  {!compact&&note}
 </div>;
}
