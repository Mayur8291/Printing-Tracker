import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useSquad,useSquadQuery} from '../../data/hooks';
import {getEnvironmentConfig} from '../../../runtimeEnv';
import ConfiguratorPreview from '../../components/ConfiguratorPreview';
import {useMediaGrants} from '../../components/Media';
import {referenceKey,safeMediaUrl} from '../../components/mediaModel';
import {studioArtworkPlacement} from './studio-artwork.generated';
import {resolveStudioDesign,STUDIO_BINDINGS} from './studio-catalogue.generated';
import registry from './assets/registry.json';
import modelUrl from './assets/garment.glb?url';

/** Current scoped catalogue records supply colours and validity; Blender only supplies geometry. */
export default function StudioPreview(props){
 const {baseId,configuration,label='Your design',artworks=[]}=props;
 const {scope,environment}=useSquad();
 return String(baseId)==='216'?<MappedPreview key={scope} {...props} artworks={artworks} environment={environment} scope={scope}/>:<div data-studio-capture-blocked={props.brandings?.some(row=>row.design_id)?'artwork-preview-unavailable':undefined}><ConfiguratorPreview baseId={baseId} configuration={configuration} label={label}/></div>;
}
function MappedPreview({baseId,configuration,label='Your design',artworks,brandings=[],environment,scope,onPartSelect}){
 const client=useQueryClient(),[fallback,setFallback]=useState(false);
 const artwork=useStudioArtwork(brandings,environment);
 const renderedArtwork=[...artworks,...(artwork.data??[])];
 const query=useSquadQuery(['studio-model',baseId,configuration],async({sdk,signal})=>{
  const options=(kind,parentId,partId)=>client.fetchQuery({queryKey:['squad',scope,'studio-options',baseId,kind,parentId,partId],staleTime:300000,gcTime:1800000,queryFn:async({signal:readSignal})=>{
   const source=sdk.withSignal?sdk.withSignal(readSignal):sdk;let cursor=null;const rows=[],seen=new Set();
   do{const page=await source.configuratorOptions(baseId,kind,{parentId,partId},{cursor,limit:100});rows.push(...page.data);cursor=page.next_cursor;if(cursor&&seen.has(cursor)||rows.length>2000)throw Error('Catalogue options could not be fully loaded.');seen.add(cursor);}while(cursor);return rows;
  }});
  const catalogue={parts:await options('parts'),fabricColors:configuration.fabric_id?await options('fabric_colors',configuration.fabric_id):[],addonsByPart:{},partColorsByPart:{},addonColorsByAddon:{}};
  for(const part of configuration.parts??[]){signal.throwIfAborted();const [addons,colors]=await Promise.all([options('addons',part.part_id),options('part_colors',part.part_id)]);catalogue.addonsByPart[part.part_id]=addons;catalogue.partColorsByPart[part.part_id]=colors;for(const addon of part.addons??[])if(addons.find(row=>row.id===addon.addon_id)?.has_color)catalogue.addonColorsByAddon[`${part.part_id}:${addon.addon_id}`]=await options('addon_colors',addon.addon_id,part.part_id);}
  signal.throwIfAborted();const option=id=>id?{id:String(id)}:undefined;
  return resolveStudioDesign({projectRef:new URL(getEnvironmentConfig(environment).url).hostname.split('.')[0],selection:{base:option(baseId),designCategory:option(configuration.category_id),fabric:option(configuration.fabric_id),color:option(configuration.fabric_color_id)},parts:configuration.parts??[],catalogue});
 },{staleTime:300000,gcTime:1800000,refetchOnWindowFocus:false});
 const supported=query.data?.status==='supported';
 if(fallback||query.data?.status==='unsupported')return <div data-studio-capture-blocked={brandings.some(row=>row.design_id)?'artwork-preview-unavailable':undefined}><p className="px-5 py-3 text-xs text-muted-foreground">{fallback?'3D is unavailable in this browser. Your design is preserved.':query.data.reason}</p><ConfiguratorPreview baseId={baseId} configuration={configuration} label={label}/></div>;
 return <div><CanvasPreview onPartSelect={onPartSelect} design={supported?{...query.data.design,artworks:renderedArtwork}:{modelId:registry.modelId,visibleGroups:['Base','Body_Closed','SetInShoulderSeams'],materialColors:{BaseFabric:'#e3dfd8',Part_202_Fabric:'#e3dfd8'}}} pending={!supported||query.isFetching||artwork.pending||!!artwork.error} label={label} onFailure={()=>setFallback(true)}/>{artwork.error&&<p role="alert" className="p-4 text-xs">{artwork.error.message} Your artwork remains attached; a complete preview cannot be captured yet.</p>}{query.error&&<p role="alert" className="p-4 text-sm">{query.error.message} <button type="button" onClick={()=>query.refetch()}>Retry preview</button></p>}{supported&&query.data.nonVisualDetails.length>0&&<details className="px-5 py-3 text-xs text-muted-foreground"><summary>Details saved as specifications</summary><ul>{query.data.nonVisualDetails.map(text=><li key={text}>{text}</li>)}</ul></details>}</div>;
}
function CanvasPreview({design,pending,label,onFailure,onPartSelect}){
 const root=useRef(null),host=useRef(null),canvas=useRef(null),runtime=useRef(null),revision=useRef(0),readyRevision=useRef(0),capture=useRef(null),latest=useRef(design),pendingRef=useRef(pending),[ready,setReady]=useState(false),[omitted,setOmitted]=useState([]);
 const partCallback=useRef(onPartSelect);partCallback.current=onPartSelect;
 latest.current=design;pendingRef.current=pending;
 const key=JSON.stringify(design);
 useEffect(()=>{let alive=true;import('./studio-renderer.generated').then(({createStudioRenderer})=>{
  if(!alive)return;
  runtime.current=createStudioRenderer({canvas:canvas.current,container:host.current,registry,modelUrl,groupPartMap:{Base:'202',Body_Closed:'202',Body_Slit:'202',...Object.fromEntries(STUDIO_BINDINGS.map(row=>[row.modelGroup,row.part_id]))},onEvent:event=>{
   if(!alive)return;
   if(event.type==='part')partCallback.current?.(event.partId);
   if(event.type==='ready'&&event.revision===revision.current){readyRevision.current=event.revision;setReady(true);setOmitted(event.omittedArtworkIds);}
   if(event.type==='interaction'){capture.current?.reject(Error('The view changed during capture. Please try again.'));capture.current=null;}
   if(event.type==='error'){capture.current?.reject(Error('The preview could not be captured.'));capture.current=null;onFailure();}
   if(event.type==='recovering'){readyRevision.current=0;setReady(false);}
   if(event.type==='capture'&&capture.current?.revision===event.revision&&capture.current.id===event.requestId){const ticket=capture.current;capture.current=null;if(event.revision!==revision.current||pendingRef.current){ticket.reject(Error('The design changed during capture.'));return;}fetch(event.dataUri).then(response=>response.blob()).then(blob=>{if(!alive||event.revision!==revision.current||pendingRef.current){ticket.reject(Error('The design changed during capture.'));return;}ticket.resolve(new File([blob],'design-mockup.png',{type:'image/png'}));},ticket.reject);}
  }});
  if(latest.current)runtime.current.command({type:'design',revision:++revision.current,design:latest.current});
 }).catch(()=>{if(alive)onFailure();});
 return()=>{alive=false;runtime.current?.dispose();runtime.current=null;capture.current?.reject(Error('The preview was closed.'));capture.current=null;};
 },[]);
 useEffect(()=>{capture.current?.reject(Error('The design changed during capture.'));capture.current=null;readyRevision.current=0;if(runtime.current&&design)runtime.current.command({type:'design',revision:++revision.current,design});},[key]);
 useEffect(()=>{const node=root.current;node.captureStudioPreview=()=>{
  if(!runtime.current||pendingRef.current||readyRevision.current!==revision.current||!design||omitted.length)throw Error('Wait for the complete design preview before capturing it.');
  if(capture.current)throw Error('A preview capture is already in progress.');
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{if(capture.current?.id===id){capture.current=null;reject(Error('The preview capture timed out.'));}},10000);capture.current={id,revision:revision.current,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};runtime.current.command({type:'capture',revision:revision.current,requestId:id});});
 };return()=>{delete node.captureStudioPreview;};},[key,omitted]);
 return <section ref={root} className="squad-studio-preview" aria-label={label}><div ref={host} style={{height:'clamp(360px,58vh,680px)',position:'relative',background:'#faf9f6',borderRadius:20,overflow:'hidden'}}><canvas ref={canvas} aria-label={`${label}. Drag to rotate; use front and back buttons for preset views.`} role="img" style={{width:'100%',height:'100%',touchAction:'none'}}/>{!ready&&<div className="absolute inset-0 flex items-center justify-center bg-stone-100/90 animate-pulse" role="status">Preparing your garment…</div>}</div><div className="flex justify-center gap-2 py-4">{['front','back','reset'].map(view=><button type="button" key={view} className="rounded-full border bg-white px-4 py-2 text-xs capitalize" onClick={()=>runtime.current?.command({type:'view',view})}>{view}</button>)}</div><p className="text-center text-xs text-muted-foreground">Drag to rotate · Scroll or pinch to zoom</p>{omitted.length>0&&<p role="status" className="p-4 text-xs">Some artwork placements cannot be shown accurately in this preview. They remain in your design specifications.</p>}</section>;
}

