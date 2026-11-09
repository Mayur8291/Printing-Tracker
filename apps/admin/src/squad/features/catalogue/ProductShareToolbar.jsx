import {useEffect,useRef,useState} from 'react';
import {Share2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {PRODUCT_SHARE_LIMIT} from './productShareModel';

/** Explicit bounded selection replaces mobile long-press without loading an entire catalogue. */
export default function ProductShareToolbar({sdk,customerId,brandId,categoryId,pageRows,selected,onChange,onOpen}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),generation=useRef(0),latestSelection=useRef(selected);
  latestSelection.current=selected;
  useEffect(()=>{generation.current++;setBusy(false);setError('');},[customerId,brandId,categoryId]);
  useEffect(()=>()=>{generation.current++;},[]);
  const eligible=pageRows.filter(product=>product.images?.length),allPage=eligible.length>0&&eligible.every(row=>selected.some(p=>p.id===row.id));
  function selectPage(){setError('');if(allPage){const ids=new Set(eligible.map(p=>p.id));onChange(selected.filter(p=>!ids.has(p.id)));return;}const merged=[...new Map([...selected,...eligible].map(p=>[p.id,p])).values()];if(merged.length>PRODUCT_SHARE_LIMIT){setError(`You can share up to ${PRODUCT_SHARE_LIMIT} products. Clear some selections or choose products individually.`);return;}onChange(merged);}
  async function selectBrand(){const attempt=++generation.current;setBusy(true);setError('');try{
    const result=await sdk.readyMade({brand_id:brandId,...(categoryId?{category_id:categoryId}:{})},customerId||null,{limit:PRODUCT_SHARE_LIMIT+1});
    if(attempt!==generation.current)return;
    if(result.next_cursor||result.data.length>PRODUCT_SHARE_LIMIT)throw new Error('This brand exceeds the 20-product batch limit. Select a page or individual products instead.');
    const products=result.data.filter(row=>row.images?.length);if(!products.length)throw new Error('No products with images are available for this brand.');
    const merged=[...new Map([...latestSelection.current,...products].map(p=>[p.id,p])).values()];if(merged.length>PRODUCT_SHARE_LIMIT)throw new Error('Clear some selections before adding this brand. Up to 20 products can be shared.');
    onChange(merged);
  }catch(cause){if(attempt===generation.current)setError(cause.message||'This brand could not be selected.');}finally{if(attempt===generation.current)setBusy(false);}}
  return <div className="space-y-3 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Share product images</p><p className="mt-1 text-xs text-muted-foreground">{selected.length} of {PRODUCT_SHARE_LIMIT} selected · Select products using their checkboxes.</p></div><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy||!eligible.length} onClick={selectPage}>{allPage?'Deselect page':'Select page'}</Button>{brandId&&<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={selectBrand}>{busy?'Loading brand…':'Select brand'}</Button>}{selected.length>0&&<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>{onChange([]);setError('');}}>Clear selection</Button>}<Button type="button" variant="outline" size="sm" disabled={busy||!selected.length} onClick={onOpen}><Share2 className="size-4"/>Review and share</Button></div></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
