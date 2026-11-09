import {useEffect,useMemo,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ImageOff,Layers,LoaderCircle,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useSquad,useSquadQuery} from '../data/hooks';
import {getEnvironmentConfig} from '../../runtimeEnv';
import {useMediaGrants} from './Media';
import {referenceKey,safeMediaUrl} from './mediaModel';
import {preparePreviewSvg,previewGeometry,previewLayers,readPreviewSvg} from './configuratorPreviewModel';

async function pool(items,work){const result=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(next<items.length){const index=next++;result[index]=await work(items[index],index);}}));return result;}

/** Same compositing order and square-relative geometry as the pinned Flutter app.
 * Only authorized environment-local artwork may enter the preview. */
export default function ConfiguratorPreview({baseId,configuration,label='Product preview'}) {
  const {sdk,scope,environment}=useSquad(),client=useQueryClient();
  const chosen=(configuration.parts??[]).flatMap(part=>(part.addons??[]).map(addon=>({...addon,part_id:part.part_id})));
  const model=useSquadQuery(['preview-model',baseId,configuration.fabric_id,configuration.fabric_color_id,chosen],async ({sdk,signal}) => {
    if(chosen.length>100)throw new Error('This configuration has too many preview layers.');
    async function options(kind,filters={}){signal.throwIfAborted();const result=await client.fetchQuery({queryKey:['squad',scope,'preview-options',baseId,kind,filters],staleTime:60000,gcTime:120000,queryFn:async({signal:querySignal})=>{
      const readSdk=sdk.withSignal?sdk.withSignal(querySignal):sdk;
      const rows=[];let cursor=null;const seen=new Set();
      do{const page=await readSdk.configuratorOptions(baseId,kind,filters,{cursor,limit:100});rows.push(...page.data);cursor=page.next_cursor;if(cursor&&seen.has(cursor))throw new Error('Preview options could not be fully loaded.');seen.add(cursor);if(rows.length>2000)throw new Error('Preview options exceed the supported limit.');}while(cursor);
      return rows;
    }});signal.throwIfAborted();return result;}
    const warnings=[];
    const color=async(kind,filters,id)=>{if(!id)return null;const row=(await options(kind,filters)).find(item=>String(item.id)===String(id));if(!row?.hex)throw new Error('A selected color is no longer available for the preview.');return row.hex;};
    const [baseAssets,baseColor]=await Promise.all([options('assets'),configuration.fabric_color_id?color('fabric_colors',{parentId:configuration.fabric_id},configuration.fabric_color_id):null]);
    if(baseAssets.length>1)throw new Error('The base product has conflicting preview artwork.');
    const base=baseAssets.map(asset=>({id:`base:${asset.id}`,asset,color:baseColor,name:'Base garment'}));
    if(!base.length)warnings.push('Base garment artwork is unavailable.');
    const selected=await pool(chosen,async addon=>{
      const [assets,choices,selectedColor]=await Promise.all([options('assets',{parentId:addon.addon_id,partId:addon.part_id}),options('addons',{parentId:addon.part_id}),addon.color_id?color('addon_colors',{parentId:addon.addon_id,partId:addon.part_id},addon.color_id):null]);
      const choice=choices.find(item=>String(item.id)===String(addon.addon_id));
      if(!choice)throw new Error('A selected add-on is no longer available for the preview.');
      if(assets.length>1)throw new Error(`The ${choice.name} add-on has conflicting preview artwork.`);
      if(!assets.length)warnings.push(`${choice.name}: artwork is unavailable.`);
      return assets.map(asset=>({id:`${addon.part_id}:${addon.addon_id}:${asset.id}`,asset,color:selectedColor,layerSort:choice.layer_sort,name:choice.name}));
    });
    return {layers:previewLayers(base,selected.flat()),warnings};
  },{enabled:!!baseId});
  const layers=model.data?.layers??[];
  const grants=useMediaGrants(layers.map(layer=>layer.asset.asset).filter(Boolean),{enabled:!!model.data});
  const grantList=grants.data??[];
  const sources=useSquadQuery(['preview-artwork',layers.map(layer=>referenceKey(layer.asset.asset)),grantList.map(grant=>[referenceKey(grant),grant.status,grant.version,grant.url])],async ({signal}) => {
    const references=[...new Map(layers.map(layer=>[referenceKey(layer.asset.asset),layer.asset.asset])).values()];
    return Object.fromEntries(await pool(references,async reference=>{
      const key=referenceKey(reference),grant=grantList.find(item=>referenceKey(item)===key);
      const url=grant?.status==='ready'&&safeMediaUrl(grant.url,getEnvironmentConfig(environment).url);
      if(!url)return [key,{error:grant?.status==='missing'?'File missing from source':grant?.status==='pending'?'Artwork is being prepared':'Artwork unavailable'}];
      if(grant.content_type!=='image/svg+xml')return [key,{error:'This preview requires SVG artwork'}];
      try{const text=await client.fetchQuery({queryKey:['squad',scope,'preview-svg',key,grant.version,new URL(url).pathname],queryFn:({signal:querySignal})=>readPreviewSvg(url,AbortSignal.any([querySignal,AbortSignal.timeout(30000)])),staleTime:60000,gcTime:120000});signal.throwIfAborted();return [key,{text}];}
      catch(error){signal.throwIfAborted();return [key,{error:error.message||'Artwork could not be loaded'}];}
    }));
  },{enabled:!!model.data&&layers.length>0&&!grants.isLoading&&!grants.error&&grantList.length>0,staleTime:60000});
  const prepared=useMemo(()=>{
    const issues=[...(model.data?.warnings??[])],items=[];
    for(const layer of layers){const source=sources.data?.[referenceKey(layer.asset.asset)];if(!source)continue;
      if(source.error){issues.push(`${layer.name}: ${source.error}.`);continue;}
      try{items.push({...layer,style:previewGeometry(layer.asset,layer.mirror),svg:preparePreviewSvg(source.text,layer.color)});}catch(error){issues.push(`${layer.name}: ${error.message}`);}
    }
    return {items,issues:[...new Set(issues)]};
  },[model.data,sources.data]);
  const [images,setImages]=useState({items:[],source:null}),[imageFailures,setImageFailures]=useState([]);
  useEffect(()=>{setImageFailures([]);const items=prepared.items.map(layer=>({...layer,url:URL.createObjectURL(new Blob([layer.svg],{type:'image/svg+xml'}))}));setImages({items,source:prepared});return()=>items.forEach(layer=>URL.revokeObjectURL(layer.url));},[prepared]);
  const loading=model.isLoading||grants.isLoading||(layers.length>0&&!sources.data&&sources.isFetching)||(prepared.items.length>0&&images.source!==prepared);
  const error=model.error||grants.error||sources.error;
  const visible=images.source===prepared?images.items:[];
  const issues=[...prepared.issues,...imageFailures.map(name=>`${name}: artwork could not be displayed.`)];
  async function retry(){await client.invalidateQueries({queryKey:['squad',scope,'preview-svg']});await Promise.all([model.refetch(),grants.refetch()]);await sources.refetch();}
  return <section className="squad-configurator-preview overflow-hidden rounded-xl border bg-card shadow-sm" aria-label={label}>
    <div className="flex items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="text-sm font-semibold">Design preview</h2><p className="mt-1 text-xs text-muted-foreground">Your selected fabric and add-ons</p></div><Layers className="size-4 text-muted-foreground" aria-hidden="true"/></div>
    <div className="p-4"><div className="relative aspect-square overflow-hidden rounded-lg border bg-white" aria-label={label} role="img" aria-busy={loading}>
      {visible.map(layer=><img key={`${layer.id}:${layer.mirror}`} src={layer.url} alt="" aria-hidden="true" draggable="false" className="absolute max-h-full max-w-full object-contain" style={{...layer.style,width:'auto',transformOrigin:'center'}} onError={event=>{event.currentTarget.hidden=true;setImageFailures(current=>current.includes(layer.name)?current:[...current,layer.name]);}}/>)}
      {(loading||error||!visible.length)&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95 px-6 text-center text-slate-500">{loading?<LoaderCircle className="size-6 animate-spin"/>:<ImageOff className="size-7"/>}<p className="text-sm">{loading?'Preparing your preview…':error?'Preview could not be loaded':'Preview artwork is unavailable'}</p></div>}
    </div></div>
    <div className="space-y-2 border-t px-5 py-4 text-xs leading-relaxed text-muted-foreground">{error?<p role="alert">{error.message}</p>:issues.length?<><p className="font-medium text-foreground">This preview is incomplete</p><ul className="list-disc space-y-1 pl-4">{issues.map(issue=><li key={issue}>{issue}</li>)}</ul></>:<p>Colors are a visual guide. Your saved configuration and final quote remain the source of order details.</p>}{(error||issues.length>0)&&<Button type="button" size="sm" variant="outline" onClick={retry} disabled={loading}><RefreshCw className="size-3.5"/>Retry preview</Button>}</div>
  </section>;
}