function useStudioArtwork(brandings,environment){
 const refs=brandings.filter(row=>row.design_id).map(row=>({resource:'brandings',record_id:String(row.design_id),field:'image'}));
 const grants=useMediaGrants(refs,{enabled:refs.length>0});
 const query=useSquadQuery(['studio-branding-images',brandings,grants.data],async({signal})=>{
  const result=[];
  for(const row of brandings){
   signal.throwIfAborted();if(!row.design_id)continue;
   const ref={resource:'brandings',record_id:String(row.design_id),field:'image'};
   const grant=grants.data?.find(item=>referenceKey(item)===referenceKey(ref));
   if(grant?.status==='missing')continue;
   const url=grant?.status==='ready'&&safeMediaUrl(grant.url,getEnvironmentConfig(environment).url);
   if(!url)throw Error('Artwork is still being prepared.');
   const placement=studioArtworkPlacement(row.side??'',String(row.width),String(row.height));
   if(!placement)throw Error('This artwork placement has no verified 3D position.');
   if(!['image/png','image/jpeg','image/webp','image/gif'].includes(grant.content_type))throw Error('Use a PNG, JPEG or WebP artwork image for the 3D preview.');
   const response=await fetch(url,{signal,credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error('Artwork could not be loaded.');
   const blob=await response.blob();if(blob.size>10*1024*1024)throw Error('Artwork exceeds the preview size limit.');
   const bitmap=await createImageBitmap(blob);
   try{signal.throwIfAborted();const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const dataUri=canvas.toDataURL('image/png');if(dataUri.length>2800000)throw Error('Artwork is too detailed for the 3D preview.');result.push({id:String(row.design_id),dataUri,...placement});}finally{bitmap.close();}
  }
  signal.throwIfAborted();return result;
 },{enabled:refs.length>0&&!grants.isLoading&&!grants.error,staleTime:60000,gcTime:120000,refetchOnWindowFocus:false});
 return {data:refs.length?query.data:[],pending:refs.length>0&&(grants.isLoading||query.isFetching),error:grants.error||query.error};
}
