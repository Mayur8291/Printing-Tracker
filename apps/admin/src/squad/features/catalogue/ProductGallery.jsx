import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Share2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {MediaViewer,useMediaGrants} from '../../components/Media';
import {referenceKey} from '../../components/mediaModel';
import {useSquad} from '../../data/hooks';
import {Panel} from '../orders/CommerceUI';
import ProductShareDialog from './ProductShareDialog';

/** One authorized gallery for every ready-made persona. Native Open provides
 * browser zoom; share prepares the selected image, never a persistent signed URL. */
export default function ProductGallery({product}) {
  const {sdk,environment}=useSquad();
  const [selected,setSelected]=useState(0),[sharing,setSharing]=useState(false);
  const images=(product.images??[]).filter(reference=>reference?.resource).slice(0,5),entries=[...images.map((reference,index)=>({reference,label:`Image ${index+1}`,image:true})),...(product.video?.resource?[{reference:product.video,label:'Product video',image:false}]:[])];
  const signature=JSON.stringify(entries.map(entry=>referenceKey(entry.reference)));
  useEffect(()=>{setSelected(0);setSharing(false);},[product.id,signature,environment]);
  const grants=useMediaGrants(entries.map(entry=>entry.reference));
  const entry=entries[Math.min(selected,entries.length-1)],grant=grants.data?.find(item=>referenceKey(item)===referenceKey(entry?.reference));
  if(!entries.length)return null;
  return <Panel title="Product images" description="View available images and video. Open an image for a larger view." actions={entry?.image&&<Button type="button" size="sm" variant="outline" disabled={grant?.status!=='ready'} onClick={()=>setSharing(true)}><Share2 className="size-4"/>Share image</Button>}><div className="space-y-4 p-5"><div className="mx-auto max-w-xl"><MediaViewer key={referenceKey(entry?.reference)} reference={entry?.reference} grant={grant} loading={grants.isLoading} label={`${product.name} · ${entry?.label}`}/></div>{entries.length>1&&<div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Choose product image"><Button type="button" size="icon" variant="outline" disabled={selected===0} aria-label="Previous product image" onClick={()=>setSelected(index=>Math.max(0,index-1))}><ChevronLeft className="size-4"/></Button>{entries.map((item,index)=><Button key={referenceKey(item.reference)} type="button" size="sm" variant={index===selected?'default':'outline'} aria-pressed={index===selected} onClick={()=>setSelected(index)}>{item.label}</Button>)}<Button type="button" size="icon" variant="outline" disabled={selected>=entries.length-1} aria-label="Next product image" onClick={()=>setSelected(index=>Math.min(entries.length-1,index+1))}><ChevronRight className="size-4"/></Button></div>}</div>{sharing&&entry?.image&&<ProductShareDialog sdk={sdk} environment={environment} products={[{...product,name:`${product.name} · ${entry.label}`,images:[entry.reference]}]} onClose={()=>setSharing(false)}/>}</Panel>;
}
